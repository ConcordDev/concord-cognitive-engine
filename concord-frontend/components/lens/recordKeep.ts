/**
 * Keep a record the lens already loaded, as a private DTU, then a Thread draft.
 *
 * Same handoff Accounting (`AccountingKeepMenu`) and Timeline (`PostKeepMenu`)
 * already use: dtu.create → dtu.get read-back → thread.thread-draft citing
 * that id. A draft is not a post. A missing field is omitted. Nothing here
 * invents a title, a status, or a sentence the record did not return.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '../wallet/walletReceipt';

export interface KeptRecord {
  /** First line of the DTU. Empty means there is nothing honest to keep. */
  title: string;
  /** Full text of the real fields. Empty means there is nothing honest to keep. */
  body: string;
  tags: string[];
  source: string;
  createdFrom: string;
  machine: Record<string, unknown>;
  draftTitle: string;
}

const DTU_ID = /^[A-Za-z0-9_.:-]{1,80}$/;

function text(value: unknown, max = 4000): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function pushField(lines: string[], label: string, value: unknown, max = 2000): void {
  const s = text(value, max);
  if (!s) return;
  lines.push(`${label}: ${s}`);
}

export interface BoardCardKeepInput {
  id?: string;
  title?: string;
  description?: string;
  columnId?: string;
  dueDate?: string | null;
  assignee?: string | null;
  labels?: string[];
  checklist?: { text?: string; done?: boolean }[];
  comments?: { author?: string; text?: string }[];
  attachments?: { name?: string; url?: string }[];
}

export interface BoardKeepInput {
  id?: string;
  name?: string;
  columns?: { id?: string; name?: string }[];
}

/** A board card the detail modal already loaded. Null when it has no id or title. */
export function boardCardKeepRecord(card: BoardCardKeepInput | null | undefined, board: BoardKeepInput | null | undefined): KeptRecord | null {
  const title = text(card?.title, 240);
  const id = text(card?.id, 80);
  if (!card || !title || !id) return null;
  const column = (board?.columns || []).find((c) => c.id && c.id === card.columnId);
  const lines = [title, `Card ${id}`];
  if (text(board?.name, 80) && text(board?.id, 80)) lines.push(`Board: ${text(board?.name, 80)} (${text(board?.id, 80)})`);
  else pushField(lines, 'Board', board?.name, 80);
  pushField(lines, 'Column', column?.name, 80);
  pushField(lines, 'Description', card.description, 4000);
  pushField(lines, 'Due', card.dueDate, 40);
  pushField(lines, 'Assignee', card.assignee, 80);
  const labels = (card.labels || []).map((l) => text(l, 30)).filter(Boolean);
  if (labels.length) lines.push(`Labels: ${labels.join(', ')}`);
  const checklist = (card.checklist || []).filter((item) => text(item.text, 200));
  if (checklist.length) {
    lines.push('Checklist:');
    for (const item of checklist.slice(0, 40)) {
      lines.push(`- [${item.done ? 'x' : ' '}] ${text(item.text, 200)}`);
    }
  }
  const comments = (card.comments || []).filter((c) => text(c.text, 500));
  if (comments.length) {
    lines.push('Comments:');
    for (const c of comments.slice(0, 20)) {
      const author = text(c.author, 80);
      lines.push(author ? `- ${author}: ${text(c.text, 500)}` : `- ${text(c.text, 500)}`);
    }
  }
  const attachments = (card.attachments || []).filter((a) => text(a.url, 500) || text(a.name, 160));
  if (attachments.length) {
    lines.push('Attachments:');
    for (const a of attachments.slice(0, 20)) {
      const name = text(a.name, 160);
      const url = text(a.url, 500);
      lines.push(name && url ? `- ${name} (${url})` : `- ${name || url}`);
    }
  }
  const body = lines.join('\n');
  return {
    title,
    body,
    tags: ['board', 'card'],
    source: 'board-lens:card',
    createdFrom: 'board',
    draftTitle: `Board card — ${title}`.slice(0, 120),
    machine: {
      kind: 'board_card',
      cardId: id,
      title,
      boardId: text(board?.id, 80) || null,
      boardName: text(board?.name, 80) || null,
      columnId: text(card.columnId, 80) || null,
      columnName: text(column?.name, 80) || null,
      description: text(card.description, 4000),
      dueDate: text(card.dueDate, 40) || null,
      assignee: text(card.assignee, 80) || null,
      labels,
    },
  };
}

