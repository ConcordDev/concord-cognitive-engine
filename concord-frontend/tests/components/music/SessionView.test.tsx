import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { SessionView, type SessionTrack, type SessionScene, type SessionClip } from '@/components/music/SessionView';

const tracks: SessionTrack[] = [
  { id: 't1', name: 'Drums', armed: true },
  { id: 't2', name: 'Bass', muted: true, color: 'bg-red-500/30 border-red-500/40' },
  { id: 't3', name: 'Synth' },
];

const scenes: SessionScene[] = [
  { id: 's1', name: 'Intro' },
  { id: 's2', name: 'Verse' },
];

const clips: Record<string, SessionClip> = {
  't1:s1': { trackId: 't1', sceneId: 's1', hasContent: true, label: 'Kick loop', durationBeats: 4 },
  't2:s1': { trackId: 't2', sceneId: 's1', hasContent: true, assetId: 'asset-bass' },
  't3:s2': { trackId: 't3', sceneId: 's2', hasContent: false },
};

describe('SessionView', () => {
  it('renders track headers and scene names', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    expect(screen.getByText('Drums')).toBeInTheDocument();
    expect(screen.getByText('Bass')).toBeInTheDocument();
    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(screen.getByText('Verse')).toBeInTheDocument();
    expect(screen.getByText('3 tracks · 2 scenes')).toBeInTheDocument();
  });

  it('renders clip labels and falls back to assetId then "clip"', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    expect(screen.getByText('Kick loop')).toBeInTheDocument();
    expect(screen.getByText('asset-bass')).toBeInTheDocument();
    expect(screen.getByText('4b')).toBeInTheDocument();
  });

  it('shows armed mic and muted icon', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    expect(screen.getByLabelText('Armed')).toBeInTheDocument();
    expect(screen.getByLabelText('Muted')).toBeInTheDocument();
  });

  it('toggles play transport when play button clicked', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    const play = screen.getByTitle('Play / pause');
    expect(play).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(play);
    expect(play).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(play);
    expect(play).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles record transport and stop resets it', () => {
    const onStopAll = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onStopAll={onStopAll} />);
    const rec = screen.getByTitle('Arm record');
    fireEvent.click(rec);
    expect(rec).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTitle('Stop all clips'));
    expect(rec).toHaveAttribute('aria-pressed', 'false');
    expect(onStopAll).toHaveBeenCalled();
  });

  it('toggles loop and metronome', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    const loop = screen.getByTitle('Loop');
    const metro = screen.getByTitle('Metronome');
    fireEvent.click(loop);
    expect(loop).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(metro);
    expect(metro).toHaveAttribute('aria-pressed', 'true');
  });

  it('fires onTempoChange when bpm input changes', () => {
    const onTempoChange = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} tempo={128} onTempoChange={onTempoChange} />);
    const bpm = screen.getByDisplayValue('128') as HTMLInputElement;
    fireEvent.change(bpm, { target: { value: '140' } });
    expect(onTempoChange).toHaveBeenCalledWith(140);
  });

  it('keeps prior tempo when bpm input becomes invalid (0/empty)', () => {
    const onTempoChange = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} tempo={120} onTempoChange={onTempoChange} />);
    const bpm = screen.getByDisplayValue('120') as HTMLInputElement;
    fireEvent.change(bpm, { target: { value: '' } });
    // Number('') is 0 → falsy → falls back to tempoLocal (120)
    expect(onTempoChange).toHaveBeenLastCalledWith(120);
  });

  it('calls onLaunchClip when a populated clip is clicked', () => {
    const onLaunchClip = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onLaunchClip={onLaunchClip} />);
    fireEvent.click(screen.getByText('Kick loop'));
    expect(onLaunchClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 't1', sceneId: 's1' }));
  });

  it('calls onDoubleClickClip when a populated clip is double-clicked', () => {
    const onDoubleClickClip = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onDoubleClickClip={onDoubleClickClip} />);
    fireEvent.doubleClick(screen.getByText('Kick loop'));
    expect(onDoubleClickClip).toHaveBeenCalled();
  });

  it('calls onLaunchScene when a scene name button is clicked', () => {
    const onLaunchScene = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onLaunchScene={onLaunchScene} />);
    fireEvent.click(screen.getByText('Intro'));
    expect(onLaunchScene).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it('calls onClickEmptyCell when an empty cell is clicked', () => {
    const onClickEmptyCell = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onClickEmptyCell={onClickEmptyCell} />);
    fireEvent.click(screen.getByLabelText('Empty slot Synth scene Verse'));
    expect(onClickEmptyCell).toHaveBeenCalledWith('t3', 's2');
  });

  it('fires onCellHover on mouse enter and leave', () => {
    const onCellHover = vi.fn();
    const { container } = render(
      <SessionView tracks={tracks} scenes={scenes} clips={clips} onCellHover={onCellHover} />
    );
    const cell = container.querySelector('.w-40.shrink-0.p-1\\.5') as HTMLElement;
    fireEvent.mouseEnter(cell);
    fireEvent.mouseLeave(cell);
    expect(onCellHover).toHaveBeenCalledWith('t1', 's1');
    expect(onCellHover).toHaveBeenCalledWith(null, null);
  });

  it('handles drop of a valid concord-asset payload', () => {
    const onDropAsset = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onDropAsset={onDropAsset} />);
    const emptyCell = screen.getByLabelText('Empty slot Synth scene Verse');
    const payload = JSON.stringify({ assetId: 'a1', kind: 'audio', title: 'Loop' });
    fireEvent.drop(emptyCell, {
      dataTransfer: {
        getData: () => payload,
        types: ['application/x-concord-asset'],
      },
    });
    expect(onDropAsset).toHaveBeenCalledWith('t3', 's2', { assetId: 'a1', kind: 'audio', title: 'Loop' });
  });

  it('ignores drop with malformed JSON payload', () => {
    const onDropAsset = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onDropAsset={onDropAsset} />);
    const emptyCell = screen.getByLabelText('Empty slot Synth scene Verse');
    fireEvent.drop(emptyCell, {
      dataTransfer: { getData: () => 'not json{', types: ['application/x-concord-asset'] },
    });
    expect(onDropAsset).not.toHaveBeenCalled();
  });

  it('ignores drop with no payload data', () => {
    const onDropAsset = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onDropAsset={onDropAsset} />);
    const emptyCell = screen.getByLabelText('Empty slot Synth scene Verse');
    fireEvent.drop(emptyCell, {
      dataTransfer: { getData: () => '', types: [] },
    });
    expect(onDropAsset).not.toHaveBeenCalled();
  });

  it('renders playing and queued clip states', () => {
    render(
      <SessionView
        tracks={tracks}
        scenes={scenes}
        clips={clips}
        playingClipKey="t1:s1"
        queuedClipKeys={new Set(['t2:s1'])}
      />
    );
    expect(screen.getByText('Kick loop')).toBeInTheDocument();
    expect(screen.getByText('asset-bass')).toBeInTheDocument();
  });

  it('renders ghost cursors over a hovered cell', () => {
    render(
      <SessionView
        tracks={tracks}
        scenes={scenes}
        clips={clips}
        ghostCursors={[
          { userId: 'u1', userName: 'Aria', trackId: 't1', sceneId: 's1', color: '#fff' },
          { userId: 'u2', trackId: 't1', sceneId: 's1' },
        ]}
      />
    );
    expect(screen.getByTitle('Aria')).toBeInTheDocument();
    expect(screen.getByTitle('u2')).toBeInTheDocument();
  });

  it('renders with empty tracks/scenes', () => {
    render(<SessionView tracks={[]} scenes={[]} clips={{}} />);
    expect(screen.getByText('0 tracks · 0 scenes')).toBeInTheDocument();
  });
});
