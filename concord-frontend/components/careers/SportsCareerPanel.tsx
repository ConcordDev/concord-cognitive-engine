'use client';

/**
 * SportsCareerPanel — the sports half of the Careers lens, surfaced.
 *
 * The header has always claimed "jobs and sports run on one engine"; the
 * engine was real (server/domains/sports-careers.js, 13 macros over
 * server/lib/sports-league-engine.js) but no surface in this lens called
 * it. This panel is that surface, built only from the domain's player-true
 * verbs: leagues (discovery) · teams · my_career · request_tryout ·
 * advance_stage · retire · constants. League operation verbs
 * (open_league / schedule_match / play_match / tick) belong to the world,
 * not the player, and stay unsurfaced here. Nothing is fabricated: a
 * world with no leagues shows an honest empty state.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trophy, Medal, Flag, LogOut } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui';

// server/migrations/211_sports_leagues.js — the sport kinds the substrate accepts.
const SPORT_KINDS = ['basketball', 'soccer', 'brawling', 'racing', 'esports', 'baseball'] as const;
const STAGE_ORDER = ['amateur', 'semi_pro', 'pro', 'all_star', 'legend'] as const;
const stageLabel = (s: string) => s.replace(/_/g, ' ');

interface League { id: string; name: string; sport_kind: string; season_num: number; team_count: number }
interface Team { id: string; name: string; wins: number; losses: number; draws: number; power_score: number }
interface SportsCareer {
  id: string; sport_kind: string; stage: string;
  tryouts_attempted: number; tryouts_passed: number;
  matches_played: number; total_score: number; mvp_awards: number;
  retired_at: number | null;
}
interface StageThreshold { matches: number; mvp: number; total: number }

export function SportsCareerPanel() {
  const { user } = useAuth();
  const addToast = useUIStore((s) => s.addToast);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [leagueId, setLeagueId] = useState<string>('');
  const [teams, setTeams] = useState<Team[]>([]);
  const [sport, setSport] = useState<string>('basketball');
  const [career, setCareer] = useState<SportsCareer | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, StageThreshold>>({});
  const [athletic, setAthletic] = useState(30);
  const [reflex, setReflex] = useState(30);
  const [tryoutNote, setTryoutNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadLeagues = useCallback(async () => {
    setLoading(true);
    try {
      const r = (await lensRun<{ ok: boolean; leagues?: League[] }>('sports_careers', 'leagues', {})).data.result;
      const list = r?.leagues || [];
      setLeagues(list);
      if (list.length > 0) setLeagueId((cur) => cur || list[0].id);
    } catch {
      setLeagues([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void loadLeagues(); }, [loadLeagues]);

  useEffect(() => {
    void (async () => {
      try {
        const r = (await lensRun<{ ok: boolean; constants?: { STAGE_THRESHOLDS?: Record<string, StageThreshold> } }>('sports_careers', 'constants', {})).data.result;
        setThresholds(r?.constants?.STAGE_THRESHOLDS || {});
      } catch { /* thresholds are explanatory copy; the panel works without them */ }
    })();
  }, []);

  useEffect(() => {
    if (!leagueId) { setTeams([]); return; }
    void (async () => {
      try {
        const r = (await lensRun<{ ok: boolean; teams?: Team[] }>('sports_careers', 'teams', { leagueId })).data.result;
        setTeams(r?.teams || []);
      } catch { setTeams([]); }
    })();
  }, [leagueId]);

  const loadCareer = useCallback(async (sportKind: string) => {
    if (!user?.id) { setCareer(null); return; }
    try {
      const r = (await lensRun<{ ok: boolean; career?: SportsCareer }>('sports_careers', 'my_career', { sportKind })).data.result;
      setCareer(r?.career || null);
    } catch { setCareer(null); }
  }, [user?.id]);
  useEffect(() => { void loadCareer(sport); }, [sport, loadCareer]);

  const tryout = useCallback(async () => {
    if (!leagueId) return;
    setBusy('tryout');
    setTryoutNote(null);
    try {
      const r = (await lensRun<{ ok: boolean; passed?: boolean; composite?: number; required?: number; reason?: string }>(
        'sports_careers', 'request_tryout', { leagueId, athleticSkill: athletic, reflexSkill: reflex },
      )).data.result;
      if (r?.ok) {
        setTryoutNote(r.passed
          ? `Tryout passed — composite ${Math.round(r.composite ?? 0)} against the ${r.required} bar for your stage.`
          : `Not this time — composite ${Math.round(r.composite ?? 0)} against the ${r.required} bar for your stage. The bar drops at lower stages; the attempt is on your record.`);
        const lg = leagues.find((l) => l.id === leagueId);
        if (lg) { setSport(lg.sport_kind); void loadCareer(lg.sport_kind); }
      } else {
        setTryoutNote(`Tryout could not be run: ${r?.reason || 'failed'}.`);
      }
    } catch {
      setTryoutNote('Tryout request did not go through — please try again.');
    } finally {
      setBusy(null);
    }
  }, [leagueId, athletic, reflex, leagues, loadCareer]);

  const advance = useCallback(async () => {
    if (!career) return;
    setBusy('advance');
    try {
      const r = (await lensRun<{ ok: boolean; stage?: string; max?: boolean; reason?: string; next?: string; threshold?: StageThreshold }>(
        'sports_careers', 'advance_stage', { careerId: career.id },
      )).data.result;
      if (r?.ok && r.stage && !r.max) {
        addToast({ type: 'success', message: `Advanced to ${stageLabel(r.stage)}.` });
      } else if (r?.ok && r.max) {
        addToast({ type: 'info', message: 'Already at the top stage — legend.' });
      } else if (r?.reason === 'not_eligible' && r.threshold) {
        addToast({ type: 'info', message: `${stageLabel(r.next || '')} needs ${r.threshold.matches} matches · ${r.threshold.total} total points · ${r.threshold.mvp} MVPs.` });
      } else {
        addToast({ type: 'error', message: `Could not advance: ${r?.reason || 'failed'}.` });
      }
      void loadCareer(sport);
    } catch {
      addToast({ type: 'error', message: 'Advance request did not go through — please try again.' });
    } finally {
      setBusy(null);
    }
  }, [career, sport, addToast, loadCareer]);

  const retire = useCallback(async () => {
    if (!career) return;
    setBusy('retire');
    try {
      const r = (await lensRun<{ ok: boolean }>('sports_careers', 'retire', { careerId: career.id })).data.result;
      if (r?.ok) addToast({ type: 'success', message: 'Career retired. The record stands.' });
      void loadCareer(sport);
    } catch {
      addToast({ type: 'error', message: 'Retire request did not go through — please try again.' });
    } finally {
      setBusy(null);
    }
  }, [career, sport, addToast, loadCareer]);

  const league = leagues.find((l) => l.id === leagueId) || null;
  const nextStage = career ? STAGE_ORDER[STAGE_ORDER.indexOf(career.stage as typeof STAGE_ORDER[number]) + 1] : undefined;
  const nextThreshold = nextStage ? thresholds[nextStage] : undefined;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111] p-4 lg:col-span-2" aria-label="Sports career">
      <h2 className="text-sm font-semibold text-amber-100 mb-2 flex items-center gap-1">
        <Trophy className="w-4 h-4" aria-hidden="true" /> Sports career — the other half of the engine
      </h2>
      {loading ? (
        <div role="status" aria-live="polite" aria-busy="true" className="text-gray-400 text-xs flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading leagues…
        </div>
      ) : leagues.length === 0 ? (
        <p className="text-gray-500 text-xs">
          No leagues have been founded in this world yet. Leagues are founded by the world, not by players —
          when the first one opens, its teams, tryouts, and your sports career appear here.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="sr-only" htmlFor="sports-league">League</label>
            <select
              id="sports-league" value={leagueId} onChange={(e) => setLeagueId(e.target.value)}
              className="bg-black/60 border border-white/10 rounded px-2 py-1 text-sm w-full"
            >
              {leagues.map((l) => (
                <option key={l.id} value={l.id}>{l.name} · {l.sport_kind} · season {l.season_num} · {l.team_count} teams</option>
              ))}
            </select>
            {teams.length === 0 ? (
              <p className="text-gray-500 text-xs mt-2">No teams in {league?.name || 'this league'} yet.</p>
            ) : (
              <ul className="space-y-1 text-xs mt-2">
                {teams.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 bg-black/30 border border-white/5 rounded px-2 py-1">
                    <span className="text-gray-100 truncate">{t.name}</span>
                    <span className="text-gray-400 tabular-nums shrink-0">{t.wins}W · {t.losses}L · {t.draws}D · power {Math.round(t.power_score)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-xs text-gray-300 mb-2">Try out for {league?.name || 'this league'} — the bar is set by your career stage.</p>
              <div className="flex flex-col gap-2 text-xs">
                <label className="flex items-center gap-2">
                  <span className="w-16 text-gray-400">Athletic</span>
                  <input type="range" min={0} max={100} value={athletic} onChange={(e) => setAthletic(Number(e.target.value))}
                    aria-label="Athletic skill for the tryout" className="flex-1" />
                  <span className="tabular-nums text-amber-200 w-8 text-right">{athletic}</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-16 text-gray-400">Reflex</span>
                  <input type="range" min={0} max={100} value={reflex} onChange={(e) => setReflex(Number(e.target.value))}
                    aria-label="Reflex skill for the tryout" className="flex-1" />
                  <span className="tabular-nums text-amber-200 w-8 text-right">{reflex}</span>
                </label>
              </div>
              <button
                onClick={() => void tryout()} disabled={busy === 'tryout' || !user?.id}
                aria-label="Request a tryout for the selected league"
                className="mt-2 inline-flex items-center gap-1 px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 transition-colors text-black text-xs font-medium disabled:opacity-50"
              ><Flag className="w-3 h-3" aria-hidden="true" /> {busy === 'tryout' ? 'Trying out…' : 'Request tryout'}</button>
              {!user?.id && <p className="text-gray-500 text-xs mt-1">Sign in to try out.</p>}
              {tryoutNote && <p role="status" aria-live="polite" className="text-xs text-gray-300 mt-2">{tryoutNote}</p>}
            </div>
          </div>
          <div>
            <label className="sr-only" htmlFor="sports-kind">Sport</label>
            <select
              id="sports-kind" value={sport} onChange={(e) => setSport(e.target.value)}
              className="bg-black/60 border border-white/10 rounded px-2 py-1 text-sm w-full"
            >
              {SPORT_KINDS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {!user?.id ? (
              <p className="text-gray-500 text-xs mt-2">Sign in to start your {sport} career.</p>
            ) : !career ? (
              <p className="text-gray-500 text-xs mt-2">Loading your {sport} career…</p>
            ) : (
              <div className="text-xs text-gray-300 space-y-1.5 mt-2">
                <p className="flex items-center gap-1.5">
                  <Medal className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                  Stage: <span className="text-amber-200 capitalize">{stageLabel(career.stage)}</span>
                  {career.retired_at ? <span className="text-gray-500">· retired</span> : null}
                </p>
                <p className="tabular-nums">
                  {career.matches_played} matches · {career.total_score} total points · {career.mvp_awards} MVPs ·
                  tryouts {career.tryouts_passed}/{career.tryouts_attempted} passed
                </p>
                {nextStage && nextThreshold && !career.retired_at && (
                  <p className="text-gray-500">
                    {stageLabel(nextStage)} opens at {nextThreshold.matches} matches · {nextThreshold.total} total points · {nextThreshold.mvp} MVPs.
                  </p>
                )}
                {!career.retired_at && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      onClick={() => void advance()} disabled={busy === 'advance'}
                      aria-label="Advance to the next career stage"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-600/70 hover:bg-emerald-600 text-emerald-50 disabled:opacity-50"
                    >Advance stage</button>
                    <button
                      onClick={() => void retire()} disabled={busy === 'retire'}
                      aria-label="Retire this sports career"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-700/60 hover:bg-red-700 text-red-50 disabled:opacity-50"
                    ><LogOut className="w-3 h-3" aria-hidden="true" /> Retire</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
