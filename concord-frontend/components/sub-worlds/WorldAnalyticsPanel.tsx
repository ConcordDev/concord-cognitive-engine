'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { X, Eye, Users, Star, TrendingUp } from 'lucide-react';
import { ChartKit } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import type { SubWorld } from './WorldCard';

interface Analytics {
  world_id: string;
  name: string;
  total_visits: number;
  unique_visitors: number;
  favorites: number;
  popularity: number;
  editors: number;
  blocks: number;
  timeline: Array<{ day: string; visits: number }>;
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-0.5 font-mono text-lg text-cyan-300">{value}</div>
    </div>
  );
}

export function WorldAnalyticsPanel({
  world,
  onClose,
}: {
  world: SubWorld;
  onClose: () => void;
}) {
  const [data, setData] = useState<Analytics | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun('sub_worlds', 'analytics', { worldId: world.world_id });
    if (r.data?.ok) setData(r.data.result as Analytics);
    else setErr(r.data?.error || 'failed to load analytics');
  }, [world.world_id]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-cyan-800/60 bg-zinc-950 p-5 space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-cyan-300">World Analytics</h2>
            <p className="text-[11px] text-zinc-400">{world.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-400 hover:text-zinc-200">
            <X className="h-5 w-5" />
          </button>
        </header>

        {err && (
          <div className="rounded-lg border border-rose-800/50 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
            {err}
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-4 gap-2">
              <Stat icon={Eye} label="Visits" value={data.total_visits} />
              <Stat icon={Users} label="Unique" value={data.unique_visitors} />
              <Stat icon={Star} label="Favorites" value={data.favorites} />
              <Stat icon={TrendingUp} label="Popularity" value={data.popularity} />
            </div>

            <div>
              <h3 className="mb-2 text-[11px] uppercase tracking-wider text-zinc-400">Visits — last 14 days</h3>
              <ChartKit
                kind="bar"
                data={data.timeline}
                xKey="day"
                series={[{ key: 'visits', label: 'Visits', color: '#06b6d4' }]}
                height={200}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                <span className="text-zinc-400">Co-editors:</span> {data.editors}
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                <span className="text-zinc-400">Authored blocks:</span> {data.blocks}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
