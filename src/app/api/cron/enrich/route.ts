import { NextRequest, NextResponse } from "next/server";
import { runEnrichmentJob } from "@/lib/run-enrichment-job";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runEnrichmentJob();
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
