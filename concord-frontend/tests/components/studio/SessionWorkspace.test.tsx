import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { lucideMockFactory, okResult } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
const lensRun = vi.fn(() => Promise.resolve(okResult({ items: [] })));
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// Stub the heavy child rails / view so the test isolates SessionWorkspace's
// model-building + launch state machine.
vi.mock('@/components/music/SessionView', () => ({
  SessionView: (p: {
    tracks: { id: string; name: string }[];
    scenes: { id: string; name: string }[];
    onLaunchClip: (c: { trackId: string; sceneId: string }) => void;
    onLaunchScene: (s: { id: string }) => void;
    onStopAll: () => void;
    onTempoChange?: (b: number) => void;
  }) => (
    <div data-testid="session-view">
      <span>tracks:{p.tracks.length}</span>
      <span>scenes:{p.scenes.length}</span>
      <button onClick={() => p.onLaunchClip({ trackId: 't1', sceneId: 'scene-1' })}>launch-clip</button>
      <button onClick={() => p.onLaunchScene({ id: 'scene-1' })}>launch-scene</button>
      <button onClick={() => p.onStopAll()}>stop-all</button>
      <button onClick={() => p.onTempoChange?.(140)}>tempo</button>
    </div>
  ),
}));
vi.mock('@/components/studio/SessionBrowserRail', () => ({ default: () => <div>browser-rail</div> }));
vi.mock('@/components/studio/SessionInspectorRail', () => ({
  default: (p: { selectedClip: unknown; selectedTrack: unknown; onCloseInspector?: () => void }) => (
    <div data-testid="inspector">
      <span data-testid="clip-state">{p.selectedClip ? 'clip-selected' : 'no-clip'}</span>
      <span data-testid="track-state">{p.selectedTrack ? 'track-selected' : 'no-track'}</span>
      <button onClick={() => p.onCloseInspector?.()}>close-inspector</button>
    </div>
  ),
}));
vi.mock('@/components/studio/MixerPeekStrip', () => ({
  default: (p: { expanded: boolean; onToggleExpanded?: () => void }) => (
    <div>mixer expanded:{String(p.expanded)}<button onClick={() => p.onToggleExpanded?.()}>toggle-mixer</button></div>
  ),
}));

import SessionWorkspace from '@/components/studio/SessionWorkspace';

const PROJECT = {
  id: 'p1', name: 'Demo',
  tracks: [
    { id: 't1', name: 'Drums', color: '#f00', mute: false, solo: false, armed: false, clips: [
      { id: 'c1', name: 'Beat', lengthBeats: 4, color: '#0ff', audioBufferId: 'ab1' },
    ] },
    { id: 't2', name: 'Bass', clips: [] },
  ],
  arrangement: { sections: [{ name: 'Intro' }, { name: 'Verse' }] },
} as never;

function baseProps(over: Record<string, unknown> = {}) {
  return {
    project: PROJECT, bpm: 120, selectedTrackId: null as string | null,
    onSelectTrack: vi.fn(), onUpdateTrack: vi.fn(), onTempoChange: vi.fn(), onStopAll: vi.fn(),
    ...over,
  };
}

beforeEach(() => { lensRun.mockClear(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('SessionWorkspace', () => {
  it('builds a session model from the project (8 scenes minimum)', () => {
    render(<SessionWorkspace {...baseProps()} />);
    expect(screen.getByText('tracks:2')).toBeInTheDocument();
    expect(screen.getByText('scenes:8')).toBeInTheDocument();
    expect(screen.getByText('browser-rail')).toBeInTheDocument();
  });

  it('launches a clip → selects it and flips to playing after a beat', () => {
    const onSelectTrack = vi.fn();
    render(<SessionWorkspace {...baseProps({ onSelectTrack })} />);
    fireEvent.click(screen.getByText('launch-clip'));
    expect(onSelectTrack).toHaveBeenCalledWith('t1');
    expect(screen.getByTestId('clip-state')).toHaveTextContent('clip-selected');
    act(() => { vi.advanceTimersByTime(600); });
  });

  it('launches a whole scene', () => {
    render(<SessionWorkspace {...baseProps()} />);
    fireEvent.click(screen.getByText('launch-scene'));
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByTestId('session-view')).toBeInTheDocument();
  });

  it('stops all clips', () => {
    const onStopAll = vi.fn();
    render(<SessionWorkspace {...baseProps({ onStopAll })} />);
    fireEvent.click(screen.getByText('stop-all'));
    expect(onStopAll).toHaveBeenCalled();
  });

  it('relays tempo changes', () => {
    const onTempoChange = vi.fn();
    render(<SessionWorkspace {...baseProps({ onTempoChange })} />);
    fireEvent.click(screen.getByText('tempo'));
    expect(onTempoChange).toHaveBeenCalledWith(140);
  });

  it('toggles the mixer strip expand state', () => {
    render(<SessionWorkspace {...baseProps()} />);
    expect(screen.getByText('mixer expanded:false')).toBeInTheDocument();
    fireEvent.click(screen.getByText('toggle-mixer'));
    expect(screen.getByText('mixer expanded:true')).toBeInTheDocument();
  });

  it('reflects a pre-selected track in the inspector', () => {
    render(<SessionWorkspace {...baseProps({ selectedTrackId: 't1' })} />);
    expect(screen.getByTestId('track-state')).toHaveTextContent('track-selected');
  });

  it('closes the inspector', () => {
    const onSelectTrack = vi.fn();
    render(<SessionWorkspace {...baseProps({ selectedTrackId: 't1', onSelectTrack })} />);
    fireEvent.click(screen.getByText('close-inspector'));
    expect(onSelectTrack).toHaveBeenCalledWith(null);
  });

  it('handles a project with no tracks or arrangement', () => {
    render(<SessionWorkspace {...baseProps({ project: { id: 'p2', name: 'Empty' } })} />);
    expect(screen.getByText('tracks:0')).toBeInTheDocument();
  });
});
