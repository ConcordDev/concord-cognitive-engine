'use client';

/**
 * ResearchLibrarySection — Zotero 2026-shape reference manager.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Library, BookMarked, FolderOpen, Quote, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ResearchLibraryPanel } from './ResearchLibraryPanel';
import { ResearchCollectionsPanel } from './ResearchCollectionsPanel';
import { ResearchBibliographyPanel } from './ResearchBibliographyPanel';

interface Dash {
  references: number; collections: number; annotations: number; tags: number;
  byStatus: { to_read: number; reading: number; read: number };
}
type TabId = 'library' | 'collections' | 'bibliography';
const TABS: { id: TabId; label: string; icon: typeof BookMarked }[] = [
  { id: 'library', label: 'Library', icon: BookMarked },
  { id: 'collections', label: 'Collections', icon: FolderOpen },
  { id: 'bibliography', label: 'Reading & Cite', icon: Quote },
];

export function ResearchLibrarySection() {
  const [tab, setTab] = useState<TabId>('library');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('research', 'library-stats', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-red-600/15 to-transparent">
        <Library className="w-5 h-5 text-red-400" />
        <h2 className="text-sm font-bold text-zinc-100">Reference Library</h2>
        <span className="text-[11px] text-zinc-400">Zotero shape — references, collections, citations</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="References" value={dash.references} />
          <Stat label="Collections" value={dash.collections} />
          <Stat label="To read" value={dash.byStatus?.to_read ?? 0} />
          <Stat label="Reading" value={dash.byStatus?.reading ?? 0} />
          <Stat label="Read" value={dash.byStatus?.read ?? 0} />
          <Stat label="Annotations" value={dash.annotations} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-red-500',
                active ? 'bg-zinc-900 text-red-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'library' && <ResearchLibraryPanel onChange={refreshDash} />}
        {tab === 'collections' && <ResearchCollectionsPanel onChange={refreshDash} />}
        {tab === 'bibliography' && <ResearchBibliographyPanel onChange={refreshDash} />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
