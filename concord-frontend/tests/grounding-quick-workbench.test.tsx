// Grounding full-build FE tests (B6, F-C row 22) — the Quick panel records
// its verdicts into the audit trail (S5/F6) and names the evidence score
// honestly (S5); Mint renders the whole DTU id in a persistent receipt
// (S1); the workbench's record receipt names the whole audit id (S1) and
// the Source-bias tab runs as shipped with its example domains in the
// field (S4).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
const apiPostMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { post: (...args: unknown[]) => apiPostMock(...args) },
  apiHelpers: { grounding: {} },
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (input: unknown) => input,
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: () => null,
}));

import { ClaimVerificationPanel } from '@/components/grounding/ClaimVerificationPanel';
import { FactGroundingWorkbench } from '@/components/grounding/FactGroundingWorkbench';

const FULL_ID = 'dtu_2dac1234567890abcdef1234567890';

function lensRunImpl(_domain: string, name: string, input?: Record<string, unknown>) {
  switch (name) {
    case 'factCheck':
      return Promise.resolve({ data: { ok: true, result: { verdict: 'likely true', confidence: 0.24, breakdown: { supporting: { count: 2 }, contradicting: { count: 0 }, neutral: { count: 1 } } } } });
    case 'recordCheck':
      return Promise.resolve({ data: { ok: true, result: { recorded: { id: 'check_abcdef1234567890' } } } });
    case 'auditTrail':
      return Promise.resolve({ data: { ok: true, result: { totalChecks: 0, checks: [], trail: [], stats: { verdictDistribution: {}, avgProbabilityTrue: null } } } });
    case 'rebuttalsFor':
      return Promise.resolve({ data: { ok: true, result: { rebuttals: [] } } });
    case 'aggregateEvidence':
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            claim: String(input?.claim || ''), verdict: 'likely true', probabilityTrue: 1, sourceCount: 1, knownSourceCount: 0,
            breakdown: { supporting: { count: 1, weight: 0.5 }, contradicting: { count: 0, weight: 0 }, neutral: { count: 0 } },
            leanSpread: 0, spectrumCoverage: 'narrow', notes: 'notes',
            citations: [{ index: 0, excerpt: 'x', sourceName: 'irena.org', sourceUrl: 'irena.org', stance: 'supports', sourceWeight: 0.5, bias: null }],
          },
        },
      });
    case 'confidenceRating':
      return Promise.resolve({ data: { ok: true, result: { probabilityTrue: 1, confidence: 0.5, confidenceBand: 'low confidence', interval: { lower: 0.4, upper: 0.6, margin: 0.1 }, factors: { decisiveness: 1, sourceAgreement: 1, evidenceVolume: 0.2, avgSourceWeight: 0.5 }, recommendation: 'Treat as provisional.' } } });
    case 'sourceBias':
      return Promise.resolve({ data: { ok: true, result: { sources: [], ratedCount: 3, unratedCount: 0, aggregateLeanScore: 0, aggregateLean: 'center', leanSpread: 5, balance: 'balanced (spans the spectrum)' } } });
    default:
      return Promise.resolve({ data: { ok: true, result: {} } });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  lensRunMock.mockImplementation(lensRunImpl);
  apiPostMock.mockImplementation((url: string) => {
    if (url === '/api/lens/run') return Promise.resolve({ data: { result: { dtu: { id: FULL_ID } } } });
    return Promise.resolve({ data: { ok: true } });
  });
});

describe('grounding full build — Quick panel (S5 record + labels, S1 IDs)', () => {
  it('a completed fact check is recorded into the audit trail and the score is named as evidence', async () => {
    render(<ClaimVerificationPanel />);
    fireEvent.change(screen.getByLabelText('Claim'), { target: { value: 'The fastest land animal is the cheetah.' } });
    fireEvent.click(screen.getByRole('button', { name: /Fact check/ }));
    await screen.findByText(/Verdict: likely true · evidence score 24%/);
    await waitFor(() => {
      const rec = lensRunMock.mock.calls.find((c) => c[1] === 'recordCheck');
      expect(rec).toBeTruthy();
      expect(rec?.[2]).toMatchObject({ claim: 'The fastest land animal is the cheetah.', verdict: 'likely true', confidence: 0.24 });
    });
  });

  it('Mint renders the whole DTU id in a persistent receipt', async () => {
    render(<ClaimVerificationPanel />);
    fireEvent.change(screen.getByLabelText('Claim'), { target: { value: 'A claim worth minting.' } });
    fireEvent.click(screen.getByRole('button', { name: /Mint/ }));
    await screen.findByText(`Verification DTU ${FULL_ID}`);
    expect(screen.getByText(FULL_ID)).toBeTruthy();
    expect(screen.queryByText(/dtu_2dac1…/)).toBeNull();
  });
});

describe('grounding full build — Workbench (S4 bias tab, S1 receipt, S5 labels)', () => {
  it('the Source-bias field opens with its example domains as its value, and runs them', async () => {
    render(<FactGroundingWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Source bias/ }));
    const field = screen.getByPlaceholderText(/reuters\.com/) as HTMLTextAreaElement;
    expect(field.value).toBe('reuters.com\nfoxnews.com\ntheguardian.com');
    fireEvent.click(screen.getByRole('button', { name: /Label bias & reliability/ }));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'sourceBias');
      expect(call?.[2]).toEqual({ sources: ['reuters.com', 'foxnews.com', 'theguardian.com'] });
    });
  });

  it('the aggregate headline names the evidence measure, and the record receipt is whole', async () => {
    render(<FactGroundingWorkbench />);
    fireEvent.change(screen.getByPlaceholderText(/Global renewable energy capacity doubled/), { target: { value: 'Global renewable energy capacity doubled between 2015 and 2023.' } });
    fireEvent.change(screen.getByPlaceholderText('Evidence excerpt or finding…'), { target: { value: 'Global renewable capacity reached 3,870 GW in 2023, double the 2015 level.' } });
    fireEvent.click(screen.getByRole('button', { name: /Aggregate evidence \+ rate confidence/ }));
    await screen.findByText(/100% evidence-weighted support/);
    expect(screen.queryByText(/% likely true/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Record to audit trail/ }));
    await screen.findByText('Recorded to audit trail (check_abcdef1234567890)');
  });
});
