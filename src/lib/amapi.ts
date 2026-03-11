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
  images?: string[];
  picture_count?: number;
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

export function getItemImageUrls(item: AMItem): string[] {
  const baseUrl = getBaseUrl();
  const urls: string[] = [];

  if (item.images && Array.isArray(item.images) && item.images.length > 0) {
    for (const img of item.images) {
      if (typeof img === "string" && img) {
        urls.push(img.startsWith("http") ? img : `${baseUrl}/${img}`);
      } else if (typeof img === "object" && img !== null) {
        const imgObj = img as Record<string, unknown>;
        const url = (imgObj.url ?? imgObj.image_url ?? imgObj.src) as string | undefined;
        if (url) {
          urls.push(url.startsWith("http") ? url : `${baseUrl}/${url}`);
        }
      }
    }
  }

  if (urls.length === 0 && item.lead_image && typeof item.lead_image === "string") {
    urls.push(item.lead_image.startsWith("http") ? item.lead_image : `${baseUrl}/${item.lead_image}`);
  }

  return urls;
}

export function clearTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
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

  console.log("[AM API] Authenticating fresh...");
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
  console.log("[AM API] Auth response keys:", Object.keys(data), "status:", data.status);
  cachedToken = data.token ?? data.access_token ?? data.bearer;
  if (!cachedToken) {
    throw new Error(
      `AM API auth response did not contain a token. Keys received: ${Object.keys(data).join(", ")}`
    );
  }

  tokenExpiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes
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
    console.log(`[AM API] Got 401 on ${path}, re-authenticating...`);
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

  const now = new Date();
  const filtered = auctions.filter((a) => {
    const isActive = a.status === "1" || a.status === "active";
    const isNotArchived = a.archived !== "1";
    const ends = a.ends ? new Date(a.ends) : null;
    const hasNotEnded = !ends || ends > now;
    return isActive && isNotArchived && hasNotEnded;
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
  const path = `/amapi/admin/items/auction/${auctionId}?limit=${limit}&offset=${offset}`;
  console.log(`[AM API] Fetching items: ${path}`);

  const res = await amFetch(path);

  if (!res.ok) {
    const text = await res.text();
    console.log(`[AM API] Items endpoint for auction ${auctionId} returned ${res.status}: ${text.substring(0, 500)}`);
    return [];
  }

  const data = await res.json();
  console.log(`[AM API] Items response keys: ${JSON.stringify(Object.keys(data))}`);
  if (data.data) {
    console.log(`[AM API] Items data keys: ${JSON.stringify(Object.keys(data.data))}`);
  }

  const items: AMItem[] = data?.data?.items ?? data?.items ?? (Array.isArray(data) ? data : []);

  console.log(`[AM API] Items for auction ${auctionId}: got ${items.length}`);
  if (items.length > 0) {
    const sample = items[0];
    console.log(`[AM API] Sample item id=${sample.id}, title="${sample.title}"`);
    console.log(`[AM API] Sample item images field: ${JSON.stringify(sample.images)}`);
    console.log(`[AM API] Sample item picture_count: ${sample.picture_count}`);
    console.log(`[AM API] Sample item lead_image: ${JSON.stringify(sample.lead_image)}`);
    console.log(`[AM API] Resolved URLs: ${JSON.stringify(getItemImageUrls(sample))}`);
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
  const item = data?.data?.items?.[0] ?? data?.item ?? data;
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
