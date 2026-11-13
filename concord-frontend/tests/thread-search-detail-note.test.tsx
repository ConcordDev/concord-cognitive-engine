// thread-search-detail-note.test.tsx
//
// FIX-thread-003: (a) a search with no match left the selected
// thread's details standing beside "No threads match your search" —
// the detail pane now states the thread is filtered out instead, and
// clearing the search restores it; (b) the New Thread form never said
// who can see a thread — it now states threads are private.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const lensRun = vi.hoisted(() => vi.fn());
const lensData = vi.hoisted(() => vi.fn());
const mutateAsync = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'ram' } }) }));
vi.mock('@/lib/hooks/use-lens-data', () => ({ useLensData: () => lensData() }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => ({ mutateAsync }) }));

import { ThreadMapPanel } from '@/components/thread/ThreadMapPanel';

describe('Thread search detail + privacy wording (FIX-thread-003)', () => {
  beforeEach(() => {
    lensRun.mockReset();
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ ok: true, result: {} });
    lensRun.mockResolvedValue({ data: { ok: true, result: { drafts: [] } } });
    lensData.mockReturnValue({
      items: [{
        id: 'th_1', title: 'Harbor notes',
        data: { nodes: [{ id: 'n1', content: 'first message', parentId: null }] },
      }],
      isLoading: false, isError: false, error: null,
      refetch: vi.fn(), create: vi.fn(), remove: vi.fn(),
    });
  });

  it('notes the filter instead of showing details for a searched-out thread', async () => {
    render(<ThreadMapPanel />);
    // The thread auto-selects and its details show.
    expect(await screen.findByText('first message')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Search threads'), { target: { value: 'NO-SUCH-THREAD-zt1' } });
    expect(await screen.findByText('No threads match your search')).toBeTruthy();
    expect(screen.getByText(/doesn’t match your search, so its details are hidden/)).toBeTruthy();
    expect(screen.queryByText('first message')).toBeNull();

    // Clearing the search restores the same selection's details.
    fireEvent.change(screen.getByLabelText('Search threads'), { target: { value: '' } });
    expect(await screen.findByText('first message')).toBeTruthy();
  });

  it('states that threads are private on the New Thread form', async () => {
    render(<ThreadMapPanel />);
    fireEvent.click(screen.getByRole('button', { name: /New Thread/ }));
    expect(await screen.findByText('Threads are private — only you can see the threads you create here.')).toBeTruthy();
  });
});
