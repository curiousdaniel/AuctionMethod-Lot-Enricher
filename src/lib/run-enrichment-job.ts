import { prisma } from "./prisma";
import { amAuth, getAllActiveAuctions, getAllItems } from "./amapi";
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

export async function runEnrichmentJob(): Promise<EnrichmentJobResult> {
  validateEnvVars();

  console.log("[Enrich Job] Authenticating with AM API...");
  await amAuth();
  console.log("[Enrich Job] Auth successful");

  console.log("[Enrich Job] Fetching active auctions...");
  const auctions = await getAllActiveAuctions();
  console.log(`[Enrich Job] Found ${auctions.length} active/upcoming auctions`);

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

  let newItemsQueued = 0;
  for (const auction of auctions) {
    console.log(`[Enrich Job] Scanning auction ${auction.id}: "${auction.title}"`);

    const items = await getAllItems(auction.id);
    console.log(`[Enrich Job] Found ${items.length} items in auction ${auction.id}`);

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
