'use client';

/**
 * The press bar: the one player, along the foot of the page. It owns the
 * <audio> element and gives every room the same position (the transcript
 * reads it to light up what is being said). All of it is the real stream:
 * episode-stream for the source, resume point and chapters; sync-push every
 * 10 s of playback and on pause; speed, sleep timer, skip-intro and trim
 * silence are the stored playback prefs. For a supporters-only episode the
 * server streams only the preview to a non-supporter, and the bar marks
 * where that preview ends.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, RotateCcw, RotateCw, X, Moon, Scissors, Gauge } from 'lucide-react';
import { analyzeEpisodeForSilence, resolveSilenceAutoSkip, type SilenceRange } from '@/lib/podcast/silence-detect';
import { PlayerContext, clock, pc, writeAddress, type Player } from './pc';

interface Descriptor {
  episodeId: string; title: string; audioUrl: string; durationSec: number;
  chapters: { startSec: number; title: string }[]; resumeSec: number; playbackSpeed: number;
  trimSilence: boolean; skipIntroSec: number; access?: string; locked?: boolean; previewSec?: number | null;
}
const SPEEDS = [0.8, 1, 1.25, 1.5, 1.75, 2];
const SLEEP = [0, 15, 30, 60];

/** play() returns a promise in browsers today, nothing in older ones: handle both. */
function startPlay(a: HTMLAudioElement, onOk: () => void, onBlocked: () => void) {
  try {
    const p = a.play() as Promise<void> | undefined;
    if (p && typeof p.then === 'function') p.then(onOk).catch(onBlocked); else onOk();
  } catch { onBlocked(); }
}

