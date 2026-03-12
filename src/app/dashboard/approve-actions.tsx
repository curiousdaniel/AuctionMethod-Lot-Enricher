"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export function BulkApproveBar({ enrichedCount }: { enrichedCount: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ approved: number; failed: number } | null>(null);

  const approveAll = useCallback(async () => {
    if (
      !confirm(
        `Approve and publish all ${enrichedCount} enriched items to the auction platform?`
      )
    )
      return;

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/items/approve-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setResult({ approved: data.approved, failed: data.failed });
      router.refresh();
    } catch {
      setResult({ approved: 0, failed: enrichedCount });
    } finally {
      setLoading(false);
    }
  }, [enrichedCount, router]);

  if (enrichedCount === 0) return null;

  return (
    <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
          {enrichedCount} item{enrichedCount !== 1 ? "s" : ""} ready for review
        </p>
        {result && (
          <p className="text-xs mt-1 text-emerald-700 dark:text-emerald-400">
            {result.approved} approved{result.failed > 0 ? `, ${result.failed} failed` : ""}
          </p>
        )}
      </div>
      <button
        onClick={approveAll}
        disabled={loading}
        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 whitespace-nowrap"
      >
        {loading ? "Publishing..." : `Approve All (${enrichedCount})`}
      </button>
    </div>
  );
}

export function RowApproveButton({ itemId }: { itemId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const approve = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setLoading(true);
      try {
        const res = await fetch(`/api/items/${itemId}/approve`, { method: "POST" });
        if (res.ok) {
          setDone(true);
          router.refresh();
        }
      } finally {
        setLoading(false);
      }
    },
    [itemId, router]
  );

  if (done) {
    return (
      <span className="text-xs text-green-600 dark:text-green-400 font-medium">
        Published
      </span>
    );
  }

  return (
    <button
      onClick={approve}
      disabled={loading}
      className="px-2.5 py-1 text-xs rounded-lg bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800/40 disabled:opacity-50 font-medium transition-colors"
    >
      {loading ? "..." : "Approve"}
    </button>
  );
}

export function RowCancelButton({ itemId }: { itemId: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const cancel = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setLoading(true);
      try {
        const res = await fetch(`/api/items/${itemId}/cancel`, { method: "POST" });
        if (res.ok) {
          setDone(true);
          router.refresh();
        }
      } finally {
        setLoading(false);
      }
    },
    [itemId, router]
  );

  if (done) {
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
        Cancelled
      </span>
    );
  }

  return (
    <button
      onClick={cancel}
      disabled={loading}
      className="px-2.5 py-1 text-xs rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 font-medium transition-colors"
    >
      {loading ? "..." : "Cancel"}
    </button>
  );
}

export function BulkCancelBar({
  cancellableCount,
  statusFilter,
}: {
  cancellableCount: number;
  statusFilter?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ cancelled: number } | null>(null);

  const cancelAll = useCallback(async () => {
    const label = statusFilter
      ? `${cancellableCount} ${statusFilter.toLowerCase()} item${cancellableCount !== 1 ? "s" : ""}`
      : `${cancellableCount} item${cancellableCount !== 1 ? "s" : ""}`;
    if (!confirm(`Cancel enrichment for ${label}? They will be marked as skipped.`)) return;

    setLoading(true);
    setResult(null);
    try {
      const body: Record<string, unknown> = {};
      if (statusFilter) body.status = statusFilter;
      const res = await fetch("/api/items/cancel-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setResult({ cancelled: data.cancelled });
      router.refresh();
    } catch {
      setResult({ cancelled: 0 });
    } finally {
      setLoading(false);
    }
  }, [cancellableCount, statusFilter, router]);

  if (cancellableCount === 0) return null;

  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="text-sm font-medium text-red-800 dark:text-red-300">
          {cancellableCount} item{cancellableCount !== 1 ? "s" : ""} can be cancelled
          {statusFilter ? ` (${statusFilter.toLowerCase()})` : ""}
        </p>
        {result && (
          <p className="text-xs mt-1 text-red-700 dark:text-red-400">
            {result.cancelled} cancelled
          </p>
        )}
      </div>
      <button
        onClick={cancelAll}
        disabled={loading}
        className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 whitespace-nowrap"
      >
        {loading ? "Cancelling..." : `Cancel All (${cancellableCount})`}
      </button>
    </div>
  );
}
