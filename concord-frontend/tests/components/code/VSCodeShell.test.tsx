import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';

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

import { VSCodeShell, type FileTreeNode, type OpenTab } from '@/components/code/VSCodeShell';

const files: FileTreeNode[] = [
  {
    id: 'src',
    name: 'src',
    kind: 'folder',
    children: [
      { id: 'a', name: 'index.ts', kind: 'file', modified: true },
      {
        id: 'sub',
        name: 'nested',
        kind: 'folder',
        children: [{ id: 'deep', name: 'deep.ts', kind: 'file' }],
      },
    ],
  },
  { id: 'root-file', name: 'README.md', kind: 'file' },
];

const tabs: OpenTab[] = [
  { id: 't1', label: 'index.ts', modified: true },
  { id: 't2', label: 'README.md' },
];

describe('VSCodeShell', () => {
  it('renders files tree with folders and files', () => {
    const { container } = render(
      <VSCodeShell files={files} openTabs={[]}>editor</VSCodeShell>
    );
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(within(container.querySelector('aside')!).getByText('README.md')).toBeInTheDocument();
    expect(screen.getByText('editor')).toBeInTheDocument();
  });

  it('selects a file and fires onSelectFile', () => {
    const onSelectFile = vi.fn();
    const { container } = render(
      <VSCodeShell files={files} openTabs={[]} onSelectFile={onSelectFile}>e</VSCodeShell>
    );
    fireEvent.click(within(container.querySelector('aside')!).getByText('README.md'));
    expect(onSelectFile).toHaveBeenCalledWith(files[1]);
  });

  it('toggles a folder open/closed on click', () => {
    render(<VSCodeShell files={files} openTabs={[]}>e</VSCodeShell>);
    // index.ts is visible because src folder defaults open at depth 0
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    fireEvent.click(screen.getByText('src'));
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('src'));
    expect(screen.getByText('index.ts')).toBeInTheDocument();
  });

  it('selects a tab and closes a tab', () => {
    const onSelectTab = vi.fn();
    const onCloseTab = vi.fn();
    render(
      <VSCodeShell
        files={[]}
        openTabs={tabs}
        activeTabId="t1"
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
      >
        e
      </VSCodeShell>
    );
    fireEvent.click(screen.getByText('README.md'));
    expect(onSelectTab).toHaveBeenCalledWith(tabs[1]);
    fireEvent.click(screen.getByLabelText('Close index.ts'));
    expect(onCloseTab).toHaveBeenCalledWith(tabs[0]);
  });

  it('changes activity and shows the matching sidebar label', () => {
    const onActivityChange = vi.fn();
    const { rerender } = render(
      <VSCodeShell files={files} openTabs={tabs} onActivityChange={onActivityChange} activeActivity="files">
        e
      </VSCodeShell>
    );
    expect(screen.getByText('Explorer')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Search'));
    expect(onActivityChange).toHaveBeenCalledWith('search');
    rerender(
      <VSCodeShell files={files} openTabs={tabs} activeActivity="git">
        e
      </VSCodeShell>
    );
    expect(screen.getByText('Source control')).toBeInTheDocument();
    rerender(
      <VSCodeShell files={files} openTabs={tabs} activeActivity="debug">
        e
      </VSCodeShell>
    );
    expect(screen.getByText('Run and debug')).toBeInTheDocument();
    rerender(
      <VSCodeShell files={files} openTabs={tabs} activeActivity="settings">
        e
      </VSCodeShell>
    );
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0);
  });

  it('renders status bar branch / errors / warnings / cursor / language', () => {
    render(
      <VSCodeShell
        files={files}
        openTabs={tabs}
        statusBar={{ branch: 'main', errors: 2, warnings: 3, cursor: 'Ln 1', language: 'TypeScript' }}
      >
        e
      </VSCodeShell>
    );
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Ln 1')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
  });

  it('renders without a status bar object', () => {
    render(<VSCodeShell files={[]} openTabs={[]}>e</VSCodeShell>);
    expect(screen.getByText('Concord')).toBeInTheDocument();
  });
});
