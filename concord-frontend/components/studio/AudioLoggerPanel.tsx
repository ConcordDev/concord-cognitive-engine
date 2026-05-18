'use client';

// AudioLoggerPanel — Sprint C Item #8.
//
// Always-on master-bus logger. Privacy posture: opt-in, persistent
// "REC" indicator while running, IndexedDB-local (never sent off
// the device until the user explicitly saves a segment as a draft
// DTU).

import { useEffect, useState, useCallback, useRef } from 'react';
import { Mic, Square, Save, Trash2, Disc3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  startAudioLogger, listChunks, clearAll, saveSegmentToWav,
  type AudioChunk, type AudioLoggerHandle,
} from '@/lib/daw/audio-logger';

interface AudioLoggerPanelProps {
  masterAnalyser?: AnalyserNode | null;
}

export default function AudioLoggerPanel({ masterAnalyser }: AudioLoggerPanelProps) {
  const [running, setRunning] = useState(false);
  const [chunks, setChunks] = useState<AudioChunk[]>([]);
  const handleRef = useRef<AudioLoggerHandle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const all = await listChunks();
      setChunks(all.sort((a, b) => a.startMs - b.startMs));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'list_failed');
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh chunk list every 5s while running.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [running, refresh]);

  const start = useCallback(() => {
    if (!masterAnalyser) {
      setError('No master analyser available — open Studio with a project first.');
      return;
    }
    setError(null);
    handleRef.current = startAudioLogger(masterAnalyser);
    setRunning(true);
  }, [masterAnalyser]);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setRunning(false);
    refresh();
  }, [refresh]);

  useEffect(() => () => { handleRef.current?.stop(); }, []);

  const earliestMs = chunks[0]?.startMs;
  const latestMs = chunks[chunks.length - 1]?.endMs;
  const rangeSec = earliestMs && latestMs ? (latestMs - earliestMs) / 1000 : 0;

  const saveLastSeconds = useCallback(async (seconds: number, title: string) => {
    if (!latestMs) return;
    setBusy(`save-${seconds}`);
    try {
      const startMs = latestMs - seconds * 1000;
      const result = await saveSegmentToWav(startMs, latestMs);
      if (!result) { setError('No audio in that window.'); return; }
      // Promote as draft DTU via dtu mint endpoint (best-effort —
      // dev server has dtu.create as a STATE-only mint, so this
      // double-writes nothing harmful).
      const fd = new FormData();
      fd.append('file', result.blob, `${title.replace(/\s+/g, '_')}.wav`);
      fd.append('title', title);
      fd.append('kind', 'audio_capture');
      fd.append('duration_sec', String(result.durationSec));
      try {
        await fetch('/api/dtus/upload-audio-capture', { method: 'POST', credentials: 'include', body: fd });
      } catch { /* upload optional */ }
      setSavedToast(`Saved ${seconds}s as draft: ${title}`);
      setTimeout(() => setSavedToast(null), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save_failed');
    } finally {
      setBusy(null);
    }
  }, [latestMs]);

  const clearLogger = useCallback(async () => {
    if (!confirm('Clear the entire audio logger buffer?')) return;
    setBusy('clear');
    try {
      await clearAll();
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  return (
    <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-neon-pink" />
          <h3 className="text-xs font-semibold">Audio Logger</h3>
          <span className="text-[9px] text-gray-500">FL Studio 2026 parity · local-only</span>
        </div>
        {running ? (
          <button
            onClick={stop}
            className="flex items-center gap-1 px-2.5 py-1 bg-red-500/20 text-red-300 rounded text-[10px] font-medium hover:bg-red-500/30"
          >
            <Square className="w-3 h-3 fill-current" /> Stop
          </button>
        ) : (
          <button
            onClick={start}
            disabled={!masterAnalyser}
            className="flex items-center gap-1 px-2.5 py-1 bg-neon-pink/20 text-neon-pink rounded text-[10px] font-medium hover:bg-neon-pink/30 disabled:opacity-50"
          >
            <Disc3 className="w-3 h-3" /> Start
          </button>
        )}
      </div>

      {running && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-red-500/10 border border-red-500/30 rounded text-[10px] text-red-300">
          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          REC · master bus → IndexedDB · nothing leaves the device until you save
        </div>
      )}

      {error && (
        <div className="text-[10px] text-red-400 bg-red-500/10 p-2 rounded">{error}</div>
      )}
      {savedToast && (
        <div className="text-[10px] text-neon-green bg-neon-green/10 p-2 rounded">{savedToast}</div>
      )}

      <div className="text-[10px] text-gray-400">
        Buffered: {chunks.length} chunks · ~{Math.round(rangeSec)}s of audio
      </div>

      {chunks.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-gray-500 uppercase">Save a moment as draft DTU</div>
          <div className="grid grid-cols-3 gap-2">
            {[15, 30, 60].map(sec => (
              <button
                key={sec}
                onClick={() => saveLastSeconds(sec, `Last ${sec}s — ${new Date().toLocaleTimeString()}`)}
                disabled={busy === `save-${sec}` || rangeSec < sec}
                className="flex items-center justify-center gap-1 px-2 py-1.5 bg-neon-cyan/10 text-neon-cyan rounded text-[10px] hover:bg-neon-cyan/20 disabled:opacity-30"
                title={rangeSec < sec ? `Need ${sec}s buffered first` : `Save the last ${sec} seconds`}
              >
                <Save className="w-3 h-3" /> Last {sec}s
              </button>
            ))}
          </div>
          <button
            onClick={clearLogger}
            disabled={busy === 'clear'}
            className={cn(
              'w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[10px]',
              'bg-white/5 text-gray-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50',
            )}
          >
            <Trash2 className="w-3 h-3" /> Clear buffer
          </button>
        </div>
      )}
    </div>
  );
}
