/**
 * Audit sweep CB-0475 (theme 5 remainder — absent lifecycle exits), FE pins 1:
 *   deities-001  DeityDetailPanel Retire → deity.retire (author only)
 *   fork-002     RepoWatchlist Edit → fork.watch-update (category + note)
 *   geology-001  FieldLog Open → detail + Edit → geology.observation-update
 *   ocean-002    SpotLog Edit → ocean.spot-update
 *   sports-002   SportsScoresPanel Edit → sports.game-update (prefilled)
 *
 * lensRun is mocked in the exact reply shapes the domains return.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: () => null,
}));

import { DeityDetailPanel } from '@/components/deities/DeityDetailPanel';
import { RepoWatchlist } from '@/components/fork/RepoWatchlist';
import { FieldLog } from '@/components/geology/FieldLog';
import { SpotLog } from '@/components/ocean/SpotLog';
import { SportsScoresPanel } from '@/components/sports/SportsScoresPanel';

function reply(result: unknown, ok = true) {
  return Promise.resolve({ data: { ok, result, error: ok ? null : 'nope' } });
}
function callsFor(domain: string, action: string) {
  return lensRun.mock.calls.filter((c) => c[0] === domain && c[1] === action);
}

beforeEach(() => { lensRun.mockReset(); });

describe('deities-001 — retire exit on the detail panel', () => {
  const detail = {
    deity: {
      id: 'deity_1', name: 'Veyra', domainTitle: 'Patron of the tide', creed: '',
      author_user_id: 'user_a', pilgrim_count: 0, revision: 1, retired: false,
      toneVector: { warmth: 0.5, refusal: 0.5, mystery: 0.5 },
      dialogueTemplates: [], alignmentThresholds: { commune: 0.3, refuse: 0.8 },
    },
    pilgrimRoster: [], rosterCount: 0, isAuthor: true, myDevotion: null,
  };
  it('author arms Retire and the confirm fires deity.retire', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (domain === 'deity' && action === 'detail') return reply(detail);
      if (domain === 'deity' && action === 'blessings') return reply({ deityName: 'Veyra', devotion: { score: 0, alignment: 0 }, tiers: [], nextTier: null });
      if (domain === 'deity' && action === 'commune_log') return reply({ utterances: [] });
      if (domain === 'deity' && action === 'retire') return reply({ deity: { ...detail.deity, retired: true }, retired: true });
      return reply({});
    });
    render(<DeityDetailPanel deityId="deity_1" onClose={() => {}} onChanged={() => {}} />);
    const arm = await screen.findByRole('button', { name: 'Retire deity Veyra' });
    fireEvent.click(arm);
    // Armed but NOT fired — the sticky confirm holds the destructive call.
    expect(callsFor('deity', 'retire')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm retire deity Veyra' }));
    await waitFor(() => expect(callsFor('deity', 'retire')).toHaveLength(1));
    expect(callsFor('deity', 'retire')[0][2]).toEqual({ deityId: 'deity_1' });
  });

  it('a non-author sees no Retire control', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (domain === 'deity' && action === 'detail') return reply({ ...detail, isAuthor: false });
      if (domain === 'deity' && action === 'blessings') return reply({ deityName: 'Veyra', devotion: { score: 0, alignment: 0 }, tiers: [], nextTier: null });
      if (domain === 'deity' && action === 'commune_log') return reply({ utterances: [] });
      return reply({});
    });
    render(<DeityDetailPanel deityId="deity_1" onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('Veyra');
    expect(screen.queryByRole('button', { name: 'Retire deity Veyra' })).toBeNull();
  });
});

describe('fork-002 — watchlist entry edit', () => {
  it('Edit opens the category/note form and Save fires watch-update', async () => {
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'watch-list') return reply({ repos: [{ id: 'rw1', fullName: 'octo/repo', note: '', reason: 'reference', lastStars: 3, lastPushedAt: null, forks: 1 }], count: 1 });
      if (action === 'watch-dashboard') return reply({ repos: 1, totalStars: 3, refreshed: 0, byReason: { reference: 1 } });
      if (action === 'watch-update') return reply({ repo: { id: 'rw1', fullName: 'octo/repo', note: 'qa fixture', reason: 'competitor' } });
      return reply({});
    });
    render(<RepoWatchlist />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit octo/repo' }));
    fireEvent.change(screen.getByLabelText('Category for octo/repo'), { target: { value: 'competitor' } });
    fireEvent.change(screen.getByLabelText('Note for octo/repo'), { target: { value: 'qa fixture' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callsFor('fork', 'watch-update')).toHaveLength(1));
    expect(callsFor('fork', 'watch-update')[0][2]).toEqual({ id: 'rw1', reason: 'competitor', note: 'qa fixture' });
  });
});

describe('geology-001 — field log detail + edit', () => {
  it('Open shows the detail and Save rides observation-update', async () => {
    const obs = { id: 'ob1', name: 'Basalt flow', kind: 'rock', lat: null, lon: null, locationName: 'Quarry', formation: 'Flood basalt', notes: 'vesicular', tags: [], collectedAt: '2026-11-01' };
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'observation-list') return reply({ observations: [obs] });
      if (action === 'field-dashboard') return reply({ totalObservations: 1, byKind: { rock: 1 }, geotagged: 0, formations: 1 });
      if (action === 'observation-update') return reply({ observation: { ...obs, notes: 'updated notes' } });
      return reply({});
    });
    render(<FieldLog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Basalt flow' }));
    // 'vesicular' renders in the row summary AND the opened detail block.
    expect((await screen.findAllByText('vesicular')).length).toBeGreaterThanOrEqual(2);
    fireEvent.change(screen.getByLabelText('Field notes'), { target: { value: 'updated notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callsFor('geology', 'observation-update')).toHaveLength(1));
    expect(callsFor('geology', 'observation-update')[0][2]).toMatchObject({ id: 'ob1', notes: 'updated notes' });
  });
});

describe('ocean-002 — spot edit', () => {
  it('Edit loads the spot into the form and Save fires spot-update', async () => {
    const spot = { id: 'sp1', name: 'Old Break', kind: 'surf', notes: 'rocky', sessionCount: 2, lat: null, lon: null };
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'spot-list') return reply({ spots: [spot] });
      if (action === 'session-list') return reply({ sessions: [] });
      if (action === 'ocean-dashboard') return reply({});
      if (action === 'spot-update') return reply({ spot: { ...spot, name: 'New Break' } });
      return reply({});
    });
    render(<SpotLog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Old Break' }));
    const nameInput = screen.getByLabelText('Spot name for Old Break') as HTMLInputElement;
    expect(nameInput.value).toBe('Old Break');
    fireEvent.change(nameInput, { target: { value: 'New Break' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callsFor('ocean', 'spot-update')).toHaveLength(1));
    expect(callsFor('ocean', 'spot-update')[0][2]).toMatchObject({ id: 'sp1', name: 'New Break' });
  });
});

describe('sports-002 — match edit', () => {
  it('Edit opens the prefilled form and Save fires game-update', async () => {
    const game = { id: 'gm1', homeTeam: 'Home FC', awayTeam: 'Away FC', league: 'general', date: '2026-11-10', homeScore: 3, awayScore: 1, status: 'final', winner: 'Home FC' };
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'game-list') return reply({ games: [game], count: 1 });
      if (action === 'my-scores') return reply({ games: [] });
      if (action === 'watchlist-list') return reply({ ids: [] });
      if (action === 'game-update') return reply({ game: { ...game, homeTeam: 'Home United' } });
      return reply({});
    });
    render(<SportsScoresPanel onChange={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Home FC vs Away FC' }));
    const home = screen.getByLabelText('Home team') as HTMLInputElement;
    expect(home.value).toBe('Home FC');
    fireEvent.change(home, { target: { value: 'Home United' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callsFor('sports', 'game-update')).toHaveLength(1));
    expect(callsFor('sports', 'game-update')[0][2]).toMatchObject({ id: 'gm1', homeTeam: 'Home United' });
    // Scores never ride game-update — game-update-score owns them.
    expect(callsFor('sports', 'game-update')[0][2]).not.toHaveProperty('homeScore');
  });
});
