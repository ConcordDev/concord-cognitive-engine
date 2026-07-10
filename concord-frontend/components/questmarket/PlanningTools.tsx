/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

/**
 * PlanningTools — wires the three questmarket macros that had zero frontend
 * callers: `leaderboardRank`, `achievementUnlock`, `guildScore`.
 *
 * These are NOT the same as the live-data surfaces already wired elsewhere
 * in this lens (reputationBoard → LeaderboardPanel, achievementShowcase →
 * AchievementShowcase, guildDetail/listGuilds → GuildsPanel) — they operate
 * on caller-supplied hypothetical rosters/stats rather than the real
 * transactional STATE, so they're wired here as forward-looking planning
 * tools instead of being force-fit as duplicates of the live views:
 *
 *  - Rank Projector (leaderboardRank): seeds from your REAL reputation +
 *    achievements, then lets you project a hypothetical "+XP" delta to see
 *    how your composite score/tier would change before grinding for it.
 *  - Extended Achievement Report (achievementUnlock): this macro's
 *    catalogue is a DIFFERENT, larger set than achievementShowcase's
 *    (adds xp-100k / streak-100 / explorer-5 / polymath) — auto-computed
 *    from your real reputation stats + a real, honestly-labelled proxy for
 *    "categories" (distinct tags across quests you've posted).
 *  - Guild Composition Planner (guildScore): model a hypothetical member
 *    roster's tier/score BEFORE founding a guild or recruiting — distinct
 *    from GuildsPanel/guildDetail, which only shows guilds that already
 *    exist.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Loader2, Crosshair, Trophy, Users2, Sparkles, TrendingUp, Plus,
} from 'lucide-react';

const CARD = 'rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2.5';
const FIELD_LABEL = 'text-[10px] uppercase tracking-wider text-zinc-400 font-semibold';
const INPUT = 'w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white';
const AREA = `${INPUT} font-mono`;

function num(v: string, d = 0): number { const n = Number(v); return Number.isFinite(n) ? n : d; }

/* ─────────────────────── 1. Rank Projector ─────────────────────────── */

