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
});
