import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CANCELLABLE = new Set(["PENDING", "PROCESSING", "ENRICHED", "ERROR"]);

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

  if (!CANCELLABLE.has(item.status)) {
    return NextResponse.json(
      { error: `Cannot cancel an item with status ${item.status}` },
      { status: 409 }
    );
  }

  const updated = await prisma.enrichedItem.update({
    where: { id },
    data: { status: "SKIPPED" },
  });

  return NextResponse.json(updated);
}
