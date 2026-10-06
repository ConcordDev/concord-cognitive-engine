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
import { Target, Crosshair, Timer, Sparkles, AlertTriangle, Play, Swords, Scale } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

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
type DojoView = 'study' | 'compare';

const VIEWS: { id: DojoView; label: string; keys: string; title: string; hint: string; icon: typeof Target }[] = [
  { id: 'study', label: 'Study', keys: '1', title: 'Learn the timing', hint: 'Frame data and a phase replay for one skill', icon: Target },
  { id: 'compare', label: 'Compare', keys: '2', title: 'Weigh two skills', hint: 'Side-by-side frame data for two skills or weapons', icon: Scale },
];

function totalMs(f: FrameData) {
  return f.startup_ms + f.active_ms + f.recovery_ms;
}

function fetchFrame(skillId: string): Promise<FrameData | null> {
  return lensRun('training-room', 'frame_data', { skillId })
    .then((res) => (res?.data?.result as { frameData?: FrameData } | null)?.frameData ?? null)
    .catch(() => null);
}

function ComparePanel({
  items, a, aStatus, rivalId, onRival, b, bStatus,
}: {
  items: PickerItem[];
  a: FrameData | null;
  aStatus: FrameStatus;
  rivalId: string | null;
  onRival: (id: string) => void;
  b: FrameData | null;
  bStatus: FrameStatus;
}) {
  const rows: Array<{ label: string; pick: (f: FrameData) => number; lowerBetter: boolean }> = [
    { label: 'Startup', pick: (f) => f.startup_ms, lowerBetter: true },
    { label: 'Active', pick: (f) => f.active_ms, lowerBetter: false },
    { label: 'Recovery', pick: (f) => f.recovery_ms, lowerBetter: true },
    { label: 'Total commitment', pick: totalMs, lowerBetter: true },
    { label: 'Parry window', pick: (f) => f.parry_window_ms, lowerBetter: false },
    { label: 'Dodge window', pick: (f) => f.dodge_window_ms, lowerBetter: false },
  ];
  return (
    <div data-testid="compare-panel">
      <label className="block text-[11px] uppercase tracking-wider text-cyan-300/60" htmlFor="rival-pick">Skill B</label>
      <select
        id="rival-pick"
        value={rivalId ?? ''}
        onChange={(e) => onRival(e.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-zinc-100"
      >
        <option value="">Choose a skill or weapon to compare…</option>
        {items.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
      </select>

      {!rivalId || aStatus === 'idle' ? (
        <p className="py-10 text-center text-[12px] text-slate-500">Pick Skill A on the left and Skill B above to compare their frame data.</p>
      ) : aStatus === 'loading' || bStatus === 'loading' ? (
        <div className="mt-4 space-y-2" role="status" aria-busy="true" aria-label="Loading comparison">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-white/5" />)}
        </div>
      ) : !a || !b ? (
        <p className="py-10 text-center text-[12px] text-amber-200" role="alert">No frame data for one of those skills.</p>
      ) : (
        <table className="mt-4 w-full text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-1 font-medium">Metric</th>
              <th className="py-1 font-medium text-cyan-200">{a.name}</th>
              <th className="py-1 font-medium text-violet-200">{b.name}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const av = r.pick(a);
              const bv = r.pick(b);
              const better = av === bv ? null : (r.lowerBetter ? av < bv : av > bv) ? 'a' : 'b';
              return (
                <tr key={r.label} className="border-t border-white/5">
                  <td className="py-1.5 text-slate-400">{r.label}</td>
                  <td className={`py-1.5 tabular-nums ${better === 'a' ? 'font-semibold text-emerald-300' : 'text-slate-200'}`}>{av}ms</td>
                  <td className={`py-1.5 tabular-nums ${better === 'b' ? 'font-semibold text-emerald-300' : 'text-slate-200'}`}>{bv}ms</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function TrainingRoomPage() {
  const [items, setItems] = useState<PickerItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [listKey, setListKey] = useState(0);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [frameResult, setFrameResult] = useState<{ id: string; data: FrameData | null } | null>(null);
  const [replayPhase, setReplayPhase] = useState<'idle' | 'startup' | 'active' | 'recovery'>('idle');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<DojoView>('study');
  const [rivalId, setRivalId] = useState<string | null>(null);
  const [rivalResult, setRivalResult] = useState<{ id: string; data: FrameData | null } | null>(null);

  const refreshSkills = useCallback(() => {
    setListLoading(true);
    setListError(false);
    setListKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The player's acquired skills (may be empty) + always-trainable built-in kinds.
    Promise.all([
      lensRun('training-room', 'list_skills', {}),
      lensRun('training-room', 'list_kinds', {}),
    ])
      .then(([skillsRes, kindsRes]) => {
        if (cancelled) return;
        const skills = (skillsRes?.data?.result as { skills?: Array<{ id: string; title: string }> } | null)?.skills ?? [];
        const kinds = (kindsRes?.data?.result as { kinds?: Array<{ kind: string; name: string }> } | null)?.kinds ?? [];
        const skillItems: PickerItem[] = skills.map((s) => ({ id: s.id, title: s.title, builtin: false }));
        const kindItems: PickerItem[] = kinds.map((k) => ({ id: k.kind, title: k.name, builtin: true }));
        const merged = [...skillItems, ...kindItems];
        setItems(merged);
        if (merged.length > 0) setSelectedSkillId((prev) => prev ?? merged[0].id);
      })
      .catch(() => { if (!cancelled) setListError(true); })
      .finally(() => { if (!cancelled) setListLoading(false); });
    return () => { cancelled = true; };
  }, [listKey]);

  useEffect(() => {
    if (!selectedSkillId) return;
    let cancelled = false;
    fetchFrame(selectedSkillId).then((data) => {
      if (!cancelled) setFrameResult({ id: selectedSkillId, data });
    });
    return () => { cancelled = true; };
  }, [selectedSkillId, frameKey]);

  useEffect(() => {
    if (!rivalId) return;
    let cancelled = false;
    fetchFrame(rivalId).then((data) => {
      if (!cancelled) setRivalResult({ id: rivalId, data });
    });
    return () => { cancelled = true; };
  }, [rivalId]);

  const frameData = frameResult && frameResult.id === selectedSkillId ? frameResult.data : null;
  const frameStatus: FrameStatus = !selectedSkillId
    ? 'idle'
    : !frameResult || frameResult.id !== selectedSkillId
      ? 'loading'
      : frameResult.data ? 'ready' : 'error';
  const rivalData = rivalResult && rivalResult.id === rivalId ? rivalResult.data : null;
  const rivalStatus: FrameStatus = !rivalId
    ? 'idle'
    : !rivalResult || rivalResult.id !== rivalId
      ? 'loading'
      : rivalResult.data ? 'ready' : 'error';

  const retryFrame = useCallback(() => {
    setFrameResult(null);
    setFrameKey((k) => k + 1);
  }, []);

  const playReplay = useCallback(() => {
    if (!frameData) return;
    setReplayPhase('startup');
    setTimeout(() => setReplayPhase('active'), frameData.startup_ms);
    setTimeout(() => setReplayPhase('recovery'), frameData.startup_ms + frameData.active_ms);
    setTimeout(() => setReplayPhase('idle'),
      frameData.startup_ms + frameData.active_ms + frameData.recovery_ms);
  }, [frameData]);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `training-room-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setView(v.id),
      })),
    ],
    { lensId: 'training-room' },
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="training-room" asMain={false}>
      <NorthStarFrame
        lensId="training-room"
        crumb="Training Room"
        title={`${current.title}${view === 'study' && who ? `, ${who}` : ''}`}
        subtitle="A controlled dojo: real frame data for every skill and weapon, a phase replay, and side-by-side comparison. Easy to pick up, hard to master."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as DojoView)}
        tabsLabel="Training room views"
        cta={view === 'study'
          ? { label: replayPhase === 'idle' ? 'Run the drill' : 'Drill running…', icon: Play, onClick: playReplay, disabled: !frameData || replayPhase !== 'idle', title: 'Replay startup, active and recovery phases' }
          : { label: 'Study this skill', icon: Swords, onClick: () => setView('study'), title: 'Back to single-skill study' }}
      >
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <aside className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <h2 className="mb-2 text-[11px] uppercase tracking-wider text-cyan-300/60">{view === 'compare' ? 'Skill A' : 'Skills & weapons'}</h2>
            {listLoading ? (
              <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading skills" data-testid="skills-loading">
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

          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-[#111] p-4" aria-live="polite">
            {view === 'compare' ? (
              <ComparePanel items={items} a={frameData} aStatus={frameStatus} rivalId={rivalId} onRival={(id) => setRivalId(id || null)} b={rivalData} bStatus={rivalStatus} />
            ) : frameStatus === 'idle' ? (
              <div className="py-12 text-center text-[12px] text-slate-500" data-testid="frame-empty">
                Select a skill or weapon to see its frame data.
              </div>
            ) : frameStatus === 'loading' ? (
              <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading frame data" data-testid="frame-loading">
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
                  onClick={retryFrame}
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
      </NorthStarFrame>
    </LensShell>
  );
}
