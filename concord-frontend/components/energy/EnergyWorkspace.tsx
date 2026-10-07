'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity, BarChart3, BellRing, Bolt, Gauge, Grid3X3, Loader2,
  Plug, Receipt, Share2, Sun, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensStatePersistence } from '@/lib/lens-state-persistence';
import { cn } from '@/lib/utils';
import { EiaPanel } from './EiaPanel';
import { EnergyActionStack } from './EnergyActionStack';
import { EnergyBillingPanel } from './EnergyBillingPanel';
import { EnergyCheapestWindowPanel } from './EnergyCheapestWindowPanel';
import { EnergyDevicesPanel, type EnergyDevice } from './EnergyDevicesPanel';
import { EnergyDisaggregationPanel } from './EnergyDisaggregationPanel';
import { EnergyGridCalcPanel } from './EnergyGridCalcPanel';
import { EnergyInsightsPanel } from './EnergyInsightsPanel';
import { EnergyLivePanel } from './EnergyLivePanel';
import { EnergySolarPanel } from './EnergySolarPanel';
import { EnergyTouPanel } from './EnergyTouPanel';
import { EnergyUsagePanel } from './EnergyUsagePanel';
import { SolarCarbonPanel } from './SolarCarbonPanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

type EnergyView = 'now' | 'usage' | 'devices' | 'solar' | 'billing' | 'insights' | 'rates' | 'grid' | 'share';

interface Dashboard {
  devices: number;
  monthKwh: number;
  monthCost: number;
  solarKwh: number;
  solarOffsetPct: number;
  ratePerKwh: number;
}

const VIEWS: { id: EnergyView; label: string; icon: typeof Gauge; key: string }[] = [
  { id: 'now', label: 'Now', icon: Gauge, key: '1' },
  { id: 'usage', label: 'Usage', icon: Activity, key: '2' },
  { id: 'devices', label: 'Devices', icon: Plug, key: '3' },
  { id: 'solar', label: 'Solar', icon: Sun, key: '4' },
  { id: 'billing', label: 'Billing', icon: Receipt, key: '5' },
  { id: 'insights', label: 'Insights', icon: BellRing, key: '6' },
  { id: 'rates', label: 'Rates', icon: BarChart3, key: '7' },
  { id: 'grid', label: 'Grid', icon: Grid3X3, key: '8' },
  { id: 'share', label: 'Share', icon: Share2, key: '9' },
];
const VIEW_IDS = new Set(VIEWS.map((view) => view.id));
const card = 'rounded-2xl border border-white/10 bg-[#111] p-4';

function isEnergyView(value: unknown): value is EnergyView {
  return typeof value === 'string' && VIEW_IDS.has(value as EnergyView);
}

