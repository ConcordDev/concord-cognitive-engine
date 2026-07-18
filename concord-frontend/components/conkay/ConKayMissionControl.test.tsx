/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/ConKayMissionControl.test.tsx
//
// A4 — pins the mission-control panel's honest guarantees:
//   (a) an idle store renders an explicit "No tool calls yet" empty state, never
//       a placeholder/skeleton row;
//   (b) N real `tool_call` receipts render as N ordered steps, execution order
//       (oldest first), each with the real per-step status derived from `ok`;
//   (c) a run_lens_action against `reason.verify` surfaces the REAL verdict badge
//       on that step only, from the real result payload;
//   (d) a live run shows a "running" indicator; a genuinely-failed run surfaces
//       its real error;
//   (e) a belt-and-suspenders source scan: no setInterval/setTimeout — step
//       motion can only be a real store update, never a scheduled fake.
// Plus focused unit pins of the pure producers (toRunStep / summarizeInput /
// extractVerify).
//
// Seeds the REAL conkayRunStore via its own single-writer actions (the same
// approach as OrchestrationTracePanel.test.tsx) rather than mocking zustand, so
// this exercises the actual contract — including the honest SSE-receipt shape.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConKayMissionControl } from './ConKayMissionControl';
import {
  useConkayRunStore,
  toRunStep,
  summarizeInput,
  extractVerify,
} from './conkayRunStore';

beforeEach(() => {
  useConkayRunStore.getState().reset();
});

describe('ConKayMissionControl', () => {
  it('(a) renders an honest empty state when no run has produced tool calls', () => {
    render(<ConKayMissionControl />);

    expect(screen.getByTestId('ck-mc-empty')).toHaveTextContent('No tool calls yet');
    expect(screen.queryByTestId('ck-mc-row-0')).toBeNull();
    expect(screen.queryByTestId('ck-mc-running')).toBeNull();
  });

  it('(b) renders N ordered steps from real tool_call receipts, oldest first, real per-step status', () => {
    act(() => {
      const s = useConkayRunStore.getState();
      s.runStarted();
      s.toolCallReceived({ tool: 'web_search', ok: true });
      s.toolCallReceived({
        tool: 'run_lens_action',
        ok: true,
        domain: 'math',
        action: 'naturalQuery',
        input: { query: '2+2' },
      });
      s.toolCallReceived({ tool: 'browse_url', ok: false, error: 'browse_url failed: timeout' });
      s.runFinished({ ok: true });
    });

    render(<ConKayMissionControl />);

    expect(screen.queryByTestId('ck-mc-empty')).toBeNull();
    const row0 = screen.getByTestId('ck-mc-row-0');
    const row1 = screen.getByTestId('ck-mc-row-1');
    const row2 = screen.getByTestId('ck-mc-row-2');

    expect(row0).toHaveTextContent('web_search');
    expect(row0.getAttribute('data-status')).toBe('done');

    expect(row1).toHaveTextContent('math.naturalQuery');
    expect(row1).toHaveTextContent('query: 2+2');
    expect(row1.getAttribute('data-status')).toBe('done');

    expect(row2).toHaveTextContent('browse_url');
    expect(row2).toHaveTextContent('browse_url failed: timeout');
    expect(row2.getAttribute('data-status')).toBe('failed');

    expect(screen.queryByTestId('ck-mc-row-3')).toBeNull();
  });

  it('(c) surfaces the REAL reason.verify verdict badge on the verify step only', () => {
    act(() => {
      const s = useConkayRunStore.getState();
      s.runStarted();
      s.toolCallReceived({ tool: 'run_lens_action', ok: true, domain: 'math', action: 'naturalQuery', input: {} });
      s.toolCallReceived({
        tool: 'run_lens_action',
        ok: true,
        domain: 'reason',
        action: 'verify',
        input: { claim: 'x' },
        result: { verdict: 'grounded', mode: 'council', confidence: 0.87 },
      });
      s.runFinished({ ok: true });
    });

    render(<ConKayMissionControl />);

    const mathRow = screen.getByTestId('ck-mc-row-0');
    const verifyRow = screen.getByTestId('ck-mc-row-1');
    expect(mathRow.querySelector('[data-testid="ck-mc-verdict"]')).toBeNull();

    const badge = verifyRow.querySelector('[data-testid="ck-mc-verdict"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute('data-verdict', 'grounded');
    expect(badge).toHaveTextContent('council');
    expect(badge).toHaveTextContent('87%');
  });

  it('(d) shows a running indicator while active and a real error when a run fails', () => {
    act(() => {
      const s = useConkayRunStore.getState();
      s.runStarted();
      s.toolCallReceived({ tool: 'web_search', ok: true });
    });
    const { rerender } = render(<ConKayMissionControl />);
    expect(screen.getByTestId('ck-mc-running')).toBeInTheDocument();
    expect(screen.queryByTestId('ck-mc-error')).toBeNull();

    act(() => {
      useConkayRunStore.getState().runFinished({ ok: false, error: 'status_500' });
    });
    rerender(<ConKayMissionControl />);
    expect(screen.queryByTestId('ck-mc-running')).toBeNull();
    expect(screen.getByTestId('ck-mc-error')).toHaveTextContent('status_500');
  });

  it('(e) contains NO setInterval / setTimeout — step motion can only be a real store update', () => {
    const componentSrc = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'ConKayMissionControl.tsx'),
      'utf8',
    );
    const storeSrc = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'conkayRunStore.ts'),
      'utf8',
    );
    expect(componentSrc).not.toMatch(/setInterval|setTimeout/);
    expect(storeSrc).not.toMatch(/setInterval|setTimeout/);
  });
});

