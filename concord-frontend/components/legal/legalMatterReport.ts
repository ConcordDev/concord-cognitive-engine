/**
 * A legal matter report exists because the Legal domain's `matters-detail`
 * macro returned the real matter, its parties, its billing totals, its time
 * entries, its invoices, its documents, and its events. This module turns
 * exactly that result into a sentence, saves it as a private DTU, reads that
 * DTU back, and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend did
 * not return is reported as missing, never invented. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it themselves.
 *
 * No fake fallback. When `matters-detail` returns no matter the sentence is
 * null and there is no DTU to save — the screen refuses instead of inventing.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface MatterRef {
  id: string;
  number: string;
  name: string;
  clientName?: string;
  matterType?: string;
  status?: string;
  jurisdiction?: string;
  court?: string;
  caseNumber?: string;
  billingType?: string;
  hourlyRate?: number;
  openedAt?: string;
  closedAt?: string | null;
  description?: string;
}

export interface MatterTotals {
  billed: number;
  unbilled: number;
  hours: number;
  trustBalance: number;
}

export interface MatterTimeEntry {
  id: string;
  date: string;
  description: string;
  hours: number;
  amount: number;
  status: string;
}

export interface MatterInvoice {
  id: string;
  number: string;
  total: number;
  status: string;
}

export interface MatterDocument {
  id: string;
  name: string;
  status: string;
}

export interface MatterEvent {
  id: string;
  title: string;
  date: string;
  kind: string;
}

export interface MatterParty {
  id: string;
  name: string;
  kind: string;
}

export interface MatterFacts {
  matter: MatterRef | null;
  parties: MatterParty[];
  totals: MatterTotals | null;
  time: MatterTimeEntry[];
  invoices: MatterInvoice[];
  documents: MatterDocument[];
  events: MatterEvent[];
}

function money(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${(Math.round(v * 100) / 100).toLocaleString()}`;
}

function hours(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${(Math.round(v * 10) / 10).toFixed(1)} hrs`;
}

/**
 * The matter sentence, built only from the real detail. Null when there is
 * no matter at all — the screen then refuses instead of inventing a summary.
 */
export function matterSentence(facts: MatterFacts): string | null {
  const m = facts.matter;
  const id = String(m?.id || '').trim();
  const name = String(m?.name || '').trim();
  if (!id || !name) return null;

  const parts: string[] = [];
  const t = facts.totals;
  if (t) {
    if (t.hours > 0) parts.push(`${hours(t.hours)} logged`);
    if (t.unbilled > 0) parts.push(`${money(t.unbilled)} unbilled`);
    if (t.billed > 0) parts.push(`${money(t.billed)} billed`);
    if (t.trustBalance > 0) parts.push(`${money(t.trustBalance)} in trust`);
  }
  if (facts.time.length > 0) parts.push(`${facts.time.length} time entries`);
  if (facts.invoices.length > 0) parts.push(`${facts.invoices.length} invoices`);
  if (facts.documents.length > 0) parts.push(`${facts.documents.length} documents`);
  if (facts.events.length > 0) parts.push(`${facts.events.length} upcoming events`);
  if (facts.parties.length > 0) parts.push(`${facts.parties.length} parties`);

  const status = String(m?.status || '').trim();
  const lead = `${name} (${m?.number || id})`;
  const body = parts.length > 0 ? parts.join(', ') : 'no reported activity yet';
  return `${lead}: ${body}.${status ? ` Status ${status}.` : ''}`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function matterBody(facts: MatterFacts): string {
  const sentence = matterSentence(facts);
  if (!sentence) return '';
  const lines = [sentence];
  const m = facts.matter;
  if (m) {
    if (m.clientName) lines.push(`Client: ${m.clientName}.`);
    if (m.matterType) lines.push(`Type: ${m.matterType.replace(/_/g, ' ')}.`);
    if (m.billingType) lines.push(`Billing: ${m.billingType.replace(/_/g, ' ')}.`);
    if (m.court) lines.push(`Court: ${m.court}.`);
    if (m.caseNumber) lines.push(`Case #: ${m.caseNumber}.`);
    if (m.jurisdiction) lines.push(`Jurisdiction: ${m.jurisdiction}.`);
    if (m.openedAt) lines.push(`Opened: ${m.openedAt}.`);
    if (m.closedAt) lines.push(`Closed: ${m.closedAt}.`);
  }
  const t = facts.totals;
  if (t) {
    lines.push(`Totals: ${hours(t.hours)} logged, ${money(t.unbilled)} unbilled, ${money(t.billed)} billed, ${money(t.trustBalance)} trust.`);
  }
  if (facts.parties.length > 0) {
    lines.push(`Parties: ${facts.parties.map((p) => `${p.name} (${p.kind.replace(/_/g, ' ')})`).join('; ')}.`);
  }
  if (facts.time.length > 0) {
    lines.push(`Recent time: ${facts.time.slice(0, 6).map((e) => `${e.date} ${e.description} (${hours(e.hours)}, ${money(e.amount)}, ${e.status})`).join('; ')}.`);
  }
  if (facts.invoices.length > 0) {
    lines.push(`Invoices: ${facts.invoices.map((i) => `${i.number} ${money(i.total)} (${i.status})`).join('; ')}.`);
  }
  if (facts.documents.length > 0) {
    lines.push(`Documents: ${facts.documents.map((d) => `${d.name} (${d.status})`).join('; ')}.`);
  }
  if (facts.events.length > 0) {
    lines.push(`Upcoming events: ${facts.events.slice(0, 5).map((e) => `${e.date} ${e.kind} ${e.title}`).join('; ')}.`);
  }
  lines.push('Every figure here came from the Legal domain in Concord. No court was filed. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same detail, structured. */
export function matterMachine(facts: MatterFacts): Record<string, unknown> | null {
  if (!matterSentence(facts)) return null;
  const m = facts.matter;
  const t = facts.totals;
  return {
    kind: 'legal_matter_report',
    matterId: String(m?.id || ''),
    matterNumber: String(m?.number || ''),
    matterName: String(m?.name || ''),
    status: String(m?.status || ''),
    matterType: String(m?.matterType || ''),
    billingType: String(m?.billingType || ''),
    clientName: String(m?.clientName || ''),
    totals: t ? {
      hours: Number(t.hours) || 0,
      unbilled: Number(t.unbilled) || 0,
      billed: Number(t.billed) || 0,
      trustBalance: Number(t.trustBalance) || 0,
    } : null,
    parties: facts.parties.length,
    timeEntries: facts.time.length,
    invoices: facts.invoices.length,
    documents: facts.documents.length,
    events: facts.events.length,
  };
}

/** The private DTU that records this matter. Null when nothing can be saved. */
export function matterReportDtuCall(facts: MatterFacts): ReceiptCall | null {
  const body = matterBody(facts);
  const sentence = matterSentence(facts);
  const machine = matterMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['legal', 'matter-report', String(facts.matter?.status || 'matter').toLowerCase()],
      source: 'legal-lens:matter-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'legal',
        legal: {
          matterId: String(facts.matter?.id || ''),
          matterNumber: String(facts.matter?.number || ''),
          matterName: String(facts.matter?.name || ''),
        },
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that matter report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function matterThreadDraftCall(
  facts: MatterFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = matterSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: String(facts.matter?.name || 'Legal matter').slice(0, 120),
      content: matterBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface MatterDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function matterThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): MatterDraftResult | null {
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
export function indexMatterDrafts(details: unknown): Record<string, string> {
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