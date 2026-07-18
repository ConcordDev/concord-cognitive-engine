/**
 * OrganizationESGPanel — the honest-scope UI for the real `eco.sustainabilityScore`
 * macro (server/domains/eco.js). The macro is a genuine multi-criteria
 * corporate ESG assessment (board diversity, transparency, labor practices,
 * emissions reduction, …), but it scores an ORGANIZATION, not a person —
 * WAVE4 (eco)'s job was to give it an honest, clearly-labeled home distinct
 * from the lens's personal-ecology tools (carbon footprint, life list),
 * never a home that could read as a personal score.
 *
 * This pins:
 *  - the panel renders "Organization ESG" / "not personal" framing up front,
 *    honestly, before any computation happens (no personal-metric framing);
 *  - honest needs-input empty state (no fabricated default score);
 *  - a real compute round-trip through `lensRun('eco','sustainabilityScore', …)`
 *    renders the backend's own `scope`/`scopeLabel` fields verbatim, so the
 *    honesty guarantee is enforced by the backend contract, not just this
 *    component's copy;
 *  - a validation guard when no indicator has been entered (never silently
 *    submits an empty/zeroed assessment).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER the mock is registered.
import { OrganizationESGPanel } from '@/components/eco/OrganizationESGPanel';

function runOk(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function runReject(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

const REAL_ESG_RESULT = {
  scope: 'organization',
  scopeLabel: 'Organization ESG (not personal)',
  overallScore: 63,
  maturityLevel: 'Developing',
  overallRating: 'good',
  pillars: {
    environmental: { score: 80, weight: 0.4, rating: 'excellent', dataCompleteness: 100, subIndicators: [], gaps: [] },
    social: { score: 60, weight: 0.35, rating: 'good', dataCompleteness: 100, subIndicators: [], gaps: [] },
    governance: { score: 40, weight: 0.25, rating: 'fair', dataCompleteness: 100, subIndicators: [], gaps: [] },
  },
  strengths: [{ indicator: 'emissions', label: 'GHG Emissions Reduction', score: 80, weight: 0.25, rating: 'excellent' }],
  weaknesses: [{ indicator: 'boardDiversity', label: 'Board Diversity', score: 40, weight: 0.2, rating: 'fair' }],
  recommendations: ['Improve Board Diversity (current score: 40/100)'],
  dataCompleteness: 100,
};

beforeEach(() => { lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

describe('OrganizationESGPanel — honest Organization-ESG framing (not personal)', () => {
  it('renders the "Organization ESG" / "NOT PERSONAL" framing before any computation', () => {
    const { getAllByText, getByText } = render(<OrganizationESGPanel />);
    expect(getAllByText(/Organization ESG/i).length).toBeGreaterThan(0);
    expect(getAllByText(/NOT PERSONAL/i).length).toBeGreaterThan(0);
    // Explicitly points the user at the personal tools elsewhere in the lens
    // rather than silently letting this read as one of them.
    expect(getByText(/not an individual/i)).toBeInTheDocument();
  });

  it('EMPTY: honest needs-input state, no fabricated default score, and blocks an empty submit', () => {
    const { getByText, queryByText } = render(<OrganizationESGPanel />);
    expect(getByText(/No indicators entered yet/i)).toBeInTheDocument();
    expect(queryByText(/Overall ESG score/i)).toBeNull();

    fireEvent.click(getByText(/Compute Organization ESG score/i));
    expect(lensRunMock).not.toHaveBeenCalled();
    expect(getByText(/Enter at least one indicator score/i)).toBeInTheDocument();
  });

  it('POPULATED: computing renders the backend-stamped scope/scopeLabel + real pillar scores, not fabricated ones', async () => {
    lensRunMock.mockImplementation(() => runOk(REAL_ESG_RESULT));
    const { getByLabelText, getByText, getAllByText } = render(<OrganizationESGPanel />);

    fireEvent.change(getByLabelText('GHG Emissions Reduction'), { target: { value: '80' } });
    fireEvent.click(getByText(/Compute Organization ESG score/i));

    await waitFor(() => expect(getByText('63')).toBeInTheDocument());
    await act(async () => {});

    expect(lensRunMock).toHaveBeenCalledWith('eco', 'sustainabilityScore', {
      indicators: { environmental: { emissions: 80 }, social: {}, governance: {} },
    });
    // Renders the backend's own honesty fields verbatim.
    expect(getAllByText(/Organization ESG \(not personal\)/i).length).toBeGreaterThan(0);
    expect(getByText('Developing')).toBeInTheDocument();
    // "Board Diversity" now appears both as an input label AND in the
    // rendered weaknesses list — at least 2 occurrences confirms the real
    // computed weakness rendered, not just the static form.
    expect(getAllByText(/Board Diversity/i).length).toBeGreaterThanOrEqual(2);
  });

  it('ERROR: a handler rejection surfaces as an alert, never a silently-fabricated score', async () => {
    lensRunMock.mockImplementation(() => runReject('ESG assessment failed'));
    const { getByLabelText, getByText, getByRole } = render(<OrganizationESGPanel />);

    fireEvent.change(getByLabelText('GHG Emissions Reduction'), { target: { value: '80' } });
    fireEvent.click(getByText(/Compute Organization ESG score/i));

    await waitFor(() => expect(getByRole('alert')).toBeInTheDocument());
    expect(getByText(/ESG assessment failed/i)).toBeInTheDocument();
  });
});
