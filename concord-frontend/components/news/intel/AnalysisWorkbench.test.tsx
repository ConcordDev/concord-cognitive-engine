/**
 * A biasDetection result with no lexicon hits is null + no_bias_terms.
 * BiasView must show a dash and the reason, not call toFixed on null.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BiasView } from './AnalysisWorkbench';
import type { BiasResult } from './intel-api';

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
  it('renders a dash and the gap reason when no bias terms scored', () => {
    render(<BiasView r={NO_TERMS} />);
    expect(screen.getByText('Wire')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('no loaded or hedge terms').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
    expect(screen.queryByText('0.000')).toBeInTheDocument();
  });

  it('still prints a finite overall score', () => {
    render(<BiasView r={{ ...NO_TERMS, overallBiasScore: 0.42, overallBiasReason: null, biasLevel: 'moderate', sourceBiasProfiles: [
      { source: 'Wire', articleCount: 1, avgBiasScore: 0.42, avgSentiment: 0, consistency: null },
    ] }} />);
    expect(screen.getByText('0.420')).toBeInTheDocument();
    expect(screen.getByText('0.42')).toBeInTheDocument();
    expect(screen.getByText('moderate')).toBeInTheDocument();
    expect(screen.queryByText('no loaded or hedge terms')).not.toBeInTheDocument();
  });
});
