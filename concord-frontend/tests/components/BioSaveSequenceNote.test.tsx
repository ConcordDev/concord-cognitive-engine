// BioSaveSequenceNote.test.tsx
//
// FIX-bio-005: the Library tab's Save-sequence form disabled its Save
// button on a blank form with no word about what was missing. A
// role=note line now names the missing fields beside the button and
// updates as fields are filled.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(async () => ({ data: {} })), post: (...a: unknown[]) => apiPost(...a) },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  apiHelpers: { lens: { runDomain: vi.fn(), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { BioWorkbench } from '@/components/bio/BioWorkbench';

describe('bio Library save form speaks its missing fields (FIX-bio-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPost.mockImplementation(async (url: string, body?: { action?: string }) => {
      if (body?.action === 'sequence-list') return { data: { result: { sequences: [] } } };
      return { data: { ok: true, result: {} } };
    });
  });
  afterEach(() => cleanup());

  it('blank form: Save disabled WITH the reason; filling one field narrows it', async () => {
    render(React.createElement(BioWorkbench, { open: true, onClose: () => {} }));
    fireEvent.click(screen.getByText('Library'));
    fireEvent.click(await screen.findByText('Save sequence'));

    const saveBtn = screen.getByText('Save', { selector: 'button' }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    expect(screen.getByRole('note').textContent).toContain('Name and sequence are required.');

    fireEvent.change(screen.getByLabelText('Sequence name'), { target: { value: 'pUC19' } });
    expect(screen.getByRole('note').textContent).toContain('Sequence is required.');
    expect(saveBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Sequence'), { target: { value: 'ACGT' } });
    expect(screen.queryByRole('note')).toBeNull();
    expect(saveBtn.disabled).toBe(false);
  });
});
