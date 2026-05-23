import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AssetsPanel } from '@/components/government/AssetsPanel';

const ASSETS = [
  {
    id: 'a1', kind: 'streetlight', label: 'SL-001', lat: 37.1234, lng: -122.5678,
    condition: 'good', lastInspectedAt: null, maintenanceLog: [],
  },
  {
    id: 'a2', kind: 'hydrant', label: '', lat: 40.0, lng: -74.0,
    condition: 'broken', lastInspectedAt: '2026-01-01',
    maintenanceLog: [{ id: 'm1', work: 'fix', crew: 'A', condition: 'fair', at: '2026-01-01' }],
  },
  {
    id: 'a3', kind: 'sign', label: 'SG-9', lat: 41.0, lng: -75.0,
    condition: 'poor', lastInspectedAt: null, maintenanceLog: [],
  },
];

describe('AssetsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { assets: [] } } });
  });

  it('shows empty state', async () => {
    render(<AssetsPanel />);
    expect(await screen.findByText('No assets in this view.')).toBeInTheDocument();
  });

  it('renders assets with condition badges', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { assets: ASSETS } } });
    render(<AssetsPanel />);
    expect(await screen.findByText('SL-001')).toBeInTheDocument();
    expect(screen.getByText('good')).toBeInTheDocument();
    expect(screen.getByText('broken')).toBeInTheDocument();
    expect(screen.getByText('poor')).toBeInTheDocument();
    // label-less asset falls back to kind (appears in list row + the · suffix span + filter options)
    expect(screen.getAllByText('hydrant').length).toBeGreaterThan(1);
    expect(screen.getByText(/1 maint logs/)).toBeInTheDocument();
  });

  it('filters assets by kind', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { assets: ASSETS } } });
    render(<AssetsPanel />);
    await screen.findByText('SL-001');
    const filterSelect = screen.getByDisplayValue('All kinds');
    fireEvent.change(filterSelect, { target: { value: 'streetlight' } });
    expect(screen.getByText('SL-001')).toBeInTheDocument();
    expect(screen.queryByText('SG-9')).not.toBeInTheDocument();
  });

  it('does not add when lat/lng are missing', async () => {
    render(<AssetsPanel />);
    await screen.findByText('No assets in this view.');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add asset'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'assets-add' }));
  });

  it('adds an asset when lat/lng provided', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'assets-add') return Promise.resolve({ data: { ok: true } });
      return Promise.resolve({ data: { ok: true, result: { assets: [] } } });
    });
    render(<AssetsPanel />);
    await screen.findByText('No assets in this view.');
    fireEvent.change(screen.getByPlaceholderText('Label (SL-001)'), { target: { value: 'SL-2' } });
    fireEvent.change(screen.getByPlaceholderText('Lat'), { target: { value: '37.5' } });
    fireEvent.change(screen.getByPlaceholderText('Lng'), { target: { value: '-122.5' } });
    fireEvent.click(screen.getByText('Add asset'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'assets-add', input: expect.objectContaining({ lat: 37.5, lng: -122.5 }) }),
      ),
    );
  });

  it('logs maintenance via prompts', async () => {
    const promptSpy = vi.spyOn(window, 'prompt')
      .mockReturnValueOnce('Replaced bulb')
      .mockReturnValueOnce('fair');
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'assets-list')
        return Promise.resolve({ data: { ok: true, result: { assets: ASSETS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<AssetsPanel />);
    await screen.findByText('SL-001');
    fireEvent.click(screen.getAllByText('Log work')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'assets-log-maintenance', input: expect.objectContaining({ work: 'Replaced bulb', condition: 'fair' }) }),
      ),
    );
    promptSpy.mockRestore();
  });

  it('skips maintenance when work prompt cancelled', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
    lensRun.mockResolvedValue({ data: { ok: true, result: { assets: ASSETS } } });
    render(<AssetsPanel />);
    await screen.findByText('SL-001');
    lensRun.mockClear();
    fireEvent.click(screen.getAllByText('Log work')[0]);
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'assets-log-maintenance' }));
    promptSpy.mockRestore();
  });

  it('deletes an asset', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { assets: ASSETS } } });
    render(<AssetsPanel />);
    await screen.findByText('SL-001');
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true } });
    const allButtons = document.querySelectorAll('li button');
    // the second button in each row is the trash button
    fireEvent.click(allButtons[1]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'assets-delete' })),
    );
  });

  it('tolerates a refresh rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<AssetsPanel />);
    expect(await screen.findByText('No assets in this view.')).toBeInTheDocument();
  });
});
