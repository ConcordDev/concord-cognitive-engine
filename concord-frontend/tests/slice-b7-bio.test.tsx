import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-bio-003: saved sequences in the Library gain an edit
// form wired to sequence-update (name / kind / sequence / description).

const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
  apiHelpers: { lens: { runDomain: vi.fn(), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn(), state: 'idle' }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: { div: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
}));

import BioWorkbench from '@/components/bio/BioWorkbench';

const SEQ = { id: 'seq_1', name: 'pUC19 frag', sequence: 'ACGTACGT', kind: 'dna', description: 'old', length: 8, createdAt: '', updatedAt: '' };

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockImplementation(async (_url: string, body: { action: string }) => {
    if (body.action === 'sequence-list') return { data: { ok: true, result: { sequences: [SEQ] } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('FIX-bio-003 sequence edit', () => {
  it('library card edit saves through sequence-update', async () => {
    render(<BioWorkbench open onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Library/ }));
    fireEvent.click(await screen.findByLabelText('Edit sequence pUC19 frag'));
    const name = await screen.findByLabelText('Edit sequence name');
    fireEvent.change(name, { target: { value: 'pUC19 fragment' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      const upd = apiPost.mock.calls.filter((c) => (c[1] as { action: string }).action === 'sequence-update');
      expect(upd).toHaveLength(1);
      expect((upd[0][1] as { input: unknown }).input).toMatchObject({ id: 'seq_1', name: 'pUC19 fragment', sequence: 'ACGTACGT' });
    });
  });
});
