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

import { OutlinePanel } from '@/components/code/OutlinePanel';

const SYMBOLS = [
  { name: 'MyClass', kind: 'class', line: 3 },
  { name: 'helper', kind: 'function', line: 12 },
  { name: 'IThing', kind: 'interface', line: 20 },
  { name: 'odd', kind: 'mystery', line: 30 },
];

describe('OutlinePanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('shows the open-a-file prompt when path is null', async () => {
    render(<OutlinePanel projectId="p1" path={null} onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('Open a file to see its outline.')).toBeInTheDocument()
    );
  });

  it('shows "No symbols found." for an empty result', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { symbols: [] } } });
    render(<OutlinePanel projectId="p1" path="a.ts" onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No symbols found.')).toBeInTheDocument());
  });

  it('renders symbols of varying kinds and jumps on click', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { symbols: SYMBOLS } } });
    const onOpen = vi.fn();
    render(<OutlinePanel projectId="p1" path="a.ts" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByText('MyClass')).toBeInTheDocument());
    expect(screen.getByText('helper')).toBeInTheDocument();
    expect(screen.getByText('odd')).toBeInTheDocument(); // unknown-kind fallback branch
    expect(
      screen.getByText((_, el) => el?.textContent === 'Outline · 4')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('helper'));
    expect(onOpen).toHaveBeenCalledWith('a.ts', 12);
  });

  it('handles a rejected outline fetch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('parse fail')));
    render(<OutlinePanel projectId="p1" path="a.ts" onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('No symbols found.')).toBeInTheDocument());
  });

  it('renders the empty-symbols state when projectId is null but a path is set', async () => {
    render(<OutlinePanel projectId={null} path="a.ts" onOpen={vi.fn()} />);
    // refresh short-circuits on null projectId → symbols stay empty
    await waitFor(() => expect(screen.getByText('No symbols found.')).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalled();
  });
});
