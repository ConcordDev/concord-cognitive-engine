/**
 * SpatialQueryForm — Wave 4 gap-closure coverage for the atlas
 * capability-map's `query` item (docs/lens-specs/atlas-capability-map.md
 * §1c / docs/WAVE4_INVENTORY.md line 112): a power-user ad-hoc query macro
 * with no frontend caller.
 *
 * Pins: renders a real designed type-selector (not a JSON-paste textarea)
 * that drives a distinct real field set per query type matching
 * server/lib/foundation-atlas.js#executeSpatialQuery's real dispatch
 * contract; a real submit calls `apiHelpers.atlasTomography.query` with the
 * correctly-shaped payload per type; and honest rendering of both a
 * populated result and an empty/no-data result (never fabricated).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const query = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    atlasTomography: {
      query: (...args: unknown[]) => query(...args),
    },
  },
}));

import { SpatialQueryForm } from '@/components/atlas/SpatialQueryForm';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function selectType(getByLabelText: (text: string) => HTMLElement, value: string) {
  fireEvent.change(getByLabelText('Query type'), { target: { value } });
}

describe('SpatialQueryForm', () => {
  beforeEach(() => {
    query.mockReset();
  });

  it('renders a real designed type-selector, not a raw JSON textarea', () => {
    const { getByLabelText, getByText, queryByRole } = renderWithQuery(<SpatialQueryForm />);
    const select = getByLabelText('Query type') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(['point', 'area', 'radius', 'material', 'subsurface', 'changes']);
    expect(getByText('Ad-hoc Spatial Query')).toBeInTheDocument();
    expect(queryByRole('textbox', { name: /json/i })).not.toBeInTheDocument();
  });

  it('drives lat/lng fields for the point type by default', () => {
    const { getByPlaceholderText, queryByPlaceholderText } = renderWithQuery(<SpatialQueryForm />);
    expect(getByPlaceholderText('Latitude *')).toBeInTheDocument();
    expect(getByPlaceholderText('Longitude *')).toBeInTheDocument();
    expect(queryByPlaceholderText('Radius (m) *')).not.toBeInTheDocument();
    expect(queryByPlaceholderText('lat_min *')).not.toBeInTheDocument();
  });

  it('switches to lat/lng + radius_m fields for the radius type', () => {
    const { getByLabelText, getByPlaceholderText, queryByPlaceholderText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'radius');
    expect(getByPlaceholderText('Latitude *')).toBeInTheDocument();
    expect(getByPlaceholderText('Longitude *')).toBeInTheDocument();
    expect(getByPlaceholderText('Radius (m) *')).toBeInTheDocument();
    expect(queryByPlaceholderText('lat_min *')).not.toBeInTheDocument();
  });

  it('switches to bounds fields for the area type', () => {
    const { getByLabelText, getByPlaceholderText, queryByPlaceholderText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'area');
    expect(getByPlaceholderText('lat_min *')).toBeInTheDocument();
    expect(getByPlaceholderText('lat_max *')).toBeInTheDocument();
    expect(getByPlaceholderText('lng_min *')).toBeInTheDocument();
    expect(getByPlaceholderText('lng_max *')).toBeInTheDocument();
    expect(queryByPlaceholderText('Latitude *')).not.toBeInTheDocument();
  });

  it('switches to bounds fields for the subsurface type', () => {
    const { getByLabelText, getByPlaceholderText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'subsurface');
    expect(getByPlaceholderText('lat_min *')).toBeInTheDocument();
    expect(getByPlaceholderText('lng_max *')).toBeInTheDocument();
  });

  it('switches to optional bounds + since + limit fields for the changes type', () => {
    const { getByLabelText, getByPlaceholderText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'changes');
    expect(getByPlaceholderText('lat_min (optional)')).toBeInTheDocument();
    expect(getByPlaceholderText('lat_max (optional)')).toBeInTheDocument();
    expect(getByPlaceholderText('Since (ISO date, optional)')).toBeInTheDocument();
    expect(getByPlaceholderText('Limit (default 50, max 200)')).toBeInTheDocument();
  });

  it('shows a validation error and does NOT call the backend when coordinates are missing (point)', async () => {
    const { getByText, findByRole } = renderWithQuery(<SpatialQueryForm />);
    fireEvent.click(getByText('Run query'));
    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/latitude|longitude/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('shows a validation error and does NOT call the backend when bounds are incomplete (area)', async () => {
    const { getByLabelText, getByPlaceholderText, getByText, findByRole } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'area');
    fireEvent.change(getByPlaceholderText('lat_min *'), { target: { value: '10' } });
    fireEvent.click(getByText('Run query'));
    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/required/i);
    expect(query).not.toHaveBeenCalled();
  });

  it('submits the correctly-shaped payload for a point query', async () => {
    query.mockResolvedValue({ data: { ok: true, tile: null } });
    const { getByPlaceholderText, getByText } = renderWithQuery(<SpatialQueryForm />);
    fireEvent.change(getByPlaceholderText('Latitude *'), { target: { value: '40.7' } });
    fireEvent.change(getByPlaceholderText('Longitude *'), { target: { value: '-74' } });
    fireEvent.click(getByText('Run query'));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith({ type: 'point', coordinates: { lat: 40.7, lng: -74 } });
  });

  it('submits the correctly-shaped payload for a material query', async () => {
    query.mockResolvedValue({ data: { ok: true, material: 'concrete', confidence: 0.9, resolution_cm: 10 } });
    const { getByLabelText, getByPlaceholderText, getByText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'material');
    fireEvent.change(getByPlaceholderText('Latitude *'), { target: { value: '1' } });
    fireEvent.change(getByPlaceholderText('Longitude *'), { target: { value: '2' } });
    fireEvent.click(getByText('Run query'));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith({ type: 'material', coordinates: { lat: 1, lng: 2 } });
  });

  it('submits the correctly-shaped payload for a radius query', async () => {
    query.mockResolvedValue({ data: { ok: true, tileCount: 0, tiles: [] } });
    const { getByLabelText, getByPlaceholderText, getByText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'radius');
    fireEvent.change(getByPlaceholderText('Latitude *'), { target: { value: '5' } });
    fireEvent.change(getByPlaceholderText('Longitude *'), { target: { value: '6' } });
    fireEvent.change(getByPlaceholderText('Radius (m) *'), { target: { value: '250' } });
    fireEvent.click(getByText('Run query'));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith({ type: 'radius', coordinates: { lat: 5, lng: 6 }, radius_m: 250 });
  });

  it('submits the correctly-shaped payload for an area query', async () => {
    query.mockResolvedValue({ data: { ok: true, tileCount: 2, tiles: [{ id: 'tile_1' }, { id: 'tile_2' }] } });
    const { getByLabelText, getByPlaceholderText, getByText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'area');
    fireEvent.change(getByPlaceholderText('lat_min *'), { target: { value: '1' } });
    fireEvent.change(getByPlaceholderText('lat_max *'), { target: { value: '2' } });
    fireEvent.change(getByPlaceholderText('lng_min *'), { target: { value: '3' } });
    fireEvent.change(getByPlaceholderText('lng_max *'), { target: { value: '4' } });
    fireEvent.click(getByText('Run query'));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith({ type: 'area', bounds: { lat_min: 1, lat_max: 2, lng_min: 3, lng_max: 4 } });
  });

  it('submits the correctly-shaped payload for a subsurface query', async () => {
    query.mockResolvedValue({ data: { ok: true, tileCount: 0, tiles: [] } });
    const { getByLabelText, getByPlaceholderText, getByText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'subsurface');
    fireEvent.change(getByPlaceholderText('lat_min *'), { target: { value: '1' } });
    fireEvent.change(getByPlaceholderText('lat_max *'), { target: { value: '2' } });
    fireEvent.change(getByPlaceholderText('lng_min *'), { target: { value: '3' } });
    fireEvent.change(getByPlaceholderText('lng_max *'), { target: { value: '4' } });
    fireEvent.click(getByText('Run query'));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith({ type: 'subsurface', bounds: { lat_min: 1, lat_max: 2, lng_min: 3, lng_max: 4 } });
  });

  it('submits a changes query with no bounds when none are provided', async () => {
    query.mockResolvedValue({ data: { ok: true, count: 0, total: 0, changes: [] } });
    const { getByLabelText, getByPlaceholderText, getByText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'changes');
    fireEvent.change(getByPlaceholderText('Limit (default 50, max 200)'), { target: { value: '25' } });
    fireEvent.click(getByText('Run query'));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith({ type: 'changes', limit: 25 });
  });

  it('submits a changes query with bounds + since when provided', async () => {
    query.mockResolvedValue({ data: { ok: true, count: 0, total: 0, changes: [] } });
    const { getByLabelText, getByPlaceholderText, getByText } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'changes');
    fireEvent.change(getByPlaceholderText('lat_min (optional)'), { target: { value: '1' } });
    fireEvent.change(getByPlaceholderText('lat_max (optional)'), { target: { value: '2' } });
    fireEvent.change(getByPlaceholderText('lng_min (optional)'), { target: { value: '3' } });
    fireEvent.change(getByPlaceholderText('lng_max (optional)'), { target: { value: '4' } });
    fireEvent.change(getByPlaceholderText('Since (ISO date, optional)'), { target: { value: '2026-01-01' } });
    fireEvent.click(getByText('Run query'));

    await waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith({
      type: 'changes',
      bounds: { lat_min: 1, lat_max: 2, lng_min: 3, lng_max: 4 },
      since: '2026-01-01',
    });
  });

  it('renders an honest empty result for a point query with no tile at those coordinates', async () => {
    query.mockResolvedValue({ data: { ok: true, tile: null } });
    const { getByPlaceholderText, getByText, findByRole } = renderWithQuery(<SpatialQueryForm />);
    fireEvent.change(getByPlaceholderText('Latitude *'), { target: { value: '1' } });
    fireEvent.change(getByPlaceholderText('Longitude *'), { target: { value: '1' } });
    fireEvent.click(getByText('Run query'));

    const status = await findByRole('status');
    expect(status.textContent).toMatch(/no tile at these coordinates/i);
  });

  it('renders an honest empty result for an area query with zero tiles', async () => {
    query.mockResolvedValue({ data: { ok: true, tileCount: 0, tiles: [] } });
    const { getByLabelText, getByPlaceholderText, getByText, findByRole } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'area');
    fireEvent.change(getByPlaceholderText('lat_min *'), { target: { value: '1' } });
    fireEvent.change(getByPlaceholderText('lat_max *'), { target: { value: '2' } });
    fireEvent.change(getByPlaceholderText('lng_min *'), { target: { value: '3' } });
    fireEvent.change(getByPlaceholderText('lng_max *'), { target: { value: '4' } });
    fireEvent.click(getByText('Run query'));

    const status = await findByRole('status');
    expect(status.textContent).toMatch(/no tiles found/i);
  });

  it('renders a real populated result for an area query with tiles', async () => {
    query.mockResolvedValue({
      data: { ok: true, tier: 'PUBLIC', tileCount: 2, tiles: [{ id: 'tile_abc' }, { id: 'tile_def' }] },
    });
    const { getByLabelText, getByPlaceholderText, getByText, findByRole } = renderWithQuery(<SpatialQueryForm />);
    selectType(getByLabelText, 'area');
    fireEvent.change(getByPlaceholderText('lat_min *'), { target: { value: '1' } });
    fireEvent.change(getByPlaceholderText('lat_max *'), { target: { value: '2' } });
    fireEvent.change(getByPlaceholderText('lng_min *'), { target: { value: '3' } });
    fireEvent.change(getByPlaceholderText('lng_max *'), { target: { value: '4' } });
    fireEvent.click(getByText('Run query'));

    const status = await findByRole('status');
    expect(status.textContent).toMatch(/2 tiles found/i);
    expect(getByText(/tile_abc/)).toBeInTheDocument();
    expect(getByText(/tile_def/)).toBeInTheDocument();
  });

  it('renders an honest server-side rejection without fabricating a success state', async () => {
    query.mockResolvedValue({ data: { ok: false, error: 'unknown_query_type', validTypes: ['point', 'area'] } });
    const { getByPlaceholderText, getByText, findByRole } = renderWithQuery(<SpatialQueryForm />);
    fireEvent.change(getByPlaceholderText('Latitude *'), { target: { value: '1' } });
    fireEvent.change(getByPlaceholderText('Longitude *'), { target: { value: '1' } });
    fireEvent.click(getByText('Run query'));

    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/unknown_query_type/);
  });

  it('surfaces a network failure honestly without fabricating a result', async () => {
    query.mockRejectedValue(new Error('network down'));
    const { getByPlaceholderText, getByText, findByRole } = renderWithQuery(<SpatialQueryForm />);
    fireEvent.change(getByPlaceholderText('Latitude *'), { target: { value: '1' } });
    fireEvent.change(getByPlaceholderText('Longitude *'), { target: { value: '1' } });
    fireEvent.click(getByText('Run query'));

    const alert = await findByRole('alert');
    expect(alert.textContent).toMatch(/could not reach/i);
  });
});
