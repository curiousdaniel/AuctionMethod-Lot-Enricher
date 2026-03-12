import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runEnrichmentBatch } from "@/lib/enrichment-pipeline";
import { getContinueUrl, getContinueHeaders, getPendingCount } from "@/lib/enrich-chain";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[Chain] Starting enrichment batch...");
    const result = await runEnrichmentBatch();
    console.log(`[Chain] Batch done: ${result.succeeded} succeeded, ${result.errors} errors`);

    const remaining = await getPendingCount();
    console.log(`[Chain] ${remaining} items still pending`);

    if (remaining > 0) {
      console.log("[Chain] Triggering continuation...");
      waitUntil(
        fetch(getContinueUrl(), {
          method: "POST",
          headers: getContinueHeaders(),
        }).catch((err) => {
          console.error("[Chain] Failed to trigger continuation:", err);
        })
      );
    } else {
      console.log("[Chain] All items processed — chain complete");
    }

    return NextResponse.json({
      ...result,
      remaining,
      continued: remaining > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Chain] Fatal error:", message);
    return NextResponse.json(
      { error: "Enrichment chain failed", details: message },
      { status: 500 }
    );
  }
}
