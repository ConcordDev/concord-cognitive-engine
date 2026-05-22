import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AutomationLanesPanel } from '@/components/studio/AutomationLanesPanel';

const LANES = [
  { id: 'l1', trackId: 't1', parameter: 'volume', visible: true, points: [
    { id: 'p1', timeBeats: 0, value: 0.2 },
    { id: 'p2', timeBeats: 4, value: 0.8 },
  ] },
  { id: 'l2', trackId: 't1', parameter: 'pan', visible: true, points: [] },
];

beforeEach(() => { lensRun.mockReset(); });

describe('AutomationLanesPanel', () => {
  it('shows the no-track empty state when trackId absent', async () => {
    render(<AutomationLanesPanel />);
    await waitFor(() => expect(screen.getByText(/Select a track to add automation/)).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('renders an empty lane list', async () => {
    lensRun.mockResolvedValue(okResult({ lanes: [] }));
    render(<AutomationLanesPanel trackId="t1" />);
    await waitFor(() => expect(screen.getByText(/No automation lanes on this track/)).toBeInTheDocument());
  });

  it('renders populated lanes with point counts and a polyline', async () => {
    lensRun.mockResolvedValue(okResult({ lanes: LANES }));
    const { container } = render(<AutomationLanesPanel trackId="t1" />);
    await waitFor(() => expect(screen.getByText('volume')).toBeInTheDocument());
    expect(screen.getByText('2 pts')).toBeInTheDocument();
    expect(screen.getByText('0 pts')).toBeInTheDocument();
    // lane with >1 points draws a polyline
    expect(container.querySelector('polyline')).toBeTruthy();
  });

  it('adds a lane via the parameter select + button', async () => {
    lensRun.mockResolvedValue(okResult({ lanes: [] }));
    render(<AutomationLanesPanel trackId="t1" />);
    await waitFor(() => expect(screen.getByText(/No automation lanes/)).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pan' } });
    fireEvent.click(screen.getByText('Add lane'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'automation-add-lane', input: { trackId: 't1', parameter: 'pan' } }),
    ));
  });

  it('adds a point and deletes a lane', async () => {
    lensRun.mockResolvedValue(okResult({ lanes: LANES }));
    render(<AutomationLanesPanel trackId="t1" />);
    await waitFor(() => expect(screen.getByText('volume')).toBeInTheDocument());

    fireEvent.click(screen.getAllByText('+ pt')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'automation-add-point' }),
    ));

    const delBtns = document.querySelectorAll('button.text-rose-400');
    fireEvent.click(delBtns[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'automation-delete-lane' }),
    ));
  });

  it('survives a refresh error path', async () => {
    lensRun.mockRejectedValueOnce(new Error('boom'));
    render(<AutomationLanesPanel trackId="t1" />);
    await waitFor(() => expect(screen.getByText(/No automation lanes/)).toBeInTheDocument());
  });

  it('keeps rendering when add-lane rejects', async () => {
    lensRun.mockResolvedValueOnce(okResult({ lanes: [] }));
    render(<AutomationLanesPanel trackId="t1" />);
    await waitFor(() => expect(screen.getByText(/No automation lanes/)).toBeInTheDocument());
    lensRun.mockRejectedValueOnce(new Error('add fail'));
    fireEvent.click(screen.getByText('Add lane'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));
  });

  it('handles an error envelope from list', async () => {
    lensRun.mockResolvedValue(errResult('nope'));
    render(<AutomationLanesPanel trackId="t1" />);
    await waitFor(() => expect(screen.getByText(/No automation lanes/)).toBeInTheDocument());
  });
});
