import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import DepthChart from '@/components/markets/DepthChart';

describe('DepthChart — mirrored order-book depth (markets.order-book)', () => {
  it('renders the honest empty state when both sides have zero resting orders', () => {
    render(<DepthChart yesBids={[]} noBids={[]} midProbability={0.5} />);
    expect(screen.getByText(/No resting orders in the book/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders a loading placeholder instead of a stale chart', () => {
    render(<DepthChart yesBids={[{ price: 0.4, size: 10 }]} noBids={[]} midProbability={0.5} loading />);
    expect(screen.queryByText(/No resting orders/i)).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders the real SVG depth chart with correct cumulative totals from resting orders', () => {
    const yesBids = [{ price: 0.45, size: 30 }, { price: 0.40, size: 20 }];
    const noBids = [{ price: 0.55, size: 15 }, { price: 0.60, size: 25 }]; // transforms to 1-price = 0.45, 0.40
    render(<DepthChart yesBids={yesBids} noBids={noBids} midProbability={0.5} />);

    const svg = screen.getByRole('img', { name: /Order book depth/i });
    expect(svg).toBeInTheDocument();
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);

    // Totals are a real reduce over the input levels, not fabricated —
    // 30+20=50 YES, 15+25=40 NO (transform doesn't change size, only price).
    expect(screen.getByText(/YES 50/)).toBeInTheDocument();
    expect(screen.getByText(/NO 40/)).toBeInTheDocument();
    expect(screen.getByText(/mid 0.50/)).toBeInTheDocument();
  });

  it('renders only the bid side when noBids is empty (no fabricated ask wall)', () => {
    render(<DepthChart yesBids={[{ price: 0.3, size: 5 }]} noBids={[]} midProbability={0.5} />);
    expect(screen.getByText(/YES 5/)).toBeInTheDocument();
    expect(screen.getByText(/NO 0/)).toBeInTheDocument();
  });
});
