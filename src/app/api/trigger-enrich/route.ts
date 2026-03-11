import { NextResponse } from "next/server";
import { runEnrichmentJob } from "@/lib/run-enrichment-job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  try {
    const summary = await runEnrichmentJob();
    console.log("[Trigger] Run complete:", JSON.stringify(summary));
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("[Trigger] Fatal error:", message);
    if (stack) console.error("[Trigger] Stack:", stack);
    return NextResponse.json(
      { error: "Enrichment run failed", details: message },
      { status: 500 }
    );
  }
}
