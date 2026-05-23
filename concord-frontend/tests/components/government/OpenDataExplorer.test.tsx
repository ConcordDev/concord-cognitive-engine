import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { OpenDataExplorer } from '@/components/government/OpenDataExplorer';

const RESULTS = [
  {
    id: 'ds1', name: 'crime', title: 'Crime Stats', organization: 'DOJ', notes: 'Annual crime data.',
    resourceCount: 3, firstResourceUrl: 'https://x/csv', firstResourceFormat: 'CSV', lastModified: '2026-01-01T00:00:00Z',
  },
  {
    id: 'ds2', name: 'water', title: 'Water Quality', organization: 'EPA', notes: '',
    resourceCount: 0, firstResourceUrl: null, firstResourceFormat: null, lastModified: null,
  },
];

describe('OpenDataExplorer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { results: [], total: 0 } } });
  });

  it('renders idle prompt before searching', () => {
    render(<OpenDataExplorer />);
    expect(screen.getByText(/Search to explore federal/)).toBeInTheDocument();
  });

  it('does not search with an empty query', () => {
    render(<OpenDataExplorer />);
    fireEvent.submit(screen.getByPlaceholderText(/Search 300/).closest('form')!);
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('searches and renders results with total', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { results: RESULTS, total: 1234 } } });
    render(<OpenDataExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Search 300/), { target: { value: 'crime' } });
    fireEvent.submit(screen.getByPlaceholderText(/Search 300/).closest('form')!);
    expect(await screen.findByText('Crime Stats')).toBeInTheDocument();
    expect(screen.getByText('Water Quality')).toBeInTheDocument();
    expect(screen.getByText(/1,234 matches/)).toBeInTheDocument();
    expect(screen.getByText(/CSV · 3 files/)).toBeInTheDocument();
  });

  it('shows an error on macro ok:false', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'rate limited' } });
    render(<OpenDataExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Search 300/), { target: { value: 'x' } });
    fireEvent.submit(screen.getByPlaceholderText(/Search 300/).closest('form')!);
    expect(await screen.findByText('rate limited')).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('network down'));
    render(<OpenDataExplorer />);
    fireEvent.change(screen.getByPlaceholderText(/Search 300/), { target: { value: 'x' } });
    fireEvent.submit(screen.getByPlaceholderText(/Search 300/).closest('form')!);
    expect(await screen.findByText('network down')).toBeInTheDocument();
  });
});
