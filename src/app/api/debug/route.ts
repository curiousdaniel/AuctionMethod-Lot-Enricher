import { NextResponse } from "next/server";
import { amAuth } from "@/lib/amapi";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const domain = process.env.AM_DOMAIN;
  if (!domain) {
    return NextResponse.json({ error: "AM_DOMAIN not set" }, { status: 500 });
  }

  try {
    const token = await amAuth();
    const baseUrl = `https://${domain}`;

    const res = await fetch(`${baseUrl}/amapi/admin/auctions?offset=0&limit=50`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await res.json();
    const auctions = data.auctions ?? data.data ?? [];

    // Show a summary of ALL auctions with their key fields
    const auctionSummaries = auctions.map((a: Record<string, unknown>) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      archived: a.archived,
      starts: a.starts,
      ends: a.ends,
      itemCount: Array.isArray(a.items) ? (a.items as unknown[]).length : 0,
    }));

    // Find the test auction (or any with future ends)
    const now = new Date();
    const testAuction = auctions.find(
      (a: Record<string, unknown>) =>
        a.ends && new Date(a.ends as string) > now
    );

    // Show first item from test auction if found
    let sampleItem = null;
    if (testAuction && Array.isArray(testAuction.items) && testAuction.items.length > 0) {
      const item = testAuction.items[0];
      sampleItem = {
        id: item.id,
        title: item.title,
        lot_number: item.lot_number,
        description: item.description,
        lead_image: item.lead_image,
        lead_image_thumb: item.lead_image_thumb,
        image_url: item.image_url,
        thumb_url: item.thumb_url,
        update_and_special_terms: item.update_and_special_terms,
        allKeys: Object.keys(item),
      };
    }

    // Show DB state of error items
    const errorItems = await prisma.enrichedItem.findMany({
      where: { status: "ERROR" },
      take: 3,
      select: {
        id: true,
        itemId: true,
        auctionId: true,
        rawTitle: true,
        rawDescription: true,
        rawImageUrls: true,
        errorMessage: true,
        retryCount: true,
        status: true,
      },
    });

    return NextResponse.json({
      totalAuctions: auctions.length,
      auctionSummaries,
      testAuction: testAuction
        ? { id: testAuction.id, title: testAuction.title, ends: testAuction.ends }
        : null,
      sampleItem,
      errorItemsInDb: errorItems,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
