import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ReviewsPanel } from '@/components/marketplace/ReviewsPanel';

const REVIEWS = [
  {
    id: 'r1', number: 'RV-1', sellerId: 's1', targetType: 'shop', targetId: '',
    reviewerName: 'Alice', rating: 5, title: 'Great shop', body: 'Loved it.',
    orderId: 'o1', sellerReply: '', createdAt: '2026-05-01T00:00:00Z',
  },
  {
    id: 'r2', number: 'RV-2', sellerId: 's1', targetType: 'listing', targetId: 'l1',
    reviewerName: 'Bob', rating: 3, title: '', body: 'It was ok.',
    orderId: 'o2', sellerReply: 'Thanks for the feedback', repliedAt: '2026-05-02', createdAt: '2026-05-02T00:00:00Z',
  },
];

const LIST_RESULT = {
  reviews: REVIEWS,
  avgRating: 4,
  distribution: { '5': 1, '4': 0, '3': 1, '2': 0, '1': 0 },
};

describe('ReviewsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { reviews: [], listings: [] } } });
  });

  it('shows empty state when no reviews', async () => {
    render(<ReviewsPanel />);
    expect(await screen.findByText('No reviews yet.')).toBeInTheDocument();
  });

  it('renders reviews, rating summary and seller reply', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'reviews-list')
        return Promise.resolve({ data: { ok: true, result: LIST_RESULT } });
      return Promise.resolve({ data: { ok: true, result: { listings: [] } } });
    });
    render(<ReviewsPanel />);
    expect(await screen.findByText('Great shop')).toBeInTheDocument();
    expect(screen.getByText('It was ok.')).toBeInTheDocument();
    expect(screen.getByText('4.0')).toBeInTheDocument();
    expect(screen.getByText('Thanks for the feedback')).toBeInTheDocument();
  });

  it('filters by target type and re-fetches with targetType', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'reviews-list')
        return Promise.resolve({ data: { ok: true, result: LIST_RESULT } });
      return Promise.resolve({ data: { ok: true, result: { listings: [] } } });
    });
    render(<ReviewsPanel />);
    await screen.findByText('Great shop');
    lensRun.mockClear();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'listing' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'reviews-list', expect.objectContaining({ targetType: 'listing' }),
      ),
    );
  });

  it('passes sellerId when provided as a prop', async () => {
    render(<ReviewsPanel sellerId="seller-9" />);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'reviews-list', expect.objectContaining({ sellerId: 'seller-9' }),
      ),
    );
  });

  it('shows the listing dropdown when composer targetType=listing', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'listings-list')
        return Promise.resolve({
          data: { ok: true, result: { listings: [{ id: 'l1', title: 'Brass Ring' }] } },
        });
      return Promise.resolve({ data: { ok: true, result: { reviews: [] } } });
    });
    render(<ReviewsPanel />);
    await screen.findByText('No reviews yet.');
    const composerSelect = screen.getByDisplayValue('Shop review');
    fireEvent.change(composerSelect, { target: { value: 'listing' } });
    expect(await screen.findByText('Brass Ring')).toBeInTheDocument();
  });

  it('does not post a review with empty body', async () => {
    render(<ReviewsPanel />);
    await screen.findByText('No reviews yet.');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Post review'));
    expect(lensRun).not.toHaveBeenCalledWith('marketplace', 'reviews-create', expect.anything());
  });

  it('posts a review when body is filled', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'reviews-create') return Promise.resolve({ data: { ok: true, result: {} } });
      return Promise.resolve({ data: { ok: true, result: { reviews: [], listings: [] } } });
    });
    render(<ReviewsPanel />);
    await screen.findByText('No reviews yet.');
    fireEvent.change(screen.getByPlaceholderText('Write your review…'), {
      target: { value: 'Excellent!' },
    });
    fireEvent.click(screen.getByText('Post review'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'reviews-create', expect.objectContaining({ body: 'Excellent!' }),
      ),
    );
  });

  it('shows an error when review create returns ok:false', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'reviews-create')
        return Promise.resolve({ data: { ok: false, error: 'no order' } });
      return Promise.resolve({ data: { ok: true, result: { reviews: [], listings: [] } } });
    });
    render(<ReviewsPanel />);
    await screen.findByText('No reviews yet.');
    fireEvent.change(screen.getByPlaceholderText('Write your review…'), {
      target: { value: 'Body text' },
    });
    fireEvent.click(screen.getByText('Post review'));
    expect(await screen.findByText('no order')).toBeInTheDocument();
  });

  it('changes star rating via the composer stars', async () => {
    render(<ReviewsPanel />);
    await screen.findByText('No reviews yet.');
    // 3-star pick in the composer (Stars component buttons are aria-labelled)
    fireEvent.click(screen.getAllByLabelText('3 stars')[0]);
    fireEvent.change(screen.getByPlaceholderText('Write your review…'), {
      target: { value: 'rated' },
    });
    expect(screen.getByText('Post review')).toBeInTheDocument();
  });

  it('replies to a review without a seller reply', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'reviews-list')
        return Promise.resolve({ data: { ok: true, result: LIST_RESULT } });
      return Promise.resolve({ data: { ok: true, result: { listings: [] } } });
    });
    render(<ReviewsPanel />);
    await screen.findByText('Great shop');
    fireEvent.change(screen.getByPlaceholderText('Reply as seller…'), {
      target: { value: 'Thank you Alice' },
    });
    fireEvent.click(screen.getByLabelText('Send reply'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        'marketplace', 'reviews-reply', { id: 'r1', reply: 'Thank you Alice' },
      ),
    );
  });

  it('does not reply when the draft is empty', async () => {
    lensRun.mockImplementation((d: string, a: string) => {
      if (a === 'reviews-list')
        return Promise.resolve({ data: { ok: true, result: LIST_RESULT } });
      return Promise.resolve({ data: { ok: true, result: { listings: [] } } });
    });
    render(<ReviewsPanel />);
    await screen.findByText('Great shop');
    lensRun.mockClear();
    fireEvent.click(screen.getByLabelText('Send reply'));
    expect(lensRun).not.toHaveBeenCalledWith('marketplace', 'reviews-reply', expect.anything());
  });

  it('tolerates a list rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<ReviewsPanel />);
    expect(await screen.findByText('No reviews yet.')).toBeInTheDocument();
  });
});
