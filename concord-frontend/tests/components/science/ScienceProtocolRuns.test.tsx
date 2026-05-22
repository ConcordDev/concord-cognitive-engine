import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ScienceProtocolRuns } from '@/components/science/ScienceProtocolRuns';

function step(index: number, status = 'pending', extra: Record<string, unknown> = {}) {
  return { index, label: `Step ${index + 1}`, status, startedAt: null,
    completedAt: null, note: '', deviation: false, ...extra };
}
const RUN_IN_PROGRESS = {
  id: 'r1', protocolName: 'PCR Run', operator: 'Lee', status: 'in_progress',
  startedAt: 't', completedAt: null, currentStep: 0,
  steps: [step(0, 'pending'), step(1, 'in_progress'), step(2, 'completed')],
};
const RUN_COMPLETED = {
  ...RUN_IN_PROGRESS, status: 'completed', completedAt: 'tt',
  outcome: 'all good', deviationCount: 2,
  steps: [step(0, 'completed'), step(1, 'skipped', { deviation: true, note: 'edge' })],
};

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: { runs: [] } } });
});

describe('ScienceProtocolRuns', () => {
  it('shows the empty state', async () => {
    render(<ScienceProtocolRuns />);
    await waitFor(() => expect(screen.getByText(/No protocol runs yet/)).toBeInTheDocument());
  });

  it('lists existing runs with step progress', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { runs: [RUN_IN_PROGRESS] } } });
    render(<ScienceProtocolRuns />);
    await waitFor(() => expect(screen.getByText('PCR Run')).toBeInTheDocument());
    expect(screen.getByText(/1\/3 steps/)).toBeInTheDocument();
  });

  it('opens the create form and validates name + steps', async () => {
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByRole('button', { name: /New Run/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Run/ }));
    fireEvent.click(screen.getByRole('button', { name: /Begin Run/ }));
    await waitFor(() => expect(screen.getByText('Protocol name required')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Protocol name'), { target: { value: 'P' } });
    fireEvent.click(screen.getByRole('button', { name: /Begin Run/ }));
    await waitFor(() => expect(screen.getByText('At least one step required')).toBeInTheDocument());
  });

  it('creates a run and enters the active view', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'protorun-list') return { data: { ok: true, result: { runs: [] } } };
      if (action === 'protorun-start') return { data: { ok: true, result: { run: RUN_IN_PROGRESS } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByRole('button', { name: /New Run/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Run/ }));
    fireEvent.change(screen.getByPlaceholderText('Protocol name'), { target: { value: 'PCR Run' } });
    fireEvent.change(screen.getByPlaceholderText('Operator (optional)'), { target: { value: 'Lee' } });
    fireEvent.change(screen.getByPlaceholderText(/one per line/), { target: { value: 'a\nb\nc' } });
    fireEvent.click(screen.getByRole('button', { name: /Begin Run/ }));
    await waitFor(() => expect(screen.getByText(/1\/3 steps · operator Lee/)).toBeInTheDocument());
  });

  it('shows error when run creation fails', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'protorun-list') return { data: { ok: true, result: { runs: [] } } };
      return { data: { ok: false, error: 'start fail' } };
    });
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByRole('button', { name: /New Run/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Run/ }));
    fireEvent.change(screen.getByPlaceholderText('Protocol name'), { target: { value: 'PCR' } });
    fireEvent.change(screen.getByPlaceholderText(/one per line/), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: /Begin Run/ }));
    await waitFor(() => expect(screen.getByText('start fail')).toBeInTheDocument());
  });

  it('navigates back from the create form', async () => {
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByRole('button', { name: /New Run/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Run/ }));
    fireEvent.click(screen.getByLabelText('Back'));
    await waitFor(() => expect(screen.getByText(/No protocol runs yet/)).toBeInTheDocument());
  });

  it('opens a run and updates a step (start/done/skip/deviation)', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'protorun-list') return { data: { ok: true, result: { runs: [RUN_IN_PROGRESS] } } };
      if (action === 'protorun-step') return { data: { ok: true, result: { run: RUN_IN_PROGRESS } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByText('PCR Run'));
    fireEvent.click(screen.getByText('PCR Run'));
    await waitFor(() => expect(screen.getByText(/operator Lee/)).toBeInTheDocument());
    // pending step has Start / Done / Skip / Deviation buttons
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'protorun-step',
      expect.objectContaining({ status: 'in_progress' })));
    fireEvent.click(screen.getAllByRole('button', { name: /Done/ })[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'protorun-step',
      expect.objectContaining({ status: 'completed' })));
    fireEvent.click(screen.getAllByRole('button', { name: /Skip/ })[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'protorun-step',
      expect.objectContaining({ status: 'skipped' })));
    fireEvent.click(screen.getAllByRole('button', { name: 'Deviation' })[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'protorun-step',
      expect.objectContaining({ deviation: true })));
  });

  it('shows error when a step update fails', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'protorun-list') return { data: { ok: true, result: { runs: [RUN_IN_PROGRESS] } } };
      if (action === 'protorun-step') return { data: { ok: false, error: 'step fail' } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByText('PCR Run'));
    fireEvent.click(screen.getByText('PCR Run'));
    await waitFor(() => screen.getByText(/operator Lee/));
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(screen.getByText('step fail')).toBeInTheDocument());
  });

  it('completes a run via the complete form', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'protorun-list') return { data: { ok: true, result: { runs: [RUN_IN_PROGRESS] } } };
      if (action === 'protorun-complete') return { data: { ok: true, result: { run: RUN_COMPLETED } } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByText('PCR Run'));
    fireEvent.click(screen.getByText('PCR Run'));
    await waitFor(() => screen.getByText(/operator Lee/));
    fireEvent.change(screen.getByPlaceholderText(/Run outcome/), { target: { value: 'finished' } });
    fireEvent.click(screen.getByRole('button', { name: /Complete Run/ }));
    await waitFor(() => expect(screen.getByText('Run completed')).toBeInTheDocument());
    expect(screen.getByText('all good')).toBeInTheDocument();
    expect(screen.getByText(/2 deviation/)).toBeInTheDocument();
  });

  it('shows error when complete fails', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'protorun-list') return { data: { ok: true, result: { runs: [RUN_IN_PROGRESS] } } };
      if (action === 'protorun-complete') return { data: { ok: false, error: 'complete fail' } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByText('PCR Run'));
    fireEvent.click(screen.getByText('PCR Run'));
    await waitFor(() => screen.getByText(/operator Lee/));
    fireEvent.click(screen.getByRole('button', { name: /Complete Run/ }));
    await waitFor(() => expect(screen.getByText('complete fail')).toBeInTheDocument());
  });

  it('deletes a run from the list', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'protorun-list') return { data: { ok: true, result: { runs: [RUN_IN_PROGRESS] } } };
      if (action === 'protorun-delete') return { data: { ok: true } };
      return { data: { ok: true, result: { runs: [] } } };
    });
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByText('PCR Run'));
    fireEvent.click(screen.getByLabelText('Delete run'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'protorun-delete', { id: 'r1' }));
  });

  it('shows error on a failed delete', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'protorun-list') return { data: { ok: true, result: { runs: [RUN_IN_PROGRESS] } } };
      return { data: { ok: false, error: 'del fail' } };
    });
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByText('PCR Run'));
    fireEvent.click(screen.getByLabelText('Delete run'));
    await waitFor(() => expect(screen.getByText('del fail')).toBeInTheDocument());
  });

  it('renders a completed run with no actionable steps', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { runs: [RUN_COMPLETED] } } });
    render(<ScienceProtocolRuns />);
    await waitFor(() => screen.getByText('PCR Run'));
    fireEvent.click(screen.getByText('PCR Run'));
    await waitFor(() => expect(screen.getByText('Run completed')).toBeInTheDocument());
  });
});
