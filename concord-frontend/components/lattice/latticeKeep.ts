/**
 * Keep the lattice overview's consent-corpus snapshot as a private DTU, then
 * a Thread draft (shared dtu.create -> dtu.get read-back -> thread.thread-draft
 * handoff in components/lens/recordKeep.ts). Built only from the stats the
 * overview panel already loaded — no tables means no snapshot to keep.
 */

import type { KeptRecord } from '@/components/lens/recordKeep';
import type { CorpusStats } from './latticeShared';

function text(value: unknown, max = 4000): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The overview's consent-corpus snapshot. Null with no consent tables. */
export function latticeKeptRecord(stats: CorpusStats | null | undefined): KeptRecord | null {
  const tables = (stats?.tables || []).filter((t) => text(t?.name, 80));
  if (!stats || tables.length === 0) return null;
  const title = 'Consent corpus snapshot';
  const lines = [title];
  const total = num(stats.totals?.total);
  const consented = num(stats.totals?.consented);
  const ratio = num(stats.totals?.ratio);
  if (total != null) lines.push(`Total rows: ${total}`);
  if (consented != null) lines.push(`Consented: ${consented}`);
  if (ratio != null) lines.push(`Consent ratio: ${(ratio * 100).toFixed(1)}%`);
  lines.push('Per-table consent:');
  for (const t of tables.slice(0, 40)) {
    const name = text(t.name, 80);
    const regime = text(t.regime, 40);
    const head = regime ? `${name} (${regime})` : name;
    const fields: string[] = [];
    const tTotal = num(t.total);
    if (tTotal != null) fields.push(`${tTotal} total`);
    const tConsented = num(t.consented);
    if (tConsented != null) fields.push(`${tConsented} consented`);
    const tRatio = num(t.ratio);
    if (tRatio != null) fields.push(`${(tRatio * 100).toFixed(1)}%`);
    lines.push(fields.length ? `- ${head}: ${fields.join(', ')}` : `- ${head}`);
  }
  return {
    title,
    body: lines.join('\n'),
    tags: ['lattice', 'corpus'],
    source: 'lattice-lens:corpus-stats',
    createdFrom: 'lattice',
    draftTitle: `Lattice — ${title}`.slice(0, 120),
    machine: {
      kind: 'lattice_corpus_stats',
      totals: stats.totals ?? null,
      tables: tables.slice(0, 40),
    },
  };
}