import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { scanAndQueueItems } from "@/lib/run-enrichment-job";
import { shouldStartChain, getContinueUrl, getContinueHeaders } from "@/lib/enrich-chain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const scan = await scanAndQueueItems();

    const { pending, alreadyRunning } = await shouldStartChain();

    if (pending > 0 && !alreadyRunning) {
      console.log(`[Trigger] ${pending} pending items — starting enrichment chain`);
      waitUntil(
        fetch(getContinueUrl(), {
          method: "POST",
          headers: getContinueHeaders(),
        }).catch((err) => {
          console.error("[Trigger] Failed to start chain:", err);
        })
      );
    } else if (alreadyRunning) {
      console.log(`[Trigger] Enrichment already in progress — new items will be picked up`);
    } else {
      console.log("[Trigger] No pending items to process");
    }

    return NextResponse.json({
      ...scan,
      totalPending: pending,
      status: pending > 0 ? "processing" : "idle",
      timestamp: new Date().toISOString(),
    });
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
