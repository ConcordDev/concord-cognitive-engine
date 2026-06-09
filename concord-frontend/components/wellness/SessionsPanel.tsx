'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SessionsPanel — Calm-style guided meditation + breathing sessions.
 * Surfaces the authored session catalogue, runs a live breathing-pacer
 * animation for breathing presets, captures mood before/after, and logs
 * the completed session. Wired to wellness.session-catalogue /
 * session-complete / session-history.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Wind, Loader2, Play, Square, Flame } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SessionPreset {
  id: string; kind: 'breathing' | 'meditation'; title: string; desc: string;
  durationMin: number; pattern: number[] | null; cycles: number;
}
interface SessionRecord {
  id: string; number: string; catalogueId: string; kind: string; title: string;
  durationMin: number; moodBefore: number | null; moodAfter: number | null;
  moodShift: number | null; note: string; date: string; at: string;
}
interface History { sessions: SessionRecord[]; count: number; totalMin: number; streak: number; avgMoodShift: number | null }

const MOODS = ['😣', '🙁', '😐', '🙂', '😄'];
const PHASE_LABELS = ['Breathe in', 'Hold', 'Breathe out', 'Hold'];

export function SessionsPanel() {
  const [catalogue, setCatalogue] = useState<SessionPreset[]>([]);
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);

  // Live session state.
  const [active, setActive] = useState<SessionPreset | null>(null);
  const [phase, setPhase] = useState(0);          // index into pattern
  const [phaseLeft, setPhaseLeft] = useState(0);  // seconds left in phase
  const [elapsed, setElapsed] = useState(0);      // total seconds elapsed
  const [moodBefore, setMoodBefore] = useState<number | null>(null);
  const [moodAfter, setMoodAfter] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = useCallback(async () => {
    const r = await lensRun({ domain: 'wellness', action: 'session-history', input: { days: 30 } });
    if (r.data?.ok && r.data.result) setHistory(r.data.result as History);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun({ domain: 'wellness', action: 'session-catalogue', input: {} });
    if (r.data?.ok && r.data.result) setCatalogue(((r.data.result as any).sessions || []) as SessionPreset[]);
    await loadHistory();
    setLoading(false);
  }, [loadHistory]);

  useEffect(() => { void load(); }, [load]);

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  function begin(preset: SessionPreset) {
    setActive(preset);
    setFinished(false);
    setMoodAfter(null);
    setElapsed(0);
    setPhase(0);
    const pattern = preset.pattern;
    if (pattern && pattern.length) {
      // skip leading zero-length phases
      let p = 0;
      while (p < pattern.length && pattern[p] === 0) p++;
      setPhase(p);
      setPhaseLeft(pattern[p % pattern.length]);
    }
    const totalSec = preset.durationMin * 60;
    stopTimer();
    timerRef.current = setInterval(() => {
      setElapsed(prev => {
        const next = prev + 1;
        if (next >= totalSec) { stopTimer(); setFinished(true); }
        return next;
      });
      if (pattern && pattern.length) {
        setPhaseLeft(prev => {
          if (prev > 1) return prev - 1;
          // advance to next non-zero phase
          setPhase(curr => {
            let np = (curr + 1) % pattern.length;
            let guard = 0;
            while (pattern[np] === 0 && guard < pattern.length) { np = (np + 1) % pattern.length; guard++; }
            return np;
          });
          return 0; // will be reset by the phase effect below
        });
      }
    }, 1000);
  }

  // When phase index changes, reset its countdown.
  useEffect(() => {
    if (active?.pattern && active.pattern.length) {
      const dur = active.pattern[phase % active.pattern.length];
      if (dur > 0) setPhaseLeft(dur);
    }
  }, [phase, active]);

  function endEarly() {
    stopTimer();
    setFinished(true);
  }

  async function complete() {
    if (!active) return;
    setSaving(true);
    const r = await lensRun({
      domain: 'wellness', action: 'session-complete',
      input: {
        catalogueId: active.id,
        durationMin: Math.max(1, Math.round(elapsed / 60)),
        moodBefore, moodAfter,
      },
    });
    setSaving(false);
    if (r.data?.ok) {
      setActive(null);
      setFinished(false);
      setMoodBefore(null);
      setMoodAfter(null);
      await loadHistory();
    }
  }

  const progressPct = active ? Math.min(100, (elapsed / (active.durationMin * 60)) * 100) : 0;
  const inhaling = active?.pattern && (phase % active.pattern.length) === 0;

  return (
    <div className="rounded-lg border border-sky-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-sky-500/10 pb-2">
        <Wind className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">Meditation &amp; breathing</h3>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />}
        {history && (
          <span className="ml-auto text-[10px] text-zinc-400 inline-flex items-center gap-1">
            <Flame className="w-3 h-3 text-amber-400" />{history.streak}d streak · {history.totalMin}m
          </span>
        )}
      </header>

      {active ? (
        <div className="rounded border border-sky-500/30 bg-black/40 p-4 space-y-3">
          <div className="text-center">
            <div className="text-sm font-semibold text-white">{active.title}</div>
            <div className="text-[10px] text-zinc-400">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} / {active.durationMin}:00
            </div>
          </div>

          {active.pattern && !finished && (
            <div className="flex flex-col items-center gap-2 py-2">
              <div
                className="rounded-full bg-sky-500/20 border-2 border-sky-400 flex items-center justify-center transition-all duration-1000 ease-in-out"
                style={{ width: inhaling ? 132 : 84, height: inhaling ? 132 : 84 }}
              >
                <span className="text-2xl font-mono font-bold text-sky-200">{phaseLeft}</span>
              </div>
              <div className="text-xs font-semibold text-sky-300">
                {PHASE_LABELS[phase % PHASE_LABELS.length]}
              </div>
            </div>
          )}
          {!active.pattern && !finished && (
            <div className="py-4 text-center text-[11px] text-zinc-400 italic">
              {active.desc}
            </div>
          )}

          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-sky-400 transition-all" style={{ width: `${progressPct}%` }} />
          </div>

          {!finished ? (
            <button type="button" onClick={endEarly}
              className="w-full inline-flex items-center justify-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-white text-xs py-1.5 rounded font-semibold">
              <Square className="w-3 h-3" /> End session
            </button>
          ) : (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">How do you feel now?</div>
              <div className="flex gap-1.5">
                {MOODS.map((m, i) => (
                  <button key={i} type="button" onClick={() => setMoodAfter(i)}
                    className={cn('flex-1 py-1.5 rounded border text-xl',
                      moodAfter === i ? 'border-sky-400 bg-sky-500/15' : 'border-white/10 hover:border-sky-500/40')}>
                    {m}
                  </button>
                ))}
              </div>
              <button type="button" onClick={complete} disabled={saving}
                className="w-full inline-flex items-center justify-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs py-1.5 rounded font-semibold">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Log session
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="rounded border border-white/10 bg-black/30 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1.5">How are you feeling before you start?</div>
            <div className="flex gap-1.5">
              {MOODS.map((m, i) => (
                <button key={i} type="button" onClick={() => setMoodBefore(i)}
                  className={cn('flex-1 py-1.5 rounded border text-xl',
                    moodBefore === i ? 'border-sky-400 bg-sky-500/15' : 'border-white/10 hover:border-sky-500/40')}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <ul className="space-y-1.5">
            {catalogue.map(p => (
              <li key={p.id} className="rounded border border-white/10 bg-black/30 p-2.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                      p.kind === 'breathing' ? 'bg-sky-500/15 text-sky-300' : 'bg-violet-500/15 text-violet-300')}>
                      {p.kind}
                    </span>
                    <span className="text-sm text-white truncate">{p.title}</span>
                    <span className="text-[10px] text-zinc-400 font-mono">{p.durationMin}m</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{p.desc}</div>
                </div>
                <button aria-label="Play" type="button" onClick={() => begin(p)}
                  className="p-2 rounded-full bg-sky-600 hover:bg-sky-500 text-white flex-shrink-0">
                  <Play className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>

          {history && history.sessions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">
                Recent sessions
                {history.avgMoodShift !== null && ` · avg mood shift ${history.avgMoodShift > 0 ? '+' : ''}${history.avgMoodShift}`}
              </div>
              <ul className="space-y-1">
                {history.sessions.slice(0, 6).map(s => (
                  <li key={s.id} className="flex items-center gap-2 text-[11px]">
                    <span className="text-zinc-300 flex-1 truncate">{s.title}</span>
                    <span className="text-[10px] text-zinc-400 font-mono">{s.durationMin}m · {s.date}</span>
                    {s.moodShift !== null && (
                      <span className={cn('text-[10px] font-mono px-1 rounded',
                        s.moodShift > 0 ? 'bg-emerald-500/15 text-emerald-300'
                          : s.moodShift < 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-white/5 text-zinc-400')}>
                        {s.moodShift > 0 ? '+' : ''}{s.moodShift}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SessionsPanel;
