'use client';

/**
 * EnergyMonitorSection — Sense 2026-shape home energy monitor.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Zap, Activity, Plug, Sun, Receipt, Loader2, Radio, PieChart, Clock, BellRing } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { EnergyUsagePanel } from './EnergyUsagePanel';
import { EnergyDevicesPanel } from './EnergyDevicesPanel';
import { EnergySolarPanel } from './EnergySolarPanel';
import { EnergyBillingPanel } from './EnergyBillingPanel';
import { EnergyLivePanel } from './EnergyLivePanel';
import { EnergyDisaggregationPanel } from './EnergyDisaggregationPanel';
import { EnergyTouPanel } from './EnergyTouPanel';
import { EnergyInsightsPanel } from './EnergyInsightsPanel';

interface Dash {
  devices: number; monthKwh: number; monthCost: number; solarKwh: number;
  solarOffsetPct: number; ratePerKwh: number; goals: number;
}
type TabId = 'live' | 'usage' | 'devices' | 'perdevice' | 'solar' | 'tou' | 'billing' | 'insights';
const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: 'live', label: 'Live', icon: Radio },
  { id: 'usage', label: 'Usage', icon: Activity },
  { id: 'devices', label: 'Devices', icon: Plug },
  { id: 'perdevice', label: 'Per-device', icon: PieChart },
  { id: 'solar', label: 'Solar', icon: Sun },
  { id: 'tou', label: 'Time-of-use', icon: Clock },
  { id: 'billing', label: 'Billing', icon: Receipt },
  { id: 'insights', label: 'Insights', icon: BellRing },
];

export function EnergyMonitorSection() {
  const [tab, setTab] = useState<TabId>('live');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('energy', 'energy-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-lime-600/15 to-transparent">
        <Zap className="w-5 h-5 text-lime-400" />
        <h2 className="text-sm font-bold text-zinc-100">Energy Monitor</h2>
        <span className="text-[11px] text-zinc-500">Sense shape — usage, devices, solar</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Devices" value={dash.devices} />
          <Stat label="Month kWh" value={dash.monthKwh} />
          <Stat label="Month cost" value={`$${dash.monthCost}`} />
          <Stat label="Solar kWh" value={dash.solarKwh} />
          <Stat label="Solar offset" value={`${dash.solarOffsetPct}%`} />
          <Stat label="Rate/kWh" value={`$${dash.ratePerKwh}`} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-lime-500',
                active ? 'bg-zinc-900 text-lime-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'live' && <EnergyLivePanel onChange={refreshDash} />}
        {tab === 'usage' && <EnergyUsagePanel onChange={refreshDash} />}
        {tab === 'devices' && <EnergyDevicesPanel onChange={refreshDash} />}
        {tab === 'perdevice' && <EnergyDisaggregationPanel onChange={refreshDash} />}
        {tab === 'solar' && <EnergySolarPanel onChange={refreshDash} />}
        {tab === 'tou' && <EnergyTouPanel onChange={refreshDash} />}
        {tab === 'billing' && <EnergyBillingPanel onChange={refreshDash} />}
        {tab === 'insights' && <EnergyInsightsPanel onChange={refreshDash} />}
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
