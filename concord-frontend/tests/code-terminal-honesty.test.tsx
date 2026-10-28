import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
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

describe('TerminalPanel honesty (S2)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('a retired exec prints an honest failure and NO exit line', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'code_exec_host_retired' } });
    render(
      <TerminalPanel
        open
        onClose={() => {}}
        activeCode={'console.log("PR3-HELLO-42")'}
        activeLanguage="javascript"
        activeName="main.js"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    await waitFor(() => expect(screen.getByText(/didn’t run/i)).toBeTruthy());
    expect(screen.queryByText(/\[exit 0/)).toBeNull();
    expect(screen.queryByText(/code_exec_host_retired/)).toBeNull();
  });

  it('a real run prints stdout and its true exit line', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { stdout: 'hello world', stderr: '', exitCode: 0 } },
    });
    render(
      <TerminalPanel
        open
        onClose={() => {}}
        activeCode={'console.log("hello world")'}
        activeLanguage="javascript"
        activeName="main.js"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    await waitFor(() => expect(screen.getByText(/hello world/)).toBeTruthy());
    expect(screen.getByText(/\[exit 0 in \d+ms\]/)).toBeTruthy();
  });

  it('help no longer advertises the removed eval command', async () => {
    render(
      <TerminalPanel open onClose={() => {}} activeCode="" activeLanguage="javascript" activeName="main.js" />,
    );
    const input = screen.getByPlaceholderText(/code snippet/);
    fireEvent.change(input, { target: { value: 'help' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/Built-ins: run, clear, help/)).toBeTruthy());
    expect(screen.queryByText(/eval <expr>/)).toBeNull();
  });
});
