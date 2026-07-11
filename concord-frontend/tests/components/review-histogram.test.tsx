/**
 * Tier-2 frontend test for ReviewHistogram — the Wave 4 gap-closure item
 * for the mentorship lens (docs/lens-specs/mentorship-capability-map.md,
 * "Ratings & Reviews" checklist item #7): the `mentorship.review-list`
 * macro's `histogram` field (`[{star, count}, ...]` for star 1-5, plus
 * `avgRating`/`count`) had no dedicated UI. This pins the component against
 * the REAL macro return shape (server/domains/mentorship.js#review-list),
 * not a guessed one:
 *
 *   { ok: true, result: { reviews, count, avgRating, histogram } }
 *   histogram === [1,2,3,4,5].map(star => ({ star, count }))
 *
 * Covers the edge cases the honest-by-construction invariant cares about:
 * zero reviews (no fabricated percentages), all-5-star (no divide-by-zero
 * on the bar-width denominator), and a mixed distribution (percentages
 * actually match the real counts).
 *
 * Row assertions use `row.textContent` (not `within(row).getByText`) because
 * the count/percentage is split across a parent <span> and a nested <span>
 * for styling — a single regex against the row's flattened text is the
 * robust way to assert "6 (60%)" without depending on DOM node boundaries.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewHistogram, type ReviewHistogramBucket } from '@/components/mentorship/ReviewHistogram';

function rowText(star: number): string {
  return (screen.getByTestId(`histogram-row-${star}`).textContent || '').replace(/\s+/g, ' ');
}

describe('ReviewHistogram', () => {
  it('renders the honest zero-review state — no fabricated percentages', () => {
    const histogram: ReviewHistogramBucket[] = [1, 2, 3, 4, 5].map((star) => ({ star, count: 0 }));
    render(<ReviewHistogram histogram={histogram} avgRating={0} count={0} />);
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    // All five rows render at 0 count / 0% — never a divide-by-zero NaN%.
    for (const star of [1, 2, 3, 4, 5]) {
      expect(rowText(star)).toMatch(/0 \(0%\)/);
    }
  });

  it('renders all-5-star distribution without a divide-by-zero on the bar width', () => {
    const histogram: ReviewHistogramBucket[] = [
      { star: 1, count: 0 }, { star: 2, count: 0 }, { star: 3, count: 0 },
      { star: 4, count: 0 }, { star: 5, count: 8 },
    ];
    render(<ReviewHistogram histogram={histogram} avgRating={5.0} count={8} />);
    expect(screen.getByText('5.0')).toBeInTheDocument();
    expect(screen.getByText(/8 rating/)).toBeInTheDocument();
    expect(rowText(5)).toMatch(/8 \(100%\)/);
    expect(rowText(1)).toMatch(/0 \(0%\)/);

    // Bar fill is measured against the max bucket (8), so the sole
    // populated bucket renders a full-width bar — not scaled against a
    // stale/zero denominator.
    const bar5 = screen.getByTestId('histogram-row-5').querySelector('div[style]') as HTMLDivElement;
    expect(bar5.style.width).toBe('100%');
  });

  it('renders a mixed distribution with real per-bucket percentages, top-down 5★→1★', () => {
    // 10 total reviews: 5★x5, 4★x2, 3★x1, 2★x1, 1★x1 — matches the exact
    // shape server/domains/mentorship.js#review-list returns.
    const histogram: ReviewHistogramBucket[] = [
      { star: 1, count: 1 }, { star: 2, count: 1 }, { star: 3, count: 1 },
      { star: 4, count: 2 }, { star: 5, count: 5 },
    ];
    render(<ReviewHistogram histogram={histogram} avgRating={3.8} count={10} />);
    expect(screen.getByText('3.8')).toBeInTheDocument();
    expect(screen.getByText(/10 ratings/)).toBeInTheDocument();

    // Rows must appear in 5★ → 1★ order regardless of input array order.
    const container = screen.getByTestId('review-histogram');
    const rowIds = Array.from(container.querySelectorAll('[data-testid^="histogram-row-"]')).map((el) => el.getAttribute('data-testid'));
    expect(rowIds).toEqual(['histogram-row-5', 'histogram-row-4', 'histogram-row-3', 'histogram-row-2', 'histogram-row-1']);

    expect(rowText(5)).toMatch(/5 \(50%\)/);
    expect(rowText(4)).toMatch(/2 \(20%\)/);
    expect(rowText(3)).toMatch(/1 \(10%\)/);
    expect(rowText(2)).toMatch(/1 \(10%\)/);
    expect(rowText(1)).toMatch(/1 \(10%\)/);
  });

  it('handles an out-of-order / sparse histogram array by keying on star, not index', () => {
    // Backend always returns all 5 buckets in order, but the component
    // should not silently break if that ever changes — it keys by `star`.
    const histogram: ReviewHistogramBucket[] = [
      { star: 3, count: 4 }, { star: 5, count: 6 },
    ];
    render(<ReviewHistogram histogram={histogram} avgRating={4.2} count={10} />);
    expect(rowText(5)).toMatch(/6 \(60%\)/);
    expect(rowText(3)).toMatch(/4 \(40%\)/);
    expect(rowText(4)).toMatch(/0 \(0%\)/);
    expect(rowText(2)).toMatch(/0 \(0%\)/);
    expect(rowText(1)).toMatch(/0 \(0%\)/);
  });
});
