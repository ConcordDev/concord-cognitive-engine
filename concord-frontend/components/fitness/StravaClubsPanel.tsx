'use client';

/**
 * StravaClubsPanel — clubs and group challenges.
 * fitness.club-list / club-create / club-join /
 * challenge-list / challenge-create / challenge-join.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Users, Trophy, Flag } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Club { id: string; name: string; sport: string; description: string | null; memberCount: number; joined: boolean }
interface ChallengeRow { rank: number; userId: string; value: number; isMe: boolean }
interface Challenge {
  id: string; name: string; metric: string; target: number;
  startDate: string; endDate: string; active: boolean; joined: boolean;
  participantCount: number;
  myProgress: { value: number; pct: number; complete: boolean };
  leaderboard: ChallengeRow[];
}

export function StravaClubsPanel() {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clubForm, setClubForm] = useState({ name: '', sport: 'run', description: '' });
  const [chForm, setChForm] = useState({ name: '', metric: 'distance', target: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, ch] = await Promise.all([
      lensRun('fitness', 'club-list', {}),
      lensRun('fitness', 'challenge-list', {}),
    ]);
    setClubs(c.data?.result?.clubs || []);
    setChallenges(ch.data?.result?.challenges || []);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createClub = async () => {
    if (!clubForm.name.trim()) { setError('Club name is required.'); return; }
    const r = await lensRun('fitness', 'club-create', {
      name: clubForm.name.trim(), sport: clubForm.sport, description: clubForm.description.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not create club'); return; }
    setClubForm({ name: '', sport: 'run', description: '' });
    await refresh();
  };
  const joinClub = async (c: Club) => {
    await lensRun('fitness', 'club-join', { id: c.id, leave: c.joined });
    await refresh();
  };

  const createChallenge = async () => {
    const target = Number(chForm.target);
    if (!chForm.name.trim()) { setError('Challenge name is required.'); return; }
    if (!target || target <= 0) { setError('Challenge target must be greater than zero.'); return; }
    const r = await lensRun('fitness', 'challenge-create', {
      name: chForm.name.trim(), metric: chForm.metric, target,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not create challenge'); return; }
    setChForm({ name: '', metric: 'distance', target: '' });
    await refresh();
  };
  const joinChallenge = async (ch: Challenge) => {
    await lensRun('fitness', 'challenge-join', { id: ch.id, leave: ch.joined });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Clubs */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Users className="w-3.5 h-3.5 text-orange-400" /> Clubs
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Club name" value={clubForm.name} onChange={(e) => setClubForm({ ...clubForm, name: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={clubForm.sport} onChange={(e) => setClubForm({ ...clubForm, sport: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['run', 'ride', 'swim', 'hike'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" onClick={createClub}
            className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Create
          </button>
        </div>
        {clubs.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No clubs yet.</p>
        ) : (
          <ul className="space-y-2">
            {clubs.map((c) => (
              <li key={c.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{c.name}</p>
                  <p className="text-[11px] text-zinc-400 capitalize">{c.sport} · {c.memberCount} members</p>
                </div>
                <button type="button" onClick={() => joinClub(c)}
                  className={cn('text-[11px] px-2.5 py-1 rounded-lg border',
                    c.joined ? 'border-zinc-700 text-zinc-400' : 'border-orange-700/50 bg-orange-950/40 text-orange-300')}>
                  {c.joined ? 'Leave' : 'Join'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Challenges */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Flag className="w-3.5 h-3.5 text-orange-400" /> Challenges
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Challenge name" value={chForm.name} onChange={(e) => setChForm({ ...chForm, name: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={chForm.metric} onChange={(e) => setChForm({ ...chForm, metric: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['distance', 'elevation', 'activity_count', 'duration'].map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Target" inputMode="decimal" value={chForm.target} onChange={(e) => setChForm({ ...chForm, target: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={createChallenge}
          className="w-full mb-2 flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg py-1.5">
          <Plus className="w-3.5 h-3.5" /> Create challenge
        </button>
        {challenges.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No challenges yet.</p>
        ) : (
          <ul className="space-y-2">
            {challenges.map((ch) => (
              <li key={ch.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{ch.name}</p>
                    <p className="text-[11px] text-zinc-400 capitalize">
                      {ch.metric.replace(/_/g, ' ')} · target {ch.target} · {ch.participantCount} in
                      {ch.active ? '' : ' · ended'}
                    </p>
                  </div>
                  <button type="button" onClick={() => joinChallenge(ch)}
                    className={cn('text-[11px] px-2.5 py-1 rounded-lg border',
                      ch.joined ? 'border-zinc-700 text-zinc-400' : 'border-orange-700/50 bg-orange-950/40 text-orange-300')}>
                    {ch.joined ? 'Leave' : 'Join'}
                  </button>
                </div>
                {ch.joined && (
                  <div className="mt-1.5 h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div className={cn('h-full rounded-full', ch.myProgress.complete ? 'bg-emerald-500' : 'bg-orange-500')}
                      style={{ width: `${ch.myProgress.pct}%` }} />
                  </div>
                )}
                {ch.leaderboard.length > 0 && (
                  <ol className="mt-2 space-y-0.5">
                    {ch.leaderboard.slice(0, 3).map((row) => (
                      <li key={row.userId} className={cn('flex items-center justify-between text-[10px]',
                        row.isMe ? 'text-orange-300' : 'text-zinc-400')}>
                        <span className="flex items-center gap-1">
                          {row.rank === 1 && <Trophy className="w-3 h-3 text-amber-400" />}
                          #{row.rank} {row.userId.slice(0, 10)}
                        </span>
                        <span className="font-mono">{row.value}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
