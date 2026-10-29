import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// S1a rerouted JS/TS/Python runs to the browser-local runner; the
// terminal's local path is driven through this mock so the suite tests
// the PANEL's rendering of each outcome deterministically. (The
// runner itself is covered, against a fake Worker, by
// code-local-exec.test.ts.) The pre-S1a version of this suite mocked
// only lensRun and clicked Run on a JavaScript file — the run never
// reached the mock, the panel waited on a real worker, and the test
// timed out: the stale-harness failure behind PR #1707's deploy hold
// (diagnosed 2026-10-29, B6).
const runLocalScriptMock = vi.fn();
vi.mock('@/components/code/localExec', () => ({
  isLocallyRunnable: (language: string) => ['javascript', 'js', 'typescript', 'ts', 'python', 'py'].includes(String(language || '').toLowerCase()),
  runLocalScript: (...args: unknown[]) => runLocalScriptMock(...args),
}));

// Force the styled-<pre> fallback renderer (xterm needs a real DOM canvas).
vi.mock('@xterm/xterm', () => {
  throw new Error('xterm unavailable in tests');
});

import { TerminalPanel, execFailureMessage, isRealExecResult } from '@/components/code/TerminalPanel';

describe('exec honesty helpers (S2)', () => {
  it('never treats a retired-exec response as a real result', () => {
    expect(isRealExecResult({ ok: false, error: 'code_exec_host_retired' })).toBe(false);
    expect(isRealExecResult({ ok: true, result: null })).toBe(false);
    expect(isRealExecResult({ ok: true, result: { supported: false } })).toBe(false);
    expect(isRealExecResult(null)).toBe(false);
    expect(isRealExecResult(undefined)).toBe(false);
  });

  it('accepts a genuine result shape', () => {
    expect(isRealExecResult({ ok: true, result: { stdout: 'hi', exitCode: 0 } })).toBe(true);
  });

  it('maps raw server codes to user words and never echoes the code', () => {
    const retired = execFailureMessage({ ok: false, error: 'code_exec_host_retired' });
    expect(retired).not.toContain('code_exec_host_retired');
    expect(retired).toContain('didn’t run');
    const forbidden = execFailureMessage({ ok: false, error: 'code_exec_forbidden' });
    expect(forbidden).not.toContain('code_exec_forbidden');
    expect(forbidden).toContain('founder and sovereign');
    const otherCode = execFailureMessage({ ok: false, error: 'some_internal_code' });
    expect(otherCode).not.toContain('some_internal_code');
  });
});

describe('TerminalPanel honesty (S2, local path since S1a)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    runLocalScriptMock.mockReset();
  });

  function renderPanel(language = 'javascript', name = 'main.js', code = 'console.log("hi")') {
    return render(
      <TerminalPanel
        open
        onClose={() => {}}
        activeCode={code}
        activeLanguage={language}
        activeName={name}
      />,
    );
  }

  it('a real local run prints stdout and its true exit line', async () => {
    runLocalScriptMock.mockResolvedValue({
      result: { supported: true, stdout: 'hello world', stderr: '', exitCode: 0 },
      timedOut: false,
      ranLocally: true,
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    await waitFor(() => expect(screen.getByText(/hello world/)).toBeTruthy());
    expect(screen.getByText(/\[exit 0 in \d+ms\]/)).toBeTruthy();
    // The local path must not consult the retired server exec at all.
    expect(lensRunMock).not.toHaveBeenCalled();
  });

  it('a timed-out local run prints partial output and a stopped line — no exit line', async () => {
    runLocalScriptMock.mockResolvedValue({
      result: { supported: true, stdout: 'partial line', stderr: '', exitCode: undefined },
      timedOut: true,
      ranLocally: true,
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    await waitFor(() => expect(screen.getByText(/partial line/)).toBeTruthy());
    expect(screen.getByText(/\[stopped — the code did not finish in time/)).toBeTruthy();
    expect(screen.queryByText(/\[exit /)).toBeNull();
  });

  it('an unsupported local run prints the didn’t-run line and no exit line', async () => {
    runLocalScriptMock.mockResolvedValue({
      result: { supported: false, stdout: '', stderr: 'Web Workers are not available in this browser, so local runs are unavailable here.', exitCode: undefined },
      timedOut: false,
      ranLocally: false,
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    await waitFor(() => expect(screen.getByText(/didn’t run/i)).toBeTruthy());
    expect(screen.queryByText(/\[exit /)).toBeNull();
  });

  it('the server path (non-local language): a retired exec prints an honest failure and NO exit line', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'code_exec_host_retired' } });
    renderPanel('go', 'main.go', 'package main');
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    await waitFor(() => expect(screen.getByText(/didn’t run/i)).toBeTruthy());
    expect(screen.queryByText(/\[exit 0/)).toBeNull();
    expect(screen.queryByText(/code_exec_host_retired/)).toBeNull();
    expect(runLocalScriptMock).not.toHaveBeenCalled();
  });

  it('help no longer advertises the removed eval command', async () => {
    renderPanel('javascript', 'main.js', '');
    const input = screen.getByPlaceholderText(/code snippet/);
    fireEvent.change(input, { target: { value: 'help' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Built-ins: run, clear, help/)).toBeTruthy());
    expect(screen.queryByText(/eval <expr>/)).toBeNull();
  });
});
