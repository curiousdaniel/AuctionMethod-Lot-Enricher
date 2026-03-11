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

    // Get auction 36 (DANIEL ENRICHMENT TEST)
    const auctionRes = await fetch(`${baseUrl}/amapi/admin/auctions?offset=0&limit=50`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    const auctionData = await auctionRes.json();
    const auctions = auctionData.auctions ?? [];
    const testAuction = auctions.find((a: Record<string, unknown>) => String(a.id) === "36");

    // Get first item's full data
    let firstItem = null;
    let itemImageFields = null;
    if (testAuction?.items?.[0]) {
      const item = testAuction.items[0];
      firstItem = {
        id: item.id,
        title: item.title,
        lead_image: item.lead_image,
        lead_image_thumb: item.lead_image_thumb,
        image_url: item.image_url,
        thumb_url: item.thumb_url,
        images: item.images,
      };
      // Collect all keys that contain "image" or "photo" or "img"
      itemImageFields = Object.keys(item).filter(
        (k: string) => /image|photo|img|picture|media/i.test(k)
      );
    }

    // Try fetching item images via different endpoints
    const itemId = testAuction?.items?.[0]?.id;
    const endpoints = [
      `/amapi/admin/items/auction/36/item/${itemId}`,
      `/amapi/admin/items/${itemId}/images`,
      `/amapi/admin/items/auction/36/item/${itemId}/images`,
      `/amapi/admin/auctions/36/items/${itemId}/images`,
    ];

    const endpointResults: Record<string, unknown> = {};
    for (const ep of endpoints) {
      try {
        const r = await fetch(`${baseUrl}${ep}`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });
        const text = await r.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* not json */ }
        endpointResults[ep] = {
          status: r.status,
          isJson: parsed !== null,
          preview: parsed
            ? (typeof parsed === "object" && parsed !== null
              ? Object.keys(parsed as Record<string, unknown>)
              : String(parsed).substring(0, 200))
            : text.substring(0, 200),
          // If this is the single item endpoint and it has image data, show it
          ...(parsed && r.ok ? { imageFields: findImageData(parsed) } : {}),
        };
      } catch (e) {
        endpointResults[ep] = { error: String(e) };
      }
    }

    // Check DB state
    const dbItems = await prisma.enrichedItem.findMany({
      where: { auctionId: 36 },
      take: 3,
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
      firstItemFromApi: firstItem,
      itemImageFields,
      endpointResults,
      dbItems,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

function findImageData(obj: unknown): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (/image|photo|img|picture|media|lead_image/i.test(key)) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}
