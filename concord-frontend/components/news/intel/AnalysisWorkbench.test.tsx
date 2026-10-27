/**
 * A biasDetection result with no lexicon hits is null + no_bias_terms.
 * BiasView must say "Not available" with the reason, never call toFixed
 * on null, and never print null/undefined/NaN. A measured 0 still renders.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BiasView } from './AnalysisWorkbench';
import type { BiasResult } from './intel-api';

const REASON = 'Not available: no loaded or hedge words found in the text';

const NO_TERMS: BiasResult = {
  articlesAnalyzed: 2,
  overallBiasScore: null,
  overallBiasReason: 'no_bias_terms',
  biasLevel: null,
  sourceDiversity: {
    uniqueSources: 1,
    entropy: 0,
    normalizedDiversity: 0,
    assessment: 'concentrated',
  },
  sourceBiasProfiles: [
    { source: 'Wire', articleCount: 2, avgBiasScore: null, avgSentiment: null, consistency: null },
  ],
  articleAnalyses: [],
};

describe('BiasView', () => {
  it('says Not available with the reason when no bias terms scored', () => {
    const { container } = render(<BiasView r={NO_TERMS} />);
    expect(screen.getByText('Wire')).toBeInTheDocument();
    // Once for the overall score, once for the per-source row.
    expect(screen.getAllByText(REASON)).toHaveLength(2);
    // The em dash in the "Source diversity —" label is intentional; only check the bias values.
    expect(container.textContent ?? '').not.toMatch(/\bnull\b|undefined|NaN|no_bias_terms/);
  });

  it('prints a finite overall score and per-source average', () => {
    render(<BiasView r={{ ...NO_TERMS, overallBiasScore: 0.42, overallBiasReason: null, biasLevel: 'moderate', sourceBiasProfiles: [
      { source: 'Wire', articleCount: 1, avgBiasScore: 0.42, avgSentiment: 0, consistency: null },
    ] }} />);
    expect(screen.getByText('0.420')).toBeInTheDocument();
    expect(screen.getByText('0.42')).toBeInTheDocument();
    expect(screen.getByText('moderate')).toBeInTheDocument();
    expect(screen.queryByText(/Not available/)).not.toBeInTheDocument();
  });

  it('renders a measured real 0 as 0, not as Not available', () => {
    render(<BiasView r={{ ...NO_TERMS, overallBiasScore: 0, overallBiasReason: null, biasLevel: 'low', sourceBiasProfiles: [
      { source: 'Wire', articleCount: 1, avgBiasScore: 0, avgSentiment: 0, consistency: null },
    ] }} />);
    // The overall score and the per-source average both render the measured zero.
    expect(screen.getAllByText('0.000').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('0.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Not available/)).not.toBeInTheDocument();
  });
});
