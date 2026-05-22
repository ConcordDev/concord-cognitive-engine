import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const runDomain = vi.fn();
const lensRun = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: {
    post: (...a: unknown[]) => apiPost(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
  },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

// usePipe / useRecallableAction / RecallSlot stubs — exercise run() but
// keep them deterministic.
const pipePublish = vi.fn();
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: pipePublish }),
  useRecallableAction: () => ({
    run: async (fn: () => Promise<unknown>) => fn(),
  }),
  RecallSlot: () => React.createElement('div', { 'data-testid': 'recall-slot' }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
        const { initial: _i, animate: _a, exit: _e, transition: _t2, ...rest } = props;
        void _i; void _a; void _e; void _t2;
        return React.createElement(tag, rest, props.children);
      },
    }
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
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

import { CodeActionPanel } from '@/components/code/CodeActionPanel';

function typeCode(value = 'function f(){ return 1; }') {
  const ta = document.querySelector('textarea') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value } });
}

describe('CodeActionPanel', () => {
  beforeEach(() => {
    runDomain.mockReset();
    lensRun.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
    pipePublish.mockReset();
  });

  it('renders the workbench header and action buttons', () => {
    render(<CodeActionPanel />);
    expect(screen.getByText('Code review workbench')).toBeInTheDocument();
    expect(screen.getByText('Complexity')).toBeInTheDocument();
    expect(screen.getByText('Refactor')).toBeInTheDocument();
  });

  it('shows an error when running an action without code', async () => {
    render(<CodeActionPanel />);
    fireEvent.click(screen.getByText('Complexity'));
    await waitFor(() => expect(screen.getByText('Paste code.')).toBeInTheDocument());
  });

  it('runs complexity analysis and renders the result card', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: { ok: true, result: { cyclomatic: 4, cognitive: 2, lines: 10, functions: 1, risk: 'high' } },
      },
    });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Complexity'));
    await waitFor(() => expect(screen.getByText('Cyclomatic: 4.')).toBeInTheDocument());
    expect(screen.getByText(/Complexity high/)).toBeInTheDocument();
    expect(pipePublish).toHaveBeenCalled();
  });

  it('surfaces an error envelope from complexity', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'bad code' } } });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Complexity'));
    await waitFor(() => expect(screen.getByText('bad code')).toBeInTheDocument());
  });

  it('runs the deps audit and renders the deps card', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { ok: true, result: { total: 8, outdated: 2, security: 1, riskScore: 5 } } },
    });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Deps audit'));
    await waitFor(() => expect(screen.getByText('Deps: 8, 2 outdated.')).toBeInTheDocument());
    expect(screen.getByText('Dependencies')).toBeInTheDocument();
  });

  it('runs the coverage analysis and renders the coverage card', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: { ok: true, result: { coveragePct: 90, uncoveredLines: 3, totalLines: 30, band: 'high' } },
      },
    });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Coverage'));
    await waitFor(() => expect(screen.getByText('Coverage: 90%.')).toBeInTheDocument());
    expect(screen.getByText('90%')).toBeInTheDocument();
  });

  it('takes a snapshot', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { ok: true, result: { snapshotId: 'snap1234abcd' } } },
    });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Commit'));
    await waitFor(() => expect(screen.getByText(/Snapshot snap1234/)).toBeInTheDocument());
  });

  it('requires a snippet name before saving a snippet', async () => {
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Save snippet'));
    await waitFor(() =>
      expect(screen.getByText('Snippet name + code required.')).toBeInTheDocument()
    );
  });

  it('saves a named snippet', async () => {
    runDomain.mockResolvedValue({
      data: { ok: true, result: { ok: true, result: { id: 'snip5678efgh' } } },
    });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.change(screen.getByPlaceholderText('Snippet name'), {
      target: { value: 'My snippet' },
    });
    fireEvent.click(screen.getByText('Save snippet'));
    await waitFor(() => expect(screen.getByText(/Snippet saved snip5678/)).toBeInTheDocument());
  });

  it('mints a private review DTU', async () => {
    lensRun.mockResolvedValue({ data: { result: { dtu: { id: 'dtuabcdef1234' } } } });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Mint'));
    await waitFor(() => expect(screen.getByText(/Review DTU dtuabcd/)).toBeInTheDocument());
  });

  it('requires a reviewer before DM', async () => {
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('DM reviewer'));
    await waitFor(() => expect(screen.getByText('Enter a reviewer.')).toBeInTheDocument());
  });

  it('sends a DM to a reviewer', async () => {
    apiPost.mockResolvedValue({ data: { ok: true, message: { id: 'msg1' } } });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.change(screen.getByPlaceholderText('Reviewer user id'), {
      target: { value: 'reviewer-1' },
    });
    fireEvent.click(screen.getByText('DM reviewer'));
    await waitFor(() =>
      expect(screen.getByText(/Sent to reviewer-1/)).toBeInTheDocument()
    );
  });

  it('publishes a public gist', async () => {
    lensRun.mockResolvedValue({ data: { result: { dtu: { id: 'gist99887766' } } } });
    apiPost.mockResolvedValue({ data: { ok: true } });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Publish gist'));
    await waitFor(() => expect(screen.getByText(/Gist published gist9988/)).toBeInTheDocument());
  });

  it('runs the refactor agent and shows the proposals', async () => {
    lensRun.mockResolvedValue({ data: { result: { reply: '1. extract helper' } } });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Refactor'));
    await waitFor(() => expect(screen.getByText('3 refactors ready.')).toBeInTheDocument());
    expect(screen.getByText('Refactor proposals')).toBeInTheDocument();
  });

  it('reports an empty agent reply', async () => {
    lensRun.mockResolvedValue({ data: { result: {} } });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Refactor'));
    await waitFor(() => expect(screen.getByText('Agent returned empty.')).toBeInTheDocument());
  });

  it('catches a thrown error and shows the message', async () => {
    runDomain.mockRejectedValue({ message: 'network down' });
    render(<CodeActionPanel />);
    typeCode();
    fireEvent.click(screen.getByText('Complexity'));
    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
  });

  it('changes the language select', () => {
    render(<CodeActionPanel />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'python' } });
    expect((select as HTMLSelectElement).value).toBe('python');
  });
});
