import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  const updated = await prisma.enrichedItem.update({
    where: { id },
    data: {
      status: "PENDING",
      errorMessage: null,
      retryCount: 0,
      enrichedAt: null,
      writtenBackAt: null,
      enrichedTitle: null,
      enrichedDesc: null,
      photoCaption: null,
      suggestedValue: null,
      researchNotes: null,
      webSourceUrls: [],
    },
  });

  return NextResponse.json({ message: "Item reset to PENDING", item: updated });
}
