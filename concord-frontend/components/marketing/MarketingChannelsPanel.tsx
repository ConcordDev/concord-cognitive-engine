'use client';

/**
 * MarketingChannelsPanel — channel performance comparison and audience
 * segments.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Radio, Users } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ChannelRow {
  channel: string; campaigns: number;
  kpis: { spend: number; revenue: number; roas: number; ctr: number; conversions: number };
}
interface Segment { id: string; name: string; criteria: string | null; size: number }

export function MarketingChannelsPanel() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [totalReach, setTotalReach] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', criteria: '', size: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, s] = await Promise.all([
      lensRun('marketing', 'channel-performance', {}),
      lensRun('marketing', 'segment-list', {}),
    ]);
    setChannels(c.data?.result?.channels || []);
    setSegments(s.data?.result?.segments || []);
    setTotalReach(s.data?.result?.totalReach || 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addSegment = async () => {
    if (!form.name.trim()) { setError('Segment name is required.'); return; }
    const r = await lensRun('marketing', 'segment-create', {
      name: form.name.trim(), criteria: form.criteria.trim(), size: Number(form.size) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', criteria: '', size: '' });
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const maxRoas = Math.max(1, ...channels.map((c) => c.kpis.roas));

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Channel performance */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Radio className="w-3.5 h-3.5 text-orange-400" /> Channel performance
        </h3>
        {channels.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No channel data. Log campaign metrics to compare channels.</p>
        ) : (
          <ul className="space-y-2">
            {channels.map((c) => (
              <li key={c.channel} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-zinc-100 capitalize">{c.channel}</span>
                  <span className="text-[11px] text-zinc-400">
                    {c.kpis.roas}× ROAS · ${c.kpis.spend} → ${c.kpis.revenue}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(c.kpis.roas / maxRoas) * 100}%` }} />
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  {c.campaigns} campaigns · {c.kpis.ctr}% CTR · {c.kpis.conversions} conversions
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Audience segments */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Users className="w-3.5 h-3.5 text-orange-400" /> Audience segments
          {totalReach > 0 && <span className="text-[10px] text-zinc-500">· {totalReach.toLocaleString()} total reach</span>}
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Segment name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Criteria" value={form.criteria} onChange={(e) => setForm({ ...form, criteria: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Size" inputMode="numeric" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addSegment}
            className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {segments.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No audience segments defined.</p>
        ) : (
          <ul className="space-y-1">
            {segments.map((s) => (
              <li key={s.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{s.name}</p>
                  {s.criteria && <p className="text-[10px] text-zinc-500">{s.criteria}</p>}
                </div>
                <span className="text-[11px] text-zinc-400 font-mono">{s.size.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
