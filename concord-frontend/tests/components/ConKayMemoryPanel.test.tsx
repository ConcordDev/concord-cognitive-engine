/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/tests/components/ConKayMemoryPanel.test.tsx
//
// Beyond-Denial unit #2 — pins the ConKay cross-session memory panel's
// honest guarantees against the REAL macro shapes it calls
// (`conkay.memory_list` / `conkay.memory_pin` / `conkay.memory_forget`,
// server/domains/conkay.js):
//   - an empty memory list renders the canonical EmptyState, never a
//     fabricated sample memory;
//   - a real memory list renders each DTU's title/insight;
//   - the pin button calls conkay.memory_pin with the real dtuId + the
//     toggled boolean, and only flips the UI once the backend confirms;
//   - the forget button calls conkay.memory_forget with the real dtuId and
//     removes the row only once the backend confirms deletion.
//
// `lensRun` is the one mock surface — no fabricated data, matching the
// pattern already used by ConnectorStatusPanel.test.tsx / PhilosophyCuration.test.tsx.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ConKayMemoryPanel, type ConKayMemoryDtu } from '@/components/conkay/ConKayMemoryPanel';

type MacroResponse = { data: { ok: boolean; result: unknown; error: string | null } };

const MEMORY: ConKayMemoryDtu = {
  id: 'convmem_abc123',
  kind: 'conversation_memory',
  title: 'Conversation: rockets, orbital mechanics',
  tier: 'regular',
  topics: ['rockets', 'orbital mechanics'],
  insights: ['User is designing a two-stage rocket'],
  sessionId: 'sess_1',
  messageCount: 20,
  megaCount: null,
  pinned: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
};

function mockList(memories: ConKayMemoryDtu[]) {
  lensRunMock.mockImplementation(
    (domain: string, action: string): Promise<MacroResponse> => {
      if (domain === 'conkay' && action === 'memory_list') {
        return Promise.resolve({
          data: { ok: true, result: { memories, count: memories.length }, error: null },
        });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    },
  );
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('ConKayMemoryPanel', () => {
  it('renders the canonical EmptyState when the user has no memories yet', async () => {
    mockList([]);

    render(<ConKayMemoryPanel />);

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('conkay', 'memory_list', {}));
    expect(await screen.findByText('No memories yet')).toBeInTheDocument();
    // The canonical EmptyState primitive renders its content inside a
    // role="region" landmark — proves this is the shared component, not a
    // hand-rolled empty div.
    expect(screen.getByRole('region', { name: 'Empty state' })).toBeInTheDocument();
    expect(screen.queryByTestId('ck-memory-list')).not.toBeInTheDocument();
  });

  it('renders a real memory DTU with its title and insight', async () => {
    mockList([MEMORY]);

    render(<ConKayMemoryPanel />);

    expect(await screen.findByTestId(`ck-memory-row-${MEMORY.id}`)).toBeInTheDocument();
    expect(screen.getByText(MEMORY.title as string)).toBeInTheDocument();
    expect(screen.getByText(MEMORY.insights[0])).toBeInTheDocument();
  });

  it('pin button calls conkay.memory_pin with the real dtuId + toggled boolean, and flips the badge only on backend confirmation', async () => {
    mockList([MEMORY]);
    lensRunMock.mockImplementation(
      (domain: string, action: string, input?: Record<string, unknown>): Promise<MacroResponse> => {
        if (domain === 'conkay' && action === 'memory_list') {
          return Promise.resolve({
            data: { ok: true, result: { memories: [MEMORY], count: 1 }, error: null },
          });
        }
        if (domain === 'conkay' && action === 'memory_pin') {
          return Promise.resolve({
            data: { ok: true, result: { dtuId: input?.dtuId, pinned: input?.pinned }, error: null },
          });
        }
        return Promise.resolve({ data: { ok: true, result: {}, error: null } });
      },
    );

    render(<ConKayMemoryPanel />);
    const row = await screen.findByTestId(`ck-memory-row-${MEMORY.id}`);
    expect(row.getAttribute('data-pinned')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /^Pin /i }));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('conkay', 'memory_pin', {
        dtuId: MEMORY.id,
        pinned: true,
      }),
    );
    await waitFor(() => expect(row.getAttribute('data-pinned')).toBe('true'));
    // The button label flips to reflect the new (real, backend-confirmed) state.
    expect(await screen.findByRole('button', { name: /^Unpin /i })).toBeInTheDocument();
  });

  it('forget button calls conkay.memory_forget with the real dtuId and removes the row only on backend confirmation', async () => {
    lensRunMock.mockImplementation(
      (domain: string, action: string, input?: Record<string, unknown>): Promise<MacroResponse> => {
        if (domain === 'conkay' && action === 'memory_list') {
          return Promise.resolve({
            data: { ok: true, result: { memories: [MEMORY], count: 1 }, error: null },
          });
        }
        if (domain === 'conkay' && action === 'memory_forget') {
          return Promise.resolve({
            data: { ok: true, result: { dtuId: input?.dtuId, forgotten: true }, error: null },
          });
        }
        return Promise.resolve({ data: { ok: true, result: {}, error: null } });
      },
    );

    render(<ConKayMemoryPanel />);
    await screen.findByTestId(`ck-memory-row-${MEMORY.id}`);

    fireEvent.click(screen.getByRole('button', { name: /^Forget /i }));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('conkay', 'memory_forget', { dtuId: MEMORY.id }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId(`ck-memory-row-${MEMORY.id}`)).not.toBeInTheDocument(),
    );
    // Backend-confirmed empty state, not a stale loading/list flash.
    expect(await screen.findByText('No memories yet')).toBeInTheDocument();
  });

  it('a rejected forget (not_owned) surfaces an honest inline row error and keeps the row — no fake optimistic removal', async () => {
    mockList([MEMORY]);
    lensRunMock.mockImplementation((domain: string, action: string): Promise<MacroResponse> => {
      if (domain === 'conkay' && action === 'memory_list') {
        return Promise.resolve({
          data: { ok: true, result: { memories: [MEMORY], count: 1 }, error: null },
        });
      }
      if (domain === 'conkay' && action === 'memory_forget') {
        return Promise.resolve({ data: { ok: false, result: null, error: 'not_owned' } });
      }
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });

    render(<ConKayMemoryPanel />);
    await screen.findByTestId(`ck-memory-row-${MEMORY.id}`);

    fireEvent.click(screen.getByRole('button', { name: /^Forget /i }));

    expect(await screen.findByTestId(`ck-memory-row-error-${MEMORY.id}`)).toHaveTextContent(
      'not_owned',
    );
    // The row is still there — a failed backend call never fakes success.
    expect(screen.getByTestId(`ck-memory-row-${MEMORY.id}`)).toBeInTheDocument();
  });
});
