// UX-state + a11y pin for the Tools lens components (WebResearchTool,
// CompileTool, ESignatureTool). Asserts the four required states render with
// the correct accessibility roles:
//   • empty      — a dashed/empty placeholder before any action
//   • loading    — role="status" while a macro call is in flight
//   • error      — role="alert" + a "Retry" button when a macro fails
//   • populated  — real result content after a successful macro call
//
// lensRun is mocked so the test is hermetic (no backend, no network).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { WebResearchTool } from '@/components/tools/WebResearchTool';
import { CompileTool } from '@/components/tools/CompileTool';
import { ESignatureTool } from '@/components/tools/ESignatureTool';

// A controllable deferred so we can hold a call "in flight" to assert loading.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => lensRun.mockReset());

describe('WebResearchTool — four UX states', () => {
  it('renders the empty state before any search', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { history: [], total: 0 } } });
    render(<WebResearchTool />);
    expect(await screen.findByText(/Search the live web across DuckDuckGo/i)).toBeInTheDocument();
  });

  it('shows a role=status loader while searching, then populated results', async () => {
    // default: any unmatched call (e.g. the post-success history reload) resolves empty
    lensRun.mockResolvedValue({ data: { ok: true, result: { history: [], total: 0 } } });
    // history load resolves immediately, the search is held in flight
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { history: [], total: 0 } } });
    const d = deferred<{ data: unknown }>();
    lensRun.mockReturnValueOnce(d.promise);

    render(<WebResearchTool />);
    const input = await screen.findByLabelText('Web query');
    fireEvent.change(input, { target: { value: 'concord' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // loading state with role=status
    expect(await screen.findByRole('status')).toHaveTextContent(/Searching/i);

    // resolve the search → populated
    d.resolve({ data: { ok: true, result: {
      query: 'concord', abstract: null, count: 1, sources: ['Wikipedia'],
      results: [{ title: 'Concord', snippet: 'a place', url: 'https://x', source: 'Wikipedia' }],
    } } });
    expect(await screen.findByText(/1 results for/i)).toBeInTheDocument();
    expect(screen.getByText('Concord')).toBeInTheDocument();
  });

  it('shows a role=alert error with a Retry button when the search fails', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { history: [], total: 0 } } });
    lensRun.mockResolvedValueOnce({ data: { ok: false, error: 'no results' } });

    render(<WebResearchTool />);
    const input = await screen.findByLabelText('Web query');
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no results/i);
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
});

describe('CompileTool — four UX states', () => {
  it('renders the empty state before compiling', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { history: [], total: 0 } } });
    render(<CompileTool />);
    expect(await screen.findByText(/output appears here/i)).toBeInTheDocument();
  });

  it('shows role=status loader then populated output', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { history: [], total: 0 } } });
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { history: [], total: 0 } } });
    const d = deferred<{ data: unknown }>();
    lensRun.mockReturnValueOnce(d.promise);

    render(<CompileTool />);
    fireEvent.click(await screen.findByRole('button', { name: /Compile/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Compiling/i);

    d.resolve({ data: { ok: true, result: {
      code: 'const x = 1;', map: null, warnings: [], engine: 'strip-types-fallback',
      target: 'es2022', loader: 'ts', format: 'esm', minify: false, sourcemap: false,
      durationMs: 2, inputBytes: 10, outputBytes: 10,
    } } });
    expect(await screen.findByText('strip-types-fallback')).toBeInTheDocument();
  });

  it('shows role=alert error with Retry on compile failure', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { history: [], total: 0 } } });
    lensRun.mockResolvedValueOnce({ data: { ok: false, error: 'compile error: bad syntax' } });

    render(<CompileTool />);
    fireEvent.click(await screen.findByRole('button', { name: /Compile/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/compile error/i);
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
});

describe('ESignatureTool — four UX states', () => {
  it('renders the empty envelope state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { envelopes: [], total: 0 } } });
    render(<ESignatureTool />);
    expect(await screen.findByText(/No envelopes yet/i)).toBeInTheDocument();
  });

  it('renders populated envelopes from the list', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { envelopes: [
      { id: 'e1', number: 'ENV-00001', title: 'Mutual NDA', status: 'out_for_signature',
        documentHash: 'a'.repeat(64), parties: [], signedCount: 0, partyCount: 2,
        createdAt: '2026-01-01', completedAt: null },
    ], total: 1 } } });
    render(<ESignatureTool />);
    expect(await screen.findByText('Mutual NDA')).toBeInTheDocument();
    expect(screen.getByText('ENV-00001')).toBeInTheDocument();
  });

  it('shows role=alert error with Retry when a create fails', async () => {
    // initial list ok (empty), then the create call fails
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { envelopes: [], total: 0 } } });
    render(<ESignatureTool />);

    // switch to create view and submit with valid-looking fields
    fireEvent.click(await screen.findByRole('button', { name: /New envelope/i }));
    fireEvent.change(screen.getByLabelText('Envelope title'), { target: { value: 'NDA' } });
    fireEvent.change(screen.getByLabelText('Document text'), { target: { value: 'binds' } });
    fireEvent.change(screen.getByLabelText('Party 1 name'), { target: { value: 'Alice' } });

    lensRun.mockResolvedValueOnce({ data: { ok: false, error: 'create failed' } });
    fireEvent.click(screen.getByRole('button', { name: /Route for signature/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/create failed/i);
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('shows a role=status loader while a create call is in flight', async () => {
    // initial list resolves empty
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { envelopes: [], total: 0 } } });
    render(<ESignatureTool />);

    fireEvent.click(await screen.findByRole('button', { name: /New envelope/i }));
    fireEvent.change(screen.getByLabelText('Envelope title'), { target: { value: 'NDA' } });
    fireEvent.change(screen.getByLabelText('Document text'), { target: { value: 'binds' } });
    fireEvent.change(screen.getByLabelText('Party 1 name'), { target: { value: 'Alice' } });

    // hold the create call in flight → busy=true → loader shown
    const d = deferred<{ data: unknown }>();
    lensRun.mockReturnValueOnce(d.promise);
    fireEvent.click(screen.getByRole('button', { name: /Route for signature/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Working/i);
    d.resolve({ data: { ok: true, result: { envelope: {
      id: 'e1', number: 'ENV-00001', title: 'NDA', document: 'binds', documentHash: 'a'.repeat(64),
      status: 'out_for_signature', parties: [], audit: [], createdAt: '2026-01-01', completedAt: null,
      esignDisclosure: 'x',
    } } } });
    // after resolution, list reload also resolves
    lensRun.mockResolvedValue({ data: { ok: true, result: { envelopes: [], total: 0 } } });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });
});
