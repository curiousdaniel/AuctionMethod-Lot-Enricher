"use client";

import { useState } from "react";

export function RunEnrichmentButton() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<string | null>(null);

  async function handleRun() {
    setState("running");
    setResult(null);

    try {
      const res = await fetch("/api/trigger-enrich", {
        method: "POST",
      });

      if (res.status === 504) {
        setState("done");
        setResult("Timed out — but items may have been processed. Refreshing...");
        setTimeout(() => window.location.reload(), 2000);
        return;
      }

      let data;
      try {
        data = await res.json();
      } catch {
        setState("error");
        setResult(`Server returned non-JSON response (status ${res.status})`);
        setTimeout(() => window.location.reload(), 3000);
        return;
      }

      if (!res.ok) {
        setState("error");
        setResult(data.details || data.error || `Failed with status ${res.status}`);
        return;
      }

      setState("done");
      const parts = [];
      if (data.auctionsScanned != null) parts.push(`${data.auctionsScanned} auctions scanned`);
      if (data.newItemsQueued != null) parts.push(`${data.newItemsQueued} new items queued`);
      if (data.processed != null) parts.push(`${data.processed} processed`);
      if (data.succeeded != null) parts.push(`${data.succeeded} succeeded`);
      if (data.errors != null && data.errors > 0) parts.push(`${data.errors} errors`);
      setResult(parts.join(", ") || "Completed");

      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      setState("error");
      setResult(err instanceof Error ? err.message : "Network error");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleRun}
        disabled={state === "running"}
        className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
          state === "running"
            ? "bg-slate-300 dark:bg-slate-600 text-slate-500 dark:text-slate-400 cursor-not-allowed"
            : "bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-700 dark:hover:bg-slate-200"
        }`}
      >
        {state === "running" ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Running...
          </>
        ) : (
          "Run Enrichment Now"
        )}
      </button>

      {result && (
        <span
          className={`text-sm ${
            state === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {result}
        </span>
      )}
    </div>
  );
}
