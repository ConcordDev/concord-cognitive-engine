/**
 * bias-spectrum with articles but no lexicon hits returns null coverage
 * and columns.unscored. The panel must not print "null%" or hide those rows.
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

describe('NewsBiasSpectrum', () => {
  it('shows dashes, the reason, and the unscored article', async () => {
    render(<NewsBiasSpectrum />);
    expect(await screen.findByText('City council meets')).toBeInTheDocument();
    expect(screen.getByText('Unscored')).toBeInTheDocument();
    expect(screen.getByText('no_bias_terms')).toBeInTheDocument();
    expect(screen.getByText('unscored · no_bias_terms')).toBeInTheDocument();
    expect(screen.getByText('— Left')).toBeInTheDocument();
    expect(screen.getByText('— Center')).toBeInTheDocument();
    expect(screen.getByText('— Right')).toBeInTheDocument();
    expect(screen.queryByText(/null%/)).not.toBeInTheDocument();
  });
});
