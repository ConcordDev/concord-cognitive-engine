/**
 * The Auction House client. Every call is a real macro in the `market` domain
 * (server/domains/market-house.js, market-showcase.js, market-board.js) through
 * /api/lens/run. A signed-out visitor reads the public window through
 * GET /api/market/house/public/:name, which serves only the read handlers.
 * Shapes list only fields the server returns.
 */

import { lensRun } from '@/lib/api/client';

export type Envelope<T> = { ok: true; result: T } | { ok: false; error: string; message: string };

const PUBLIC = new Set(['house-terms', 'house-catalogue', 'house-lot', 'house-trending', 'house-showcase', 'house-showcase-draw', 'board-list', 'board-get']);

let visitor = false;
/** A signed-out visitor reads through the public window and never reaches the member path (which would open the sign-up gate). */
export function setVisitor(v: boolean) { visitor = v; }

export async function house<T>(action: string, input: Record<string, unknown> = {}): Promise<Envelope<T>> {
  if (visitor) return PUBLIC.has(action) ? publicRead<T>(action, input) : { ok: false, error: 'auth_required', message: 'Sign in to do that.' };
  try {
    const r = await lensRun<T>('market', action, input);
    const d = r.data;
    if (!d?.ok) {
      const error = String(d?.error || d?.code || 'failed');
      if (PUBLIC.has(action) && (d?.code === 'AUTH_REQUIRED' || error === 'Unauthorized')) return publicRead<T>(action, input);
      return { ok: false, error, message: friendly(error, d?.message || null) };
    }
    return { ok: true, result: (d.result ?? ({} as T)) as T };
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 401 && PUBLIC.has(action)) return publicRead<T>(action, input);
    return { ok: false, error: 'network', message: (e as Error)?.message || 'The request did not reach the house.' };
  }
}

async function publicRead<T>(action: string, input: Record<string, unknown>): Promise<Envelope<T>> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) if (v != null && v !== '' && v !== false) q.set(k, String(v));
  try {
    const res = await fetch(`/api/market/house/public/${action}?${q.toString()}`, { credentials: 'include' });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; error?: string; message?: string };
    if (!d.ok) return { ok: false, error: d.error || 'failed', message: friendly(d.error || 'failed', d.message || null) };
    return { ok: true, result: d.result as T };
  } catch (e) {
    return { ok: false, error: 'network', message: (e as Error)?.message || 'The request did not reach the house.' };
  }
}

const FRIENDLY: Record<string, string> = {
  auth_required: 'Sign in to do that.',
  AUTH_REQUIRED: 'Sign in to do that.',
  Unauthorized: 'Sign in to do that.',
  insufficient_balance: 'Your balance is too low for this.',
  lot_not_found: 'This lot is no longer for sale.',
  already_owned: 'You already own this lot.',
  cannot_buy_own_listing: 'This is your own lot.',
  duplicate_content: 'This DTU is already on sale.',
  not_owner: 'You can only use DTUs you made.',
  bought_copy: 'A copy you bought is not yours to sell or submit.',
  invalid_price: 'Prices are 0 (free) or from 0.01 CC.',
  invalid_license: 'Choose a licence.',
  exclusive_needs_price: 'An exclusive lot sells once, so it needs a price.',
  cover_not_image: 'A cover must be a PNG, JPEG or WebP image.',
  cover_not_found: 'Upload the cover again.',
  no_active_lot: 'Consign at least one lot first.',
  already_entered: 'You are already entered for the coming hour.',
  own_commission: 'You cannot fill your own request.',
  submissions_closed: 'This request is no longer taking submissions.',
  already_submitted: 'That DTU is already submitted here.',
  checks_failed: 'This submission no longer passes every check.',
  commission_closed: 'This request is already closed.',
  not_commissioner: 'Only the person who posted this can do that.',
  not_purchased: 'Buy this lot to read it in full.',
  not_delivered: 'A submission is delivered when you accept it.',
  network: 'The request did not reach the house.',
};

