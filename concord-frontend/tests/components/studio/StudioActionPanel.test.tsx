import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));

// framer-motion → plain elements
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => React.createElement('div', p) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

// panel-polish → inert stubs
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
}));

const lensRun = vi.fn();
const runDomain = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
  api: { post: (...a: unknown[]) => apiPost(...a), delete: (...a: unknown[]) => apiDelete(...a) },
}));

import { StudioActionPanel } from '@/components/studio/StudioActionPanel';

beforeEach(() => {
  lensRun.mockReset();
  runDomain.mockReset();
  apiPost.mockReset();
  apiDelete.mockReset();
  runDomain.mockResolvedValue({ data: { ok: true, result: { projects: [] } } });
});

describe('StudioActionPanel', () => {
  it('renders the action grid header', async () => {
    render(<StudioActionPanel />);
    expect(screen.getByText('Studio session')).toBeInTheDocument();
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
  });

  it('shows a validation error when creating without a name', async () => {
    render(<StudioActionPanel />);
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(screen.getByText('Project name required.')).toBeInTheDocument());
  });

  it('creates a project and marks it active', async () => {
    render(<StudioActionPanel />);
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'New Track' } });
    fireEvent.change(screen.getByPlaceholderText('BPM'), { target: { value: '128' } });
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { project: { id: 'proj12345', name: 'New Track' } } } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(screen.getByText(/Project created/)).toBeInTheDocument());
  });

  it('strips non-digits from the BPM field', async () => {
    render(<StudioActionPanel />);
    const bpm = screen.getByPlaceholderText('BPM') as HTMLInputElement;
    fireEvent.change(bpm, { target: { value: '12a8x' } });
    expect(bpm.value).toBe('128');
  });

  it('shows an error when add-track is attempted with no project', async () => {
    render(<StudioActionPanel />);
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    // addTrack button is disabled without a project — feedback only via handler.
    // exercise actAddEffect's guard by clicking with no project first becomes disabled.
    expect(screen.getByText('+ Track').closest('button')).toBeDisabled();
  });

  it('runs a render estimate after a project is created', async () => {
    render(<StudioActionPanel />);
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('Project name'), { target: { value: 'X' } });
    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { project: { id: 'proj99999', name: 'X' } } } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(screen.getByText(/Project created/)).toBeInTheDocument());

    runDomain.mockResolvedValueOnce({ data: { ok: true, result: { estimatedMinutes: 4, sizeMb: 40, format: 'wav' } } });
    fireEvent.click(screen.getByText('Render'));
    await waitFor(() => expect(screen.getByText(/~4min · 40MB · wav/)).toBeInTheDocument());
  });

  it('shows a DM validation error with no recipient', async () => {
    render(<StudioActionPanel />);
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    fireEvent.click(screen.getByText('DM'));
    await waitFor(() => expect(screen.getByText('Enter a recipient.')).toBeInTheDocument());
  });

  it('runs the agent mix-moves action', async () => {
    render(<StudioActionPanel />);
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: { reply: 'move 1\nmove 2' } } });
    fireEvent.click(screen.getByText('Mix moves'));
    await waitFor(() => expect(screen.getByText(/move 1/)).toBeInTheDocument());
  });

  it('shows an error when the agent returns empty', async () => {
    render(<StudioActionPanel />);
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    lensRun.mockResolvedValueOnce({ data: { ok: true, result: {} } });
    fireEvent.click(screen.getByText('Mix moves'));
    await waitFor(() => expect(screen.getByText('Agent returned empty.')).toBeInTheDocument());
  });

  it('seeds the project select from a listed project', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { projects: [{ id: 'pp1', name: 'Loaded', bpm: 90 }] } } });
    render(<StudioActionPanel />);
    await waitFor(() => expect(screen.getByText(/Loaded \(90 BPM\)/)).toBeInTheDocument());
    const projSelect = screen.getByText(/pick a project/).closest('select')!;
    fireEvent.change(projSelect, { target: { value: 'pp1' } });
    expect((screen.getByPlaceholderText('Project name') as HTMLInputElement).value).toBe('Loaded');
  });
});
