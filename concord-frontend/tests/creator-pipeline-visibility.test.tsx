/**
 * FIX-creator-003 — pipeline items showed no visibility label. The items
 * are owner-scoped server state (content-list returns only the caller's
 * own items; there is no public read path), so the truthful label is
 * Private on every card. Pin its presence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

beforeEach(() => { lensRunMock.mockReset(); });

describe('FIX-creator-003 pipeline visibility label', () => {
  it('every pipeline card carries the Private — only you label', async () => {
    lensRunMock.mockImplementation(async (_d: string, action: string) => {
      if (action === 'content-list') return { data: { ok: true, result: { items: [
        { id: 'con_1', title: 'Proof Video', format: 'video', stage: 'idea', platform: null },
        { id: 'con_2', title: 'Launch Post', format: 'post', stage: 'published', platform: null },
      ] } } };
      return { data: { ok: true, result: {} } };
    });
    render(<CrtPipelinePanel onChange={() => {}} />);
    expect(await screen.findByText('Proof Video')).toBeTruthy();
    expect(screen.getAllByText(/Private — only you/)).toHaveLength(2);
  });
});
