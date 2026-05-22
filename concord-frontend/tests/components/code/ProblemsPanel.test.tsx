import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

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

import { ProblemsPanel } from '@/components/code/ProblemsPanel';

const PROBLEMS = [
  { path: 'a.ts', line: 4, severity: 'error', message: 'bad thing', rule: 'no-bad' },
  { path: 'b.ts', line: 9, severity: 'warning', message: 'meh', rule: 'meh-rule' },
  { path: 'c.ts', line: 1, severity: 'info', message: 'fyi', rule: 'fyi-rule' },
];
const TODOS = [
  { path: 'a.ts', line: 2, tag: 'TODO', text: 'fix this' },
  { path: 'b.ts', line: 7, tag: 'FIXME', text: '' },
];

function mockBoth(problems: unknown[], todos: unknown[]) {
  lensRun.mockImplementation((__a?: { action: string }) => {
    const { action } = __a || { action: "" };
    if (action === 'diagnostics') return Promise.resolve({ data: { ok: true, result: { problems } } });
    return Promise.resolve({ data: { ok: true, result: { todos } } });
  });
}

describe('ProblemsPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders the no-problems empty state', async () => {
    mockBoth([], []);
    render(<ProblemsPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('No problems detected in the workspace.')).toBeInTheDocument()
    );
  });

  it('renders problems of all severities and jumps on click', async () => {
    mockBoth(PROBLEMS, []);
    const onOpen = vi.fn();
    render(<ProblemsPanel projectId="p1" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByText('bad thing')).toBeInTheDocument());
    expect(screen.getByText('meh')).toBeInTheDocument();
    expect(screen.getByText('fyi')).toBeInTheDocument();
    fireEvent.click(screen.getByText('bad thing'));
    expect(onOpen).toHaveBeenCalledWith('a.ts', 4);
  });

  it('switches to the TODOs tab and renders todos', async () => {
    mockBoth(PROBLEMS, TODOS);
    const onOpen = vi.fn();
    render(<ProblemsPanel projectId="p1" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByText('bad thing')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/TODOs/));
    expect(screen.getByText('fix this')).toBeInTheDocument();
    expect(screen.getByText('(no description)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('fix this'));
    expect(onOpen).toHaveBeenCalledWith('a.ts', 2);
  });

  it('shows the empty TODO state', async () => {
    mockBoth([], []);
    render(<ProblemsPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('No problems detected in the workspace.')).toBeInTheDocument()
    );
    fireEvent.click(screen.getByText(/TODOs/));
    expect(screen.getByText('No TODO / FIXME comments found.')).toBeInTheDocument();
  });

  it('rescans on the refresh button', async () => {
    mockBoth(PROBLEMS, TODOS);
    render(<ProblemsPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('bad thing')).toBeInTheDocument());
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Rescan'));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('clears state when projectId is null', async () => {
    render(<ProblemsPanel projectId={null} onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('No problems detected in the workspace.')).toBeInTheDocument()
    );
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('handles a rejected scan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('scan fail')));
    render(<ProblemsPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('No problems detected in the workspace.')).toBeInTheDocument()
    );
  });
});
