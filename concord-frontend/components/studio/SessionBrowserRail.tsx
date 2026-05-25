'use client';

// SessionBrowserRail — left rail of the Session workspace. The
// canonical Ableton / BandLab / Logic / Loopcloud pattern: a
// permanent sidebar with filterable sample / loop / DTU browsing,
// where each result is draggable into a clip slot.
//
// Data sources (best-effort — gracefully degrades if any are absent):
//   - runMacro("music", "browse") → community loops + stems
//   - runMacro("dtu", "listByKind", { kind: ["music_dtu","loop","stem"] })
//   - runMacro("dtu", "listByKind", { kind: "forge_app" }) → user
//     forge-generated audio apps
//
// Each result exposes an HTML5 drag handle (dataTransfer carries
// `application/x-concord-asset` = JSON of { assetId, kind, title }).
// SessionView's drop handler reads that payload into a new clip.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';
import { Search, Music2, Disc, Wand2, Loader2, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

type BrowserTab = 'loops' | 'stems' | 'dtu' | 'forge';

interface BrowserAsset {
  id: string;
  title: string;
  source: BrowserTab;
  kind?: string;
  bpm?: number | null;
  key?: string | null;
  durationBeats?: number | null;
  color?: string;
}

interface SessionBrowserRailProps {
  className?: string;
}

const TAB_META: Record<BrowserTab, { label: string; icon: typeof Music2; accent: string }> = {
  loops:  { label: 'Loops',  icon: Music2, accent: 'text-cyan-300' },
  stems:  { label: 'Stems',  icon: Disc,   accent: 'text-amber-300' },
  dtu:    { label: 'DTUs',   icon: Music2, accent: 'text-violet-300' },
  forge:  { label: 'Forge',  icon: Wand2,  accent: 'text-pink-300' },
};

async function fetchBrowserAssets(tab: BrowserTab): Promise<BrowserAsset[]> {
  // music.browse for loops/stems, dtu.listByKind for the rest
  if (tab === 'loops' || tab === 'stems') {
    const res = await lensRun({
      domain: 'music', name: 'browse',
      input: { kind: tab, limit: 50 },
    }).catch(() => null);
    const items = ((res?.data?.result as Record<string, unknown>)?.items
                || (res?.data?.result as Record<string, unknown>)?.loops
                || (res?.data?.result as Record<string, unknown>)?.stems
                || []) as Array<Record<string, unknown>>;
    return items.map(i => ({
      id: String(i.id || i.title || ''),
      title: String(i.title || i.name || '(untitled)'),
      source: tab,
      kind: tab,
      bpm: Number(i.bpm) || null,
      key: (i.key as string) || null,
      durationBeats: Number(i.durationBeats) || null,
      color: (i.color as string) || undefined,
    })).filter(a => a.id);
  }
  if (tab === 'dtu' || tab === 'forge') {
    const kinds = tab === 'dtu' ? ['music_dtu', 'audio_dtu'] : ['forge_app'];
    const res = await lensRun({
      domain: 'dtu', name: 'listByKind',
      input: { kind: kinds, limit: 50 },
    }).catch(() => null);
    const items = ((res?.data?.result as Record<string, unknown>)?.items
                || (res?.data?.result as Record<string, unknown>)?.dtus
                || []) as Array<Record<string, unknown>>;
    return items
      .filter(i => /audio|music|loop|stem|sample|drum|beat|melody|chord/i.test(String(i.title || i.kind || '')))
      .map(i => ({
        id: String(i.id || ''),
        title: String(i.title || '(untitled)'),
        source: tab,
        kind: String(i.kind || tab),
      }))
      .filter(a => a.id);
  }
  return [];
}

export default function SessionBrowserRail({ className }: SessionBrowserRailProps) {
  const [tab, setTab] = useState<BrowserTab>('loops');
  const [search, setSearch] = useState('');

  const { data: assets, isLoading } = useQuery({
    queryKey: ['studio-browser', tab],
    queryFn: () => fetchBrowserAssets(tab),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const list = assets || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(a => a.title.toLowerCase().includes(q));
  }, [assets, search]);

  return (
    <aside className={cn('flex flex-col bg-zinc-900/60 border-r border-white/10 overflow-hidden', className)}>
      {/* Header + search */}
      <div className="px-3 py-2 border-b border-white/10">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1.5">Browser</div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:border-white/30"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        {(Object.keys(TAB_META) as BrowserTab[]).map(t => {
          const m = TAB_META[t];
          const Icon = m.icon;
          const isActive = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 px-1.5 py-2 text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 border-b-2 transition-colors',
                isActive ? `${m.accent} border-current bg-white/[0.03]` : 'text-zinc-400 border-transparent hover:bg-white/[0.02]'
              )}
            >
              <Icon className="w-3 h-3" />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center text-zinc-400 text-xs flex items-center justify-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-zinc-400 text-xs">
            {search ? 'No matches' : `No ${TAB_META[tab].label.toLowerCase()} yet`}
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {filtered.map(asset => (
              <li
                key={asset.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData(
                    'application/x-concord-asset',
                    JSON.stringify({ assetId: asset.id, kind: asset.kind, title: asset.title })
                  );
                }}
                className="px-3 py-2 hover:bg-white/[0.03] cursor-grab active:cursor-grabbing flex items-center gap-2 group"
              >
                <GripVertical className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-zinc-200 truncate">{asset.title}</div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    {asset.kind}
                    {asset.bpm ? ` · ${asset.bpm} BPM` : ''}
                    {asset.key ? ` · ${asset.key}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-white/10">
        Drag onto a grid cell to bind
      </div>
    </aside>
  );
}
