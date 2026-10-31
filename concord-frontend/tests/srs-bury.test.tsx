import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Bury follow-up (founder ruling 2026-10-29): the Browser's bury
// banner states the semantics ("buried until tomorrow"); the Study
// tab's Include buried control threads includeBuried into every
// study-next call of the session.
const calls = vi.hoisted(() => [] as { action: string; params: Record<string, unknown> }[]);
const lensRunMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  apiHelpers: {},
}));

import { SrsWorkbench } from '@/components/srs/SrsWorkbench';

const DECK = { id: 'deck1', name: 'Main', options: { scheduler: 'fsrs', newPerDay: 20, reviewsPerDay: 200, learningSteps: [1, 10] }, studyCount: 1, cardCount: 1 };
const CARD = { id: 'card1', deckId: 'deck1', front: 'alpha front', back: 'alpha back', state: 'new', cardType: 'basic', tags: [], suspended: false, buried: false };

beforeEach(() => {
  calls.length = 0;
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, action: string, params: Record<string, unknown>) => {
    calls.push({ action, params });
    switch (action) {
      case 'deck-list': return { data: { ok: true, result: { decks: [DECK], count: 1 } } };
      case 'deck-tree': return { data: { ok: true, result: { tree: [] } } };
      case 'card-browse': return { data: { ok: true, result: { cards: [CARD], count: 1, tags: [] } } };
      case 'card-bury': return { data: { ok: true, result: { updated: 1, unchanged: 0 } } };
      case 'card-suspend': return { data: { ok: true, result: { updated: 1, unchanged: 0, unburied: 1 } } };
      case 'study-next': return { data: { ok: true, result: { card: null, remaining: 0, caps: {} } } };
      case 'study-stats': return { data: { ok: true, result: { reviewsToday: 0, againToday: 0, nextDueAt: null } } };
      default: return { data: { ok: true, result: {} } };
    }
  });
});

describe('SRS bury follow-up (FE)', () => {
  it('the bury banner says "buried until tomorrow"', async () => {
    render(<SrsWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Browser/ }));
    const row = await screen.findByText('alpha front');
    const tr = row.closest('tr') || row.closest('div');
    const box = (tr?.querySelector('input[type="checkbox"]') || document.querySelector('input[type="checkbox"]')) as HTMLInputElement;
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: /^Bury$/ }));
    await waitFor(() => expect(screen.getByText(/buried until tomorrow/)).toBeTruthy());
  });

  it('the suspend banner reports a lifted bury', async () => {
    render(<SrsWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Browser/ }));
    const row = await screen.findByText('alpha front');
    const tr = row.closest('tr') || row.closest('div');
    const box = (tr?.querySelector('input[type="checkbox"]') || document.querySelector('input[type="checkbox"]')) as HTMLInputElement;
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: /^Suspend$/ }));
    await waitFor(() => expect(screen.getByText(/also unburied/)).toBeTruthy());
  });

  it('Include buried threads includeBuried into study-next', async () => {
    render(<SrsWorkbench />);
    fireEvent.click(await screen.findByRole('button', { name: /Study/ }));
    const toggle = await screen.findByLabelText('Include buried cards in this session');
    await waitFor(() => {
      const studyCalls = calls.filter((c) => c.action === 'study-next');
      expect(studyCalls.length).toBeGreaterThan(0);
      expect(studyCalls[studyCalls.length - 1].params.includeBuried).toBe(false);
    });
    fireEvent.click(toggle);
    expect(await screen.findByText(/Buried cards are in this session/)).toBeTruthy();
    await waitFor(() => {
      const studyCalls = calls.filter((c) => c.action === 'study-next');
      expect(studyCalls[studyCalls.length - 1].params.includeBuried).toBe(true);
    });
  });
});
