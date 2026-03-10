import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const auctions = await prisma.auctionScan.findMany({
    orderBy: { lastScannedAt: "desc" },
  });

  // For each auction, get enrichment counts
  const auctionsWithCounts = await Promise.all(
    auctions.map(async (auction) => {
      const counts = await prisma.enrichedItem.groupBy({
        by: ["status"],
        where: { auctionId: auction.auctionId },
        _count: true,
      });

      const statusCounts: Record<string, number> = {};
      let totalItems = 0;
      for (const c of counts) {
        statusCounts[c.status] = c._count;
        totalItems += c._count;
      }

      return {
        ...auction,
        totalTrackedItems: totalItems,
        enrichedCount: (statusCounts["ENRICHED"] ?? 0) + (statusCounts["WRITTEN"] ?? 0),
        pendingCount: statusCounts["PENDING"] ?? 0,
        errorCount: statusCounts["ERROR"] ?? 0,
        processingCount: statusCounts["PROCESSING"] ?? 0,
        skippedCount: statusCounts["SKIPPED"] ?? 0,
      };
    })
  );

  return NextResponse.json(auctionsWithCounts);
}
