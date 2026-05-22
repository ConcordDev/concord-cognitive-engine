import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_t, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t2, layout: _l, ...rest } = props;
      void _i; void _a; void _e; void _t2; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

const runDomain = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    post: (...a: unknown[]) => apiPost(...a),
    delete: (...a: unknown[]) => apiDelete(...a),
  },
  apiHelpers: {
    lens: { runDomain: (...a: unknown[]) => runDomain(...a) },
  },
}));

const pipePublish = vi.fn();
const recallRun = vi.fn(async (op: () => Promise<unknown>) => op());
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: pipePublish }),
  useRecallableAction: () => ({
    run: (op: () => Promise<unknown>) => recallRun(op),
    status: 'idle', label: 'x', token: null, remainingMs: 0, windowMs: 0,
    error: null, recall: vi.fn(), dismiss: vi.fn(),
  }),
  RecallSlot: () => React.createElement('span', { 'data-testid': 'recall-slot' }),
}));

import { ExperimentActionPanel } from '@/components/science/ExperimentActionPanel';

beforeEach(() => {
  runDomain.mockReset();
  apiPost.mockReset();
  apiDelete.mockReset();
  pipePublish.mockReset();
  recallRun.mockClear();
});

function setName(value = 'BL21 expression') {
  fireEvent.change(screen.getByPlaceholderText(/BL21 expression/), { target: { value } });
}

