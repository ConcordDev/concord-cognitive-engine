'use client';

/**
 * PharmacyRxSection — GoodRx + MyTherapy 2026-shape workbench.
 * Medication management, dose adherence, refills, pharmacy price
 * comparison and health logging. Tab chrome owns nav state; panels
 * hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Pill, CalendarClock, DollarSign, HeartPulse, Loader2, Bell, Search, Flame } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { RxMedicationsPanel } from './RxMedicationsPanel';
import { RxRefillsPanel } from './RxRefillsPanel';
import { RxPricePanel } from './RxPricePanel';
import { RxHealthLogPanel } from './RxHealthLogPanel';
import { RxRemindersPanel } from './RxRemindersPanel';
import { RxPriceLookupPanel } from './RxPriceLookupPanel';
import { RxAdherencePanel } from './RxAdherencePanel';

interface Dash {
  medications: number;
  todayDoses: { total: number; taken: number; pending: number };
  adherence30d: number | null;
  refillsDue: number;
  openRefillRequests: number;
}
type TabId = 'meds' | 'reminders' | 'refills' | 'prices' | 'lookup' | 'adherence' | 'health';
const TABS: { id: TabId; label: string; icon: typeof Pill }[] = [
  { id: 'meds', label: 'Meds & Doses', icon: Pill },
  { id: 'reminders', label: 'Reminders', icon: Bell },
  { id: 'refills', label: 'Refills', icon: CalendarClock },
  { id: 'prices', label: 'Price Compare', icon: DollarSign },
  { id: 'lookup', label: 'Price & Pill Lookup', icon: Search },
  { id: 'adherence', label: 'Adherence', icon: Flame },
  { id: 'health', label: 'Health Log', icon: HeartPulse },
];

export function PharmacyRxSection() {
  const [tab, setTab] = useState<TabId>('meds');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('pharmacy', 'pharmacy-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-amber-500/15 to-transparent">
        <Pill className="w-5 h-5 text-amber-400" />
        <h2 className="text-sm font-bold text-zinc-100">Prescription Manager</h2>
        <span className="text-[11px] text-zinc-400">GoodRx + MyTherapy shape — not medical advice</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Meds" value={dash.medications} />
          <Stat label="Doses today" value={`${dash.todayDoses.taken}/${dash.todayDoses.total}`}
            alert={dash.todayDoses.pending > 0} />
          <Stat label="Adherence 30d" value={dash.adherence30d != null ? `${dash.adherence30d}%` : '—'}
            alert={dash.adherence30d != null && dash.adherence30d < 80} />
          <Stat label="Refills due" value={dash.refillsDue} alert={dash.refillsDue > 0} />
          <Stat label="Open requests" value={dash.openRefillRequests} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-amber-500',
                active ? 'bg-zinc-900 text-amber-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'meds' && <RxMedicationsPanel onChange={refreshDash} />}
        {tab === 'reminders' && <RxRemindersPanel onChange={refreshDash} />}
        {tab === 'refills' && <RxRefillsPanel onChange={refreshDash} />}
        {tab === 'prices' && <RxPricePanel />}
        {tab === 'lookup' && <RxPriceLookupPanel />}
        {tab === 'adherence' && <RxAdherencePanel />}
        {tab === 'health' && <RxHealthLogPanel />}
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-lg font-bold', alert ? 'text-rose-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
