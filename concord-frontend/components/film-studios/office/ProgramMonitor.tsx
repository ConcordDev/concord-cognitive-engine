'use client';

/**
 * The program monitor: plays the cut as cut. Clip after clip on V1, each from
 * its own footage at its source in-point for its timeline duration, with the
 * timeline drawn below and the playhead on it. A clip with no footage is
 * marked and skipped, never filled with something that isn't there.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack } from 'lucide-react';
import { fs, tc, type CutClip } from './fo';

export interface MonitorHandle { seek: (sec: number) => void; time: () => number }

export const ProgramMonitor = forwardRef<MonitorHandle, { sequenceId: string; pins?: { sec: number; open: boolean }[]; onTime?: (sec: number) => void }>(function ProgramMonitor({ sequenceId, pins = [], onTime }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const [clips, setClips] = useState<CutClip[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const pendingSeek = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    setClips(null); setErr(null); setIdx(0); setT(0); setPlaying(false);
    void fs<{ tracks: Record<string, CutClip[]> }>('cut-list', { sequenceId }).then((r) => {
      if (!live) return;
      if (!r.ok) { setErr(r.error); setClips([]); return; }
      setClips(r.result?.tracks?.V1 || []);
    });
    return () => { live = false; };
  }, [sequenceId]);

  const total = useMemo(() => (clips || []).reduce((a, c) => a + c.durationSec, 0), [clips]);
  const playable = (c?: CutClip) => !!c && !!c.streamUrl && (c.mediaKind === 'video' || c.mediaKind === 'audio');
  const clip = clips?.[idx];

  // Load the current clip's footage at its in-point (+ any offset into the clip).
  useEffect(() => {
    const v = video.current;
    if (!v || !clip) return;
    if (!playable(clip)) return;
    const offset = pendingSeek.current ?? 0;
    pendingSeek.current = null;
    const want = clip.sourceInSec + Math.max(0, Math.min(offset, clip.durationSec - 0.05));
    const go = () => { try { v.currentTime = want; } catch { /* metadata not ready */ } if (playing) void v.play().catch(() => setPlaying(false)); };
    if (v.getAttribute('src') !== clip.streamUrl) { v.src = clip.streamUrl as string; v.onloadedmetadata = go; } else go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, clip?.id]);

  const advance = useCallback(() => {
    if (!clips) return;
    let n = idx + 1;
    while (n < clips.length && !playable(clips[n])) n++;
    if (n >= clips.length) { video.current?.pause(); setPlaying(false); return; }
    setIdx(n);
  }, [clips, idx]);

  const onTimeUpdate = () => {
    const v = video.current;
    if (!v || !clip) return;
    const inClip = v.currentTime - clip.sourceInSec;
    const now = clip.startSec + Math.max(0, inClip);
    setT(now); onTime?.(now);
    if (inClip >= clip.durationSec - 0.04) advance();
  };

  const seek = useCallback((sec: number) => {
    if (!clips?.length) return;
    const s = Math.max(0, Math.min(sec, total - 0.05));
    const i = clips.findIndex((c) => s >= c.startSec && s < c.startSec + c.durationSec);
    const target = i < 0 ? clips.length - 1 : i;
    pendingSeek.current = s - clips[target].startSec;
    setT(s); onTime?.(s);
    if (target === idx && playable(clips[target]) && video.current) { video.current.currentTime = clips[target].sourceInSec + (s - clips[target].startSec); pendingSeek.current = null; }
    else setIdx(target);
  }, [clips, idx, total, onTime]);
  useImperativeHandle(ref, () => ({ seek, time: () => t }), [seek, t]);

  const toggle = () => {
    const v = video.current; if (!v || !clips?.length) return;
    if (playing) { v.pause(); setPlaying(false); return; }
    if (!playable(clip)) { const n = clips.findIndex((c, i) => i >= idx && playable(c)); if (n < 0) return; setIdx(n); }
    setPlaying(true); void v.play().catch(() => setPlaying(false));
  };

  if (err) return <p className="fo-error" role="alert">{err}</p>;
  if (!clips) return <div className="fo-screen" role="status" aria-label="Loading the cut" />;
  const missing = clips.filter((c) => !playable(c)).length;
  return (
    <div className="space-y-2" data-testid="fo-monitor">
      <div className="fo-screen">
        <video ref={video} playsInline onTimeUpdate={onTimeUpdate} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} onEnded={advance} />
        {clip && <span className="fo-slug">{clip.name}{playable(clip) ? '' : ' · no footage'}</span>}
        {!clips.length && <p className="absolute inset-0 flex items-center justify-center text-[14px] text-[#9a9a9a]">This sequence has no clips on V1 yet.</p>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="fo-btn !px-2.5" onClick={() => seek(0)} aria-label="Back to the start"><SkipBack className="h-4 w-4" /></button>
        <button type="button" className="fo-btn fo-btn-tape !px-3" onClick={toggle} aria-label={playing ? 'Pause' : 'Play the cut'} disabled={!clips.some(playable)} data-testid="fo-monitor-play">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <span className="fo-tc text-[13px]">{tc(t)} / {tc(total)}</span>
        {missing > 0 && <span className="ml-auto text-[12px] text-[#c9a] ">{missing} clip{missing > 1 ? 's' : ''} without footage (skipped)</span>}
      </div>
      <div className="fo-track" role="slider" tabIndex={0} aria-label="Timeline position" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (total > 0) seek(((e.clientX - r.left) / r.width) * total); }}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(t + 1); if (e.key === 'ArrowLeft') seek(t - 1); }}>
        {total > 0 && clips.map((c, i) => (
          <span key={c.id} className="fo-clip" data-live={i === idx} data-empty={!playable(c)} style={{ left: `${(c.startSec / total) * 100}%`, width: `${(c.durationSec / total) * 100}%` }} title={`${c.name} · ${c.startTimecode}`}>{c.name}</span>
        ))}
        {total > 0 && pins.map((p, i) => <span key={i} className="fo-note-pin" style={{ left: `${(p.sec / total) * 100}%`, opacity: p.open ? 1 : 0.35 }} aria-hidden />)}
        {total > 0 && <span className="fo-head" style={{ left: `${(t / total) * 100}%` }} />}
      </div>
    </div>
  );
});
