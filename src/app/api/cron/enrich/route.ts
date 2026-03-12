import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { scanAndQueueItems } from "@/lib/run-enrichment-job";
import { shouldStartChain, getContinueUrl, getContinueHeaders } from "@/lib/enrich-chain";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const scan = await scanAndQueueItems();

    const { pending, alreadyRunning } = await shouldStartChain();

    if (pending > 0 && !alreadyRunning) {
      console.log(`[Cron] ${pending} pending items — starting enrichment chain`);
      waitUntil(
        fetch(getContinueUrl(), {
          method: "POST",
          headers: getContinueHeaders(),
        }).catch((err) => {
          console.error("[Cron] Failed to start chain:", err);
        })
      );
    } else if (alreadyRunning) {
      console.log(`[Cron] Enrichment already in progress — skipping`);
    } else {
      console.log("[Cron] No pending items to process");
    }

    return NextResponse.json({
      ...scan,
      totalPending: pending,
      status: pending > 0 ? "processing" : "idle",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Cron] Fatal error:", message);
    return NextResponse.json(
      { error: "Enrichment cron failed", details: message },
      { status: 500 }
    );
  }
}
