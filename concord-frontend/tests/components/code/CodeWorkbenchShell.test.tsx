import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

import { CodeWorkbenchShell, EditorTabs } from '@/components/code/CodeWorkbenchShell';

describe('CodeWorkbenchShell', () => {
  it('renders nav items, side panel and editor', () => {
    render(
      <CodeWorkbenchShell
        activeNav="files"
        onNavChange={vi.fn()}
        sidePanel={<div>SIDE</div>}
        editor={<div>EDITOR</div>}
      />
    );
    expect(screen.getByText('SIDE')).toBeInTheDocument();
    expect(screen.getByText('EDITOR')).toBeInTheDocument();
    expect(screen.getByTitle('Explorer')).toBeInTheDocument();
    expect(screen.getByTitle('Settings')).toBeInTheDocument();
  });

  it('fires onNavChange when a nav button is clicked', () => {
    const onNavChange = vi.fn();
    render(
      <CodeWorkbenchShell
        activeNav="files"
        onNavChange={onNavChange}
        sidePanel={<div />}
        editor={<div />}
      />
    );
    fireEvent.click(screen.getByTitle('Source Control'));
    expect(onNavChange).toHaveBeenCalledWith('git');
  });

  it('renders badges only for non-zero counts', () => {
    render(
      <CodeWorkbenchShell
        activeNav="files"
        onNavChange={vi.fn()}
        badges={{ git: 5, debug: 0 }}
        sidePanel={<div />}
        editor={<div />}
      />
    );
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows branch name in the status bar when provided', () => {
    render(
      <CodeWorkbenchShell
        activeNav="files"
        onNavChange={vi.fn()}
        branch="develop"
        sidePanel={<div />}
        editor={<div />}
      />
    );
    expect(screen.getByText('develop')).toBeInTheDocument();
  });

  it('renders bottom panel only when showBottom is true', () => {
    const { rerender } = render(
      <CodeWorkbenchShell
        activeNav="files"
        onNavChange={vi.fn()}
        sidePanel={<div />}
        editor={<div />}
        bottomPanel={<div>BOTTOM</div>}
        showBottom={false}
      />
    );
    expect(screen.queryByText('BOTTOM')).not.toBeInTheDocument();
    rerender(
      <CodeWorkbenchShell
        activeNav="files"
        onNavChange={vi.fn()}
        sidePanel={<div />}
        editor={<div />}
        bottomPanel={<div>BOTTOM</div>}
        showBottom
      />
    );
    expect(screen.getByText('BOTTOM')).toBeInTheDocument();
  });

  it('toggles the bottom panel via the status bar button', () => {
    const onToggleBottom = vi.fn();
    render(
      <CodeWorkbenchShell
        activeNav="files"
        onNavChange={vi.fn()}
        sidePanel={<div />}
        editor={<div />}
        onToggleBottom={onToggleBottom}
        showBottom={false}
      />
    );
    fireEvent.click(screen.getByText('Show terminal'));
    expect(onToggleBottom).toHaveBeenCalled();
  });

  it('renders "Hide terminal" label when bottom is shown', () => {
    render(
      <CodeWorkbenchShell
        activeNav="files"
        onNavChange={vi.fn()}
        sidePanel={<div />}
        editor={<div />}
        bottomPanel={<div>X</div>}
        onToggleBottom={vi.fn()}
        showBottom
      />
    );
    expect(screen.getByText('Hide terminal')).toBeInTheDocument();
  });

  it('renders statusRight content', () => {
    render(
      <CodeWorkbenchShell
        activeNav="files"
        onNavChange={vi.fn()}
        sidePanel={<div />}
        editor={<div />}
        statusRight={<span>RIGHT</span>}
      />
    );
    expect(screen.getByText('RIGHT')).toBeInTheDocument();
  });
});

describe('EditorTabs', () => {
  it('renders "No file open" when there are no tabs', () => {
    render(<EditorTabs tabs={[]} activePath={null} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('No file open')).toBeInTheDocument();
  });

  it('renders tabs by basename and selects on click', () => {
    const onSelect = vi.fn();
    render(
      <EditorTabs
        tabs={[
          { path: 'src/index.ts', modified: true },
          { path: 'README.md', modified: false },
        ]}
        activePath="src/index.ts"
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('index.ts')).toBeInTheDocument();
    expect(screen.getByText('README.md')).toBeInTheDocument();
    fireEvent.click(screen.getByText('README.md'));
    expect(onSelect).toHaveBeenCalledWith('README.md');
  });

  it('closes a tab without selecting it (stopPropagation path)', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <EditorTabs
        tabs={[{ path: 'a/b.ts', modified: false }]}
        activePath="a/b.ts"
        onSelect={onSelect}
        onClose={onClose}
      />
    );
    const closeBtn = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledWith('a/b.ts');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
