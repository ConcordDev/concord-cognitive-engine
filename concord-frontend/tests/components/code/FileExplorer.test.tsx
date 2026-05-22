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

import { FileExplorer } from '@/components/code/FileExplorer';

const TREE = [
  { path: 'src/index.ts', language: 'ts', size: 100, modifiedAt: '2026-01-01' },
  { path: 'README.md', language: 'md', size: 20, modifiedAt: '2026-01-02' },
];

describe('FileExplorer', () => {
  beforeEach(() => {
    lensRun.mockReset();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders the no-project message when projectId is null', () => {
    render(<FileExplorer projectId={null} activePath={null} onOpen={vi.fn()} />);
    expect(screen.getByText('Open a project to see files.')).toBeInTheDocument();
  });

  it('renders an empty tree state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { tree: [] } } });
    render(<FileExplorer projectId="p1" activePath={null} onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Empty.')).toBeInTheDocument());
  });

  it('renders a populated tree and opens a file on click', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { tree: TREE } } });
    const onOpen = vi.fn();
    render(<FileExplorer projectId="p1" activePath="src/index.ts" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByText('src/index.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByText('README.md'));
    expect(onOpen).toHaveBeenCalledWith('README.md');
  });

  it('creates a file via the new-file form', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { tree: [] } } })
      .mockResolvedValueOnce({ data: { ok: true, result: {} } })
      .mockResolvedValueOnce({ data: { ok: true, result: { tree: TREE } } });
    const onOpen = vi.fn();
    const onChanged = vi.fn();
    render(<FileExplorer projectId="p1" activePath={null} onOpen={onOpen} onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByText('Empty.')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('New file'));
    const input = screen.getByPlaceholderText('src/new-file.ts');
    fireEvent.change(input, { target: { value: 'src/new.ts' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('src/new.ts'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('alerts when file create returns ok:false', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { tree: [] } } })
      .mockResolvedValueOnce({ data: { ok: false, error: 'exists' } });
    render(<FileExplorer projectId="p1" activePath={null} onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Empty.')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('New file'));
    fireEvent.change(screen.getByPlaceholderText('src/new-file.ts'), { target: { value: 'dup.ts' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('exists'));
  });

  it('does not create when draft path is blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { tree: [] } } });
    render(<FileExplorer projectId="p1" activePath={null} onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Empty.')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('New file'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('deletes a file after confirm', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { tree: TREE } } })
      .mockResolvedValueOnce({ data: { ok: true, result: {} } })
      .mockResolvedValueOnce({ data: { ok: true, result: { tree: [TREE[1]] } } });
    const onChanged = vi.fn();
    const { container } = render(
      <FileExplorer projectId="p1" activePath={null} onOpen={vi.fn()} onChanged={onChanged} />
    );
    await waitFor(() => expect(screen.getByText('src/index.ts')).toBeInTheDocument());
    const delBtn = container.querySelector('[data-testid="icon-Trash2"]')!.closest('button')!;
    fireEvent.click(delBtn);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('skips delete when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { tree: TREE } } });
    const { container } = render(
      <FileExplorer projectId="p1" activePath={null} onOpen={vi.fn()} />
    );
    await waitFor(() => expect(screen.getByText('src/index.ts')).toBeInTheDocument());
    lensRun.mockClear();
    const delBtn = container.querySelector('[data-testid="icon-Trash2"]')!.closest('button')!;
    fireEvent.click(delBtn);
    expect(lensRun).not.toHaveBeenCalled();
  });
});
