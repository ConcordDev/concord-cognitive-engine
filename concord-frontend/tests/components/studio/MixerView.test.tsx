import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));

import { MixerView } from '@/components/studio/MixerView';

function track(id: string, over: Record<string, unknown> = {}) {
  return {
    id, name: `Track ${id}`, color: '#22d3ee', volume: -6, pan: 0,
    mute: false, solo: false, sendLevels: {}, effectChain: [], ...over,
  } as never;
}

const MASTER = {
  volume: -3, inserts: [{ name: 'Limiter', type: 'limiter', enabled: true }],
  metering: { lufs: -14 },
} as never;

function baseProps(over: Record<string, unknown> = {}) {
  return {
    tracks: [track('t1'), track('t2', { mute: true, pan: -0.5 })],
    masterBus: MASTER,
    selectedTrackId: 't1' as string | null,
    spectrumData: null as Uint8Array | null,
    onSelectTrack: vi.fn(), onUpdateTrack: vi.fn(), onToggleEffect: vi.fn(),
    onAddEffect: vi.fn(), onRemoveEffect: vi.fn(), onMasterVolumeChange: vi.fn(),
    ...over,
  };
}

describe('MixerView', () => {
  it('renders channel strips + the master bus', () => {
    render(<MixerView {...baseProps()} />);
    expect(screen.getByText('Track t1')).toBeInTheDocument();
    expect(screen.getByText('MASTER')).toBeInTheDocument();
    expect(screen.getByText('-14.0')).toBeInTheDocument(); // LUFS
  });

  it('selects a track', () => {
    const onSelectTrack = vi.fn();
    render(<MixerView {...baseProps({ onSelectTrack })} />);
    fireEvent.click(screen.getByText('Track t2'));
    expect(onSelectTrack).toHaveBeenCalledWith('t2');
  });

  it('toggles mute + solo on a strip', () => {
    const onUpdateTrack = vi.fn();
    render(<MixerView {...baseProps({ onUpdateTrack })} />);
    fireEvent.click(screen.getAllByText('M')[0]);
    expect(onUpdateTrack).toHaveBeenCalledWith('t1', { mute: true });
    fireEvent.click(screen.getAllByText('S')[0]);
    expect(onUpdateTrack).toHaveBeenCalledWith('t1', { solo: true });
  });

  it('adds an effect to a track', () => {
    const onAddEffect = vi.fn();
    render(<MixerView {...baseProps({ onAddEffect })} />);
    fireEvent.click(screen.getAllByText('+ FX')[0]);
    expect(onAddEffect).toHaveBeenCalledWith('t1');
  });

  it('toggles + removes an effect on a strip with effects', () => {
    const onToggleEffect = vi.fn();
    const onRemoveEffect = vi.fn();
    const tracks = [track('t1', { effectChain: [
      { id: 'fx1', name: 'Reverb', enabled: true },
      { id: 'fx2', name: 'Delay', enabled: false },
    ] })];
    render(<MixerView {...baseProps({ tracks, onToggleEffect, onRemoveEffect })} />);
    fireEvent.click(screen.getByText('Reverb'));
    expect(onToggleEffect).toHaveBeenCalledWith('t1', 'fx1');
    fireEvent.click(document.querySelector('button.hover\\:text-red-400')!);
    expect(onRemoveEffect).toHaveBeenCalledWith('t1', 'fx1');
  });

  it('renders the "+N more" label when a strip has >4 effects', () => {
    const tracks = [track('t1', { effectChain: Array.from({ length: 6 }).map((_, i) => ({
      id: `fx${i}`, name: `FX${i}`, enabled: true,
    })) })];
    render(<MixerView {...baseProps({ tracks })} />);
    expect(screen.getByText('+2 more')).toBeInTheDocument();
  });

  it('renders send level bars when sendLevels present', () => {
    const tracks = [track('t1', { sendLevels: { busA: -12 } })];
    const { container } = render(<MixerView {...baseProps({ tracks })} />);
    expect(container.querySelector('.bg-neon-purple\\/60')).toBeTruthy();
  });

  it('updates the master volume on fader click', () => {
    const onMasterVolumeChange = vi.fn();
    const { container } = render(<MixerView {...baseProps({ onMasterVolumeChange })} />);
    // the master fader is the last cursor-ns-resize element (after channel strips)
    const faders = container.querySelectorAll('.cursor-ns-resize');
    const masterFader = faders[faders.length - 1];
    vi.spyOn(masterFader, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 12, height: 112, right: 12, bottom: 112, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.click(masterFader, { clientY: 56 });
    expect(onMasterVolumeChange).toHaveBeenCalled();
  });

  it('renders the spectrum visualisation when spectrumData provided', () => {
    const spectrumData = new Uint8Array(64).fill(128);
    const { container } = render(<MixerView {...baseProps({ spectrumData })} />);
    expect(container.querySelectorAll('.bg-gradient-to-t').length).toBeGreaterThan(0);
  });

  it('drags a channel strip fader', () => {
    const onUpdateTrack = vi.fn();
    const { container } = render(<MixerView {...baseProps({ onUpdateTrack })} />);
    const fader = container.querySelector('.cursor-ns-resize')!;
    vi.spyOn(fader, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 12, height: 112, right: 12, bottom: 112, x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.mouseDown(fader, { clientY: 40 });
    fireEvent.mouseMove(fader, { clientY: 60 });
    fireEvent.mouseUp(fader);
    expect(onUpdateTrack).toHaveBeenCalled();
  });
});
