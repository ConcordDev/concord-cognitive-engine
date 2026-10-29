/**
 * S7 (PR #1707): Problems and Outline must not lie by omission (F6/F7).
 *
 * Both panels used to convert every failure mode — no project, a
 * refused macro call, a missing diagnostics engine, an unsupported
 * file kind — into the same plausible-looking empty state ("No
 * problems detected", "No symbols found"). These tests pin the
 * rebuilt states: real problems render with counts, a heuristics-only
 * engine is announced, macro refusals render as errors, unsupported
 * languages say so, and Problems re-scans when the parent signals
 * saved content via refreshNonce.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ProblemsPanel } from '@/components/code/ProblemsPanel';
import { OutlinePanel } from '@/components/code/OutlinePanel';

type Call = { domain: string; action: string; input: Record<string, unknown> };

beforeEach(() => { lensRunMock.mockReset(); });

describe('ProblemsPanel (S7)', () => {
  function setup(diagResult: unknown) {
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'diagnostics') return Promise.resolve({ data: diagResult });
      if (req.action === 'todo-scan') return Promise.resolve({ data: { ok: true, result: { todos: [] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
  }

  it('renders the problem the editor knows about, with its message', async () => {
    setup({ ok: true, result: { problems: [{ path: 'bad.js', line: 1, severity: 'error', message: 'Expression expected.', rule: 'ts1109' }], engine: 'typescript' } });
    render(<ProblemsPanel projectId="p1" onOpen={() => undefined} />);
    expect(await screen.findByText('Expression expected.')).toBeTruthy();
    expect(screen.getByText('bad.js:1')).toBeTruthy();
    expect(screen.queryByText('No problems detected in the workspace.')).toBeNull();
  });

  it('announces a heuristics-only engine instead of implying full coverage', async () => {
    setup({ ok: true, result: { problems: [], engine: 'heuristics-only' } });
    render(<ProblemsPanel projectId="p1" onOpen={() => undefined} />);
    expect(await screen.findByText(/Server syntax\/type checking is unavailable/)).toBeTruthy();
  });

  it('a refused diagnostics call renders as an error, never as "No problems"', async () => {
    setup({ ok: false, error: 'STATE unavailable' });
    render(<ProblemsPanel projectId="p1" onOpen={() => undefined} />);
    expect(await screen.findByText('STATE unavailable')).toBeTruthy();
    expect(screen.queryByText('No problems detected in the workspace.')).toBeNull();
  });

  it('with no project it says so instead of claiming a clean workspace', async () => {
    setup({ ok: true, result: { problems: [] } });
    render(<ProblemsPanel projectId={null} onOpen={() => undefined} />);
    expect(await screen.findByText('Select a project to see its problems.')).toBeTruthy();
  });

  it('re-scans when refreshNonce changes', async () => {
    setup({ ok: true, result: { problems: [], engine: 'typescript' } });
    const { rerender } = render(<ProblemsPanel projectId="p1" onOpen={() => undefined} refreshNonce={0} />);
    await waitFor(() => expect(lensRunMock.mock.calls.filter((c) => (c[0] as Call).action === 'diagnostics').length).toBe(1));
    rerender(<ProblemsPanel projectId="p1" onOpen={() => undefined} refreshNonce={1} />);
    await waitFor(() => expect(lensRunMock.mock.calls.filter((c) => (c[0] as Call).action === 'diagnostics').length).toBeGreaterThanOrEqual(2));
  });
});

describe('OutlinePanel (S7)', () => {
  function setup(result: unknown) {
    lensRunMock.mockResolvedValue({ data: result });
    render(<OutlinePanel projectId="p1" path="main.js" onOpen={() => undefined} />);
  }

  it('lists the symbol Go to Symbol finds', async () => {
    setup({ ok: true, result: { symbols: [{ name: 'renamedVar', kind: 'variable', line: 3 }], source: 'lexical' } });
    expect(await screen.findByText('renamedVar')).toBeTruthy();
  });

  it('an unsupported file kind says so, in those words', async () => {
    setup({ ok: true, result: { symbols: [], unsupported: true, language: 'markdown', source: 'none' } });
    expect(await screen.findByText('Symbols unavailable for markdown files.')).toBeTruthy();
    expect(screen.queryByText('No symbols found.')).toBeNull();
  });

  it('a refused outline call renders its error', async () => {
    setup({ ok: false, error: 'file not found' });
    expect(await screen.findByText('file not found')).toBeTruthy();
    expect(screen.queryByText('No symbols found.')).toBeNull();
  });

  it('clicking a symbol navigates to its line', async () => {
    const onOpen = vi.fn();
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { symbols: [{ name: 'renamedVar', kind: 'variable', line: 3 }] } } });
    render(<OutlinePanel projectId="p1" path="main.js" onOpen={onOpen} />);
    fireEvent.click(await screen.findByText('renamedVar'));
    expect(onOpen).toHaveBeenCalledWith('main.js', 3);
  });
});
