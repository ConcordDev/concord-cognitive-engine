import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ListingsPanel } from '@/components/marketplace/ListingsPanel';

const LISTINGS = [
  {
    id: 'l1', number: 'L-1', title: 'Brass Ring', slug: 'brass-ring', kind: 'physical_good',
    priceUsd: 12.5, currency: 'USD', description: 'A nice ring.', tags: ['boho'],
    images: ['http://img/1.png'], stockQty: 3, shippingCostUsd: 2,
    status: 'published', createdAt: '2026-05-01', publishedAt: '2026-05-02',
  },
  {
    id: 'l2', number: 'L-2', title: 'Sticker Pack', slug: 'sticker-pack', kind: 'digital_download',
    priceUsd: 4, currency: 'USD', description: '', tags: [],
    images: [], stockQty: null, shippingCostUsd: 0,
    status: 'draft', createdAt: '2026-05-03', publishedAt: null,
  },
];

describe('ListingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: [] } } });
  });

  it('shows empty state when no listings', async () => {
    render(<ListingsPanel />);
    expect(await screen.findByText('No listings yet.')).toBeInTheDocument();
  });

  it('renders listings — published + draft badges and stock variants', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: LISTINGS } } });
    render(<ListingsPanel />);
    expect(await screen.findByText('Brass Ring')).toBeInTheDocument();
    expect(screen.getByText('Sticker Pack')).toBeInTheDocument();
    expect(screen.getByText('published')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText(/∞ stock/)).toBeInTheDocument();
    expect(screen.getByText(/3 in stock/)).toBeInTheDocument();
  });

  it('changes the status filter and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: LISTINGS } } });
    render(<ListingsPanel />);
    await screen.findByText('Brass Ring');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'draft' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listings-list', input: { status: 'draft' } }),
      ),
    );
  });

  it('toggles the create form and creates a listing', async () => {
    const calls: unknown[][] = [];
    lensRun.mockImplementation((...a: unknown[]) => {
      calls.push(a);
      return Promise.resolve({ data: { ok: true, result: { listings: [] } } });
    });
    render(<ListingsPanel />);
    await screen.findByText('No listings yet.');
    fireEvent.click(screen.getByText('New listing'));
    fireEvent.change(screen.getByPlaceholderText('Title *'), { target: { value: 'My Item' } });
    fireEvent.change(screen.getByPlaceholderText('Price USD *'), { target: { value: '9.99' } });
    fireEvent.change(screen.getByPlaceholderText(/Tags/), { target: { value: 'a, b' } });
    fireEvent.click(screen.getByText('Save as draft'));
    await waitFor(() => expect(calls.some((c) => (c[0] as { action?: string }).action === 'listings-create')).toBe(true));
  });

  it('does not create a listing without title or price', async () => {
    render(<ListingsPanel />);
    await screen.findByText('No listings yet.');
    fireEvent.click(screen.getByText('New listing'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Save as draft'));
    expect(lensRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'listings-create' }),
    );
  });

  it('alerts when create returns ok:false', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'listings-create')
        return Promise.resolve({ data: { ok: false, error: 'bad' } });
      return Promise.resolve({ data: { ok: true, result: { listings: [] } } });
    });
    render(<ListingsPanel />);
    await screen.findByText('No listings yet.');
    fireEvent.click(screen.getByText('New listing'));
    fireEvent.change(screen.getByPlaceholderText('Title *'), { target: { value: 'T' } });
    fireEvent.change(screen.getByPlaceholderText('Price USD *'), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Save as draft'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('bad'));
    alertSpy.mockRestore();
  });

  it('publishes a draft listing', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'listings-list')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ListingsPanel />);
    await screen.findByText('Sticker Pack');
    fireEvent.click(screen.getByText('Publish'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listings-publish', input: { id: 'l2' } }),
      ),
    );
  });

  it('unpublishes a published listing', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'listings-list')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ListingsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getByTitle('Unpublish'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listings-unpublish', input: { id: 'l1' } }),
      ),
    );
  });

  it('deletes a listing after confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'listings-list')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ListingsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'listings-delete' }),
      ),
    );
    confirmSpy.mockRestore();
  });

  it('does not delete when confirm cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'listings-list')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ListingsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getAllByTitle('Delete')[0]);
    expect(lensRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'listings-delete' }),
    );
    confirmSpy.mockRestore();
  });

  it('expands AI tools and runs ai-optimize-listing', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'listings-list')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
      if (spec.action === 'ai-optimize-listing')
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              source: 'llm',
              suggestedTitle: 'Better Brass Ring',
              suggestedTags: ['ring', 'brass'],
              suggestedDescription: 'A great ring.',
              issues: ['Title too short'],
              recommendations: ['Add more photos'],
              keyImprovements: ['Tighten copy'],
            },
          },
        });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ListingsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getAllByTitle('AI tools')[0]);
    fireEvent.click(screen.getByText('AI optimize listing'));
    expect(await screen.findByText('Better Brass Ring')).toBeInTheDocument();
    expect(screen.getByText('Title too short')).toBeInTheDocument();
    expect(screen.getByText('Add more photos')).toBeInTheDocument();
    expect(screen.getByText('Tighten copy')).toBeInTheDocument();
  });

  it('runs ai-price-suggest with peer stats', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'listings-list')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
      if (spec.action === 'ai-price-suggest')
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              currentPriceUsd: 12.5,
              comparableCount: 8,
              peerStats: { min: 5, max: 20, median: 11, avg: 12 },
              suggestion: { aggressive: 9, competitive: 12, premium: 16 },
              positioning: 'at market',
            },
          },
        });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ListingsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getAllByTitle('AI tools')[0]);
    fireEvent.click(screen.getByText('AI price suggest'));
    expect(await screen.findByText('$12')).toBeInTheDocument();
    expect(screen.getByText(/at market/)).toBeInTheDocument();
  });

  it('shows price-suggest message-only result', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'listings-list')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
      if (spec.action === 'ai-price-suggest')
        return Promise.resolve({ data: { ok: true, result: { message: 'Not enough peers' } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ListingsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getAllByTitle('AI tools')[0]);
    fireEvent.click(screen.getByText('AI price suggest'));
    expect(await screen.findByText('Not enough peers')).toBeInTheDocument();
  });

  it('collapses AI tools when toggled again', async () => {
    lensRun.mockImplementation((spec: { action: string }) => {
      if (spec.action === 'listings-list')
        return Promise.resolve({ data: { ok: true, result: { listings: LISTINGS } } });
      return Promise.resolve({ data: { ok: true } });
    });
    render(<ListingsPanel />);
    await screen.findByText('Brass Ring');
    fireEvent.click(screen.getAllByTitle('AI tools')[0]);
    expect(screen.getByText('AI optimize listing')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle('Hide AI tools')[0]);
    expect(screen.queryByText('AI optimize listing')).not.toBeInTheDocument();
  });

  it('tolerates a list fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ListingsPanel />);
    expect(await screen.findByText('No listings yet.')).toBeInTheDocument();
  });
});