export interface GoalKeepInput {
  id?: string;
  title?: string;
  description?: string;
  category?: string;
  priority?: string;
  status?: string;
  progress?: number;
  targetDate?: string;
  subtasks?: { label?: string; done?: boolean }[];
}

/** A personal goal the detail row already loaded. Null when it has no id or title. */
export function goalKeepRecord(goal: GoalKeepInput | null | undefined): KeptRecord | null {
  const title = text(goal?.title, 240);
  const id = text(goal?.id, 80);
  if (!goal || !title || !id) return null;
  const lines = [title, `Goal ${id}`];
  pushField(lines, 'Description', goal.description, 4000);
  pushField(lines, 'Category', goal.category, 40);
  pushField(lines, 'Priority', goal.priority, 20);
  pushField(lines, 'Status', goal.status, 20);
  const progress = Number(goal.progress);
  const progressPct = Number.isFinite(progress) ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : null;
  if (progressPct != null) lines.push(`Progress: ${progressPct}%`);
  pushField(lines, 'Target', goal.targetDate, 40);
  const steps = (goal.subtasks || []).filter((s) => text(s.label, 200));
  if (steps.length) {
    lines.push('Steps:');
    for (const step of steps.slice(0, 40)) {
      lines.push(`- [${step.done ? 'x' : ' '}] ${text(step.label, 200)}`);
    }
  }
  return {
    title,
    body: lines.join('\n'),
    tags: ['goals', 'goal'],
    source: 'goals-lens:goal',
    createdFrom: 'goals',
    draftTitle: `Goal — ${title}`.slice(0, 120),
    machine: {
      kind: 'goal',
      goalId: id,
      title,
      description: text(goal.description, 4000),
      category: text(goal.category, 40) || null,
      priority: text(goal.priority, 20) || null,
      status: text(goal.status, 20) || null,
      progress: progressPct == null ? null : progress,
      targetDate: text(goal.targetDate, 40) || null,
      steps: steps.slice(0, 40).map((s) => ({ label: text(s.label, 200), done: Boolean(s.done) })),
    },
  };
}

export interface VaultSubmissionKeepInput {
  id?: string;
  title?: string;
  status?: string;
  workKind?: string;
  description?: string;
  body?: string;
  submittedAt?: number | null;
  declineReason?: string | null;
  curatorStatement?: string | null;
}

export interface SavedItemKeepInput {
  id?: string;
  title?: string;
  kind?: string;
  author?: string | null;
  url?: string | null;
  excerpt?: string | null;
  note?: string;
  tags?: string[];
  state?: string;
  sourceLens?: string | null;
  refId?: string | null;
}

/** A saved item the desk already loaded. Null when it has no id or title. */
export function savedItemKeepRecord(item: SavedItemKeepInput | null | undefined): KeptRecord | null {
  const title = text(item?.title, 240);
  const id = text(item?.id, 80);
  if (!item || !title || !id) return null;
  const lines = [title, `Saved ${id}`];
  pushField(lines, 'Kind', item.kind, 40);
  pushField(lines, 'Author', item.author, 200);
  pushField(lines, 'URL', item.url, 1000);
  pushField(lines, 'Excerpt', item.excerpt, 1000);
  pushField(lines, 'Note', item.note, 4000);
  const tags = (item.tags || []).map((t) => text(t, 40)).filter(Boolean);
  if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
  pushField(lines, 'State', item.state, 20);
  pushField(lines, 'Via', item.sourceLens, 60);
  pushField(lines, 'Ref', item.refId, 120);
  return {
    title,
    body: lines.join('\n'),
    tags: ['saved', 'item'],
    source: 'saved-lens:item',
    createdFrom: 'saved',
    draftTitle: `Saved — ${title}`.slice(0, 120),
    machine: {
      kind: 'saved_item',
      itemId: id,
      title,
      itemKind: text(item.kind, 40) || null,
      author: text(item.author, 200) || null,
      url: text(item.url, 1000) || null,
      excerpt: text(item.excerpt, 1000),
      note: text(item.note, 4000),
      tags,
      state: text(item.state, 20) || null,
      sourceLens: text(item.sourceLens, 60) || null,
      refId: text(item.refId, 120) || null,
    },
  };
}

export interface PaperItemKeepInput {
  id?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
  url?: string | null;
  status?: string;
  abstract?: string;
  notes?: string;
  tags?: string[];
}

