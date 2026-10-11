/**
 * Board card detail — Keep as DTU, then Draft in Thread.
 * The DTU payload is the card the detail modal already loaded.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WsBoard, WsCard } from '@/components/board/workspace-types';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { CardDetailModal } from '@/components/board/CardDetailModal';
import { boardCardKeepRecord, recordDtuCall, recordThreadDraftCall } from '@/components/lens/recordKeep';

const board = {
  id: 'brd_1',
  name: 'Proof Board',
  columns: [{ id: 'col_1', name: 'To Do' }],
  cards: [],
  createdAt: '2026-10-11T00:00:00.000Z',
} as WsBoard;

const card = {
  id: 'crd_1',
  columnId: 'col_1',
  title: 'Proof card',
  description: 'Ship the checklist',
  labels: ['frontend'],
  dueDate: '2026-11-01',
  assignee: 'alex',
  checklist: [{ id: 'ci_1', text: 'Write keep', done: true }],
  position: 0,
  createdAt: '2026-10-11T00:00:00.000Z',
  comments: [{ id: 'cmt_1', author: 'alex', text: 'Looks right', at: '2026-10-11T00:00:00.000Z' }],
  attachments: [{ id: 'att_1', name: 'Spec', url: 'https://example.com/spec', kind: 'link', at: '2026-10-11T00:00:00.000Z' }],
} as WsCard;

const keep = () => screen.getByRole('button', { name: 'Keep as DTU' });
const draft = () => screen.getByRole('button', { name: 'Draft in Thread' });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string, input?: { content?: string; citedDtuId?: string }) => {
    if (domain === 'board' && action === 'card-detail') {
      return { data: { ok: true, result: { card }, error: null } };
    }
    if (domain === 'dtu' && action === 'create') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_card_1' } }, error: null } };
    }
    if (domain === 'dtu' && action === 'get') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_card_1' } }, error: null } };
    }
    if (domain === 'thread' && action === 'thread-draft') {
      return {
        data: {
          ok: true,
          result: {
            draft: {
              id: 'th_card_1',
              status: 'draft',
              citedDtuId: input?.citedDtuId,
              content: input?.content,
            },
          },
          error: null,
        },
      };
    }
    return { data: { ok: true, result: {}, error: null } };
  });
});

describe('board card detail keep', () => {
  it('keeps the loaded card as a private DTU, then drafts that DTU in Thread', async () => {
    render(
      <CardDetailModal board={board} cardId={card.id} onClose={() => {}} onChanged={() => {}} />,
    );
    await waitFor(() => expect(keep()).toBeTruthy());
    expect(draft()).toBeDisabled();

    const record = boardCardKeepRecord(card, board);
    expect(record?.body).toContain('Proof card');
    expect(record?.body).toContain('Ship the checklist');
    expect(record?.body).toContain('Write keep');
    expect(record?.body).toContain('Looks right');
    expect(record?.body).not.toMatch(/lorem|placeholder|Untitled/i);

    fireEvent.click(keep());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_card_1\./)).toBeTruthy());

    const created = lensRunMock.mock.calls.find((c) => c[0] === 'dtu' && c[1] === 'create');
    expect(created?.[2]).toEqual(recordDtuCall(record)?.input);
    expect((created?.[2] as { visibility?: string }).visibility).toBe('private');
    expect(String((created?.[2] as { human?: { summary?: string } }).human?.summary)).toContain('Ship the checklist');

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_card_1, citing dtu_card_1\. Not posted\./)).toBeTruthy());

    const drafted = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect(drafted?.[2]).toEqual(recordThreadDraftCall(record, 'dtu_card_1')?.input);
    expect((drafted?.[2] as { citedDtuId?: string }).citedDtuId).toBe('dtu_card_1');
    expect(String((drafted?.[2] as { content?: string }).content)).toContain('DTU dtu_card_1');
    expect(String((drafted?.[2] as { content?: string }).content)).toContain('Proof card');
  });

  it('does not claim a save when the read-back misses', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'board' && action === 'card-detail') {
        return { data: { ok: true, result: { card }, error: null } };
      }
      if (domain === 'dtu' && action === 'create') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_card_1' } }, error: null } };
      }
      if (domain === 'dtu' && action === 'get') {
        return { data: { ok: true, result: { dtu: { id: 'dtu_other' } }, error: null } };
      }
      return { data: { ok: true, result: {}, error: null } };
    });
    render(
      <CardDetailModal board={board} cardId={card.id} onClose={() => {}} onChanged={() => {}} />,
    );
    await waitFor(() => expect(keep()).toBeTruthy());
    fireEvent.click(keep());
    await waitFor(() => expect(screen.getByText(/read-back did not return it/)).toBeTruthy());
    expect(draft()).toBeDisabled();
  });
});
