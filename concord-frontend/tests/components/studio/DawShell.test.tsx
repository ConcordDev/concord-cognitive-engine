import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { lucideMockFactory } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));

import { DawShell, type DawTrack, type DawClip, type DawScene } from '@/components/studio/DawShell';

const TRACKS: DawTrack[] = [
  { id: 't1', name: 'Drums', kind: 'drum', colour: '#f00', muted: true, solo: false, armed: false },
  { id: 't2', name: 'Bass', kind: 'audio', muted: false, solo: true, armed: true },
  { id: 't3', name: 'Keys', kind: 'midi' },
];
const CLIPS: DawClip[] = [
  { id: 'c1', trackId: 't1', name: 'Beat', kind: 'drum', startBeats: 0, lengthBeats: 4 },
  { id: 'c2', trackId: 't3', name: 'Lead', kind: 'midi', startBeats: 4, lengthBeats: 2, colour: '#0f0', muted: true },
  { id: 'c3', trackId: 't2', name: 'Groove', kind: 'audio', startBeats: 2, lengthBeats: 8 },
];
const SCENES: DawScene[] = [{ id: 's1', name: 'Intro' }, { id: 's2', name: 'Verse' }];

function baseProps(over: Partial<React.ComponentProps<typeof DawShell>> = {}) {
  return {
    projectName: 'My Project', bpm: 120, timeSignatureNum: 4, timeSignatureDen: 4,
    isPlaying: false, isRecording: false, positionBeats: 6,
    tracks: TRACKS, clips: CLIPS, ...over,
  };
}

describe('DawShell', () => {
  it('renders the transport bar, project name + tracks', () => {
    render(<DawShell {...baseProps()} />);
    expect(screen.getByText('My Project')).toBeInTheDocument();
    expect(screen.getByText('Drums')).toBeInTheDocument();
    expect(screen.getByText('120 BPM · 4/4')).toBeInTheDocument();
  });

  it('renders clips with kind glyphs', () => {
    render(<DawShell {...baseProps()} />);
    expect(screen.getByTitle(/Beat/)).toBeInTheDocument();
    expect(screen.getByTitle(/Lead/)).toBeInTheDocument();
    expect(screen.getByTitle(/Groove/)).toBeInTheDocument();
  });

  it('fires onPlay / onStop / onRecord', () => {
    const onPlay = vi.fn(), onStop = vi.fn(), onRecord = vi.fn();
    render(<DawShell {...baseProps({ onPlay, onStop, onRecord })} />);
    const buttons = document.querySelectorAll('header button');
    fireEvent.click(buttons[0]); // SkipBack → onStop
    fireEvent.click(buttons[1]); // Square → onStop
    fireEvent.click(buttons[2]); // Play → onPlay
    fireEvent.click(buttons[3]); // Record → onRecord
    expect(onStop).toHaveBeenCalledTimes(2);
    expect(onPlay).toHaveBeenCalled();
    expect(onRecord).toHaveBeenCalled();
  });

  it('renders playing + recording styles', () => {
    const { container } = render(<DawShell {...baseProps({ isPlaying: true, isRecording: true })} />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders the scenes column when scenes provided and launches one', () => {
    const onLaunchScene = vi.fn();
    render(<DawShell {...baseProps({ scenes: SCENES, onLaunchScene })} />);
    expect(screen.getByText('Scenes')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Intro'));
    expect(onLaunchScene).toHaveBeenCalledWith('s1');
  });

  it('omits the scenes column when scenes empty', () => {
    render(<DawShell {...baseProps({ scenes: [] })} />);
    expect(screen.queryByText('Scenes')).not.toBeInTheDocument();
  });

  it('handles an empty track + clip list', () => {
    render(<DawShell {...baseProps({ tracks: [], clips: [] })} />);
    expect(screen.getByText('Tracks')).toBeInTheDocument();
  });

  it('does not crash when handlers are absent', () => {
    render(<DawShell {...baseProps({ scenes: SCENES })} />);
    const buttons = document.querySelectorAll('header button');
    fireEvent.click(buttons[2]);
    fireEvent.click(screen.getByText('Verse'));
    expect(screen.getByText('My Project')).toBeInTheDocument();
  });
});
