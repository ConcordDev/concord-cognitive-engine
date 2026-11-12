/**
 * FIX-calendar-014 — "Prep with agent" never showed its prep. The agent
 * loop (lib/chat-agent.js runAgentLoop) returns its text as `answer`;
 * EventActionRail read only reply/summary/output, so every completed
 * prep fell into the "Agent returned empty." branch. The rail now reads
 * the field the loop returns (the chain every other lens panel uses)
 * and reports a failed run as a failure, not as emptiness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/calendar/CalendarKeepMenu', () => ({
  CalendarKeepMenu: () => null,
}));

import { EventActionRail } from '@/components/calendar/EventActionRail';

const EVENT = {
  id: 'evt_1',
  title: 'Design review',
  description: 'Q3 deck',
  startDate: new Date('2026-11-12T15:00:00'),
  endDate: new Date('2026-11-12T16:00:00'),
  eventType: 'meeting',
  collaborators: ['sam@example.com'],
};

beforeEach(() => {
  lensRunMock.mockReset();
});

async function clickPrep() {
  render(<EventActionRail event={EVENT} />);
  const btn = await waitFor(() => screen.getByRole('button', { name: /Prep with agent/ }));
  await act(async () => { fireEvent.click(btn); });
}

describe('EventActionRail prep with agent (FIX-calendar-014)', () => {
  it('shows the prep the agent returned in its `answer` field', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { answer: 'Bring the Q3 deck — Sam shared two prior DTUs on it.', toolCalls: [] } } });
    await clickPrep();
    await waitFor(() => expect(screen.getByText(/Bring the Q3 deck/)).toBeInTheDocument());
    expect(screen.getByText('Agent prep')).toBeInTheDocument();
    expect(screen.getByText('Agent finished prep.')).toBeInTheDocument();
  });

  it('a failed agent run says it failed, not that it returned empty', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'agent unavailable', result: { ok: false } } });
    await clickPrep();
    await waitFor(() => expect(screen.getByText('agent unavailable')).toBeInTheDocument());
    expect(screen.queryByText('Agent returned empty.')).toBeNull();
  });

  it('a genuinely empty result still says so', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { toolCalls: [] } } });
    await clickPrep();
    await waitFor(() => expect(screen.getByText('Agent returned empty.')).toBeInTheDocument());
  });
});