export function EnergyWorkspace({ who }: { who: string }) {
  useLensIdentity('energy');
  const { restore, persist } = useLensStatePersistence('energy');
  const [initialState] = useState(() => restore());
  const [view, setView] = useState<EnergyView>(() => isEnergyView(initialState?.view) ? initialState.view : 'now');
  const [devices, setDevices] = useState<EnergyDevice[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedMeterId, setSelectedMeterId] = useState(
    () => typeof initialState?.selectedMeterId === 'string' ? initialState.selectedMeterId : '',
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [deviceResponse, dashboardResponse] = await Promise.all([
        lensRun('energy', 'device-list', {}),
        lensRun('energy', 'energy-dashboard', {}),
      ]);
      if (deviceResponse.data?.ok === false) {
        setLoadError(deviceResponse.data.error || 'Failed to load meters.');
        return;
      }
      setDevices(deviceResponse.data?.result?.devices || []);
      setDashboard(dashboardResponse.data?.ok ? dashboardResponse.data.result as Dashboard : null);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load meters.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => { void refresh(); });
    return () => cancelAnimationFrame(frame);
  }, [refresh]);
  const refreshSummary = useCallback(() => refresh(false), [refresh]);
  const refreshAll = useCallback(() => refresh(), [refresh]);

  const meters = useMemo(() => devices.filter((device) => device.category === 'meter'), [devices]);
  const selectedMeter = meters.find((meter) => meter.id === selectedMeterId) || null;

  const selectView = useCallback((next: EnergyView) => {
    setView(next);
    persist({ view: next, selectedMeterId });
  }, [persist, selectedMeterId]);

  const selectMeter = useCallback((meterId: string) => {
    setSelectedMeterId(meterId);
    setPickerOpen(false);
    setView('now');
    persist({ view: 'now', selectedMeterId: meterId });
  }, [persist]);

  useLensCommand(
    VIEWS.map((item) => ({
      id: `energy-${item.id}`,
      keys: item.key,
      description: `Open Energy ${item.label}`,
      category: 'navigation' as const,
      action: () => selectView(item.id),
    })),
    { lensId: 'energy' },
  );

  return (
    <div data-lens-theme="energy" className="relative min-h-full bg-[#080808] px-4 pb-28 pt-6 sm:px-8">
      <header>
        <p className="text-sm text-zinc-600">Energy</p>
        <h1 className="font-vault mt-1 text-4xl leading-tight text-zinc-100 sm:text-5xl">
          The load{who ? `, ${who}` : ''}
        </h1>
        {selectedMeter && (
          <p className="mt-2 text-sm text-zinc-500">
            <span className="text-zinc-300">{selectedMeter.name}</span> is the active meter.
          </p>
        )}
      </header>

      {loading ? (
        <div role="status" aria-live="polite" className="flex min-h-[58vh] items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading meters...
        </div>
      ) : loadError ? (
        <div role="alert" className="flex min-h-[58vh] flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm text-rose-300">{loadError}</p>
          <button type="button" onClick={() => void refresh()} className="rounded-full border border-rose-400/30 px-4 py-2 text-sm text-rose-200">
            Retry
          </button>
        </div>
      ) : !selectedMeter ? (
        <MeterEmptyState onChoose={() => setPickerOpen(true)} />
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[9rem_minmax(0,1fr)]">
          <nav aria-label="Energy workspace" className="flex gap-1 overflow-x-auto border-b border-white/10 pb-2 lg:flex-col lg:border-b-0 lg:border-r lg:pb-0 lg:pr-4">
            {VIEWS.map((item) => {
              const Icon = item.icon;
              const active = item.id === view;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectView(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                    active ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  <kbd aria-hidden="true" className="ml-auto hidden font-mono text-[10px] text-white/25 lg:inline">{item.key}</kbd>
                </button>
              );
            })}
          </nav>

          <motion.main
            key={view}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="min-w-0"
          >
            {view === 'now' && (
              <div className="space-y-4">
                {dashboard && <DashboardStrip dashboard={dashboard} />}
                <section className={card}>
                  <EnergyLivePanel
                    meterId={selectedMeter.id}
                    meterName={selectedMeter.name}
                    onChange={refreshSummary}
                  />
                </section>
              </div>
            )}
            {view === 'usage' && (
              <section className={card}><EnergyUsagePanel onChange={refreshSummary} /></section>
            )}
            {view === 'devices' && (
              <section className={card}>
                <EnergyDevicesPanel
                  devices={devices}
                  loading={loading}
                  loadError={loadError}
                  refresh={refreshAll}
                />
              </section>
            )}
            {view === 'solar' && (
              <div className="space-y-4">
                <section className={card}><EnergySolarPanel onChange={refreshSummary} /></section>
                <section className={card}><SolarCarbonPanel /></section>
              </div>
            )}
            {view === 'billing' && (
              <div className="space-y-4">
                <section className={card}><EnergyBillingPanel onChange={refreshSummary} /></section>
                <section className={card}><EnergyTouPanel onChange={refreshSummary} /></section>
                <section className={card}><EnergyCheapestWindowPanel /></section>
              </div>
            )}
            {view === 'insights' && (
              <div className="space-y-4">
                <section className={card}><EnergyDisaggregationPanel onChange={refreshSummary} /></section>
                <section className={card}><EnergyInsightsPanel onChange={refreshSummary} /></section>
              </div>
            )}
            {view === 'rates' && <section className={card}><EiaPanel /></section>}
            {view === 'grid' && (
              <div className="space-y-4">
                <section className={card}><EnergyGridCalcPanel /></section>
                <LensFeedPanel lensId="energy" />
              </div>
            )}
            {view === 'share' && <EnergyActionStack />}
          </motion.main>
        </div>
      )}

      {!loading && !loadError && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Gauge className="h-4 w-4" />
          {selectedMeter ? 'Change meter' : 'Choose a meter'}
        </button>
      )}

      <AnimatePresence>
        {pickerOpen && (
          <MeterPicker
            meters={meters}
            selectedMeterId={selectedMeterId}
            onClose={() => setPickerOpen(false)}
            onSelect={selectMeter}
            onCreated={async (meterId) => {
              await refresh();
              selectMeter(meterId);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MeterEmptyState({ onChoose }: { onChoose: () => void }) {
  return (
    <section className="flex min-h-[58vh] flex-col items-center justify-center text-center">
      <div className="relative flex h-52 w-52 items-center justify-center rounded-full border border-white/10 sm:h-64 sm:w-64">
        <div className="absolute inset-5 rounded-full border border-dashed border-white/10" />
        <Bolt className="h-9 w-9 text-white/15" />
      </div>
      <h2 className="mt-8 font-vault text-3xl text-zinc-100">No meter selected</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
        Select a real meter to see submitted wattage, history, devices, rates, solar and billing.
      </p>
      <button type="button" onClick={onChoose} className="mt-7 rounded-full bg-teal-400 px-6 py-3 text-sm font-medium text-black hover:bg-teal-300">
        Choose a meter
      </button>
    </section>
  );
}

function MeterPicker({
  meters,
  selectedMeterId,
  onClose,
  onSelect,
  onCreated,
}: {
  meters: EnergyDevice[];
  selectedMeterId: string;
  onClose: () => void;
  onSelect: (meterId: string) => void;
  onCreated: (meterId: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createMeter = async () => {
    if (!name.trim()) { setError('Meter name is required.'); return; }
    setSaving(true);
    try {
      const response = await lensRun('energy', 'device-add', { name: name.trim(), category: 'meter', wattage: 0 });
      if (response.data?.ok === false || !response.data?.result?.device?.id) {
        setError(response.data?.error || 'Failed to add meter.');
        return;
      }
      await onCreated(response.data.result.device.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to add meter.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="meter-picker-title"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 18 }}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#111] p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-teal-300/70">Meter source</p>
            <h2 id="meter-picker-title" className="mt-1 font-vault text-3xl text-zinc-100">Choose a meter</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close meter picker" className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-2">
          {meters.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-zinc-500">
              No meters are connected yet. Add the meter you submit readings from.
            </p>
          ) : meters.map((meter) => (
            <button
              key={meter.id}
              type="button"
              onClick={() => onSelect(meter.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                selectedMeterId === meter.id ? 'border-teal-400/50 bg-teal-400/10' : 'border-white/10 hover:bg-white/5',
              )}
            >
              <Gauge className="h-4 w-4 text-teal-300" />
              <span className="font-medium text-zinc-100">{meter.name}</span>
              {selectedMeterId === meter.id && <span className="ml-auto text-xs text-teal-300">Selected</span>}
            </button>
          ))}
        </div>

        <div className="mt-5 border-t border-white/10 pt-5">
          <label htmlFor="new-meter-name" className="text-xs font-medium text-zinc-400">Add a meter</label>
          <div className="mt-2 flex gap-2">
            <input
              id="new-meter-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Main panel meter"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black px-3 py-2 text-sm text-zinc-100 outline-none focus:border-teal-400/60"
            />
            <button type="button" onClick={() => void createMeter()} disabled={saving} className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-50">
              {saving ? 'Adding...' : 'Add'}
            </button>
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}
        </div>
      </motion.section>
    </motion.div>
  );
}

function DashboardStrip({ dashboard }: { dashboard: Dashboard }) {
  const stats = [
    ['Month', `${dashboard.monthKwh} kWh`],
    ['Cost', `$${dashboard.monthCost}`],
    ['Solar', `${dashboard.solarKwh} kWh`],
    ['Offset', `${dashboard.solarOffsetPct}%`],
    ['Rate', `$${dashboard.ratePerKwh}/kWh`],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-5">
      {stats.map(([label, value]) => (
        <div key={label} className="bg-[#101010] px-4 py-3">
          <p className="font-mono text-base tabular-nums text-zinc-100">{value}</p>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-zinc-600">{label}</p>
        </div>
      ))}
    </div>
  );
}
