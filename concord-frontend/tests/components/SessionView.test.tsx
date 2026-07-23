import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { SessionView, type SessionTrack, type SessionScene, type SessionClip } from '@/components/music/SessionView';

const tracks: SessionTrack[] = [
  { id: 'tr1', name: 'Drums' },
  { id: 'tr2', name: 'Bass' },
  { id: 'tr3', name: 'Pad' },
];

const scenes: SessionScene[] = [
  { id: 's1', name: 'Intro' },
  { id: 's2', name: 'Verse' },
];

const clips: Record<string, SessionClip> = {
  'tr1:s1': { trackId: 'tr1', sceneId: 's1', label: 'kick-loop', hasContent: true },
  'tr2:s1': { trackId: 'tr2', sceneId: 's1', label: 'sub-bass', hasContent: true },
  'tr1:s2': { trackId: 'tr1', sceneId: 's2', label: 'kick-bk', hasContent: true },
};

describe('SessionView', () => {
  it('renders track names as columns', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    expect(screen.getByText('Drums')).toBeInTheDocument();
    expect(screen.getByText('Bass')).toBeInTheDocument();
    expect(screen.getByText('Pad')).toBeInTheDocument();
  });

  it('renders scene names as rows', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    expect(screen.getByText('Intro')).toBeInTheDocument();
    expect(screen.getByText('Verse')).toBeInTheDocument();
  });

  it('renders clip labels in their cells', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    expect(screen.getByText('kick-loop')).toBeInTheDocument();
    expect(screen.getByText('sub-bass')).toBeInTheDocument();
  });

  it('calls onLaunchClip when a clip is activated', () => {
    const onLaunchClip = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onLaunchClip={onLaunchClip} />);
    fireEvent.click(screen.getByText('kick-loop'));
    expect(onLaunchClip).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'tr1', sceneId: 's1' }));
  });

  it('calls onClickEmptyCell for a slot with no clip', () => {
    const onClickEmptyCell = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onClickEmptyCell={onClickEmptyCell} />);
    // tr3 (Pad) has no clip in any scene — its empty slots are `aria-label`led.
    fireEvent.click(screen.getByLabelText('Empty slot Pad scene Intro'));
    expect(onClickEmptyCell).toHaveBeenCalledWith('tr3', 's1');
  });

  it('does not render mute/solo buttons when no handler is wired (back-compat)', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    expect(screen.queryByTitle('Mute')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Solo')).not.toBeInTheDocument();
    // The old static "shift-click track → solo" claim should not be made
    // when there is no way to solo a track.
    expect(screen.queryByText(/shift-click/i)).not.toBeInTheDocument();
  });

  it('renders discoverable mute/solo buttons and calls the real toggles', () => {
    const onToggleMute = vi.fn();
    const onToggleSolo = vi.fn();
    render(
      <SessionView
        tracks={tracks}
        scenes={scenes}
        clips={clips}
        onToggleMute={onToggleMute}
        onToggleSolo={onToggleSolo}
      />
    );
    expect(screen.getAllByTitle('Mute').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTitle('Mute')[0]);
    expect(onToggleMute).toHaveBeenCalledWith('tr1');
    fireEvent.click(screen.getAllByTitle('Solo')[0]);
    expect(onToggleSolo).toHaveBeenCalledWith('tr1');
    // Footer now honestly advertises the wired interaction.
    expect(screen.getByText(/mute \/ solo/i)).toBeInTheDocument();
  });

  it('dims a muted track column', () => {
    const mutedTracks: SessionTrack[] = [{ ...tracks[0], muted: true }, tracks[1], tracks[2]];
    const { container } = render(
      <SessionView tracks={mutedTracks} scenes={scenes} clips={clips} onToggleMute={vi.fn()} />
    );
    const mutedHeader = screen.getByText('Drums').closest('.group');
    expect(mutedHeader?.className).toMatch(/opacity-50/);
    void container;
  });

  it('renames a track in place via double-click, Enter commits', () => {
    const onRenameTrack = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onRenameTrack={onRenameTrack} />);
    fireEvent.doubleClick(screen.getByText('Drums'));
    const input = screen.getByDisplayValue('Drums');
    fireEvent.change(input, { target: { value: 'Kick + Snare' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRenameTrack).toHaveBeenCalledWith('tr1', 'Kick + Snare');
  });

  it('renames a scene in place via double-click on its label', () => {
    const onRenameScene = vi.fn();
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} onRenameScene={onRenameScene} />);
    fireEvent.doubleClick(screen.getByText('Intro'));
    const input = screen.getByDisplayValue('Intro');
    fireEvent.change(input, { target: { value: 'Cold Open' } });
    fireEvent.blur(input);
    expect(onRenameScene).toHaveBeenCalledWith('s1', 'Cold Open');
  });

  it('does not rename when no handler is provided (name stays a static label)', () => {
    render(<SessionView tracks={tracks} scenes={scenes} clips={clips} />);
    fireEvent.doubleClick(screen.getByText('Drums'));
    expect(screen.queryByDisplayValue('Drums')).not.toBeInTheDocument();
  });

  it('honors a custom double-click-clip label in the clip button tooltip', () => {
    render(
      <SessionView
        tracks={tracks}
        scenes={scenes}
        clips={clips}
        onDoubleClickClip={vi.fn()}
        doubleClickClipLabel="remove"
      />
    );
    expect(screen.getByText('kick-loop').closest('button')?.title).toMatch(/double-click to remove/);
  });
});