function RankProjector() {
  const [base, setBase] = useState<{ xp: number; completed: number; streak: number } | null>(null);
  const [achievements, setAchievements] = useState<{ rarity: string }[]>([]);
  const [delta, setDelta] = useState('0');
  const [projection, setProjection] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [rep, ach] = await Promise.all([
        lensRun<any>('questmarket', 'myReputation', {}),
        lensRun<any>('questmarket', 'achievementShowcase', {}),
      ]);
      if (rep.data?.ok && rep.data.result) {
        setBase({ xp: rep.data.result.xp, completed: rep.data.result.completed, streak: rep.data.result.streak });
      } else setErr(rep.data?.error || 'failed to load reputation');
      if (ach.data?.ok && ach.data.result) setAchievements(ach.data.result.unlocked || []);
      setLoading(false);
    })();
  }, []);

  const project = useCallback(async () => {
    if (!base) return;
    setBusy(true);
    const participants = [{
      name: 'You (projected)',
      xp: base.xp + Math.max(0, num(delta, 0)),
      questsCompleted: base.completed,
      streak: base.streak,
      achievements,
    }];
    const r = await lensRun<any>('questmarket', 'leaderboardRank', { participants });
    setBusy(false);
    if (r.data?.ok && r.data.result) setProjection(r.data.result.leaderboard?.[0] || null);
    else setErr(r.data?.error || 'projection failed');
  }, [base, delta, achievements]);

  useEffect(() => { if (base) project(); }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <Crosshair className="h-4 w-4 text-sky-400" />
        <h4 className="text-sm font-semibold text-white">Rank Projector</h4>
      </div>
      <p className="text-[11px] text-zinc-400">
        Seeded from your real XP, completed quests, streak, and unlocked achievements. Add a hypothetical
        XP delta to see how your composite tier score would move before you grind for it.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-[11px] text-zinc-400 py-3"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your stats…</div>
      ) : err ? (
        <div className="rounded border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-300">{err}</div>
      ) : base ? (
        <>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-300">
            <span>Base XP: <span className="text-amber-300 font-mono">{base.xp}</span></span>
            <span>Completed: <span className="font-mono">{base.completed}</span></span>
            <span>Streak: <span className="font-mono">{base.streak}</span></span>
            <span>Achievements: <span className="font-mono">{achievements.length}</span></span>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className={FIELD_LABEL}>Hypothetical additional XP</label>
              <input type="number" min={0} className={INPUT} value={delta} onChange={(e) => setDelta(e.target.value)} />
            </div>
            <button onClick={project} disabled={busy}
              className="flex items-center gap-1.5 rounded bg-sky-500/20 px-3 py-1.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/30 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />} Project
            </button>
          </div>
          {projection && (
            <div className="rounded border border-sky-700/40 bg-sky-950/20 p-2.5 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-sky-300">Projected tier</div>
                <div className="text-lg font-bold text-white">{projection.tier}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-sky-300">Composite score</div>
                <div className="text-lg font-bold font-mono text-sky-200">{projection.score.toLocaleString()}</div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/* ──────────────────── 2. Extended Achievement Report ───────────────── */

function ExtendedAchievements() {
  const [report, setReport] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [categoryCount, setCategoryCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [rep, mine] = await Promise.all([
      lensRun<any>('questmarket', 'myReputation', {}),
      lensRun<any>('questmarket', 'listQuests', { mine: true }),
    ]);
    if (!rep.data?.ok || !rep.data.result) { setErr(rep.data?.error || 'failed to load reputation'); setLoading(false); return; }
    // Honest proxy: "categories" = distinct tags across quests you've
    // posted (the transactional layer has no separate category field —
    // tags are the closest real signal, so we count those, not invent one).
    const tags = new Set<string>();
    for (const q of mine.data?.result?.quests || []) for (const t of q.tags || []) tags.add(t);
    setCategoryCount(tags.size);
    const r = await lensRun<any>('questmarket', 'achievementUnlock', {
      playerStats: {
        questsCompleted: rep.data.result.completed,
        totalXP: rep.data.result.xp,
        streakDays: rep.data.result.streak,
        uniqueCategories: tags.size,
      },
      achievements: [],
    });
    if (r.data?.ok && r.data.result) { setReport(r.data.result); setErr(null); }
    else setErr(r.data?.error || 'failed to compute extended report');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-fuchsia-400" />
        <h4 className="text-sm font-semibold text-white">Extended Achievement Report</h4>
      </div>
      <p className="text-[11px] text-zinc-400">
        A second, larger achievement catalogue (adds Archmage/100k-XP, Unstoppable/100-day-streak, Explorer,
        and Polymath tiers not in the showcase above). "Categories" is counted honestly from{' '}
        <span className="text-zinc-300">distinct tags across quests you&apos;ve posted</span> ({categoryCount}) —
        the transactional layer has no separate category field.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-[11px] text-zinc-400 py-3"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Computing…</div>
      ) : err ? (
        <div className="rounded border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-300">{err}</div>
      ) : report ? (
        <>
          <div className="flex items-center gap-3 text-[11px] text-zinc-300">
            <span>{report.alreadyUnlocked}/{report.totalAchievements} unlocked in this catalogue</span>
            <span className="text-fuchsia-300 font-mono">{report.completionRate}%</span>
          </div>
          {report.newlyUnlocked.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-emerald-300">Newly qualifying</p>
              <div className="flex flex-wrap gap-1.5">
                {report.newlyUnlocked.map((a: any) => (
                  <span key={a.id} className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">
                    {a.name} · {a.rarity}
                  </span>
                ))}
              </div>
            </div>
          )}
          {report.nextUp.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-400">Next up</p>
              <div className="space-y-1">
                {report.nextUp.map((a: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-[11px] text-zinc-300">
                    <span>{a.name} <span className="text-zinc-500">— {a.desc}</span></span>
                    <span className="text-zinc-500">{a.rarity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/* ───────────────────── 3. Guild Composition Planner ────────────────── */

function GuildPlanner() {
  const [roster, setRoster] = useState('');
  const [guildQuests, setGuildQuests] = useState('0');
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const plan = useCallback(async () => {
    const members = roster.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, xp, quests] = l.split('|').map((x) => x.trim());
      return { name: name || 'Member', xp: num(xp), questsCompleted: num(quests) };
    });
    if (members.length === 0) { setErr('Add at least one prospective member line.'); return; }
    setBusy(true);
    const r = await lensRun<any>('questmarket', 'guildScore', {
      guildName: 'Prospective guild', members, guildQuests: num(guildQuests),
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) { setResult(r.data.result); setErr(null); }
    else setErr(r.data?.error || 'planning failed');
  }, [roster, guildQuests]);

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <Users2 className="h-4 w-4 text-amber-400" />
        <h4 className="text-sm font-semibold text-white">Guild Composition Planner</h4>
      </div>
      <p className="text-[11px] text-zinc-400">
        Model a prospective roster before founding a guild or recruiting — separate from the live Guilds
        tab, which only shows guilds that already exist.
      </p>
      <div>
        <label className={FIELD_LABEL}>Prospective members — <span className="normal-case text-zinc-500">name | xp | questsCompleted</span></label>
        <textarea rows={3} className={AREA} value={roster} onChange={(e) => setRoster(e.target.value)}
          placeholder={'Aria | 1200 | 14\nBex | 640 | 7\nCato | 2100 | 22'} />
      </div>
      <div className="flex items-end gap-2">
        <div className="w-40">
          <label className={FIELD_LABEL}>Shared guild quests</label>
          <input type="number" min={0} className={INPUT} value={guildQuests} onChange={(e) => setGuildQuests(e.target.value)} />
        </div>
        <button onClick={plan} disabled={busy}
          className="flex items-center gap-1.5 rounded bg-amber-500/20 px-3 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Model guild
        </button>
      </div>
      {err && <div className="rounded border border-red-500/30 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-300">{err}</div>}
      {result && !result.message && (
        <div className="space-y-2">
          <div className="rounded border border-amber-700/40 bg-amber-950/20 p-2.5 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-300">Projected tier</div>
              <div className="text-lg font-bold text-white">{result.guildTier}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-amber-300">Guild score</div>
              <div className="text-lg font-bold font-mono text-amber-200">{result.guildScore.toLocaleString()}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-zinc-300">
            <span>Avg XP: <span className="font-mono">{result.avgXP}</span></span>
            <span>Avg quests: <span className="font-mono">{result.avgQuests}</span></span>
          </div>
          {result.topContributors?.length > 0 && (
            <div className="space-y-1">
              {result.topContributors.map((m: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-[11px] text-zinc-300">
                  <span>{m.name}</span>
                  <span className="text-amber-300 font-mono">{m.xp} XP · {m.quests} quests</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {result?.message && <p className="text-[11px] text-zinc-400">{result.message}</p>}
    </div>
  );
}

/* ─────────────────────────────── shell ──────────────────────────────── */

export function PlanningTools() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-semibold text-white">Planning Tools</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">what-if, grounded in your real stats</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <RankProjector />
        <ExtendedAchievements />
        <GuildPlanner />
      </div>
    </div>
  );
}
