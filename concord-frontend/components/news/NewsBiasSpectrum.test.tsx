/**
 * bias-spectrum with articles but no lexicon hits returns null coverage
 * and columns.unscored. The panel must say "Not available" with a plain
 * reason, and must never print null/undefined/NaN or the raw reason code.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('lucide-react', () => ({
  Loader2: () => null,
  Scale: () => null,
  AlertTriangle: () => null,
  Search: () => null,
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({
    data: {
      ok: true,
      result: {
        topic: 'all',
        columns: {
          left: [],
          center: [],
          right: [],
          unscored: [
            {
              id: 'a1',
              title: 'City council meets',
              source: 'Wire',
              summary: null,
              url: null,
              publishedAt: '2026-10-01T00:00:00Z',
              biasLean: null,
              biasScore: null,
              biasReason: 'no_bias_terms',
            },
          ],
        },
        count: 1,
        unscored: 1,
        coverage: { left: null, center: null, right: null, reason: 'no_bias_terms' },
        blindspot: null,
      },
    },
  })),
}));

import { NewsBiasSpectrum } from './NewsBiasSpectrum';

const REASON = 'Not available: no loaded or hedge words found in the text';

describe('NewsBiasSpectrum', () => {
  it('shows Not available with a plain reason for null coverage and unscored articles', async () => {
    render(<NewsBiasSpectrum />);
    expect(await screen.findByText('City council meets')).toBeInTheDocument();
    expect(screen.getByText('Not available Left')).toBeInTheDocument();
    expect(screen.getByText('Not available Center')).toBeInTheDocument();
    expect(screen.getByText('Not available Right')).toBeInTheDocument();
    // Once under the coverage bar, once on the article chip.
    expect(screen.getAllByText(REASON)).toHaveLength(2);
  });

  it('never prints null, undefined, NaN, dashes, or the raw reason code', async () => {
    const { container } = render(<NewsBiasSpectrum />);
    await screen.findByText('City council meets');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\bnull\b|undefined|NaN|null%|no_bias_terms/);
    expect(text).not.toContain('—');
  });
});
