import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-expert-mode-002: the document form requires a name
// (inline note + disabled store + submit guard), documents gain a
// rename, spaces gain an edit, and the space form's name validation
// message is exercised.

const h = vi.hoisted(() => ({ lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => h.lensRun(...a) }));

import { UploadSourcePanel } from '@/components/expert-mode/UploadSourcePanel';
import { SpacesPanel } from '@/components/expert-mode/SpacesPanel';

function calls(action: string) {
  return h.lensRun.mock.calls.filter((c) => (c as unknown[])[1] === action);
}

beforeEach(() => {
  h.lensRun.mockReset();
  h.lensRun.mockImplementation(async (...a: unknown[]) => {
    const action = (a as unknown[])[1];
    if (action === 'upload_list') return { data: { ok: true, result: { uploads: [{ id: 'upl_1', name: 'report.pdf', kind: 'text', chars: 42, createdAt: 1 }] } } };
    if (action === 'space_list') return { data: { ok: true, result: { spaces: [{ id: 'spc_1', name: 'Research', description: 'd1', answerCount: 0, shareToken: null, createdAt: 1, updatedAt: 1 }] } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('FIX-expert-mode-002 documents', () => {
  it('the store form names the missing name inline and keeps Store disabled', async () => {
    render(<UploadSourcePanel selectedId={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('note')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/Name the document first/);
    const store = screen.getByRole('button', { name: /Store as source/ }) as HTMLButtonElement;
    expect(store.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Document name/), { target: { value: 'notes.txt' } });
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
  });

  it('rename sends upload_update and refreshes', async () => {
    render(<UploadSourcePanel selectedId={null} onSelect={() => {}} />);
    fireEvent.click(await screen.findByLabelText('Rename report.pdf'));
    fireEvent.change(screen.getByLabelText('Document name'), { target: { value: 'report-v2.pdf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('upload_update')).toHaveLength(1));
    expect((calls('upload_update')[0] as unknown[])[2]).toMatchObject({ uploadId: 'upl_1', name: 'report-v2.pdf' });
  });
});

describe('FIX-expert-mode-002 spaces', () => {
  it('empty-name create shows the validation message and never calls space_create', async () => {
    render(<SpacesPanel pendingAnswer={null} onAddedPending={() => {}} reloadKey={0} />);
    fireEvent.click(await screen.findByRole('button', { name: /New/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create space' }));
    expect(await screen.findByText('Name the space first.')).toBeTruthy();
    expect(calls('space_create')).toHaveLength(0);
  });

  it('edit saves name + description through space_update', async () => {
    render(<SpacesPanel pendingAnswer={null} onAddedPending={() => {}} reloadKey={0} />);
    fireEvent.click(await screen.findByLabelText('Edit space Research'));
    fireEvent.change(screen.getByLabelText('Space name'), { target: { value: 'Research v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls('space_update')).toHaveLength(1));
    expect((calls('space_update')[0] as unknown[])[2]).toMatchObject({ spaceId: 'spc_1', name: 'Research v2', description: 'd1' });
  });
});
