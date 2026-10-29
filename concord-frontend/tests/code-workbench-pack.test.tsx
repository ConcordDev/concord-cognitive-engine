/**
 * S12 (PR #1707): the review workbench keeps its promises (F13).
 *
 * The panel and the macros spoke different contracts: Complexity got
 * an empty module list and rendered "Cyclomatic: —", Save snippet
 * sent `name` to a macro reading `title`, Commit sent code to a macro
 * demanding files[] and then read an id field the macro never
 * returns. These tests pin the panel side of the repaired contracts:
 * real numbers render in the card, two analyses' detail lines
 * co-exist in the kept-results list, and the snapshot id is read from
 * the field the macro actually returns.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runDomainMock = vi.fn();
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: () => undefined }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));
vi.mock('framer-motion', () => ({
  motion: { div: (props: Record<string, unknown>) => <div {...props} /> },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { CodeActionPanel } from '@/components/code/CodeActionPanel';

type MacroCall = [string, string, { input: Record<string, unknown> }];

beforeEach(() => {
  runDomainMock.mockReset();
  lensRunMock.mockReset();
  runDomainMock.mockImplementation((_domain: string, action: string) => {
    switch (action) {
      case 'complexityAnalysis':
        return Promise.resolve({ data: { ok: true, result: { cyclomatic: 7, cognitive: 9, lines: 12, functions: 1, risk: 'low', source: 'ast' } } });
      case 'dependencyAudit':
        return Promise.resolve({ data: { ok: true, result: { total: 2, outdated: null, security: null, riskScore: null, note: 'Parsed from imports.' } } });
      case 'commit-snapshot':
        return Promise.resolve({ data: { ok: true, result: { id: 'dtu_snap_abcdef123456', snapshot: { fileCount: 1 } } } });
      case 'snippets-save':
        return Promise.resolve({ data: { ok: true, result: { id: 'dtu_snip_xyz987' } } });
      default:
        return Promise.resolve({ data: { ok: true, result: {} } });
    }
  });
});

async function fillForm() {
  render(<CodeActionPanel />);
  fireEvent.change(screen.getByPlaceholderText('Snippet name'), { target: { value: 'pr3Score' } });
  const codeBoxes = document.querySelectorAll('textarea');
  fireEvent.change(codeBoxes[0], { target: { value: 'function pr3Score(a, b) { if (a > b) return a; return b; }' } });
}

describe('CodeActionPanel (S12)', () => {
  it('Complexity renders the numeric values its label promises', async () => {
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Complexity/ }));
    await waitFor(() => expect(screen.getByText('cyclomatic')).toBeTruthy());
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    const call = runDomainMock.mock.calls.find((c) => (c as MacroCall)[1] === 'complexityAnalysis') as MacroCall;
    expect(call[2].input).toMatchObject({ language: 'javascript' });
    expect(String(call[2].input.code)).toContain('pr3Score');
  });

  it('two analyses keep both detail lines — the second does not erase the first', async () => {
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Complexity/ }));
    await screen.findByText(/Cyclomatic: 7 · cognitive 9 · risk low\./);
    fireEvent.click(screen.getByRole('button', { name: /Deps audit/ }));
    await screen.findByText(/Deps: 2 imported\./);
    // Both lines remain visible in the kept-results list.
    expect(screen.getByText(/Cyclomatic: 7 · cognitive 9 · risk low\./)).toBeTruthy();
    expect(screen.getByText(/Deps: 2 imported\./)).toBeTruthy();
  });

  it('Commit reads the snapshot id from the field the macro returns', async () => {
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Commit/ }));
    expect(await screen.findByText(/Snapshot dtu_snap…/)).toBeTruthy();
  });

  it('Save snippet with name + code filled succeeds', async () => {
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: /Save snippet/ }));
    expect(await screen.findByText(/Snippet saved dtu_snip…/)).toBeTruthy();
    const call = runDomainMock.mock.calls.find((c) => (c as MacroCall)[1] === 'snippets-save') as MacroCall;
    expect(call[2].input).toMatchObject({ name: 'pr3Score' });
  });
});
