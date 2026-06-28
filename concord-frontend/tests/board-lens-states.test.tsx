/**
 * /lenses/board — four-UX-state contract for the real macro-backed
 * BoardWorkspace (the Trello/Asana surface that drives the board.* STATE
 * macros via boardMacro → lensRun). We mock the single backend channel
 * (lensRun) and pin:
 *   LOADING   — while board-list is in flight a spinner is shown.
 *   EMPTY     — board-list resolves to zero boards → an honest "No boards yet"
 *               create cue (NOT mistaken for an error).
 *   ERROR     — a board-list FAILURE ({ok:false}) surfaces a visible error +
 *               Retry — NOT a swallowed fetch that renders the same blank
 *               "empty" surface (the silent-empty regression this gate targets;
 *               BoardWorkspace previously ignored useBoardList's error).
 *   POPULATED — a real board + cards renders the columns/cards the component
 *               reads from the board-detail result (col.name, card.title).
 *
 * No fabricated data — every state is produced by a mocked lensRun standing in
 * for the real dispatch in the exact { data: { ok, result } } envelope it
 * returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── the one backend channel: lensRun (boardMacro wraps it) ──────────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

// Child modals are not under test here; keep them inert.
vi.mock('@/components/board/CardDetailModal', () => ({ CardDetailModal: () => null }));
vi.mock('@/components/board/BoardSettingsPanel', () => ({ BoardSettingsPanel: () => null }));

import { BoardWorkspace } from '@/components/board/BoardWorkspace';

// A board-list response carrying `boards`.
function listOk(boards: unknown[]) {
  return { data: { ok: true, result: { boards } } };
}
// A board-detail response carrying a full `board`.
function detailOk(board: unknown) {
  return { data: { ok: true, result: { board } } };
}

const SAMPLE_BOARD = {
  id: 'bd_1',
  name: 'Sprint Board',
  columns: [
    { id: 'col_todo', name: 'To Do' },
    { id: 'col_done', name: 'Done' },
  ],
  cards: [
    {
      id: 'crd_1',
      columnId: 'col_todo',
      title: 'Wire the lens',
      description: '',
      labels: [],
      dueDate: null,
      assignee: null,
      checklist: [],
      position: 0,
      createdAt: '2026-06-01T00:00:00Z',
    },
  ],
  labelDefs: [],
  automations: [],
  collaborators: [],
  customFields: [],
};

// Route a mock by macro name so list + detail can be answered independently.
function routeByName(handlers: Record<string, () => unknown>) {
  lensRun.mockImplementation((_domain: string, name: string) => {
    const h = handlers[name];
    if (h) return Promise.resolve(h());
    return Promise.resolve({ data: { ok: false, error: `unhandled ${name}` } });
  });
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('board workspace — LOADING', () => {
  it('shows a spinner while the board list is in flight', async () => {
    let resolve!: (v: unknown) => void;
    lensRun.mockReturnValue(new Promise((r) => { resolve = r; }));
    const utils = render(<BoardWorkspace />);
    await waitFor(() => expect(utils.container.querySelector('.animate-spin')).toBeTruthy());
    // settle
    resolve(listOk([]));
    await waitFor(() => expect(utils.container.querySelector('.animate-spin')).toBeFalsy());
  });
});

describe('board workspace — EMPTY', () => {
  it('zero boards renders the honest create cue, not an error', async () => {
    routeByName({ 'board-list': () => listOk([]) });
    const utils = render(<BoardWorkspace />);
    await waitFor(() => expect(utils.getByText(/No boards yet/i)).toBeInTheDocument());
    expect(utils.container.textContent).not.toMatch(/Could not load boards/i);
  });
});

describe('board workspace — ERROR (not swallowed → silent empty)', () => {
  it('a failed board-list surfaces a visible error + Retry, not the empty cue', async () => {
    routeByName({ 'board-list': () => ({ data: { ok: false, error: 'boards offline' } }) });
    const utils = render(<BoardWorkspace />);
    await waitFor(() => expect(utils.getByText(/Could not load boards/i)).toBeInTheDocument());
    expect(utils.getByText(/boards offline/i)).toBeInTheDocument();
    expect(utils.getByText('Retry')).toBeInTheDocument();
    // the empty/idle cue must NOT also render (that was the silent-empty bug).
    expect(utils.container.textContent).not.toMatch(/No boards yet/i);
  });

  it('a thrown request is caught and surfaced, not swallowed into a blank panel', async () => {
    lensRun.mockRejectedValue(new Error('network down'));
    const utils = render(<BoardWorkspace />);
    // boardMacro catches the throw → {ok:false,error:'network down'} → list error.
    await waitFor(() => expect(utils.getByText(/Could not load boards/i)).toBeInTheDocument());
    expect(utils.getByText(/network down/i)).toBeInTheDocument();
  });
});

describe('board workspace — POPULATED', () => {
  it('renders the columns + cards the component reads from board-detail', async () => {
    routeByName({
      'board-list': () => listOk([{ id: 'bd_1', name: 'Sprint Board', columnCount: 2, cardCount: 1, createdAt: '' }]),
      'board-detail': () => detailOk(SAMPLE_BOARD),
    });
    const utils = render(<BoardWorkspace />);
    // auto-selects the first board → loads detail → renders columns + the card.
    await waitFor(() => expect(utils.getByText('Wire the lens')).toBeInTheDocument());
    expect(utils.getByText('To Do')).toBeInTheDocument();
    expect(utils.getByText('Done')).toBeInTheDocument();
  });
});
