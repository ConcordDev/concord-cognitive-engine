'use client';

/**
 * SessionClipPicker — assign a real track from the user's own library
 * into a Session-view grid cell.
 *
 * Matches the DTUPickerModal idiom used elsewhere in the app (search +
 * scrollable list + click to pick) so the Session grid's empty-cell
 * affordance reads as a designed feature, not a generic prompt/textarea.
 * Every row is a real track (by id/title/artist) already in the user's
 * library — nothing here is fabricated or placeholder content.
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, X, Music2, Play } from 'lucide-react';
import type { MusicTrack } from '@/lib/music/types';

interface SessionClipPickerProps {
  tracks: MusicTrack[];
  channelName: string;
  sceneName: string;
  onSelect: (track: MusicTrack) => void;
  onClose: () => void;
}

export function SessionClipPicker({ tracks, channelName, sceneName, onSelect, onClose }: SessionClipPickerProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return tracks;
    const q = search.toLowerCase();
    return tracks.filter(
      (t) => t.title?.toLowerCase().includes(q) || t.artistName?.toLowerCase().includes(q) || t.genre?.toLowerCase().includes(q)
    );
  }, [tracks, search]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Assign a track to this slot"
        className="bg-lattice-surface border border-white/10 rounded-xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <Music2 className="w-4 h-4 text-neon-cyan" />
            Assign to {channelName} &middot; {sceneName}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your tracks…"
              className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-cyan/40"
            />
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400 px-4">
              {tracks.length === 0
                ? 'Upload a track first — the grid only launches real tracks from your library.'
                : 'No tracks match your search.'}
            </div>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelect(t)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-0"
              >
                <span className="w-6 h-6 rounded-full bg-neon-cyan/10 flex items-center justify-center flex-shrink-0">
                  <Play className="w-3 h-3 text-neon-cyan" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.title}</p>
                  <p className="text-[10px] text-gray-400 truncate">{t.artistName || 'Unknown artist'}{t.bpm ? ` · ${t.bpm} BPM` : ''}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export default SessionClipPicker;
