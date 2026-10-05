/**
 * An atlas place report exists because the Atlas domain's `places-save`
 * macro returned the real place — id, number, name, lat, lng, category,
 * address, notes, rating, savedAt. This module turns exactly that result
 * into a sentence, saves it as a private DTU, reads that DTU back, and
 * hands it to Thread as a draft.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface AtlasPlace {
  id?: string;
  number?: string;
  name?: string;
  lat?: number;
  lng?: number;
  category?: string;
  address?: string;
  notes?: string;
  rating?: number | null;
  savedAt?: string;
}

export interface AtlasReportFacts {
  place: AtlasPlace | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

export function atlasSentence(facts: AtlasReportFacts): string | null {
  const p = facts.place;
  if (!p || !p.id || !p.name) return null;
  const cat = str(p.category, 20);
  return `${p.name}${cat ? ` (${cat})` : ''} @ ${num(p.lat).toFixed(4)}, ${num(p.lng).toFixed(4)}.`;
}

export function atlasBody(facts: AtlasReportFacts): string {
  const sentence = atlasSentence(facts);
  const p = facts.place;
  if (!sentence || !p) return '';
  const lines = [sentence, ''];
  lines.push(`Place ID: ${p.id || '-'}`);
  lines.push(`Number: ${p.number || '-'}`);
  lines.push(`Name: ${str(p.name, 120) || '-'}`);
  lines.push(`Latitude: ${num(p.lat).toFixed(4)}`);
  lines.push(`Longitude: ${num(p.lng).toFixed(4)}`);
  lines.push(`Category: ${str(p.category, 20) || '-'}`);
  if (p.address) lines.push(`Address: ${str(p.address, 200)}`);
  if (p.notes) lines.push(`Notes: ${str(p.notes, 500)}`);
  if (p.rating != null) lines.push(`Rating: ${num(p.rating)}/5`);
  if (p.savedAt) lines.push(`Saved: ${str(p.savedAt, 30)}`);
  lines.push('');
  lines.push('Every figure here came from the Atlas domain places-save macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

export function atlasMachine(facts: AtlasReportFacts): Record<string, unknown> | null {
  const p = facts.place;
  if (!atlasSentence(facts) || !p) return null;
  return {
    kind: 'atlas_place_report',
    placeId: p.id || null,
    number: p.number || null,
    name: p.name || null,
    lat: num(p.lat),
    lng: num(p.lng),
    category: p.category || null,
  };
}

export function atlasDtuCall(facts: AtlasReportFacts): ReceiptCall | null {
  const body = atlasBody(facts);
  const sentence = atlasSentence(facts);
  const machine = atlasMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['atlas', 'place'],
      source: 'atlas-lens:place-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: { visibility: 'private', consent: { allowCitations: false }, createdFrom: 'atlas' },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

export function atlasThreadDraftCall(
  facts: AtlasReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = atlasSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const p = facts.place!;
  const name = str(p.name, 40) || 'place';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Atlas place — ${name}`.slice(0, 120),
      content: atlasBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface AtlasDraftResult { draftId: string; status: string; citedDtuId: string }

export function atlasThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): AtlasDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

export function indexAtlasDrafts(details: unknown): Record<string, string> {
  const list = Array.isArray(details) ? details : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const envelope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!envelope || envelope.ok === false) continue;
    const result = envelope.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : envelope;
    const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
    if (!draft) continue;
    const draftId = String(draft.id || '').trim();
    const cited = String(draft.citedDtuId || '').trim();
    if (!draftId || !cited || out[cited]) continue;
    out[cited] = draftId;
  }
  return out;
}