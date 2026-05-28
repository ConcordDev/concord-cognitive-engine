'use client';

// Phase BB1 — Festival Banner.
//
// Top-center banner mounted in /lenses/world. Polls
// /api/festivals/active?worldId=:id every 60s and shows the most
// recently started active festival as a thin strip with the
// decoration tag color theme.

import { useEffect, useState, useCallback } from 'react';
import { Sparkles } from 'lucide-react';

interface ActiveFestival {
  festival_id: string;
  world_id: string;
  year_idx: number;
  started_at: number;
  ends_at: number;
  name: string;
  decoration_tag: string | null;
}

interface FestivalBannerProps {
  worldId: string;
}

const TAG_COLORS: Record<string, { from: string; to: string; text: string }> = {
  blue_snow:       { from: 'from-sky-500/20',   to: 'to-blue-500/10',     text: 'text-sky-200' },
  harvest_lanterns:{ from: 'from-amber-500/20', to: 'to-orange-500/10',   text: 'text-amber-200' },
  paper_flowers:   { from: 'from-pink-500/20',  to: 'to-rose-500/10',     text: 'text-pink-200' },
  gold_banners:    { from: 'from-yellow-500/20',to: 'to-amber-500/10',    text: 'text-yellow-200' },
};

function timeUntilEnd(ts: number): string {
  const delta = Math.max(0, ts - Math.floor(Date.now() / 1000));
  if (delta < 3600) return `${Math.floor(delta / 60)}m left`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h left`;
  return `${Math.floor(delta / 86400)}d left`;
}

export function FestivalBanner({ worldId }: FestivalBannerProps) {
  const [active, setActive] = useState<ActiveFestival[]>([]);

  const refresh = useCallback(() => {
    if (!worldId) return;
    fetch(`/api/festivals/active?worldId=${encodeURIComponent(worldId)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.ok) setActive(d.festivals || []); })
      .catch(() => {});
  }, [worldId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    const onStart = () => refresh();
    if (typeof window !== 'undefined') window.addEventListener('festival:started', onStart);
    return () => {
      clearInterval(t);
      if (typeof window !== 'undefined') window.removeEventListener('festival:started', onStart);
    };
  }, [refresh]);

  if (active.length === 0) return null;
  const f = active[0];
  const theme = TAG_COLORS[f.decoration_tag || ''] || { from: 'from-emerald-500/20', to: 'to-teal-500/10', text: 'text-emerald-200' };

  return (
    <div className={`pointer-events-auto fixed top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/10 bg-gradient-to-r ${theme.from} ${theme.to} px-4 py-1.5 shadow-lg backdrop-blur`}>
      <div className={`flex items-center gap-2 text-xs ${theme.text}`}>
        <Sparkles size={12} />
        <span className="font-medium">{f.name}</span>
        <span className="text-[10px] opacity-70">· {timeUntilEnd(f.ends_at)}</span>
      </div>
    </div>
  );
}
