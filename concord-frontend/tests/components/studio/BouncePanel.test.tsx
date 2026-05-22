import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { BouncePanel } from '@/components/studio/BouncePanel';

const RENDERS = [
  { id: 'r1', projectId: 'p1', projectName: 'Track One', trackId: null, format: 'wav_24', sampleRate: 48000, kind: 'master', durationSec: 60, status: 'completed', outputUrl: '/x', bouncedAt: '' },
  { id: 'r2', projectId: 'p1', projectName: 'Track Two', trackId: null, format: 'mp3_320', sampleRate: 44100, kind: 'stem', durationSec: 30, status: 'pending', outputUrl: '/y', bouncedAt: '' },
];

beforeEach(() => { lensRun.mockReset(); });

describe('BouncePanel', () => {
  it('renders empty when no renders', async () => {
    lensRun.mockResolvedValue(okResult({ renders: [] }));
    render(<BouncePanel />);
    await waitFor(() => expect(screen.getByText('No bounces yet.')).toBeInTheDocument());
  });

  it('renders a populated list with status badges', async () => {
    lensRun.mockResolvedValue(okResult({ renders: RENDERS }));
    render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Track One')).toBeInTheDocument());
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('does not show the bounce form without a projectId', async () => {
    lensRun.mockResolvedValue(okResult({ renders: [] }));
    render(<BouncePanel />);
    await waitFor(() => expect(screen.getByText('No bounces yet.')).toBeInTheDocument());
    expect(screen.queryByText('Bounce')).not.toBeInTheDocument();
  });

  it('changes form fields and triggers a bounce', async () => {
    lensRun.mockResolvedValue(okResult({ renders: [] }));
    const { container } = render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No bounces yet.')).toBeInTheDocument());

    const selects = container.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'flac' } });
    fireEvent.change(selects[1], { target: { value: '96000' } });
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    fireEvent.click(screen.getByText('Bounce'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'bounce', input: expect.objectContaining({ format: 'flac', sampleRate: 96000, stems: true }) }),
    ));
  });

  it('handles a bounce rejection gracefully', async () => {
    lensRun.mockResolvedValueOnce(okResult({ renders: [] }));
    render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No bounces yet.')).toBeInTheDocument());
    lensRun.mockRejectedValueOnce(new Error('fail'));
    fireEvent.click(screen.getByText('Bounce'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));
  });

  it('handles list error envelope', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<BouncePanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No bounces yet.')).toBeInTheDocument());
  });

  it('survives a refresh exception', async () => {
    lensRun.mockRejectedValue(new Error('net'));
    render(<BouncePanel />);
    await waitFor(() => expect(screen.getByText('No bounces yet.')).toBeInTheDocument());
  });
});
