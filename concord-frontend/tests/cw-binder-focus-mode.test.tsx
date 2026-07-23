/**
 * CwBinderPanel — focus mode (Dabble-style distraction-free composition).
 *
 * Pins the real interaction added in this pass: toggling "Focus" hides the
 * binder tree (a real DOM element, not just a CSS opacity flicker) while the
 * scene content the user is editing stays fully intact and editable, and
 * Escape exits it the same as the visible "Exit focus" control.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { CwBinderPanel } from '@/components/creative-writing/CwBinderPanel';

const CHAPTER = { id: 'ch_1', title: 'Chapter One', order: 0 };
const SCENE = {
  id: 'sc_1', projectId: 'proj_1', chapterId: 'ch_1', title: 'Opening scene',
  synopsis: 'She wakes.', status: 'draft', content: 'It was a dark morning.',
  wordCount: 5, povCharacterId: null, order: 0, threadIds: [],
};

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_domain: string, action: string) => {
    if (action === 'project-get') return ok({ chapters: [CHAPTER], scenes: [SCENE], characters: [] });
    if (action === 'thread-list') return ok({ threads: [] });
    if (action === 'snapshot-list') return ok({ snapshots: [] });
    if (action === 'scene-comment-list') return ok({ comments: [] });
    if (action === 'note-list') return ok({ notes: [] });
    return ok({});
  });
});
afterEach(() => { vi.clearAllMocks(); });

describe('CwBinderPanel — focus mode', () => {
  it('Focus hides the Binder tree; Exit focus (or Escape) restores it', async () => {
    const onChange = vi.fn();
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CwBinderPanel projectId="proj_1" onChange={onChange} />); });

    await waitFor(() => expect(view!.getByText('Opening scene')).toBeInTheDocument());
    // Binder header is visible before focus mode.
    expect(view!.getByText('Binder')).toBeInTheDocument();

    await act(async () => { fireEvent.click(view!.getByText('Opening scene')); });
    await waitFor(() => expect(view!.getByDisplayValue('It was a dark morning.')).toBeInTheDocument());

    const focusBtn = view!.getByRole('button', { name: /^Focus$/i });
    await act(async () => { fireEvent.click(focusBtn); });

    // Binder tree is gone; the scene content is still there, fully editable.
    expect(view!.queryByText('Binder')).toBeNull();
    expect(view!.getByDisplayValue('It was a dark morning.')).toBeInTheDocument();

    // Escape exits focus mode.
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    await waitFor(() => expect(view!.getByText('Binder')).toBeInTheDocument());
  });

  it('typing in the editor while in focus mode marks the scene dirty (Save enabled)', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<CwBinderPanel projectId="proj_1" onChange={vi.fn()} />); });
    await waitFor(() => expect(view!.getByText('Opening scene')).toBeInTheDocument());
    await act(async () => { fireEvent.click(view!.getByText('Opening scene')); });
    await waitFor(() => expect(view!.getByDisplayValue('It was a dark morning.')).toBeInTheDocument());

    await act(async () => { fireEvent.click(view!.getByRole('button', { name: /^Focus$/i })); });

    const textarea = view!.getByDisplayValue('It was a dark morning.');
    await act(async () => { fireEvent.change(textarea, { target: { value: 'It was a dark morning. She rose.' } }); });

    const saveBtn = view!.getByRole('button', { name: /Save scene/i });
    expect(saveBtn).not.toBeDisabled();
  });
});
