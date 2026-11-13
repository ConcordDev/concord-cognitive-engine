// Audit fix sweep (PR #2356) — FIX-construction-005: the job-row
// lightning quick-action silently flipped a Planned job to In Progress
// (icon only, no label, no feedback). The action is now labeled
// 'Start job' in words, announces what it did, and offers Undo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const update = vi.fn(() => Promise.resolve({}));
const jobItem = {
  id: 'job-1',
  title: 'Deck build',
  data: { name: 'Deck build', status: 'planned', description: '', client: 'Pat', address: '' },
};

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [jobItem],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    create: vi.fn(),
    update,
    remove: vi.fn(),
  }),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/common/StickyDeleteConfirm', () => ({ StickyDeleteConfirm: () => null }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>,
  }),
}));

import { ProjectRegistryPanel } from '@/components/construction/ProjectRegistryPanel';

beforeEach(() => { update.mockClear(); });

describe('construction job row — Start job is labeled, announced, undoable', () => {
  it('starts the job with feedback and Undo restores Planned', async () => {
    const view = render(<ProjectRegistryPanel mode="jobs" />);
    const startBtn = await view.findByRole('button', { name: 'Start job' });
    expect(startBtn.textContent).toContain('Start job');

    fireEvent.click(startBtn);
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][1].data.status).toBe('in_progress');
    expect(update.mock.calls[0][1].meta.status).toBe('in_progress');

    const notice = await view.findByRole('status');
    expect(notice.textContent).toContain('Deck build');
    expect(notice.textContent).toContain('In Progress');

    fireEvent.click(view.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][1].data.status).toBe('planned');
    expect(update.mock.calls[1][1].meta.status).toBe('planned');
  });
});
