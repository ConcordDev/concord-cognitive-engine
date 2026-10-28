/**
 * Study (SRS) page northstar greeting.
 *
 * The Study concept (docs/lens-northstar/12) opens on the serif
 * headline "What do you still know, Ramaj" with the due count in the
 * same header row. This pins the headline carrying the signed-in
 * username. The workbench/repos surfaces are mocked away — the
 * greeting lives in the page's own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    srs: {
      due: () => Promise.resolve({ data: { ok: true, cards: [], total: 0 } }),
      add: () => Promise.resolve({ data: { ok: true } }),
      review: () => Promise.resolve({ data: { ok: true } }),
      remove: () => Promise.resolve({ data: { ok: true } }),
    },
  },
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/srs/SrsWorkbench', () => ({ SrsWorkbench: () => null }));
vi.mock('@/components/srs/SrsRepos', () => ({ SrsRepos: () => null }));
vi.mock('@/components/dtu/DTUPickerModal', () => ({ DTUPickerModal: () => null }));

import SrsLensPage from '@/app/lenses/srs/page';

describe('Study page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SrsLensPage />
      </QueryClientProvider>,
    );
    const greeting = await screen.findByTestId('srs-greeting');
    expect(greeting.textContent).toBe('What do you still know, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
