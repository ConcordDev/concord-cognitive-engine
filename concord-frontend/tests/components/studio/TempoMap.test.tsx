import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { TempoMap } from '@/components/studio/TempoMap';

const CHANGES = [
  { id: 'c1', projectId: 'p1', bpm: 120, atBeats: 0, timeSignatureNum: 4, timeSignatureDen: 4 },
  { id: 'c2', projectId: 'p1', bpm: 140, atBeats: 32, timeSignatureNum: 3, timeSignatureDen: 8 },
];

beforeEach(() => { lensRun.mockReset(); });

describe('TempoMap', () => {
  it('shows the no-project state', async () => {
    render(<TempoMap />);
    await waitFor(() => expect(screen.getByText('No tempo changes.')).toBeInTheDocument());
  });

  it('shows the empty state with project', async () => {
    lensRun.mockResolvedValue(okResult({ changes: [] }));
    render(<TempoMap projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tempo changes.')).toBeInTheDocument());
  });

  it('renders populated changes', async () => {
    lensRun.mockResolvedValue(okResult({ changes: CHANGES }));
    render(<TempoMap projectId="p1" />);
    await waitFor(() => expect(screen.getByText('120 BPM')).toBeInTheDocument());
    expect(screen.getByText('140 BPM')).toBeInTheDocument();
    expect(screen.getByText('3/8')).toBeInTheDocument();
  });

  it('adds a tempo change', async () => {
    lensRun.mockResolvedValue(okResult({ changes: [] }));
    render(<TempoMap projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tempo changes.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('BPM'), { target: { value: '128' } });
    fireEvent.change(screen.getByPlaceholderText('At beats'), { target: { value: '64' } });
    fireEvent.change(screen.getByPlaceholderText('TS num'), { target: { value: '6' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '8' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tempo-add', input: expect.objectContaining({ bpm: 128, atBeats: 64, timeSignatureNum: 6, timeSignatureDen: 8 }) }),
    ));
  });

  it('handles add rejection', async () => {
    lensRun.mockResolvedValueOnce(okResult({ changes: [] }));
    render(<TempoMap projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tempo changes.')).toBeInTheDocument());
    lensRun.mockRejectedValueOnce(new Error('x'));
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));
  });

  it('handles list error', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<TempoMap projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tempo changes.')).toBeInTheDocument());
  });

  it('survives a refresh exception', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<TempoMap projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No tempo changes.')).toBeInTheDocument());
  });
});
