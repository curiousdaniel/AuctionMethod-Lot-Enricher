import { prisma } from "@/lib/prisma";
import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  PROCESSING: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  ENRICHED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  WRITTEN: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  SKIPPED: "bg-slate-100 text-slate-600 dark:bg-slate-700/30 dark:text-slate-400",
  ERROR: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string };
}) {
  const statusFilter = searchParams.status || undefined;
  const page = parseInt(searchParams.page ?? "1", 10);
  const limit = 25;
  const offset = (page - 1) * limit;

  // Stats
  const statusCounts = await prisma.enrichedItem.groupBy({
    by: ["status"],
    _count: true,
  });

  const stats = {
    total: 0,
    PENDING: 0,
    PROCESSING: 0,
    ENRICHED: 0,
    WRITTEN: 0,
    SKIPPED: 0,
    ERROR: 0,
  };

  for (const s of statusCounts) {
    stats[s.status as keyof typeof stats] = s._count;
    stats.total += s._count;
  }

  const auctionCount = await prisma.auctionScan.count();

  // Auctions with counts
  const auctions = await prisma.auctionScan.findMany({
    orderBy: { lastScannedAt: "desc" },
  });

  const auctionDetails = await Promise.all(
    auctions.map(async (auction) => {
      const counts = await prisma.enrichedItem.groupBy({
        by: ["status"],
        where: { auctionId: auction.auctionId },
        _count: true,
      });
      const itemTotal = counts.reduce((sum, c) => sum + c._count, 0);
      const enriched = counts
        .filter((c) => c.status === "ENRICHED" || c.status === "WRITTEN")
        .reduce((sum, c) => sum + c._count, 0);
      const pending = counts
        .filter((c) => c.status === "PENDING")
        .reduce((sum, c) => sum + c._count, 0);
      return { ...auction, itemTotal, enriched, pending };
    })
  );

  // Items
  const itemWhere: Record<string, unknown> = {};
  if (statusFilter) {
    itemWhere.status = statusFilter;
  }

  const [items, totalItems] = await Promise.all([
    prisma.enrichedItem.findMany({
      where: itemWhere,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.enrichedItem.count({ where: itemWhere }),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-8">
        Enrichment Dashboard
      </h1>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Total Items" value={stats.total} color="bg-slate-50 dark:bg-slate-800" />
        <StatCard
          label="Written Back"
          value={stats.WRITTEN}
          color="bg-green-50 dark:bg-green-900/20"
        />
        <StatCard
          label="Enriched"
          value={stats.ENRICHED}
          color="bg-emerald-50 dark:bg-emerald-900/20"
        />
        <StatCard
          label="Pending"
          value={stats.PENDING}
          color="bg-yellow-50 dark:bg-yellow-900/20"
        />
        <StatCard label="Errors" value={stats.ERROR} color="bg-red-50 dark:bg-red-900/20" />
        <StatCard
          label="Auctions Tracked"
          value={auctionCount}
          color="bg-blue-50 dark:bg-blue-900/20"
        />
      </div>

      {/* Auctions Table */}
      {auctionDetails.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
            Tracked Auctions
          </h2>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                      Auction Title
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                      Ends
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                      Items Total
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                      Enriched
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                      Pending
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                  {auctionDetails.map((a) => (
                    <tr
                      key={a.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                        {a.auctionTitle || `Auction #${a.auctionId}`}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {a.endsAt
                          ? new Date(a.endsAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-900 dark:text-white">
                        {a.itemTotal}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">
                        {a.enriched}
                      </td>
                      <td className="px-4 py-3 text-right text-yellow-600 dark:text-yellow-400">
                        {a.pending}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Items Table */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Enriched Items
          </h2>
          <div className="flex gap-2 flex-wrap">
            <FilterLink label="All" href="/dashboard" active={!statusFilter} />
            <FilterLink
              label="Pending"
              href="/dashboard?status=PENDING"
              active={statusFilter === "PENDING"}
            />
            <FilterLink
              label="Enriched"
              href="/dashboard?status=ENRICHED"
              active={statusFilter === "ENRICHED"}
            />
            <FilterLink
              label="Written"
              href="/dashboard?status=WRITTEN"
              active={statusFilter === "WRITTEN"}
            />
            <FilterLink
              label="Errors"
              href="/dashboard?status=ERROR"
              active={statusFilter === "ERROR"}
            />
            <FilterLink
              label="Skipped"
              href="/dashboard?status=SKIPPED"
              active={statusFilter === "SKIPPED"}
            />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                    Lot #
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                    Raw Title
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                    Enriched Title
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                    Value
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                    Enriched At
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-slate-500 dark:text-slate-400"
                    >
                      No items found. Run the enrichment cron to get started.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 font-mono text-xs">
                        {item.lotNumber || "—"}
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <Link
                          href={`/items/${item.id}`}
                          className="text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 font-medium truncate block"
                        >
                          {item.rawTitle
                            ? item.rawTitle.length > 60
                              ? item.rawTitle.substring(0, 60) + "..."
                              : item.rawTitle
                            : "Untitled"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 max-w-[200px] text-slate-600 dark:text-slate-400 truncate">
                        {item.enrichedTitle
                          ? item.enrichedTitle.length > 60
                            ? item.enrichedTitle.substring(0, 60) + "..."
                            : item.enrichedTitle
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                            STATUS_COLORS[item.status] || "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400 text-xs">
                        {item.suggestedValue || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                        {item.enrichedAt
                          ? new Date(item.enrichedAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 dark:border-slate-700">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Showing {offset + 1}–{Math.min(offset + limit, totalItems)} of {totalItems}
              </p>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    href={`/dashboard?${statusFilter ? `status=${statusFilter}&` : ""}page=${page - 1}`}
                    className="px-3 py-1 text-sm rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={`/dashboard?${statusFilter ? `status=${statusFilter}&` : ""}page=${page + 1}`}
                    className="px-3 py-1 text-sm rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-4 ${color} border border-slate-200 dark:border-slate-700`}>
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{value}</p>
    </div>
  );
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
        active
          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
          : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
      }`}
    >
      {label}
    </Link>
  );
}
