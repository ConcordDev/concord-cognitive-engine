'use client';

/**
 * CrtAudiencePanel — platforms and follower-count tracking over time.
 */

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Loader2, Plus, Trash2, Users, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Platform { platformId: string; name: string; followers: number; growth: number }
interface Snapshot { id: string; platformId: string; followers: number; date: string }

export function CrtAudiencePanel({ onChange }: { onChange: () => void }) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newPlatform, setNewPlatform] = useState({ name: '', handle: '' });
  const [logForm, setLogForm] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creator', 'audience-summary', {});
    setPlatforms(r.data?.result?.platforms || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadHistory = async (platformId: string) => {
    if (expanded === platformId) { setExpanded(null); return; }
    const r = await lensRun('creator', 'audience-history', { platformId });
    setHistory(r.data?.result?.snapshots || []);
    setExpanded(platformId);
  };

  const addPlatform = async () => {
    if (!newPlatform.name.trim()) { setError('Platform name is required.'); return; }
    const r = await lensRun('creator', 'platform-add', { name: newPlatform.name.trim(), handle: newPlatform.handle.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setNewPlatform({ name: '', handle: '' });
    setError(null);
    await refresh();
  };

  const delPlatform = async (id: string) => {
    await lensRun('creator', 'platform-delete', { id });
    if (expanded === id) setExpanded(null);
    await refresh();
  };

  const logFollowers = async (platformId: string) => {
    const v = Number(logForm[platformId]);
    if (!(v >= 0)) return;
    await lensRun('creator', 'audience-log', { platformId, followers: v });
    setLogForm((p) => ({ ...p, [platformId]: '' }));
    if (expanded === platformId) {
      const r = await lensRun('creator', 'audience-history', { platformId });
      setHistory(r.data?.result?.snapshots || []);
    }
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Platform (e.g. YouTube)" value={newPlatform.name}
          onChange={(e) => setNewPlatform({ ...newPlatform, name: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Handle" value={newPlatform.handle}
          onChange={(e) => setNewPlatform({ ...newPlatform, handle: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={addPlatform}
          className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Platform
        </button>
      </section>

      {platforms.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No platforms yet. Add one to track your audience.</p>
      ) : (
        <ul className="space-y-2">
          {platforms.map((p) => (
            <li key={p.platformId} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-red-400 shrink-0" />
                <button type="button" onClick={() => loadHistory(p.platformId)} className="flex-1 text-left">
                  <span className="text-sm font-semibold text-zinc-100">{p.name}</span>
                </button>
                <span className="text-xs text-zinc-300">{p.followers.toLocaleString()}</span>
                {p.growth !== 0 && (
                  <span className={p.growth > 0 ? 'text-[11px] text-emerald-400' : 'text-[11px] text-rose-400'}>
                    {p.growth > 0 ? '+' : ''}{p.growth.toLocaleString()}
                  </span>
                )}
                <button aria-label="Delete" type="button" onClick={() => delPlatform(p.platformId)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <input placeholder="Current followers" inputMode="numeric" value={logForm[p.platformId] || ''}
                  onChange={(e) => setLogForm((s) => ({ ...s, [p.platformId]: e.target.value }))}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                <button type="button" onClick={() => logFollowers(p.platformId)}
                  className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Log</button>
              </div>
              {expanded === p.platformId && (
                <div className="mt-2.5 pt-2.5 border-t border-zinc-800">
                  <p className="flex items-center gap-1 text-[10px] text-zinc-400 mb-1.5">
                    <TrendingUp className="w-3 h-3" /> Follower history
                  </p>
                  {history.length > 1 ? (
                    <ResponsiveContainer width="100%" height={130}>
                      <LineChart data={history.map((h) => ({ date: h.date.slice(5), followers: h.followers }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                        <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} />
                        <YAxis tick={{ fontSize: 9, fill: '#71717a' }} width={36} />
                        <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
                        <Line type="monotone" dataKey="followers" stroke="#f87171" strokeWidth={2} dot={{ r: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-[10px] text-zinc-400 italic">Log at least two snapshots to see a trend.</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
