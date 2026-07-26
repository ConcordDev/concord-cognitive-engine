/// <reference types="@testing-library/jest-dom/vitest" />
// ConstantTimePanel — behavioral tests against a mocked /api/lens/run,
// exercising the real `detectors.run` response envelope shape (see
// server/domains/detectors.js + server/lib/detectors/_framework.js +
// server/lib/detectors/constant-time-detector.js).
//
// The panel calls `runFrontierMacro` (components/frontier/FrontierEngineShell.tsx),
// which calls `api.post` directly — spying on `api.post` (not mocking the
// module) keeps the real one-envelope unwrap in `runFrontierMacro` under
// test, same convention as the sibling panels.
//
// `detectors.run` is unusual among this suite's macros: it ALWAYS answers
// `{ok:true, report, runId}` at the transport level, even when the
// detector itself failed internally — the detector's own outcome lives in
// `report.ok` (server/lib/detectors/_framework.js#makeReport/makeError).
// This file pins BOTH real detector outcomes:
//   1. `report.ok:true` with real findings — including the detector's own
//      honest "parser unavailable" info-only finding (constant-time-
//      detector.js's real degraded path when `typescript` can't be
//      loaded), asserting it renders as exactly what it is (a single
//      `info` finding with an explicit "not a clean bill of health" note)
//      and never gets inflated into a fabricated high/critical finding.
//   2. `report.ok:false` — a genuine detector-level exception
//      (`makeError`'s real shape) — rendered as the shell's honest
//      refusal, with the real `reason`/`error` strings surfaced.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { api } from '@/lib/api/client';
const post = vi.spyOn(api, 'post');

import { ConstantTimePanel } from './ConstantTimePanel';
import { getFrontierEngine } from '@/lib/frontier-engines';

const engine = getFrontierEngine('constant-time-analyzer')!;

// Real shape /api/lens/run sends over HTTP: `{ ok:true, result:<payload> }`,
// where `<payload>` here is `detectors.run`'s own `{ok:true, report, runId}`.
function httpResponse(payload: unknown) {
  return { data: { ok: true, result: payload } };
}

type Body = { action: string; input: Record<string, unknown> };
function routeByAction(handlers: Record<string, (body: Body) => unknown>) {
  post.mockImplementation(((_url: string, body: Body) => {
    const h = handlers[body.action];
    if (!h) return Promise.reject(new Error(`unexpected action ${body.action}`));
    return Promise.resolve(httpResponse(h(body)));
  }) as unknown as typeof api.post);
}

beforeEach(() => { post.mockReset(); });

