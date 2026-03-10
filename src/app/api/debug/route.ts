import { NextResponse } from "next/server";
import { amAuth } from "@/lib/amapi";

export const dynamic = "force-dynamic";

export async function GET() {
  const domain = process.env.AM_DOMAIN;
  if (!domain) {
    return NextResponse.json({ error: "AM_DOMAIN not set" }, { status: 500 });
  }

  try {
    const token = await amAuth();
    const baseUrl = `https://${domain}`;

    const res = await fetch(`${baseUrl}/amapi/admin/auctions?offset=0&limit=10`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    const responseText = await res.text();

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      // not JSON
    }

    // If we got auctions, show a summary of the first one
    let sampleAuction = null;
    let auctionCount = 0;
    if (parsed) {
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).auctions ??
          (parsed as Record<string, unknown>).data ??
          [];
      if (Array.isArray(arr)) {
        auctionCount = arr.length;
        sampleAuction = arr[0] ?? null;
      }
    }

    return NextResponse.json({
      authOk: true,
      apiUrl: `${baseUrl}/amapi/admin/auctions?offset=0&limit=10`,
      httpStatus: res.status,
      responseIsJson: parsed !== null,
      auctionCount,
      sampleAuction,
      rawResponsePreview: responseText.substring(0, 2000),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
