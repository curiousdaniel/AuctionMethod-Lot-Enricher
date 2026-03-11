import { NextResponse } from "next/server";
import { clearTokenCache, amAuth, getItems, getItemImageUrls, getAllActiveAuctions, type AMItem } from "@/lib/amapi";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const domain = process.env.AM_DOMAIN;
  if (!domain) {
    return NextResponse.json({ error: "AM_DOMAIN not set" }, { status: 500 });
  }

  try {
    // Force fresh auth
    clearTokenCache();
    const token = await amAuth();
    console.log("[Debug] Got fresh token, length:", token.length);

    // 1. Get active auctions using proper amFetch flow
    const auctions = await getAllActiveAuctions();
    const testAuction = auctions.find((a) => String(a.id) === "36");

    // 2. Get embedded items from auction 36
    const embeddedItems: AMItem[] = testAuction?.items ?? [];
    const embeddedSample = embeddedItems.length > 0 ? {
      id: embeddedItems[0].id,
      title: embeddedItems[0].title,
      lead_image: embeddedItems[0].lead_image,
      images: embeddedItems[0].images,
      resolvedUrls: getItemImageUrls(embeddedItems[0]),
    } : null;

    // 3. Fetch items via proper items endpoint (uses amFetch with 401 retry)
    const itemsFromEndpoint = await getItems(36);
    const endpointSample = itemsFromEndpoint.length > 0 ? {
      id: itemsFromEndpoint[0].id,
      title: itemsFromEndpoint[0].title,
      lead_image: itemsFromEndpoint[0].lead_image,
      images: itemsFromEndpoint[0].images,
      picture_count: itemsFromEndpoint[0].picture_count,
      resolvedUrls: getItemImageUrls(itemsFromEndpoint[0]),
      allImageKeys: Object.keys(itemsFromEndpoint[0]).filter(
        (k) => /image|photo|img|picture|media/i.test(k)
      ),
    } : null;

    // 4. DB state
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
      },
    });

    return NextResponse.json({
      activeAuctions: auctions.length,
      auction36Found: !!testAuction,
      embedded: {
        itemCount: embeddedItems.length,
        sample: embeddedSample,
      },
      itemsEndpoint: {
        itemCount: itemsFromEndpoint.length,
        sample: endpointSample,
      },
      dbItems,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      { status: 500 }
    );
  }
}
