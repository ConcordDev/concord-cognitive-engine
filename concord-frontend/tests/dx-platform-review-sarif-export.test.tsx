/**
 * dx-platform DxWorkbench — ReviewTab "Export SARIF" button.
 *
 * Wave-4 gap closure (docs/WAVE4_INVENTORY.md row 151): the review tab
 * already runs dx-platform.reviewDiff and holds real findings in state; this
 * pins that a new "Export SARIF" button reuses those SAME findings (no
 * re-fetch, no invented data) to call the real dx-platform.exportSarif macro
 * and triggers a genuine browser file download (Blob + anchor-click, via the
 * shared `downloadFile` helper in `@/lib/utils` — not a duplicated mechanism)
 * — with honest error surfacing when the macro call fails.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: () => null,
}));

import { DxWorkbench } from '@/components/dx-platform/DxWorkbench';

const FINDINGS = [
  {
    id: 'find_1', detectorId: 'secret_leak', detectorLabel: 'Secret / credential leak',
    severity: 5, path: 'src/auth.js', line: 12, snippet: "const key = 'sk-xxxx';",
  },
  {
    id: 'find_2', detectorId: 'console_debug', detectorLabel: 'Leftover debug statement',
    severity: 2, path: 'src/x.js', line: 3, snippet: "console.log('x');",
  },
];

const REVIEW_RESULT = {
  filesChanged: 1, linesAdded: 2, linesRemoved: 0,
  findings: FINDINGS, findingCount: 2, blockingCount: 1, verdict: 'changes_requested',
};

const SARIF_DOC = {
  $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
  version: '2.1.0',
  runs: [{ tool: { driver: { name: 'Concord DX Detectors', rules: [] } }, results: [] }],
};

// Every lensRun call resolves benignly except the ones a test overrides.
function baseImpl(overrides: Record<string, (input?: unknown) => unknown> = {}) {
  return (_domain: string, action: string, input?: unknown) => {
    if (action in overrides) return Promise.resolve(overrides[action](input));
    if (action === 'listCodebases') return Promise.resolve({ data: { ok: true, result: { codebases: [], count: 0 }, error: null } });
    return Promise.resolve({ data: { ok: true, result: {}, error: null } });
  };
}

async function renderOnReviewTab() {
  let view: ReturnType<typeof render>;
  await act(async () => { view = render(<DxWorkbench />); });
  await waitFor(() => expect(view!.getByRole('tablist', { name: /DX workbench/i })).toBeInTheDocument());
  await act(async () => { fireEvent.click(view!.getByText('PR Review')); });
  return view!;
}

async function runReview(view: ReturnType<typeof render>) {
  const textarea = view.getByPlaceholderText(/---.*a\/file\.js/);
  fireEvent.change(textarea, { target: { value: '--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n+const token = 1;' } });
  await act(async () => { fireEvent.click(view.getByText('Review diff')); });
  await waitFor(() => expect(view.getByText('Export SARIF')).toBeInTheDocument());
}

beforeEach(() => {
  lensRunMock.mockReset();
  vi.restoreAllMocks();
});

describe('DxWorkbench ReviewTab — Export SARIF button', () => {
  it('renders the Export SARIF button once a review has real findings', async () => {
    lensRunMock.mockImplementation(baseImpl({
      reviewDiff: () => ({ data: { ok: true, result: REVIEW_RESULT, error: null } }),
    }));
    const view = await renderOnReviewTab();
    await runReview(view);
    expect(view.getByText('Export SARIF')).toBeInTheDocument();
  });

  it('calls exportSarif with the SAME findings already in state (no re-fetch, no invented data)', async () => {
    lensRunMock.mockImplementation(baseImpl({
      reviewDiff: () => ({ data: { ok: true, result: REVIEW_RESULT, error: null } }),
      exportSarif: () => ({ data: { ok: true, result: { sarif: SARIF_DOC, findingCount: 2, ruleCount: 2 }, error: null } }),
    }));
    const view = await renderOnReviewTab();
    await runReview(view);

    vi.spyOn(window.URL, 'createObjectURL');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => { fireEvent.click(view.getByText('Export SARIF')); });
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());

    const call = lensRunMock.mock.calls.find((c) => c[1] === 'exportSarif');
    expect(call).toBeTruthy();
    const [domain, , input] = call as [string, string, { findings: unknown }];
    expect(domain).toBe('dx-platform');
    expect(input.findings).toEqual(FINDINGS);
  });

  it('triggers a real download via Blob + anchor-click on success', async () => {
    lensRunMock.mockImplementation(baseImpl({
      reviewDiff: () => ({ data: { ok: true, result: REVIEW_RESULT, error: null } }),
      exportSarif: () => ({ data: { ok: true, result: { sarif: SARIF_DOC, findingCount: 2, ruleCount: 2 }, error: null } }),
    }));
    const view = await renderOnReviewTab();
    await runReview(view);

    const createSpy = vi.spyOn(window.URL, 'createObjectURL');
    const revokeSpy = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => { fireEvent.click(view.getByText('Export SARIF')); });

    await waitFor(() => expect(view.getByText(/Downloaded concord-dx-findings\.sarif/)).toBeInTheDocument());
    // the real Blob/anchor-click download mechanism was exercised, not a
    // fabricated "downloaded!" toast with no actual browser download call.
    expect(createSpy).toHaveBeenCalledTimes(1);
    const blobArg = createSpy.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces an honest error and does NOT claim success when the macro call fails', async () => {
    lensRunMock.mockImplementation(baseImpl({
      reviewDiff: () => ({ data: { ok: true, result: REVIEW_RESULT, error: null } }),
      exportSarif: () => ({ data: { ok: false, result: null, error: 'handler_error' } }),
    }));
    const view = await renderOnReviewTab();
    await runReview(view);

    const createSpy = vi.spyOn(window.URL, 'createObjectURL');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await act(async () => { fireEvent.click(view.getByText('Export SARIF')); });

    await waitFor(() => expect(view.getByText('handler_error')).toBeInTheDocument());
    expect(view.queryByText(/Downloaded concord-dx-findings\.sarif/)).not.toBeInTheDocument();
    // no fake success — the download mechanism must never fire on a failed call
    expect(createSpy).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('surfaces a network error honestly (no silent no-op) when lensRun rejects', async () => {
    lensRunMock.mockImplementation((_d: string, action: string) => {
      if (action === 'reviewDiff') return Promise.resolve({ data: { ok: true, result: REVIEW_RESULT, error: null } });
      if (action === 'listCodebases') return Promise.resolve({ data: { ok: true, result: { codebases: [], count: 0 }, error: null } });
      if (action === 'exportSarif') return Promise.reject(new Error('network down'));
      return Promise.resolve({ data: { ok: true, result: {}, error: null } });
    });
    const view = await renderOnReviewTab();
    await runReview(view);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => { fireEvent.click(view.getByText('Export SARIF')); });

    await waitFor(() => expect(view.getByText(/Network error exporting SARIF/)).toBeInTheDocument());
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
