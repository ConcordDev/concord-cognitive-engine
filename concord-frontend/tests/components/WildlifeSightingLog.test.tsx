/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the desert wildlife sighting log (Wave 4 gap-closure,
// docs/lens-specs/desert-capability-map.md "Genuinely missing, deferred"
// #1: "the previous 'Wildlife' tab was 100% fabricated ... has been
// removed") against the real desert.sighting* macro contract: create, list,
// delete, and the nearby proximity query — all server-persisted, never
// client-invented.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { WildlifeSightingLog } from '@/components/desert/WildlifeSightingLog';

const SIGHTING = {
  id: 'sighting_1',
  species: 'Desert bighorn sheep',
  commonOrScientific: '',
  count: 3,
  lat: 10,
  lng: 20,
  observedAt: '2026-07-01T00:00:00.000Z',
  behavior: 'grazing',
  confidence: 'probable',
  notes: '',
  photoUrl: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

function listResponse(sightings: Array<Record<string, unknown>> = []) {
  const bySpecies: Record<string, number> = {};
  for (const s of sightings) {
    const sp = s.species as string;
    bySpecies[sp] = (bySpecies[sp] || 0) + 1;
  }
  return { data: { ok: true, result: { sightings, count: sightings.length, bySpecies } } };
}

describe('WildlifeSightingLog', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via sightingList and renders the sighting row', async () => {
    lensRun.mockResolvedValueOnce(listResponse([SIGHTING]));
    render(<WildlifeSightingLog />);

    const row = await screen.findByTestId('sighting-row-sighting_1');
    expect(within(row).getByText('Desert bighorn sheep')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('desert', 'sightingList', {});
  });

  it('an empty log renders an honest empty state, not fabricated sightings', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<WildlifeSightingLog />);
    await waitFor(() => expect(screen.getByText(/No wildlife sightings logged yet/)).toBeInTheDocument());
  });

  it('renders the confidence badge and species count from the server record', async () => {
    lensRun.mockResolvedValueOnce(listResponse([SIGHTING]));
    render(<WildlifeSightingLog />);
    const row = await screen.findByTestId('sighting-row-sighting_1');
    expect(within(row).getByText('probable')).toBeInTheDocument();
    expect(within(row).getByText('×3')).toBeInTheDocument();
  });

  it('create calls sightingSave with the typed fields and refreshes', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({ data: { ok: true, result: { ...SIGHTING, id: 'sighting_new', species: 'Roadrunner' } } })
      .mockResolvedValueOnce(listResponse([{ ...SIGHTING, id: 'sighting_new', species: 'Roadrunner' }]));

    render(<WildlifeSightingLog />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('Species (e.g. Desert bighorn sheep)'), { target: { value: 'Roadrunner' } });
    fireEvent.change(screen.getByPlaceholderText('lat'), { target: { value: '12' } });
    fireEvent.change(screen.getByPlaceholderText('lng'), { target: { value: '34' } });
    fireEvent.click(screen.getByText('Log sighting'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'desert',
        'sightingSave',
        expect.objectContaining({ species: 'Roadrunner', lat: 12, lng: 34, confidence: 'probable' }),
      ),
    );
    const row = await screen.findByTestId('sighting-row-sighting_new');
    expect(within(row).getByText('Roadrunner')).toBeInTheDocument();
  });

  it('rejects submitting without a species (client-side honesty check, no macro call)', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<WildlifeSightingLog />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('lat'), { target: { value: '1' } });
    fireEvent.change(screen.getByPlaceholderText('lng'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Log sighting'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Species is required');
    expect(lensRun).toHaveBeenCalledTimes(1); // no sightingSave call fired
  });

  it('delete calls sightingDelete and refreshes the list', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([SIGHTING]))
      .mockResolvedValueOnce({ data: { ok: true, result: { deleted: 'sighting_1' } } })
      .mockResolvedValueOnce(listResponse([]));

    render(<WildlifeSightingLog />);
    await screen.findByTestId('sighting-row-sighting_1');

    fireEvent.click(screen.getByLabelText('Delete Desert bighorn sheep sighting'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('desert', 'sightingDelete', { id: 'sighting_1' }));
    await waitFor(() => expect(screen.getByText(/No wildlife sightings logged yet/)).toBeInTheDocument());
  });

  it('nearby search calls sightingsNearby and renders distance-sorted results', async () => {
    lensRun
      .mockResolvedValueOnce(listResponse([]))
      .mockResolvedValueOnce({
        data: {
          ok: true,
          result: { sightings: [{ ...SIGHTING, distanceKm: 4.2 }], count: 1 },
        },
      });

    render(<WildlifeSightingLog />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('search lat'), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText('search lng'), { target: { value: '20' } });
    fireEvent.click(screen.getByText('Find'));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('desert', 'sightingsNearby', { lat: 10, lng: 20, radiusKm: 100 }),
    );
    expect(await screen.findByText('4.2 km')).toBeInTheDocument();
  });

  it('surfaces an honest error on a failed load instead of a silent blank log', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'STATE unavailable' } });
    render(<WildlifeSightingLog />);
    expect(await screen.findByRole('alert')).toHaveTextContent('STATE unavailable');
  });
});
