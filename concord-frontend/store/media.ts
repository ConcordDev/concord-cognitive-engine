/**
 * Global Media Store
 *
 * Audio/video playback state lives here, above the lens layer. A single
 * `<audio>` element mounted at the root layout reads from this store,
 * so playback continues unchanged as users navigate between lenses.
 *
 * Any lens can call `play(track)`, `pause()`, `enqueue(tracks)`, etc.
 * via `useGlobalMedia()`. The Music lens renders a full player when it
 * owns playback; everywhere else, a persistent mini-player bar at the
 * bottom of the screen lets users control the track.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface Track {
  id: string;
  title: string;
  artist: string;
  /** Audio/video URL or blob URL. */
  src: string;
  /** Optional cover art image URL. */
  albumArt?: string;
  /** Album or collection label. */
  album?: string;
  /** Source DTU id (for attribution). */
  dtuId?: string;
  /** Lens that originated this playback. */
  lens: string;
  /** Duration in seconds, if known ahead of time. */
  duration?: number;
}

export type RepeatMode = 'none' | 'one' | 'all';

interface MediaStore {
  currentTrack: Track | null;
  queue: Track[];
  history: Track[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;

  // Actions
  play: (track: Track) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  enqueue: (tracks: Track[]) => void;
  clearQueue: () => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setRepeat: (mode: RepeatMode) => void;
  toggleShuffle: () => void;

  // Internal updates from the <audio> element
  _setCurrentTime: (t: number) => void;
  _setDuration: (d: number) => void;
  _setIsPlaying: (playing: boolean) => void;
  _handleTrackEnd: () => void;
}

export const useMediaStore = create<MediaStore>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      history: [],
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 0.8,
      muted: false,
      repeat: 'none',
      shuffle: false,

      play: (track) =>
        set((state) => ({
          currentTrack: track,
          isPlaying: true,
          currentTime: 0,
          duration: track.duration || 0,
          history: state.currentTrack
            ? [state.currentTrack, ...state.history].slice(0, 50)
            : state.history,
        })),

      pause: () => set({ isPlaying: false }),
      resume: () => set((state) => (state.currentTrack ? { isPlaying: true } : {})),
      stop: () => set({ isPlaying: false, currentTrack: null, currentTime: 0, duration: 0 }),

      enqueue: (tracks) => set((state) => ({ queue: [...state.queue, ...tracks] })),
      clearQueue: () => set({ queue: [] }),

      next: () => {
        const { queue, currentTrack, history, repeat } = get();
        if (repeat === 'one' && currentTrack) {
          set({ currentTime: 0, isPlaying: true });
          return;
        }
        if (queue.length === 0) {
          if (repeat === 'all' && history.length > 0) {
            set({ currentTrack: history[0], isPlaying: true, currentTime: 0 });
            return;
          }
          set({ isPlaying: false });
          return;
        }
        const [nextTrack, ...rest] = queue;
        set((state) => ({
          currentTrack: nextTrack,
          queue: rest,
          history: state.currentTrack
            ? [state.currentTrack, ...state.history].slice(0, 50)
            : state.history,
          isPlaying: true,
          currentTime: 0,
          duration: nextTrack.duration || 0,
        }));
      },

      prev: () => {
        const { history, currentTrack, queue } = get();
        if (!history.length) {
          // Restart current track.
          set({ currentTime: 0 });
          return;
        }
        const [prevTrack, ...rest] = history;
        set({
          currentTrack: prevTrack,
          history: rest,
          queue: currentTrack ? [currentTrack, ...queue] : queue,
          isPlaying: true,
          currentTime: 0,
          duration: prevTrack.duration || 0,
        });
      },

      setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), muted: false }),
      toggleMute: () => set((state) => ({ muted: !state.muted })),
      setRepeat: (mode) => set({ repeat: mode }),
      toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),

      _setCurrentTime: (t) => set({ currentTime: t }),
      _setDuration: (d) => set({ duration: d }),
      _setIsPlaying: (playing) => set({ isPlaying: playing }),
      _handleTrackEnd: () => {
        const { repeat } = get();
        if (repeat === 'one') {
          set({ currentTime: 0, isPlaying: true });
          return;
        }
        get().next();
      },
    }),
    {
      name: 'concord-media',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.localStorage : (undefined as unknown as Storage),
      ),
      // Persist just enough to resume the previous session — the
      // current track, the queue, and user preferences. Transient
      // playback position is NOT persisted (resumes from 0).
      partialize: (state) => ({
        currentTrack: state.currentTrack,
        queue: state.queue,
        history: state.history,
        volume: state.volume,
        muted: state.muted,
        repeat: state.repeat,
        shuffle: state.shuffle,
      }),
    },
  ),
);
