import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('next/dynamic', () => ({
  default: () => (props: { markers?: { label: string }[] }) => (
    <div data-testid="map-view">{(props.markers || []).map((m, i) => <span key={i}>{m.label}</span>)}</div>
  ),
}));

import { MapAreaSearch } from '@/components/realestate/MapAreaSearch';

const RESULTS = [
  { id: 'r1', address: '1 Pine St', city: 'Austin', state: 'TX', zip: '1', price: 1_200_000, beds: 3, baths: 2, sqft: 1800, yearBuilt: 2010, kind: 'single_family', status: 'for_sale', daysOnMarket: 5, lat: 30.1, lng: -97.5 },
  { id: 'r2', address: '2 Oak Ave', city: 'Austin', state: '', zip: '2', price: 450_000, beds: 2, baths: 1, sqft: 900, yearBuilt: 2000, kind: 'condo', status: 'for_sale', daysOnMarket: 9, lat: null, lng: null },
];

function setBounds() {
  fireEvent.change(document.querySelectorAll('input[type="number"]')[0], { target: { value: '31.0' } });
  fireEvent.change(document.querySelectorAll('input[type="number"]')[1], { target: { value: '29.0' } });
  fireEvent.change(document.querySelectorAll('input[type="number"]')[2], { target: { value: '-96.0' } });
  fireEvent.change(document.querySelectorAll('input[type="number"]')[3], { target: { value: '-99.0' } });
}

describe('MapAreaSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: [], withoutCoords: 0 } } });
  });

  it('shows the initial prompt', () => {
    render(<MapAreaSearch />);
    expect(screen.getByText(/Set a bounding box and search/)).toBeInTheDocument();
  });

  it('errors when not all four bounds are entered', async () => {
    render(<MapAreaSearch />);
    fireEvent.click(screen.getByText('Search this area'));
    expect(await screen.findByText('Enter all four boundary coordinates.')).toBeInTheDocument();
  });

  it('errors when north is not greater than south', async () => {
    render(<MapAreaSearch />);
    fireEvent.change(document.querySelectorAll('input[type="number"]')[0], { target: { value: '29.0' } });
    fireEvent.change(document.querySelectorAll('input[type="number"]')[1], { target: { value: '31.0' } });
    fireEvent.change(document.querySelectorAll('input[type="number"]')[2], { target: { value: '-96.0' } });
    fireEvent.change(document.querySelectorAll('input[type="number"]')[3], { target: { value: '-99.0' } });
    fireEvent.click(screen.getByText('Search this area'));
    expect(await screen.findByText('North latitude must be greater than south.')).toBeInTheDocument();
  });

  it('searches and renders results plus the map with filters', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: RESULTS, withoutCoords: 1 } } });
    render(<MapAreaSearch />);
    setBounds();
    fireEvent.change(screen.getByPlaceholderText('Min $'), { target: { value: '100000' } });
    fireEvent.change(screen.getByPlaceholderText('Max $'), { target: { value: '2000000' } });
    fireEvent.change(screen.getByPlaceholderText('Min beds'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('Search this area'));
    expect(await screen.findByText('1 Pine St')).toBeInTheDocument();
    expect(screen.getAllByText('$1.20M').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$450K').length).toBeGreaterThan(0);
    expect(screen.getByText(/1 listing\(s\) excluded/)).toBeInTheDocument();
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'listings-in-bounds',
          input: expect.objectContaining({ filters: { minPrice: 100000, maxPrice: 2000000, minBeds: 2 } }),
        }),
      ),
    );
  });

  it('selects a result row', async () => {
    const onSelect = vi.fn();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: RESULTS, withoutCoords: 0 } } });
    render(<MapAreaSearch onSelect={onSelect} />);
    setBounds();
    fireEvent.click(screen.getByText('Search this area'));
    await screen.findByText('1 Pine St');
    fireEvent.click(screen.getByText('1 Pine St'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });

  it('shows the no-results message with the without-coords hint', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: [], withoutCoords: 3 } } });
    render(<MapAreaSearch />);
    setBounds();
    fireEvent.click(screen.getByText('Search this area'));
    expect(await screen.findByText(/No listings in this area yet\. 3 listing\(s\) have no coordinates\./)).toBeInTheDocument();
  });

  it('shows a server error when ok is false', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'bbox too wide' } });
    render(<MapAreaSearch />);
    setBounds();
    fireEvent.click(screen.getByText('Search this area'));
    expect(await screen.findByText('bbox too wide')).toBeInTheDocument();
  });

  it('tolerates a search rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<MapAreaSearch />);
    setBounds();
    fireEvent.click(screen.getByText('Search this area'));
    expect(await screen.findByText('Search failed.')).toBeInTheDocument();
  });

  it('uses geolocation to fill the bounding box', async () => {
    const getCurrentPosition = vi.fn((success: (p: { coords: { latitude: number; longitude: number } }) => void) => {
      success({ coords: { latitude: 30.0, longitude: -97.0 } });
    });
    (navigator as unknown as { geolocation: unknown }).geolocation = { getCurrentPosition };
    render(<MapAreaSearch />);
    fireEvent.click(screen.getByText('Use my area'));
    await waitFor(() => {
      const north = document.querySelectorAll('input[type="number"]')[0] as HTMLInputElement;
      expect(north.value).toBe('30.1500');
    });
  });

  it('errors when geolocation fails', async () => {
    const getCurrentPosition = vi.fn((_s: unknown, fail: () => void) => fail());
    (navigator as unknown as { geolocation: unknown }).geolocation = { getCurrentPosition };
    render(<MapAreaSearch />);
    fireEvent.click(screen.getByText('Use my area'));
    expect(await screen.findByText(/Geolocation unavailable/)).toBeInTheDocument();
  });
});
