// ============================================================================
// Music Store — Zustand
// Global Now Playing + Queue state. Persists across lens navigation.
// Queue persisted to localStorage. Survives page refresh.
// ============================================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  MusicTrack,
  PlaybackState,
  RepeatMode,
  QueueItem,
  QueueSource,
  NowPlayingState,
} from './types';

// ---- Queue Helpers ----

function generateQueueId(): string {
  return `qi-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ---- Store Interface ----

interface MusicStore {
  // Now Playing
  nowPlaying: NowPlayingState;

  // Queue
  queue: QueueItem[];
  queueIndex: number;
  queueHistory: QueueItem[];
  originalQueue: QueueItem[]; // for un-shuffling

  // Actions — Playback
  setTrack: (track: MusicTrack) => void;
  setPlaybackState: (state: PlaybackState) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setRepeat: (mode: RepeatMode) => void;
  toggleShuffle: () => void;

  // Actions — Queue
  playTrack: (track: MusicTrack, source?: QueueSource) => void;
  playAlbum: (tracks: MusicTrack[], startIndex?: number) => void;
  playPlaylist: (tracks: MusicTrack[], playlistId: string, playlistName: string, startIndex?: number) => void;
  addToQueue: (track: MusicTrack, source?: QueueSource) => void;
  addMultipleToQueue: (tracks: MusicTrack[], source?: QueueSource) => void;
  removeFromQueue: (queueItemId: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  nextTrack: () => MusicTrack | null;
  previousTrack: () => MusicTrack | null;
  skipTo: (queueIndex: number) => MusicTrack | null;

  // Computed
  hasNext: () => boolean;
  hasPrevious: () => boolean;
  queueLength: () => number;
}

export const useMusicStore = create<MusicStore>()(
  persist(
    (set, get) => ({
      // ---- Initial State ----
      nowPlaying: {
        track: null,
        playbackState: 'stopped',
        currentTime: 0,
        duration: 0,
        volume: 1,
        muted: false,
        repeat: 'off',
        shuffle: false,
      },
      queue: [],
      queueIndex: -1,
      queueHistory: [],
      originalQueue: [],

      // ---- Playback Actions ----

      setTrack: (track) => set((state) => ({
        nowPlaying: { ...state.nowPlaying, track, currentTime: 0 },
      })),

      setPlaybackState: (playbackState) => set((state) => ({
        nowPlaying: { ...state.nowPlaying, playbackState },
      })),

      setCurrentTime: (currentTime) => set((state) => ({
        nowPlaying: { ...state.nowPlaying, currentTime },
      })),

      setDuration: (duration) => set((state) => ({
        nowPlaying: { ...state.nowPlaying, duration },
      })),

      setVolume: (volume) => set((state) => ({
        nowPlaying: { ...state.nowPlaying, volume: Math.max(0, Math.min(1, volume)) },
      })),

      toggleMute: () => set((state) => ({
        nowPlaying: { ...state.nowPlaying, muted: !state.nowPlaying.muted },
      })),

      setRepeat: (repeat) => set((state) => ({
        nowPlaying: { ...state.nowPlaying, repeat },
      })),

      toggleShuffle: () => set((state) => {
        const newShuffle = !state.nowPlaying.shuffle;
        if (newShuffle) {
          // Save original order, shuffle remaining items
          const remaining = state.queue.slice(state.queueIndex + 1);
          const shuffled = shuffleArray(remaining);
          return {
            nowPlaying: { ...state.nowPlaying, shuffle: true },
            originalQueue: [...state.queue],
            queue: [
              ...state.queue.slice(0, state.queueIndex + 1),
              ...shuffled,
            ],
          };
        } else {
          // Restore original order
          return {
            nowPlaying: { ...state.nowPlaying, shuffle: false },
            queue: state.originalQueue.length > 0 ? state.originalQueue : state.queue,
            originalQueue: [],
          };
        }
      }),

      // ---- Queue Actions ----

      playTrack: (track, source = { type: 'manual' }) => {
        const item: QueueItem = {
          id: generateQueueId(),
          track,
          addedAt: Date.now(),
          source,
        };
        set({
          nowPlaying: {
            ...get().nowPlaying,
            track,
            playbackState: 'loading',
            currentTime: 0,
          },
          queue: [item, ...get().queue.slice(get().queueIndex + 1)],
          queueIndex: 0,
        });
      },

      playAlbum: (tracks, startIndex = 0) => {
        const items: QueueItem[] = tracks.map(track => ({
          id: generateQueueId(),
          track,
          addedAt: Date.now(),
          source: { type: 'album' as const, id: tracks[0]?.albumId || '', name: tracks[0]?.albumTitle || '' },
        }));
        set({
          nowPlaying: {
            ...get().nowPlaying,
            track: tracks[startIndex],
            playbackState: 'loading',
            currentTime: 0,
          },
          queue: items,
          queueIndex: startIndex,
          originalQueue: [],
        });
      },

      playPlaylist: (tracks, playlistId, playlistName, startIndex = 0) => {
        const items: QueueItem[] = tracks.map(track => ({
          id: generateQueueId(),
          track,
          addedAt: Date.now(),
          source: { type: 'playlist' as const, id: playlistId, name: playlistName },
        }));
        set({
          nowPlaying: {
            ...get().nowPlaying,
            track: tracks[startIndex],
            playbackState: 'loading',
            currentTime: 0,
          },
          queue: items,
          queueIndex: startIndex,
          originalQueue: [],
        });
      },

      addToQueue: (track, source = { type: 'manual' }) => {
        const item: QueueItem = {
          id: generateQueueId(),
          track,
          addedAt: Date.now(),
          source,
        };
        set((state) => ({
          queue: [...state.queue, item],
        }));
      },

      addMultipleToQueue: (tracks, source = { type: 'manual' }) => {
        const items: QueueItem[] = tracks.map(track => ({
          id: generateQueueId(),
          track,
          addedAt: Date.now(),
          source: source,
        }));
        set((state) => ({
          queue: [...state.queue, ...items],
        }));
      },

      removeFromQueue: (queueItemId) => set((state) => {
        const idx = state.queue.findIndex(q => q.id === queueItemId);
        if (idx === -1) return state;
        const newQueue = state.queue.filter(q => q.id !== queueItemId);
        let newIndex = state.queueIndex;
        if (idx < state.queueIndex) newIndex--;
        else if (idx === state.queueIndex) newIndex = Math.min(newIndex, newQueue.length - 1);
        return { queue: newQueue, queueIndex: newIndex };
      }),

      reorderQueue: (fromIndex, toIndex) => set((state) => {
        const newQueue = [...state.queue];
        const [moved] = newQueue.splice(fromIndex, 1);
        newQueue.splice(toIndex, 0, moved);
        let newIndex = state.queueIndex;
        if (fromIndex === state.queueIndex) newIndex = toIndex;
        else if (fromIndex < state.queueIndex && toIndex >= state.queueIndex) newIndex--;
        else if (fromIndex > state.queueIndex && toIndex <= state.queueIndex) newIndex++;
        return { queue: newQueue, queueIndex: newIndex };
      }),

      clearQueue: () => set((state) => ({
        queue: state.queueIndex >= 0 ? [state.queue[state.queueIndex]] : [],
        queueIndex: state.queueIndex >= 0 ? 0 : -1,
        originalQueue: [],
      })),

      nextTrack: () => {
        const { queue, queueIndex, nowPlaying } = get();
        const currentItem = queue[queueIndex];

        // Repeat one: replay current
        if (nowPlaying.repeat === 'one' && currentItem) {
          return currentItem.track;
        }

        // Next in queue
        if (queueIndex < queue.length - 1) {
          const nextIdx = queueIndex + 1;
          const nextItem = queue[nextIdx];
          set({
            queueIndex: nextIdx,
            queueHistory: currentItem ? [...get().queueHistory.slice(-49), currentItem] : get().queueHistory,
            nowPlaying: { ...nowPlaying, track: nextItem.track, currentTime: 0, playbackState: 'loading' },
          });
          return nextItem.track;
        }

        // Repeat all: go back to start
        if (nowPlaying.repeat === 'all' && queue.length > 0) {
          const firstItem = queue[0];
          set({
            queueIndex: 0,
            queueHistory: currentItem ? [...get().queueHistory.slice(-49), currentItem] : get().queueHistory,
            nowPlaying: { ...nowPlaying, track: firstItem.track, currentTime: 0, playbackState: 'loading' },
          });
          return firstItem.track;
        }

        // End of queue, no repeat
        set({ nowPlaying: { ...nowPlaying, playbackState: 'stopped' } });
        return null;
      },

      previousTrack: () => {
        const { queue, queueIndex, nowPlaying, queueHistory } = get();

        // If more than 3 seconds in, restart current track
        if (nowPlaying.currentTime > 3 && queue[queueIndex]) {
          set({ nowPlaying: { ...nowPlaying, currentTime: 0 } });
          return queue[queueIndex].track;
        }

        // Go to previous in queue
        if (queueIndex > 0) {
          const prevIdx = queueIndex - 1;
          const prevItem = queue[prevIdx];
          set({
            queueIndex: prevIdx,
            nowPlaying: { ...nowPlaying, track: prevItem.track, currentTime: 0, playbackState: 'loading' },
          });
          return prevItem.track;
        }

        // Check history
        if (queueHistory.length > 0) {
          const historyItem = queueHistory[queueHistory.length - 1];
          set({
            queueHistory: queueHistory.slice(0, -1),
            nowPlaying: { ...nowPlaying, track: historyItem.track, currentTime: 0, playbackState: 'loading' },
          });
          return historyItem.track;
        }

        // Nothing previous, restart current
        if (queue[queueIndex]) {
          set({ nowPlaying: { ...nowPlaying, currentTime: 0 } });
          return queue[queueIndex].track;
        }

        return null;
      },

      skipTo: (targetIndex) => {
        const { queue, queueIndex, nowPlaying } = get();
        if (targetIndex < 0 || targetIndex >= queue.length) return null;
        const currentItem = queue[queueIndex];
        const targetItem = queue[targetIndex];
        set({
          queueIndex: targetIndex,
          queueHistory: currentItem ? [...get().queueHistory.slice(-49), currentItem] : get().queueHistory,
          nowPlaying: { ...nowPlaying, track: targetItem.track, currentTime: 0, playbackState: 'loading' },
        });
        return targetItem.track;
      },

      // ---- Computed ----

      hasNext: () => {
        const { queue, queueIndex, nowPlaying } = get();
        if (nowPlaying.repeat === 'all' || nowPlaying.repeat === 'one') return queue.length > 0;
        return queueIndex < queue.length - 1;
      },

      hasPrevious: () => {
        const { queueIndex, queueHistory } = get();
        return queueIndex > 0 || queueHistory.length > 0;
      },

      queueLength: () => get().queue.length,
    }),
    {
      name: 'concord-music-store',
      partialize: (state) => ({
        queue: state.queue,
        queueIndex: state.queueIndex,
        nowPlaying: {
          ...state.nowPlaying,
          playbackState: 'paused' as PlaybackState, // don't auto-play on load
          currentTime: 0,
        },
      }),
    }
  )
);
