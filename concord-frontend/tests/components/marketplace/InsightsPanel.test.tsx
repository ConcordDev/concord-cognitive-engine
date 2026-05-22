import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { InsightsPanel } from '@/components/marketplace/InsightsPanel';

const RESULT = {
  keyword: 'boho ring',
  ownListingCount: 3,
  impressions: 12000,
  clicks: 240,
  ctrPct: 2,
  ownTopMatches: [{ id: 'l1', title: 'Brass Boho Ring' }],
};

describe('InsightsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('renders empty saved searches list initially', async () => {
    render(<InsightsPanel />);
    expect(await screen.findByText('No saved searches.')).toBeInTheDocument();
  });

  it('does not search on blank input submit', async () => {
    render(<InsightsPanel />);
    await screen.findByText('No saved searches.');
    const form = screen.getByPlaceholderText(/Search a keyword/).closest('form')!;
    lensRun.mockClear();
    fireEvent.submit(form);
    // search() short-circuits on empty trim
    expect(lensRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'insights-keyword-search' }),
    );
  });

  it('runs a keyword search and renders the result panel', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'insights-keyword-search')
        return Promise.resolve({ data: { ok: true, result: RESULT } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<InsightsPanel />);
    await screen.findByText('No saved searches.');
    fireEvent.change(screen.getByPlaceholderText(/Search a keyword/), {
      target: { value: 'boho ring' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    expect(await screen.findByText('"boho ring"')).toBeInTheDocument();
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText(/Brass Boho Ring/)).toBeInTheDocument();
  });

  it('saves a search after a result is present', async () => {
    let savedCalls = 0;
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'insights-keyword-search')
        return Promise.resolve({ data: { ok: true, result: RESULT } });
      if (spec.action === 'saved-searches-save') {
        savedCalls += 1;
        return Promise.resolve({ data: { ok: true, result: {} } });
      }
      if (spec.action === 'saved-searches-list')
        return Promise.resolve({
          data: {
            ok: true,
            result: { savedSearches: [{ id: 's1', keyword: 'boho ring', savedAt: '2026-05-01T00:00:00Z' }] },
          },
        });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<InsightsPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Search a keyword/), {
      target: { value: 'boho ring' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await screen.findByText('"boho ring"');
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(savedCalls).toBe(1));
    expect(await screen.findByText('2026-05-01')).toBeInTheDocument();
  });

  it('alerts when save returns ok:false', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'insights-keyword-search')
        return Promise.resolve({ data: { ok: true, result: RESULT } });
      if (spec.action === 'saved-searches-save')
        return Promise.resolve({ data: { ok: false, error: 'limit reached', result: null } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<InsightsPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Search a keyword/), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    await screen.findByText('"boho ring"');
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('limit reached'));
    alertSpy.mockRestore();
  });

  it('clicking a saved search re-runs it; trash removes it', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'saved-searches-list')
        return Promise.resolve({
          data: {
            ok: true,
            result: { savedSearches: [{ id: 's1', keyword: 'vinyl', savedAt: '2026-05-02T00:00:00Z' }] },
          },
        });
      if (spec.action === 'insights-keyword-search')
        return Promise.resolve({ data: { ok: true, result: { ...RESULT, keyword: 'vinyl', ownTopMatches: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<InsightsPanel />);
    const savedBtn = await screen.findByText('vinyl');
    fireEvent.click(savedBtn);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'insights-keyword-search', input: { keyword: 'vinyl' } }),
      ),
    );
    // remove
    const trash = document.querySelector('.text-rose-300')!;
    fireEvent.click(trash);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'saved-searches-delete', input: { id: 's1' } }),
      ),
    );
  });

  it('tolerates a search rejection', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'insights-keyword-search') return Promise.reject(new Error('down'));
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<InsightsPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Search a keyword/), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: /Search/ }));
    // no result rendered, no crash
    await waitFor(() => expect(screen.queryByText('"q"')).toBeNull());
  });
});
