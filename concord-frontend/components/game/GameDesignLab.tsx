'use client';

// GameDesignLab — a real, designed home for the `game` domain's 10
// balance/economy/turn-simulation macros that used to sit behind a
// permanently-disabled button wall (gated on a never-populated
// 'shop-item' artifact that had no creation form anywhere).
//
// Two independent clusters, both real:
//   1. Balance Calculators — 4 pure-compute macros (balanceCheck,
//      economySimulate, levelCurve, dropRateCalc). Called directly via
//      POST /api/lens/run with structured input — no persisted artifact
//      needed (server builds a virtual one from the input object).
//   2. Playtest Sessions — 6 stateful macros (complete, claim, levelup,
//      simulate, resolve_turn, balance) that read/write a real artifact's
//      `data.{level,xp,turns}`. Backed by a genuine create/select/run loop
//      against `/api/lens/game` + `/api/lens/game/:id/run`, not a fake
//      artifact selector.

import { useCallback, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { cn } from '@/lib/utils';
import {
  Scale, TrendingUp, Activity, BarChart2, Plus, Loader2, Play,
  ArrowUp, Gift, CheckCircle2, FlaskConical, Swords,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CalcTab = 'balance' | 'economy' | 'curve' | 'drops';

interface UnitRow { name: string; hp: number; attack: number; defense: number; speed: number; cost: number; }

interface Turn { id: string; action: string; outcome: 'success' | 'failure'; xpGained: number; difficulty: number; successProbability: number; resolvedAt: string; }
interface SessionData { level?: number; xp?: number; turns?: Turn[]; status?: string; claimed?: boolean; reward?: { xp: number; type: string }; completedAt?: string; }

const DEFAULT_UNITS: UnitRow[] = [
  { name: 'Fighter', hp: 120, attack: 18, defense: 14, speed: 10, cost: 4 },
  { name: 'Mage', hp: 70, attack: 26, defense: 6, speed: 9, cost: 4 },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GameDesignLab() {
  const [section, setSection] = useState<'calc' | 'playtest'>('calc');

  return (
    <div className="space-y-4" data-lens-theme="game">
      <div className="flex items-center gap-2 flex-wrap">
        <FlaskConical className="w-5 h-5 text-neon-purple" />
        <h2 className="text-base font-bold text-white">Design Lab</h2>
        <p className="text-xs text-gray-400">Balance-test RPG units/economies/level curves and playtest a turn-based encounter — real math, no fabricated results.</p>
      </div>
      <div className="flex gap-1 border-b border-lattice-border pb-2">
        {([
          { id: 'calc', label: 'Balance Calculators', icon: Scale },
          { id: 'playtest', label: 'Playtest Sessions', icon: Swords },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setSection(t.id)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs transition-colors',
              section === t.id ? 'bg-neon-purple/20 text-neon-purple border-b-2 border-neon-purple' : 'text-gray-400 hover:text-white')}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>
      {section === 'calc' ? <BalanceCalculators /> : <PlaytestSessions />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Balance Calculators (stateless, direct /api/lens/run calls)
// ---------------------------------------------------------------------------

function BalanceCalculators() {
  const [tab, setTab] = useState<CalcTab>('balance');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Unit balance check
  const [units, setUnits] = useState<UnitRow[]>(DEFAULT_UNITS);
  const addUnit = () => setUnits((u) => [...u, { name: `Unit ${u.length + 1}`, hp: 100, attack: 15, defense: 10, speed: 10, cost: 3 }]);
  const removeUnit = (i: number) => setUnits((u) => u.filter((_, idx) => idx !== i));
  const updateUnit = (i: number, patch: Partial<UnitRow>) => setUnits((u) => u.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  // Economy simulation
  const [econ, setEcon] = useState({ startingGold: 100, goldPerMinute: 5, avgSpendPerMinute: 3, inflationPercent: 2, simulateMinutes: 60 });

  // Level curve
  const [curve, setCurve] = useState({ maxLevel: 50, baseXP: 100, growthFactor: 1.5 });

  // Drop rate
  const [drop, setDrop] = useState({ dropRatePercent: 5, attempts: 100 });

  const run = useCallback(async (action: string, input: Record<string, unknown>) => {
    setBusy(true); setError(null);
    const r = await lensRun('game', action, input);
    if (r.data.ok) setResult({ _action: action, ...(r.data.result as Record<string, unknown>) });
    else setError(r.data.error || 'calculation failed');
    setBusy(false);
  }, []);

  const CALC_TABS: { id: CalcTab; label: string; icon: typeof Scale }[] = [
    { id: 'balance', label: 'Unit Balance', icon: Scale },
    { id: 'economy', label: 'Economy Sim', icon: TrendingUp },
    { id: 'curve', label: 'Level Curve', icon: Activity },
    { id: 'drops', label: 'Drop Rates', icon: BarChart2 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap">
        {CALC_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setResult(null); setError(null); }}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded text-xs',
              tab === t.id ? 'bg-neon-purple/15 text-neon-purple border border-neon-purple/30' : 'text-gray-400 border border-transparent hover:text-white')}
          >
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'balance' && (
        <div className="lens-card space-y-3">
          <p className="text-xs text-gray-400">Enter each unit&apos;s stats — power is derived as (hp/10 + attack + defense + speed)/4, efficiency as power/cost, matching the real `game.balanceCheck` formula.</p>
          <div className="space-y-2">
            {units.map((u, i) => (
              <div key={i} className="grid grid-cols-7 gap-1.5 items-center">
                <input value={u.name} onChange={(e) => updateUnit(i, { name: e.target.value })} placeholder="Name" className="input-lattice text-xs col-span-2" />
                {(['hp', 'attack', 'defense', 'speed', 'cost'] as const).map((field) => (
                  <input key={field} type="number" value={u[field]} onChange={(e) => updateUnit(i, { [field]: Number(e.target.value) } as Partial<UnitRow>)} placeholder={field} title={field} className="input-lattice text-xs" />
                ))}
                <button onClick={() => removeUnit(i)} disabled={units.length <= 2} className="text-red-400 text-xs disabled:opacity-30" aria-label={`Remove ${u.name}`}>✕</button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={addUnit} className="text-xs text-neon-cyan flex items-center gap-1"><Plus className="w-3 h-3" /> Add unit</button>
            <button onClick={() => run('balanceCheck', { units })} disabled={busy || units.length < 2} className="btn-neon text-xs py-1.5 px-4 ml-auto flex items-center gap-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Check Balance
            </button>
          </div>
        </div>
      )}

      {tab === 'economy' && (
        <div className="lens-card space-y-3">
          <p className="text-xs text-gray-400">Simulates gold flow over time with compounding inflation on spend — matches `game.economySimulate`.</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {([
              ['startingGold', 'Starting Gold'], ['goldPerMinute', 'Gold / min'], ['avgSpendPerMinute', 'Spend / min'],
              ['inflationPercent', 'Inflation %'], ['simulateMinutes', 'Minutes'],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-[10px] text-gray-400 block">
                {label}
                <input type="number" value={econ[key]} onChange={(e) => setEcon((p) => ({ ...p, [key]: Number(e.target.value) }))} className="input-lattice w-full text-xs mt-0.5" />
              </label>
            ))}
          </div>
          <button onClick={() => run('economySimulate', econ)} disabled={busy} className="btn-neon text-xs py-1.5 px-4 flex items-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Simulate Economy
          </button>
        </div>
      )}

      {tab === 'curve' && (
        <div className="lens-card space-y-3">
          <p className="text-xs text-gray-400">XP-per-level curve — `xpRequired = baseXP × growthFactor^(level-1)` — matches `game.levelCurve`.</p>
          <div className="grid grid-cols-3 gap-2">
            {([['maxLevel', 'Max Level'], ['baseXP', 'Base XP'], ['growthFactor', 'Growth Factor']] as const).map(([key, label]) => (
              <label key={key} className="text-[10px] text-gray-400 block">
                {label}
                <input type="number" step={key === 'growthFactor' ? 0.05 : 1} value={curve[key]} onChange={(e) => setCurve((p) => ({ ...p, [key]: Number(e.target.value) }))} className="input-lattice w-full text-xs mt-0.5" />
              </label>
            ))}
          </div>
          <button onClick={() => run('levelCurve', curve)} disabled={busy} className="btn-neon text-xs py-1.5 px-4 flex items-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Compute Curve
          </button>
        </div>
      )}

      {tab === 'drops' && (
        <div className="lens-card space-y-3">
          <p className="text-xs text-gray-400">Pity-system math from a flat drop rate — expected drops, P(≥1), and attempts to hit 50/90/99% — matches `game.dropRateCalc`.</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-gray-400 block">
              Drop Rate %
              <input type="number" step={0.1} value={drop.dropRatePercent} onChange={(e) => setDrop((p) => ({ ...p, dropRatePercent: Number(e.target.value) }))} className="input-lattice w-full text-xs mt-0.5" />
            </label>
            <label className="text-[10px] text-gray-400 block">
              Attempts
              <input type="number" value={drop.attempts} onChange={(e) => setDrop((p) => ({ ...p, attempts: Number(e.target.value) }))} className="input-lattice w-full text-xs mt-0.5" />
            </label>
          </div>
          <button onClick={() => run('dropRateCalc', drop)} disabled={busy} className="btn-neon text-xs py-1.5 px-4 flex items-center gap-1">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Calculate
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{error}</p>}

      {result && result._action === 'balanceCheck' && (
        <div className="lens-card space-y-2">
          {result.message ? <p className="text-sm text-gray-400">{String(result.message)}</p> : (
            <>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  ['Avg Power', result.avgPower], ['Variance', result.powerVariance],
                  ['Strongest', result.strongest], ['Weakest', result.weakest],
                ].map(([label, val]) => (
                  <div key={label as string} className="bg-white/5 rounded p-2">
                    <p className="text-sm font-bold text-white">{String(val ?? '—')}</p>
                    <p className="text-[10px] text-gray-400">{label as string}</p>
                  </div>
                ))}
              </div>
              <div className={cn('text-xs px-3 py-1.5 rounded border',
                result.balance === 'well-balanced' ? 'bg-neon-green/10 border-neon-green/30 text-neon-green'
                  : result.balance === 'slightly-unbalanced' ? 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400'
                    : 'bg-red-400/10 border-red-400/30 text-red-400')}>
                {String(result.balance).replace(/-/g, ' ')}
              </div>
            </>
          )}
        </div>
      )}

      {result && result._action === 'economySimulate' && (
        <div className="lens-card space-y-2">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[['Final Gold', result.finalGold], ['Net Flow', result.netFlow], ['Sustainable', result.sustainable ? 'Yes' : 'No']].map(([label, val]) => (
              <div key={label as string} className="bg-white/5 rounded p-2">
                <p className="text-sm font-bold text-white">{String(val)}</p>
                <p className="text-[10px] text-gray-400">{label as string}</p>
              </div>
            ))}
          </div>
          {!!result.tip && <p className="text-xs text-gray-400 italic">{String(result.tip)}</p>}
        </div>
      )}

      {result && result._action === 'levelCurve' && (
        <div className="lens-card space-y-2">
          <div className="grid grid-cols-4 gap-2 text-center">
            {[['Total XP to Max', (result.totalXPToMax as number)?.toLocaleString()], ['Midpoint', `Lv ${result.midpointLevel}`], ['Feel', String(result.earlyGameFeels).replace(/-/g, ' ')]].map(([label, val]) => (
              <div key={label as string} className="bg-white/5 rounded p-2">
                <p className="text-sm font-bold text-white">{String(val)}</p>
                <p className="text-[10px] text-gray-400">{label as string}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && result._action === 'dropRateCalc' && (
        <div className="lens-card space-y-2">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['Expected Drops', result.expectedDrops], ['P(≥1)', result.probabilityAtLeastOne], ['90% Chance', `${result.attemptsFor90Percent} tries`]].map(([label, val]) => (
              <div key={label as string} className="bg-white/5 rounded p-2">
                <p className="text-sm font-bold text-white">{String(val)}</p>
                <p className="text-[10px] text-gray-400">{label as string}</p>
              </div>
            ))}
          </div>
          {!!result.pitySystemSuggestion && <p className="text-xs text-neon-cyan bg-neon-cyan/5 border border-neon-cyan/20 rounded px-3 py-2">{String(result.pitySystemSuggestion)}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Playtest Sessions (real persisted artifacts + stateful macros)
// ---------------------------------------------------------------------------

function PlaytestSessions() {
  const { items, isLoading, create, refetch } = useLensData<SessionData>('game', 'playtest', { noSeed: true });
  const runArtifact = useRunArtifact('game');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [turnForm, setTurnForm] = useState({ action: 'attack', difficulty: 1 });
  const [rewardXp, setRewardXp] = useState(100);
  const [simScenarios, setSimScenarios] = useState('1,1,2');
  const [balanceForm, setBalanceForm] = useState({ base: 100, growthRate: 1.5, maxLevel: 20 });
  const [analysis, setAnalysis] = useState<{ kind: 'simulate' | 'balance'; data: Record<string, unknown> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(() => items.find((i) => i.id === selectedId) || null, [items, selectedId]);

  const createSession = async () => {
    if (!newTitle.trim()) return;
    setBusy('create');
    try {
      const res = await create({ title: newTitle.trim(), data: { level: 1, xp: 0, turns: [] } }) as unknown as { artifact?: { id: string } };
      setNewTitle('');
      if (res?.artifact?.id) setSelectedId(res.artifact.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'create failed'); }
    setBusy(null);
  };

  const act = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    if (!selected) return;
    setBusy(action); setError(null);
    try {
      const res = await runArtifact.mutateAsync({ id: selected.id, action, params });
      if (res.ok === false) { setError((res as unknown as { error?: string }).error || `${action} failed`); }
      else if (action === 'simulate' || action === 'balance') {
        setAnalysis({ kind: action, data: res.result as Record<string, unknown> });
      }
      await refetch();
    } catch (e) { setError(e instanceof Error ? e.message : `${action} failed`); }
    setBusy(null);
  }, [selected, runArtifact, refetch]);

  const data: SessionData = selected?.data || {};
  const turns = data.turns || [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Create a named playtest session, then resolve turns against it — the deterministic outcome roll and XP curve come from the real `game` turn-simulation macros, not client-side math.
      </p>
      <div className="flex gap-2 items-end">
        <div className="flex-1 min-w-[160px]">
          <label className="text-[10px] text-gray-400 block mb-1">New session name</label>
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Boss Rush Draft 1" className="input-lattice w-full text-sm" onKeyDown={(e) => e.key === 'Enter' && createSession()} />
        </div>
        <button onClick={createSession} disabled={busy === 'create' || !newTitle.trim()} className="btn-neon text-sm py-2 px-4 flex items-center gap-1">
          {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} New Session
        </button>
      </div>

      {isLoading && <p className="text-xs text-gray-400">Loading sessions…</p>}
      {!isLoading && items.length === 0 && <p className="text-xs text-gray-400 italic">No playtest sessions yet. Create one to start resolving turns.</p>}

      {items.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {items.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSelectedId(s.id); setAnalysis(null); }}
              className={cn('text-xs px-3 py-1.5 rounded border', selectedId === s.id ? 'border-neon-purple/50 bg-neon-purple/15 text-neon-purple' : 'border-lattice-border text-gray-400 hover:text-white')}
            >
              {s.title} · Lv {(s.data?.level as number) || 1}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{error}</p>}

      {selected && (
        <div className="lens-card space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">{selected.title}</h3>
              <p className="text-[11px] text-gray-400 font-mono">Level {data.level || 1} · {data.xp || 0} XP · {turns.length} turn(s){data.status === 'completed' && ' · completed'}</p>
            </div>
            <div className="flex gap-1.5">
              <button onClick={() => act('levelup')} disabled={!!busy} className="text-xs px-3 py-1.5 rounded border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/10 flex items-center gap-1"><ArrowUp className="w-3 h-3" /> Level Up</button>
              <button onClick={() => act('claim', { reward: { xp: rewardXp, type: 'manual' } })} disabled={!!busy} className="text-xs px-3 py-1.5 rounded border border-amber-400/40 text-amber-300 hover:bg-amber-400/10 flex items-center gap-1"><Gift className="w-3 h-3" /> Claim</button>
              <button onClick={() => act('complete')} disabled={!!busy || data.status === 'completed'} className="text-xs px-3 py-1.5 rounded border border-neon-green/40 text-neon-green hover:bg-neon-green/10 flex items-center gap-1 disabled:opacity-40"><CheckCircle2 className="w-3 h-3" /> Complete</button>
            </div>
          </div>

          {/* Resolve turn */}
          <div className="bg-lattice-bg rounded p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-300">Resolve a Turn</p>
            <div className="flex gap-2 flex-wrap items-end">
              <div className="flex-1 min-w-[140px]">
                <label className="text-[10px] text-gray-400 block mb-1">Action</label>
                <input value={turnForm.action} onChange={(e) => setTurnForm((p) => ({ ...p, action: e.target.value }))} className="input-lattice w-full text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1">Difficulty</label>
                <input type="number" min={1} step={0.5} value={turnForm.difficulty} onChange={(e) => setTurnForm((p) => ({ ...p, difficulty: Number(e.target.value) }))} className="input-lattice w-24 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-gray-400 block mb-1 opacity-0">Reward XP</label>
                <input type="number" min={0} value={rewardXp} onChange={(e) => setRewardXp(Number(e.target.value))} title="Reward XP for the Claim button" className="input-lattice w-24 text-sm" />
              </div>
              <button onClick={() => act('resolve_turn', turnForm)} disabled={!!busy} className="btn-neon text-sm py-1.5 px-4 flex items-center gap-1">
                {busy === 'resolve_turn' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Resolve
              </button>
            </div>
            {turns.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {[...turns].reverse().slice(0, 10).map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-[11px] bg-white/5 rounded px-2 py-1">
                    <span className={t.outcome === 'success' ? 'text-neon-green' : 'text-red-400'}>{t.outcome}</span>
                    <span className="text-gray-300 flex-1 px-2 truncate">{t.action} (×{t.difficulty})</span>
                    <span className="text-gray-400">{Math.round(t.successProbability * 100)}% chance</span>
                    <span className="font-mono text-neon-yellow ml-2">+{t.xpGained} XP</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Simulate + Balance analysis */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-lattice-bg rounded p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-300">Simulate Scenarios</p>
              <p className="text-[10px] text-gray-400">Comma-separated difficulty values — forecasts outcomes off this session&apos;s real turn history, without recording new turns.</p>
              <div className="flex gap-2">
                <input value={simScenarios} onChange={(e) => setSimScenarios(e.target.value)} placeholder="1,1,2,3" className="input-lattice flex-1 text-sm" />
                <button
                  onClick={() => act('simulate', { scenarios: simScenarios.split(',').map((s) => ({ difficulty: Number(s.trim()) || 1 })) })}
                  disabled={!!busy}
                  className="text-xs px-3 py-1.5 rounded border border-neon-purple/40 text-neon-purple hover:bg-neon-purple/10"
                >Forecast</button>
              </div>
              {analysis?.kind === 'simulate' && (
                <div className="space-y-1">
                  {((analysis.data.simulation as { outcomes: { result: string; probability: number; xpGained: number }[] })?.outcomes || []).map((o, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] bg-white/5 rounded px-2 py-1">
                      <span className={o.result === 'success' ? 'text-neon-green' : 'text-red-400'}>{o.result}</span>
                      <span className="text-gray-400">{Math.round(o.probability * 100)}%</span>
                      <span className="font-mono text-neon-yellow">+{o.xpGained} XP</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-lattice-bg rounded p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-300">Balance Report</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(['base', 'growthRate', 'maxLevel'] as const).map((key) => (
                  <input key={key} type="number" value={balanceForm[key]} onChange={(e) => setBalanceForm((p) => ({ ...p, [key]: Number(e.target.value) }))} title={key} placeholder={key} className="input-lattice text-xs" />
                ))}
              </div>
              <button onClick={() => act('balance', balanceForm)} disabled={!!busy} className="text-xs px-3 py-1.5 rounded border border-yellow-400/40 text-yellow-300 hover:bg-yellow-400/10 w-full">Generate Report</button>
              {analysis?.kind === 'balance' && (() => {
                const b = analysis.data.balance as { progressPercent: number; avgXpPerAction: number; assessment: string[] };
                return (
                  <div className="space-y-1 text-[11px]">
                    <p className="text-gray-300">Progress to next level: <span className="text-white font-mono">{b.progressPercent}%</span></p>
                    <p className="text-gray-300">Avg XP/action: <span className="text-white font-mono">{b.avgXpPerAction}</span></p>
                    <div className="flex gap-1 flex-wrap">
                      {b.assessment.map((a) => (
                        <span key={a} className={cn('px-1.5 py-0.5 rounded text-[10px]', a === 'balanced' ? 'bg-neon-green/15 text-neon-green' : 'bg-yellow-400/15 text-yellow-300')}>{a.replace(/_/g, ' ')}</span>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameDesignLab;
