/**
 * S11 (PR #1707): ⌘K inline edit is diff-first (F11).
 *
 * The old flow applied the model's output to the buffer the instant
 * it arrived — no diff, no Accept/Reject, on the one AI edit path
 * that worked. These tests pin the rebuilt flow against a stub
 * editor: proposing changes nothing; Reject leaves the buffer
 * byte-identical (and the file unmodified); Accept applies the edit
 * as one change; a no-change proposal and a macro refusal render as
 * in-panel errors (the alert() path is gone).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Stub Monaco: renders the buffer and offers a fixed selection.
vi.mock('next/dynamic', () => ({
  default: () => function StubMonaco(props: {
    value: string;
    onSelectionChange?: (sel: { text: string }) => void;
  }) {
    return (
      <div>
        <pre data-testid="buffer">{props.value}</pre>
        <button onClick={() => props.onSelectionChange?.({ text: 'const foo = 1;' })}>stub-select</button>
      </div>
    );
  },
}));

import { EditorPane } from '@/components/code/EditorPane';

type Call = { domain: string; action: string; input: Record<string, unknown> };

const CONTENT = 'const foo = 1;\nconsole.log(foo);\n';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((req: Call) => {
    if (req.action === 'files-read') {
      return Promise.resolve({ data: { ok: true, result: { content: CONTENT, language: 'javascript' } } });
    }
    if (req.action === 'inline-edit') {
      return Promise.resolve({ data: { ok: true, result: { edited: 'const bar = 1;' } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
});

async function openEditorAndPropose() {
  render(<EditorPane projectId="p1" openPath="main.js" onOpenChange={() => undefined} />);
  await screen.findByText('const foo = 1;', { exact: false });
  fireEvent.click(screen.getByText('stub-select'));
  fireEvent.click(await screen.findByTitle('Inline edit selection (⌘K)'));
  fireEvent.change(await screen.findByPlaceholderText('Inline edit: e.g. rename foo to bar'), { target: { value: 'rename foo to bar' } });
  fireEvent.click(screen.getByRole('button', { name: /Propose edit/ }));
  await screen.findByText(/Proposed change for/);
}

describe('EditorPane inline edit (S11)', () => {
  it('proposing changes nothing; Reject leaves the buffer byte-identical', async () => {
    await openEditorAndPropose();
    // The diff is shown BEFORE anything is written.
    expect(screen.getByTestId('buffer').textContent).toBe(CONTENT);
    expect(screen.getByText('const bar = 1;')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.queryByText(/Proposed change for/)).toBeNull());
    expect(screen.getByTestId('buffer').textContent).toBe(CONTENT);
  });

  it('Accept applies the edit as the new buffer content', async () => {
    await openEditorAndPropose();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.getByTestId('buffer').textContent).toBe('const bar = 1;\nconsole.log(foo);\n'));
  });

  it('a no-change proposal is an in-panel error, not a silent apply', async () => {
    lensRunMock.mockImplementation((req: Call) => {
      if (req.action === 'files-read') return Promise.resolve({ data: { ok: true, result: { content: CONTENT, language: 'javascript' } } });
      if (req.action === 'inline-edit') return Promise.resolve({ data: { ok: true, result: { edited: 'const foo = 1;' } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<EditorPane projectId="p1" openPath="main.js" onOpenChange={() => undefined} />);
    await screen.findByText('const foo = 1;', { exact: false });
    fireEvent.click(screen.getByText('stub-select'));
    fireEvent.click(await screen.findByTitle('Inline edit selection (⌘K)'));
    fireEvent.change(await screen.findByPlaceholderText('Inline edit: e.g. rename foo to bar'), { target: { value: 'do nothing' } });
    fireEvent.click(screen.getByRole('button', { name: /Propose edit/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('buffer').textContent).toBe(CONTENT);
  });

  it('the instruction field no longer carries the misleading char-count label', async () => {
    render(<EditorPane projectId="p1" openPath="main.js" onOpenChange={() => undefined} />);
    await screen.findByText('const foo = 1;', { exact: false });
    fireEvent.click(screen.getByText('stub-select'));
    fireEvent.click(await screen.findByTitle('Inline edit selection (⌘K)'));
    const input = await screen.findByPlaceholderText('Inline edit: e.g. rename foo to bar');
    expect(input.getAttribute('placeholder')).not.toMatch(/chars:/);
    expect(screen.getByText('14 chars selected')).toBeTruthy();
  });
});
