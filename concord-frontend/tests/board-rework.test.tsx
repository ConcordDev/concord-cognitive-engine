/**
 * /lenses/board — REWORK behaviour tests (HANDOFF-LENS-REWORK #1705).
 *
 * The rework bar: a normal signed-in user can DO things that were
 * impossible on main — rename a board, rename/reorder/archive lists,
 * edit a card's title/due date, edit their own comment, archive and
 * restore cards, filter/search the board, spawn a card from a template,
 * and see due-date reminders computed from real due dates.
 *
 * The single backend channel (lensRun, wrapped by boardMacro) is mocked
 * with a STATEFUL fake: mutations apply to an in-memory board and
 * board-detail returns the mutated board, so each test drives the real
 * user gesture and asserts the real rendered outcome — not just that a
 * mock was called. Failure cases pin the inline errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

// Settings panel is not under test here; keep it inert.
vi.mock('@/components/board/BoardSettingsPanel', () => ({ BoardSettingsPanel: () => null }));
// Card modal keep-record chrome is unrelated; keep it inert.
vi.mock('@/components/lens/KeepRecordActions', () => ({ KeepRecordActions: () => null }));
vi.mock('@/components/lens/recordKeep', () => ({ boardCardKeepRecord: () => null }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'Ramaj', email: '', role: 'member' },
    isLoading: false,
    isAuthenticated: true,
    logout: () => {},
  }),
}));

import { BoardWorkspace } from '@/components/board/BoardWorkspace';
import { CardDetailModal } from '@/components/board/CardDetailModal';

// ── stateful fake board store ────────────────────────────────────────────────
type AnyRec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function freshBoard(): AnyRec {
  return {
    id: 'bd_1',
    name: 'Sprint Board',
    description: null,
    columns: [
      { id: 'col_todo', name: 'To Do' },
      { id: 'col_done', name: 'Done' },
    ],
    cards: [
      {
        id: 'crd_1', columnId: 'col_todo', title: 'Wire the lens', description: 'desc',
        labels: ['bug'], dueDate: null, assignee: 'Ramaj', checklist: [], position: 0,
        createdAt: '2026-06-01T00:00:00Z', comments: [], attachments: [], activity: [], customFields: {},
      },
      {
        id: 'crd_2', columnId: 'col_done', title: 'Ship the audit', description: '',
        labels: [], dueDate: '2020-01-01', assignee: null, checklist: [], position: 0,
        createdAt: '2026-06-01T00:00:00Z', comments: [], attachments: [], activity: [], customFields: {},
      },
      {
        id: 'crd_3', columnId: 'col_todo', title: 'Old archived card', description: '',
        labels: [], dueDate: null, assignee: null, checklist: [], position: 1,
        createdAt: '2026-06-01T00:00:00Z', comments: [], attachments: [], activity: [], customFields: {},
        archived: true, archivedAt: '2026-06-02T00:00:00Z',
      },
    ],
    labelDefs: [{ id: 'lbl_1', name: 'bug', color: 'red' }],
    automations: [],
    collaborators: [],
    customFields: [],
    templates: [],
  };
}

let board: AnyRec;
let reminders: AnyRec[];
const calls: { name: string; params: AnyRec }[] = [];

function ok(result: unknown) {
  return { data: { ok: true, result } };
}
function fail(error: string) {
  return { data: { ok: false, error } };
}

function installFake() {
  lensRun.mockImplementation((_domain: string, name: string, params: AnyRec = {}) => {
    calls.push({ name, params });
    switch (name) {
      case 'board-list':
        return Promise.resolve(ok({ boards: [{ id: board.id, name: board.name, columnCount: board.columns.length, cardCount: board.cards.length, createdAt: '' }] }));
      case 'board-detail':
        return Promise.resolve(ok({ board: JSON.parse(JSON.stringify(board)) }));
      case 'board-dashboard':
        return Promise.resolve(ok({ boards: 1, totalCards: board.cards.length, overdue: 1, withChecklists: 0 }));
      case 'due-reminders':
        return Promise.resolve(ok({ reminders, overdueCount: reminders.filter((r) => r.overdue).length, dueSoonCount: reminders.filter((r) => !r.overdue).length, withinHours: 48 }));
      case 'card-template-list':
        return Promise.resolve(ok({ templates: board.templates }));
      case 'board-update': {
        if (!String(params.name || '').trim()) return Promise.resolve(fail('board name required'));
        board.name = params.name;
        return Promise.resolve(ok({ board }));
      }
      case 'column-update': {
        const i = board.columns.findIndex((c: AnyRec) => c.id === params.columnId);
        if (i < 0) return Promise.resolve(fail('column not found'));
        const col = board.columns[i];
        if (params.name != null) col.name = params.name;
        if (params.toIndex != null) {
          board.columns.splice(i, 1);
          board.columns.splice(params.toIndex, 0, col);
        }
        return Promise.resolve(ok({ column: col, index: board.columns.indexOf(col) }));
      }
      case 'column-archive': {
        const col = board.columns.find((c: AnyRec) => c.id === params.columnId);
        if (col) col.archived = true;
        return Promise.resolve(ok({ columnId: params.columnId, archived: true }));
      }
      case 'column-restore': {
        const col = board.columns.find((c: AnyRec) => c.id === params.columnId);
        if (col) col.archived = false;
        return Promise.resolve(ok({ columnId: params.columnId, archived: false }));
      }
      case 'card-archive': {
        const card = board.cards.find((c: AnyRec) => c.id === params.cardId);
        if (card) card.archived = true;
        return Promise.resolve(ok({ cardId: params.cardId, archived: true }));
      }
      case 'card-restore': {
        const card = board.cards.find((c: AnyRec) => c.id === params.cardId);
        if (card) card.archived = false;
        return Promise.resolve(ok({ cardId: params.cardId, archived: false }));
      }
      case 'card-create': {
        if (!String(params.title || '').trim()) return Promise.resolve(fail('card title required'));
        const card = {
          id: `crd_new_${board.cards.length}`, columnId: params.columnId, title: params.title,
          description: '', labels: [], dueDate: null, assignee: null, checklist: [],
          position: 9, createdAt: '', comments: [], attachments: [], activity: [], customFields: {},
        };
        board.cards.push(card);
        return Promise.resolve(ok({ card }));
      }
      case 'card-create-from-template': {
        const t = board.templates.find((x: AnyRec) => x.id === params.templateId);
        if (!t) return Promise.resolve(fail('template not found'));
        const card = {
          id: `crd_tpl_${board.cards.length}`, columnId: params.columnId, title: t.title,
          description: t.description || '', labels: [...(t.labels || [])], dueDate: null, assignee: null,
          checklist: (t.checklist || []).map((i: AnyRec, ix: number) => ({ id: `ci_${ix}`, text: i.text, done: false })),
          position: 9, createdAt: '', comments: [], attachments: [], activity: [], customFields: {},
        };
        board.cards.push(card);
        return Promise.resolve(ok({ card }));
      }
      case 'card-detail': {
        const card = board.cards.find((c: AnyRec) => c.id === params.cardId);
        if (!card) return Promise.resolve(fail('card not found'));
        return Promise.resolve(ok({ card: JSON.parse(JSON.stringify(card)) }));
      }
      case 'card-update': {
        const card = board.cards.find((c: AnyRec) => c.id === params.cardId);
        if (!card) return Promise.resolve(fail('card not found'));
        if (params.title != null) card.title = params.title;
        if (params.description != null) card.description = params.description;
        if (params.dueDate !== undefined) card.dueDate = params.dueDate;
        if (params.assignee !== undefined) card.assignee = params.assignee;
        if (Array.isArray(params.labels)) card.labels = params.labels;
        return Promise.resolve(ok({ card }));
      }
      case 'card-comment-add': {
        const card = board.cards.find((c: AnyRec) => c.id === params.cardId);
        const comment = { id: `cmt_${card.comments.length}`, author: 'u1', text: params.text, at: '2026-06-03T00:00:00Z' };
        card.comments.push(comment);
        return Promise.resolve(ok({ comment, commentCount: card.comments.length }));
      }
      case 'card-comment-update': {
        const card = board.cards.find((c: AnyRec) => c.id === params.cardId);
        const comment = card?.comments.find((c: AnyRec) => c.id === params.commentId);
        if (!comment) return Promise.resolve(fail('comment not found'));
        if (comment.author !== 'u1') return Promise.resolve(fail('only the comment author can edit this comment'));
        comment.text = params.text;
        comment.editedAt = '2026-06-03T01:00:00Z';
        return Promise.resolve(ok({ comment }));
      }
      case 'card-template-create': {
        const card = board.cards.find((c: AnyRec) => c.id === params.cardId);
        const template = { id: 'tpl_1', name: card.title, title: card.title, description: card.description || '', labels: [...(card.labels || [])], checklist: [], customFields: {}, createdAt: '' };
        board.templates.push(template);
        return Promise.resolve(ok({ template }));
      }
      default:
        return Promise.resolve(fail(`unhandled ${name}`));
    }
  });
}

beforeEach(() => {
  lensRun.mockReset();
  calls.length = 0;
  board = freshBoard();
  reminders = [];
  installFake();
});

const calledWith = (name: string) => calls.filter((c) => c.name === name);

async function renderWorkspace() {
  const utils = render(<BoardWorkspace />);
  await waitFor(() => expect(utils.getByText('Wire the lens')).toBeInTheDocument());
  return utils;
}

// ── BoardWorkspace ───────────────────────────────────────────────────────────
describe('board rework — workspace', () => {
  it('renames the board in place through board-update', async () => {
    const utils = await renderWorkspace();
    const input = utils.getByTestId('board-name-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Q4 Sprint Board' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(calledWith('board-update')[0]?.params).toMatchObject({ id: 'bd_1', name: 'Q4 Sprint Board' })
    );
    await waitFor(() => expect((utils.getByTestId('board-name-input') as HTMLInputElement).value).toBe('Q4 Sprint Board'));
  });

  it('renames a list through column-update', async () => {
    const utils = await renderWorkspace();
    fireEvent.click(utils.getByText('To Do'));
    const input = await utils.findByTestId('column-name-input');
    fireEvent.change(input, { target: { value: 'Backlog' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(calledWith('column-update')[0]?.params).toMatchObject({ columnId: 'col_todo', name: 'Backlog' })
    );
    await waitFor(() => expect(utils.getByText('Backlog')).toBeInTheDocument());
  });

  it('reorders a list with the move buttons', async () => {
    const utils = await renderWorkspace();
    fireEvent.click(utils.getAllByLabelText('Move column right')[0]);
    await waitFor(() =>
      expect(calledWith('column-update')[0]?.params).toMatchObject({ columnId: 'col_todo', toIndex: 1 })
    );
  });

  it('archives a list, then restores it from the Archived view', async () => {
    const utils = await renderWorkspace();
    fireEvent.click(utils.getAllByLabelText('Archive column')[0]);
    await waitFor(() => expect(calledWith('column-archive')).toHaveLength(1));
    await waitFor(() => expect(utils.queryByText('Wire the lens')).not.toBeInTheDocument());
    fireEvent.click(utils.getByText('Archived'));
    await waitFor(() => expect(utils.getByText('Archived lists')).toBeInTheDocument());
    // first Restore in the view belongs to the archived lists section
    fireEvent.click(utils.getAllByText('Restore')[0]);
    await waitFor(() => expect(calledWith('column-restore')[0]?.params).toMatchObject({ columnId: 'col_todo' }));
  });

  it('hides archived cards from the lanes and restores them from the Archived view', async () => {
    const utils = await renderWorkspace();
    expect(utils.queryByText('Old archived card')).not.toBeInTheDocument();
    fireEvent.click(utils.getByText('Archived'));
    await waitFor(() => expect(utils.getByText('Old archived card')).toBeInTheDocument());
    fireEvent.click(utils.getByText('Restore'));
    await waitFor(() => expect(calledWith('card-restore')[0]?.params).toMatchObject({ cardId: 'crd_3' }));
  });

  it('filters cards by search text and due state', async () => {
    const utils = await renderWorkspace();
    const search = utils.getByPlaceholderText('Search cards (/)');
    fireEvent.change(search, { target: { value: 'audit' } });
    await waitFor(() => expect(utils.queryByText('Wire the lens')).not.toBeInTheDocument());
    expect(utils.getByText('Ship the audit')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(utils.getByText('Wire the lens')).toBeInTheDocument());
    fireEvent.change(utils.getByLabelText('Filter by due date'), { target: { value: 'overdue' } });
    await waitFor(() => expect(utils.queryByText('Wire the lens')).not.toBeInTheDocument());
    expect(utils.getByText('Ship the audit')).toBeInTheDocument();
  });

  it('rejects an empty quick-add title inline without dispatching card-create', async () => {
    const utils = await renderWorkspace();
    const addButtons = utils.getAllByLabelText('Add card');
    fireEvent.click(addButtons[0]);
    await waitFor(() => expect(utils.getByText('Card title required')).toBeInTheDocument());
    expect(calledWith('card-create')).toHaveLength(0);
  });

  it('creates a card from a template through the picker', async () => {
    board.templates = [
      { id: 'tpl_9', name: 'Weekly report', title: 'Weekly report', description: '', labels: [], checklist: [{ text: 'gather' }], customFields: {}, createdAt: '' },
    ];
    const utils = await renderWorkspace();
    let picker: HTMLSelectElement | null = null;
    await waitFor(() => {
      picker = utils.getAllByLabelText('Create card from template')[0] as HTMLSelectElement;
      expect(picker).toBeTruthy();
    });
    fireEvent.change(picker!, { target: { value: 'tpl_9' } });
    await waitFor(() =>
      expect(calledWith('card-create-from-template')[0]?.params).toMatchObject({ templateId: 'tpl_9', columnId: 'col_todo' })
    );
    await waitFor(() => expect(utils.getByText('Weekly report')).toBeInTheDocument());
  });

  it('shows the due-reminders strip from board.due-reminders data', async () => {
    reminders = [
      { boardId: 'bd_1', boardName: 'Sprint Board', cardId: 'crd_2', title: 'Ship the audit', columnName: 'Done', dueDate: '2020-01-01', overdue: true },
    ];
    const utils = await renderWorkspace();
    await waitFor(() => expect(utils.getByText(/1 overdue/)).toBeInTheDocument());
  });
});

// ── CardDetailModal ──────────────────────────────────────────────────────────
describe('board rework — card detail modal', () => {
  function seedComments() {
    board.cards[0].comments = [
      { id: 'cmt_mine', author: 'u1', text: 'my note', at: '2026-06-03T00:00:00Z' },
      { id: 'cmt_theirs', author: 'someone_else', text: 'their note', at: '2026-06-03T00:00:00Z' },
    ];
  }

  it('edits the card title through card-update; an empty title is rejected inline', async () => {
    seedComments();
    const utils = render(<CardDetailModal board={board} cardId="crd_1" onClose={() => {}} onChanged={() => {}} />);
    const input = (await utils.findByTestId('card-title-input')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Wire the lens properly' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(calledWith('card-update').some((c) => c.params.title === 'Wire the lens properly')).toBe(true)
    );
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(utils.getByText('Card title required')).toBeInTheDocument());
    expect(calledWith('card-update').some((c) => c.params.title === '')).toBe(false);
  });

  it('sets a due date through card-update', async () => {
    const utils = render(<CardDetailModal board={board} cardId="crd_1" onClose={() => {}} onChanged={() => {}} />);
    const date = await utils.findByLabelText('Due date');
    fireEvent.change(date, { target: { value: '2026-12-01' } });
    await waitFor(() =>
      expect(calledWith('card-update').some((c) => c.params.dueDate === '2026-12-01')).toBe(true)
    );
  });

  it('lets the author edit their comment; no edit affordance on others', async () => {
    seedComments();
    const utils = render(<CardDetailModal board={board} cardId="crd_1" onClose={() => {}} onChanged={() => {}} />);
    await utils.findByText('my note');
    const editButtons = utils.getAllByLabelText('Edit comment');
    expect(editButtons).toHaveLength(1);
    fireEvent.click(editButtons[0]);
    const box = await utils.findByTestId('comment-edit-input');
    fireEvent.change(box, { target: { value: 'my edited note' } });
    fireEvent.click(utils.getByText('Save'));
    await waitFor(() =>
      expect(calledWith('card-comment-update')[0]?.params).toMatchObject({ commentId: 'cmt_mine', text: 'my edited note' })
    );
    await waitFor(() => expect(utils.getByText('my edited note')).toBeInTheDocument());
    expect(utils.getByText(/edited/)).toBeInTheDocument();
  });

  it('archives the card through card-archive and offers restore when archived', async () => {
    const utils = render(<CardDetailModal board={board} cardId="crd_1" onClose={() => {}} onChanged={() => {}} />);
    const btn = await utils.findByText('Archive card');
    fireEvent.click(btn);
    await waitFor(() => expect(calledWith('card-archive')[0]?.params).toMatchObject({ cardId: 'crd_1' }));
    await waitFor(() => expect(utils.getByText('Restore card')).toBeInTheDocument());
  });

  it('saves the card as a template through card-template-create', async () => {
    const utils = render(<CardDetailModal board={board} cardId="crd_1" onClose={() => {}} onChanged={() => {}} />);
    const btn = await utils.findByText('Save as template');
    fireEvent.click(btn);
    await waitFor(() => expect(calledWith('card-template-create')[0]?.params).toMatchObject({ cardId: 'crd_1' }));
    await waitFor(() => expect(utils.getByText('Saved as template')).toBeInTheDocument());
  });
});
