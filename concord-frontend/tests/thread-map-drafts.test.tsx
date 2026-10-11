import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.hoisted(() => vi.fn());
const lensData = vi.hoisted(() => vi.fn());
const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'ram' } }) }));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => lensData(),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync }),
}));

import { ThreadMapPanel } from '@/components/thread/ThreadMapPanel';

function emptyLensData() {
  lensData.mockReturnValue({
    items: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  });
}

describe('Thread Map drafts', () => {
  beforeEach(() => {
    lensRun.mockReset();
    mutateAsync.mockReset();
    emptyLensData();
    mutateAsync.mockResolvedValue({ ok: true, result: {} });
  });

  it('shows a Composer link instead of an empty selection when drafts exist', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (domain === 'thread' && action === 'draft-list') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              drafts: [
                { id: 'th_1', title: 'Harbor notes' },
                { id: 'th_2', title: 'Second draft' },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: false, error: 'unexpected' } });
    });
    const onOpenComposer = vi.fn();
    render(<ThreadMapPanel onOpenComposer={onOpenComposer} />);
    const link = await screen.findByRole('button', { name: 'Drafts (2) -> Composer' });
    expect(screen.queryByText('No thread selected')).not.toBeInTheDocument();
    expect(screen.getByText('Harbor notes')).toBeInTheDocument();
    expect(screen.getByText('Second draft')).toBeInTheDocument();
    fireEvent.click(link);
    expect(onOpenComposer).toHaveBeenCalledTimes(1);
  });

  it('keeps the empty selection when there are no drafts', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { drafts: [] } } });
    render(<ThreadMapPanel />);
    expect(await screen.findByText('No thread selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Drafts \(/ })).not.toBeInTheDocument();
  });

  it('renders a selected thread across tree, timeline, and linear and runs analysis', async () => {
    lensData.mockReturnValue({
      items: [{
        id: 'thr_1',
        title: 'Branch talk',
        ownerId: 'u1',
        data: {
          nodes: [
            { id: 'n1', parentNodeId: null, content: 'Root hello', authorId: 'u1', createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'n2', parentNodeId: 'n1', content: 'Child reply', authorId: 'u2', createdAt: '2026-01-01T00:01:00.000Z', type: 'merge' },
          ],
        },
        meta: { tags: [], status: 'active', visibility: 'private' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        version: 1,
      }],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      create: vi.fn(async () => ({ artifact: { id: 'thr_new' } })),
      remove: vi.fn(async () => ({})),
    });
    mutateAsync.mockImplementation(async (input: { action: string }) => {
      const results: Record<string, Record<string, unknown>> = {
        summarize: { summary: { nodeCount: 2, authorCount: 2, totalWords: 3, branchCount: 1, mergeCount: 1, decisionCount: 0, avgNodeLength: 2, timeline: { first: 'a', last: 'b' } } },
        threadAnalyze: { messageCount: 2, participants: 2, avgMessageLength: 10, avgResponseMinutes: 1, peakActivityHour: 9, threadDuration: '1m' },
        sentimentMap: { overallTone: 'positive', avgSentiment: 0.4, positiveMessages: 1, negativeMessages: 0, neutralMessages: 1 },
        participantStats: { totalParticipants: 2, totalMessages: 2, participants: [{ name: 'You', messageCount: 1, sharePercent: 50 }], mostActive: 'You' },
        topicExtract: { dominantTopic: 'harbor', topicDiversity: 1, topics: [{ topic: 'harbor', mentions: 1 }], topBigrams: [{ phrase: 'root hello' }] },
        detect_consensus: { consensus: { detected: true, confidence: 0.8, agreeSignals: 2, disagreeSignals: 0, dominantStance: 'go' } },
        extract_decisions: { decisions: [{ nodeId: 'n1', text: 'decided to sail' }] },
        branch: {},
        delete_node: {},
      };
      return { ok: true, result: results[input.action] || {} };
    });
    lensRun.mockResolvedValue({ data: { ok: true, result: { drafts: [] } } });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ThreadMapPanel />);
    expect((await screen.findAllByText('Branch talk')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Root hello')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/2 messages/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getAllByText('Root hello').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Linear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));

    fireEvent.click(screen.getAllByText('Root hello')[0]);
    expect(await screen.findByText('Message Details')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByPlaceholderText('Write your reply…'), { target: { value: 'Noted.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'branch' })));

    const mergeBoxes = screen.getAllByRole('checkbox', { name: 'Select for merge' });
    fireEvent.click(mergeBoxes[0]);
    fireEvent.click(mergeBoxes[1]);
    fireEvent.click(screen.getByRole('button', { name: /Merge 2 selected/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'merge' })));

    fireEvent.click(screen.getAllByText('Root hello')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Delete message/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete_node' })));

    fireEvent.change(screen.getByPlaceholderText('Search threads…'), { target: { value: 'nope' } });
    expect(screen.getByText('No threads match your search')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search threads…'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    fireEvent.change(screen.getByPlaceholderText('Filter messages in this view…'), { target: { value: 'Child' } });

    const analysis = [
      ['Thread Analyze', 'Peak Hour:'],
      ['Sentiment Map', 'Overall Tone:'],
      ['Participant Stats', 'Most Active:'],
      ['Topic Extract', 'Dominant Topic:'],
      ['Detect Consensus', 'Consensus detected'],
      ['Extract Decisions', 'decided to sail'],
    ] as const;
    for (const [label, marker] of analysis) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(await screen.findByText(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: /New Thread/ }));
    fireEvent.change(screen.getByPlaceholderText('Thread title…'), { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(lensData().create).toHaveBeenCalled());
  });
});