/** A library paper the item view already loaded. Null when it has no id or title. */
export function paperItemKeepRecord(paper: PaperItemKeepInput | null | undefined): KeptRecord | null {
  const title = text(paper?.title, 400);
  const id = text(paper?.id, 80);
  if (!paper || !title || !id) return null;
  const authors = (paper.authors || []).map((a) => text(a, 120)).filter(Boolean);
  const tags = (paper.tags || []).map((t) => text(t, 30)).filter(Boolean);
  const lines = [title, `Paper ${id}`];
  if (authors.length) lines.push(`Authors: ${authors.join(', ')}`);
  const year = typeof paper.year === 'number' && Number.isFinite(paper.year) ? paper.year : null;
  if (year != null) lines.push(`Year: ${year}`);
  pushField(lines, 'Venue', paper.venue, 200);
  pushField(lines, 'DOI', paper.doi, 120);
  pushField(lines, 'URL', paper.url, 600);
  pushField(lines, 'Status', paper.status, 20);
  pushField(lines, 'Abstract', paper.abstract, 6000);
  pushField(lines, 'Notes', paper.notes, 8000);
  if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
  return {
    title,
    body: lines.join('\n'),
    tags: ['paper', 'library'],
    source: 'paper-lens:paper',
    createdFrom: 'paper',
    draftTitle: `Paper — ${title}`.slice(0, 120),
    machine: {
      kind: 'paper',
      paperId: id,
      title,
      authors,
      year,
      venue: text(paper.venue, 200) || null,
      doi: text(paper.doi, 120) || null,
      url: text(paper.url, 600) || null,
      status: text(paper.status, 20) || null,
      abstract: text(paper.abstract, 6000),
      notes: text(paper.notes, 8000),
      tags,
    },
  };
}

/** One of the signed-in user's vault submissions. Null when it has no id or title. */
export function vaultSubmissionKeepRecord(work: VaultSubmissionKeepInput | null | undefined): KeptRecord | null {
  const title = text(work?.title, 300);
  const id = text(work?.id, 80);
  if (!work || !title || !id) return null;
  const lines = [title, `Submission ${id}`];
  pushField(lines, 'Kind', work.workKind, 40);
  pushField(lines, 'Status', work.status, 40);
  pushField(lines, 'Description', work.description, 4000);
  const workBody = text(work.body, 8000);
  if (workBody) {
    lines.push('Work:');
    lines.push(workBody);
  }
  pushField(lines, 'Decline reason', work.declineReason, 2000);
  pushField(lines, 'Curator statement', work.curatorStatement, 4000);
  const submittedAt = Number(work.submittedAt);
  return {
    title,
    body: lines.join('\n'),
    tags: ['vault', 'submission'],
    source: 'vault-lens:submission',
    createdFrom: 'vault',
    draftTitle: `Vault submission — ${title}`.slice(0, 120),
    machine: {
      kind: 'vault_submission',
      submissionId: id,
      title,
      status: text(work.status, 40) || null,
      workKind: text(work.workKind, 40) || null,
      description: text(work.description, 4000),
      body: workBody,
      submittedAt: Number.isFinite(submittedAt) ? submittedAt : null,
    },
  };
}

/** The private DTU for this record. Null when the record has no real text. */
export function recordDtuCall(record: KeptRecord | null | undefined): ReceiptCall | null {
  const title = text(record?.title, 80);
  const body = text(record?.body, 12000);
  if (!record || !title || !body) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title,
      tags: record.tags,
      source: record.source,
      visibility: 'private',
      content: body,
      human: { summary: body },
      core: { definitions: [title], claims: [body.slice(0, 240)] },
      machine: record.machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: record.createdFrom,
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

export interface RecordDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/**
 * Thread draft that cites the kept DTU. The draft body repeats the record
 * and names the DTU id. Null until that id is real.
 */
export function recordThreadDraftCall(record: KeptRecord | null | undefined, dtuId: string): ReceiptCall | null {
  const id = text(dtuId, 80);
  const body = text(record?.body, 24000);
  if (!record || !DTU_ID.test(id) || !body) return null;
  const cite = `\n\nDTU ${id}`;
  const content = body.length + cite.length <= 25000 ? `${body}${cite}` : body;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: text(record.draftTitle, 120) || record.title.slice(0, 120),
      content,
      platform: 'x',
      citedDtuId: id,
    },
  };
}

/** What the screen may claim. Null unless Thread stored a draft citing this DTU. */
export function recordThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): RecordDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = text(draft.id, 80);
  const cited = text(draft.citedDtuId, 80);
  const status = text(draft.status, 20);
  if (!draftId || cited !== text(dtuId, 80) || status !== 'draft') return null;
  if (!String(draft.content || '').includes(cited)) return null;
  return { draftId, status, citedDtuId: cited };
}