export function friendly(error: string, message: string | null): string {
  return message || FRIENDLY[error] || error.replace(/_/g, ' ');
}

function csrf(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/csrf_token=([^;]+)/) : null;
  return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
}

/** Upload a cover through the platform artifact route; returns the owned image DTU id. */
export async function uploadCover(file: File, title: string): Promise<Envelope<{ dtuId: string }>> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { ok: false, error: 'cover_type', message: 'Covers must be PNG, JPEG or WebP.' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'cover_size', message: 'Covers must be under 10 MB.' };
  try {
    const res = await fetch('/api/artifact/upload', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name), 'X-Title': encodeURIComponent(`Cover — ${title}`), 'X-Domain': 'market', ...csrf() },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as { dtuId?: string; error?: string };
    if (!res.ok || !body.dtuId) return { ok: false, error: 'cover_upload', message: body.error || 'The cover did not upload.' };
    return { ok: true, result: { dtuId: body.dtuId } };
  } catch (e) {
    return { ok: false, error: 'network', message: (e as Error)?.message || 'The cover did not upload.' };
  }
}

// ── shapes ───────────────────────────────────────────────────────────────

export type Kind = 'dtu' | 'mega_dtu' | 'hyper_dtu' | 'music' | 'art' | 'document' | 'artifact';
export type License = 'personal' | 'nonexclusive' | 'exclusive' | 'cc-by';

export interface Lot {
  id: string; title: string; kind: Kind; price: number; free: boolean; license: License; status: string;
  seller: { id: string; name: string | null }; cover: string | null; domain: string | null; tags: string[];
  excerpt: string; counts: { claims: number; definitions: number; examples: number; words: number } | null;
  tier: string | null; hasFile: boolean; artist: string | null; sold: number; sold24h: number; sold7d: number; listedAt: string;
  windowSales?: number; windowRevenue?: number; lastSaleAt?: string | null; revenue?: number; paid?: number; boughtAt?: string;
}
export interface Facet { value: string; count: number }
export interface Catalogue {
  lots: Lot[]; total: number; page: number; pageSize: number; sort: string; inHouse: number;
  facets: { kind: Facet[]; domain: Facet[]; tag: Facet[]; license: Facet[]; price: { min: number; max: number; free: number } | null };
}
export interface Terms { currency: 'CC'; marketplaceFeeRate: number; universalFeeRate: number; combinedRate: number; example: { price: number; fee: number; sellerNet: number }; licenses: License[]; maxPrice: number; balance: number | null }
export interface LotDetail { lot: Lot; description: string; owned: boolean; isSeller: boolean; royalties: { contentId: string; creator: string; generation: number; rate: number | null }[]; moreFromSeller: Lot[]; terms: Terms; revenue?: number }
export interface OpenDtu { id: string; title: string; summary: string; claims: string[]; definitions: string[]; examples: string[]; tags: string[]; domain: string | null; tier: string; words: number; file: { type: string | null; size: number | null } | null; parents: string[]; createdAt: string | null; fileHref?: string }
export interface MyDtu { id: string; title: string; excerpt: string; tier: string; domain: string | null; tags: string[]; claims: number; words: number; file: { type: string | null } | null; isImage: boolean; listedAs: string | null; createdAt: string | null }
export interface Trending { window: '24h' | '7d'; lots: Lot[]; total: { sales: number; revenue: number } }
export interface Mine { lots: Lot[]; sales: number; gross: number; sellerNet: number; royalties: number; balance: number }
export interface Library { bought: Lot[]; commissioned: { submissionId: string; commissionId: string; title: string; commission: string; creator: string; reward: number; deliveredAt: string }[] }

