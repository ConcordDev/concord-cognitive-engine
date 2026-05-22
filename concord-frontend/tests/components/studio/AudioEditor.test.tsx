import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const emitAudioDTU = vi.fn();
vi.mock('@/lib/daw/dtu-hooks', () => ({ emitAudioDTU: (...a: unknown[]) => emitAudioDTU(...a) }));

import { AudioEditor } from '@/components/studio/AudioEditor';

const BUFFER = {
  id: 'b1', name: 'Vocal Take', duration: 4.5, sampleRate: 48000, channels: 2,
  bpm: 120, key: 'Am', spectralProfile: {},
} as never;

function baseProps(over: Record<string, unknown> = {}) {
  return {
    audioBuffer: BUFFER, waveformPeaks: [0.2, 0.5, 0.8, 0.3], currentPosition: 0.5,
    selection: null as { start: number; end: number } | null, isRecording: false,
    onOperation: vi.fn(), onSeek: vi.fn(), onSelect: vi.fn(),
    onStartRecording: vi.fn(), onStopRecording: vi.fn(),
    ...over,
  };
}

describe('AudioEditor', () => {
  it('renders the no-audio empty state and the record CTA', () => {
    const onStartRecording = vi.fn();
    render(<AudioEditor {...baseProps({ audioBuffer: null, onStartRecording })} />);
    expect(screen.getByText('No audio loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Start Recording'));
    expect(onStartRecording).toHaveBeenCalled();
  });

  it('renders the editor toolbar + info bar for a loaded buffer', () => {
    render(<AudioEditor {...baseProps()} />);
    expect(screen.getByText('Audio Editor')).toBeInTheDocument();
    expect(screen.getByText('Vocal Take')).toBeInTheDocument();
    expect(screen.getByText(/BPM: 120/)).toBeInTheDocument();
  });

  it('disables cut/copy/delete when there is no selection', () => {
    render(<AudioEditor {...baseProps()} />);
    expect(screen.getByTitle('Cut')).toBeDisabled();
    expect(screen.getByTitle('Copy')).toBeDisabled();
    expect(screen.getByTitle('Delete')).toBeDisabled();
    expect(screen.getByTitle('Paste')).not.toBeDisabled();
  });

  it('fires cut/copy/delete when a selection is present', () => {
    const onOperation = vi.fn();
    render(<AudioEditor {...baseProps({ selection: { start: 0.2, end: 0.6 }, onOperation })} />);
    fireEvent.click(screen.getByTitle('Cut'));
    expect(onOperation).toHaveBeenCalledWith({ type: 'cut' });
    fireEvent.click(screen.getByTitle('Copy'));
    expect(onOperation).toHaveBeenCalledWith({ type: 'copy' });
  });

  it('fires the dsp operations (fade/normalize/reverse)', () => {
    const onOperation = vi.fn();
    render(<AudioEditor {...baseProps({ onOperation })} />);
    fireEvent.click(screen.getByTitle('Fade In'));
    fireEvent.click(screen.getByTitle('Fade Out'));
    fireEvent.click(screen.getByTitle('Normalize'));
    fireEvent.click(screen.getByTitle('Reverse'));
    expect(onOperation).toHaveBeenCalledTimes(4);
  });

  it('saves the buffer as a DTU', () => {
    render(<AudioEditor {...baseProps()} />);
    fireEvent.click(screen.getByText('Save as DTU'));
    expect(emitAudioDTU).toHaveBeenCalledWith(expect.objectContaining({ bufferId: 'b1' }));
  });

  it('toggles record / stop', () => {
    const onStartRecording = vi.fn();
    const onStopRecording = vi.fn();
    const { rerender } = render(<AudioEditor {...baseProps({ onStartRecording, onStopRecording })} />);
    fireEvent.click(screen.getByText('Record'));
    expect(onStartRecording).toHaveBeenCalled();
    rerender(<AudioEditor {...baseProps({ isRecording: true, onStartRecording, onStopRecording })} />);
    fireEvent.click(screen.getByText('Stop'));
    expect(onStopRecording).toHaveBeenCalled();
  });

  it('seeks + selects via mouse drag on the waveform', () => {
    const onSeek = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<AudioEditor {...baseProps({ onSeek, onSelect })} />);
    const wave = container.querySelector('.cursor-crosshair')!;
    vi.spyOn(wave, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(wave, { clientX: 40 });
    expect(onSeek).toHaveBeenCalled();
    fireEvent.mouseMove(wave, { clientX: 200 });
    expect(onSelect).toHaveBeenCalled();
    fireEvent.mouseUp(wave);
  });

  it('shows the selection range in the info bar', () => {
    render(<AudioEditor {...baseProps({ selection: { start: 0, end: 0.5 } })} />);
    expect(screen.getByText(/Selection:/)).toBeInTheDocument();
  });

  it('falls back to random peaks when waveformPeaks empty', () => {
    const { container } = render(<AudioEditor {...baseProps({ waveformPeaks: [] })} />);
    expect(container.querySelector('.cursor-crosshair')).toBeTruthy();
  });
});
