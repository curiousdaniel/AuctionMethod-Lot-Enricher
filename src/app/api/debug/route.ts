import { NextResponse } from "next/server";
import { amAuth, getItemImageUrls, type AMItem } from "@/lib/amapi";
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

    // 1. Get auctions (embedded items have lead_image only)
    const auctionRes = await fetch(`${baseUrl}/amapi/admin/auctions?offset=0&limit=50`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const auctionData = await auctionRes.json();
    const auctions = auctionData.auctions ?? [];
    const testAuction = auctions.find((a: Record<string, unknown>) => String(a.id) === "36");

    // 2. Fetch items via the proper items endpoint (should include full images array)
    const itemsRes = await fetch(`${baseUrl}/amapi/admin/items/auction/36?limit=10&offset=0`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const itemsResText = await itemsRes.text();
    let itemsEndpointData: Record<string, unknown> | null = null;
    try { itemsEndpointData = JSON.parse(itemsResText); } catch { /* not json */ }

    const itemsFromEndpoint = (itemsEndpointData as Record<string, unknown>)?.data
      ? ((itemsEndpointData as Record<string, unknown>).data as Record<string, unknown>)?.items
      : (itemsEndpointData as Record<string, unknown>)?.items;
    const itemsArray = Array.isArray(itemsFromEndpoint) ? itemsFromEndpoint : [];

    // 3. Compare image data from both sources
    const embeddedItems = testAuction?.items ?? [];
    const comparison = [];
    for (let i = 0; i < Math.min(3, Math.max(embeddedItems.length, itemsArray.length)); i++) {
      const embedded = embeddedItems[i] as AMItem | undefined;
      const fromEndpoint = itemsArray[i] as AMItem | undefined;

      comparison.push({
        itemId: embedded?.id ?? fromEndpoint?.id,
        title: embedded?.title ?? fromEndpoint?.title,
        embedded: embedded ? {
          lead_image: embedded.lead_image,
          lead_image_thumb: embedded.lead_image_thumb,
          images: embedded.images,
          resolvedUrls: getItemImageUrls(embedded),
        } : null,
        itemsEndpoint: fromEndpoint ? {
          images: fromEndpoint.images,
          picture_count: fromEndpoint.picture_count,
          lead_image: fromEndpoint.lead_image,
          resolvedUrls: getItemImageUrls(fromEndpoint as AMItem),
        } : null,
      });
    }

    // 4. DB state for this auction
    const dbItems = await prisma.enrichedItem.findMany({
      where: { auctionId: 36 },
      take: 5,
      orderBy: { id: "asc" },
      select: {
        id: true,
        itemId: true,
        rawTitle: true,
        rawImageUrls: true,
        status: true,
        errorMessage: true,
      },
    });

    return NextResponse.json({
      itemsEndpoint: {
        url: `/amapi/admin/items/auction/36?limit=10&offset=0`,
        httpStatus: itemsRes.status,
        totalItems: itemsArray.length,
        rawResponseKeys: itemsEndpointData ? Object.keys(itemsEndpointData) : null,
        dataKeys: itemsEndpointData && typeof (itemsEndpointData as Record<string, unknown>).data === "object"
          ? Object.keys((itemsEndpointData as Record<string, unknown>).data as Record<string, unknown>)
          : null,
      },
      embeddedItemCount: embeddedItems.length,
      imageComparison: comparison,
      dbItems,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