describe('conkayRunStore pure producers', () => {
  it('toRunStep: a run_lens_action carries domain/action; other tools leave them null', () => {
    const lens = toRunStep(
      { tool: 'run_lens_action', ok: true, domain: 'music', action: 'search', input: { q: 'jazz' } },
      1,
    );
    expect(lens).toMatchObject({
      seq: 1, tool: 'run_lens_action', domain: 'music', action: 'search', ok: true,
      inputSummary: 'q: jazz', error: null, verify: null,
    });

    const search = toRunStep({ tool: 'web_search', ok: false, error: 'nope' }, 2);
    expect(search).toMatchObject({
      seq: 2, tool: 'web_search', domain: null, action: null, ok: false, error: 'nope',
      inputSummary: null, verify: null,
    });
  });

  it('summarizeInput: compact, honest, and null when there is nothing real to show', () => {
    expect(summarizeInput(null)).toBeNull();
    expect(summarizeInput({})).toBeNull();
    expect(summarizeInput({ a: 1, b: 'two' })).toBe('a: 1, b: two');
    expect(summarizeInput({ a: 1, b: 2, c: 3, d: 4, e: 5 })).toContain('+1 more');
    expect(summarizeInput({ tags: [1, 2, 3] })).toBe('tags: [3]');
  });

  it('extractVerify: only fires for reason.verify, never fabricates', () => {
    expect(extractVerify({ tool: 'run_lens_action', domain: 'math', action: 'naturalQuery', result: {} })).toBeNull();
    expect(
      extractVerify({ tool: 'run_lens_action', domain: 'reason', action: 'verify', result: {} }),
    ).toBeNull();
    expect(
      extractVerify({
        tool: 'run_lens_action', domain: 'reason', action: 'verify',
        result: { verdict: 'unsupported', mode: 'deterministic', confidence: null },
      }),
    ).toMatchObject({ verdict: 'unsupported', mode: 'deterministic', confidence: null });
    // Nested { result: { verdict } } handler shape is also honored.
    expect(
      extractVerify({
        tool: 'run_lens_action', domain: 'reason', action: 'verify',
        result: { result: { verdict: 'proven', confidence: 1 } },
      }),
    ).toMatchObject({ verdict: 'proven', confidence: 1 });
  });
});
