'use client';

/**
 * /lenses/training-room — controlled combat dojo.
 *
 * Phase AF — surfaces real frame data per skill + a replay timeline so
 * players can study what their skills actually do. No live opponent here —
 * the dojo is intentional, focused practice space.
 *
 * Wiring (all real, no mocks in runtime):
 *   - training-room.list_skills  → the player's acquired skill DTUs
 *   - training-room.list_kinds   → built-in weapon kinds (always trainable)
 *   - training-room.frame_data   → startup/active/recovery/parry/dodge envelope
 *
 * Frame numbers are derived server-side from server/lib/combat-frame-data.js.
 * The lens NEVER fabricates frame values — an unresolved skill renders an
 * honest not-found / error state.
 */

import { useCallback, useEffect, useState } from 'react';
import { Target, Crosshair, Timer, Sparkles, RefreshCcw, AlertTriangle } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { lensRun } from '@/lib/api/client';

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

interface PickerItem {
  id: string;
  title: string;
  builtin: boolean;
}

type FrameStatus = 'idle' | 'loading' | 'error' | 'ready';

export default function TrainingRoomPage() {
  const [items, setItems] = useState<PickerItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [frameData, setFrameData] = useState<FrameData | null>(null);
  const [frameStatus, setFrameStatus] = useState<FrameStatus>('idle');
  const [replayPhase, setReplayPhase] = useState<'idle' | 'startup' | 'active' | 'recovery'>('idle');

  const refreshSkills = useCallback(async () => {
    setListLoading(true);
    setListError(false);
    try {
      // The player's acquired skills (may be empty) + always-trainable built-in kinds.
      const [skillsRes, kindsRes] = await Promise.all([
        lensRun('training-room', 'list_skills', {}),
        lensRun('training-room', 'list_kinds', {}),
      ]);
      const skills = (skillsRes?.data?.result as { skills?: Array<{ id: string; title: string }> } | null)?.skills ?? [];
      const kinds = (kindsRes?.data?.result as { kinds?: Array<{ kind: string; name: string }> } | null)?.kinds ?? [];

      const skillItems: PickerItem[] = skills.map((s) => ({ id: s.id, title: s.title, builtin: false }));
      const kindItems: PickerItem[] = kinds.map((k) => ({ id: k.kind, title: k.name, builtin: true }));
      const merged = [...skillItems, ...kindItems];
      setItems(merged);
      if (!selectedSkillId && merged.length > 0) setSelectedSkillId(merged[0].id);
    } catch {
      setListError(true);
    } finally {
      setListLoading(false);
    }
  }, [selectedSkillId]);

  useEffect(() => { refreshSkills(); }, [refreshSkills]);

  const loadFrameData = useCallback(async (skillId: string) => {
    setFrameStatus('loading');
    try {
      const res = await lensRun('training-room', 'frame_data', { skillId });
      const result = res?.data?.result as { ok?: boolean; frameData?: FrameData } | null;
      if (result?.frameData) {
        setFrameData(result.frameData);
        setFrameStatus('ready');
      } else {
        setFrameData(null);
        setFrameStatus('error');
      }
    } catch {
      setFrameData(null);
      setFrameStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!selectedSkillId) { setFrameStatus('idle'); setFrameData(null); return; }
    loadFrameData(selectedSkillId);
  }, [selectedSkillId, loadFrameData]);

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
              <Target className="h-5 w-5 text-cyan-400" aria-hidden="true" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Training Room</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                Frame data + replay. Easy to pick up, hard to master.
              </p>
            </div>
            <button onClick={refreshSkills} aria-label="Refresh skills" className="rounded-full border border-cyan-500/30 bg-cyan-500/10 p-1.5 text-cyan-300 hover:bg-cyan-500/20">
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </header>

        <section className="mx-auto grid max-w-screen-2xl grid-cols-1 gap-4 px-4 py-5 sm:px-6 lg:grid-cols-3">
          <aside className="rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-3">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-cyan-300/60">Skills &amp; weapons</h2>
            {listLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading skills" data-testid="skills-loading">
                {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg border border-white/5 bg-white/5" />)}
              </div>
            ) : listError ? (
              <div className="py-4 text-center" role="alert" data-testid="skills-error">
                <AlertTriangle className="mx-auto mb-1 h-5 w-5 text-amber-400" aria-hidden="true" />
                <p className="text-[12px] text-amber-200">Couldn&apos;t load your skills.</p>
                <button
                  onClick={refreshSkills}
                  className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-100 hover:bg-amber-500/20"
                >
                  Retry
                </button>
              </div>
            ) : items.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-slate-500" data-testid="skills-empty">
                Acquire a skill first — try a few combats, then come back.
              </p>
            ) : (
              <ul className="space-y-1" data-testid="skills-list">
                {items.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => setSelectedSkillId(s.id)}
                      aria-pressed={selectedSkillId === s.id}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[12px] ${
                        selectedSkillId === s.id
                          ? 'bg-cyan-500/20 text-cyan-100'
                          : 'text-slate-300 hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="truncate">{s.title}</span>
                      {s.builtin && (
                        <span className="shrink-0 rounded bg-slate-700/50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-slate-400">
                          weapon
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <div className="lg:col-span-2 rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-4" aria-live="polite">
            {frameStatus === 'idle' ? (
              <div className="py-12 text-center text-[12px] text-slate-500" data-testid="frame-empty">
                Select a skill or weapon to see its frame data.
              </div>
            ) : frameStatus === 'loading' ? (
              <div className="space-y-3" aria-busy="true" aria-label="Loading frame data" data-testid="frame-loading">
                <div className="h-6 w-1/3 animate-pulse rounded bg-white/5" />
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded bg-white/5" />)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded bg-white/5" />)}
                </div>
              </div>
            ) : frameStatus === 'error' || !frameData ? (
              <div className="py-12 text-center" role="alert" data-testid="frame-error">
                <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-400" aria-hidden="true" />
                <p className="text-[13px] text-amber-200">No frame data for this skill.</p>
                <p className="mt-1 text-[11px] text-slate-500">It may not be a recognised combat skill yet.</p>
                <button
                  onClick={() => selectedSkillId && loadFrameData(selectedSkillId)}
                  className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-100 hover:bg-amber-500/20"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div data-testid="frame-ready">
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
                    <div className="text-[10px] uppercase text-emerald-300/60 flex items-center justify-center gap-1"><Crosshair className="h-3 w-3" aria-hidden="true" /> parry window</div>
                    <div className="text-base font-bold text-emerald-100">
                      {frameData.parry_window_ms === 0
                        ? <span className="text-slate-400" title="Ranged weapons cannot parry">none</span>
                        : <>{frameData.parry_window_ms}<span className="text-[10px]">ms</span></>}
                    </div>
                  </div>
                  <div className="rounded border border-violet-500/20 bg-violet-500/5 p-2">
                    <div className="text-[10px] uppercase text-violet-300/60 flex items-center justify-center gap-1"><Timer className="h-3 w-3" aria-hidden="true" /> dodge window</div>
                    <div className="text-base font-bold text-violet-100">{frameData.dodge_window_ms}<span className="text-[10px]">ms</span></div>
                  </div>
                </div>

                {frameData.combo_followups.length > 0 && (
                  <div className="mt-3 rounded border border-yellow-500/20 bg-yellow-500/5 p-2">
                    <div className="text-[10px] uppercase text-yellow-300/60 flex items-center gap-1"><Sparkles className="h-3 w-3" aria-hidden="true" /> combo followups</div>
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

                  <div className="mt-2 h-3 overflow-hidden rounded bg-slate-900" role="presentation">
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
              </div>
            )}
          </div>
        </section>
      </main>
    </LensShell>
  );
}
