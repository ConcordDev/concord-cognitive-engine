// EcoESGWeights.test.tsx
//
// FIX-eco-004: the Organization ESG score said "weighted" but showed no
// weights — the audit's 20/40/60 environmental entry produced 38.46
// with no way to check it ((20×0.25 + 40×0.20 + 60×0.20) / 0.65). The
// panel now prints the overall derivation and each pillar's weight and
// per-indicator weights from the server's own result.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import { OrganizationESGPanel } from '@/components/eco/OrganizationESGPanel';

const sub = (indicator: string, label: string, score: number | null, weight: number) => ({
  indicator, label, score, weight, rating: score == null ? 'not reported' : 'fair',
});
const RESULT = {
  scope: 'organization',
  scopeLabel: 'Organization ESG (not personal)',
  overallScore: 38.46,
  maturityLevel: 'Emerging',
  overallRating: 'poor',
  dataCompleteness: 20,
  pillars: {
    environmental: {
      score: 38.46, weight: 0.4, rating: 'poor', dataCompleteness: 60,
      subIndicators: [
        sub('emissions', 'GHG Emissions Reduction', 20, 0.25),
        sub('energyEfficiency', 'Energy Efficiency', 40, 0.2),
        sub('wasteReduction', 'Waste Reduction', 60, 0.2),
        sub('waterUsage', 'Water Management', null, 0.2),
        sub('biodiversity', 'Biodiversity Impact', null, 0.15),
      ],
      gaps: [],
    },
    social: { score: null, weight: 0.35, rating: 'insufficient data', dataCompleteness: 0, subIndicators: [], gaps: [] },
    governance: { score: null, weight: 0.25, rating: 'insufficient data', dataCompleteness: 0, subIndicators: [], gaps: [] },
  },
  strengths: [], weaknesses: [], recommendations: [],
};

describe('Organization ESG shows its weights (FIX-eco-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRunMock.mockResolvedValue({ data: { ok: true, result: RESULT } });
  });
  afterEach(() => cleanup());

  it('the audit case: 38.46 is printed WITH its derivation and weights', async () => {
    render(React.createElement(OrganizationESGPanel));
    fireEvent.change(document.getElementById('esg-emissions')!, { target: { value: '20' } });
    fireEvent.click(screen.getByText(/Compute Organization ESG score/));
    // Overall derivation: only the environmental pillar reported.
    const derivation = await screen.findByText(/weighted mean of the reporting pillars/);
    expect(derivation.textContent).toContain('Environmental 38.46 × 0.4');
    expect(derivation.textContent).toContain('= 38.46');
    // Pillar card carries its weight; sub-indicator weights are visible.
    expect(screen.getByText(/weight 0\.4/)).toBeTruthy();
    expect(screen.getByText('20 × 0.25')).toBeTruthy();
    expect(screen.getByText('60 × 0.2')).toBeTruthy();
  });
});
