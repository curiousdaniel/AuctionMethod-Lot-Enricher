import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditableEnrichedForm } from "./editable-form";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  PROCESSING: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  ENRICHED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  WRITTEN: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  SKIPPED: "bg-slate-100 text-slate-600 dark:bg-slate-700/30 dark:text-slate-400",
  ERROR: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) notFound();

  const item = await prisma.enrichedItem.findUnique({ where: { id } });
  if (!item) notFound();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          &larr; Back to Dashboard
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {item.rawTitle || "Untitled Item"}
            </h1>
            <span
              className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${
                STATUS_COLORS[item.status] || "bg-slate-100 text-slate-600"
              }`}
            >
              {item.status}
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Auction #{item.auctionId} &middot; Item #{item.itemId}
            {item.lotNumber && <> &middot; Lot {item.lotNumber}</>}
            {item.auctionTitle && (
              <>
                {" "}
                &middot; <span className="italic">{item.auctionTitle}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Side-by-side: Original on left, Editable enriched on right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Raw (original) — always read-only */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4">
            Original from AM API
          </h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase">
                Title
              </label>
              <p className="mt-1 text-slate-900 dark:text-white font-medium">
                {item.rawTitle || <span className="text-slate-400 italic">No title</span>}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase">
                Description
              </label>
              <div
                className="mt-1 text-slate-700 dark:text-slate-300 text-sm leading-relaxed prose dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{
                  __html: item.rawDescription || "<em class='text-slate-400'>No description</em>",
                }}
              />
            </div>
          </div>

          {/* Images in the original panel */}
          {item.rawImageUrls.length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700">
              <label className="text-xs font-medium text-slate-400 dark:text-slate-500 uppercase">
                Images ({item.rawImageUrls.length})
              </label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {item.rawImageUrls.slice(0, 4).map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 hover:opacity-80 transition-opacity"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Item image ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Enriched — editable form when ENRICHED, read-only otherwise */}
        <EditableEnrichedForm
          item={{
            id: item.id,
            status: item.status,
            enrichedTitle: item.enrichedTitle,
            enrichedDesc: item.enrichedDesc,
            photoCaption: item.photoCaption,
            suggestedValue: item.suggestedValue,
          }}
        />
      </div>

      {/* Research Notes & Web Sources */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <DetailCard title="Research Notes (Internal)">
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
            {item.researchNotes || (
              <span className="text-slate-400 italic">No research notes</span>
            )}
          </p>
        </DetailCard>

        <DetailCard title="Web Sources Cited">
          {item.webSourceUrls.length > 0 ? (
            <ul className="space-y-1">
              {item.webSourceUrls.map((url, i) => (
                <li key={i}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 italic">No web sources</p>
          )}
        </DetailCard>
      </div>

      {/* Status Timeline */}
      <DetailCard title="Status Timeline">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <TimelineEntry label="Created" date={item.createdAt} />
          <TimelineEntry label="Fetched from API" date={item.fetchedAt} />
          <TimelineEntry label="Enriched" date={item.enrichedAt} />
          <TimelineEntry label="Written Back" date={item.writtenBackAt} />
        </div>
        {item.errorMessage && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
            <p className="text-xs font-medium text-red-600 dark:text-red-400 uppercase mb-1">
              Error (retry count: {item.retryCount})
            </p>
            <p className="text-sm text-red-800 dark:text-red-300 font-mono whitespace-pre-wrap break-all">
              {item.errorMessage}
            </p>
          </div>
        )}
      </DetailCard>
    </div>
  );
}

function DetailCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-5">
      <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}

function TimelineEntry({
  label,
  date,
}: {
  label: string;
  date: Date | null;
}) {
  return (
    <div>
      <p className="text-xs text-slate-400 dark:text-slate-500">{label}</p>
      <p className="text-slate-900 dark:text-white font-medium mt-0.5">
        {date
          ? new Date(date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : "—"}
      </p>
    </div>
  );
}
