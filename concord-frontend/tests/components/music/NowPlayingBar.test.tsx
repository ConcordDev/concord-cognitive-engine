import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async (importOriginal) => {
  const ReactM = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = ReactM.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      ReactM.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
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

vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', { ...props, alt: String(props.alt || '') }),
}));

const store = {
  nowPlaying: { track: null as unknown, playbackState: 'paused', currentTime: 30, duration: 200, volume: 0.7, muted: false, repeat: 'off', shuffle: false },
  setPlaybackState: vi.fn(),
  setCurrentTime: vi.fn(),
  setDuration: vi.fn(),
  setVolume: vi.fn(),
  toggleMute: vi.fn(),
  setRepeat: vi.fn(),
  toggleShuffle: vi.fn(),
  nextTrack: vi.fn(() => null),
  previousTrack: vi.fn(() => null),
  hasNext: vi.fn(() => true),
  hasPrevious: vi.fn(() => true),
  queue: [] as unknown[],
  queueIndex: 0,
};
vi.mock('@/lib/music/store', () => ({ useMusicStore: () => store }));

const player = {
  on: vi.fn(() => () => {}),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
  setMuted: vi.fn(),
  loadTrack: vi.fn(() => Promise.resolve()),
  getFrequencyData: vi.fn(() => null),
};
vi.mock('@/lib/music/player', () => ({ getPlayer: () => player }));

import { NowPlayingBar } from '@/components/music/NowPlayingBar';

const track = {
  id: 'tk1', title: 'Aurora', artistName: 'Nova', albumTitle: 'First Light',
  coverArtUrl: null, duration: 200, bpm: 120, key: 'Cmaj', genre: 'ambient',
  waveformPeaks: [0.1, -0.2, 0.5],
};

