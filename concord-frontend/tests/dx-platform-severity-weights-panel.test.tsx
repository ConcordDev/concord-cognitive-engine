/**
 * SeverityWeightsPanel — pins the two previously-unsurfaced dx.* macros this
 * wave wired in: `dx.get_weight` (single detector/rule quick lookup) and
 * `dx.weighted_findings` (apply a codebase's real severity weights to a
 * candidate finding list and render the reprioritized order).
 *
 * lensRun is the one mock surface — no fabricated data. Every rendered
 * number/label in these tests is exactly what the mocked macro response
 * says, matching the real shapes in server/domains/dx.js:
 *   dx.get_weight          -> { ok:true, weight: N }
 *   dx.weighted_findings   -> { ok:true, findings: [{ id, category, severity, _baseSeverity, _codebaseWeight }] }
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { SeverityWeightsPanel } from '@/components/dx-platform/SeverityWeightsPanel';

const CODEBASE = { id: 'cb_1', repo_root: '/repo/one', detector_version: 'v1', created_at: 1, last_seen_at: 2 };
const WEIGHT_ROW = {
  detector_id: 'no-secrets', rule_id: 'hardcoded-key', weight: 1.8,
  accept_count: 22, reject_count: 1, ignore_count: 0, updated_at: 3,
};

type MacroResponse = { data: { ok: boolean; result: unknown; error: string | null } };
type MacroOverride = (input: Record<string, unknown>) => MacroResponse;

function baseImpl(overrides: Record<string, MacroOverride> = {}) {
  return (domain: string, action: string, input: Record<string, unknown>) => {
    if (domain !== 'dx') return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    if (overrides[action]) return Promise.resolve(overrides[action](input));
    if (action === 'list_codebases') {
      return Promise.resolve({ data: { ok: true, result: { ok: true, codebases: [CODEBASE] }, error: null } });
    }
    if (action === 'list_weights') {
      return Promise.resolve({ data: { ok: true, result: { ok: true, weights: [WEIGHT_ROW] }, error: null } });
    }
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('SeverityWeightsPanel — dx.get_weight quick lookup', () => {
  it('renders the real weight returned by dx.get_weight for a typed (detector, rule) pair', async () => {
    lensRunMock.mockImplementation(baseImpl({
      get_weight: () => ({
        data: { ok: true, result: { ok: true, weight: 0.42 }, error: null },
      }),
    }));

    await act(async () => { render(<SeverityWeightsPanel />); });
    await waitFor(() => expect(screen.getByText('no-secrets')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Detector id'), { target: { value: 'custom-detector' } });
    fireEvent.change(screen.getByLabelText('Rule id'), { target: { value: 'custom-rule' } });
    fireEvent.click(screen.getByText('Look up'));

    await waitFor(() => expect(screen.getByTestId('dx-weight-lookup-result')).toBeInTheDocument());
    const result = screen.getByTestId('dx-weight-lookup-result');
    expect(result.textContent).toContain('0.42×');
    expect(result.textContent).toContain('custom-detector');
    expect(result.textContent).toContain('custom-rule');

    // The macro was called with exactly the codebase + typed pair — no
    // fabricated params.
    const call = lensRunMock.mock.calls.find((c) => c[1] === 'get_weight');
    expect(call?.[2]).toMatchObject({ codebaseId: 'cb_1', detectorId: 'custom-detector', ruleId: 'custom-rule' });
  });

  it('surfaces an honest error when the lookup macro rejects', async () => {
    lensRunMock.mockImplementation(baseImpl({
      get_weight: () => ({ data: { ok: false, result: null, error: 'lens error' } }),
    }));

    await act(async () => { render(<SeverityWeightsPanel />); });
    await waitFor(() => expect(screen.getByText('no-secrets')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Detector id'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Rule id'), { target: { value: 'y' } });
    fireEvent.click(screen.getByText('Look up'));

    await waitFor(() => expect(screen.queryByTestId('dx-weight-lookup-result')).not.toBeInTheDocument());
    expect(screen.getByText('lens error')).toBeInTheDocument();
  });
});

describe('SeverityWeightsPanel — dx.weighted_findings preview', () => {
  it('applies the real per-codebase weights and renders the adjusted severity + weight for each row', async () => {
    lensRunMock.mockImplementation(baseImpl({
      weighted_findings: (input) => ({
        data: {
          ok: true,
          result: {
            ok: true,
            findings: (input.findings as Array<{ id: string; category: string; severity: string }>).map((f) => ({
              id: f.id, category: f.category, severity: 'high', _baseSeverity: f.severity, _codebaseWeight: 1.8,
            })),
          },
          error: null,
        },
      }),
    }));

    await act(async () => { render(<SeverityWeightsPanel />); });
    await waitFor(() => expect(screen.getByText('no-secrets')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Detector / rule'), { target: { value: 'no-secrets::hardcoded-key' } });
    fireEvent.click(screen.getByText('Add'));
    fireEvent.click(screen.getByText('Apply weights'));

    await waitFor(() => expect(screen.getByTestId('dx-weighted-findings-result')).toBeInTheDocument());
    const out = screen.getByTestId('dx-weighted-findings-result');
    expect(out.textContent).toContain('1.80×');
    expect(out.textContent).toContain('medium'); // base severity default
    expect(out.textContent).toContain('high'); // adjusted severity from the mocked engine
    expect(out.textContent).toContain('no-secrets · hardcoded-key');

    const call = lensRunMock.mock.calls.find((c) => c[1] === 'weighted_findings');
    expect(call?.[2]).toMatchObject({
      codebaseId: 'cb_1',
      findings: [{ id: 'hardcoded-key', category: 'no-secrets', severity: 'medium' }],
    });
  });

  it('does not render the preview section when the codebase has no tracked weights yet', async () => {
    lensRunMock.mockImplementation(baseImpl({
      list_weights: () => ({ data: { ok: true, result: { ok: true, weights: [] }, error: null } }),
    }));

    await act(async () => { render(<SeverityWeightsPanel />); });
    await waitFor(() => expect(screen.getByText(/No fix decisions recorded yet/)).toBeInTheDocument());
    expect(screen.queryByText('Weighted findings preview')).not.toBeInTheDocument();
    // The quick-lookup tool is still available even with zero weight rows.
    expect(screen.getByText('Quick weight lookup')).toBeInTheDocument();
  });
});
