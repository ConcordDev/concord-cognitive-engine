/**
 * Artistry marketplace GETs return `{ ok, beats|samples|stems, total }`.
 * The music desk used to treat that object as the row list (`listings || body`),
 * then call `.map` on it. These readers only accept a real array, and they
 * coerce tags / licenses / ids into the shape the desk renders.
 */

export interface MarketplaceLicense {
  tier: string;
  price: number;
  currency: string;
}

export interface MarketplaceBeatRow {
  listingId: string;
  title: string;
  assetId: string;
  bpm: number;
  key: string;
  genre: string;
  tags: string[];
  licenses: MarketplaceLicense[];
  ownerId: string;
  ownerName?: string;
  previewAssetId?: string;
  totalSales: number;
  totalPlays: number;
  createdAt: string;
  status: string;
}

export interface MarketplaceSampleRow {
  listingId: string;
  title: string;
  assetIds: string[];
  sampleCount: number;
  genre: string;
  tags: string[];
  price: number;
  description: string;
  ownerId: string;
  ownerName?: string;
  createdAt: string;
  status: string;
}

export interface MarketplaceStemRow {
  listingId: string;
  title: string;
  assetIds: string[];
  parentTrackId: string;
  genre: string;
  tags: string[];
  price: number;
  ownerId: string;
  ownerName?: string;
  createdAt: string;
  status: string;
}

function finite(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => item != null && item !== '').map((item) => String(item));
  }
  if (typeof value === 'string') {
    return value.split(',').map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

export function asLicenseList(value: unknown): MarketplaceLicense[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const row = asRecord(item);
      if (!row) return [];
      return [{
        tier: String(row.tier || row.name || 'license'),
        price: finite(row.price),
        currency: typeof row.currency === 'string' ? row.currency : 'USD',
      }];
    });
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).map(([tier, raw]) => {
    const row = asRecord(raw) || {};
    return {
      tier,
      price: finite(row.price),
      currency: typeof row.currency === 'string' ? row.currency : 'USD',
    };
  });
}

function rowsFrom(body: unknown, key: string): unknown[] {
  if (Array.isArray(body)) return body;
  const record = asRecord(body);
  if (!record) return [];
  if (Array.isArray(record[key])) return record[key] as unknown[];
  if (Array.isArray(record.listings)) return record.listings as unknown[];
  return [];
}

export function asBeatListings(body: unknown): MarketplaceBeatRow[] {
  return rowsFrom(body, 'beats').flatMap((raw) => {
    const row = asRecord(raw);
    if (!row) return [];
    const listingId = String(row.listingId || row.id || '');
    if (!listingId) return [];
    return [{
      listingId,
      title: String(row.title || 'Untitled'),
      assetId: row.assetId == null ? '' : String(row.assetId),
      bpm: finite(row.bpm),
      key: row.key == null ? '' : String(row.key),
      genre: row.genre == null ? '' : String(row.genre),
      tags: asStringList(row.tags),
      licenses: asLicenseList(row.licenses),
      ownerId: row.ownerId == null ? '' : String(row.ownerId),
      ownerName: row.ownerName == null ? undefined : String(row.ownerName),
      previewAssetId: row.previewAssetId == null ? undefined : String(row.previewAssetId),
      totalSales: finite(row.totalSales),
      totalPlays: finite(row.totalPlays),
      createdAt: row.createdAt == null ? '' : String(row.createdAt),
      status: row.status == null ? '' : String(row.status),
    }];
  });
}

export function asSampleListings(body: unknown): MarketplaceSampleRow[] {
  return rowsFrom(body, 'samples').flatMap((raw) => {
    const row = asRecord(raw);
    if (!row) return [];
    const listingId = String(row.listingId || row.id || '');
    if (!listingId) return [];
    return [{
      listingId,
      title: String(row.title || 'Untitled'),
      assetIds: asStringList(row.assetIds),
      sampleCount: finite(row.sampleCount),
      genre: row.genre == null ? '' : String(row.genre),
      tags: asStringList(row.tags),
      price: finite(row.price),
      description: row.description == null ? '' : String(row.description),
      ownerId: row.ownerId == null ? '' : String(row.ownerId),
      ownerName: row.ownerName == null ? undefined : String(row.ownerName),
      createdAt: row.createdAt == null ? '' : String(row.createdAt),
      status: row.status == null ? '' : String(row.status),
    }];
  });
}

export function asStemListings(body: unknown): MarketplaceStemRow[] {
  return rowsFrom(body, 'stems').flatMap((raw) => {
    const row = asRecord(raw);
    if (!row) return [];
    const listingId = String(row.listingId || row.id || '');
    if (!listingId) return [];
    return [{
      listingId,
      title: String(row.title || 'Untitled'),
      assetIds: asStringList(row.assetIds),
      parentTrackId: row.parentTrackId == null ? '' : String(row.parentTrackId),
      genre: row.genre == null ? '' : String(row.genre),
      tags: asStringList(row.tags),
      price: finite(row.price),
      ownerId: row.ownerId == null ? '' : String(row.ownerId),
      ownerName: row.ownerName == null ? undefined : String(row.ownerName),
      createdAt: row.createdAt == null ? '' : String(row.createdAt),
      status: row.status == null ? '' : String(row.status),
    }];
  });
}
