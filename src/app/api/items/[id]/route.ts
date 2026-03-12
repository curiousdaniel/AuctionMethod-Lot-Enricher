import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
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

  return NextResponse.json(item);
}

export async function PUT(
  request: NextRequest,
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
      { error: "Only ENRICHED items can be edited" },
      { status: 409 }
    );
  }

  const body = await request.json();

  const updated = await prisma.enrichedItem.update({
    where: { id },
    data: {
      enrichedTitle: body.enrichedTitle ?? item.enrichedTitle,
      enrichedDesc: body.enrichedDesc ?? item.enrichedDesc,
      photoCaption: body.photoCaption ?? item.photoCaption,
      suggestedValue: body.suggestedValue ?? item.suggestedValue,
    },
  });

  return NextResponse.json(updated);
}
