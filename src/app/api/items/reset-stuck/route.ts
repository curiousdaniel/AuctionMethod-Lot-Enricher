import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST() {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const result = await prisma.enrichedItem.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: tenMinutesAgo },
    },
    data: {
      status: "PENDING",
    },
  });

  return NextResponse.json({
    message: `Reset ${result.count} stuck items back to PENDING`,
    count: result.count,
  });
}
