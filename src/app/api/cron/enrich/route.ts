import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { amAuth, getAllActiveAuctions, getAllItems } from "@/lib/amapi";
import { runEnrichmentBatch } from "@/lib/enrichment-pipeline";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Verify authorization
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Step 1: Authenticate with AM API
    console.log("[Cron] Authenticating with AM API...");
    await amAuth();

    // Step 2: Fetch all active/upcoming auctions
    console.log("[Cron] Fetching active auctions...");
    const auctions = await getAllActiveAuctions();
    console.log(`[Cron] Found ${auctions.length} active/upcoming auctions`);

    // Upsert auctions into AuctionScan table
    for (const auction of auctions) {
      await prisma.auctionScan.upsert({
        where: { auctionId: auction.id },
        create: {
          auctionId: auction.id,
          auctionTitle: auction.title,
          endsAt: auction.ends ? new Date(auction.ends) : null,
          lastScannedAt: new Date(),
          itemCount: 0,
        },
        update: {
          auctionTitle: auction.title,
          endsAt: auction.ends ? new Date(auction.ends) : null,
          lastScannedAt: new Date(),
        },
      });
    }

    // Step 3: For each auction, fetch all items and create PENDING records
    let newItemsQueued = 0;
    for (const auction of auctions) {
      console.log(`[Cron] Scanning auction ${auction.id}: "${auction.title}"`);

      const items = await getAllItems(auction.id);
      console.log(`[Cron] Found ${items.length} items in auction ${auction.id}`);

      // Update item count
      await prisma.auctionScan.update({
        where: { auctionId: auction.id },
        data: { itemCount: items.length },
      });

      for (const item of items) {
        const existing = await prisma.enrichedItem.findUnique({
          where: {
            auctionId_itemId: {
              auctionId: auction.id,
              itemId: item.id,
            },
          },
        });

        if (!existing) {
          await prisma.enrichedItem.create({
            data: {
              auctionId: auction.id,
              itemId: item.id,
              auctionTitle: auction.title,
              lotNumber: item.lot_number,
              rawTitle: item.title,
              rawDescription: item.description,
              rawImageUrls: (item.images ?? []).map((img) => img.url),
              status: "PENDING",
            },
          });
          newItemsQueued++;
        }
      }
    }

    console.log(`[Cron] Queued ${newItemsQueued} new items for enrichment`);

    // Steps 4-5: Process pending items
    console.log("[Cron] Starting enrichment batch...");
    const result = await runEnrichmentBatch();

    const summary = {
      auctionsScanned: auctions.length,
      newItemsQueued,
      processed: result.processed,
      succeeded: result.succeeded,
      errors: result.errors,
      skipped: result.skipped,
      timestamp: new Date().toISOString(),
    };

    console.log("[Cron] Run complete:", summary);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Cron] Fatal error:", message);
    return NextResponse.json(
      { error: "Enrichment cron failed", details: message },
      { status: 500 }
    );
  }
}