describe('ExperimentActionPanel', () => {
  it('renders the workbench header and inputs', () => {
    render(<ExperimentActionPanel />);
    expect(screen.getByText('Experiment workbench')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/BL21 expression/)).toBeInTheDocument();
  });

  it('errors when calibration runs with no instruments', async () => {
    render(<ExperimentActionPanel />);
    // calibration button is disabled with no instruments; add an instrument then clear
    fireEvent.change(screen.getByPlaceholderText(/NanoDrop/), { target: { value: 'NanoDrop' } });
    fireEvent.change(screen.getByPlaceholderText(/NanoDrop/), { target: { value: '' } });
    const calBtn = screen.getByRole('button', { name: /Calibration/ });
    expect(calBtn).toBeDisabled();
  });

  it('runs a calibration check (populated result envelope)', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: {
      ok: true, result: { status: 'calibrated', message: 'all instruments OK' },
    } } });
    render(<ExperimentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/NanoDrop/), { target: { value: 'NanoDrop\nBioTek' } });
    fireEvent.click(screen.getByRole('button', { name: /Calibration/ }));
    await waitFor(() => expect(screen.getByText('Calibration checked.')).toBeInTheDocument());
    expect(screen.getByText('all instruments OK')).toBeInTheDocument();
    expect(pipePublish).toHaveBeenCalledWith('science.calibration', expect.any(Object), expect.any(Object));
  });

  it('shows error feedback when a calibration macro returns ok:false', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'cal broke' } } });
    render(<ExperimentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/NanoDrop/), { target: { value: 'NanoDrop' } });
    fireEvent.click(screen.getByRole('button', { name: /Calibration/ }));
    await waitFor(() => expect(screen.getByText('cal broke')).toBeInTheDocument());
  });

  it('shows error feedback when the macro request throws', async () => {
    runDomain.mockRejectedValue({ response: { data: { error: 'network down' } } });
    render(<ExperimentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/NanoDrop/), { target: { value: 'NanoDrop' } });
    fireEvent.click(screen.getByRole('button', { name: /Calibration/ }));
    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
  });

  it('validates a protocol and renders the result pane with issues', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: {
      ok: true, result: { status: 'has-issues', issues: ['missing control', 'no timing'] },
    } } });
    render(<ExperimentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Inoculate/), { target: { value: '1. step one\n2. step two' } });
    fireEvent.click(screen.getByRole('button', { name: /Validate/ }));
    await waitFor(() => expect(screen.getByText('Protocol validated.')).toBeInTheDocument());
    expect(screen.getByText('missing control')).toBeInTheDocument();
  });

  it('runs a data-quality report on samples', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: {
      ok: true, result: { status: 'ok', notes: 'looks good' },
    } } });
    render(<ExperimentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/S-001/), { target: { value: 'S-001\nS-002' } });
    fireEvent.click(screen.getByRole('button', { name: /Data quality/ }));
    await waitFor(() => expect(screen.getByText('Quality report ready.')).toBeInTheDocument());
    expect(screen.getByText('looks good')).toBeInTheDocument();
  });

  it('runs a chain-of-custody check and renders a raw-json pane', async () => {
    runDomain.mockResolvedValue({ data: { ok: true, result: {
      ok: true, result: { foo: 'bar' },
    } } });
    render(<ExperimentActionPanel />);
    fireEvent.change(screen.getByPlaceholderText(/S-001/), { target: { value: 'S-001' } });
    fireEvent.click(screen.getByRole('button', { name: /Chain custody/ }));
    await waitFor(() => expect(screen.getByText('Chain of custody ready.')).toBeInTheDocument());
  });

  it('mints an experiment DTU when a name is entered', async () => {
    apiPost.mockResolvedValue({ data: { result: { dtu: { id: 'dtu-abcdef123456' } } } });
    render(<ExperimentActionPanel />);
    setName();
    fireEvent.click(screen.getByRole('button', { name: /Mint experiment/ }));
    await waitFor(() => expect(screen.getByText(/Experiment DTU/)).toBeInTheDocument());
    expect(apiPost).toHaveBeenCalledWith('/api/lens/run', expect.objectContaining({ domain: 'dtu', name: 'create' }));
  });

  it('shows an error when mint returns no DTU id', async () => {
    apiPost.mockResolvedValue({ data: { result: {} } });
    render(<ExperimentActionPanel />);
    setName();
    fireEvent.click(screen.getByRole('button', { name: /Mint experiment/ }));
    await waitFor(() => expect(screen.getByText('No DTU id returned.')).toBeInTheDocument());
  });

  it('sends a DM to a collaborator', async () => {
    apiPost.mockResolvedValue({ data: { ok: true, message: { id: 'msg-1' } } });
    render(<ExperimentActionPanel />);
    setName();
    fireEvent.change(screen.getByPlaceholderText(/lab partner/), { target: { value: 'user-9' } });
    fireEvent.click(screen.getByRole('button', { name: /DM collaborator/ }));
    await waitFor(() => expect(screen.getByText(/60s to recall/)).toBeInTheDocument());
    expect(recallRun).toHaveBeenCalled();
  });

  it('errors when DM has no recipient', async () => {
    render(<ExperimentActionPanel />);
    setName();
    fireEvent.click(screen.getByRole('button', { name: /DM collaborator/ }));
    await waitFor(() => expect(screen.getByText('Enter a collaborator user id.')).toBeInTheDocument());
  });

  it('publishes a protocol DTU', async () => {
    apiPost.mockImplementation(async (url: string) => {
      if (url === '/api/lens/run') return { data: { result: { dtu: { id: 'dtu-pub12345678' } } } };
      return { data: { ok: true } };
    });
    render(<ExperimentActionPanel />);
    setName();
    fireEvent.click(screen.getByRole('button', { name: /Publish protocol/ }));
    await waitFor(() => expect(screen.getByText(/Protocol published/)).toBeInTheDocument());
  });

  it('runs the replication agent and shows the plan', async () => {
    apiPost.mockResolvedValue({ data: { result: { reply: 'Use a cheaper plate reader.' } } });
    render(<ExperimentActionPanel />);
    setName();
    fireEvent.change(screen.getByPlaceholderText(/Inoculate/), { target: { value: 'step one' } });
    fireEvent.click(screen.getByRole('button', { name: /Replication/ }));
    await waitFor(() => expect(screen.getByText('Replication plan ready.')).toBeInTheDocument());
    expect(screen.getByText('Use a cheaper plate reader.')).toBeInTheDocument();
  });

  it('shows an error when the agent returns empty', async () => {
    apiPost.mockResolvedValue({ data: { result: {} } });
    render(<ExperimentActionPanel />);
    setName();
    fireEvent.click(screen.getByRole('button', { name: /Replication/ }));
    await waitFor(() => expect(screen.getByText('Agent returned empty.')).toBeInTheDocument());
  });

  it('serialises a non-string agent reply', async () => {
    apiPost.mockResolvedValue({ data: { result: { summary: { plan: 'json plan' } } } });
    render(<ExperimentActionPanel />);
    setName();
    fireEvent.click(screen.getByRole('button', { name: /Replication/ }));
    await waitFor(() => expect(screen.getByText(/json plan/)).toBeInTheDocument());
  });
});
