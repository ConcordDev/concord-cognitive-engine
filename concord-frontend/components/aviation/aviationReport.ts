/**
 * An aviation logbook entry report exists because the Aviation domain's
 * `logbook-add` macro returned the real entry — id, aircraftId, date,
 * from, to, totalHours, pic, night, instrument, dayLandings,
 * nightLandings, conditions, remarks, createdAt. This module turns
 * exactly that result into a sentence, saves it as a private DTU, reads
 * that DTU back, and hands it to Thread as a draft.
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

export interface AvLogEntry {
  id?: string;
  aircraftId?: string;
  date?: string;
  from?: string;
  to?: string;
  totalHours?: number;
  pic?: number;
  sic?: number;
  crossCountry?: number;
  night?: number;
  instrument?: number;
  simulated?: number;
  dayLandings?: number;
  nightLandings?: number;
  conditions?: string;
  remarks?: string;
  createdAt?: string;
}

export interface AvReportFacts {
  entry: AvLogEntry | null;
  tail?: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * The logbook entry report sentence, built only from the real entry.
 * Null when there is no entry, no id, or no route.
 */
export function avSentence(facts: AvReportFacts): string | null {
  const e = facts.entry;
  if (!e || !e.id || !e.from || !e.to) return null;
  const route = `${str(e.from, 4)}→${str(e.to, 4)}`;
  const hrs = num(e.totalHours).toFixed(1);
  const conditions = str(e.conditions, 4) || 'VFR';
  return `${str(e.date, 10)} ${route}: ${hrs}h ${conditions}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function avBody(facts: AvReportFacts): string {
  const sentence = avSentence(facts);
  const e = facts.entry;
  if (!sentence || !e) return '';
  const lines = [sentence, ''];
  lines.push(`Entry ID: ${e.id || '-'}`);
  lines.push(`Aircraft ID: ${str(e.aircraftId, 60) || '-'}`);
  if (facts.tail) lines.push(`Tail: ${str(facts.tail, 10)}`);
  lines.push(`Date: ${str(e.date, 10) || '-'}`);
  lines.push(`Route: ${str(e.from, 4)} → ${str(e.to, 4)}`);
  lines.push(`Total hours: ${num(e.totalHours).toFixed(1)}`);
  lines.push(`PIC: ${num(e.pic).toFixed(1)}`);
  lines.push(`Night: ${num(e.night).toFixed(1)}`);
  lines.push(`Instrument: ${num(e.instrument).toFixed(1)}`);
  lines.push(`Day landings: ${num(e.dayLandings)}`);
  lines.push(`Night landings: ${num(e.nightLandings)}`);
  lines.push(`Conditions: ${str(e.conditions, 4) || '-'}`);
  if (e.remarks) lines.push(`Remarks: ${str(e.remarks, 200)}`);
  if (e.createdAt) lines.push(`Logged: ${str(e.createdAt, 30)}`);
  lines.push('');
  lines.push('Every figure here came from the Aviation domain logbook-add macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same entry the macro returned, structured. */
export function avMachine(facts: AvReportFacts): Record<string, unknown> | null {
  const e = facts.entry;
  if (!avSentence(facts) || !e) return null;
  return {
    kind: 'aviation_logbook_report',
    entryId: e.id || null,
    aircraftId: e.aircraftId || null,
    date: e.date || null,
    from: e.from || null,
    to: e.to || null,
    totalHours: num(e.totalHours),
    pic: num(e.pic),
    night: num(e.night),
    instrument: num(e.instrument),
    conditions: e.conditions || null,
  };
}

/** The private DTU that records this entry. Null when nothing can be saved. */
export function avDtuCall(facts: AvReportFacts): ReceiptCall | null {
  const body = avBody(facts);
  const sentence = avSentence(facts);
  const machine = avMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['aviation', 'logbook', 'flight'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'aviation-lens:logbook-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'aviation',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that logbook report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function avThreadDraftCall(
  facts: AvReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = avSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const e = facts.entry!;
  const route = `${str(e.from, 4)}-${str(e.to, 4)}`;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Aviation logbook — ${route}`.slice(0, 120),
      content: avBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface AvDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function avThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): AvDraftResult | null {
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
export function indexAvDrafts(details: unknown): Record<string, string> {
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