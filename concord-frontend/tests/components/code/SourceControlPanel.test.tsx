import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('@/components/code/MonacoDiffViewer', () => ({
  default: () => React.createElement('div', { 'data-testid': 'diff' }, 'diff'),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { SourceControlPanel } from '@/components/code/SourceControlPanel';

const TABS = [
  { id: 't1', name: 'index.ts', language: 'ts', content: 'a\nb\nc', isDirty: true },
  { id: 't2', name: 'README.md', language: 'md', content: 'doc', isDirty: false },
];
const SAVED = [
  { id: 't1', title: 'index.ts', data: { content: 'a', language: 'ts' } },
];

describe('SourceControlPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders working-tree-clean when no dirty / new tabs', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snapshots: [] } } });
    const cleanTabs = [{ id: 't1', name: 'a.ts', language: 'ts', content: 'x', isDirty: false }];
    const saved = [{ id: 't1', title: 'a.ts', data: { content: 'x' } }];
    render(
      <SourceControlPanel
        tabs={cleanTabs}
        savedScripts={saved}
        onJumpToTab={vi.fn()}
        onCommitAll={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText('Working tree clean')).toBeInTheDocument());
  });

  it('renders changes with modified and untracked markers', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snapshots: [] } } });
    render(
      <SourceControlPanel
        tabs={TABS}
        savedScripts={SAVED}
        onJumpToTab={vi.fn()}
        onCommitAll={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getAllByText('index.ts').length).toBeGreaterThan(0));
    // t2 (README.md) is not in savedScripts → "U" untracked
    expect(screen.getByText('U')).toBeInTheDocument();
    // t1 is dirty + saved → "M" modified
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('shows the snapshot count', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { snapshots: [{ id: 'x' }, { id: 'y' }] } },
    });
    render(
      <SourceControlPanel
        tabs={TABS}
        savedScripts={SAVED}
        onJumpToTab={vi.fn()}
        onCommitAll={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText('2 snapshots')).toBeInTheDocument());
  });

  it('selects a change row, shows the diff, and jumps to the tab', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snapshots: [] } } });
    const onJumpToTab = vi.fn();
    render(
      <SourceControlPanel
        tabs={TABS}
        savedScripts={SAVED}
        onJumpToTab={onJumpToTab}
        onCommitAll={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByText('README.md')).toBeInTheDocument());
    fireEvent.click(screen.getByText('README.md'));
    expect(onJumpToTab).toHaveBeenCalledWith('t2');
    expect(screen.getByTestId('diff')).toBeInTheDocument();
  });

  it('commits with a message and reports the time', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snapshots: [] } } });
    const onCommitAll = vi.fn().mockResolvedValue(undefined);
    render(
      <SourceControlPanel
        tabs={TABS}
        savedScripts={SAVED}
        onJumpToTab={vi.fn()}
        onCommitAll={onCommitAll}
      />
    );
    await waitFor(() => expect(screen.getAllByText('index.ts').length).toBeGreaterThan(0));
    fireEvent.change(
      screen.getByPlaceholderText('Commit message (creates DTU snapshot bundle)'),
      { target: { value: 'my commit' } }
    );
    fireEvent.click(screen.getByText(/^Commit/));
    await waitFor(() => expect(onCommitAll).toHaveBeenCalledWith('my commit'));
    await waitFor(() => expect(screen.getByText(/Committed at/)).toBeInTheDocument());
  });

  it('does not commit when message is empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snapshots: [] } } });
    const onCommitAll = vi.fn();
    render(
      <SourceControlPanel
        tabs={TABS}
        savedScripts={SAVED}
        onJumpToTab={vi.fn()}
        onCommitAll={onCommitAll}
      />
    );
    await waitFor(() => expect(screen.getAllByText('index.ts').length).toBeGreaterThan(0));
    expect(screen.getByText(/^Commit/).closest('button')).toBeDisabled();
  });

  it('refreshes via the refresh button', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snapshots: [] } } });
    const onRefresh = vi.fn();
    render(
      <SourceControlPanel
        tabs={TABS}
        savedScripts={SAVED}
        onJumpToTab={vi.fn()}
        onCommitAll={vi.fn()}
        onRefresh={onRefresh}
      />
    );
    await waitFor(() => expect(screen.getAllByText('index.ts').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTitle('Refresh'));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('re-selects the first dirty tab after the diff close button is clicked', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { snapshots: [] } } });
    render(
      <SourceControlPanel
        tabs={TABS}
        savedScripts={SAVED}
        onJumpToTab={vi.fn()}
        onCommitAll={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getByTestId('diff')).toBeInTheDocument());
    const saveIcon = screen.getByTestId('icon-Save');
    fireEvent.click(saveIcon.closest('button')!);
    // the auto-select effect immediately re-picks the first dirty tab
    await waitFor(() => expect(screen.getByTestId('diff')).toBeInTheDocument());
  });

  it('tolerates a rejected snapshot-count fetch', async () => {
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('snap fail')));
    render(
      <SourceControlPanel
        tabs={TABS}
        savedScripts={SAVED}
        onJumpToTab={vi.fn()}
        onCommitAll={vi.fn()}
      />
    );
    await waitFor(() => expect(screen.getAllByText('index.ts').length).toBeGreaterThan(0));
  });
});
