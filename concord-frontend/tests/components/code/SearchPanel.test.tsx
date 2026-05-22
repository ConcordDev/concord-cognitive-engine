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

import { SearchPanel } from '@/components/code/SearchPanel';

const HITS = [{ file: 'a.ts', line: 3, column: 5, preview: 'const a = 1' }];
const REFS = [{ path: 'b.ts', line: 9, snippet: 'foo()' }];

describe('SearchPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders no-project message', () => {
    render(<SearchPanel projectId={null} onOpen={vi.fn()} />);
    expect(screen.getByText('Open a project to search.')).toBeInTheDocument();
  });

  it('shows the type-a-query prompt initially', () => {
    render(<SearchPanel projectId="p1" onOpen={vi.fn()} />);
    expect(screen.getByText('Type a query and press Enter.')).toBeInTheDocument();
  });

  it('runs a text search and renders hits, jumps on click', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { hits: HITS } } });
    const onOpen = vi.fn();
    render(<SearchPanel projectId="p1" onOpen={onOpen} />);
    fireEvent.change(screen.getByPlaceholderText('Search text…'), { target: { value: 'const' } });
    fireEvent.click(screen.getByText('Find'));
    await waitFor(() => expect(screen.getByText('const a = 1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('const a = 1'));
    expect(onOpen).toHaveBeenCalledWith('a.ts', 3);
  });

  it('shows "No matches." when text search returns nothing', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { hits: [] } } });
    render(<SearchPanel projectId="p1" onOpen={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search text…'), { target: { value: 'zzz' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Search text…'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('No matches.')).toBeInTheDocument());
  });

  it('toggles search option buttons', () => {
    render(<SearchPanel projectId="p1" onOpen={vi.fn()} />);
    const caseBtn = screen.getByTestId('icon-CaseSensitive').closest('button')!;
    fireEvent.click(caseBtn);
    fireEvent.click(screen.getByTestId('icon-Regex').closest('button')!);
    fireEvent.click(screen.getByTestId('icon-WholeWord').closest('button')!);
    expect(caseBtn).toBeInTheDocument();
  });

  it('runs a replace via the replace-project macro', async () => {
    lensRun.mockImplementation((__a?: { action: string }) => {
      const { action } = __a || { action: '' };
      if (action === 'replace-project')
        return Promise.resolve({
          data: { ok: true, result: { totalReplacements: 4, filesChanged: 2 } },
        });
      return Promise.resolve({ data: { ok: true, result: { hits: [] } } });
    });
    render(<SearchPanel projectId="p1" onOpen={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Search text…'), { target: { value: 'foo' } });
    fireEvent.click(screen.getByTitle('Toggle replace'));
    fireEvent.change(screen.getByPlaceholderText('Replace with…'), { target: { value: 'bar' } });
    fireEvent.click(screen.getByTitle('Replace all'));
    await waitFor(() =>
      expect(
        lensRun.mock.calls.some(
          ([a]) => a?.action === 'replace-project' && a?.input?.replacement === 'bar'
        )
      ).toBe(true)
    );
  });

  it('switches to references mode and renders refs', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { references: REFS } } });
    const onOpen = vi.fn();
    render(<SearchPanel projectId="p1" onOpen={onOpen} />);
    fireEvent.click(screen.getByText('References'));
    fireEvent.change(screen.getByPlaceholderText('Symbol (word-boundary)…'), {
      target: { value: 'foo' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Symbol (word-boundary)…'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('foo()')).toBeInTheDocument());
    fireEvent.click(screen.getByText('foo()'));
    expect(onOpen).toHaveBeenCalledWith('b.ts', 9);
  });

  it('shows the no-references empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { references: [] } } });
    render(<SearchPanel projectId="p1" onOpen={vi.fn()} />);
    fireEvent.click(screen.getByText('References'));
    fireEvent.change(screen.getByPlaceholderText('Symbol (word-boundary)…'), {
      target: { value: 'xy' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('Symbol (word-boundary)…'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('No references.')).toBeInTheDocument());
  });

  it('renames a symbol via the rename-symbol macro', async () => {
    lensRun.mockImplementation((__a?: { action: string }) => {
    const { action } = __a || { action: "" };
      if (action === 'rename-symbol')
        return Promise.resolve({
          data: { ok: true, result: { totalOccurrences: 7, filesChanged: 3 } },
        });
      return Promise.resolve({ data: { ok: true, result: { references: [] } } });
    });
    render(<SearchPanel projectId="p1" onOpen={vi.fn()} />);
    fireEvent.click(screen.getByText('References'));
    fireEvent.change(screen.getByPlaceholderText('Symbol (word-boundary)…'), {
      target: { value: 'foo' },
    });
    fireEvent.change(screen.getByPlaceholderText('Rename to…'), { target: { value: 'baz' } });
    fireEvent.click(screen.getByTitle('Rename symbol'));
    await waitFor(() =>
      expect(
        lensRun.mock.calls.some(
          ([a]) => a?.action === 'rename-symbol' && a?.input?.to === 'baz'
        )
      ).toBe(true)
    );
  });

  it('shows an error notice when rename returns ok:false', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'rename blocked' } });
    render(<SearchPanel projectId="p1" onOpen={vi.fn()} />);
    fireEvent.click(screen.getByText('References'));
    fireEvent.change(screen.getByPlaceholderText('Symbol (word-boundary)…'), {
      target: { value: 'foo' },
    });
    fireEvent.change(screen.getByPlaceholderText('Rename to…'), { target: { value: 'baz' } });
    fireEvent.click(screen.getByTitle('Rename symbol'));
    await waitFor(() => expect(screen.getByText('rename blocked')).toBeInTheDocument());
  });
});
