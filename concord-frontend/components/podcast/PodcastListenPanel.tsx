'use client';

/**
 * PodcastListenPanel — continue listening, new episodes from
 * subscriptions and the up-next queue, with playback controls.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, Check, ListPlus, ListX, ArrowUp, ArrowDown, Gauge } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Episode {
  id: string; title: string; showTitle: string; durationSec: number;
  positionSec: number; played: boolean; progressPct: number; inQueue: boolean;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

function EpisodeCard({ ep, onChange, queueControls }: {
  ep: Episode; onChange: () => void;
  queueControls?: { onUp: () => void; onDown: () => void };
}) {
  const listen = async () => {
    await lensRun('podcast', 'playback-update', { episodeId: ep.id, positionSec: Math.min(ep.durationSec, ep.positionSec + 300) });
    onChange();
  };
  const done = async () => {
    await lensRun('podcast', 'episode-mark-played', { episodeId: ep.id, unplayed: ep.played });
    onChange();
  };
  const queue = async () => {
    await lensRun('podcast', ep.inQueue ? 'queue-remove' : 'queue-add', { episodeId: ep.id });
    onChange();
  };

  return (
    <li className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100 truncate">{ep.title}</p>
          <p className="text-[11px] text-zinc-400 truncate">{ep.showTitle} · {fmt(ep.durationSec)}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {queueControls && (
            <>
              <button aria-label="Move up" type="button" onClick={queueControls.onUp} className="text-zinc-600 hover:text-zinc-300"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button aria-label="Move down" type="button" onClick={queueControls.onDown} className="text-zinc-600 hover:text-zinc-300"><ArrowDown className="w-3.5 h-3.5" /></button>
            </>
          )}
        </div>
      </div>
      {ep.progressPct > 0 && !ep.played && (
        <div className="mt-1.5 h-1 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${ep.progressPct}%` }} />
        </div>
      )}
      <div className="flex items-center gap-1.5 mt-2">
        {!ep.played && (
          <button type="button" onClick={listen}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-violet-600 hover:bg-violet-500 text-white rounded-lg">
            <Play className="w-3 h-3" /> {ep.positionSec > 0 ? 'Resume 5m' : 'Listen 5m'}
          </button>
        )}
        <button type="button" onClick={done}
          className={cn('flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg',
            ep.played ? 'bg-emerald-700/30 text-emerald-300' : 'bg-zinc-800 text-zinc-400')}>
          <Check className="w-3 h-3" /> {ep.played ? 'Played' : 'Mark done'}
        </button>
        <button type="button" onClick={queue}
          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">
          {ep.inQueue ? <ListX className="w-3 h-3" /> : <ListPlus className="w-3 h-3" />}
          {ep.inQueue ? 'In queue' : 'Queue'}
        </button>
      </div>
    </li>
  );
}

export function PodcastListenPanel({ onChange }: { onChange: () => void }) {
  const [continueList, setContinueList] = useState<Episode[]>([]);
  const [newEps, setNewEps] = useState<Episode[]>([]);
  const [queue, setQueue] = useState<Episode[]>([]);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, n, q] = await Promise.all([
      lensRun('podcast', 'continue-listening', {}),
      lensRun('podcast', 'new-episodes', {}),
      lensRun('podcast', 'queue-list', {}),
    ]);
    setContinueList(c.data?.result?.episodes || []);
    setNewEps(n.data?.result?.episodes || []);
    setQueue(q.data?.result?.episodes || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const changeSpeed = async (v: number) => {
    setSpeed(v);
    await lensRun('podcast', 'playback-speed-set', { speed: v });
  };
  const reorder = async (episodeId: string, direction: string) => {
    await lensRun('podcast', 'queue-reorder', { episodeId, direction });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Gauge className="w-3.5 h-3.5 text-violet-400" /> Playback speed
        <div className="flex gap-1">
          {[1, 1.25, 1.5, 2].map((v) => (
            <button key={v} type="button" onClick={() => changeSpeed(v)}
              className={cn('text-[11px] px-1.5 py-0.5 rounded border',
                speed === v ? 'border-violet-700/50 bg-violet-950/40 text-violet-300' : 'border-zinc-700 text-zinc-400')}>
              {v}×
            </button>
          ))}
        </div>
      </div>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Continue listening</h3>
        {continueList.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Nothing in progress.</p>
        ) : (
          <ul className="space-y-2">{continueList.map((e) => <EpisodeCard key={e.id} ep={e} onChange={refresh} />)}</ul>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Up next</h3>
        {queue.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">Queue is empty.</p>
        ) : (
          <ul className="space-y-2">
            {queue.map((e) => (
              <EpisodeCard key={e.id} ep={e} onChange={refresh}
                queueControls={{ onUp: () => reorder(e.id, 'up'), onDown: () => reorder(e.id, 'down') }} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">New from your subscriptions</h3>
        {newEps.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No new episodes. Subscribe to shows in the Browse tab.</p>
        ) : (
          <ul className="space-y-2">{newEps.slice(0, 10).map((e) => <EpisodeCard key={e.id} ep={e} onChange={refresh} />)}</ul>
        )}
      </section>
    </div>
  );
}
