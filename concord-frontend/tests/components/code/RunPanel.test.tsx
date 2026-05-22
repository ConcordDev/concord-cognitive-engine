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

import { RunPanel } from '@/components/code/RunPanel';

const CONFIGS = [{ id: 'c1', name: 'Run tests', command: 'npm test', kind: 'task' }];
const BOOKMARKS = [{ id: 'b1', path: 'src/x.ts', line: 5, label: 'Spot A' }];

function mock(configs: unknown[], bookmarks: unknown[]) {
  lensRun.mockImplementation((__a?: { action: string }) => {
    const { action } = __a || { action: "" };
    if (action === 'run-config-list') return Promise.resolve({ data: { ok: true, result: { configs } } });
    if (action === 'bookmark-list') return Promise.resolve({ data: { ok: true, result: { bookmarks } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('RunPanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders no-project message when projectId is null', () => {
    render(<RunPanel projectId={null} onOpen={vi.fn()} />);
    expect(screen.getByText('Open a project to manage run configs.')).toBeInTheDocument();
  });

  it('renders empty config and bookmark states', async () => {
    mock([], []);
    render(<RunPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('No run configurations yet.')).toBeInTheDocument()
    );
    expect(screen.getByText('No bookmarks. Add them from the editor gutter.')).toBeInTheDocument();
  });

  it('renders populated configs and bookmarks', async () => {
    mock(CONFIGS, BOOKMARKS);
    render(<RunPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Run tests')).toBeInTheDocument());
    expect(screen.getByText('Spot A')).toBeInTheDocument();
  });

  it('adds a run config', async () => {
    mock([], []);
    render(<RunPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('No run configurations yet.')).toBeInTheDocument()
    );
    fireEvent.change(screen.getByPlaceholderText('Config name (e.g. Run tests)'), {
      target: { value: 'Build' },
    });
    fireEvent.change(screen.getByPlaceholderText('command — e.g. npm test'), {
      target: { value: 'npm run build' },
    });
    lensRun.mockClear();
    mock([], []);
    const addBtn = screen
      .getByPlaceholderText('command — e.g. npm test')
      .parentElement!.querySelector('button')!;
    fireEvent.click(addBtn);
    await waitFor(() =>
      expect(
        lensRun.mock.calls.some(([a]) => a?.action === 'run-config-save')
      ).toBe(true)
    );
  });

  it('does not save a config when fields are blank', async () => {
    mock([], []);
    render(<RunPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('No run configurations yet.')).toBeInTheDocument()
    );
    lensRun.mockClear();
    const addBtn = screen
      .getByPlaceholderText('command — e.g. npm test')
      .parentElement!.querySelector('button')!;
    fireEvent.click(addBtn);
    expect(lensRun.mock.calls.some(([a]) => a?.action === 'run-config-save')).toBe(false);
  });

  it('deletes a run config', async () => {
    mock(CONFIGS, []);
    const { container } = render(<RunPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Run tests')).toBeInTheDocument());
    const delBtn = container.querySelector('[data-testid="icon-Trash2"]')!.closest('button')!;
    fireEvent.click(delBtn);
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([a]) => a?.action === 'run-config-delete')).toBe(true)
    );
  });

  it('opens a bookmark and deletes it', async () => {
    mock([], BOOKMARKS);
    const onOpen = vi.fn();
    const { container } = render(<RunPanel projectId="p1" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByText('Spot A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Spot A'));
    expect(onOpen).toHaveBeenCalledWith('src/x.ts', 5);
    const delBtn = container.querySelector('[data-testid="icon-Trash2"]')!.closest('button')!;
    fireEvent.click(delBtn);
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([a]) => a?.action === 'bookmark-delete')).toBe(true)
    );
  });

  it('handles a rejected load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('fail')));
    render(<RunPanel projectId="p1" onOpen={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('No run configurations yet.')).toBeInTheDocument()
    );
  });
});
