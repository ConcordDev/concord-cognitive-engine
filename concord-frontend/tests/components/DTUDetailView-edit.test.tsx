import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';
import { WorkspaceBusProvider } from '@/components/workspace-bus';

vi.mock('@/components/dtu/DTUIntegrityBadge', () => ({ DTUIntegrityBadge: () => null }));
vi.mock('@/components/dtu/ProvenanceBadge', () => ({ ProvenanceBadge: () => null }));
vi.mock('@/components/dtu/ProvenanceTrail', () => ({ ProvenanceTrail: () => null }));
vi.mock('@/components/dtu/DownstreamBadge', () => ({ DownstreamBadge: () => null }));
vi.mock('@/components/artifact/ArtifactRenderer', () => ({ ArtifactRenderer: () => null }));
vi.mock('@/components/platform/ScopeControls', () => ({ ScopeBadge: () => null }));
vi.mock('@/components/scope/PromoteDialog', () => ({ PromoteDialog: () => <div>promote</div> }));
vi.mock('@/hooks/useOfflineFirst', () => ({
  useOfflineFirstDTU: () => ({ data: null, loading: false, source: 'server', stale: false }),
}));

const { sampleDtu, update } = vi.hoisted(() => {
  const update = vi.fn();
  const sampleDtu = {
    id: 'dtu-42',
    title: 'Form note',
    summary: 'A stored summary.',
    content: '',
    tier: 'regular',
    domain: 'notes',
    source: 'user',
    timestamp: '2020-01-02T03:04:05.000Z',
    createdAt: '2020-01-02T03:04:05.000Z',
    updatedAt: '2024-06-01T00:00:00.000Z',
    ownerId: 'u1',
    tags: ['garden'],
    parents: ['parent-1'],
    children: ['child-1'],
    meta: { scope: 'local' },
    human: { summary: 'A stored summary.', bullets: ['one point'] },
    creti: { clarity: 0.5 },
    cretiHuman: '',
    core: { definitions: ['a definition'], claims: ['a claim'], examples: ['an example'] },
    isGlobal: false,
    resonance: 0.2,
    coherence: 0.3,
    stability: 0.4,
  };
  return { sampleDtu, update };
});

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    dtus: {
      get: vi.fn().mockResolvedValue({ data: { dtu: sampleDtu } }),
      lineage: vi.fn().mockResolvedValue({
        data: {
          ok: true,
          parents: [{ id: 'parent-1', title: 'Parent', tier: 'regular', ownerId: 'u1' }],
          children: [{ id: 'child-1', title: 'Child', tier: 'regular', ownerId: 'u1' }],
          forks: [{ id: 'fork-1', title: 'Fork', tier: 'regular', ownerId: 'u2' }],
          citations: [{ id: 'cite-1', title: 'Cite' }],
          citedBy: [{ id: 'by-1', title: 'By', ownerId: 'u3' }],
        },
      }),
      update: (...args: unknown[]) => update(...args),
    },
    economy: {
      royaltyCascade: vi.fn().mockResolvedValue({
        data: { ok: true, totalEarned: 1.5, totalTransactions: 2, ancestors: [{ generation: 1, creatorId: 'c', ratePercent: '10%', totalEarned: 1 }], descendantCount: 1 },
      }),
    },
  },
  api: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockResolvedValue({ data: {} }) },
}));

import { DTUDetailView } from '@/components/dtu/DTUDetailView';

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <KeyboardProvider>
        <WorkspaceBusProvider>
          <DTUDetailView dtuId="dtu-42" onClose={() => {}} onNavigate={() => {}} />
        </WorkspaceBusProvider>
      </KeyboardProvider>
    </QueryClientProvider>,
  );
}

describe('DTUDetailView content and edit', () => {
  it('shows stored summary when content is empty, and edit saves then refreshes', async () => {
    const { apiHelpers } = await import('@/lib/api/client');
    update.mockResolvedValue({ data: { ok: true, dtu: { ...sampleDtu, title: 'Edited title', content: 'Edited body' } } });
    (apiHelpers.dtus.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ data: { dtu: { ...sampleDtu, content: '' } } })
      .mockResolvedValue({ data: { dtu: { ...sampleDtu, title: 'Edited title', content: 'Edited body', summary: 'Edited summary' } } });

    renderView();
    expect((await screen.findAllByText('A stored summary.')).length).toBeGreaterThan(0);
    expect(screen.queryByText('(No content)')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const content = screen.getByLabelText('Content') as HTMLTextAreaElement;
    expect(content.value).toContain('A stored summary.');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited title' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Edited summary' } });
    fireEvent.change(content, { target: { value: 'Edited body' } });
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'garden, edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith('dtu-42', {
      title: 'Edited title',
      summary: 'Edited summary',
      content: 'Edited body',
      tags: ['garden', 'edited'],
    }));
    expect(await screen.findByText('Edited body')).toBeTruthy();
    expect(screen.queryByLabelText('Content')).toBeNull();
  });

  it('shows content and creti text, and surfaces a failed save', async () => {
    const { apiHelpers } = await import('@/lib/api/client');
    (apiHelpers.dtus.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { dtu: { ...sampleDtu, content: 'literal content', creti: 'creti paragraph', cretiHuman: 'creti paragraph' } },
    });
    update.mockResolvedValue({ data: { ok: false, error: 'unauthorized: you can only update your own DTUs' } });
    renderView();
    expect(await screen.findByText('literal content')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/unauthorized/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lineage' }));
    expect(await screen.findByText('Parent')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Metadata' }));
    expect(await screen.findByText('dtu-42')).toBeTruthy();
  });
});
