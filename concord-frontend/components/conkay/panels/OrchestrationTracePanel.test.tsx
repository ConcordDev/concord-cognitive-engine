/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/panels/OrchestrationTracePanel.test.tsx
//
// A4 — pins the mission-control orchestration-trace panel's honest guarantees:
//   (a) an idle store renders an explicit "No active run" empty state, never a
//       placeholder/skeleton row;
//   (b) N real completed telemetry facts render as N ordered rows, oldest
//       first, each with the real per-row status (done/failed) derived from
//       `ok`;
//   (c) a real in-flight call is appended as a final "running" row carrying
//       the real `stage` sub-step, verbatim;
//   (d) the real `reason.verify` verdict + DTU refs attach as a receipt ONLY
//       to the matching `reason.verify` row, never to unrelated rows;
//   (e) a belt-and-suspenders source scan: no setInterval/setTimeout — row
//       motion can only be a real store update, never a scheduled fake.
// Plus a focused unit pin of the pure `buildTraceRows` producer.
//
// Seeds the REAL conkayHudStore via its own single-writer actions (same
// approach as ForwardSimPanel.test.tsx / ProvenancePanel.test.tsx) rather than
// mocking zustand, so this exercises the actual contract.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { OrchestrationTracePanel, buildTraceRows } from './OrchestrationTracePanel';
import { useConkayHudStore } from '../conkayHudStore';

beforeEach(() => {
  useConkayHudStore.getState().reset();
});

describe('OrchestrationTracePanel', () => {
  it('(a) renders an honest empty state when the store is idle — no rows fabricated', () => {
    render(<OrchestrationTracePanel />);

    expect(screen.getByTestId('ck-trace-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('ck-trace-row-0')).toBeNull();
  });

  it('(b) renders N ordered rows from real completed telemetry, oldest first, real per-row status', () => {
    // Store keeps telemetry newest-first; feed three completed runs in this
    // (newest-first) order the same way the socket adapter would.
    act(() => {
      useConkayHudStore.getState().macroStarted({ runId: 'r1', domain: 'math', action: 'naturalQuery' });
      useConkayHudStore.getState().macroCompleted({ runId: 'r1', domain: 'math', action: 'naturalQuery', ok: true, ms: 120 });
      useConkayHudStore.getState().macroStarted({ runId: 'r2', domain: 'astronomy', action: 'celestialPosition' });
      useConkayHudStore.getState().macroCompleted({ runId: 'r2', domain: 'astronomy', action: 'celestialPosition', ok: false, ms: 45 });
      useConkayHudStore.getState().macroStarted({ runId: 'r3', domain: 'code', action: 'lspHover' });
      useConkayHudStore.getState().macroCompleted({ runId: 'r3', domain: 'code', action: 'lspHover', ok: true, ms: 8 });
    });

    render(<OrchestrationTracePanel />);

    expect(screen.queryByTestId('ck-trace-empty')).toBeNull();
    // Chronological order: r1, r2, r3.
    const row0 = screen.getByTestId('ck-trace-row-0');
    const row1 = screen.getByTestId('ck-trace-row-1');
    const row2 = screen.getByTestId('ck-trace-row-2');
    expect(row0).toHaveTextContent('math.naturalQuery');
    expect(row0.getAttribute('data-status')).toBe('done');
    expect(row0).toHaveTextContent('120 ms');

    expect(row1).toHaveTextContent('astronomy.celestialPosition');
    expect(row1.getAttribute('data-status')).toBe('failed');

    expect(row2).toHaveTextContent('code.lspHover');
    expect(row2.getAttribute('data-status')).toBe('done');

    expect(screen.queryByTestId('ck-trace-row-3')).toBeNull();
  });

  it('(c) appends the real in-flight call as a final "running" row with the verbatim stage', () => {
    act(() => {
      useConkayHudStore.getState().macroStarted({ runId: 'r1', domain: 'math', action: 'naturalQuery' });
      useConkayHudStore.getState().macroCompleted({ runId: 'r1', domain: 'math', action: 'naturalQuery', ok: true, ms: 12 });
      useConkayHudStore.getState().macroStarted({ runId: 'r2', domain: 'engineering', action: 'runFEA' });
      useConkayHudStore.getState().macroStage({ runId: 'r2', stage: 'solving' });
    });

    render(<OrchestrationTracePanel />);

    const runningRow = screen.getByTestId('ck-trace-row-1');
    expect(runningRow.getAttribute('data-status')).toBe('running');
    expect(runningRow).toHaveTextContent('engineering.runFEA');
    expect(runningRow).toHaveTextContent('solving');
    expect(screen.getByTestId('ck-trace-dot-running')).toBeInTheDocument();
  });

  it('(d) attaches the real reason.verify receipt ONLY to the matching row, not to any other', () => {
    act(() => {
      useConkayHudStore.getState().macroStarted({ runId: 'r1', domain: 'math', action: 'naturalQuery' });
      useConkayHudStore.getState().macroCompleted({ runId: 'r1', domain: 'math', action: 'naturalQuery', ok: true, ms: 12 });
      useConkayHudStore.getState().macroStarted({ runId: 'r2', domain: 'reason', action: 'verify' });
      useConkayHudStore.getState().macroCompleted({ runId: 'r2', domain: 'reason', action: 'verify', ok: true, ms: 300 });
      useConkayHudStore.getState().setLastVerify({ verdict: 'grounded', mode: 'council', confidence: 0.87 });
      useConkayHudStore.getState().setRunDtuRefs([{ id: 'd1', title: 'Some DTU', tier: 'core' }]);
    });

    render(<OrchestrationTracePanel />);

    const mathRow = screen.getByTestId('ck-trace-row-0');
    const verifyRow = screen.getByTestId('ck-trace-row-1');
    expect(mathRow.querySelector('[data-testid="ck-trace-receipt"]')).toBeNull();

    const receipt = verifyRow.querySelector('[data-testid="ck-trace-receipt"]');
    expect(receipt).not.toBeNull();
    expect(receipt).toHaveAttribute('data-verdict', 'grounded');
    expect(receipt).toHaveTextContent('87%');
    expect(receipt).toHaveTextContent('1 DTU ref');
  });

  it('(e) contains NO setInterval / setTimeout — motion can only be a real store update', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'OrchestrationTracePanel.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/setInterval/);
    expect(src).not.toMatch(/setTimeout/);
  });

  it('buildTraceRows: pure producer — orders telemetry chronologically, appends the running row, attaches the receipt to the right row only', () => {
    const rows = buildTraceRows({
      telemetry: [
        { domain: 'reason', action: 'verify', ok: true, ms: 300 },
        { domain: 'math', action: 'naturalQuery', ok: true, ms: 12 },
      ],
      inFlight: 1,
      activeLabel: 'engineering.runFEA',
      stage: 'assembling',
      lastVerify: { verdict: 'unsupported', mode: 'deterministic', confidence: null },
      runDtuRefs: [],
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ domain: 'math', action: 'naturalQuery', status: 'done' });
    expect(rows[1]).toMatchObject({ domain: 'reason', action: 'verify', status: 'done' });
    expect(rows[1].receipt).toMatchObject({ verdict: 'unsupported', mode: 'deterministic' });
    expect(rows[2]).toMatchObject({ domain: 'engineering', action: 'runFEA', status: 'running', stage: 'assembling' });

    // Empty store input -> no rows (honest empty state upstream).
    expect(
      buildTraceRows({ telemetry: [], inFlight: 0, activeLabel: null, stage: null, lastVerify: null, runDtuRefs: [] }),
    ).toHaveLength(0);
  });
});
