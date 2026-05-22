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

import { AgentComposerPanel } from '@/components/code/AgentComposerPanel';

const TASKS = [
  {
    id: 't1',
    number: '#1',
    projectId: 'p1',
    prompt: 'Add tests',
    status: 'running',
    startedAt: '2026-01-01',
    finishedAt: null,
    plan: [{ action: 'edit', summary: 'patch auth.ts' }],
    filesChanged: ['auth.ts'],
    source: 'brain',
  },
  {
    id: 't2',
    number: '#2',
    projectId: 'p2',
    prompt: 'other project task',
    status: 'completed',
    startedAt: '2026-01-01',
    finishedAt: '2026-01-02',
    plan: [],
    filesChanged: [],
    source: 'user',
  },
];

describe('AgentComposerPanel', () => {
  beforeEach(() => {
    lensRun.mockReset();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('renders the open-a-project hint when projectId is null', () => {
    render(<AgentComposerPanel projectId={null} />);
    expect(screen.getByText('Open a project to use the agent.')).toBeInTheDocument();
  });

  it('renders an empty task list', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { tasks: [] } } });
    render(<AgentComposerPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tasks yet.')).toBeInTheDocument());
  });

  it('filters tasks to the active project', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { tasks: TASKS } } });
    render(<AgentComposerPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Add tests')).toBeInTheDocument());
    expect(screen.queryByText('other project task')).not.toBeInTheDocument();
    expect(screen.getByText('patch auth.ts')).toBeInTheDocument();
    expect(screen.getByText(/Files changed: auth.ts/)).toBeInTheDocument();
    expect(screen.getByText('· brain')).toBeInTheDocument();
  });

  it('starts a new task and clears the prompt', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { tasks: [] } } })
      .mockResolvedValueOnce({ data: { ok: true, result: {} } })
      .mockResolvedValueOnce({ data: { ok: true, result: { tasks: TASKS } } });
    render(<AgentComposerPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tasks yet.')).toBeInTheDocument());
    const ta = screen.getByPlaceholderText(/Describe a multi-file task/);
    fireEvent.change(ta, { target: { value: 'Refactor auth' } });
    fireEvent.click(screen.getByText('Compose'));
    await waitFor(() => expect(screen.getByText('Add tests')).toBeInTheDocument());
    expect((ta as HTMLTextAreaElement).value).toBe('');
  });

  it('alerts when start returns ok:false', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { tasks: [] } } })
      .mockResolvedValueOnce({ data: { ok: false, error: 'no quota' } });
    render(<AgentComposerPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tasks yet.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Describe a multi-file task/), {
      target: { value: 'task' },
    });
    fireEvent.click(screen.getByText('Compose'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('no quota'));
  });

  it('does not start with an empty prompt (button disabled)', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { tasks: [] } } });
    render(<AgentComposerPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tasks yet.')).toBeInTheDocument());
    expect(screen.getByText('Compose').closest('button')).toBeDisabled();
  });

  it('finishes a running task as completed', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { tasks: TASKS } } })
      .mockResolvedValueOnce({ data: { ok: true, result: {} } })
      .mockResolvedValueOnce({ data: { ok: true, result: { tasks: TASKS } } });
    render(<AgentComposerPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    fireEvent.click(screen.getByText('done'));
    await waitFor(() =>
      expect(
        lensRun.mock.calls.some(([a]) => a?.action === 'agent-task-finish')
      ).toBe(true)
    );
  });

  it('finishes a running task as cancelled', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: true, result: { tasks: TASKS } } })
      .mockResolvedValue({ data: { ok: true, result: { tasks: TASKS } } });
    render(<AgentComposerPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('cancel')).toBeInTheDocument());
    fireEvent.click(screen.getByText('cancel'));
    await waitFor(() =>
      expect(
        lensRun.mock.calls.filter(([a]) => a?.action === 'agent-task-finish').length
      ).toBeGreaterThan(0)
    );
  });

  it('handles a rejected list load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockImplementation((__a?: unknown) => __a === undefined ? Promise.resolve({ data: { ok: true, result: {} } }) : Promise.reject(new Error('list fail')));
    render(<AgentComposerPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tasks yet.')).toBeInTheDocument());
  });
});
