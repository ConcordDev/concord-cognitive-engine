/**
 * code-quality lens — four-UX-state contract for the AnalyzePanel (the lens's
 * primary surface, driven by the real code-quality.analyze macro that runs the
 * static analyzer over submitted source).
 *
 * Pins genuine empty (no scan yet) / loading (role=status + aria-busy while the
 * analyze call is in flight) / error (role=alert + a working Retry that
 * re-issues the analyze call) / populated (real scan grade + metrics) states
 * against the exact { scanId, grade, totals, metrics, files } shape
 * server/domains/code-quality.js returns — no fabricated data. lensRun
 * (POST /api/lens/run → the domain) is the only data path the panel uses, so it
 * is the single mock surface.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { AnalyzePanel } from '@/components/code-quality/AnalyzePanel';

const SCAN = {
  scanId: 'scan_abc',
  createdAt: '2026-06-01T00:00:00.000Z',
  fileCount: 1,
  grade: 'C',
  totals: { total: 6, critical: 0, high: 2, medium: 2, low: 2, info: 0 },
  metrics: {
    totalLines: 20,
    codeLines: 16,
    commentLines: 0,
    blankLines: 4,
    functionCount: 1,
    avgComplexity: 8,
    maxComplexity: 8,
    duplicationPct: 0,
    duplicateBlocks: 0,
    commentDensity: 0,
    maintainability: 58,
    debtMinutes: 120,
    debtHours: 2,
  },
  files: [],
};

beforeEach(() => {
  lensRunMock.mockReset();
});

function noop() { /* user-action driven; nothing on mount */ }

describe('code-quality AnalyzePanel — four UX states', () => {
  it('EMPTY: shows an honest empty state before any scan', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<AnalyzePanel scan={null} onScan={noop} />);
    });
    const empty = view!.getByTestId('cq-analyze-empty');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/no scan yet/i);
  });

  it('LOADING: shows a role=status spinner while the analyze call is in flight', async () => {
    lensRunMock.mockImplementation(() => new Promise(() => {})); // never resolves
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<AnalyzePanel scan={null} onScan={noop} />);
    });
    // type source + click Analyze
    fireEvent.change(view!.getByPlaceholderText(/Paste a source file/i), {
      target: { value: 'const a = 1;\n' },
    });
    await act(async () => {
      fireEvent.click(view!.getByText('Analyze source'));
    });
    const loading = view!.getByTestId('cq-analyze-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the analyze call', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, result: null, error: 'analyze failed' } });
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<AnalyzePanel scan={null} onScan={noop} />);
    });
    fireEvent.change(view!.getByPlaceholderText(/Paste a source file/i), {
      target: { value: 'const a = 1;\n' },
    });
    await act(async () => {
      fireEvent.click(view!.getByText('Analyze source'));
    });
    await waitFor(() => expect(view!.getByTestId('cq-analyze-error')).toBeInTheDocument());
    const err = view!.getByTestId('cq-analyze-error');
    expect(err).toHaveAttribute('role', 'alert');
    expect(err.textContent).toMatch(/analyze failed/);

    const before = lensRunMock.mock.calls.length;
    await act(async () => { fireEvent.click(view!.getByText('Retry')); });
    expect(lensRunMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('POPULATED: renders the real scan grade + metrics returned by the macro', async () => {
    let captured: unknown = null;
    lensRunMock.mockResolvedValue({ data: { ok: true, result: SCAN, error: null } });
    let view: ReturnType<typeof render>;
    await act(async () => {
      view = render(<AnalyzePanel scan={null} onScan={(s) => { captured = s; }} />);
    });
    fireEvent.change(view!.getByPlaceholderText(/Paste a source file/i), {
      target: { value: 'const a = 1;\n' },
    });
    await act(async () => {
      fireEvent.click(view!.getByText('Analyze source'));
    });
    // panel lifts the scan up via onScan — re-render with it
    await waitFor(() => expect(captured).not.toBeNull());
    await act(async () => {
      view!.rerender(<AnalyzePanel scan={SCAN} onScan={noop} />);
    });
    const result = view!.getByTestId('cq-analyze-result');
    expect(result).toBeInTheDocument();
    expect(result.textContent).toMatch(/C/); // grade
    expect(result.textContent).toMatch(/58/); // maintainability
    expect(result.textContent).toMatch(/2h/); // debt hours
  });
});
