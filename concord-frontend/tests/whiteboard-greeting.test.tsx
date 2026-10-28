/**
 * Whiteboard studio northstar greeting.
 *
 * The Whiteboard concept (docs/lens-northstar/14) opens on the serif
 * headline "Sketch it, Ramaj" over the canvas — WhiteboardStudio's own
 * header comment calls that slot "Greeting + board switcher". This
 * pins the headline carrying the signed-in username, using the same
 * mock setup as whiteboard-studio-owner.test.tsx.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({ isError: false, error: null, refetch: vi.fn(), items: [], create: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'ramaj' } }),
}));
vi.mock('@/lib/api/client', () => ({
  api: { delete: vi.fn(), patch: vi.fn() },
  apiHelpers: {
    whiteboard: {
      list: () => Promise.resolve({ data: { whiteboards: [] } }),
      get: () => Promise.resolve({ data: { ok: true, whiteboard: null } }),
      create: () => Promise.resolve({ data: { ok: true, dtuId: 'wb_new' } }),
      update: () => Promise.resolve({ data: { ok: true } }),
    },
    dtus: { paginated: () => Promise.resolve({ data: { dtus: [] } }) },
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));
vi.mock('@/components/whiteboard/WhiteboardWorkbench', () => ({ default: () => null }));
vi.mock('@/components/whiteboard/WhiteboardInspector', () => ({ WhiteboardInspector: () => null }));
vi.mock('@/components/whiteboard/WhiteboardMoodboardPanel', () => ({ WhiteboardMoodboardPanel: () => null }));
vi.mock('@/components/whiteboard/WhiteboardArrangementPanel', () => ({ WhiteboardArrangementPanel: () => null }));
vi.mock('@/components/whiteboard/WhiteboardCreateForm', () => ({ WhiteboardCreateForm: () => null }));
vi.mock('@/components/whiteboard/WhiteboardKeepMenu', () => ({ WhiteboardKeepMenu: () => null }));
vi.mock('@/components/whiteboard/BoardOwnerMenu', () => ({ BoardOwnerMenu: () => null }));
vi.mock('@/components/dtu/DTUDetailView', () => ({ DTUDetailView: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: (props: { value?: string }) => <textarea value={props.value || ''} readOnly />,
}));

import { WhiteboardStudio } from '@/components/whiteboard/WhiteboardStudio';

describe('Whiteboard studio greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <WhiteboardStudio workbenchOpen={false} onWorkbenchOpen={() => {}} onWorkbenchClose={() => {}} />
      </QueryClientProvider>,
    );
    const greeting = await screen.findByTestId('whiteboard-greeting');
    expect(greeting.textContent).toBe('Sketch it, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
