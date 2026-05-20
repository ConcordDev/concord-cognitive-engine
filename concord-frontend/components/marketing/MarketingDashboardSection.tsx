'use client';

/**
 * MarketingDashboardSection — HubSpot + marketing-dashboard 2026-shape
 * workbench. Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Target, UserPlus, CalendarRange, Radio, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { MarketingCampaignsPanel } from './MarketingCampaignsPanel';
import { MarketingLeadsPanel } from './MarketingLeadsPanel';
import { MarketingContentPanel } from './MarketingContentPanel';
import { MarketingChannelsPanel } from './MarketingChannelsPanel';

interface Dash {
  campaigns: number; activeCampaigns: number; totalSpend: number; totalRevenue: number;
  blendedRoas: number; leads: number; qualifiedLeads: number; wonDeals: number;
  scheduledContent: number; abTests: number;
}
type TabId = 'campaigns' | 'leads' | 'content' | 'channels';
const TABS: { id: TabId; label: string; icon: typeof Target }[] = [
  { id: 'campaigns', label: 'Campaigns', icon: Target },
  { id: 'leads', label: 'Leads', icon: UserPlus },
  { id: 'content', label: 'Content & Tests', icon: CalendarRange },
  { id: 'channels', label: 'Channels', icon: Radio },
];

export function MarketingDashboardSection() {
  const [tab, setTab] = useState<TabId>('campaigns');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('marketing', 'marketing-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-orange-600/15 to-transparent">
        <Megaphone className="w-5 h-5 text-orange-400" />
        <h2 className="text-sm font-bold text-zinc-100">Marketing Hub</h2>
        <span className="text-[11px] text-zinc-500">HubSpot shape — campaigns, leads, attribution</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Campaigns" value={dash.activeCampaigns} />
          <Stat label="Spend" value={`$${dash.totalSpend}`} />
          <Stat label="Revenue" value={`$${dash.totalRevenue}`} />
          <Stat label="Blended ROAS" value={`${dash.blendedRoas}×`} accent={dash.blendedRoas >= 3} />
          <Stat label="Leads" value={dash.leads} />
          <Stat label="Won deals" value={dash.wonDeals} />
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
        {tab === 'campaigns' && <MarketingCampaignsPanel onChange={refreshDash} />}
        {tab === 'leads' && <MarketingLeadsPanel onChange={refreshDash} />}
        {tab === 'content' && <MarketingContentPanel onChange={refreshDash} />}
        {tab === 'channels' && <MarketingChannelsPanel />}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-base font-bold', accent ? 'text-emerald-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
