/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock the axios-shaped api client. GET for the feeds, POST for rsvp/create,
// lensRun for the spontaneous-gatherings macro.
const get = vi.fn();
const post = vi.fn();
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { WorldEventBoard } from './WorldEventBoard';

const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const secs = (offsetMs: number) => Math.floor((NOW + offsetMs) / 1000);

function eventsResponse(events: unknown[]) {
  return { data: { ok: true, events } };
}
function festivalsResponse(festivals: unknown[]) {
  return { data: { ok: true, festivals } };
}
function gatheringsResponse(gatherings: unknown[]) {
  return { data: { ok: true, result: { gatherings } } };
}

/** Route api.get calls by URL to the right canned response. */
function routeGet(eventsRes: unknown, festivalsRes: unknown) {
  get.mockImplementation((url: string) => {
    if (url.includes('/api/world/events')) return Promise.resolve(eventsRes);
    if (url.includes('/api/festivals/active')) return Promise.resolve(festivalsRes);
    return Promise.reject(new Error(`unexpected url ${url}`));
  });
}

describe('WorldEventBoard', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    lensRun.mockReset();
    // Default: no gatherings, successful POSTs.
    lensRun.mockResolvedValue(gatheringsResponse([]));
    post.mockResolvedValue({ data: { ok: true } });
  });

  it('renders active, upcoming, and festival sections with real-shaped data', async () => {
    routeGet(
      eventsResponse([
        {
          id: 'e-active',
          type: 'gathering',
          name: 'Plaza Bonfire',
          status: 'active',
          districtId: 'old-quarter',
          startTime: iso(-30 * 60_000), // started 30m ago
          endTime: iso(30 * 60_000), // ends in 30m
          rewards: [{ cc: 50 }],
        },
        {
          id: 'e-soon',
          type: 'market',
          name: 'Night Bazaar',
          status: 'scheduled',
          startTime: iso(2 * 60 * 60_000), // in 2h
          endTime: iso(4 * 60 * 60_000),
          rewards: ['Rare crate'],
        },
        {
          id: 'e-done',
          name: 'Finished Thing',
          status: 'completed',
          startTime: iso(-5 * 60 * 60_000),
        },
      ]),
      festivalsResponse([
        {
          festival_id: 'concord_rising',
          name: 'Concord Rising',
          started_at: secs(-60 * 60_000),
          ends_at: secs(3 * 24 * 60 * 60_000),
          decoration_tag: 'lanterns',
          year_idx: 1,
        },
      ]),
    );

    render(<WorldEventBoard worldId="tunya" />);

    // Section headers present.
    await waitFor(() => expect(screen.getByText('Active now')).toBeInTheDocument());
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('Festivals')).toBeInTheDocument();

    // Active event in the active bucket; completed one dropped entirely.
    expect(screen.getByText('Plaza Bonfire')).toBeInTheDocument();
    expect(screen.getByText('Night Bazaar')).toBeInTheDocument();
    expect(screen.queryByText('Finished Thing')).not.toBeInTheDocument();

    // Festival row.
    expect(screen.getByText('Concord Rising')).toBeInTheDocument();

    // Reward + location surface.
    expect(screen.getByText('50 CC')).toBeInTheDocument();
    expect(screen.getByText('old-quarter')).toBeInTheDocument();
  });

  it('humanizes timestamps to relative windows', async () => {
    routeGet(
      eventsResponse([
        {
          id: 'e-soon',
          name: 'Night Bazaar',
          status: 'scheduled',
          startTime: iso(2 * 60 * 60_000), // in 2h
          endTime: iso(3 * 60 * 60_000), // ends in 3h
        },
      ]),
      festivalsResponse([]),
    );

    render(<WorldEventBoard worldId="tunya" />);

    await waitFor(() => expect(screen.getByText('Night Bazaar')).toBeInTheDocument());
    // "in 2h · ends in 3h" rendered as relative text (allow rounding to 2h/3h).
    expect(screen.getByText(/in 2h/)).toBeInTheDocument();
    expect(screen.getByText(/ends in 3h/)).toBeInTheDocument();
  });

  it('shows honest per-section empty states when data is empty', async () => {
    routeGet(eventsResponse([]), festivalsResponse([]));

    render(<WorldEventBoard worldId="tunya" />);

    await waitFor(() => expect(screen.getByText('Active now')).toBeInTheDocument());
    // One "No events scheduled" per empty section (3 sections).
    expect(screen.getAllByText('No events scheduled')).toHaveLength(3);
  });

  it('shows an honest error state on fetch failure and never fabricates rows', async () => {
    get.mockRejectedValue(new Error('network down'));

    render(<WorldEventBoard worldId="tunya" />);

    await waitFor(() =>
      expect(screen.getByText(/Could not load the event board/)).toBeInTheDocument(),
    );
    // No section content / no fabricated rows.
    expect(screen.queryByText('Active now')).not.toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('refreshes on the manual refresh button', async () => {
    routeGet(eventsResponse([]), festivalsResponse([]));

    render(<WorldEventBoard worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Active now')).toBeInTheDocument());

    // Initial load = one call per endpoint = 2 calls.
    expect(get).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByLabelText('Refresh event board'));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(4));
  });

  it('calls the real endpoints with the world id', async () => {
    routeGet(eventsResponse([]), festivalsResponse([]));
    render(<WorldEventBoard worldId="cyber" />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    expect(get).toHaveBeenCalledWith('/api/world/events', { params: { cityId: 'cyber' } });
    expect(get).toHaveBeenCalledWith('/api/festivals/active', { params: { worldId: 'cyber' } });
    // Gatherings come from the world.gatherings macro for this world.
    expect(lensRun).toHaveBeenCalledWith('world', 'gatherings', { worldId: 'cyber' });
  });

  it('renders spontaneous gatherings from the world.gatherings macro', async () => {
    routeGet(eventsResponse([]), festivalsResponse([]));
    lensRun.mockResolvedValue(
      gatheringsResponse([
        { id: 'g1', location: 'Fountain Plaza', playerCount: 4, description: '4 players at the fountain' },
      ]),
    );

    render(<WorldEventBoard worldId="tunya" />);

    await waitFor(() => expect(screen.getByText('Gatherings')).toBeInTheDocument());
    expect(screen.getByText('4 players at the fountain')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('shows an honest empty gatherings state when nobody is grouped up', async () => {
    routeGet(eventsResponse([]), festivalsResponse([]));
    render(<WorldEventBoard worldId="tunya" />);

    await waitFor(() => expect(screen.getByText('Gatherings')).toBeInTheDocument());
    expect(screen.getByText('No spontaneous gatherings right now')).toBeInTheDocument();
  });

  it('RSVPs to an event via the real endpoint and reflects it in the UI', async () => {
    routeGet(
      eventsResponse([
        {
          id: 'e-active',
          name: 'Plaza Bonfire',
          status: 'active',
          startTime: iso(-30 * 60_000),
          endTime: iso(30 * 60_000),
          attendee_count: 2,
        },
      ]),
      festivalsResponse([]),
    );

    render(<WorldEventBoard worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Plaza Bonfire')).toBeInTheDocument());

    fireEvent.click(screen.getByText('RSVP'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/world/events/e-active/rsvp', {}),
    );
    // Optimistic flip to RSVP'd.
    await waitFor(() => expect(screen.getByText(/RSVP'd/)).toBeInTheDocument());
  });

  it('surfaces an honest RSVP error and does not fake success', async () => {
    routeGet(
      eventsResponse([
        { id: 'e1', name: 'Night Bazaar', status: 'active', startTime: iso(-60_000), endTime: iso(60_000) },
      ]),
      festivalsResponse([]),
    );
    post.mockRejectedValue(new Error('network down'));

    render(<WorldEventBoard worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Night Bazaar')).toBeInTheDocument());

    fireEvent.click(screen.getByText('RSVP'));

    await waitFor(() => expect(screen.getByText(/RSVP failed/)).toBeInTheDocument());
    // Never flipped to RSVP'd on failure.
    expect(screen.queryByText(/RSVP'd/)).not.toBeInTheDocument();
  });

  it('creates an event via the real endpoint with worldId in the body', async () => {
    routeGet(eventsResponse([]), festivalsResponse([]));

    render(<WorldEventBoard worldId="tunya" />);
    await waitFor(() => expect(screen.getByText('Active now')).toBeInTheDocument());

    // Open the create form.
    fireEvent.click(screen.getByLabelText('Create event'));
    fireEvent.change(screen.getByPlaceholderText('Event name'), {
      target: { value: 'Founders Gala' },
    });
    fireEvent.click(screen.getByText('Create event'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/world/events', {
        name: 'Founders Gala',
        type: 'concert',
        maxAttendees: 50,
        worldId: 'tunya',
      }),
    );
  });
});
