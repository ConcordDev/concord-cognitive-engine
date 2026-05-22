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

import { GitPanel } from '@/components/code/GitPanel';

const dirtyStatus = {
  branch: 'main',
  branches: ['main', 'feature'],
  modified: ['src/a.ts'],
  staged: ['src/b.ts'],
  head: 'abc',
  clean: false,
};
const cleanStatus = {
  branch: 'main',
  branches: ['main'],
  modified: [],
  staged: [],
  head: 'abc',
  clean: true,
};
const LOG = [
  {
    id: 'commit123456789',
    number: '#1',
    message: 'first',
    branch: 'main',
    committedAt: '2026-01-01T10:00:00Z',
    paths: ['a.ts'],
  },
];
const STASHES = [
  { id: 's1', message: 'WIP', branch: 'main', createdAt: '2026-01-01', fileCount: 2 },
];

function mockGit(status: unknown, log: unknown[], stashes: unknown[], extra?: (action: string) => unknown) {
  lensRun.mockImplementation((__a?: { action: string }) => {
    const { action } = __a || { action: "" };
    if (action === 'git-status') return Promise.resolve({ data: { ok: true, result: status } });
    if (action === 'git-log') return Promise.resolve({ data: { ok: true, result: { log } } });
    if (action === 'git-stash-list')
      return Promise.resolve({ data: { ok: true, result: { stashes } } });
    if (extra) return Promise.resolve(extra(action));
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('GitPanel', () => {
  beforeEach(() => {
    lensRun.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders no-project message', () => {
    render(<GitPanel projectId={null} />);
    expect(screen.getByText('Open a project to use source control.')).toBeInTheDocument();
  });

  it('renders staged + modified sections and branches', async () => {
    mockGit(dirtyStatus, LOG, []);
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('src/b.ts')).toBeInTheDocument());
    expect(screen.getByText('src/a.ts')).toBeInTheDocument();
    expect(screen.getByText('feature')).toBeInTheDocument();
    expect(screen.getByText('first')).toBeInTheDocument();
  });

  it('shows clean working tree when status.clean is true', async () => {
    mockGit(cleanStatus, [], []);
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Working tree clean')).toBeInTheDocument());
  });

  it('commits when a message is typed and staged files exist', async () => {
    mockGit(dirtyStatus, LOG, []);
    const onChanged = vi.fn();
    render(<GitPanel projectId="p1" onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByText('src/b.ts')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Commit message'), {
      target: { value: 'my commit' },
    });
    fireEvent.click(screen.getByText(/^Commit/));
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([a]) => a?.action === 'git-commit')).toBe(true)
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it('stages a modified file via its row button', async () => {
    mockGit(dirtyStatus, LOG, []);
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('+ Stage all')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ Stage all'));
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([a]) => a?.action === 'git-stage')).toBe(true)
    );
  });

  it('discards a modified file after confirm', async () => {
    mockGit(dirtyStatus, LOG, []);
    const { container } = render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('src/a.ts')).toBeInTheDocument());
    const undo = container.querySelector('[data-testid="icon-Undo2"]')!.closest('button')!;
    fireEvent.click(undo);
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([a]) => a?.action === 'git-discard')).toBe(true)
    );
  });

  it('opens a diff modal and closes it', async () => {
    mockGit(dirtyStatus, LOG, [], (action) => {
      if (action === 'git-diff')
        return {
          data: {
            ok: true,
            result: {
              hunks: [
                { type: 'add', text: 'new line' },
                { type: 'del', text: 'old line' },
                { type: 'context', text: 'ctx' },
              ],
            },
          },
        };
      return { data: { ok: true, result: {} } };
    });
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('src/b.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByText('src/b.ts'));
    await waitFor(() => expect(screen.getByText('new line')).toBeInTheDocument());
    expect(screen.getByText('old line')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('icon-X').closest('button')!);
    await waitFor(() => expect(screen.queryByText('new line')).not.toBeInTheDocument());
  });

  it('renders an empty-diff state', async () => {
    mockGit(dirtyStatus, LOG, [], (action) => {
      if (action === 'git-diff') return { data: { ok: true, result: { hunks: [] } } };
      return { data: { ok: true, result: {} } };
    });
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('src/b.ts')).toBeInTheDocument());
    fireEvent.click(screen.getByText('src/b.ts'));
    await waitFor(() => expect(screen.getByText('No changes vs HEAD.')).toBeInTheDocument());
  });

  it('creates a branch', async () => {
    mockGit(dirtyStatus, LOG, []);
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('feature')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('new-branch'), {
      target: { value: 'topic' },
    });
    fireEvent.click(screen.getByTestId('icon-Plus').closest('button')!);
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([a]) => a?.action === 'git-branch-create')).toBe(true)
    );
  });

  it('checks out and merges another branch', async () => {
    mockGit(dirtyStatus, LOG, [], (action) => {
      if (action === 'git-merge') return { data: { ok: true, result: { filesChanged: 3 } } };
      return { data: { ok: true, result: {} } };
    });
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('feature')).toBeInTheDocument());
    fireEvent.click(screen.getByText('checkout'));
    fireEvent.click(screen.getByText('merge'));
    await waitFor(() =>
      expect(screen.getByText(/Merged 'feature'/)).toBeInTheDocument()
    );
  });

  it('stashes all changes and pops a stash', async () => {
    mockGit(dirtyStatus, LOG, STASHES, (action) => {
      if (action === 'git-stash') return { data: { ok: true, result: { stashedFiles: 5 } } };
      return { data: { ok: true, result: {} } };
    });
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('WIP')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Stash'));
    await waitFor(() => expect(screen.getByText('Stashed 5 file(s).')).toBeInTheDocument());
    fireEvent.click(screen.getByText('pop'));
    await waitFor(() =>
      expect(lensRun.mock.calls.some(([a]) => a?.action === 'git-stash-pop')).toBe(true)
    );
  });

  it('shows a notice when a git action returns ok:false and dismisses it', async () => {
    mockGit(dirtyStatus, LOG, [], (action) => {
      if (action === 'git-commit') return { data: { ok: false, error: 'commit rejected' } };
      return { data: { ok: true, result: {} } };
    });
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('src/b.ts')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Commit message'), {
      target: { value: 'bad commit' },
    });
    fireEvent.click(screen.getByText(/^Commit/));
    await waitFor(() => expect(screen.getByText('commit rejected')).toBeInTheDocument());
    const dismiss = screen.getByText('commit rejected').parentElement!.querySelector('button')!;
    fireEvent.click(dismiss);
    await waitFor(() =>
      expect(screen.queryByText('commit rejected')).not.toBeInTheDocument()
    );
  });

  it('handles a rejected refresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('git down')));
    render(<GitPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Loading…')).toBeInTheDocument());
  });
});
