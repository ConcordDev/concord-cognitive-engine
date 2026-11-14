/**
 * RESIDUE B7 — FIX-organ-001: the self-model showed every organ critical
 * (0% health, 100% maturity, 100% wear) with no stated relationship
 * between the numbers, so the board read as either a fire alarm or a
 * display default. The panel now states the relation it computes —
 * health is maturity minus wear, what drives each, and that the counts
 * are the organs' live state — beside the averages it qualifies.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ api: { get: (...args: unknown[]) => getMock(...args) } }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ insights: [] }) }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  motion: new Proxy({}, { get: (_t, tag: string) => ({ children, ...rest }: Record<string, unknown>) => React.createElement(tag, Object.fromEntries(Object.entries(rest).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout'].includes(k))), children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { SelfModelPanel } from '@/components/organ/SelfModelPanel';

const organ = (organId: string, score: number, damage: number, plasticity = 0.05) => ({
  organId,
  maturity: { score, confidence: 0.9, stability: 0.9, plasticity },
  wear: { damage, repair: 0.5, debt: 0 },
});

beforeEach(() => {
  getMock.mockReset();
  getMock.mockImplementation((url: string) => {
    if (url === '/api/growth/organs') {
      return Promise.resolve({
        data: {
          ok: true,
          organs: [organ('perception', 1, 1), organ('memory', 1, 1), organ('synthesis', 0.9, 0.1)],
        },
      });
    }
    return Promise.resolve({
      data: {
        ok: true,
        status: {
          bioAge: 10, epigeneticClock: 0.1, telomere: 0.9, proteomeShift: 0,
          homeostasis: 0.85, stress: { acute: 0, chronic: 0 },
          maintenance: { repairRate: 0.5, cleanupBacklog: 0 },
          functionalDecline: { contradictionLoad: 0 },
        },
      },
    });
  });
});

describe('FIX-organ-001 — the self-model states how its numbers relate', () => {
  it('the formula explanation renders beside the board', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SelfModelPanel />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('organ-health-formula')).toBeTruthy());
    const note = screen.getByTestId('organ-health-formula');
    expect(note.textContent).toMatch(/health is its maturity minus its wear/);
    expect(note.textContent).toMatch(/wear \(damage\) grows with errors/);
    expect(note.textContent).toMatch(/not a placeholder/);
  });

  it('the counts still come from the organs themselves (2 critical, 1 healthy)', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SelfModelPanel />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/2 organs in critical state/)).toBeTruthy());
  });
});
