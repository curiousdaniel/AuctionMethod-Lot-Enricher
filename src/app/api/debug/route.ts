import { NextResponse } from "next/server";
import { getItems, getItemImageUrls, type AMItem } from "@/lib/amapi";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const domain = process.env.AM_DOMAIN;
  const email = process.env.AM_EMAIL;
  const password = process.env.AM_PASSWORD;

  if (!domain || !email || !password) {
    return NextResponse.json({
      error: "Missing env vars",
      AM_DOMAIN: domain ? "set" : "MISSING",
      AM_EMAIL: email ? "set" : "MISSING",
      AM_PASSWORD: password ? "set" : "MISSING",
    }, { status: 500 });
  }

  const baseUrl = `https://${domain}`;
  const results: Record<string, unknown> = {
    config: {
      domain,
      email,
      passwordLength: password.length,
      passwordPreview: password.substring(0, 3) + "***",
    },
  };

  // Step 1: Authenticate directly
  try {
    const authRes = await fetch(`${baseUrl}/amapi/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const authText = await authRes.text();
    let authData: Record<string, unknown> | null = null;
    try { authData = JSON.parse(authText); } catch { /* not json */ }

    results.auth = {
      httpStatus: authRes.status,
      responseStatus: authData?.status,
      responseMessage: authData?.message,
      hasToken: !!(authData?.token),
      tokenLength: typeof authData?.token === "string" ? (authData.token as string).length : 0,
      tokenPreview: typeof authData?.token === "string" ? (authData.token as string).substring(0, 20) + "..." : null,
      responseKeys: authData ? Object.keys(authData) : null,
      rawPreview: !authData ? authText.substring(0, 300) : undefined,
    };

    if (!authData?.token) {
      results.conclusion = "Auth failed — no token returned. Check AM_EMAIL and AM_PASSWORD.";
      return NextResponse.json(results);
    }

    const token = authData.token as string;

    // Step 2: Test auctions endpoint with fresh token
    const auctionsRes = await fetch(`${baseUrl}/amapi/admin/auctions?offset=0&limit=5`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const auctionsText = await auctionsRes.text();
    let auctionsData: Record<string, unknown> | null = null;
    try { auctionsData = JSON.parse(auctionsText); } catch { /* not json */ }

    results.auctionsEndpoint = {
      httpStatus: auctionsRes.status,
      responseStatus: auctionsData?.status,
      responseMessage: auctionsData?.message,
      auctionCount: Array.isArray(auctionsData?.auctions) ? (auctionsData.auctions as unknown[]).length : 0,
      rawPreview: auctionsRes.status !== 200 ? auctionsText.substring(0, 300) : undefined,
    };

    if (auctionsRes.status !== 200) {
      results.conclusion = `Auctions endpoint returned ${auctionsRes.status}. Token may not have admin privileges.`;
      return NextResponse.json(results);
    }

    // Step 3: Test items endpoint with same token
    const itemsRes = await fetch(`${baseUrl}/amapi/admin/items/auction/36?limit=5&offset=0`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    const itemsText = await itemsRes.text();
    let itemsData: Record<string, unknown> | null = null;
    try { itemsData = JSON.parse(itemsText); } catch { /* not json */ }

    results.itemsEndpointDirect = {
      httpStatus: itemsRes.status,
      responseStatus: itemsData?.status,
      responseMessage: itemsData?.message,
      responseKeys: itemsData ? Object.keys(itemsData) : null,
      rawPreview: itemsText.substring(0, 500),
    };

    // Step 4: Also test via the getItems() function (uses amFetch with retry)
    try {
      const itemsViaFunction = await getItems(36);
      results.itemsViaGetItems = {
        count: itemsViaFunction.length,
        sample: itemsViaFunction.length > 0 ? {
          id: itemsViaFunction[0].id,
          title: itemsViaFunction[0].title,
          images: itemsViaFunction[0].images,
          picture_count: itemsViaFunction[0].picture_count,
          lead_image: itemsViaFunction[0].lead_image,
          resolvedUrls: getItemImageUrls(itemsViaFunction[0] as AMItem),
        } : null,
      };
    } catch (e) {
      results.itemsViaGetItems = { error: e instanceof Error ? e.message : String(e) };
    }

    // Step 5: Check embedded items from auction 36
    const allAuctionsRes = await fetch(`${baseUrl}/amapi/admin/auctions?offset=0&limit=50`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    });
    if (allAuctionsRes.ok) {
      const allData = await allAuctionsRes.json();
      const auctions = allData.auctions ?? [];
      const a36 = auctions.find((a: Record<string, unknown>) => String(a.id) === "36");
      if (a36) {
        const embeddedItems: AMItem[] = a36.items ?? [];
        results.embeddedFromAuction36 = {
          found: true,
          title: a36.title,
          itemCount: embeddedItems.length,
          sample: embeddedItems.length > 0 ? {
            id: embeddedItems[0].id,
            title: embeddedItems[0].title,
            lead_image: embeddedItems[0].lead_image,
            images: embeddedItems[0].images,
            resolvedUrls: getItemImageUrls(embeddedItems[0]),
          } : null,
        };
      } else {
        results.embeddedFromAuction36 = { found: false, note: "Auction 36 not in response" };
      }
    }

    // Step 6: DB state
    results.dbItems = await prisma.enrichedItem.findMany({
      where: { auctionId: 36 },
      take: 5,
      orderBy: { id: "asc" },
      select: { id: true, itemId: true, rawTitle: true, rawImageUrls: true, status: true },
    });

  } catch (err) {
    results.fatalError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(results);
}
