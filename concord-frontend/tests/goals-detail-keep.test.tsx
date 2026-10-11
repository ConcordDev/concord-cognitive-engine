/**
 * Goals detail — the expanded goal keeps its real fields as a private DTU,
 * then drafts that DTU in Thread.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const goal = {
  title: 'Ship the vault',
  description: 'Move three records into Thread.',
  category: 'Career',
  progress: 0.5,
  priority: 'high',
  targetDate: '2026-12-01',
  subtasks: [{ id: 'st-0', label: 'Write keep', done: false }],
  xp: 200,
  milestones: [],
  status: 'active',
};

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    items: [{
      id: 'lart_goal_1',
      title: goal.title,
      data: goal,
      meta: { tags: [], status: 'active', visibility: 'private' },
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
      version: 1,
    }],
    create: vi.fn(),
    update: vi.fn(),
  }),
}));

import { GoalsListPanel } from '@/components/goals/GoalsListPanel';
import { goalKeepRecord, recordDtuCall, recordThreadDraftCall } from '@/components/lens/recordKeep';

const keep = () => screen.getByRole('button', { name: 'Keep as DTU' });
const draft = () => screen.getByRole('button', { name: /Draft in Thread/i });

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string, input?: { content?: string; citedDtuId?: string }) => {
    if (domain === 'dtu' && action === 'create') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_goal_1' } }, error: null } };
    }
    if (domain === 'dtu' && action === 'get') {
      return { data: { ok: true, result: { dtu: { id: 'dtu_goal_1' } }, error: null } };
    }
    if (domain === 'thread' && action === 'thread-draft') {
      return {
        data: {
          ok: true,
          result: {
            draft: {
              id: 'th_goal_1',
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

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GoalsListPanel />
    </QueryClientProvider>,
  );
}

describe('goals detail keep', () => {
  it('keeps the open goal as a private DTU, then drafts that DTU in Thread', async () => {
    renderPanel();
    expect(screen.queryByRole('button', { name: 'Keep as DTU' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ship the vault/ }));

    const record = goalKeepRecord({ id: 'lart_goal_1', ...goal });
    expect(record?.body).toContain('Ship the vault');
    expect(record?.body).toContain('Move three records into Thread.');
    expect(record?.body).toContain('Progress: 50%');
    expect(record?.body).toContain('Write keep');
    expect(record?.body).not.toMatch(/lorem|placeholder|Untitled/i);

    fireEvent.click(keep());
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_goal_1\./)).toBeTruthy());

    const created = lensRunMock.mock.calls.find((c) => c[0] === 'dtu' && c[1] === 'create');
    expect(created?.[2]).toEqual(recordDtuCall(record)?.input);
    expect((created?.[2] as { visibility?: string }).visibility).toBe('private');

    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(/Drafted in Thread as th_goal_1, citing dtu_goal_1\. Not posted\./)).toBeTruthy());
    const drafted = lensRunMock.mock.calls.find((c) => c[0] === 'thread' && c[1] === 'thread-draft');
    expect(drafted?.[2]).toEqual(recordThreadDraftCall(record, 'dtu_goal_1')?.input);
    expect(String((drafted?.[2] as { content?: string }).content)).toContain('DTU dtu_goal_1');
    expect((drafted?.[2] as { citedDtuId?: string }).citedDtuId).toBe('dtu_goal_1');
  });

  it('returns nothing to keep when the goal has no title', () => {
    expect(goalKeepRecord({ id: 'lart_x', title: '  ' })).toBeNull();
  });
});