describe('ConstantTimePanel', () => {
  it('shows the idle Verify state and the persistent honest-boundary cell before any run', () => {
    render(<ConstantTimePanel engine={engine} />);
    expect(screen.getByText(/Run the compute cell above/)).toBeInTheDocument();
    expect(screen.getByText(engine.boundary!)).toBeInTheDocument();
  });

  it('renders a real high-severity finding (secret_dependent_branch) with its real message/location/fixHint, plus the real scan summary — via the generic detectors.run path since this engine has no macro of its own', async () => {
    routeByAction({
      run: () => ({
        ok: true,
        report: {
          id: 'constant-time',
          ok: true,
          summary: { total: 2, critical: 0, high: 1, medium: 0, low: 0, info: 1 },
          findings: [
            {
              id: 'constant_time_summary',
              severity: 'info',
              message: 'Scanned 412 of 412 candidate file(s) under server/; flagged 1 secret-dependent-flow pattern(s). See this detector\'s module header for the honest scope boundary — a clean file means "no pattern matched by these rules," not "constant-time."',
              evidence: { scanned: 412, totalFiles: 412 },
            },
            {
              id: 'secret_dependent_branch',
              severity: 'high',
              category: 'timing-side-channel',
              message: 'if-condition depends on secret-tainted data (`token === expected`) — the branch taken (and its timing) can leak the secret.',
              location: 'server/lib/session-auth.js:88',
              evidence: { snippet: 'if (token === expected) {' },
              fixHint: 'replace the branch with a constant-time/branchless select (bitmask conditional move) over secret data, or restructure so the branch condition doesn\'t depend on the secret.',
            },
          ],
          durationMs: 934,
        },
        runId: 'dr_1721_abcxyz',
      }),
    });
    render(<ConstantTimePanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Run the analyzer/ }));

    await waitFor(() => expect(screen.getByText(/Real run dr_1721_abcxyz — 934ms — 2 findings total\./)).toBeInTheDocument());
    expect(screen.getByText('high: 1')).toBeInTheDocument();
    expect(screen.getByText('critical: 0')).toBeInTheDocument();

    expect(screen.getByText(/if-condition depends on secret-tainted data/)).toBeInTheDocument();
    expect(screen.getByText('server/lib/session-auth.js:88')).toBeInTheDocument();
    expect(screen.getByText('secret_dependent_branch')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show snippet + fix hint' }));
    expect(screen.getByText('if (token === expected) {')).toBeInTheDocument();
    expect(screen.getByText(/Fix: replace the branch with a constant-time\/branchless select/)).toBeInTheDocument();

    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({ domain: 'detectors', action: 'run', input: { id: 'constant-time' } });
  });

  it('opts into the naming-convention heuristic when the checkbox is checked, sending the real opts shape', async () => {
    routeByAction({
      run: () => ({
        ok: true,
        report: { id: 'constant-time', ok: true, summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, findings: [], durationMs: 12 },
        runId: 'dr_naming',
      }),
    });
    render(<ConstantTimePanel engine={engine} />);
    fireEvent.click(screen.getByLabelText(/Also taint by naming convention/));
    fireEvent.click(screen.getByRole('button', { name: /Run the analyzer/ }));

    await waitFor(() => expect(screen.getByText('No findings at or above this severity.')).toBeInTheDocument());
    const [, body] = post.mock.calls.at(-1)!;
    expect(body).toMatchObject({ domain: 'detectors', action: 'run', input: { id: 'constant-time', opts: { useNamingConvention: true } } });
  });

  it('renders the real "parser unavailable" honest degraded finding as exactly what it is — a single info-severity no-op, never a fabricated critical finding', async () => {
    routeByAction({
      run: () => ({
        ok: true,
        report: {
          id: 'constant-time',
          ok: true,
          summary: { total: 1, critical: 0, high: 0, medium: 0, low: 0, info: 1 },
          findings: [
            {
              id: 'constant_time_parser_unavailable',
              severity: 'info',
              category: 'timing-side-channel',
              message:
                'The `typescript` compiler API (a devDependency) could not be loaded, so the AST-based constant-time analyzer did not run. ' +
                'This is an honest no-op, not a clean bill of health — install `typescript` in server/node_modules to enable this detector.',
              fixHint: 'ensure `typescript` is installed (npm install in server/, even for a production build if this detector should run there)',
            },
          ],
          durationMs: 3,
        },
        runId: 'dr_degraded',
      }),
    });
    render(<ConstantTimePanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Run the analyzer/ }));

    await waitFor(() => expect(screen.getByText(/This is an honest no-op, not a clean bill of health/)).toBeInTheDocument());
    // Never fabricates severity it didn't earn.
    expect(screen.getByText('critical: 0')).toBeInTheDocument();
    expect(screen.getByText('high: 0')).toBeInTheDocument();
    expect(screen.getByText('info: 1')).toBeInTheDocument();
    // The degraded finding has no snippet/fixHint expand affordance requiring
    // an id it isn't (constant_time_summary is excluded from the button, but
    // this one has a fixHint, so the button IS expected — assert it opens to
    // the real fix instruction, not a fabricated one).
    fireEvent.click(screen.getByRole('button', { name: 'Show snippet + fix hint' }));
    expect(screen.getByText(/ensure `typescript` is installed/)).toBeInTheDocument();
  });

  it('renders a genuine detector-level exception (report.ok:false) as a real honest refusal, never a fabricated clean report', async () => {
    routeByAction({
      // Real shape from _framework.js#makeError.
      run: () => ({
        ok: true,
        report: {
          id: 'constant-time',
          ok: false,
          reason: 'exception',
          error: 'ENOENT: no such file or directory, scandir \'/repo/server\'',
          summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          findings: [],
          durationMs: 2,
        },
        runId: 'dr_exception',
      }),
    });
    render(<ConstantTimePanel engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: /Run the analyzer/ }));

    await waitFor(() => expect(screen.getByText(/Honest refusal — not a fabricated pass\./)).toBeInTheDocument());
    expect(screen.getByText(/exception — ENOENT: no such file or directory, scandir '\/repo\/server'/)).toBeInTheDocument();
  });
});
