'use client';

/**
 * FashionClosetSection — Stylebook 2026-shape digital-closet workbench.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Shirt, Grid3x3, Layers, CalendarDays, Luggage, Loader2, Wand2, Sparkles, Users, Recycle, Package } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { FashionClosetPanel } from './FashionClosetPanel';
import { FashionOutfitsPanel } from './FashionOutfitsPanel';
import { FashionCalendarPanel } from './FashionCalendarPanel';
import { FashionPlanPanel } from './FashionPlanPanel';
import { FashionAIStylistPanel } from './FashionAIStylistPanel';
import { FashionStyleQuizPanel } from './FashionStyleQuizPanel';
import { FashionSocialPanel } from './FashionSocialPanel';
import { FashionResalePanel } from './FashionResalePanel';
import { FashionCapsulePanel } from './FashionCapsulePanel';

interface Dash {
  items: number; outfits: number; lookbooks: number; packingLists: number;
  wornThisMonth: number; closetValue: number; neverWorn: number;
}
type TabId = 'closet' | 'outfits' | 'calendar' | 'plan' | 'ai' | 'style' | 'social' | 'resale' | 'capsule';
const TABS: { id: TabId; label: string; icon: typeof Grid3x3 }[] = [
  { id: 'closet', label: 'Closet', icon: Grid3x3 },
  { id: 'outfits', label: 'Outfits', icon: Layers },
  { id: 'ai', label: 'AI Stylist', icon: Wand2 },
  { id: 'style', label: 'Style Quiz', icon: Sparkles },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'plan', label: 'Plan', icon: Luggage },
  { id: 'capsule', label: 'Capsule', icon: Package },
  { id: 'social', label: 'Community', icon: Users },
  { id: 'resale', label: 'Resale', icon: Recycle },
];

export function FashionClosetSection() {
  const [tab, setTab] = useState<TabId>('closet');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('fashion', 'fashion-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-fuchsia-600/15 to-transparent">
        <Shirt className="w-5 h-5 text-fuchsia-400" />
        <h2 className="text-sm font-bold text-zinc-100">Digital Closet</h2>
        <span className="text-[11px] text-zinc-400">Stylebook shape — wardrobe, outfits, wear tracking</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Items" value={dash.items} />
          <Stat label="Outfits" value={dash.outfits} />
          <Stat label="Worn this mo." value={dash.wornThisMonth} />
          <Stat label="Lookbooks" value={dash.lookbooks} />
          <Stat label="Never worn" value={dash.neverWorn} alert={dash.neverWorn > 0} />
          <Stat label="Closet value" value={`$${dash.closetValue}`} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-fuchsia-500',
                active ? 'bg-zinc-900 text-fuchsia-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'closet' && <FashionClosetPanel onChange={refreshDash} />}
        {tab === 'outfits' && <FashionOutfitsPanel onChange={refreshDash} />}
        {tab === 'ai' && <FashionAIStylistPanel onChange={refreshDash} />}
        {tab === 'style' && <FashionStyleQuizPanel />}
        {tab === 'calendar' && <FashionCalendarPanel onChange={refreshDash} />}
        {tab === 'plan' && <FashionPlanPanel />}
        {tab === 'capsule' && <FashionCapsulePanel />}
        {tab === 'social' && <FashionSocialPanel />}
        {tab === 'resale' && <FashionResalePanel onChange={refreshDash} />}
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-base font-bold', alert ? 'text-amber-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
