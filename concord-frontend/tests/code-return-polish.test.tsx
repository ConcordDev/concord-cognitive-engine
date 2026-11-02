/**
 * S17 (PR #1707): return polish (F17) — SearchPanel and rename tabs.
 *
 * Search: the three mode toggles were unlabelled icons; the empty
 * state claimed "No matches." for a search that had never run; and
 * switching to the tab never ran a present query. The panel now stays
 * mounted, labels its toggles (tooltip + accessible name + pressed
 * state), distinguishes unrun from empty, and runs on activation.
 *
 * Rename: retargeting openPath and relabelling the tab raced, and
 * both effects appended — two tabs for one file. Both updaters are
 * now path-unique.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('next/dynamic', () => ({
  default: () => function StubMonaco(props: { value: string }) {
    return <pre data-testid="buffer">{props.value}</pre>;
  },
}));
vi.mock('@/components/code/CodeWorkbenchShell', () => ({
  EditorTabs: ({ tabs }: { tabs: Array<{ path: string }> }) => (
    <div>{tabs.map((t) => <span key={t.path} data-testid="tab">{t.path}</span>)}</div>
  ),
}));

import { SearchPanel } from '@/components/code/SearchPanel';
import { EditorPane } from '@/components/code/EditorPane';

type Call = { domain: string; action: string; input: Record<string, unknown> };

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((req: Call) => {
    if (req.action === 'search-project') {
      return Promise.resolve({ data: { ok: true, result: { hits: [{ file: 'a.js', line: 1, column: 1, preview: 'needle' }] } } });
    }
    if (req.action === 'files-read') {
      return Promise.resolve({ data: { ok: true, result: { content: 'const a = 1;\n', language: 'javascript' } } });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
});

describe('SearchPanel (S17)', () => {
  it('toggles expose tooltip + accessible name + pressed state', () => {
    render(<SearchPanel projectId="p1" active onOpen={() => undefined} />);
    for (const name of ['Match case', 'Whole word', 'Use regular expression']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.getAttribute('title')).toBe(name);
      expect(btn.getAttribute('aria-pressed')).toBe('false');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Match case' }));
    expect(screen.getByRole('button', { name: 'Match case' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('an unrun query says so; it never claims "No matches."', async () => {
    render(<SearchPanel projectId="p1" active onOpen={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('Search text…'), { target: { value: 'needle' } });
    expect(await screen.findByText('Press Enter or Find to search.')).toBeTruthy();
    expect(screen.queryByText('No matches.')).toBeNull();
  });

  it('becoming active with an unrun query runs the search', async () => {
    const { rerender } = render(<SearchPanel projectId="p1" active={false} onOpen={() => undefined} />);
    fireEvent.change(screen.getByPlaceholderText('Search text…'), { target: { value: 'needle' } });
    expect(lensRunMock.mock.calls.filter((c) => (c[0] as Call).action === 'search-project')).toHaveLength(0);
    rerender(<SearchPanel projectId="p1" active onOpen={() => undefined} />);
    await waitFor(() => {
      expect(lensRunMock.mock.calls.filter((c) => (c[0] as Call).action === 'search-project').length).toBeGreaterThan(0);
    });
    expect(await screen.findByText('needle', { exact: false })).toBeTruthy();
  });
});

describe('rename tab uniqueness (S17)', () => {
  it('retarget + relabel leave exactly one tab for the renamed file', async () => {
    const { rerender } = render(<EditorPane projectId="p1" openPath="a.js" onOpenChange={() => undefined} />);
    await waitFor(() => expect(screen.getAllByTestId('tab')).toHaveLength(1));
    expect(screen.getByTestId('tab').textContent).toBe('a.js');
    rerender(
      <EditorPane projectId="p1" openPath="b.js" onOpenChange={() => undefined}
        renameSignal={{ from: 'a.js', to: 'b.js', nonce: 1 }} />,
    );
    await waitFor(() => expect(screen.getAllByTestId('tab')).toHaveLength(1));
    expect(screen.getByTestId('tab').textContent).toBe('b.js');
  });
});
