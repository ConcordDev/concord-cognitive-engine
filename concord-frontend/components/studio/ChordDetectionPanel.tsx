'use client';

// ChordDetectionPanel — Sprint C Item #2.
//
// Live "what chord am I hearing" panel. Snaps a 750ms window off the
// master analyser, runs FFT + 24-template matching, surfaces top-3
// candidates with confidence bars. Honestly framed as "best guess" —
// the algorithm hits ~70% on clean audio and ~40% on busy mixes.

import { useState, useCallback, useEffect } from 'react';
import { Search, Music, RefreshCw, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { analyzeSnapshot, type ChordCandidate } from '@/lib/daw/chord-detect';

interface ChordDetectionPanelProps {
  masterAnalyser?: AnalyserNode | null;
  sampleRate?: number;
  autoRefreshMs?: number;     // 0 = manual only
  /** Optional URL/path of the harmonic 'other' stem from the stem
   *  splitter (Sprint C #4). When set, the panel surfaces a "Use
   *  harmonic stem (more accurate)" toggle that bypasses the
   *  master-bus snapshot path. */
  harmonicStemUrl?: string;
}

export default function ChordDetectionPanel({
  masterAnalyser, sampleRate = 44100, autoRefreshMs = 1500, harmonicStemUrl,
}: ChordDetectionPanelProps) {
  const [candidates, setCandidates] = useState<ChordCandidate[]>([]);
  const [live, setLive] = useState(false);
  const [history, setHistory] = useState<ChordCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [useStem, setUseStem] = useState(!!harmonicStemUrl);

  const pushCandidates = useCallback((result: ChordCandidate[]) => {
    setCandidates(result);
    if (result[0] && result[0].confidence > 0.4) {
      setHistory(prev => {
        const last = prev[prev.length - 1];
        if (last && last.name === result[0].name) return prev;
        const next = [...prev, result[0]];
        return next.length > 16 ? next.slice(next.length - 16) : next;
      });
    }
  }, []);

  // Snapshot mode A: live master-bus analyser.
  const snapshotLive = useCallback(() => {
    if (!masterAnalyser) {
      setError('No master analyser available.');
      return;
    }
    setError(null);
    const buf = new Float32Array(masterAnalyser.fftSize);
    masterAnalyser.getFloatTimeDomainData(buf);
    pushCandidates(analyzeSnapshot(buf, sampleRate));
  }, [masterAnalyser, sampleRate, pushCandidates]);

  // Snapshot mode B: decode the harmonic stem URL once + analyse a
  // 750ms window from the start. More accurate because the splitter
  // already stripped percussion + vocals.
  const snapshotStem = useCallback(async () => {
    if (!harmonicStemUrl) return;
    setError(null);
    try {
      const resp = await fetch(harmonicStemUrl, { credentials: 'include' });
      const buf = await resp.arrayBuffer();
      const Ctx = (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
      const ctx = new Ctx({ sampleRate });
      const decoded = await ctx.decodeAudioData(buf);
      // Mono downmix of the first ~750ms.
      const samples = Math.min(decoded.length, Math.round(decoded.sampleRate * 0.75));
      const mono = new Float32Array(samples);
      const channels = decoded.numberOfChannels;
      for (let c = 0; c < channels; c++) {
        const ch = decoded.getChannelData(c);
        for (let i = 0; i < samples; i++) mono[i] += ch[i] / channels;
      }
      pushCandidates(analyzeSnapshot(mono, decoded.sampleRate));
      try { ctx.close(); } catch { /* ctx cleanup best-effort */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'stem_decode_failed');
    }
  }, [harmonicStemUrl, sampleRate, pushCandidates]);

  const snapshot = useCallback(() => {
    if (useStem && harmonicStemUrl) snapshotStem();
    else snapshotLive();
  }, [useStem, harmonicStemUrl, snapshotStem, snapshotLive]);

  useEffect(() => {
    if (!live || !autoRefreshMs) return;
    const t = setInterval(snapshot, autoRefreshMs);
    return () => clearInterval(t);
  }, [live, autoRefreshMs, snapshot]);

  return (
    <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-neon-purple" />
          <h3 className="text-xs font-semibold">Chord Detection</h3>
          <span className="text-[9px] text-gray-500">
            best-guess pure-JS · top-3 candidates
          </span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={snapshot}
            className="flex items-center gap-1 px-2 py-1 bg-neon-purple/10 text-neon-purple rounded text-[10px] hover:bg-neon-purple/20"
          >
            <Search className="w-3 h-3" /> Snap
          </button>
          <button
            onClick={() => setLive(v => !v)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-[10px]',
              live
                ? 'bg-neon-cyan/20 text-neon-cyan'
                : 'bg-white/5 text-gray-400 hover:bg-white/10',
            )}
          >
            <RefreshCw className={cn('w-3 h-3', live && 'animate-spin')} />
            {live ? 'Live' : 'Manual'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-[10px] text-red-300 bg-red-500/10 p-2 rounded">
          <AlertCircle className="w-3 h-3" /> {error}
        </div>
      )}

      {harmonicStemUrl && (
        <label className="flex items-center gap-2 text-[10px] text-gray-400 bg-neon-cyan/5 border border-neon-cyan/20 rounded px-2 py-1.5 cursor-pointer">
          <input
            type="checkbox" checked={useStem}
            onChange={e => setUseStem(e.target.checked)}
            className="accent-neon-cyan"
          />
          <span>Use harmonic stem (more accurate) — bypasses the noisy master bus</span>
        </label>
      )}

      {candidates.length === 0 ? (
        <div className="text-[11px] text-gray-500 italic">
          Press Snap (or enable Live) to analyse the current master-bus signal.
        </div>
      ) : (
        <div className="space-y-1.5">
          {candidates.map((c, i) => (
            <div key={c.name} className="flex items-center gap-2">
              <div className="w-14 text-xs font-mono font-bold">{c.name}</div>
              <div className="flex-1 h-2 bg-black/40 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    i === 0 ? 'bg-neon-purple' : i === 1 ? 'bg-neon-cyan/70' : 'bg-white/30',
                  )}
                  style={{ width: `${Math.max(2, c.confidence * 100)}%` }}
                />
              </div>
              <div className="w-10 text-[10px] text-gray-400 font-mono text-right">
                {(c.confidence * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="pt-2 border-t border-white/5">
          <div className="text-[9px] text-gray-500 uppercase mb-1">Recent</div>
          <div className="flex flex-wrap gap-1">
            {history.map((h, i) => (
              <span
                key={i}
                className="text-[10px] font-mono px-1.5 py-0.5 bg-white/5 rounded text-gray-300"
              >
                {h.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
