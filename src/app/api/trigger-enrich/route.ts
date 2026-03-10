import { NextResponse } from "next/server";
import { runEnrichmentJob } from "@/lib/run-enrichment-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const summary = await runEnrichmentJob();
    console.log("[Trigger] Run complete:", summary);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Trigger] Fatal error:", message);
    return NextResponse.json(
      { error: "Enrichment run failed", details: message },
      { status: 500 }
    );
  }
}
