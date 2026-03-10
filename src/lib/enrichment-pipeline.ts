import { prisma } from "./prisma";
import { getItem, updateItem } from "./amapi";
import {
  analyzeImages,
  researchItem,
  writeCopy,
  type VisionAnalysis,
  type ResearchResult,
} from "./anthropic";

const MAX_IMAGES = 4;

interface EnrichmentResult {
  success: boolean;
  itemId: number;
  error?: string;
}

async function downloadImageAsBase64(
  url: string
): Promise<{ data: string; mediaType: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const mediaType = contentType.startsWith("image/") ? contentType.split(";")[0] : "image/jpeg";
    return { data: base64, mediaType };
  } catch (error) {
    console.log(`Failed to download image ${url}:`, error);
    return null;
  }
}

async function retryOnce<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.log(`${label} failed, retrying once...`, error);
    return await fn();
  }
}

export async function enrichItem(enrichedItemId: number): Promise<EnrichmentResult> {
  const record = await prisma.enrichedItem.findUnique({ where: { id: enrichedItemId } });
  if (!record) {
    return { success: false, itemId: enrichedItemId, error: "Record not found" };
  }

  try {
    // Mark as PROCESSING
    await prisma.enrichedItem.update({
      where: { id: enrichedItemId },
      data: { status: "PROCESSING" },
    });

    // Step 1: Fetch full item data from AM API
    console.log(`[Enrich] Fetching item ${record.itemId} from auction ${record.auctionId}`);
    let amItem;
    try {
      amItem = await getItem(record.auctionId, record.itemId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("404")) {
        await prisma.enrichedItem.update({
          where: { id: enrichedItemId },
          data: {
            status: "SKIPPED",
            errorMessage: "Item not found in AM API (404)",
          },
        });
        return { success: false, itemId: enrichedItemId, error: "Item 404" };
      }
      throw error;
    }

    const rawTitle = amItem.title || "";
    const rawDescription = amItem.description || "";
    const rawImageUrls = (amItem.images ?? []).map((img) => img.url);

    await prisma.enrichedItem.update({
      where: { id: enrichedItemId },
      data: {
        rawTitle,
        rawDescription,
        rawImageUrls,
        fetchedAt: new Date(),
      },
    });

    // Step 2: Download and encode images (up to MAX_IMAGES)
    console.log(`[Enrich] Downloading up to ${MAX_IMAGES} images for item ${record.itemId}`);
    const imageUrls = rawImageUrls.slice(0, MAX_IMAGES);
    const downloadResults = await Promise.all(imageUrls.map(downloadImageAsBase64));
    const images = downloadResults.filter(
      (r): r is { data: string; mediaType: string } => r !== null
    );

    const imageFailures = imageUrls.length - images.length;
    let researchNotes = "";
    if (imageFailures > 0) {
      researchNotes += `${imageFailures} of ${imageUrls.length} images failed to download. `;
    }
    if (images.length === 0 && rawImageUrls.length > 0) {
      researchNotes += "All images failed to download — proceeding without visual analysis. ";
    }

    // Step 3: Claude Vision Analysis
    console.log(`[Enrich] Running vision analysis for item ${record.itemId}`);
    let visionAnalysis: VisionAnalysis;
    if (images.length > 0) {
      visionAnalysis = await retryOnce(
        () => analyzeImages(images, rawTitle, rawDescription),
        "Vision analysis"
      );
    } else {
      visionAnalysis = {
        identifiedObject: rawTitle || "Unknown item",
        era: "Unknown",
        material: "Unknown",
        condition: "Cannot assess without images",
        visibleMarkings: "No images available",
        confidenceNotes: "No images were available for visual analysis",
      };
    }

    // Step 4: Web Research
    console.log(`[Enrich] Running web research for item ${record.itemId}`);
    const researchResult: ResearchResult = await retryOnce(
      () => researchItem(visionAnalysis, rawTitle),
      "Web research"
    );

    // Step 5: Copywriting
    console.log(`[Enrich] Generating listing copy for item ${record.itemId}`);
    const copyResult = await retryOnce(
      () =>
        writeCopy(
          rawTitle,
          rawDescription,
          visionAnalysis,
          researchResult,
          record.auctionTitle ?? ""
        ),
      "Copywriting"
    );

    // Step 6: Validate output
    if (!copyResult.enrichedTitle || !copyResult.enrichedDescription) {
      throw new Error("Enriched title or description is empty after copywriting");
    }

    if (copyResult.missingInfo && copyResult.missingInfo.length > 0) {
      researchNotes += `Missing info flagged: ${copyResult.missingInfo.join(", ")}. `;
    }
    researchNotes += copyResult.writingNotes ?? "";

    // Save enrichment to DB
    await prisma.enrichedItem.update({
      where: { id: enrichedItemId },
      data: {
        status: "ENRICHED",
        enrichedAt: new Date(),
        enrichedTitle: copyResult.enrichedTitle,
        enrichedDesc: copyResult.enrichedDescription,
        photoCaption: copyResult.photoCaption,
        suggestedValue: copyResult.suggestedValue,
        researchNotes,
        webSourceUrls: researchResult.webSources ?? [],
      },
    });

    // Step 7: Write back to AM API
    console.log(`[Enrich] Writing back to AM API for item ${record.itemId}`);
    try {
      await updateItem(record.auctionId, record.itemId, {
        title: copyResult.enrichedTitle,
        description: copyResult.enrichedDescription,
      });

      await prisma.enrichedItem.update({
        where: { id: enrichedItemId },
        data: {
          status: "WRITTEN",
          writtenBackAt: new Date(),
        },
      });
    } catch (patchError) {
      console.error(
        `[Enrich] Failed to PATCH item ${record.itemId} back to AM API:`,
        patchError
      );
      // Enrichment is not lost — stays as ENRICHED
    }

    console.log(`[Enrich] Successfully enriched item ${record.itemId}`);
    return { success: true, itemId: enrichedItemId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Enrich] Error enriching item ${record.itemId}:`, errorMessage);

    await prisma.enrichedItem.update({
      where: { id: enrichedItemId },
      data: {
        status: "ERROR",
        errorMessage: errorMessage.substring(0, 5000),
        retryCount: { increment: 1 },
      },
    });

    return { success: false, itemId: enrichedItemId, error: errorMessage };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runEnrichmentBatch(): Promise<{
  processed: number;
  succeeded: number;
  errors: number;
  skipped: number;
  auctionsScanned: number;
}> {
  const batchSize = parseInt(process.env.ENRICHMENT_BATCH_SIZE ?? "10", 10);
  const minDelay = parseInt(process.env.ENRICHMENT_MIN_DELAY_MS ?? "2000", 10);

  const pendingItems = await prisma.enrichedItem.findMany({
    where: {
      status: "PENDING",
      retryCount: { lt: 3 },
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  console.log(`[Batch] Found ${pendingItems.length} pending items to process`);

  let succeeded = 0;
  let errors = 0;
  let skipped = 0;

  for (let i = 0; i < pendingItems.length; i++) {
    const item = pendingItems[i];
    const result = await enrichItem(item.id);

    if (result.success) {
      succeeded++;
    } else if (result.error?.includes("404") || result.error?.includes("SKIPPED")) {
      skipped++;
    } else {
      errors++;
    }

    if (i < pendingItems.length - 1) {
      await sleep(minDelay);
    }
  }

  const auctionCount = await prisma.auctionScan.count();

  return {
    processed: pendingItems.length,
    succeeded,
    errors,
    skipped,
    auctionsScanned: auctionCount,
  };
}
