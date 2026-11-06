/**
 * Thread full build (F-B row 1) — the composer's schedule lifecycle
 * (the date shown on open · Unschedule), the two-step draft delete,
 * the best-time basis label, the Map's always-visible drafts bridge,
 * the two-step node delete, and the rewrite decline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.hoisted(() => vi.fn());
const lensData = vi.hoisted(() => vi.fn());
const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'ram' } }) }));
vi.mock('@/lib/hooks/use-lens-data', () => ({ useLensData: () => lensData() }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync }) }));

import { ThreadComposer } from '@/components/thread/ThreadComposer';
import { ThreadMapPanel } from '@/components/thread/ThreadMapPanel';
import { ThreadStudio } from '@/components/thread/ThreadStudio';

const SCHEDULED_AT = '2026-11-09T14:00:00.000Z';
const draftMeta = { id: 'th_1', title: 'Launch thread', platform: 'x', status: 'scheduled', postCount: 3, scheduledAt: SCHEDULED_AT, citedDtuId: null };
const draftFull = { id: 'th_1', title: 'Launch thread', content: 'First post.\n\nSecond post.\n\nThird post.', platform: 'x', status: 'scheduled', scheduledAt: SCHEDULED_AT, posts: [] };

function composerRun(overrides: Record<string, unknown> = {}) {
  lensRun.mockImplementation((_d: string, action: string, params: { id?: string }) => {
    switch (action) {
      case 'draft-list': return Promise.resolve({ data: { ok: true, result: { drafts: [draftMeta] } } });
      case 'thread-dashboard': return Promise.resolve({ data: { ok: true, result: { drafts: 0, scheduled: 1, published: 0, total: 1 } } });
      case 'best-time': return Promise.resolve({ data: { ok: true, result: { basis: 'generic_guideline', slots: [{ day: 'Tue', time: '09:00', score: 100 }] } } });
      case 'draft-detail': return Promise.resolve({ data: { ok: true, result: { draft: draftFull } } });
      case 'split-preview': return Promise.resolve({ data: { ok: true, result: { posts: [] } } });
      case 'draft-unschedule': return Promise.resolve({ data: { ok: true, result: { draft: { ...draftFull, status: 'draft', scheduledAt: null } } } });
      case 'draft-delete': return Promise.resolve({ data: { ok: true, result: { deleted: params?.id } } });
      default: return Promise.resolve({ data: { ok: false, error: `unexpected ${action}` } });
    }
  });
  Object.assign(lensRun, overrides);
}

describe('ThreadComposer — schedule lifecycle + delete + best-time basis', () => {
  beforeEach(() => { lensRun.mockReset(); composerRun(); });

  it('opening a scheduled draft shows its date, and Unschedule returns it to a draft', async () => {
    render(<ThreadComposer />);
    fireEvent.click(await screen.findByText('Launch thread'));
    const dateInput = await waitFor(() => {
      const el = document.querySelector('input[type="datetime-local"]') as HTMLInputElement | null;
      expect(el?.value).toBeTruthy();
      return el as HTMLInputElement;
    });
    expect(dateInput.value).toContain('2026-11-09');
    fireEvent.click(screen.getByRole('button', { name: 'Unschedule' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('thread', 'draft-unschedule', { id: 'th_1' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Unschedule' })).not.toBeInTheDocument());
  });

  it('the best-time label carries its basis', async () => {
    render(<ThreadComposer />);
    expect(await screen.findByText(/Best time: Tue 09:00 \(generic guideline\)/)).toBeInTheDocument();
  });

  it('draft delete is two-step: arming calls nothing, confirming deletes', async () => {
    render(<ThreadComposer />);
    await screen.findByText('Launch thread');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(lensRun.mock.calls.some((c) => c[1] === 'draft-delete')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('thread', 'draft-delete', { id: 'th_1' }));
  });
});

describe('ThreadMapPanel — drafts bridge with threads present + node delete', () => {
  beforeEach(() => {
    lensRun.mockReset();
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ ok: true, result: {} });
    lensData.mockReturnValue({
      items: [{
        id: 'thr_1', title: 'Branch talk', ownerId: 'u1', updatedAt: new Date().toISOString(),
        data: { nodes: [
          { id: 'n1', parentNodeId: null, content: 'Root message about the plan', authorId: 'u1', createdAt: '2026-11-01T10:00:00.000Z' },
          { id: 'n2', parentNodeId: 'n1', content: 'A reply to the root', authorId: 'u1', createdAt: '2026-11-01T10:05:00.000Z' },
        ] },
      }],
      isLoading: false, isError: false, error: null, refetch: vi.fn(), create: vi.fn(), remove: vi.fn(),
    });
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'draft-list') {
        return Promise.resolve({ data: { ok: true, result: { drafts: [{ id: 'th_9', title: 'Harbor notes' }] } } });
      }
      return Promise.resolve({ data: { ok: false, error: 'unexpected' } });
    });
  });

  it('the composer-drafts bridge is visible even when conversation threads exist', async () => {
    const onOpenComposer = vi.fn();
    render(<ThreadMapPanel onOpenComposer={onOpenComposer} />);
    expect(await screen.findByText('Composer Drafts')).toBeInTheDocument();
    expect(screen.getByText('Harbor notes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts (1) -> Composer' }));
    expect(onOpenComposer).toHaveBeenCalledTimes(1);
  });

  it('node delete is two-step: arming calls nothing, confirming deletes', async () => {
    render(<ThreadMapPanel />);
    fireEvent.click(await screen.findByText('Root message about the plan'));
    const delBtn = await screen.findByRole('button', { name: /Delete message \(and 1 reply\)/ });
    fireEvent.click(delBtn);
    expect(mutateAsync.mock.calls.some((c) => (c[0] as { action?: string })?.action === 'delete_node')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Confirm delete/ }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete_node' })));
  });
});

describe('ThreadStudio — AI Assist rewrite decline', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'ai-rewrite') {
        return Promise.resolve({ data: { ok: true, result: { changed: false, rewritten: 'Ship the build. Verify the receipts.', note: 'No change — the tighten pass left this text as it stands.', deltaPct: 0 } } });
      }
      if (action === 'cta-templates') return Promise.resolve({ data: { ok: true, result: { templates: [] } } });
      return Promise.resolve({ data: { ok: false, error: 'unexpected' } });
    });
  });

  it('a no-change rewrite renders the decline, not a REWRITTEN frame', async () => {
    render(<ThreadStudio />);
    fireEvent.click(screen.getByRole('button', { name: /AI Assist/ }));
    fireEvent.change(await screen.findByPlaceholderText(/Paste thread text/), { target: { value: 'Ship the build. Verify the receipts.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    expect(await screen.findByText(/No change — the tighten pass left this text as it stands\./)).toBeInTheDocument();
    expect(screen.queryByText(/Rewritten \(/)).not.toBeInTheDocument();
  });
});
