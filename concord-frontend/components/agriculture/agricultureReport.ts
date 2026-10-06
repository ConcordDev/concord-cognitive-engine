/**
 * An agriculture field report exists because the Agriculture domain's
 * `field-create` macro returned the real field — id, name, acreage, lat,
 * lng, soilType, currentCrop, createdAt. This module turns exactly that
 * result into a sentence, saves it as a private DTU, reads that DTU back,
 * and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend
 * did not return is reported as missing, never invented. Nothing here
 * publishes anything: a Thread draft is a draft until the user posts it.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface AgField {
  id?: string;
  name?: string;
  acreage?: number;
  lat?: number;
  lng?: number;
  soilType?: string;
  currentCrop?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgReportFacts {
  field: AgField | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * The field report sentence, built only from the real field. Null when
 * there is no field, no id, or no name.
 */
export function agSentence(facts: AgReportFacts): string | null {
  const f = facts.field;
  if (!f || !f.id || !f.name) return null;
  const crop = str(f.currentCrop, 40);
  const soil = str(f.soilType, 24);
  return `${f.name}: ${num(f.acreage)}ac${crop ? `, ${crop}` : ''}${soil ? `, ${soil}` : ''} @ ${num(f.lat).toFixed(4)}, ${num(f.lng).toFixed(4)}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function agBody(facts: AgReportFacts): string {
  const sentence = agSentence(facts);
  const f = facts.field;
  if (!sentence || !f) return '';
  const lines = [sentence, ''];
  lines.push(`Field ID: ${f.id || '-'}`);
  lines.push(`Name: ${f.name || '-'}`);
  lines.push(`Acreage: ${num(f.acreage)}`);
  lines.push(`Latitude: ${num(f.lat).toFixed(4)}`);
  lines.push(`Longitude: ${num(f.lng).toFixed(4)}`);
  lines.push(`Soil type: ${str(f.soilType, 24) || '-'}`);
  lines.push(`Current crop: ${str(f.currentCrop, 40) || '-'}`);
  if (f.createdAt) lines.push(`Created: ${str(f.createdAt, 30)}`);
  if (f.updatedAt) lines.push(`Updated: ${str(f.updatedAt, 30)}`);
  lines.push('');
  lines.push('Every figure here came from the Agriculture domain field-create macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same field the macro returned, structured. */
export function agMachine(facts: AgReportFacts): Record<string, unknown> | null {
  const f = facts.field;
  if (!agSentence(facts) || !f) return null;
  return {
    kind: 'agriculture_field_report',
    fieldId: f.id || null,
    name: f.name || null,
    acreage: num(f.acreage),
    lat: num(f.lat),
    lng: num(f.lng),
    soilType: f.soilType || null,
    currentCrop: f.currentCrop || null,
  };
}

/** The private DTU that records this field. Null when nothing can be saved. */
export function agDtuCall(facts: AgReportFacts): ReceiptCall | null {
  const body = agBody(facts);
  const sentence = agSentence(facts);
  const machine = agMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['agriculture', 'field'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'agriculture-lens:field-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'agriculture',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that field report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function agThreadDraftCall(
  facts: AgReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = agSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const f = facts.field!;
  const name = str(f.name, 40) || 'field';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Agriculture field — ${name}`.slice(0, 120),
      content: agBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface AgDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function agThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): AgDraftResult | null {
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

/**
 * Index the drafts Thread already holds by the DTU they cite, so a reload
 * shows the same "Drafted in Thread" the send reported.
 */
export function indexAgDrafts(details: unknown): Record<string, string> {
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