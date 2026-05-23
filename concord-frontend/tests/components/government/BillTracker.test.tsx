import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { BillTracker } from '@/components/government/BillTracker';

const BILLS = [
  {
    id: 'b1', number: 'HR1', congress: 119, title: 'First Bill',
    summary: 'A summary', introducedDate: '2026-01-01', latestActionDate: '2026-02-01',
    latestActionText: 'Referred', status: 'committee',
    sponsor: { name: 'Rep A', party: 'D', state: 'CA' }, cosponsors: 12, url: 'https://congress.gov/b1',
  },
  {
    id: 'b2', number: 'S2', congress: 119, title: 'Second Bill',
    introducedDate: '2026-01-02', status: 'signed',
  },
  {
    id: 'b3', number: 'HR3', congress: 119, title: 'Third Bill',
    introducedDate: '2026-01-03', status: 'vetoed',
  },
];

// The global setup mocks localStorage with no-op vi.fn()s. Install a real
// in-memory store so persistence branches can actually be exercised.
function installMemoryStorage() {
  let store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { store = {}; },
    },
  });
}

describe('BillTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installMemoryStorage();
    window.localStorage.clear();
    lensRun.mockResolvedValue({ data: { ok: true, result: { bills: [] } } });
  });

  it('shows empty state', async () => {
    render(<BillTracker />);
    expect(await screen.findByText('No bills match.')).toBeInTheDocument();
  });

  it('renders bills with status, sponsor and external link', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { bills: BILLS } } });
    render(<BillTracker />);
    expect(await screen.findByText('First Bill')).toBeInTheDocument();
    expect(screen.getByText('committee')).toBeInTheDocument();
    expect(screen.getByText('signed')).toBeInTheDocument();
    expect(screen.getByText('vetoed')).toBeInTheDocument();
    expect(screen.getByText('A summary')).toBeInTheDocument();
    expect(screen.getByText('Rep A (D-CA)')).toBeInTheDocument();
    expect(screen.getByText('12 co-sponsors')).toBeInTheDocument();
    expect(screen.getByText('congress.gov')).toBeInTheDocument();
  });

  it('searches by topic on button click', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { bills: BILLS } } });
    render(<BillTracker />);
    await screen.findByText('First Bill');
    lensRun.mockClear();
    fireEvent.change(screen.getByPlaceholderText(/Search by topic/), { target: { value: 'climate' } });
    fireEvent.click(screen.getByText('Search'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bills-list', input: { topic: 'climate', limit: 40 } }),
      ),
    );
  });

  it('searches on Enter keydown', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { bills: BILLS } } });
    render(<BillTracker />);
    await screen.findByText('First Bill');
    lensRun.mockClear();
    const input = screen.getByPlaceholderText(/Search by topic/);
    fireEvent.change(input, { target: { value: 'AI' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ input: { topic: 'AI', limit: 40 } }),
      ),
    );
  });

  it('does not search on non-Enter keydown', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { bills: BILLS } } });
    render(<BillTracker />);
    await screen.findByText('First Bill');
    lensRun.mockClear();
    fireEvent.keyDown(screen.getByPlaceholderText(/Search by topic/), { key: 'a' });
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('toggles watch and persists to localStorage, filters watched only', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { bills: BILLS } } });
    render(<BillTracker />);
    await screen.findByText('First Bill');
    const watchButtons = screen.getAllByTitle('Watch');
    fireEvent.click(watchButtons[0]);
    expect(screen.getByText((_c, el) => el?.textContent === '1 watching')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('concord:gov:bill-watch:v1') || '[]')).toContain('b1');

    fireEvent.change(screen.getByDisplayValue('All status'), { target: { value: 'watched' } });
    expect(screen.getByText('First Bill')).toBeInTheDocument();
    expect(screen.queryByText('Second Bill')).not.toBeInTheDocument();

    // unwatch
    fireEvent.click(screen.getByTitle('Unwatch'));
    expect(screen.getByText((_c, el) => el?.textContent === '0 watching')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { bills: BILLS } } });
    render(<BillTracker />);
    await screen.findByText('First Bill');
    fireEvent.change(screen.getByDisplayValue('All status'), { target: { value: 'signed' } });
    expect(screen.getByText('Second Bill')).toBeInTheDocument();
    expect(screen.queryByText('First Bill')).not.toBeInTheDocument();
  });

  it('loads existing watch list from localStorage', async () => {
    window.localStorage.setItem('concord:gov:bill-watch:v1', JSON.stringify(['b2']));
    lensRun.mockResolvedValue({ data: { ok: true, result: { bills: BILLS } } });
    render(<BillTracker />);
    await screen.findByText('First Bill');
    expect(screen.getByText((_c, el) => el?.textContent === '1 watching')).toBeInTheDocument();
  });

  it('tolerates corrupt localStorage', async () => {
    window.localStorage.setItem('concord:gov:bill-watch:v1', '{not json');
    lensRun.mockResolvedValue({ data: { ok: true, result: { bills: BILLS } } });
    render(<BillTracker />);
    await screen.findByText('First Bill');
    expect(screen.getByText((_c, el) => el?.textContent === '0 watching')).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<BillTracker />);
    expect(await screen.findByText('No bills match.')).toBeInTheDocument();
  });
});
