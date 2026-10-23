/**
 * Keep a found-analogies result as a private DTU, then a Thread draft (shared
 * dtu.create -> dtu.get read-back -> thread.thread-draft handoff in
 * components/lens/recordKeep.ts). Built only from the results JSON the
 * panel already rendered — no returned rows, nothing to keep.
 */

import type { KeptRecord } from '@/components/lens/recordKeep';

export interface TransferAnalogyRowInput {
  patternId?: string;
  patternName?: string;
  sourceDomain?: string;
  targetDomain?: string;
  relevance?: number;
  template?: string;
}

export interface TransferKeepInput {
  source?: string;
  target?: string;
  result?: unknown;
}

function text(value: unknown, max = 4000): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The analogy result the panel already shows. Null with no returned rows. */
export function transferKeptRecord(t: TransferKeepInput | null | undefined): KeptRecord | null {
  const result = t?.result && typeof t.result === 'object' ? (t.result as Record<string, unknown>) : null;
  if (!t || !result || result.ok === false) return null;
  const rows = Array.isArray(result.results)
    ? (result.results as unknown[]).filter(
        (r) => r && typeof r === 'object' && text((r as TransferAnalogyRowInput).patternName, 240),
      )
    : [];
  const title = text(t.source, 240);
  if (rows.length === 0 || !title) return null;
  const target = text(t.target, 80);
  const lines = [title];
  if (target) lines.push(`Target domain: ${target}`);
  lines.push('Analogies:');
  const analogies = rows.slice(0, 10).map((r) => {
    const row = r as TransferAnalogyRowInput;
    const name = text(row.patternName, 240);
    const source = text(row.sourceDomain, 60);
    const rowTarget = text(row.targetDomain, 60);
    const relevance = num(row.relevance);
    const template = text(row.template, 2000);
    const fields: string[] = [];
    const head = source && rowTarget ? `${source} → ${rowTarget}` : source || rowTarget;
    if (head) fields.push(head);
    if (relevance != null) fields.push(`${Math.round(Math.min(1, Math.max(0, relevance)) * 100)}%`);
    let line = fields.length ? `- ${name} (${fields.join(', ')})` : `- ${name}`;
    if (template) line += `: ${template}`;
    lines.push(line);
    return {
      patternId: text(row.patternId, 80) || null,
      patternName: name,
      sourceDomain: source || null,
      targetDomain: rowTarget || null,
      relevance: relevance == null ? null : Math.min(1, Math.max(0, relevance)),
      template: template || null,
    };
  });
  return {
    title,
    body: lines.join('\n'),
    tags: ['transfer', 'analogy'],
    source: 'transfer-lens:analogies',
    createdFrom: 'transfer',
    draftTitle: `Transfer — ${title}`.slice(0, 120),
    machine: {
      kind: 'transfer_analogies',
      source: title,
      target: target || null,
      analogies,
    },
  };
}