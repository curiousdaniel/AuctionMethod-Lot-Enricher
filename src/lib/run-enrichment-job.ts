import { prisma } from "./prisma";
import { amAuth, getAllActiveAuctions, getItemImageUrls, type AMItem } from "./amapi";
import { runEnrichmentBatch } from "./enrichment-pipeline";

export interface EnrichmentJobResult {
  auctionsScanned: number;
  newItemsQueued: number;
  processed: number;
  succeeded: number;
  errors: number;
  skipped: number;
  timestamp: string;
}

function validateEnvVars() {
  const required = ["AM_DOMAIN", "AM_EMAIL", "AM_PASSWORD", "DATABASE_URL"];
  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  console.log("[Enrich Job] Environment OK. AM_DOMAIN:", process.env.AM_DOMAIN);
}

function extractDescription(item: AMItem): string {
  if (item.description) return item.description;
  if (item.update_and_special_terms) {
    try {
      const parsed = JSON.parse(String(item.update_and_special_terms));
      return parsed.item_description || "";
    } catch {
      return "";
    }
  }
  return "";
}

export async function runEnrichmentJob(): Promise<EnrichmentJobResult> {
  validateEnvVars();

  // Reset PROCESSING items stuck for more than 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const resetResult = await prisma.enrichedItem.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: tenMinutesAgo },
    },
    data: { status: "PENDING" },
  });
  if (resetResult.count > 0) {
    console.log(`[Enrich Job] Reset ${resetResult.count} stuck PROCESSING items`);
  }

  // Clean up stale auction scans for auctions that have ended
  const now = new Date();
  await prisma.auctionScan.deleteMany({
    where: {
      endsAt: { lt: now },
    },
  });

  console.log("[Enrich Job] Authenticating with AM API...");
  await amAuth();
  console.log("[Enrich Job] Auth successful");

  console.log("[Enrich Job] Fetching active auctions...");
  const auctions = await getAllActiveAuctions();
  console.log(`[Enrich Job] Found ${auctions.length} active/upcoming auctions`);

  let newItemsQueued = 0;
  for (const auction of auctions) {
    const auctionIdNum = parseInt(String(auction.id), 10);
    console.log(`[Enrich Job] Scanning auction ${auction.id}: "${auction.title}"`);

    const items: AMItem[] = auction.items ?? [];
    console.log(`[Enrich Job] Auction ${auction.id} has ${items.length} embedded items`);

    await prisma.auctionScan.upsert({
      where: { auctionId: auctionIdNum },
      create: {
        auctionId: auctionIdNum,
        auctionTitle: auction.title,
        endsAt: auction.ends ? new Date(auction.ends) : null,
        lastScannedAt: new Date(),
        itemCount: items.length,
      },
      update: {
        auctionTitle: auction.title,
        endsAt: auction.ends ? new Date(auction.ends) : null,
        lastScannedAt: new Date(),
        itemCount: items.length,
      },
    });

    for (const item of items) {
      const itemIdNum = parseInt(String(item.id), 10);
      const imageUrls = getItemImageUrls(item);
      const description = extractDescription(item);

      const existing = await prisma.enrichedItem.findUnique({
        where: {
          auctionId_itemId: {
            auctionId: auctionIdNum,
            itemId: itemIdNum,
          },
        },
      });

      if (!existing) {
        await prisma.enrichedItem.create({
          data: {
            auctionId: auctionIdNum,
            itemId: itemIdNum,
            auctionTitle: auction.title,
            lotNumber: item.lot_number,
            rawTitle: item.title,
            rawDescription: description,
            rawImageUrls: imageUrls,
            status: "PENDING",
          },
        });
        newItemsQueued++;
      } else if (!existing.rawTitle && item.title) {
        // Backfill missing data on existing records
        console.log(`[Enrich Job] Backfilling data for item ${itemIdNum} (was empty)`);
        await prisma.enrichedItem.update({
          where: { id: existing.id },
          data: {
            rawTitle: item.title,
            rawDescription: description || existing.rawDescription,
            rawImageUrls: imageUrls.length > 0 ? imageUrls : existing.rawImageUrls,
            lotNumber: item.lot_number || existing.lotNumber,
          },
        });
      }
    }
  }

  console.log(`[Enrich Job] Queued ${newItemsQueued} new items for enrichment`);
  console.log("[Enrich Job] Starting enrichment batch...");
  const result = await runEnrichmentBatch();

  return {
    auctionsScanned: auctions.length,
    newItemsQueued,
    processed: result.processed,
    succeeded: result.succeeded,
    errors: result.errors,
    skipped: result.skipped,
    timestamp: new Date().toISOString(),
  };
}
