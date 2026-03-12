import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateItem } from "@/lib/amapi";

export const dynamic = "force-dynamic";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const requestedIds: number[] | undefined = body.ids;
  const auctionId: number | undefined = body.auctionId;

  const where: Record<string, unknown> = { status: "ENRICHED" };
  if (requestedIds && Array.isArray(requestedIds)) {
    where.id = { in: requestedIds };
  }
  if (auctionId) {
    where.auctionId = auctionId;
  }

  const items = await prisma.enrichedItem.findMany({ where });

  if (items.length === 0) {
    return NextResponse.json({ approved: 0, failed: 0, errors: [] });
  }

  let approved = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const item of items) {
    if (!item.enrichedTitle || !item.enrichedDesc) {
      errors.push(`Item ${item.id}: missing enriched title or description`);
      failed++;
      continue;
    }

    try {
      await updateItem(item.auctionId, item.itemId, {
        title: item.enrichedTitle,
        description: item.enrichedDesc,
      });

      await prisma.enrichedItem.update({
        where: { id: item.id },
        data: {
          status: "WRITTEN",
          writtenBackAt: new Date(),
        },
      });

      approved++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[BulkApprove] Failed item ${item.itemId}:`, message);

      await prisma.enrichedItem.update({
        where: { id: item.id },
        data: {
          status: "ERROR",
          errorMessage: `Bulk approval write-back failed: ${message}`.substring(0, 5000),
        },
      });

      errors.push(`Item ${item.id}: ${message.substring(0, 200)}`);
      failed++;
    }

    if (approved + failed < items.length) {
      await sleep(500);
    }
  }

  return NextResponse.json({ approved, failed, errors });
}
