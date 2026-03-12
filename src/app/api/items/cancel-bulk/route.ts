import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CANCELLABLE = ["PENDING", "PROCESSING", "ENRICHED", "ERROR"] as const;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const requestedIds: number[] | undefined = body.ids;
  const auctionId: number | undefined = body.auctionId;
  const statusFilter: string | undefined = body.status;

  const where: Record<string, unknown> = {
    status: { in: CANCELLABLE },
  };

  if (requestedIds && Array.isArray(requestedIds)) {
    where.id = { in: requestedIds };
  }
  if (auctionId) {
    where.auctionId = auctionId;
  }
  if (statusFilter && CANCELLABLE.includes(statusFilter as (typeof CANCELLABLE)[number])) {
    where.status = statusFilter;
  }

  const result = await prisma.enrichedItem.updateMany({
    where,
    data: { status: "SKIPPED" },
  });

  return NextResponse.json({ cancelled: result.count });
}
