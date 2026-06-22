'use client';

/**
 * /lenses/announcements — Phase BB3.
 *
 * Chronological feed of operator-published announcements. Roadmap is
 * just kind='roadmap' rows. Banner top-strip lives in AppShell.tsx
 * (the most recent feature_drop or roadmap drop).
 */

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Sparkles, Bell, Wrench, CalendarDays, Map, RefreshCcw } from 'lucide-react';
import type { LucideIcon } from "lucide-react";
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

interface Announcement {
  id: string;
  kind: 'feature_drop' | 'balance_change' | 'event' | 'news' | 'roadmap';
  title: string;
  body_md: string;
  published_at: number;
  expires_at: number | null;
}

const KIND_META: Record<Announcement['kind'], { label: string; icon: LucideIcon; color: string }> = {
  feature_drop:   { label: 'Feature drop',   icon: Sparkles,    color: 'text-emerald-300' },
  balance_change: { label: 'Balance change', icon: Wrench,      color: 'text-amber-300' },
  event:          { label: 'Event',          icon: CalendarDays, color: 'text-sky-300' },
  news:           { label: 'News',           icon: Bell,        color: 'text-slate-300' },
  roadmap:        { label: 'Roadmap',        icon: Map,         color: 'text-violet-300' },
};

function timeAgo(ts: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export default function AnnouncementsLensPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [filter, setFilter] = useState<'all' | Announcement['kind']>('all');

  const refresh = useCallback(() => {
    const q = filter === 'all' ? '' : `?kind=${encodeURIComponent(filter)}`;
    fetch(`/api/announcements${q}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.ok) setItems(d.announcements || []); })
      .catch(() => {});
  }, [filter]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = () => refresh();
    window.addEventListener('concord:announcement', h);
    return () => window.removeEventListener('concord:announcement', h);
  }, [refresh]);

  return (
    <LensShell lensId="announcements" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-violet-950/10 text-slate-100">
        <header className="border-b border-violet-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-2">
              <Megaphone className="h-5 w-5 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Announcements</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">What's shipped, what's coming.</p>
            </div>
            <button onClick={refresh} aria-label="Refresh" className="rounded-full border border-violet-500/30 bg-violet-500/10 p-1.5 text-violet-300 hover:bg-violet-500/20">
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6">
          <div className="mb-3 flex flex-wrap gap-1 text-xs">
            <button onClick={() => setFilter('all')}
              className={`rounded px-2 py-1 ${filter === 'all' ? 'bg-violet-500/30 text-violet-100' : 'text-slate-400 hover:text-slate-200'}`}>
              all
            </button>
            {Object.entries(KIND_META).map(([k, meta]) => (
              <button key={k} onClick={() => setFilter(k as Announcement['kind'])}
                className={`rounded px-2 py-1 ${filter === k ? 'bg-violet-500/30 text-violet-100' : 'text-slate-400 hover:text-slate-200'}`}>
                {meta.label}
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <p className="py-12 text-center text-[12px] text-slate-500">No announcements yet.</p>
          ) : (
            <ol className="space-y-3">
              {items.map((a) => {
                const meta = KIND_META[a.kind];
                const Icon = meta.icon;
                return (
                  <li key={a.id} className="rounded-xl border border-violet-500/20 bg-zinc-950/60 p-3">
                    <header className="mb-2 flex items-center justify-between">
                      <h2 className={`flex items-center gap-2 text-sm font-medium ${meta.color}`}>
                        <Icon size={14} />
                        {a.title}
                      </h2>
                      <span className="text-[10px] text-slate-500">{meta.label} · {timeAgo(a.published_at)}</span>
                    </header>
                    <div className="whitespace-pre-wrap text-[12px] text-slate-200">{a.body_md}</div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </LensShell>
  );
}
