'use client';

/**
 * PhotographyLightroomSection — Adobe Lightroom 2026-shape catalog
 * workbench. Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Camera, Image, SlidersHorizontal, FolderOpen, Download, Loader2, Aperture } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { LightroomLibraryPanel } from './LightroomLibraryPanel';
import { LightroomDevelopPanel } from './LightroomDevelopPanel';
import { LightroomCollectionsPanel } from './LightroomCollectionsPanel';
import { LightroomExportPanel } from './LightroomExportPanel';
import { LightroomDarkroomPanel } from './LightroomDarkroomPanel';

interface Stats {
  photos: number; albums: number; shoots: number; presets: number;
  picks: number; edited: number;
}
type TabId = 'library' | 'develop' | 'darkroom' | 'collections' | 'export';
const TABS: { id: TabId; label: string; icon: typeof Image }[] = [
  { id: 'library', label: 'Library', icon: Image },
  { id: 'develop', label: 'Develop', icon: SlidersHorizontal },
  { id: 'darkroom', label: 'Darkroom', icon: Aperture },
  { id: 'collections', label: 'Albums & Shoots', icon: FolderOpen },
  { id: 'export', label: 'Export', icon: Download },
];

export function PhotographyLightroomSection() {
  const [tab, setTab] = useState<TabId>('library');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshStats = useCallback(async () => {
    const r = await lensRun('photography', 'catalog-stats', {});
    setStats((r.data?.result as Stats | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshStats(); }, [refreshStats]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-indigo-600/15 to-transparent">
        <Camera className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-bold text-zinc-100">Photo Catalog</h2>
        <span className="text-[11px] text-zinc-500">Lightroom shape — library, develop, export</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : stats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Photos" value={stats.photos} />
          <Stat label="Picks" value={stats.picks} />
          <Stat label="Edited" value={stats.edited} />
          <Stat label="Albums" value={stats.albums} />
          <Stat label="Shoots" value={stats.shoots} />
          <Stat label="Presets" value={stats.presets} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-indigo-500',
                active ? 'bg-zinc-900 text-indigo-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'library' && <LightroomLibraryPanel onChange={refreshStats} />}
        {tab === 'develop' && <LightroomDevelopPanel onChange={refreshStats} />}
        {tab === 'darkroom' && <LightroomDarkroomPanel onChange={refreshStats} />}
        {tab === 'collections' && <LightroomCollectionsPanel onChange={refreshStats} />}
        {tab === 'export' && <LightroomExportPanel />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
