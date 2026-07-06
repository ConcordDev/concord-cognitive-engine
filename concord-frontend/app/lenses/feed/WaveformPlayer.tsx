'use client';

// Extracted from page.tsx — Next.js rejects non-page exports from a page
// file ("WaveformPlayer" is not a valid Page export field), but the
// component needs to be exported so WaveformPlayer.test.tsx can exercise
// the honest-playback contract.

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AudioAttachment {
  title: string;
  duration: string;
  bitrate?: number;
  waveform: number[];
}

export function WaveformPlayer({
  waveform,
  duration,
  bitrate,
  title,
}: AudioAttachment & { className?: string }) {
  const [playing, setPlaying] = useState(false);

  // NOTE: AudioAttachment carries no real audio URL/source (no `url` field,
  // no HTMLAudioElement) — there is no real playback happening here. The
  // previous code faked a numeric progress percentage via a bare setInterval
  // with no backing state, which CLAUDE.md's honest-by-construction rule
  // forbids. Until the backend/DTU pipeline surfaces a real playable URL
  // (out of scope for this file), this shows an honest indeterminate
  // "playing" state instead of a fabricated percentage. Follow-up: add a
  // `url` field to AudioAttachment + wire a real <audio> element whose
  // `timeupdate` event drives real progress.
  const togglePlay = useCallback(() => {
    setPlaying((prev) => !prev);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-xl bg-lattice-deep border border-lattice-border p-3"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-neon-cyan/20 text-neon-cyan flex items-center justify-center hover:bg-neon-cyan/30 transition-colors flex-shrink-0"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <FileText className="w-3.5 h-3.5 text-neon-cyan" />
            <span className="text-sm font-medium text-white truncate">{title}</span>
            {bitrate && <span className="text-xs text-gray-400">{bitrate} kbps</span>}
          </div>
          <div className={cn('flex items-end gap-[2px] h-8', playing && 'animate-pulse')}>
            {waveform.map((h, i) => (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-sm transition-colors duration-150',
                  playing ? 'bg-neon-cyan/70' : 'bg-gray-700'
                )}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
        <span className="text-xs text-gray-400 tabular-nums flex-shrink-0">{duration}</span>
      </div>
    </motion.div>
  );
}
