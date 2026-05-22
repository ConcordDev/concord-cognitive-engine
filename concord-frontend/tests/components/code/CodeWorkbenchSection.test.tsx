import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Stub each child so the test focuses on CodeWorkbenchSection's own wiring.
vi.mock('@/components/code/ProjectSwitcher', () => ({
  ProjectSwitcher: ({ onChange }: { onChange: (id: string) => void }) =>
    React.createElement(
      'button',
      { 'data-testid': 'pick-project', onClick: () => onChange('p1') },
      'pick project'
    ),
}));
vi.mock('@/components/code/FileExplorer', () => ({
  FileExplorer: ({ onOpen }: { onOpen: (p: string) => void }) =>
    React.createElement(
      'button',
      { 'data-testid': 'open-file', onClick: () => onOpen('src/a.ts') },
      'file explorer'
    ),
}));
vi.mock('@/components/code/OutlinePanel', () => ({
  OutlinePanel: () => React.createElement('div', { 'data-testid': 'outline' }, 'outline'),
}));
vi.mock('@/components/code/SearchPanel', () => ({
  SearchPanel: () => React.createElement('div', { 'data-testid': 'search' }, 'search'),
}));
vi.mock('@/components/code/GitPanel', () => ({
  GitPanel: () => React.createElement('div', { 'data-testid': 'git' }, 'git'),
}));
vi.mock('@/components/code/AgentComposerPanel', () => ({
  AgentComposerPanel: () => React.createElement('div', { 'data-testid': 'agent' }, 'agent'),
}));
vi.mock('@/components/code/RunPanel', () => ({
  RunPanel: () => React.createElement('div', { 'data-testid': 'run' }, 'run'),
}));
vi.mock('@/components/code/ProblemsPanel', () => ({
  ProblemsPanel: () => React.createElement('div', { 'data-testid': 'problems' }, 'problems'),
}));
vi.mock('@/components/code/EditorPane', () => ({
  EditorPane: () => React.createElement('div', { 'data-testid': 'editor' }, 'editor'),
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

import { CodeWorkbenchSection } from '@/components/code/CodeWorkbenchSection';

describe('CodeWorkbenchSection', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('renders the files nav by default with explorer + outline + editor', () => {
    render(<CodeWorkbenchSection />);
    expect(screen.getByTestId('open-file')).toBeInTheDocument();
    expect(screen.getByTestId('outline')).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toBeInTheDocument();
  });

  it('switches to the search nav', () => {
    render(<CodeWorkbenchSection />);
    fireEvent.click(screen.getByTitle('Search'));
    expect(screen.getByTestId('search')).toBeInTheDocument();
  });

  it('switches to the git nav', () => {
    render(<CodeWorkbenchSection />);
    fireEvent.click(screen.getByTitle('Source Control'));
    expect(screen.getByTestId('git')).toBeInTheDocument();
  });

  it('switches to the agent nav', () => {
    render(<CodeWorkbenchSection />);
    fireEvent.click(screen.getByTitle('Agent'));
    expect(screen.getByTestId('agent')).toBeInTheDocument();
  });

  it('switches to the debug nav', () => {
    render(<CodeWorkbenchSection />);
    fireEvent.click(screen.getByTitle('Run & Debug'));
    expect(screen.getByTestId('run')).toBeInTheDocument();
  });

  it('switches to the settings nav with the BYOK hint', () => {
    render(<CodeWorkbenchSection />);
    fireEvent.click(screen.getByTitle('Settings'));
    expect(screen.getByText(/BYOK model selector/)).toBeInTheDocument();
  });

  it('refreshes git + diagnostics status when a project is picked', async () => {
    lensRun.mockImplementation((__a?: { action: string }) => {
    const { action } = __a || { action: "" };
      if (action === 'git-status')
        return Promise.resolve({
          data: { ok: true, result: { branch: 'dev', modified: ['a'], staged: ['b'] } },
        });
      if (action === 'diagnostics')
        return Promise.resolve({
          data: { ok: true, result: { bySeverity: { error: 2, warning: 1 } } },
        });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<CodeWorkbenchSection />);
    fireEvent.click(screen.getByTestId('pick-project'));
    await waitFor(() => expect(screen.getByText('dev')).toBeInTheDocument());
    // modified+staged = 2 → "2 changes" in statusRight
    expect(screen.getByText('2 changes')).toBeInTheDocument();
  });

  it('toggles the bottom problems panel from the status bar', () => {
    render(<CodeWorkbenchSection />);
    fireEvent.click(screen.getByText('Show terminal'));
    expect(screen.getByTestId('problems')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Hide terminal'));
    expect(screen.queryByTestId('problems')).not.toBeInTheDocument();
  });

  it('tolerates a rejected status refresh', async () => {
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('status fail')));
    render(<CodeWorkbenchSection />);
    fireEvent.click(screen.getByTestId('pick-project'));
    await waitFor(() => expect(screen.getByTestId('editor')).toBeInTheDocument());
  });
});
