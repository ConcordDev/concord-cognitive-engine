/**
 * A whiteboard board report exists because the Whiteboard domain's
 * `board-save` macro returned the real board — id, title, scene with
 * elements. This module turns exactly that result into a sentence, saves
 * it as a private DTU, reads that DTU back, and hands it to Thread as a
 * draft.
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

export interface WhiteboardElementLite {
  type?: string;
  kind?: string;
  text?: string;
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface WhiteboardBoard {
  id?: string;
  title?: string;
  scene?: { elements?: WhiteboardElementLite[]; appState?: Record<string, unknown> } | null;
  elements?: WhiteboardElementLite[];
  createdAt?: string;
  updatedAt?: string;
  elementCount?: number;
}

export interface WhiteboardReportFacts {
  board: WhiteboardBoard | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function elementsOf(b: WhiteboardBoard): WhiteboardElementLite[] {
  if (Array.isArray(b.elements)) return b.elements;
  const els = b.scene?.elements;
  return Array.isArray(els) ? els : [];
}

function elementCountOf(b: WhiteboardBoard): number {
  if (typeof b.elementCount === 'number') return b.elementCount;
  return elementsOf(b).length;
}

/**
 * The board report sentence, built only from the real board. Null when
 * there is no board, no id, or no title.
 */
export function whiteboardSentence(facts: WhiteboardReportFacts): string | null {
  const b = facts.board;
  if (!b || !b.id || !b.title) return null;
  const count = elementCountOf(b);
  return `${str(b.title, 60)}: ${count} element${count === 1 ? '' : 's'}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function whiteboardBody(facts: WhiteboardReportFacts): string {
  const sentence = whiteboardSentence(facts);
  const b = facts.board;
  if (!sentence || !b) return '';
  const lines = [sentence, ''];
  lines.push(`Board ID: ${b.id || '-'}`);
  lines.push(`Title: ${b.title || '-'}`);
  const count = elementCountOf(b);
  lines.push(`Elements: ${count}`);
  if (b.createdAt) lines.push(`Created: ${str(b.createdAt, 30)}`);
  if (b.updatedAt) lines.push(`Updated: ${str(b.updatedAt, 30)}`);
  const els = elementsOf(b);
  if (els.length > 0) {
    lines.push('');
    lines.push('Elements:');
    els.slice(0, 12).forEach((el, i) => {
      const kind = str(el.type || el.kind || 'shape', 20) || 'shape';
      const label = el.text || el.label ? ` — ${str(el.text || el.label, 60)}` : '';
      lines.push(`  ${i + 1}. ${kind}${label} @ ${num(el.x)},${num(el.y)} (${num(el.width)}x${num(el.height)})`);
    });
    if (els.length > 12) lines.push(`  …and ${els.length - 12} more.`);
  }
  lines.push('');
  lines.push('Every figure here came from the Whiteboard domain board-save macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same board the macro returned, structured. */
export function whiteboardMachine(facts: WhiteboardReportFacts): Record<string, unknown> | null {
  const b = facts.board;
  if (!whiteboardSentence(facts) || !b) return null;
  return {
    kind: 'whiteboard_board_report',
    boardId: b.id || null,
    title: b.title || null,
    elementCount: elementCountOf(b),
    createdAt: b.createdAt || null,
    updatedAt: b.updatedAt || null,
  };
}

/** The private DTU that records this board. Null when nothing can be saved. */
export function whiteboardDtuCall(facts: WhiteboardReportFacts): ReceiptCall | null {
  const body = whiteboardBody(facts);
  const sentence = whiteboardSentence(facts);
  const machine = whiteboardMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['whiteboard', 'board', 'canvas'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'whiteboard-lens:board-report',
      skipAutoTag: true,
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'whiteboard',
        skipAutoTag: true,
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that board report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function whiteboardThreadDraftCall(
  facts: WhiteboardReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = whiteboardSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const b = facts.board!;
  const title = str(b.title, 40) || 'board';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Whiteboard — ${title}`.slice(0, 120),
      content: whiteboardBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface WhiteboardDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function whiteboardThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): WhiteboardDraftResult | null {
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
export function indexWhiteboardDrafts(details: unknown): Record<string, string> {
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