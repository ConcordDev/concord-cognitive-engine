/**
 * DeityDetailPanel — "view full pilgrim log" expansion (Wave 4 gap closure).
 *
 * `deity.detail` caps its `pilgrimRoster` at 50 rows; `deity.pilgrim_log`
 * returns the same shape up to 200 rows (server/domains/deities.js). This
 * pins the frontend wire: the expand affordance only appears when the
 * roster is plausibly hiding more (pilgrim_count exceeds what `detail`
 * handed back), clicking it calls the real macro with the right params,
 * the expanded view renders the returned pilgrims, and a failed fetch
 * surfaces an honest role=alert error rather than fabricating rows.
 *
 * No fabricated data: every assertion is driven by a mocked lensRun
 * standing in for the real backend, in the exact shape
 * server/domains/deities.js returns for `detail` and `pilgrim_log`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

// Heavy presentational viz children — stub (no fake data; renders only the
// values the test already provides via props).
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: ({ events }: { events: Array<{ id: string; label: string }> }) =>
    React.createElement(
      'div',
      { 'data-testid': 'timeline', 'data-count': events.length },
      events.map((e) => React.createElement('span', { key: e.id, 'data-testid': 'roster-row' }, e.label)),
    ),
}));

import { DeityDetailPanel } from '@/components/deities/DeityDetailPanel';

function reply(result: Record<string, unknown> | null, ok = true, error: string | null = null) {
  return Promise.resolve({ data: { ok, result, error } });
}

function rosterOf(n: number, offset = 0) {
  return Array.from({ length: n }, (_, i) => ({
    id: `pilg_${offset + i}`,
    pilgrim_user_id: `user_${(offset + i).toString().padStart(4, '0')}abcdef`,
    origin_peer: null,
    arrived_at: 1700000000 + offset + i,
  }));
}

function deityDetail(overrides: Partial<{ pilgrim_count: number; roster: ReturnType<typeof rosterOf> }> = {}) {
  const roster = overrides.roster ?? rosterOf(3);
  const pilgrim_count = overrides.pilgrim_count ?? roster.length;
  return {
    deity: {
      id: 'deity_1',
      name: 'Veyra',
      domainTitle: 'Patron of the tide',
      creed: 'The sea remembers.',
      author_user_id: 'author_1',
      pilgrim_count,
      revision: 1,
      toneVector: { warmth: 0.5, refusal: 0.2, mystery: 0.7 },
      dialogueTemplates: [],
      alignmentThresholds: { commune: 0.2, refuse: -0.4 },
    },
    pilgrimRoster: roster,
    rosterCount: roster.length,
    isAuthor: false,
    myDevotion: null,
  };
}

function defaultRoutes(detailResult: ReturnType<typeof deityDetail>) {
  return (_domain: string, action: string) => {
    if (action === 'detail') return reply(detailResult);
    if (action === 'blessings') return reply({ deityName: 'Veyra', devotion: { score: 0, alignment: 0 }, tiers: [], nextTier: null });
    if (action === 'commune_log') return reply({ utterances: [] });
    return reply(null, false, `unexpected action: ${action}`);
  };
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('DeityDetailPanel — full pilgrim log expansion', () => {
  it('does NOT show the expand button when the roster already covers every pilgrim', async () => {
    const detail = deityDetail({ pilgrim_count: 3, roster: rosterOf(3) });
    lensRun.mockImplementation(defaultRoutes(detail));
    const { getByText, queryByText } = render(
      <DeityDetailPanel deityId="deity_1" onClose={() => {}} onChanged={() => {}} />,
    );
    await waitFor(() => expect(getByText('Veyra')).toBeInTheDocument());
    expect(queryByText(/View full pilgrim log/i)).toBeNull();
  });

  it('shows the expand button when the 50-row roster is capped and pilgrim_count exceeds it', async () => {
    const detail = deityDetail({ pilgrim_count: 57, roster: rosterOf(50) });
    lensRun.mockImplementation(defaultRoutes(detail));
    const { getByText } = render(
      <DeityDetailPanel deityId="deity_1" onClose={() => {}} onChanged={() => {}} />,
    );
    await waitFor(() => expect(getByText('Veyra')).toBeInTheDocument());
    expect(getByText('View full pilgrim log (57 total)')).toBeInTheDocument();
  });

  it('clicking the expand button calls deity.pilgrim_log with {deityId, limit:200} and renders the returned pilgrims', async () => {
    const detail = deityDetail({ pilgrim_count: 57, roster: rosterOf(50) });
    const fullLog = rosterOf(57);
    lensRun.mockImplementation((domain: string, action: string, _params?: Record<string, unknown>) => {
      if (action === 'pilgrim_log') return reply({ pilgrims: fullLog, count: fullLog.length });
      return defaultRoutes(detail)(domain, action);
    });
    const { getByText, getAllByTestId, container } = render(
      <DeityDetailPanel deityId="deity_1" onClose={() => {}} onChanged={() => {}} />,
    );
    await waitFor(() => expect(getByText('Veyra')).toBeInTheDocument());

    fireEvent.click(getByText('View full pilgrim log (57 total)'));

    await waitFor(() =>
      expect(lensRun.mock.calls.some((c) => c[0] === 'deity' && c[1] === 'pilgrim_log')).toBe(true));
    const call = lensRun.mock.calls.find((c) => c[1] === 'pilgrim_log');
    expect(call?.[2]).toEqual({ deityId: 'deity_1', limit: 200 });

    await waitFor(() => {
      const headings = Array.from(container.querySelectorAll('h3')).map((h) => h.textContent);
      expect(headings).toContain('Pilgrim roster (57 of 57 — full log)');
    });
    expect(getAllByTestId('roster-row')).toHaveLength(57);
    // the expand button is replaced by a collapse control once expanded
    expect(() => getByText('View full pilgrim log (57 total)')).toThrow();
    expect(getByText('Show recent 50 only')).toBeInTheDocument();
  });

  it('an honest failure surfaces role=alert and never fabricates rows', async () => {
    const detail = deityDetail({ pilgrim_count: 57, roster: rosterOf(50) });
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'pilgrim_log') return reply(null, false, 'pilgrim_log_unreachable');
      return defaultRoutes(detail)(domain, action);
    });
    const { getByText, container, getAllByTestId } = render(
      <DeityDetailPanel deityId="deity_1" onClose={() => {}} onChanged={() => {}} />,
    );
    await waitFor(() => expect(getByText('Veyra')).toBeInTheDocument());

    fireEvent.click(getByText('View full pilgrim log (57 total)'));

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText('pilgrim_log_unreachable')).toBeInTheDocument();
    // roster stays at the original 50 — no fabricated placeholder rows appended
    expect(getAllByTestId('roster-row')).toHaveLength(50);
    // the expand button remains offered so the user can retry
    expect(getByText('View full pilgrim log (57 total)')).toBeInTheDocument();
  });

  it('honest empty state: a deity with zero pilgrims renders "No pilgrims yet." with no expand affordance', async () => {
    const detail = deityDetail({ pilgrim_count: 0, roster: [] });
    lensRun.mockImplementation(defaultRoutes(detail));
    const { getByText, queryByText } = render(
      <DeityDetailPanel deityId="deity_1" onClose={() => {}} onChanged={() => {}} />,
    );
    await waitFor(() => expect(getByText('Veyra')).toBeInTheDocument());
    expect(getByText('No pilgrims yet.')).toBeInTheDocument();
    expect(queryByText(/View full pilgrim log/i)).toBeNull();
  });
});
