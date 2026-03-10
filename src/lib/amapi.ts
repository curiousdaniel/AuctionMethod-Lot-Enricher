export interface AMAuction {
  id: string;
  title: string;
  description: string;
  starts: string;
  ends: string;
  status: string;
  archived: string;
  items?: AMItem[];
  [key: string]: unknown;
}

export interface AMItem {
  id: string;
  auction_id?: string;
  title: string;
  description: string;
  lot_number: string;
  lead_image: string | false;
  lead_image_thumb: string | false;
  images?: { url: string; thumb_url: string }[];
  [key: string]: unknown;
}

export interface AMItemPatch {
  title: string;
  description: string;
}

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

function getBaseUrl(): string {
  const domain = process.env.AM_DOMAIN;
  if (!domain) throw new Error("AM_DOMAIN environment variable is not set");
  return `https://${domain}`;
}

function imageUrlsFromItem(item: AMItem): string[] {
  const baseUrl = getBaseUrl();
  const urls: string[] = [];

  if (item.images && Array.isArray(item.images) && item.images.length > 0) {
    for (const img of item.images) {
      if (img.url) urls.push(img.url.startsWith("http") ? img.url : `${baseUrl}/${img.url}`);
    }
  }

  if (urls.length === 0 && item.lead_image && typeof item.lead_image === "string") {
    urls.push(item.lead_image.startsWith("http") ? item.lead_image : `${baseUrl}/${item.lead_image}`);
  }

  return urls;
}

export function getItemImageUrls(item: AMItem): string[] {
  return imageUrlsFromItem(item);
}

export async function amAuth(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const email = process.env.AM_EMAIL;
  const password = process.env.AM_PASSWORD;
  if (!email || !password) {
    throw new Error("AM_EMAIL and AM_PASSWORD environment variables are required");
  }

  const res = await fetch(`${getBaseUrl()}/amapi/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AM API auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  console.log("[AM API] Auth response keys:", Object.keys(data));
  cachedToken = data.token ?? data.access_token ?? data.bearer;
  if (!cachedToken) {
    throw new Error(
      `AM API auth response did not contain a token. Keys received: ${Object.keys(data).join(", ")}`
    );
  }

  tokenExpiresAt = Date.now() + 20 * 60 * 60 * 1000;
  return cachedToken;
}

async function amFetch(path: string, options: RequestInit = {}): Promise<Response> {
  let token = await amAuth();

  const res = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    cachedToken = null;
    tokenExpiresAt = 0;
    token = await amAuth();

    return fetch(`${getBaseUrl()}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });
  }

  return res;
}

export interface RawAuctionsPage {
  raw: AMAuction[];
  filtered: AMAuction[];
}

export async function getAuctionsPage(
  offset: number = 0,
  limit: number = 50
): Promise<RawAuctionsPage> {
  const res = await amFetch(`/amapi/admin/auctions?offset=${offset}&limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch auctions (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const auctions: AMAuction[] = Array.isArray(data) ? data : data.auctions ?? data.data ?? [];

  console.log(`[AM API] Raw auctions page: offset=${offset}, got ${auctions.length} auctions`);
  if (auctions.length > 0 && offset === 0) {
    console.log("[AM API] First auction:", JSON.stringify({
      id: auctions[0].id,
      title: auctions[0].title,
      status: auctions[0].status,
      archived: auctions[0].archived,
      starts: auctions[0].starts,
      ends: auctions[0].ends,
    }));
  }

  const now = new Date();
  const filtered = auctions.filter((a) => {
    // AM API uses status "1" for active auctions
    const isActive = a.status === "1" || a.status === "active";
    const isNotArchived = a.archived !== "1";

    const ends = a.ends ? new Date(a.ends) : null;
    const hasNotEnded = !ends || ends > now;

    const passes = isActive && isNotArchived && hasNotEnded;
    if (!passes) {
      console.log(
        `[AM API] Skipped auction ${a.id} "${a.title}" — status: ${a.status}, archived: ${a.archived}, ends: ${a.ends}, ended: ${ends && ends <= now}`
      );
    }
    return passes;
  });

  console.log(`[AM API] After filtering: ${filtered.length} of ${auctions.length} kept`);
  return { raw: auctions, filtered };
}

export async function getAllActiveAuctions(): Promise<AMAuction[]> {
  const all: AMAuction[] = [];
  let offset = 0;
  const limit = 50;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await getAuctionsPage(offset, limit);
    all.push(...page.filtered);
    if (page.raw.length < limit) break;
    offset += limit;
  }

  console.log(`[AM API] Total active auctions across all pages: ${all.length}`);
  return all;
}

export async function getItems(
  auctionId: number,
  offset: number = 0,
  limit: number = 50
): Promise<AMItem[]> {
  const res = await amFetch(
    `/amapi/admin/items?auction=${auctionId}&offset=${offset}&limit=${limit}`
  );
  if (!res.ok) {
    throw new Error(
      `Failed to fetch items for auction ${auctionId} (${res.status}): ${await res.text()}`
    );
  }

  const data = await res.json();
  const items: AMItem[] = Array.isArray(data) ? data : data.items ?? data.data ?? [];

  console.log(`[AM API] Items for auction ${auctionId}: got ${items.length}`);
  if (items.length > 0) {
    console.log("[AM API] Sample item keys:", Object.keys(items[0]).join(", "));
  }

  return items.map((item) => ({
    ...item,
    auction_id: item.auction_id ?? String(auctionId),
  }));
}

export async function getAllItems(auctionId: number): Promise<AMItem[]> {
  const all: AMItem[] = [];
  let offset = 0;
  const limit = 50;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await getItems(auctionId, offset, limit);
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return all;
}

export async function getItem(auctionId: number, itemId: number): Promise<AMItem> {
  const res = await amFetch(`/amapi/admin/items/auction/${auctionId}/item/${itemId}`);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch item ${itemId} from auction ${auctionId} (${res.status}): ${await res.text()}`
    );
  }

  const data = await res.json();
  const item = data.item ?? data;
  return { ...item, auction_id: item.auction_id ?? String(auctionId) };
}

export async function updateItem(
  auctionId: number,
  itemId: number,
  patch: Partial<AMItemPatch>
): Promise<void> {
  const res = await amFetch(`/amapi/admin/items/auction/${auctionId}/item/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    throw new Error(
      `Failed to update item ${itemId} in auction ${auctionId} (${res.status}): ${await res.text()}`
    );
  }
}
