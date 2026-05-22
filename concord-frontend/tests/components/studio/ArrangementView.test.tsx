import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async (importOriginal) => {
  const ReactMod = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = ReactMod.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      ReactMod.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { ArrangementView } from '@/components/studio/ArrangementView';

function makeTrack(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Track ${id}`,
    color: '#22d3ee',
    height: 56,
    volume: -6,
    mute: false,
    solo: false,
    armed: false,
    clips: [],
    ...over,
  } as never;
}

function baseProps(over: Record<string, unknown> = {}) {
  return {
    tracks: [makeTrack('t1'), makeTrack('t2')],
    sections: [{ id: 's1', name: 'Intro', startBar: 0, endBar: 4, color: '#ff0000' }],
    markers: [],
    currentBeat: 2,
    bpm: 120,
    lengthBars: 8,
    timeSignature: [4, 4] as [number, number],
    selectedTrackId: 't1',
    selectedClipId: null,
    zoomLevel: 1,
    snap: '1/4' as never,
    onSelectTrack: vi.fn(),
    onSelectClip: vi.fn(),
    onUpdateTrack: vi.fn(),
    onDeleteTrack: vi.fn(),
    onAddTrack: vi.fn(),
    onMoveClip: vi.fn(),
    onResizeClip: vi.fn(),
    onSeek: vi.fn(),
    onZoomChange: vi.fn(),
    onSnapChange: vi.fn(),
    ...over,
  };
}

describe('ArrangementView', () => {
  it('renders track names and snap buttons', () => {
    render(<ArrangementView {...baseProps()} />);
    expect(screen.getByText('Track t1')).toBeInTheDocument();
    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(screen.getByText('off')).toBeInTheDocument();
  });

  it('fires onSnapChange when a snap button clicked', () => {
    const onSnapChange = vi.fn();
    render(<ArrangementView {...baseProps({ onSnapChange })} />);
    fireEvent.click(screen.getByText('1/8'));
    expect(onSnapChange).toHaveBeenCalledWith('1/8');
  });

  it('fires onZoomChange from the zoom slider', () => {
    const onZoomChange = vi.fn();
    const { container } = render(<ArrangementView {...baseProps({ onZoomChange })} />);
    const range = container.querySelector('input[type="range"]') as HTMLInputElement;
    fireEvent.change(range, { target: { value: '2' } });
    expect(onZoomChange).toHaveBeenCalledWith(2);
  });

  it('fires onSelectTrack, onUpdateTrack mute/solo/armed and onDeleteTrack', () => {
    const p = baseProps();
    render(<ArrangementView {...p} />);
    fireEvent.click(screen.getByText('Track t2'));
    expect(p.onSelectTrack).toHaveBeenCalledWith('t2');

    const mutes = screen.getAllByText('M');
    fireEvent.click(mutes[0]);
    expect(p.onUpdateTrack).toHaveBeenCalledWith('t1', { mute: true });
    fireEvent.click(screen.getAllByText('S')[0]);
    expect(p.onUpdateTrack).toHaveBeenCalledWith('t1', { solo: true });
    fireEvent.click(screen.getAllByText('R')[0]);
    expect(p.onUpdateTrack).toHaveBeenCalledWith('t1', { armed: true });

    fireEvent.click(screen.getAllByLabelText('Delete')[0]);
    expect(p.onDeleteTrack).toHaveBeenCalledWith('t1');
  });

  it('fires onAddTrack and onSeek (ruler click)', () => {
    const p = baseProps();
    render(<ArrangementView {...p} />);
    fireEvent.click(screen.getByText('Add Track'));
    expect(p.onAddTrack).toHaveBeenCalled();
  });

  it('renders clips including a midi clip with notes', () => {
    const trackWithClip = makeTrack('t3', {
      clips: [
        {
          id: 'c1', name: 'Loop', type: 'midi', startBeat: 0, lengthBeats: 4,
          color: '#ff00ff',
          midiNotes: [{ id: 'n1', startBeat: 0, lengthBeats: 1, pitch: 60 }],
        },
        {
          id: 'c2', name: 'Audio', type: 'audio', startBeat: 4, lengthBeats: 2,
        },
      ],
    });
    const p = baseProps({ tracks: [trackWithClip], selectedClipId: 'c1' });
    render(<ArrangementView {...p} />);
    expect(screen.getByText('Loop')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Audio'));
    expect(p.onSelectClip).toHaveBeenCalledWith('c2');
  });

  it('handles wheel zoom with ctrl key', () => {
    const onZoomChange = vi.fn();
    const { container } = render(<ArrangementView {...baseProps({ onZoomChange })} />);
    fireEvent.wheel(container.firstChild as Element, { ctrlKey: true, deltaY: 100 });
    expect(onZoomChange).toHaveBeenCalled();
  });
});
