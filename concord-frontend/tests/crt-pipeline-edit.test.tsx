/**
 * CrtPipelinePanel — content-update wiring (HANDOFF-3 batch L14).
 *
 * The creator pipeline could add, advance and delete content items
 * but never edit one: the backend `content-update` macro (title /
 * format / platform / scheduledDate / notes) had no caller. This
 * pins the inline edit flow: Edit opens the card's fields, Save
 * dispatches content-update with the edited values, and the list
 * refreshes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const mocks = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ lensRun: mocks.lensRun }));
vi.mock('@/components/ui', () => ({ ErrorState: () => null }));
vi.mock('@/components/creator/CreatorKeepMenu', () => ({ CreatorKeepMenu: () => null }));

import { CrtPipelinePanel } from '@/components/creator/CrtPipelinePanel';

const ITEM = {
  id: 'c1', title: 'Launch teaser', format: 'video', platform: null,
  stage: 'idea', scheduledDate: '', notes: null,
};

describe('CrtPipelinePanel content editing', () => {
  beforeEach(() => {
    mocks.lensRun.mockReset();
    mocks.lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'content-list') return Promise.resolve({ data: { ok: true, result: { items: [ITEM] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
  });

  it('edits a pipeline item through the real content-update macro', async () => {
    render(<CrtPipelinePanel onChange={() => {}} />);
    await screen.findByText('Launch teaser');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const titleInput = screen.getByLabelText('Content title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Launch teaser v2' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => {
      expect(mocks.lensRun).toHaveBeenCalledWith('creator', 'content-update', {
        id: 'c1', title: 'Launch teaser v2', format: 'video', scheduledDate: '',
      });
    });
  });
});
