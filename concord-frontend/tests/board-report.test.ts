import { describe, it, expect } from 'vitest';
import {
  boardSentence,
  boardBody,
  boardDtuCall,
  boardThreadDraftCall,
  boardThreadDraftOutcome,
  indexBoardDrafts,
  type BoardReportFacts,
} from '@/components/board/boardReport';
import type { WsBoard } from '@/components/board/workspace-types';

const board: WsBoard = {
  id: 'bd_1',
  name: 'Proof Board',
  columns: [
    { id: 'col_1', name: 'To Do' },
    { id: 'col_2', name: 'In Progress' },
    { id: 'col_3', name: 'Done' },
  ],
  cards: [
    {
      id: 'crd_1',
      columnId: 'col_1',
      title: 'Ship proof',
      description: 'Real card',
      labels: ['frontend'],
      dueDate: '2026-11-01',
      assignee: 'alex',
      checklist: [],
      position: 0,
      createdAt: '2026-10-05T00:00:00.000Z',
    },
  ],
  createdAt: '2026-10-05T00:00:00.000Z',
};

const facts: BoardReportFacts = { board };

describe('board report', () => {
  it('states only the figures the backend reported', () => {
    const s = boardSentence(facts)!;
    expect(s).toContain('Proof Board');
    expect(s).toContain('3 columns');
    expect(s).toContain('1 card');
  });

  it('refuses to summarise a board with no id, name, or columns', () => {
    expect(boardSentence({ board: null })).toBeNull();
    expect(boardSentence({ board: { id: '', name: 'x', columns: [], cards: [] } })).toBeNull();
    expect(boardSentence({ board: { id: 'bd_1', name: '', columns: [{ id: 'c', name: 'To Do' }], cards: [] } })).toBeNull();
    expect(boardSentence({ board: { id: 'bd_1', name: 'x', columns: [], cards: [] } })).toBeNull();
    expect(boardBody({ board: null })).toBe('');
    expect(boardDtuCall({ board: null })).toBeNull();
  });

  it('builds a private DTU call that cites the real board', () => {
    const call = boardDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('board-lens:board-report');
    expect(call.input.meta.visibility).toBe('private');
    expect((call.input.machine as Record<string, unknown>).kind).toBe('board_lens_board_report');
    expect((call.input.machine as Record<string, unknown>).boardId).toBe('bd_1');
  });

  it('builds a Thread draft call that cites the DTU id', () => {
    const call = boardThreadDraftCall(facts, 'dtu_abc')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc');
  });

  it('refuses a Thread draft call with no DTU id', () => {
    expect(boardThreadDraftCall(facts, '')).toBeNull();
    expect(boardThreadDraftCall(facts, ' ')).toBeNull();
    expect(boardThreadDraftCall({ board: null }, 'dtu_abc')).toBeNull();
  });

  it('accepts a real draft outcome that cites the right DTU and stays draft', () => {
    const outcome = boardThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'drf_1', status: 'draft', citedDtuId: 'dtu_abc' } } },
      'dtu_abc',
    )!;
    expect(outcome.draftId).toBe('drf_1');
    expect(outcome.status).toBe('draft');
    expect(outcome.citedDtuId).toBe('dtu_abc');
  });

  it('rejects a draft outcome that does not cite the same DTU or is not draft', () => {
    expect(boardThreadDraftOutcome({ ok: true, result: { draft: { id: 'drf_1', status: 'draft', citedDtuId: 'other' } } }, 'dtu_abc')).toBeNull();
    expect(boardThreadDraftOutcome({ ok: true, result: { draft: { id: 'drf_1', status: 'posted', citedDtuId: 'dtu_abc' } } }, 'dtu_abc')).toBeNull();
    expect(boardThreadDraftOutcome({ ok: false }, 'dtu_abc')).toBeNull();
    expect(boardThreadDraftOutcome({ ok: true, result: {} }, 'dtu_abc')).toBeNull();
  });

  it('indexes drafts by the DTU they cite', () => {
    const idx = indexBoardDrafts([
      { ok: true, result: { draft: { id: 'drf_1', status: 'draft', citedDtuId: 'dtu_a' } } },
      { ok: true, result: { draft: { id: 'drf_2', status: 'draft', citedDtuId: 'dtu_b' } } },
      { ok: true, result: { draft: { id: 'drf_3', status: 'draft', citedDtuId: 'dtu_a' } } },
    ]);
    expect(idx.dtu_a).toBe('drf_1');
    expect(idx.dtu_b).toBe('drf_2');
  });
});