'use client';

/**
 * /lenses/training-room — controlled combat dojo.
 *
 * Phase AF — surfaces frame data per skill + scaffolds a replay surface
 * so players can study what their skills actually do. No live opponent
 * here — the dojo is intentional, focused practice space.
 */

import { useCallback, useEffect, useState } from 'react';
import { Target, Crosshair, Timer, Sparkles, RefreshCcw } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

interface FrameData {
  skillId: string;
  name: string;
  kind: string;
  level: number;
  startup_ms: number;
  active_ms: number;
  recovery_ms: number;
  parry_window_ms: number;
  dodge_window_ms: number;
  combo_followups: Array<{ skillId: string; name: string }>;
}

interface SkillRow { id: string; title: string; }

export default function TrainingRoomPage() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [frameData, setFrameData] = useState<FrameData | null>(null);
  const [replayPhase, setReplayPhase] = useState<'idle' | 'startup' | 'active' | 'recovery'>('idle');

  const refreshSkills = useCallback(async () => {
    try {
      const r = await fetch('/api/dtus?type=skill&limit=20', { credentials: 'include' }).then((x) => x.json());
      const list = r?.dtus || r?.results || [];
      setSkills(list);
      if (!selectedSkillId && list.length > 0) setSelectedSkillId(list[0].id);
    } catch { /* network blip */ }
    finally { setLoading(false); }
  }, [selectedSkillId]);

  useEffect(() => { refreshSkills(); }, [refreshSkills]);

  useEffect(() => {
    if (!selectedSkillId) return;
    fetch(`/api/combat/frame-data/${selectedSkillId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.ok) setFrameData(d.frameData); })
      .catch(() => {});
  }, [selectedSkillId]);

  const playReplay = useCallback(() => {
    if (!frameData) return;
    setReplayPhase('startup');
    setTimeout(() => setReplayPhase('active'), frameData.startup_ms);
    setTimeout(() => setReplayPhase('recovery'), frameData.startup_ms + frameData.active_ms);
    setTimeout(() => setReplayPhase('idle'),
      frameData.startup_ms + frameData.active_ms + frameData.recovery_ms);
  }, [frameData]);

  return (
    <LensShell lensId="training-room" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-cyan-950/10 text-slate-100">
        <header className="border-b border-cyan-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-2">
              <Target className="h-5 w-5 text-cyan-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Training Room</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                Frame data + replay. Easy to pick up, hard to master.
              </p>
            </div>
            <button onClick={refreshSkills} aria-label="Refresh" className="rounded-full border border-cyan-500/30 bg-cyan-500/10 p-1.5 text-cyan-300 hover:bg-cyan-500/20">
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <section className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-4 px-4 py-5 sm:px-6 lg:grid-cols-3">
          <aside className="rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-3">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-cyan-300/60">Your skills</h2>
            {loading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading skills">
                {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg border border-white/5 bg-white/5" />)}
              </div>
            ) : skills.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-slate-400">
                Acquire a skill first — try a few combats, then come back.
              </p>
            ) : (
              <ul className="space-y-1">
                {skills.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedSkillId(s.id)}
                      className={`w-full rounded px-2 py-1 text-left text-[12px] ${
                        selectedSkillId === s.id
                          ? 'bg-cyan-500/20 text-cyan-100'
                          : 'text-slate-300 hover:bg-slate-800/50'
                      }`}
                    >
                      {s.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <div className="lg:col-span-2 rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-4">
            {!frameData ? (
              <div className="py-12 text-center text-[12px] text-slate-400">
                Select a skill to see its frame data.
              </div>
            ) : (
              <>
                <header className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-semibold text-cyan-100">{frameData.name}</h2>
                  <span className="text-[10px] text-cyan-300/60">{frameData.kind} · level {frameData.level}</span>
                </header>

                <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="rounded border border-cyan-500/20 bg-cyan-500/5 p-2">
                    <div className="text-[10px] uppercase text-cyan-300/60">startup</div>
                    <div className="text-lg font-bold text-cyan-100">{frameData.startup_ms}<span className="text-[10px]">ms</span></div>
                  </div>
                  <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2">
                    <div className="text-[10px] uppercase text-amber-300/60">active</div>
                    <div className="text-lg font-bold text-amber-100">{frameData.active_ms}<span className="text-[10px]">ms</span></div>
                  </div>
                  <div className="rounded border border-rose-500/20 bg-rose-500/5 p-2">
                    <div className="text-[10px] uppercase text-rose-300/60">recovery</div>
                    <div className="text-lg font-bold text-rose-100">{frameData.recovery_ms}<span className="text-[10px]">ms</span></div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[11px]">
                  <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2">
                    <div className="text-[10px] uppercase text-emerald-300/60 flex items-center justify-center gap-1"><Crosshair className="h-3 w-3" /> parry window</div>
                    <div className="text-base font-bold text-emerald-100">{frameData.parry_window_ms}<span className="text-[10px]">ms</span></div>
                  </div>
                  <div className="rounded border border-violet-500/20 bg-violet-500/5 p-2">
                    <div className="text-[10px] uppercase text-violet-300/60 flex items-center justify-center gap-1"><Timer className="h-3 w-3" /> dodge window</div>
                    <div className="text-base font-bold text-violet-100">{frameData.dodge_window_ms}<span className="text-[10px]">ms</span></div>
                  </div>
                </div>

                {frameData.combo_followups.length > 0 && (
                  <div className="mt-3 rounded border border-yellow-500/20 bg-yellow-500/5 p-2">
                    <div className="text-[10px] uppercase text-yellow-300/60 flex items-center gap-1"><Sparkles className="h-3 w-3" /> combo followups</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                      {frameData.combo_followups.map((c) => (
                        <span key={c.skillId} className="rounded bg-yellow-500/20 px-2 py-0.5 text-yellow-100">{c.name}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <button
                    onClick={playReplay}
                    disabled={replayPhase !== 'idle'}
                    className="w-full rounded-md border border-cyan-500/40 bg-cyan-500/20 px-3 py-1.5 text-[12px] text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40"
                  >
                    {replayPhase === 'idle' ? 'Play replay' : `Phase: ${replayPhase}`}
                  </button>

                  <div className="mt-2 h-3 overflow-hidden rounded bg-slate-900">
                    {replayPhase !== 'idle' && (
                      <div
                        className={`h-full transition-all ${
                          replayPhase === 'startup' ? 'bg-cyan-500/60'
                          : replayPhase === 'active' ? 'bg-amber-500/60'
                          : 'bg-rose-500/60'
                        }`}
                        style={{ width: replayPhase === 'startup' ? '33%' : replayPhase === 'active' ? '66%' : '100%' }}
                      />
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </main>
    </LensShell>
  );
}
