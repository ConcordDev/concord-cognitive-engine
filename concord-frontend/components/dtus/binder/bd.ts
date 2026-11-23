'use client';

/** Shared calls, types and shelf metadata for the Binder. */
import { lensRun } from '@/lib/api/client';

export type Shelf = 'works' | 'specs' | 'documents' | 'knowledge' | 'data' | 'records' | 'parts' | 'system';
export const SHOWN: Shelf[] = ['works', 'specs', 'documents', 'knowledge'];
export const HIDDEN: Shelf[] = ['data', 'records', 'parts', 'system'];
export const SHELF: Record<Shelf, { label: string; one: string; ink: string; blurb: string }> = {
  works: { label: 'Works', one: 'Work', ink: 'var(--bd-works)', blurb: 'Music, art, film, writing, podcasts' },
  specs: { label: 'Specs & designs', one: 'Spec', ink: 'var(--bd-specs)', blurb: 'Engineering, designs, apps, recipes' },
  documents: { label: 'Documents', one: 'Document', ink: 'var(--bd-documents)', blurb: 'PDFs, files, imported text' },
  knowledge: { label: 'Knowledge', one: 'Knowledge', ink: 'var(--bd-knowledge)', blurb: 'Research, claims, explanations' },
  data: { label: 'Data', one: 'Data', ink: 'var(--bd-data)', blurb: 'Live data snapshots' },
  records: { label: 'Records', one: 'Record', ink: 'var(--bd-records)', blurb: 'Your own context: chat memory, notes, till records' },
  parts: { label: 'Parts', one: 'Part', ink: 'var(--bd-parts)', blurb: 'Audio files, covers, product photos' },
  system: { label: 'System', one: 'System', ink: 'var(--bd-system)', blurb: 'Error reports, machine rows' },
};

export interface Design { frame: string; palette: string; accent: string | null; layout: string; typeface: string; subtitle: string | null; coverDtuId: string | null; coverMediaId: string | null }
export interface Card {
  id: string; title: string; summary: string; shelf: Shelf; shelfReason: string; kind: string; domain: string; tier: string;
  image: string | null; design: Design; owner: 'me' | 'someone' | 'system' | null; isMine: boolean; published: boolean;
  check: { outcome: string; checkedAt: string; current: boolean } | null; foil: boolean; needsCheck: boolean;
  cites: number; builtOn: number; createdAt: string | null;
}
export interface Claim { kind: string; checker: string; result: string; detail: string; text: string }
export interface Back {
  claims: string[]; definitions: string[]; body: string | null; tags: string[]; sources: string[];
  receipt: { outcome: string; checkedAt: string; current: boolean; claims: Claim[] } | null;
  parents: { id: string; title: string; shelf: Shelf }[]; children: { id: string; title: string; shelf: Shelf }[];
  publishBlock: { error: string; message: string } | null;
}
export interface Connection { card: Card; score: number; relation: 'linked' | 'shared-source' | 'complement' | 'similar'; reasons: string[]; sharedTerms: string[] }

export interface Res<T> { ok: boolean; result: T | null; error: string | null; message?: string | null }
export async function bd<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  try {
    const r = await lensRun<T>('dtus', action, input);
    const d = r.data as { ok?: boolean; result?: T; error?: string; message?: string } | undefined;
    if (d?.ok) return { ok: true, result: (d.result ?? null) as T | null, error: null };
    return { ok: false, result: null, error: d?.error || 'That did not work.', message: d?.message || null };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : 'That did not work.' };
  }
}

/** A refusal in words a person can act on. */
export const REFUSAL: Record<string, string> = {
  check_required: 'Knowledge is checked before it is published. Run the check on its current text.',
  refuted: 'A claim on this card was shown false. Fix it and check again.',
  check_pending: 'A checker is unavailable right now, so the check has not finished.',
  no_outside_source: 'An empirical claim needs at least one outside source. Add a link under Sources.',
  private_shelf: 'Personal context and system rows are not published.',
};
export const says = (r: { error: string | null; message?: string | null }) => r.message || REFUSAL[String(r.error)] || r.error || 'That did not work.';

/** ?card= is the open card; ?shelf= the shelf; ?scope= mine|library. */
const SAFE = /^[\w:.-]{1,160}$/;
export function readAddress() {
  if (typeof window === 'undefined') return { card: null as string | null, scope: 'mine' as 'mine' | 'library' };
  const q = new URLSearchParams(window.location.search);
  // ?id= is the older link form other lenses use (All, Substrate pulse).
  const card = q.get('card') || q.get('id');
  return { card: card && SAFE.test(card) ? card : null, scope: (q.get('scope') === 'library' ? 'library' : 'mine') as 'mine' | 'library' };
}
export function writeAddress(next: { card?: string | null; scope?: 'mine' | 'library' }) {
  const u = new URL(window.location.href);
  if ('card' in next) { if (next.card) u.searchParams.set('card', next.card); else u.searchParams.delete('card'); }
  if (next.scope) { if (next.scope === 'library') u.searchParams.set('scope', 'library'); else u.searchParams.delete('scope'); }
  if (u.toString() !== window.location.href) window.history.pushState({}, '', u.toString());
  window.dispatchEvent(new Event('bd:address'));
}
export const BINDER_CHANGED = 'bd:changed';
export const changed = () => window.dispatchEvent(new Event(BINDER_CHANGED));
