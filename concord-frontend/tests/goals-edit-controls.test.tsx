// FIX-goals-010 — edit controls for challenges and OKR objectives,
// plus the save-as-DTU scope/privacy line.
//  1. ChallengesPanel: Edit prefills the form; Save changes calls
//     update with the challenge id (progress preserved).
//  2. OKRWorkspace alignment tree: Edit loads the objective into the
//     form; Save Objective upserts WITH the id.
//  3. SaveAsDtuButton's confirm modal states the effective scope and
//     license scopes in plain words before saving.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const updateChallengeMock = vi.fn(async () => ({}));
const createChallengeMock = vi.fn(async () => ({}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [{
      id: 'ch1', title: 'Meditate',
      data: {
        title: 'Meditate', description: 'Daily sit', type: 'daily', difficulty: 'Easy',
        xp: 50, progress: 3, target: 7, deadline: '', accepted: true,
      },
    }],
    isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: createChallengeMock, update: updateChallengeMock, remove: vi.fn(async () => ({})),
  }),
}));
vi.mock('framer-motion', () => {
  const cache = new Map<string, React.ComponentType<Record<string, unknown>>>();
  const anyMotion = new Proxy({}, {
    get: (_t, tag: string) => {
      if (!cache.has(tag)) {
        cache.set(tag, (p: Record<string, unknown>) => {
          const { initial, animate, exit, transition, ...rest } = p as Record<string, unknown>;
          void initial; void animate; void exit; void transition;
          const Tag = tag as keyof JSX.IntrinsicElements;
          return <Tag {...(rest as Record<string, unknown>)} />;
        });
      }
      return cache.get(tag);
    },
  });
  return {
    motion: anyMotion,
    AnimatePresence: (p: { children?: React.ReactNode }) => <>{p.children}</>,
  };
});

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { dtus: { create: vi.fn(async () => ({ data: { ok: true, id: 'dtu_x' } })), delete: vi.fn(async () => ({ data: { ok: true } })) } },
}));
vi.mock('@/components/viz/ChartKit', () => ({ ChartKit: () => null }));

import { ChallengesPanel } from '@/components/goals/ChallengesPanel';
import { OKRWorkspace } from '@/components/goals/OKRWorkspace';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

const OBJECTIVE = {
  id: 'obj_1', title: 'Grow revenue', parentId: null, owner: null, team: 'Growth',
  level: 'company', keyResults: ['10 signups'], progress: 40, progressSource: 'rollup',
  blockedBy: [], children: [],
};

beforeEach(() => {
  updateChallengeMock.mockClear(); createChallengeMock.mockClear();
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_d: string, name: string, input: Record<string, unknown>) => {
    if (name === 'alignmentTree' && input?.op === 'list') {
      return { data: { ok: true, result: { flat: [OBJECTIVE], tree: [OBJECTIVE], stats: { objectiveCount: 1, rootCount: 1, maxDepth: 1, keyResultsLinked: 1 } } } };
    }
    if (name === 'alignmentTree') return { data: { ok: true, result: { flat: [OBJECTIVE], tree: [OBJECTIVE], stats: null } } };
    return { data: { ok: true, result: {} } };
  });
});
afterEach(() => cleanup());

describe('goals edit controls', () => {
  it('challenge edit prefills and saves via update, preserving progress', async () => {
    render(<ChallengesPanel />);
    const edit = await screen.findByRole('button', { name: 'Edit challenge Meditate' });
    await act(async () => { fireEvent.click(edit); });
    const save = await screen.findByRole('button', { name: 'Save changes' });
    const titleInput = screen.getByPlaceholderText(/Challenge title/);
    expect((titleInput as HTMLInputElement).value).toBe('Meditate');
    await act(async () => { fireEvent.change(titleInput, { target: { value: 'Meditate daily' } }); });
    await act(async () => { fireEvent.click(save); });
    expect(updateChallengeMock).toHaveBeenCalledTimes(1);
    const [id, payload] = updateChallengeMock.mock.calls[0] as unknown as [string, { data: Record<string, unknown> }];
    expect(id).toBe('ch1');
    expect(payload.data.title).toBe('Meditate daily');
    expect(payload.data.progress).toBe(3);
    expect(createChallengeMock).not.toHaveBeenCalled();
  });

  it('objective edit loads the form and upserts with the id', async () => {
    render(<OKRWorkspace />);
    const edit = await screen.findByRole('button', { name: 'Edit objective Grow revenue' });
    await act(async () => { fireEvent.click(edit); });
    const titleInput = screen.getByPlaceholderText('Objective title');
    expect((titleInput as HTMLInputElement).value).toBe('Grow revenue');
    await act(async () => { fireEvent.change(titleInput, { target: { value: 'Grow revenue 2x' } }); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Objective' })); });
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'alignmentTree' && (c[2] as { op?: string })?.op === 'upsert');
    expect((call?.[2] as { id?: string; title?: string })?.id).toBe('obj_1');
    expect((call?.[2] as { title?: string })?.title).toBe('Grow revenue 2x');
  });

  it('save-as-DTU modal states scope and license before saving', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SaveAsDtuButton apiSource="reddit-goals" title="Top posts" content="hello" />
      </QueryClientProvider>,
    );
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as DTU' })); });
    expect(await screen.findByText(/will be saved as Private — only you can see it/)).toBeTruthy();
    expect(screen.getByText(/License scopes: private/)).toBeTruthy();
  });
});
