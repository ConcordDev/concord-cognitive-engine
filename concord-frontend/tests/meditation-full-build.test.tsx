/**
 * Meditation full-build FE pins (S-MED-1/3/4):
 *  - the check-in button is disabled until a mood is CHOSEN — the old
 *    form pre-selected the midpoint and recorded a feeling nobody
 *    reported (F5);
 *  - a library click saves an INTENT, labelled as outside the totals
 *    — it never reads as playing or practising (F1);
 *  - milestones state their rule where they render, Explorer
 *    included, and NEXT UP never duplicates a grid tile (F8).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({ lensRun: vi.fn(), savedIntents: new Set<string>() }));

vi.mock('@/lib/api/client', () => ({
  lensRun: h.lensRun,
  api: { post: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import { MeditationStudio } from '@/components/meditation/MeditationStudio';
import { InsightsPanel } from '@/components/meditation/InsightsPanel';

function envelope(result: unknown) {
  return { data: { ok: true, result } };
}

const LIBRARY = {
  sessions: [
    { id: 'g-focus-10', title: 'Single-Pointed Focus', category: 'guided', durationMin: 10, goal: 'focus' },
    { id: 'b-coh-6', title: 'Coherent Breathing', category: 'breathwork', durationMin: 6, goal: 'calm', pattern: 'coherent' },
  ],
  count: 2,
  categories: ['guided', 'breathwork'],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.savedIntents = new Set<string>();
  h.lensRun.mockImplementation((_domain: string, action: string, input?: { sessionId?: string; mood?: number }) => {
    switch (action) {
      case 'library': return Promise.resolve(envelope(LIBRARY));
      case 'meditation-dashboard':
        return Promise.resolve(envelope({ totalSessions: 0, totalMinutes: 0, currentStreak: 0, byCategory: {} }));
      case 'mood-history': return Promise.resolve(envelope({ moods: [], averageMood: null, count: 0 }));
      case 'intents':
        return Promise.resolve(envelope({
          intents: [...h.savedIntents].map((sessionId) => ({ id: `mi_${sessionId}`, sessionId })),
          count: h.savedIntents.size,
        }));
      case 'play':
        if (input?.sessionId) h.savedIntents.add(input.sessionId);
        return Promise.resolve(envelope({ intent: { id: 'mi_1', sessionId: input?.sessionId }, credited: false }));
      case 'breathwork':
        return Promise.resolve(envelope({ pattern: 'coherent', name: 'Coherent', phases: [], cycleSeconds: 11, cycles: 8, totalSeconds: 88 }));
      case 'recommendations':
        return Promise.resolve(envelope({
          goal: 'focus', reason: 'Morning.', basedOn: { recentMood: null, totalSessions: 0, hour: 9 },
          recommendations: [{ id: 'g-focus-10', title: 'Single-Pointed Focus', category: 'guided', durationMin: 10, goal: 'focus', matchScore: 7 }],
        }));
      case 'milestones':
        return Promise.resolve(envelope({
          badges: [
            { id: 'first-sit', label: 'First Sit', icon: '🌱', blurb: 'You showed up.', kind: 'sessions', threshold: 1, progress: 0, value: 0, unlocked: false },
            { id: 'explorer', label: 'Explorer', icon: '🧭', blurb: 'Sampled four kinds of practice.', kind: 'categories', threshold: 4, progress: 0.5, value: 2, unlocked: false },
            { id: 'min-60', label: 'First Hour', icon: '⏳', blurb: 'An hour.', kind: 'minutes', threshold: 60, progress: 0.1, value: 6, unlocked: false },
          ],
          unlockedCount: 0, totalCount: 3,
          nextUp: { id: 'explorer', label: 'Explorer', icon: '🧭', blurb: 'Sampled four kinds of practice.', kind: 'categories', threshold: 4, progress: 0.5, value: 2, unlocked: false },
          metrics: { sessions: 0, minutes: 6, streak: 0, categories: 2 },
        }));
      default: return Promise.resolve(envelope({}));
    }
  });
});

describe('meditation studio — the record only takes what is chosen and sat', () => {
  it('check-in is disabled until a mood is picked, then sends that mood', async () => {
    render(<MeditationStudio />);
    const btn = await screen.findByRole('button', { name: /pick a mood first/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '🙂' }));
    const checkin = await screen.findByRole('button', { name: /^check in$/i });
    expect((checkin as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(checkin);
    await vi.waitFor(() => {
      expect(h.lensRun).toHaveBeenCalledWith('meditation', 'mood-checkin', { mood: 4 });
    });
  });

  it('a library click saves for later, labelled outside the totals — never "now playing"', async () => {
    render(<MeditationStudio />);
    fireEvent.click(await screen.findByText('Single-Pointed Focus'));
    expect(await screen.findByText(/saved for later/i)).toBeTruthy();
    expect(screen.getByText(/outside your practice totals/i)).toBeTruthy();
    expect(screen.queryByText(/now playing/i)).toBeNull();
    expect(h.lensRun).toHaveBeenCalledWith('meditation', 'play', { sessionId: 'g-focus-10' });
  });
});

describe('meditation insights — milestones state their rule (F8)', () => {
  it('Explorer renders its rule, and NEXT UP does not duplicate its tile', async () => {
    render(<InsightsPanel />);
    expect(await screen.findByText(/next up/i)).toBeTruthy();
    // The Explorer tile appears once (in NEXT UP) — the grid excludes it.
    expect(screen.getAllByText('Explorer')).toHaveLength(1);
    // NEXT UP states what Explorer counts (its blurb IS the rule).
    expect(screen.getByText(/sampled four kinds of practice/i)).toBeTruthy();
    // A non-nextUp locked tile also states its rule.
    expect(screen.getByText(/sit 1 sessions/i)).toBeTruthy();
  });

  it('a recommendation saves as an intent instead of logging the session', async () => {
    render(<InsightsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /save for later/i }));
    await vi.waitFor(() => {
      expect(h.lensRun).toHaveBeenCalledWith('meditation', 'play', { sessionId: 'g-focus-10' });
    });
    // …and the button settles into the saved state afterwards.
    const btn = await screen.findByRole('button', { name: /save for later/i });
    await vi.waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
  });
});
