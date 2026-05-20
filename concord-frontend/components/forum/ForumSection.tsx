'use client';

/**
 * ForumSection — Discourse + Reddit shape community forum. Tabbed
 * panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { MessagesSquare, MessageCircle, FolderTree, ShieldAlert, Award, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { FmTopicsPanel } from './FmTopicsPanel';
import { FmCategoriesPanel } from './FmCategoriesPanel';
import { FmModerationPanel } from './FmModerationPanel';
import { FmProfilePanel } from './FmProfilePanel';

interface Dash {
  categories: number; topics: number; replies: number; topicsThisWeek: number; pendingFlags: number;
}
type TabId = 'topics' | 'categories' | 'moderation' | 'profile';
const TABS: { id: TabId; label: string; icon: typeof MessageCircle }[] = [
  { id: 'topics', label: 'Topics', icon: MessageCircle },
  { id: 'categories', label: 'Categories', icon: FolderTree },
  { id: 'moderation', label: 'Moderation', icon: ShieldAlert },
  { id: 'profile', label: 'Profile', icon: Award },
];

export function ForumSection() {
  const [tab, setTab] = useState<TabId>('topics');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const r = await lensRun('forum', 'forum-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-orange-600/15 to-transparent">
        <MessagesSquare className="w-5 h-5 text-orange-400" />
        <h2 className="text-sm font-bold text-zinc-100">Community Forum</h2>
        <span className="text-[11px] text-zinc-500">Discourse + Reddit shape</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-4 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Categories" value={dash.categories} />
          <Stat label="Topics" value={dash.topics} />
          <Stat label="Replies" value={dash.replies} />
          <Stat label="Flags" value={dash.pendingFlags} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-orange-500',
                active ? 'bg-zinc-900 text-orange-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'topics' && <FmTopicsPanel onChange={refresh} />}
        {tab === 'categories' && <FmCategoriesPanel onChange={refresh} />}
        {tab === 'moderation' && <FmModerationPanel onChange={refresh} />}
        {tab === 'profile' && <FmProfilePanel />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
