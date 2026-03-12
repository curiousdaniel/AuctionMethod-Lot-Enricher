import { prisma } from "./prisma";
import { getItem, getItemImageUrls } from "./amapi";
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
    if (!response.ok) {
      console.log(`[Enrich] Image download failed (${response.status}) for ${url}`);
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const mediaType = contentType.startsWith("image/") ? contentType.split(";")[0] : "image/jpeg";
    return { data: base64, mediaType };
  } catch (error) {
    console.log(`[Enrich] Failed to download image ${url}:`, error);
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
    await prisma.enrichedItem.update({
      where: { id: enrichedItemId },
      data: { status: "PROCESSING" },
    });

    const rawTitle = record.rawTitle || "";
    const rawDescription = record.rawDescription || "";
    let rawImageUrls = record.rawImageUrls || [];

    console.log(`[Enrich] Processing item ${record.itemId} from auction ${record.auctionId}`);

    // Fetch full item details from the single-item endpoint to get the complete images array
    try {
      const freshItem = await getItem(record.auctionId, record.itemId);
      const freshUrls = getItemImageUrls(freshItem);
      if (freshUrls.length > rawImageUrls.length) {
        console.log(`[Enrich] Single-item endpoint returned ${freshUrls.length} images (had ${rawImageUrls.length})`);
        rawImageUrls = freshUrls;
        await prisma.enrichedItem.update({
          where: { id: enrichedItemId },
          data: { rawImageUrls: freshUrls },
        });
      }
    } catch (err) {
      console.log(`[Enrich] Could not fetch single item — using stored images:`, err instanceof Error ? err.message : err);
    }

    console.log(`[Enrich] Title: "${rawTitle}", Description length: ${rawDescription.length}, Images: ${rawImageUrls.length}`);

    await prisma.enrichedItem.update({
      where: { id: enrichedItemId },
      data: { fetchedAt: new Date() },
    });

    const imageUrls = rawImageUrls.slice(0, MAX_IMAGES);
    let researchNotes = "";

    const downloadResults = imageUrls.length > 0
      ? await Promise.all(imageUrls.map(downloadImageAsBase64))
      : [];
    const images = downloadResults.filter(
      (r): r is { data: string; mediaType: string } => r !== null
    );

    if (imageUrls.length > 0) {
      const imageFailures = imageUrls.length - images.length;
      if (imageFailures > 0) {
        researchNotes += `${imageFailures} of ${imageUrls.length} images failed to download. `;
      }
      if (images.length === 0) {
        researchNotes += "All images failed to download — proceeding without visual analysis. ";
      }
    }

    // Step 3: Claude Vision Analysis
    console.log(`[Enrich] Running vision analysis (${images.length} images) for item ${record.itemId}`);
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

    console.log(`[Enrich] Item ${record.itemId} enriched — held for review`);
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
  const batchSize = parseInt(process.env.ENRICHMENT_BATCH_SIZE ?? "5", 10);
  const minDelay = parseInt(process.env.ENRICHMENT_MIN_DELAY_MS ?? "1000", 10);

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
