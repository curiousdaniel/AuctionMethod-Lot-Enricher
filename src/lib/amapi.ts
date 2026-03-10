export interface AMAuction {
  id: number;
  title: string;
  description: string;
  starts: string;
  ends: string;
  published: number;
  status: string;
  [key: string]: unknown;
}

export interface AMItemImage {
  url: string;
  thumb_url: string;
}

export interface AMItem {
  id: number;
  auction_id: number;
  title: string;
  description: string;
  lot_number: string;
  images: AMItemImage[];
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
  cachedToken = data.token ?? data.access_token ?? data.bearer;
  if (!cachedToken) {
    throw new Error("AM API auth response did not contain a token");
  }

  // Cache for 20 hours (tokens last ~24h)
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

  // Re-auth on 401 and retry once
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

export async function getAuctions(
  offset: number = 0,
  limit: number = 50
): Promise<AMAuction[]> {
  const res = await amFetch(`/amapi/admin/auctions?offset=${offset}&limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch auctions (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const auctions: AMAuction[] = Array.isArray(data) ? data : data.auctions ?? data.data ?? [];

  const now = new Date();
  return auctions.filter((a) => {
    const ends = new Date(a.ends);
    return ends > now && (a.published === 1 || a.status === "active" || a.status === "upcoming");
  });
}

export async function getAllActiveAuctions(): Promise<AMAuction[]> {
  const all: AMAuction[] = [];
  let offset = 0;
  const limit = 50;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await getAuctions(offset, limit);
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

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

  return items.map((item) => ({
    ...item,
    auction_id: item.auction_id ?? auctionId,
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
  return { ...data, auction_id: data.auction_id ?? auctionId };
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
