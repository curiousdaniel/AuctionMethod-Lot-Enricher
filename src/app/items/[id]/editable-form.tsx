"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface ItemData {
  id: number;
  status: string;
  enrichedTitle: string | null;
  enrichedDesc: string | null;
  photoCaption: string | null;
  suggestedValue: string | null;
}

export function EditableEnrichedForm({ item }: { item: ItemData }) {
  const router = useRouter();
  const isEditable = item.status === "ENRICHED";

  const [title, setTitle] = useState(item.enrichedTitle ?? "");
  const [description, setDescription] = useState(item.enrichedDesc ?? "");
  const [caption, setCaption] = useState(item.photoCaption ?? "");
  const [value, setValue] = useState(item.suggestedValue ?? "");

  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isDirty =
    title !== (item.enrichedTitle ?? "") ||
    description !== (item.enrichedDesc ?? "") ||
    caption !== (item.photoCaption ?? "") ||
    value !== (item.suggestedValue ?? "");

  const saveEdits = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrichedTitle: title,
          enrichedDesc: description,
          photoCaption: caption,
          suggestedValue: value,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      setMessage({ type: "success", text: "Edits saved" });
      router.refresh();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }, [item.id, title, description, caption, value, router]);

  const approve = useCallback(async () => {
    if (!confirm("Approve and publish this listing to the auction platform?")) return;

    setApproving(true);
    setMessage(null);
    try {
      if (isDirty) {
        const saveRes = await fetch(`/api/items/${item.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enrichedTitle: title,
            enrichedDesc: description,
            photoCaption: caption,
            suggestedValue: value,
          }),
        });
        if (!saveRes.ok) {
          const data = await saveRes.json();
          throw new Error(data.error || "Failed to save edits before approval");
        }
      }

      const res = await fetch(`/api/items/${item.id}/approve`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Approval failed (${res.status})`);
      }
      setMessage({ type: "success", text: "Approved and published!" });
      router.refresh();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Approval failed" });
    } finally {
      setApproving(false);
    }
  }, [item.id, title, description, caption, value, isDirty, router]);

  const isCancellable = ["PENDING", "PROCESSING", "ENRICHED", "ERROR"].includes(item.status);

  const cancelEnrichment = useCallback(async () => {
    if (!confirm("Cancel enrichment for this item? It will be marked as skipped.")) return;

    setCancelling(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/items/${item.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Cancel failed (${res.status})`);
      }
      setMessage({ type: "success", text: "Enrichment cancelled" });
      router.refresh();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Cancel failed" });
    } finally {
      setCancelling(false);
    }
  }, [item.id, router]);

  return (
    <div className="space-y-6">
      {/* Review banner */}
      {isEditable && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4">
          <p className="text-sm text-amber-800 dark:text-amber-300 font-medium">
            Ready for review — edit the enriched content below, then approve to publish to the auction platform.
          </p>
        </div>
      )}

      {/* Status message */}
      {message && (
        <div
          className={`rounded-xl p-4 text-sm font-medium ${
            message.type === "success"
              ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-700"
              : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Enriched fields */}
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-emerald-200 dark:border-emerald-700/50 p-6">
        <h2 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-4">
          Enriched by AI
          {isDirty && isEditable && (
            <span className="ml-2 text-amber-500 dark:text-amber-400 normal-case text-xs font-normal">
              (unsaved changes)
            </span>
          )}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase">
              Title
            </label>
            {isEditable ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            ) : (
              <p className="mt-1 text-slate-900 dark:text-white font-medium">
                {item.enrichedTitle || <span className="text-slate-400 italic">Not yet enriched</span>}
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase">
              Description
            </label>
            {isEditable ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={8}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 leading-relaxed"
              />
            ) : (
              <div className="mt-1 text-slate-700 dark:text-slate-300 text-sm leading-relaxed">
                {item.enrichedDesc || <span className="text-slate-400 italic">Not yet enriched</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Caption & Value (editable) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Photo Caption
          </h3>
          {isEditable ? (
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          ) : (
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {item.photoCaption || <span className="text-slate-400 italic">No caption</span>}
            </p>
          )}
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Suggested Value
          </h3>
          {isEditable ? (
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          ) : (
            <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
              {item.suggestedValue || <span className="text-slate-400 italic text-sm font-normal">No estimate</span>}
            </p>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {(isEditable || isCancellable) && (
        <div className="flex items-center gap-3 pt-2">
          {isEditable && (
            <>
              <button
                onClick={approve}
                disabled={approving || saving || cancelling}
                className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
              >
                {approving ? "Publishing..." : "Approve & Publish"}
              </button>
              <button
                onClick={saveEdits}
                disabled={saving || approving || cancelling || !isDirty}
                className="px-5 py-2.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-300 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
              >
                {saving ? "Saving..." : "Save Edits"}
              </button>
            </>
          )}
          {isCancellable && (
            <button
              onClick={cancelEnrichment}
              disabled={cancelling || approving || saving}
              className="px-5 py-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
            >
              {cancelling ? "Cancelling..." : "Cancel Enrichment"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
