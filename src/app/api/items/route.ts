import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { EnrichStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get("status") as EnrichStatus | null;
  const auctionId = searchParams.get("auctionId");
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const offset = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (status && Object.values(EnrichStatus).includes(status)) {
    where.status = status;
  }
  if (auctionId) {
    where.auctionId = parseInt(auctionId, 10);
  }

  const [items, total] = await Promise.all([
    prisma.enrichedItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.enrichedItem.count({ where }),
  ]);

  return NextResponse.json({
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}
