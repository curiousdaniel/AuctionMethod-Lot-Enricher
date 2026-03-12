import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateItem } from "@/lib/amapi";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const item = await prisma.enrichedItem.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  if (item.status !== "ENRICHED") {
    return NextResponse.json(
      { error: "Only ENRICHED items can be approved" },
      { status: 409 }
    );
  }

  if (!item.enrichedTitle || !item.enrichedDesc) {
    return NextResponse.json(
      { error: "Enriched title and description are required" },
      { status: 422 }
    );
  }

  try {
    await updateItem(item.auctionId, item.itemId, {
      title: item.enrichedTitle,
      description: item.enrichedDesc,
    });

    const updated = await prisma.enrichedItem.update({
      where: { id },
      data: {
        status: "WRITTEN",
        writtenBackAt: new Date(),
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Approve] Failed to write item ${item.itemId} to AM API:`, message);

    await prisma.enrichedItem.update({
      where: { id },
      data: {
        status: "ERROR",
        errorMessage: `Approval write-back failed: ${message}`.substring(0, 5000),
      },
    });

    return NextResponse.json(
      { error: "Failed to write to auction platform", detail: message },
      { status: 502 }
    );
  }
}
