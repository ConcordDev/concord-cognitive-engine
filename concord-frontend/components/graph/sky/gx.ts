'use client';

/** Shared calls and shapes for the Star Chart. */
import { lensRun } from '@/lib/api/client';

export interface Res<T> { ok: boolean; result: T | null; error: string | null }
/** graph.* — the sky macros return their fields at the top level ({ ok, ...fields }). */
export async function gx<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  try {
    const r = await lensRun<T>('graph', action, input);
    const d = r.data as ({ ok?: boolean; result?: T; error?: string; message?: string } & Record<string, unknown>) | undefined;
    if (!d) return { ok: false, result: null, error: 'No answer from the server.' };
    if (d.ok === false) return { ok: false, result: null, error: d.error || d.message || 'That did not work.' };
    // Lens-action macros wrap their payload in `result`; registered macros return it flat.
    const payload = (d.result && typeof d.result === 'object' ? d.result : d) as T & { ok?: boolean; error?: string; message?: string };
    if (payload.ok === false) return { ok: false, result: null, error: payload.error || payload.message || 'That did not work.' };
    return { ok: true, result: payload, error: null };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : 'That did not work.' };
  }
}

export interface Star {
  id: string; title: string; shelf: string; spectral: string; colour: string;
  magnitude: number; links: number; citations: number; constellation: string | null; x: number; y: number;
}
export interface SkyLine { a: string; b: string; within: boolean }
export interface Constellation { id: string; name: string; size: number }
export interface Sky { visibleTotal: number; shown: number; stars: Star[]; constellations: Constellation[]; lines: SkyLine[] }
export interface Ref { id: string; title: string }
export interface StarCard {
  id: string; title: string; shelf: string; spectral: string | null; colour: string | null; charted: boolean;
  magnitude: number; links: number; citations: number; tier: string | null; createdAt: string | null; tags: string[]; summary: string;
  owner: string | null; isMine: boolean; parents: Ref[]; children: Ref[];
  relations: (Ref & { type: string; direction: 'in' | 'out' })[]; charts: { id: string; title: string }[];
}
export interface MyConstellation { id: string; title: string; stars: string[]; lines: [string, string][]; nodes: number }
export interface Route { path: string[] | null; hops: number | null; steps: { from: string; to: string; type: string }[]; stops: Ref[]; note?: string }

export const SHELF_NAMES: Record<string, string> = {
  specs: 'specs & designs', knowledge: 'knowledge', data: 'data', works: 'works', documents: 'documents', parts: 'parts', notes: 'your notes',
};
/** A catalogue number from the DTU id (its own id, shortened, not invented). */
export const catalogueNo = (id: string) => `CC ${id.replace(/^dtu[_-]?/, '').slice(0, 6).toUpperCase()}`;
/** Chart coordinates shown like an atlas: x → right ascension hours, y → declination degrees. */
export function coords(x: number, y: number): string {
  const ra = x * 24; const h = Math.floor(ra); const m = Math.round((ra - h) * 60);
  const dec = 90 - y * 180;
  return `${String(h).padStart(2, '0')}h${String(m === 60 ? 59 : m).padStart(2, '0')}m ${dec >= 0 ? '+' : '−'}${Math.abs(dec).toFixed(1)}°`;
}
export const RELATION_WORDS: Record<string, string> = { parent: 'builds on', child: 'built on by', 'map-link': 'linked on a chart' };
