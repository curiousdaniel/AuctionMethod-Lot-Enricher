import { NextResponse } from "next/server";
import { amAuth, getItems, getItemImageUrls, getAllActiveAuctions, type AMItem } from "@/lib/amapi";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
    results.error = "Missing required env vars";
    return NextResponse.json(results, { status: 500 });
  }

  // Step 1: Auth (uses automatic retry)
  try {
    const token = await amAuth();
    results.auth = { ok: true, tokenLength: token.length };
  } catch (e) {
    results.auth = { ok: false, error: e instanceof Error ? e.message : String(e) };
    return NextResponse.json(results);
  }

  // Step 2: Auctions (uses amFetch with auto-renewal on 401)
  try {
    const auctions = await getAllActiveAuctions();
    const a36 = auctions.find((a) => String(a.id) === "36");
    const embeddedItems: AMItem[] = a36?.items ?? [];

    results.auctions = {
      activeCount: auctions.length,
      auction36: a36 ? {
        title: a36.title,
        ends: a36.ends,
        embeddedItemCount: embeddedItems.length,
        embeddedSample: embeddedItems.length > 0 ? {
          id: embeddedItems[0].id,
          title: embeddedItems[0].title,
          lead_image: embeddedItems[0].lead_image,
          images: embeddedItems[0].images,
          resolvedUrls: getItemImageUrls(embeddedItems[0]),
        } : null,
      } : "not found",
    };
  } catch (e) {
    results.auctions = { error: e instanceof Error ? e.message : String(e) };
  }

  // Step 3: Items endpoint (uses amFetch with auto-renewal on 401)
  try {
    const items = await getItems(36);
    results.itemsEndpoint = {
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
    results.itemsEndpoint = { error: e instanceof Error ? e.message : String(e) };
  }

  // Step 4: DB state
  try {
    results.dbItems = await prisma.enrichedItem.findMany({
      where: { auctionId: 36 },
      take: 5,
      orderBy: { id: "asc" },
      select: { id: true, itemId: true, rawTitle: true, rawImageUrls: true, status: true },
    });
  } catch (e) {
    results.dbItems = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(results);
}
