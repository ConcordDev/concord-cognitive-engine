import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/ui', () => ({
  ErrorState: ({ message }: { message: string }) => React.createElement('div', null, message),
}));
vi.mock('@/components/creator/CreatorKeepMenu', () => ({
  CreatorKeepMenu: () => null,
}));

import { CrtPipelinePanel } from '@/components/creator/CrtPipelinePanel';

const item = {
  id: 'con_1', title: 'Proof Video', format: 'video', stage: 'idea',
  platform: null, scheduledDate: '2026-11-12',
};

beforeEach(() => { lensRunMock.mockReset(); });

describe('creator pipeline edit', () => {
  it('saves a new title, format, and date through content-update', async () => {
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'content-list') return { data: { ok: true, result: { items: [item] } } };
      return { data: { ok: true, result: {} } };
    });
    render(<CrtPipelinePanel onChange={() => {}} />);
    expect(await screen.findByText('Proof Video')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Proof Video' }));
    fireEvent.change(screen.getByLabelText('Title for Proof Video'), { target: { value: 'Cut two' } });
    fireEvent.change(screen.getByLabelText('Format for Proof Video'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Date for Proof Video'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(
      'creator', 'content-update',
      { id: 'con_1', title: 'Cut two', format: 'short', scheduledDate: '2026-12-01' },
    ));
  });
});
