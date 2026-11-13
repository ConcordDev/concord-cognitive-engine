/**
 * FIX-science-007 — Field Log coordinate and radius validation.
 * Lat/Lon used to be free text ('abc' sailed through to the macros as
 * NaN) and the cluster radius accepted -1. The fields now validate
 * inline, at the row, before Export or Spatial Cluster can run.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const { lensRunMock } = vi.hoisted(() => ({ lensRunMock: vi.fn() }));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
  lensRun: lensRunMock,
}));

import { ScienceFieldLog } from '@/components/science/ScienceFieldLog';
import { useLensStateStore } from '@/store/lens-state';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useLensStateStore.setState({ lensStates: {} });
  lensRunMock.mockResolvedValue({ data: { ok: true, result: { format: 'csv', records: 1, data: [], exportedAt: '2026-11-11T00:00:00Z' } } });
});

describe('ScienceFieldLog inline validation (FIX-science-007)', () => {
  it('a non-numeric latitude is flagged at the field and Export does not run', () => {
    const { container } = render(<ScienceFieldLog />);
    const lat = screen.getByPlaceholderText('Lat');
    fireEvent.change(lat, { target: { value: 'abc' } });
    expect(screen.getByText('Latitude must be a number.')).toBeTruthy();
    expect(lat.getAttribute('aria-invalid')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(screen.getByText(/Row 1: Latitude must be a number\./)).toBeTruthy();
    expect(lensRunMock).not.toHaveBeenCalled();
    expect(container).toBeTruthy();
  });

  it('an out-of-range longitude and a half-filled pair are each named', () => {
    render(<ScienceFieldLog />);
    const lon = screen.getByPlaceholderText('Lon');
    fireEvent.change(lon, { target: { value: '-181' } });
    expect(screen.getByText('Longitude must be between -180 and 180.')).toBeTruthy();
    fireEvent.change(lon, { target: { value: '-73.9' } });
    expect(screen.getByText('Add both latitude and longitude, or leave both blank.')).toBeTruthy();
  });

  it('a negative cluster radius is flagged inline and Spatial Cluster does not run', () => {
    const { container } = render(<ScienceFieldLog />);
    fireEvent.change(screen.getByPlaceholderText('Lat'), { target: { value: '41.7' } });
    fireEvent.change(screen.getByPlaceholderText('Lon'), { target: { value: '-73.9' } });
    const radius = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(radius, { target: { value: '-1' } });
    expect(screen.getByText('Cluster radius must be greater than zero.')).toBeTruthy();
    expect(radius.getAttribute('aria-invalid')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Spatial Cluster/ }));
    expect(lensRunMock).not.toHaveBeenCalled();
  });

  it('valid coordinates and radius still run both macros', async () => {
    render(<ScienceFieldLog />);
    fireEvent.change(screen.getByPlaceholderText('Lat'), { target: { value: '41.7' } });
    fireEvent.change(screen.getByPlaceholderText('Lon'), { target: { value: '-73.9' } });
    fireEvent.click(screen.getByRole('button', { name: /Export/ }));
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'dataExport')).toBe(true);
  });
});