function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'This browser';
  const ua = navigator.userAgent;
  return /iPhone|Android/i.test(ua) ? 'Phone browser' : /iPad|Tablet/i.test(ua) ? 'Tablet browser' : 'Desktop browser';
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [d, setD] = useState<Descriptor | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [sleepMin, setSleepMin] = useState(0);
  const [trim, setTrim] = useState(false);
  const [silence, setSilence] = useState<SilenceRange[]>([]);
  const [skipIntro, setSkipIntro] = useState(0);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const pending = useRef<{ at?: number; autoplay?: boolean } | null>(null);
  const lastPush = useRef(0);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback((id: string, opts: { at?: number; autoplay?: boolean } = {}) => {
    pending.current = opts;
    if (id === episodeId && audioRef.current && d) {
      if (opts.at != null && Number.isFinite(opts.at)) audioRef.current.currentTime = opts.at;
      if (opts.autoplay) startPlay(audioRef.current, () => setPlaying(true), () => setErr('Your browser blocked playback. Press play.'));
      return;
    }
    setEpisodeId(id);
  }, [episodeId, d]);

  // Fetch the stream descriptor for the loaded episode.
  useEffect(() => {
    if (!episodeId) return;
    let live = true;
    setD(null); setErr(null); setPlaying(false); setPosition(0); lastPush.current = 0;
    void pc<Descriptor>('episode-stream', { episodeId }).then((r) => {
      if (!live) return;
      if (!r.ok || !r.result) { setErr(r.error); return; }
      setD(r.result);
      setSpeed(r.result.playbackSpeed || 1);
      setTrim(r.result.trimSilence === true);
      setSkipIntro(r.result.skipIntroSec || 0);
    });
    return () => { live = false; };
  }, [episodeId]);

  // When the audio's metadata lands: resume, skip intro, or the asked-for time.
  const onLoaded = useCallback(() => {
    const a = audioRef.current;
    if (!a || !d) return;
    a.playbackRate = speed;
    setDuration(Number.isFinite(a.duration) ? a.duration : d.durationSec);
    const want = pending.current?.at ?? (d.resumeSec > 0 ? d.resumeSec : d.skipIntroSec);
    if (Number.isFinite(want) && want > 0 && Number.isFinite(a.duration)) a.currentTime = Math.min(want, a.duration - 1);
    if (pending.current?.autoplay) startPlay(a, () => setPlaying(true), () => setErr('Your browser blocked playback. Press play.'));
    pending.current = null;
  }, [d, speed]);

  // Trim silence: a real RMS analysis of the decoded audio, only while on.
  useEffect(() => {
    if (!trim || !d?.audioUrl || d.locked) { setSilence([]); return; }
    const ctl = new AbortController();
    void analyzeEpisodeForSilence(d.audioUrl, (r) => setSilence(r), { signal: ctl.signal });
    return () => ctl.abort();
  }, [trim, d?.audioUrl, d?.locked]);

  const push = useCallback((pos: number) => {
    if (!d) return;
    void pc('sync-push', { episodeId: d.episodeId, positionSec: Math.round(pos), device: deviceLabel(), reportedAt: new Date().toISOString() });
  }, [d]);

  const onTime = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const skipTo = resolveSilenceAutoSkip(trim, silence, a.currentTime);
    if (skipTo !== null) a.currentTime = Number.isFinite(a.duration) ? Math.min(skipTo, a.duration) : skipTo;
    setPosition(a.currentTime);
    if (Math.abs(a.currentTime - lastPush.current) >= 10) { lastPush.current = a.currentTime; push(a.currentTime); }
  }, [trim, silence, push]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !d) return;
    if (a.paused) startPlay(a, () => setPlaying(true), () => setErr('Your browser blocked playback. Press play.'));
    else { a.pause(); setPlaying(false); push(a.currentTime); }
  }, [d, push]);

  const seek = useCallback((sec: number) => {
    const a = audioRef.current;
    if (!a || !Number.isFinite(sec)) return;
    const max = Number.isFinite(a.duration) ? a.duration : duration;
    a.currentTime = Math.max(0, Math.min(sec, max || sec));
    setPosition(a.currentTime);
  }, [duration]);

  const setRate = (r: number) => {
    setSpeed(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
    void pc('playback-speed-set', { speed: r });
  };
  const setSleep = async (m: number) => {
    setSleepMin(m);
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    await pc('playback-prefs-set', { sleepTimerMin: m });
    if (m > 0) sleepTimer.current = setTimeout(() => { audioRef.current?.pause(); setPlaying(false); setSleepMin(0); }, m * 60_000);
  };
  useEffect(() => () => { if (sleepTimer.current) clearTimeout(sleepTimer.current); }, []);

  // Space toggles, arrows skip 15 s, outside of text fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!d || (t && (t.closest('input,textarea,select,[contenteditable="true"]')))) return;
      if (e.key === ' ' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' && e.altKey) { e.preventDefault(); seek(position + 15); }
      else if (e.key === 'ArrowLeft' && e.altKey) { e.preventDefault(); seek(position - 15); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [d, toggle, seek, position]);

  const close = () => { audioRef.current?.pause(); if (audioRef.current && d) push(audioRef.current.currentTime); setEpisodeId(null); setD(null); setPlaying(false); };

  const player: Player = useMemo(() => ({ episodeId, position, duration, playing, load, seek, toggle }), [episodeId, position, duration, playing, load, seek, toggle]);
  const total = duration || d?.durationSec || 0;
  const pct = total > 0 ? Math.min(100, (position / total) * 100) : 0;
  const chapter = d?.chapters?.reduce((acc, c, i) => (position >= c.startSec ? i : acc), -1) ?? -1;

  return (
    <PlayerContext.Provider value={player}>
      {children}
      {episodeId && (
        <div className="tp-bar sticky bottom-0 z-40 mt-auto pb-[max(env(safe-area-inset-bottom),8px)] pl-3 pr-[4.25rem] pt-2 sm:px-6" role="region" aria-label="Player" data-testid="tp-bar">
          {d && <audio ref={audioRef} src={d.audioUrl} preload="metadata" onLoadedMetadata={onLoaded} onTimeUpdate={onTime} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} onEnded={() => { setPlaying(false); push(total); void pc('episode-mark-played', { episodeId: d.episodeId }); }} />}
          <div className="mx-auto flex max-w-[1180px] flex-col gap-1">
            <div
              className="tp-scrub"
              role="slider"
              tabIndex={0}
              aria-label="Position"
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(position)}
              aria-valuetext={`${clock(position)} of ${clock(total)}`}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (r.width > 0 && total > 0) seek(((e.clientX - r.left) / r.width) * total); }}
              onKeyDown={(e) => { if (e.key === 'ArrowRight') seek(position + 5); else if (e.key === 'ArrowLeft') seek(position - 5); }}
            >
              <span className="tp-fill" style={{ width: `${pct}%` }} />
              {total > 0 && d?.chapters?.map((c) => <span key={c.startSec} className="tp-tick" style={{ left: `${(c.startSec / total) * 100}%` }} title={c.title} />)}
              {total > 0 && d?.locked && d.previewSec != null && <span className="tp-preview-end" style={{ left: `${Math.min(100, (d.previewSec / total) * 100)}%` }} title="Supporters hear on from here" />}
              <span className="tp-head" style={{ left: `${pct}%` }} />
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="tp-btn tp-btn-quiet h-9 w-9 !p-0" onClick={() => seek(position - 15)} aria-label="Back 15 seconds" disabled={!d}><RotateCcw className="h-4 w-4" /></button>
              <button type="button" className="tp-btn tp-btn-signal h-10 w-10 !rounded-full !p-0" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} disabled={!d} data-testid="tp-play">
                {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </button>
              <button type="button" className="tp-btn tp-btn-quiet h-9 w-9 !p-0" onClick={() => seek(position + 30)} aria-label="Forward 30 seconds" disabled={!d}><RotateCw className="h-4 w-4" /></button>
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => d && writeAddress({ ep: d.episodeId })} title="Open the page">
                <span className="block truncate text-[13.5px] font-semibold">{err ? <span className="text-[color:var(--tp-signal)]">{err}</span> : d?.title || 'Loading…'}</span>
                <span className="tp-mono block truncate text-[11.5px] opacity-70">
                  {clock(position)} / {clock(total)}
                  {chapter >= 0 && d?.chapters?.[chapter] ? ` · ${d.chapters[chapter].title}` : ''}
                  {d?.locked ? ' · preview' : ''}
                  {trim && silence.length ? ` · ${silence.length} silences skipped` : ''}
                  {sleepMin ? ` · sleeps in ${sleepMin} min` : ''}
                </span>
              </button>
              <button type="button" className="tp-btn tp-btn-quiet h-9 !px-2 tp-mono" onClick={() => setRate(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)} aria-label={`Speed ${speed} times`} title="Playback speed">{speed}×</button>
              <div className="relative">
                <button type="button" className="tp-btn tp-btn-quiet h-9 w-9 !p-0" onClick={() => setPrefsOpen((v) => !v)} aria-label="Listening settings" aria-expanded={prefsOpen}><Gauge className="h-4 w-4" /></button>
                {prefsOpen && (
                  <div className="tp-card tp-rise absolute bottom-full right-0 mb-2 w-72 space-y-3 p-3 text-[color:var(--tp-ink)]" role="dialog" aria-label="Listening settings">
                    <div>
                      <p className="tp-label mb-1 flex items-center gap-1"><Moon className="h-3 w-3" /> Sleep timer</p>
                      <div className="flex gap-1">{SLEEP.map((m) => <button key={m} type="button" className="tp-chip" aria-pressed={sleepMin === m} onClick={() => void setSleep(m)}>{m ? `${m} min` : 'Off'}</button>)}</div>
                    </div>
                    <label className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="flex items-center gap-1"><Scissors className="h-3 w-3" /> Skip silences</span>
                      <input type="checkbox" checked={trim} onChange={(e) => { setTrim(e.target.checked); void pc('playback-prefs-set', { trimSilence: e.target.checked }); }} />
                    </label>
                    <label className="flex items-center justify-between gap-2 text-[13px]">
                      <span>Skip the first</span>
                      <span className="flex items-center gap-1"><input className="tp-input tp-mono !min-h-0 w-16 !py-1" type="number" min={0} max={300} value={skipIntro} onChange={(e) => setSkipIntro(Math.max(0, Math.min(300, Number(e.target.value) || 0)))} onBlur={() => void pc('playback-prefs-set', { skipIntroSec: skipIntro })} aria-label="Seconds of intro to skip" /> s</span>
                    </label>
                    <p className="text-[11.5px] text-[color:var(--tp-muted)]">Saved to your account; they apply on every device.</p>
                  </div>
                )}
              </div>
              <button type="button" className="tp-btn tp-btn-quiet h-9 w-9 !p-0" onClick={close} aria-label="Close the player"><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}
    </PlayerContext.Provider>
  );
}
