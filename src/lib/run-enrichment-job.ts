import { prisma } from "./prisma";
import { amAuth, getAllActiveAuctions, getAllItems, getItemImageUrls, type AMItem } from "./amapi";
import { runEnrichmentBatch } from "./enrichment-pipeline";

export interface ScanResult {
  auctionsScanned: number;
  newItemsQueued: number;
  requeued: number;
}

export interface EnrichmentJobResult extends ScanResult {
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

/**
 * Scan auctions and queue new/updated items as PENDING.
 * Fast operation (~10-20s) — no AI enrichment happens here.
 */
export async function scanAndQueueItems(): Promise<ScanResult> {
  validateEnvVars();

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const resetResult = await prisma.enrichedItem.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: tenMinutesAgo },
    },
    data: { status: "PENDING" },
  });
  if (resetResult.count > 0) {
    console.log(`[Scan] Reset ${resetResult.count} stuck PROCESSING items`);
  }

  const now = new Date();
  await prisma.auctionScan.deleteMany({
    where: { endsAt: { lt: now } },
  });

  console.log("[Scan] Authenticating with AM API...");
  await amAuth();
  console.log("[Scan] Auth successful");

  console.log("[Scan] Fetching active auctions...");
  const auctions = await getAllActiveAuctions();
  console.log(`[Scan] Found ${auctions.length} active/upcoming auctions`);

  let newItemsQueued = 0;
  let requeued = 0;
  for (const auction of auctions) {
    const auctionIdNum = parseInt(String(auction.id), 10);
    console.log(`[Scan] Scanning auction ${auction.id}: "${auction.title}"`);

    const items = await getAllItems(auctionIdNum);
    const itemsToProcess: AMItem[] = items.length > 0 ? items : (auction.items ?? []);
    console.log(`[Scan] Auction ${auction.id}: ${itemsToProcess.length} items (source: ${items.length > 0 ? "items endpoint" : "embedded"})`);

    await prisma.auctionScan.upsert({
      where: { auctionId: auctionIdNum },
      create: {
        auctionId: auctionIdNum,
        auctionTitle: auction.title,
        endsAt: auction.ends ? new Date(auction.ends) : null,
        lastScannedAt: new Date(),
        itemCount: itemsToProcess.length,
      },
      update: {
        auctionTitle: auction.title,
        endsAt: auction.ends ? new Date(auction.ends) : null,
        lastScannedAt: new Date(),
        itemCount: itemsToProcess.length,
      },
    });

    for (const item of itemsToProcess) {
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
        console.log(`[Scan] Queued item ${itemIdNum}: "${item.title}" (${imageUrls.length} images)`);
      } else if (existing.rawImageUrls.length === 0 && imageUrls.length > 0) {
        const needsReEnrich = ["ENRICHED", "WRITTEN", "ERROR"].includes(existing.status);
        console.log(`[Scan] Backfilling ${imageUrls.length} images for item ${itemIdNum}${needsReEnrich ? " — resetting to PENDING" : ""}`);
        await prisma.enrichedItem.update({
          where: { id: existing.id },
          data: {
            rawImageUrls: imageUrls,
            rawTitle: item.title || existing.rawTitle,
            rawDescription: description || existing.rawDescription,
            lotNumber: item.lot_number || existing.lotNumber,
            ...(needsReEnrich ? {
              status: "PENDING",
              enrichedTitle: null,
              enrichedDesc: null,
              photoCaption: null,
              suggestedValue: null,
              researchNotes: null,
              enrichedAt: null,
              writtenBackAt: null,
              errorMessage: null,
              retryCount: 0,
            } : {}),
          },
        });
        if (needsReEnrich) requeued++;
      }
    }
  }

  console.log(`[Scan] Queued ${newItemsQueued} new, ${requeued} re-queued for re-enrichment`);
  return { auctionsScanned: auctions.length, newItemsQueued, requeued };
}

/**
 * Convenience: scan + process in a single call.
 * Used by the cron fallback path if chaining is unavailable.
 */
export async function runEnrichmentJob(): Promise<EnrichmentJobResult> {
  const scan = await scanAndQueueItems();

  console.log("[Enrich Job] Starting enrichment batch...");
  const result = await runEnrichmentBatch();

  return {
    ...scan,
    processed: result.processed,
    succeeded: result.succeeded,
    errors: result.errors,
    skipped: result.skipped,
    timestamp: new Date().toISOString(),
  };
}
