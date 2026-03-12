import { NextResponse } from "next/server";
import { amAuth, getItems, getItem, getItemImageUrls, type AMItem } from "@/lib/amapi";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function safeFetch(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  let json = null;
  if (contentType.includes("application/json")) {
    try { json = JSON.parse(text); } catch { /* not valid json */ }
  }

  return {
    httpStatus: res.status,
    contentType,
    isJson: json !== null,
    json,
    textPreview: text.substring(0, 500),
    redirected: res.redirected,
    finalUrl: res.url,
  };
}

export async function GET() {
  const domain = process.env.AM_DOMAIN;
  const email = process.env.AM_EMAIL;
  const password = process.env.AM_PASSWORD;

  const results: Record<string, unknown> = {
    config: {
      AM_DOMAIN: domain ?? "MISSING",
      AM_EMAIL: email ?? "MISSING",
      AM_PASSWORD: password ? `${password.substring(0, 3)}*** (${password.length} chars)` : "MISSING",
    },
  };

  if (!domain || !email || !password) {
    return NextResponse.json(results, { status: 500 });
  }

  const baseUrl = `https://${domain}`;

  let token: string;
  try {
    token = await amAuth();
    results.auth = { ok: true, tokenLength: token.length, tokenPreview: token.substring(0, 20) + "..." };
  } catch (e) {
    results.auth = { ok: false, error: e instanceof Error ? e.message : String(e) };
    return NextResponse.json(results);
  }

  const authHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
  };

  // Test bulk auctions endpoint
  results.auctionsRaw = await safeFetch(
    `${baseUrl}/amapi/admin/auctions?offset=0&limit=5`,
    authHeaders
  );

  // Test bulk items endpoint for first available auction
  let testAuctionId = 37;
  let testItemId: number | null = null;

  try {
    const bulkItems = await getItems(testAuctionId);
    if (bulkItems.length === 0) {
      const scans = await prisma.auctionScan.findMany({ take: 1, orderBy: { lastScannedAt: "desc" } });
      if (scans.length > 0) {
        testAuctionId = scans[0].auctionId;
        const retryItems = await getItems(testAuctionId);
        if (retryItems.length > 0) testItemId = parseInt(String(retryItems[0].id), 10);
        results.bulkItemsEndpoint = {
          auctionId: testAuctionId,
          count: retryItems.length,
          sample: retryItems.length > 0 ? {
            id: retryItems[0].id,
            title: retryItems[0].title,
            images: retryItems[0].images,
            picture_count: retryItems[0].picture_count,
            lead_image: retryItems[0].lead_image,
            resolvedUrls: getItemImageUrls(retryItems[0] as AMItem),
            allKeys: Object.keys(retryItems[0]),
          } : null,
        };
      }
    } else {
      testItemId = parseInt(String(bulkItems[0].id), 10);
      results.bulkItemsEndpoint = {
        auctionId: testAuctionId,
        count: bulkItems.length,
        sample: {
          id: bulkItems[0].id,
          title: bulkItems[0].title,
          images: bulkItems[0].images,
          picture_count: bulkItems[0].picture_count,
          lead_image: bulkItems[0].lead_image,
          resolvedUrls: getItemImageUrls(bulkItems[0] as AMItem),
          allKeys: Object.keys(bulkItems[0]),
        },
      };
    }
  } catch (e) {
    results.bulkItemsEndpoint = { error: e instanceof Error ? e.message : String(e) };
  }

  // Test SINGLE item endpoint (this is the one that should return full images)
  if (testItemId) {
    try {
      const singleItem = await getItem(testAuctionId, testItemId);
      const resolvedUrls = getItemImageUrls(singleItem);
      results.singleItemEndpoint = {
        auctionId: testAuctionId,
        itemId: testItemId,
        allKeys: Object.keys(singleItem),
        title: singleItem.title,
        images: singleItem.images,
        imagesType: typeof singleItem.images,
        imagesIsArray: Array.isArray(singleItem.images),
        picture_count: singleItem.picture_count,
        lead_image: singleItem.lead_image,
        resolvedUrls,
        resolvedCount: resolvedUrls.length,
      };
    } catch (e) {
      results.singleItemEndpoint = { error: e instanceof Error ? e.message : String(e) };
    }

    // Also show raw response from single-item endpoint
    results.singleItemRaw = await safeFetch(
      `${baseUrl}/amapi/admin/items/auction/${testAuctionId}/item/${testItemId}`,
      authHeaders
    );
  } else {
    results.singleItemEndpoint = { skipped: "No test item found" };
  }

  // DB state
  try {
    const statusCounts = await prisma.enrichedItem.groupBy({ by: ["status"], _count: true });
    const items = await prisma.enrichedItem.findMany({
      take: 5,
      orderBy: { id: "asc" },
      select: {
        id: true, auctionId: true, itemId: true, rawTitle: true,
        rawImageUrls: true, status: true, enrichedAt: true,
      },
    });
    results.db = {
      statusCounts: Object.fromEntries(statusCounts.map(s => [s.status, s._count])),
      sampleItems: items.map(i => ({
        ...i,
        imageCount: i.rawImageUrls.length,
        rawImageUrls: i.rawImageUrls.slice(0, 3),
      })),
    };
  } catch (e) {
    results.db = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}
