'use client';

/**
 * SportsAthletesPanel — track athletes and log per-game stat lines.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, UserRound, ChevronLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Athlete { id: string; name: string; team: string | null; position: string | null }
interface StatLine { id: string; date: string; opponent: string | null; stats: Record<string, number> }

export function SportsAthletesPanel({ onChange }: { onChange: () => void }) {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', team: '', position: '' });
  const [selected, setSelected] = useState<Athlete | null>(null);
  const [lines, setLines] = useState<StatLine[]>([]);
  const [, setTotals] = useState<Record<string, number>>({});
  const [averages, setAverages] = useState<Record<string, number>>({});
  const [statForm, setStatForm] = useState({ opponent: '', stats: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('sports', 'athlete-list', {});
    setAthletes(r.data?.result?.athletes || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openAthlete = useCallback(async (a: Athlete) => {
    setSelected(a);
    const r = await lensRun('sports', 'athlete-stats', { athleteId: a.id });
    setLines(r.data?.result?.statLines || []);
    setTotals(r.data?.result?.totals || {});
    setAverages(r.data?.result?.averages || {});
  }, []);

  const track = async () => {
    if (!form.name.trim()) { setError('Athlete name is required.'); return; }
    const r = await lensRun('sports', 'athlete-track', {
      name: form.name.trim(), team: form.team.trim(), position: form.position.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', team: '', position: '' }); setError(null);
    await refresh();
  };
  const logStats = async () => {
    if (!selected) return;
    const stats: Record<string, number> = {};
    for (const pair of statForm.stats.split(',')) {
      const [k, v] = pair.split(':').map((x) => x.trim());
      if (k && Number.isFinite(Number(v))) stats[k.toLowerCase()] = Number(v);
    }
    if (Object.keys(stats).length === 0) { setError('Enter stats as "points:30, assists:8".'); return; }
    await lensRun('sports', 'athlete-stat-log', { athleteId: selected.id, opponent: statForm.opponent.trim(), stats });
    setStatForm({ opponent: '', stats: '' }); setError(null);
    await openAthlete(selected);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (selected) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All athletes
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="text-sm font-bold text-zinc-100">{selected.name}</h3>
          <p className="text-[11px] text-zinc-500">{[selected.team, selected.position].filter(Boolean).join(' · ') || 'No details'}</p>
        </div>

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        {Object.keys(averages).length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(averages).slice(0, 6).map(([k, v]) => (
              <div key={k} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
                <p className="text-sm font-bold text-zinc-100">{v}</p>
                <p className="text-[10px] text-zinc-500 capitalize">{k}/game</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input placeholder="Opponent" value={statForm.opponent} onChange={(e) => setStatForm({ ...statForm, opponent: e.target.value })}
            className="w-28 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="points:30, assists:8" value={statForm.stats} onChange={(e) => setStatForm({ ...statForm, stats: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={logStats}
            className="px-2.5 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg">Log</button>
        </div>

        {lines.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No stat lines logged.</p>
        ) : (
          <ul className="space-y-1">
            {lines.map((ln) => (
              <li key={ln.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-500">{ln.opponent || 'Game'} · {ln.date}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {Object.entries(ln.stats).map(([k, v]) => (
                    <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 capitalize">{k} {v}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Athlete name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Team" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
      </div>
      <button type="button" onClick={track}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
        <Plus className="w-3.5 h-3.5" /> Track athlete
      </button>

      {athletes.length === 0 ? (
        <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No athletes tracked. Add one to log stat lines.
        </div>
      ) : (
        <ul className="space-y-2">
          {athletes.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => openAthlete(a)}
                className="w-full text-left flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700">
                <UserRound className="w-4 h-4 text-red-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{a.name}</p>
                  <p className="text-[11px] text-zinc-500">{[a.team, a.position].filter(Boolean).join(' · ') || 'No details'}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
