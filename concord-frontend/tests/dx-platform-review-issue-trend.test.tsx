/**
 * dx-platform DxWorkbench — ReviewTab "Issue trend" (leak-period) section.
 *
 * Wave-4 gap closure (docs/WAVE4_INVENTORY.md `dx-platform` row: "No
 * historical issue-trend / 'new vs. existing' tracking (leak period)" —
 * SonarQube's leak period). `reviewDiff` now optionally persists a
 * commit-scoped snapshot when the caller supplies a commit SHA, and a new
 * `dx-platform.issueTrend` macro reads the last two snapshots for a
 * codebase to compute new-vs-existing-vs-resolved findings.
 *
 * This file pins the FRONTEND wiring only (the macro's own persistence +
 * set-diff math is covered by server/tests/dx-finding-history-persistence
 * .test.js): no commit SHA -> no trend fetch, no trend UI at all; a commit
 * SHA with only one snapshot on the server -> an honest "no comparison yet"
 * empty state (never a fabricated 0/0/0); two-plus snapshots -> the real
 * new/existing/resolved counts render verbatim from the macro's response.
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

const REVIEW_RESULT = {
  filesChanged: 1, linesAdded: 1, linesRemoved: 0,
  findings: [
    { id: 'f1', detectorId: 'console_debug', detectorLabel: 'Leftover debug statement', severity: 2, path: 'src/x.js', line: 1, snippet: "console.log('x');" },
  ],
  findingCount: 1, blockingCount: 0, verdict: 'advisory',
};

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

function fillDiff(view: ReturnType<typeof render>) {
  const textarea = view.getByPlaceholderText(/---.*a\/file\.js/);
  fireEvent.change(textarea, { target: { value: '--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n+console.log(1);' } });
}

beforeEach(() => {
  lensRunMock.mockReset();
  vi.restoreAllMocks();
});

describe('DxWorkbench ReviewTab — issue trend (leak period)', () => {
  it('never calls issueTrend and renders no trend section when no commit SHA is supplied', async () => {
    lensRunMock.mockImplementation(baseImpl({
      reviewDiff: () => ({ data: { ok: true, result: REVIEW_RESULT, error: null } }),
    }));
    const view = await renderOnReviewTab();
    fillDiff(view);
    await act(async () => { fireEvent.click(view.getByText('Review diff')); });
    await waitFor(() => expect(view.getByText(/1 findings/)).toBeInTheDocument());

    expect(view.queryByText(/Issue trend/)).not.toBeInTheDocument();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'issueTrend')).toBe(false);
  });

  it('passes the entered commit SHA to reviewDiff and shows an honest "no baseline" state when the server has only one snapshot', async () => {
    lensRunMock.mockImplementation(baseImpl({
      reviewDiff: () => ({ data: { ok: true, result: REVIEW_RESULT, error: null } }),
      issueTrend: () => ({
        data: {
          ok: true,
          result: {
            codebaseId: null, snapshotCount: 1, hasTrend: false,
            latest: { commitSha: 'abc1234567', findingCount: 1, createdAt: '2026-07-16T00:00:00.000Z' },
            previous: null, newCount: null, existingCount: null, resolvedCount: null,
            newFindingKeys: [], resolvedFindingKeys: [],
          },
          error: null,
        },
      }),
    }));
    const view = await renderOnReviewTab();
    fillDiff(view);
    fireEvent.change(view.getByLabelText('Commit SHA'), { target: { value: 'abc1234567' } });
    await act(async () => { fireEvent.click(view.getByText('Review diff')); });

    await waitFor(() => expect(view.getByTestId('dx-review-trend-empty')).toBeInTheDocument());
    expect(view.getByText(/second commit is reviewed/)).toBeInTheDocument();
    // never a fabricated 0 new / 0 existing / 0 resolved row for a baseline-only state
    expect(view.queryByText(/new$/)).not.toBeInTheDocument();

    const reviewCall = lensRunMock.mock.calls.find((c) => c[1] === 'reviewDiff');
    expect((reviewCall![2] as { commitSha?: string }).commitSha).toBe('abc1234567');
    const trendCall = lensRunMock.mock.calls.find((c) => c[1] === 'issueTrend');
    expect(trendCall).toBeTruthy();
  });

  it('renders real new/existing/resolved counts once the server reports a two-snapshot trend', async () => {
    lensRunMock.mockImplementation(baseImpl({
      reviewDiff: () => ({ data: { ok: true, result: REVIEW_RESULT, error: null } }),
      issueTrend: () => ({
        data: {
          ok: true,
          result: {
            codebaseId: null, snapshotCount: 2, hasTrend: true,
            latest: { commitSha: 'def4567890', findingCount: 2, createdAt: '2026-07-16T01:00:00.000Z' },
            previous: { commitSha: 'abc1234567', findingCount: 2, createdAt: '2026-07-16T00:00:00.000Z' },
            newCount: 1, existingCount: 1, resolvedCount: 1,
            newFindingKeys: ['todo_marker:src/x.js:2'], resolvedFindingKeys: ['console_debug:src/x.js:2'],
          },
          error: null,
        },
      }),
    }));
    const view = await renderOnReviewTab();
    fillDiff(view);
    fireEvent.change(view.getByLabelText('Commit SHA'), { target: { value: 'def4567890' } });
    await act(async () => { fireEvent.click(view.getByText('Review diff')); });

    await waitFor(() => expect(view.getByTestId('dx-review-trend')).toBeInTheDocument());
    expect(view.getByText('1 new')).toBeInTheDocument();
    expect(view.getByText('1 existing')).toBeInTheDocument();
    expect(view.getByText('1 resolved')).toBeInTheDocument();
    expect(view.getByText(/vs\. abc1234567/)).toBeInTheDocument();
  });
});
