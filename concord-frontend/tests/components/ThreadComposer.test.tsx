// Behavior test for ThreadComposer's "Duplicate" action (Wave-4 gap
// closure: thread.thread-clone). Follows the sibling NetWorthTracker.test.tsx
// pattern — mock @/lib/api/client's lensRun, drive real component behavior
// through Testing Library, assert on real DOM state (never on internal
// implementation details).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { ThreadComposer } from '@/components/thread/ThreadComposer';

interface DraftMeta {
  id: string; title: string; platform: string; status: string;
  postCount: number; scheduledAt: string | null; updatedAt: string; clonedFromId: string | null;
}

const draftMeta = (over: Partial<DraftMeta> = {}): DraftMeta => ({
  id: 'th_orig', title: 'Original Thread', platform: 'x', status: 'draft',
  postCount: 1, scheduledAt: null, updatedAt: '2026-01-01T00:00:00.000Z', clonedFromId: null,
  ...over,
});

// Wires the mock to behave like the real thread.js domain for the three
// draft-list-refresh macros ThreadComposer's refresh() calls in parallel,
// plus thread-clone. `drafts` is a live array so a successful clone call
// can push a new row and the next refresh() picks it up — mirrors the real
// backend's per-user STATE list, not a canned static response.
function wireLensRun(drafts: DraftMeta[]) {
  lensRun.mockImplementation((domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (domain !== 'thread') return Promise.resolve({ data: { ok: false, error: `unexpected domain ${domain}` } });
    if (action === 'draft-list') {
      return Promise.resolve({ data: { ok: true, result: { drafts, count: drafts.length } } });
    }
    if (action === 'thread-dashboard') {
      return Promise.resolve({ data: { ok: true, result: { drafts: drafts.length, scheduled: 0, published: 0, total: drafts.length, totalPosts: drafts.length } } });
    }
    if (action === 'best-time') {
      return Promise.resolve({ data: { ok: true, result: { slots: [] } } });
    }
    if (action === 'thread-clone') {
      const src = drafts.find((d) => d.id === input.id);
      if (!src) return Promise.resolve({ data: { ok: false, error: 'draft not found' } });
      const clone: DraftMeta = { ...src, id: `${src.id}_clone`, title: `${src.title} (copy)`, clonedFromId: src.id };
      drafts.push(clone);
      return Promise.resolve({ data: { ok: true, result: { draft: clone } } });
    }
    return Promise.resolve({ data: { ok: false, error: `unhandled action ${action}` } });
  });
}

describe('ThreadComposer — Duplicate action', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders a Duplicate button for an existing draft', async () => {
    wireLensRun([draftMeta()]);
    render(<ThreadComposer />);
    expect(await screen.findByText('Original Thread')).toBeInTheDocument();
    expect(await screen.findByLabelText('Duplicate')).toBeInTheDocument();
  });

  it('clicking Duplicate calls thread.thread-clone with the source draft id', async () => {
    wireLensRun([draftMeta()]);
    render(<ThreadComposer />);
    const dupBtn = await screen.findByLabelText('Duplicate');
    fireEvent.click(dupBtn);
    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('thread', 'thread-clone', { id: 'th_orig' });
    });
  });

  it('success: the cloned draft appears in the list after refresh', async () => {
    wireLensRun([draftMeta()]);
    render(<ThreadComposer />);
    expect(await screen.findByText('Original Thread')).toBeInTheDocument();
    const dupBtn = await screen.findByLabelText('Duplicate');
    fireEvent.click(dupBtn);
    // The clone macro mutates the shared `drafts` array and the component's
    // post-clone refresh() re-fetches draft-list, so the new "(copy)" row
    // should show up without a page reload or manual re-render trigger.
    expect(await screen.findByText('Original Thread (copy)')).toBeInTheDocument();
    // Both the original and the clone are now present — duplicate doesn't
    // replace, it adds.
    expect(screen.getByText('Original Thread')).toBeInTheDocument();
  });

  it('failure: an honest error is surfaced, never silently swallowed', async () => {
    wireLensRun([draftMeta()]);
    render(<ThreadComposer />);
    const dupBtn = await screen.findByLabelText('Duplicate');
    // Force the next thread-clone call to fail, simulating a real backend
    // rejection (e.g. the draft vanished between list and click).
    lensRun.mockImplementationOnce((domain: string, action: string) => {
      if (domain === 'thread' && action === 'thread-clone') {
        return Promise.resolve({ data: { ok: false, error: 'draft not found' } });
      }
      return Promise.resolve({ data: { ok: false, error: 'unexpected' } });
    });
    fireEvent.click(dupBtn);
    expect(await screen.findByText('draft not found')).toBeInTheDocument();
    // No phantom clone was added to the list on failure.
    expect(screen.queryByText('Original Thread (copy)')).not.toBeInTheDocument();
  });
});
