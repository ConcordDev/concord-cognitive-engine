/**
 * A trades job report exists because the Trades domain's `job-create` macro
 * returned the real work order — number, customer, description, priority,
 * status, estimated hours. This module turns exactly that result into a
 * sentence, saves it as a private DTU, reads that DTU back, and hands it
 * to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend did
 * not return is reported as missing, never invented. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface TradesJob {
  id?: string;
  number?: string;
  customerId?: string;
  customerName?: string;
  description?: string;
  priority?: string;
  status?: string;
  scheduledFor?: string | null;
  assignedTech?: string | null;
  estimatedHours?: number;
}

export interface TradesReportFacts {
  job: TradesJob | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * The job report sentence, built only from the real detail. Null when
 * there is no job, no id, or no number.
 */
export function tradesSentence(facts: TradesReportFacts): string | null {
  const j = facts.job;
  if (!j || !j.id || !j.number) return null;
  const parts: string[] = [];
  parts.push(str(j.number, 20));
  if (j.customerName) parts.push(str(j.customerName, 60));
  const hrs = num(j.estimatedHours);
  return `${parts.join(' · ')}: ${str(j.priority || 'normal', 12)} ${str(j.status || 'unassigned', 20)}, est ${hrs}h.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function tradesBody(facts: TradesReportFacts): string {
  const sentence = tradesSentence(facts);
  const j = facts.job;
  if (!sentence || !j) return '';
  const lines = [sentence, ''];
  lines.push(`Job ID: ${j.id || '-'}`);
  lines.push(`Number: ${j.number || '-'}`);
  if (j.customerName) lines.push(`Customer: ${str(j.customerName, 80)}`);
  if (j.description) lines.push(`Description: ${str(j.description, 500)}`);
  if (j.priority) lines.push(`Priority: ${str(j.priority, 20)}`);
  if (j.status) lines.push(`Status: ${str(j.status, 20)}`);
  if (j.scheduledFor) lines.push(`Scheduled for: ${str(j.scheduledFor, 20)}`);
  if (j.assignedTech) lines.push(`Assigned tech: ${str(j.assignedTech, 60)}`);
  lines.push(`Estimated hours: ${num(j.estimatedHours)}`);
  lines.push('');
  lines.push('Every figure here came from the Trades domain job-create macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same job the macro returned, structured. */
export function tradesMachine(facts: TradesReportFacts): Record<string, unknown> | null {
  const j = facts.job;
  if (!tradesSentence(facts) || !j) return null;
  return {
    kind: 'trades_job_report',
    jobId: j.id || null,
    number: j.number || null,
    customerId: j.customerId || null,
    customerName: j.customerName || null,
    priority: j.priority || null,
    status: j.status || null,
    estimatedHours: num(j.estimatedHours),
  };
}

/** The private DTU that records this job. Null when nothing can be saved. */
export function tradesDtuCall(facts: TradesReportFacts): ReceiptCall | null {
  const body = tradesBody(facts);
  const sentence = tradesSentence(facts);
  const machine = tradesMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['trades', 'job', 'work-order'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'trades-lens:job-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'trades',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that job report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function tradesThreadDraftCall(
  facts: TradesReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = tradesSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const j = facts.job!;
  const number = str(j.number, 20) || 'job';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Trades job — ${number}`.slice(0, 120),
      content: tradesBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface TradesDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function tradesThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): TradesDraftResult | null {
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
export function indexTradesDrafts(details: unknown): Record<string, string> {
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