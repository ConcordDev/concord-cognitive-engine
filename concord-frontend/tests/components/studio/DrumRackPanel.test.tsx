import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, okResult, errResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Web Audio is not in jsdom — stub the engine helpers.
const fakeCtx = {
  currentTime: 0,
  createOscillator: () => ({ type: '', frequency: { setValueAtTime: vi.fn() }, connect: () => ({ connect: () => ({ connect: vi.fn() }) }), start: vi.fn(), stop: vi.fn() }),
  createGain: () => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }),
  createStereoPanner: () => ({ pan: { setValueAtTime: vi.fn() }, connect: vi.fn() }),
  destination: {},
};
vi.mock('@/lib/daw/engine', () => ({
  getAudioContext: () => fakeCtx,
  resumeAudioContext: vi.fn(),
}));

import { DrumRackPanel } from '@/components/studio/DrumRackPanel';

function pads(n: number) {
  return Array.from({ length: n }).map((_, i) => ({
    index: i, label: `Pad ${i + 1}`, sampleUrl: i === 0 ? '/s.wav' : null,
    gainDb: 0, pan: 0, tuneSemitones: 0, loop: false, reverse: false, chokeGroup: 0, rootNote: 36 + i,
  }));
}
const RACKS = [
  { id: 'r1', projectId: 'p1', name: 'Kit A', kind: 'drumrack' as const, pads: pads(8) },
];

beforeEach(() => { lensRun.mockReset(); });

describe('DrumRackPanel', () => {
  it('shows the no-project state', async () => {
    render(<DrumRackPanel />);
    await waitFor(() => expect(screen.getByText(/Open a project to build drum racks/)).toBeInTheDocument());
  });

  it('shows the no-racks state', async () => {
    lensRun.mockResolvedValue(okResult({ racks: [] }));
    render(<DrumRackPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No racks yet.')).toBeInTheDocument());
  });

  it('renders racks and pads after selection', async () => {
    lensRun.mockResolvedValue(okResult({ racks: RACKS }));
    render(<DrumRackPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Kit A')).toBeInTheDocument());
    expect(screen.getByText('Pad 1')).toBeInTheDocument();
  });

  it('does not create a rack with empty name', async () => {
    lensRun.mockResolvedValue(okResult({ racks: [] }));
    render(<DrumRackPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No racks yet.')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Create'));
    expect(lensRun).toHaveBeenCalledTimes(1);
  });

  it('creates a rack', async () => {
    lensRun.mockResolvedValue(okResult({ racks: [] }));
    render(<DrumRackPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No racks yet.')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Rack name'), { target: { value: 'Kit B' } });
    const selects = document.querySelectorAll('select');
    fireEvent.change(selects[0], { target: { value: 'sampler' } });
    fireEvent.change(selects[1], { target: { value: '32' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'drumrack-create', expect.objectContaining({ name: 'Kit B', kind: 'sampler', padCount: 32 }),
    ));
  });

  it('auditions a pad and opens its mapping editor', async () => {
    lensRun.mockResolvedValue(okResult({ racks: RACKS }));
    render(<DrumRackPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Pad 1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Pad 2').closest('button')!);
    await waitFor(() => expect(screen.getByText(/Pad 2 mapping/)).toBeInTheDocument());

    const labelInput = screen.getByText('Label').querySelector('input')!;
    fireEvent.blur(labelInput, { target: { value: 'Snare' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'drumrack-pad-assign', expect.objectContaining({ label: 'Snare' }),
    ));
  });

  it('deletes a rack', async () => {
    lensRun.mockResolvedValue(okResult({ racks: RACKS }));
    render(<DrumRackPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('Kit A')).toBeInTheDocument());
    fireEvent.click(document.querySelectorAll('span.text-rose-400')[0]);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'studio', 'drumrack-delete', { id: 'r1' },
    ));
  });

  it('handles a list error', async () => {
    lensRun.mockResolvedValue(errResult());
    render(<DrumRackPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText('No racks yet.')).toBeInTheDocument());
  });
});