export interface DrawPerson { id: string; name: string | null }
export interface Draw { hour: string; seed: string; prevSeed: string; eligible: DrawPerson[]; excluded: (DrawPerson & { reason: string; wonAt?: string })[]; winners: (DrawPerson & { lots: Lot[] })[]; drawnAt: string }
export interface Showcase {
  rules: { winnersPerHour: number; cooldownHours: number; formula: string };
  current: Draw | null; next: { hour: string; opensAt: string; entrants: number };
  standing: { entered: boolean; hasActiveLot: boolean; lastWin: string | null; eligibleAgainAt: string | null; canEnter: boolean; reason: string | null } | null;
  recent: { hour: string; seed: string; winners: number; eligible: number }[]; now: string;
}

export interface Criteria { kind?: 'regular' | 'mega' | 'hyper'; domain?: string; tags?: string[]; minClaims?: number; minWords?: number; mustCite?: string; hasFile?: boolean; madeAfterPost?: boolean }
export interface Commission {
  id: string; title: string; brief: string; reward: number; escrowHeld: number; creatorNet: number; criteria: Criteria;
  status: 'open' | 'awarded' | 'cancelled' | 'expired'; poster: { id: string; name: string | null }; mine: boolean;
  deadline: string; acceptBy: string; submissionsOpen: boolean; submissions: number; passing: number; createdAt: string;
  releasedNet: number | null; refunded: number | null;
}
export interface Check { key: string; label: string; pass: boolean; detail: string }
export interface Submission {
  id: string; creator: { id: string; name: string | null };
  dtu: { id: string; title?: string; excerpt?: string; tier?: string; domain?: string | null; tags?: string[]; claims?: number; words?: number; missing?: boolean };
  checks: Check[]; passed: boolean; status: 'submitted' | 'accepted' | 'declined' | 'withdrawn'; note: string | null; createdAt: string;
  commission?: { id: string; title: string; reward: number; status: string };
}

// ── words ────────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<string, string> = { dtu: 'DTU', mega_dtu: 'Mega DTU', hyper_dtu: 'Hyper DTU', music: 'Music', art: 'Image', document: 'Document', artifact: 'With file' };
export const LICENSE_LABEL: Record<License, string> = { personal: 'Personal use', nonexclusive: 'Standard', exclusive: 'Exclusive', 'cc-by': 'CC BY' };
export const LICENSE_TEXT: Record<License, string> = {
  personal: 'For the buyer’s own use. No resale, no redistribution.',
  nonexclusive: 'Use it in your own work and products. Others can buy it too.',
  exclusive: 'Sold once. When it sells, the lot closes for everyone else.',
  'cc-by': 'Anyone may reuse it with credit. Buying supports the maker.',
};

export const cc = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} CC`);
export const price = (l: Pick<Lot, 'free' | 'price'>) => (l.free ? 'Free' : cc(l.price));
/** A lot's catalogue number: the last four characters of its id, so it is stable and unique enough to say aloud. */
export const lotNo = (id: string) => id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (!Number.isFinite(t)) return '';
  const s = Math.round((now - t) / 1000);
  const f = Math.abs(s);
  const w = f < 60 ? 'moments' : f < 3600 ? `${Math.round(f / 60)} min` : f < 86400 ? `${Math.round(f / 3600)} h` : `${Math.round(f / 86400)} d`;
  if (f < 60) return s >= 0 ? 'just now' : 'in moments';
  return s >= 0 ? `${w} ago` : `in ${w}`;
}

export const hourLabel = (key: string) => `${key.slice(11)}:00 UTC`;

/** Redo a drawing in the browser: the same formula the server publishes. */
export async function recheckDraw(hour: string, prevSeed: string, eligibleIds: string[], n: number): Promise<{ seed: string; winners: string[] }> {
  const enc = new TextEncoder();
  const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ids = [...new Set(eligibleIds)].sort();
  const seed = await sha(`concord-house-showcase/1|${hour}|${prevSeed}|${ids.join(',')}`);
  const ranked = await Promise.all(ids.map(async (id) => ({ id, score: await sha(`${seed}|${id}`) })));
  ranked.sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : 0));
  return { seed, winners: ranked.slice(0, n).map((r) => r.id) };
}