describe('NowPlayingBar', () => {
  beforeEach(() => {
    Object.values(player).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockClear?.());
    Object.values(store).forEach((f) => typeof f === 'function' && (f as ReturnType<typeof vi.fn>).mockClear?.());
    store.nowPlaying = { track: null, playbackState: 'paused', currentTime: 30, duration: 200, volume: 0.7, muted: false, repeat: 'off', shuffle: false };
    store.nextTrack.mockReturnValue(null);
    store.previousTrack.mockReturnValue(null);
    store.hasNext.mockReturnValue(true);
    store.hasPrevious.mockReturnValue(true);
    store.queue = [];
  });

  it('renders nothing when there is no track', () => {
    const { container } = render(<NowPlayingBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders track info when a track is set', () => {
    store.nowPlaying = { ...store.nowPlaying, track };
    render(<NowPlayingBar />);
    expect(screen.getByText('Aurora')).toBeInTheDocument();
    expect(screen.getByText('Nova')).toBeInTheDocument();
  });

  it('play/pause button calls player.play when paused', () => {
    store.nowPlaying = { ...store.nowPlaying, track, playbackState: 'paused' };
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Play'));
    expect(player.play).toHaveBeenCalled();
  });

  it('play/pause button calls player.pause when playing', () => {
    store.nowPlaying = { ...store.nowPlaying, track, playbackState: 'playing' };
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(player.pause).toHaveBeenCalled();
  });

  it('shuffle toggle calls toggleShuffle', () => {
    store.nowPlaying = { ...store.nowPlaying, track };
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Enable shuffle'));
    expect(store.toggleShuffle).toHaveBeenCalled();
  });

  it('next/previous load the next/previous track when available', () => {
    store.nowPlaying = { ...store.nowPlaying, track };
    store.nextTrack.mockReturnValue(track);
    store.previousTrack.mockReturnValue(track);
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Next track'));
    fireEvent.click(screen.getByLabelText('Previous track'));
    expect(player.loadTrack).toHaveBeenCalledTimes(2);
  });

  it('next/previous are disabled when there is no next/previous', () => {
    store.nowPlaying = { ...store.nowPlaying, track };
    store.hasNext.mockReturnValue(false);
    store.hasPrevious.mockReturnValue(false);
    render(<NowPlayingBar />);
    expect(screen.getByLabelText('Next track')).toBeDisabled();
    expect(screen.getByLabelText('Previous track')).toBeDisabled();
  });

  it('repeat button cycles repeat modes', () => {
    store.nowPlaying = { ...store.nowPlaying, track, repeat: 'off' };
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Enable repeat'));
    expect(store.setRepeat).toHaveBeenCalledWith('all');
  });

  it('mute toggle calls toggleMute and player.setMuted', () => {
    store.nowPlaying = { ...store.nowPlaying, track };
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Mute'));
    expect(store.toggleMute).toHaveBeenCalled();
    expect(player.setMuted).toHaveBeenCalled();
  });

  it('queue toggle and expand toggle change their labels', () => {
    store.nowPlaying = { ...store.nowPlaying, track };
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Show queue'));
    expect(screen.getByLabelText('Hide queue')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Expand player'));
    expect(screen.getByLabelText('Collapse player')).toBeInTheDocument();
  });

  it('like button dispatches a music:like-track event', () => {
    const handler = vi.fn();
    window.addEventListener('music:like-track', handler);
    store.nowPlaying = { ...store.nowPlaying, track };
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Like track'));
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('music:like-track', handler);
  });

  it('expanded view renders waveform and queue when both toggled', () => {
    store.nowPlaying = { ...store.nowPlaying, track };
    store.queue = [{ id: 'qi1', track: { ...track, id: 'qt1', title: 'Queued', duration: 100 } }];
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Expand player'));
    fireEvent.click(screen.getByLabelText('Show queue'));
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText(/Queue \(1\)/)).toBeInTheDocument();
  });

  it('expanded view shows "No waveform data" when peaks are empty', () => {
    store.nowPlaying = { ...store.nowPlaying, track: { ...track, waveformPeaks: [] } };
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Expand player'));
    expect(screen.getByText('No waveform data')).toBeInTheDocument();
  });

  it('volume slider appears on hover and changes volume', () => {
    store.nowPlaying = { ...store.nowPlaying, track };
    render(<NowPlayingBar />);
    const muteBtn = screen.getByLabelText('Mute');
    fireEvent.mouseEnter(muteBtn.parentElement!);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '0.4' } });
    expect(store.setVolume).toHaveBeenCalledWith(0.4);
  });

  it('shows VolumeX label when muted', () => {
    store.nowPlaying = { ...store.nowPlaying, track, muted: true };
    render(<NowPlayingBar />);
    expect(screen.getByLabelText('Unmute')).toBeInTheDocument();
  });

  it('scrubbing the progress bar with mouse down/move/up calls player.seek', () => {
    store.nowPlaying = { ...store.nowPlaying, track, duration: 200 };
    const { container } = render(<NowPlayingBar />);
    const progress = container.querySelector('.cursor-pointer') as HTMLElement;
    progress.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 1, right: 200, bottom: 1, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseDown(progress, { clientX: 100 });
    fireEvent.mouseMove(progress, { clientX: 150 });
    fireEvent.mouseUp(progress);
    expect(player.seek).toHaveBeenCalled();
  });

  it('mouse-leave on the progress bar ends an in-progress seek', () => {
    store.nowPlaying = { ...store.nowPlaying, track, duration: 200 };
    const { container } = render(<NowPlayingBar />);
    const progress = container.querySelector('.cursor-pointer') as HTMLElement;
    progress.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 1, right: 200, bottom: 1, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseDown(progress, { clientX: 50 });
    fireEvent.mouseLeave(progress);
    expect(player.seek).toHaveBeenCalled();
  });

  it('repeat at "all" advances to "one"', () => {
    store.nowPlaying = { ...store.nowPlaying, track, repeat: 'all' };
    render(<NowPlayingBar />);
    // repeat='all' -> aria-label is 'Disable repeat'
    fireEvent.click(screen.getByLabelText('Disable repeat'));
    expect(store.setRepeat).toHaveBeenCalledWith('one');
  });

  it('repeat at "one" wraps back to "off"', () => {
    store.nowPlaying = { ...store.nowPlaying, track, repeat: 'one' };
    render(<NowPlayingBar />);
    fireEvent.click(screen.getByLabelText('Repeat all'));
    expect(store.setRepeat).toHaveBeenCalledWith('off');
  });

  it('disable shuffle label appears when shuffle already on', () => {
    store.nowPlaying = { ...store.nowPlaying, track, shuffle: true };
    render(<NowPlayingBar />);
    expect(screen.getByLabelText('Disable shuffle')).toBeInTheDocument();
  });

  it('registers player event listeners on mount', () => {
    store.nowPlaying = { ...store.nowPlaying, track };
    render(<NowPlayingBar />);
    // play/pause/stop/loading/buffering/timeupdate/ended/error = 8 subscriptions
    expect(player.on).toHaveBeenCalled();
    expect(player.on.mock.calls.map((c) => c[0])).toEqual(
      expect.arrayContaining(['play', 'pause', 'timeupdate', 'ended', 'error'])
    );
  });

  it('runs the spectrum visualizer draw loop when playing', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1 as unknown as number);
    const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
    const getCtx = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    player.getFrequencyData.mockReturnValue(new Uint8Array(64).fill(128));
    store.nowPlaying = { ...store.nowPlaying, track, playbackState: 'playing' };
    render(<NowPlayingBar />);
    expect(rafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
    getCtx.mockRestore();
  });
});
