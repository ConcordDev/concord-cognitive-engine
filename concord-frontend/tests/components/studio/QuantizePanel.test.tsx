import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { QuantizePanel } from '@/components/studio/QuantizePanel';

const GROOVES = [
  { id: 'g1', name: 'MPC Swing', swing: 0.58, velAccent: 10 },
  { id: 'g2', name: 'Straight', swing: 0, velAccent: 0 },
];

beforeEach(() => { lensRun.mockReset(); });

describe('QuantizePanel', () => {
  it('shows the no-clip state', async () => {
    render(<QuantizePanel />);
    await waitFor(() => expect(screen.getByText(/Paste a Clip ID/)).toBeInTheDocument());
  });

  it('renders grid options + grooves with a clip', async () => {
    lensRun.mockResolvedValue(okResult({ grooves: GROOVES }));
    render(<QuantizePanel clipId="c1" />);
    await waitFor(() => expect(screen.getByText('MPC Swing')).toBeInTheDocument());
    expect(screen.getByText('1/16')).toBeInTheDocument();
  });

  it('changes grid, strength, swing and quantize-length, then quantizes', async () => {
    lensRun.mockResolvedValueOnce(okResult({ grooves: GROOVES }));
    const { container } = render(<QuantizePanel clipId="c1" />);
    await waitFor(() => expect(screen.getByText('MPC Swing')).toBeInTheDocument());

    fireEvent.click(screen.getByText('1/8'));
    const ranges = container.querySelectorAll('input[type="range"]');
    fireEvent.change(ranges[0], { target: { value: '0.5' } });
    fireEvent.change(ranges[1], { target: { value: '0.3' } });
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);

    lensRun.mockResolvedValueOnce(okResult({ quantized: 12, moved: 8 }));
    fireEvent.click(screen.getByText('Quantize notes'));
    await waitFor(() => expect(screen.getByText(/Quantized 12 notes — 8 moved/)).toBeInTheDocument());
  });

  it('shows an error message when quantize fails', async () => {
    lensRun.mockResolvedValueOnce(okResult({ grooves: GROOVES }));
    render(<QuantizePanel clipId="c1" />);
    await waitFor(() => expect(screen.getByText('MPC Swing')).toBeInTheDocument());
    lensRun.mockResolvedValueOnce(errResult('bad'));
    fireEvent.click(screen.getByText('Quantize notes'));
    await waitFor(() => expect(screen.getByText('bad')).toBeInTheDocument());
  });

  it('quantize handles a thrown error', async () => {
    lensRun.mockResolvedValueOnce(okResult({ grooves: GROOVES }));
    render(<QuantizePanel clipId="c1" />);
    await waitFor(() => expect(screen.getByText('MPC Swing')).toBeInTheDocument());
    lensRun.mockRejectedValueOnce(new Error('x'));
    fireEvent.click(screen.getByText('Quantize notes'));
    await waitFor(() => expect(screen.getByText('Quantize failed.')).toBeInTheDocument());
  });

  it('applies a groove template', async () => {
    lensRun.mockResolvedValueOnce(okResult({ grooves: GROOVES }));
    render(<QuantizePanel clipId="c1" />);
    await waitFor(() => expect(screen.getByText('MPC Swing')).toBeInTheDocument());
    lensRun.mockResolvedValueOnce(okResult({ grooved: 16 }));
    fireEvent.click(screen.getByText('MPC Swing'));
    await waitFor(() => expect(screen.getByText(/Applied "MPC Swing" to 16 notes/)).toBeInTheDocument());
  });

  it('groove apply failure shows error', async () => {
    lensRun.mockResolvedValueOnce(okResult({ grooves: GROOVES }));
    render(<QuantizePanel clipId="c1" />);
    await waitFor(() => expect(screen.getByText('Straight')).toBeInTheDocument());
    lensRun.mockResolvedValueOnce(errResult('groove bad'));
    fireEvent.click(screen.getByText('Straight'));
    await waitFor(() => expect(screen.getByText('groove bad')).toBeInTheDocument());
  });

  it('survives a groove-list exception', async () => {
    lensRun.mockRejectedValue(new Error('x'));
    render(<QuantizePanel clipId="c1" />);
    await waitFor(() => expect(screen.getByText('Quantize notes')).toBeInTheDocument());
  });
});
