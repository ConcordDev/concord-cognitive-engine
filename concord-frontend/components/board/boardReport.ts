/**
 * A board report exists because the Board domain's `board-create` +
 * `card-create` + `board-detail` macros returned a real board with real
 * columns and cards. This module turns exactly that result into a
 * sentence, saves it as a private DTU, reads that DTU back, and hands it
 * to Thread as a draft.
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
import type { WsBoard } from './workspace-types';

export interface BoardReportFacts {
  board: WsBoard | null;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The board report sentence, built only from the real detail. Null when
 * there is no board, no id/name, or no columns.
 */
export function boardSentence(facts: BoardReportFacts): string | null {
  const b = facts.board;
  if (!b || !b.id || !b.name) return null;
  const cols = Array.isArray(b.columns) ? b.columns.length : 0;
  const cards = Array.isArray(b.cards) ? b.cards.length : 0;
  if (cols <= 0) return null;
  return `${str(b.name, 60)}: ${cols} column${cols === 1 ? '' : 's'}, ${cards} card${cards === 1 ? '' : 's'}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function boardBody(facts: BoardReportFacts): string {
  const sentence = boardSentence(facts);
  const b = facts.board;
  if (!sentence || !b) return '';
  const lines = [sentence, ''];
  lines.push(`Board ID: ${b.id || '-'}`);
  lines.push(`Name: ${b.name || '-'}`);
  if (b.createdAt) lines.push(`Created: ${str(b.createdAt, 30)}`);
  lines.push(`Columns: ${b.columns.length}`);
  for (const c of b.columns.slice(0, 20)) {
    const cardCount = b.cards.filter((card) => card.columnId === c.id).length;
    lines.push(`  - ${str(c.name, 40)} (${cardCount} card${cardCount === 1 ? '' : 's'})`);
  }
  lines.push(`Cards: ${b.cards.length}`);
  for (const card of b.cards.slice(0, 50)) {
    const col = b.columns.find((c) => c.id === card.columnId);
    const due = card.dueDate ? ` · due ${str(card.dueDate, 10)}` : '';
    const assignee = card.assignee ? ` · @${str(card.assignee, 30)}` : '';
    lines.push(`  - [${str(col?.name || '-', 20)}] ${str(card.title, 80)}${due}${assignee}`);
  }
  if (Array.isArray(b.labelDefs) && b.labelDefs.length > 0) {
    lines.push('');
    lines.push(`Labels (${b.labelDefs.length}): ${b.labelDefs.map((l) => str(l.name, 20)).join(', ')}`);
  }
  if (Array.isArray(b.automations) && b.automations.length > 0) {
    lines.push(`Automations: ${b.automations.length}`);
  }
  if (Array.isArray(b.collaborators) && b.collaborators.length > 0) {
    lines.push(`Collaborators: ${b.collaborators.length}`);
  }
  lines.push('');
  lines.push('Every figure here came from the Board domain board-detail macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same board the macro returned, structured. */
export function boardMachine(facts: BoardReportFacts): Record<string, unknown> | null {
  const b = facts.board;
  if (!boardSentence(facts) || !b) return null;
  return {
    kind: 'board_lens_board_report',
    boardId: b.id || null,
    name: b.name || null,
    columnCount: b.columns.length,
    cardCount: b.cards.length,
    labelCount: Array.isArray(b.labelDefs) ? b.labelDefs.length : 0,
    automationCount: Array.isArray(b.automations) ? b.automations.length : 0,
    collaboratorCount: Array.isArray(b.collaborators) ? b.collaborators.length : 0,
    createdAt: b.createdAt || null,
  };
}

/** The private DTU that records this board. Null when nothing can be saved. */
export function boardDtuCall(facts: BoardReportFacts): ReceiptCall | null {
  const body = boardBody(facts);
  const sentence = boardSentence(facts);
  const machine = boardMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['board', 'kanban', 'project'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'board-lens:board-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'board',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that board report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function boardThreadDraftCall(
  facts: BoardReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = boardSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const b = facts.board!;
  const name = str(b.name, 40) || 'board';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Board — ${name}`.slice(0, 120),
      content: boardBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface BoardDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function boardThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): BoardDraftResult | null {
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
export function indexBoardDrafts(details: unknown): Record<string, string> {
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

// Silence unused-import lint for num (kept for future numeric fields).
void num;