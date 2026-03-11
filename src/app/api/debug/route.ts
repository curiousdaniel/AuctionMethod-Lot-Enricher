import { NextResponse } from "next/server";
import { amAuth, getItems, getItemImageUrls, type AMItem } from "@/lib/amapi";
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

  // Step 1: Auth
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

  // Step 2: Raw test of auctions endpoint (shows HTTP status, content-type, raw body)
  results.auctionsRaw = await safeFetch(
    `${baseUrl}/amapi/admin/auctions?offset=0&limit=5`,
    authHeaders
  );

  // Step 3: Raw test of items endpoint for auction 36
  results.itemsRaw = await safeFetch(
    `${baseUrl}/amapi/admin/items/auction/36?limit=5&offset=0`,
    authHeaders
  );

  // Step 4: Test items via the getItems() function (amFetch with auto-retry)
  try {
    const items = await getItems(36);
    results.itemsViaFunction = {
      count: items.length,
      sample: items.length > 0 ? {
        id: items[0].id,
        title: items[0].title,
        images: items[0].images,
        picture_count: items[0].picture_count,
        lead_image: items[0].lead_image,
        resolvedUrls: getItemImageUrls(items[0] as AMItem),
      } : null,
    };
  } catch (e) {
    results.itemsViaFunction = { error: e instanceof Error ? e.message : String(e) };
  }

  // Step 5: Also try a different auction that might have items
  try {
    const items33 = await getItems(33);
    const items35 = await getItems(35);
    results.otherAuctions = {
      auction33: { count: items33.length },
      auction35: { count: items35.length },
    };
  } catch (e) {
    results.otherAuctions = { error: e instanceof Error ? e.message : String(e) };
  }

  // Step 6: DB state
  try {
    const total = await prisma.enrichedItem.count();
    const items = await prisma.enrichedItem.findMany({
      take: 5,
      orderBy: { id: "asc" },
      select: { id: true, auctionId: true, itemId: true, rawTitle: true, rawImageUrls: true, status: true },
    });
    results.db = { totalItems: total, sample: items };
  } catch (e) {
    results.db = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}
