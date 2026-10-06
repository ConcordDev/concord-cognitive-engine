/**
 * A creator content report exists because the Creator domain's
 * `content-add` macro returned the real content item — id, title, format,
 * stage, platform, scheduledDate, notes, performance counters. This
 * module turns exactly that result into a sentence, saves it as a
 * private DTU, reads that DTU back, and hands it to Thread as a draft.
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

export interface CreatorContent {
  id?: string;
  title?: string;
  format?: string;
  stage?: string;
  platform?: string | null;
  scheduledDate?: string | null;
  notes?: string | null;
  views?: number;
  clicks?: number;
  conversions?: number;
  citations?: number;
  revenue?: number;
  createdAt?: string;
  publishedAt?: string | null;
}

export interface CreatorReportFacts {
  item: CreatorContent | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * The content report sentence, built only from the real item. Null when
 * there is no item, no id, or no title.
 */
export function creatorSentence(facts: CreatorReportFacts): string | null {
  const c = facts.item;
  if (!c || !c.id || !c.title) return null;
  const stage = str(c.stage || 'idea', 20);
  const fmt = str(c.format || 'content', 20);
  return `${str(c.title, 60)}: ${fmt} · ${stage}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function creatorBody(facts: CreatorReportFacts): string {
  const sentence = creatorSentence(facts);
  const c = facts.item;
  if (!sentence || !c) return '';
  const lines = [sentence, ''];
  lines.push(`Content ID: ${c.id || '-'}`);
  lines.push(`Title: ${c.title || '-'}`);
  lines.push(`Format: ${str(c.format, 20) || '-'}`);
  lines.push(`Stage: ${str(c.stage, 20) || '-'}`);
  if (c.platform) lines.push(`Platform: ${str(c.platform, 60)}`);
  if (c.scheduledDate) lines.push(`Scheduled: ${str(c.scheduledDate, 10)}`);
  if (c.publishedAt) lines.push(`Published at: ${str(c.publishedAt, 30)}`);
  if (c.createdAt) lines.push(`Created: ${str(c.createdAt, 30)}`);
  lines.push(`Views: ${num(c.views)}`);
  lines.push(`Clicks: ${num(c.clicks)}`);
  lines.push(`Conversions: ${num(c.conversions)}`);
  lines.push(`Citations: ${num(c.citations)}`);
  lines.push(`Revenue: ${num(c.revenue)}`);
  if (c.notes) lines.push(`Notes: ${str(c.notes, 500)}`);
  lines.push('');
  lines.push('Every figure here came from the Creator domain content-add macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same content item the macro returned, structured. */
export function creatorMachine(facts: CreatorReportFacts): Record<string, unknown> | null {
  const c = facts.item;
  if (!creatorSentence(facts) || !c) return null;
  return {
    kind: 'creator_content_report',
    contentId: c.id || null,
    title: c.title || null,
    format: c.format || null,
    stage: c.stage || null,
    platform: c.platform || null,
    views: num(c.views),
    clicks: num(c.clicks),
    conversions: num(c.conversions),
    citations: num(c.citations),
    revenue: num(c.revenue),
  };
}

/** The private DTU that records this content item. Null when nothing can be saved. */
export function creatorDtuCall(facts: CreatorReportFacts): ReceiptCall | null {
  const body = creatorBody(facts);
  const sentence = creatorSentence(facts);
  const machine = creatorMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['creator', 'content', 'pipeline'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'creator-lens:content-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'creator',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that content report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function creatorThreadDraftCall(
  facts: CreatorReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = creatorSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const c = facts.item!;
  const title = str(c.title, 40) || 'content';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Creator content — ${title}`.slice(0, 120),
      content: creatorBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface CreatorDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function creatorThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): CreatorDraftResult | null {
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
export function indexCreatorDrafts(details: unknown): Record<string, string> {
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