import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const emitInstrumentDTU = vi.fn();
vi.mock('@/lib/daw/dtu-hooks', () => ({ emitInstrumentDTU: (...a: unknown[]) => emitInstrumentDTU(...a) }));
vi.mock('@/lib/daw/engine', () => ({ DEFAULT_SYNTH_PRESETS: [] }));

import { SynthPanel } from '@/components/studio/SynthPanel';

const PRESET = {
  id: 'p1', name: 'Big Lead', type: 'subtractive', category: 'lead', tags: ['bright', 'loud'],
  oscillators: [{ shape: 'sawtooth', detune: 0, octave: 0, level: 0.8, phase: 0 }],
  filter: { type: 'lowpass', frequency: 3000, resonance: 3, envelope: 0.5, keyTrack: 0.3 },
  ampEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
  filterEnvelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.3 },
  lfo: [], effects: [], polyphony: 8, portamento: 0, unison: 2, unisonDetune: 10,
} as never;

function baseProps(over: Record<string, unknown> = {}) {
  return {
    presets: [PRESET], activePreset: null as unknown,
    onSelectPreset: vi.fn(), onUpdatePreset: vi.fn(), onSavePreset: vi.fn(), onAddToTrack: vi.fn(),
    ...over,
  };
}

describe('SynthPanel', () => {
  it('renders the browser when no preset is active', () => {
    render(<SynthPanel {...baseProps()} />);
    expect(screen.getByText('Synthesizers')).toBeInTheDocument();
    expect(screen.getByText('Big Lead')).toBeInTheDocument();
  });

  it('selects a preset from the browser', () => {
    const onSelectPreset = vi.fn();
    render(<SynthPanel {...baseProps({ onSelectPreset })} />);
    fireEvent.click(screen.getByText('Big Lead'));
    expect(onSelectPreset).toHaveBeenCalledWith(PRESET);
  });

  it('adds a preset to a track from the browser', () => {
    const onAddToTrack = vi.fn();
    render(<SynthPanel {...baseProps({ onAddToTrack })} />);
    fireEvent.click(screen.getByText('Add to track'));
    expect(onAddToTrack).toHaveBeenCalledWith(PRESET);
  });

  it('renders the editor when a preset is active', () => {
    render(<SynthPanel {...baseProps({ activePreset: PRESET })} />);
    expect(screen.getByText('Oscillators')).toBeInTheDocument();
    expect(screen.getByText('Filter')).toBeInTheDocument();
    expect(screen.getByText('Amp Envelope')).toBeInTheDocument();
  });

  it('switches an oscillator shape', () => {
    const onUpdatePreset = vi.fn();
    render(<SynthPanel {...baseProps({ activePreset: PRESET, onUpdatePreset })} />);
    fireEvent.click(screen.getByText('squ'));
    expect(onUpdatePreset).toHaveBeenCalled();
  });

  it('switches the filter type', () => {
    const onUpdatePreset = vi.fn();
    render(<SynthPanel {...baseProps({ activePreset: PRESET, onUpdatePreset })} />);
    fireEvent.click(screen.getByText('highpass'));
    expect(onUpdatePreset).toHaveBeenCalled();
  });

  it('turns a knob to update a parameter', () => {
    const onUpdatePreset = vi.fn();
    const { container } = render(<SynthPanel {...baseProps({ activePreset: PRESET, onUpdatePreset })} />);
    const knob = container.querySelector('.rounded-full.cursor-pointer')!;
    fireEvent.click(knob);
    expect(onUpdatePreset).toHaveBeenCalled();
  });

  it('saves a preset as a DTU from the editor', () => {
    const onSavePreset = vi.fn();
    render(<SynthPanel {...baseProps({ activePreset: PRESET, onSavePreset })} />);
    fireEvent.click(screen.getByText('Save as DTU'));
    expect(emitInstrumentDTU).toHaveBeenCalled();
    expect(onSavePreset).toHaveBeenCalledWith(PRESET);
  });

  it('navigates back to the browser from the editor', () => {
    render(<SynthPanel {...baseProps({ activePreset: PRESET })} />);
    fireEvent.click(screen.getByText('Browse'));
    expect(screen.getByText('Synthesizers')).toBeInTheDocument();
  });

  it('adds the active preset to a track from the editor', () => {
    const onAddToTrack = vi.fn();
    render(<SynthPanel {...baseProps({ activePreset: PRESET, onAddToTrack })} />);
    fireEvent.click(screen.getByText('Add to Track'));
    expect(onAddToTrack).toHaveBeenCalledWith(PRESET);
  });
});
