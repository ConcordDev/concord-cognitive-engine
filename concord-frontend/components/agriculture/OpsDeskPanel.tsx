'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Beef,
  CloudRain,
  Layers,
  Sprout,
  Sun,
  TrendingUp,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { type WeatherPayload } from '@/components/lens/WeatherHero';
import { AgFarmShell, type AgEquipment, type AgField, type AgWorkOrder } from './AgFarmShell';
import { useFarmDesk } from './FarmDeskContext';
import type { AgricultureArtifact } from './ag-types';

interface OpsDeskPanelProps {
  onOpenRecords: (kind: 'fields' | 'crops' | 'equipment') => void;
}

function asList<T>(raw: unknown, key: string): T[] {
  if (!raw || typeof raw !== 'object') return [];
  const v = (raw as Record<string, unknown>)[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

export function OpsDeskPanel({ onOpenRecords }: OpsDeskPanelProps) {
  const reduceMotion = useReducedMotion();
  const { handleAction } = useFarmDesk();
  const { latestData: weatherData } = useRealtimeLens('eco');

  const fieldsQ = useLensData<AgricultureArtifact>('agriculture', 'Field', { noSeed: true });
  const cropsQ = useLensData<AgricultureArtifact>('agriculture', 'Crop', { noSeed: true });
  const animalsQ = useLensData<AgricultureArtifact>('agriculture', 'Animal', { noSeed: true });
  const harvestsQ = useLensData<AgricultureArtifact>('agriculture', 'Harvest', { noSeed: true });
  const equipmentArtQ = useLensData<AgricultureArtifact>('agriculture', 'FarmEquipment', {
    noSeed: true,
  });

  const opsQuery = useQuery({
    queryKey: ['agriculture', 'ops-desk'],
    queryFn: async () => {
      const [fields, equipment, orders, bins] = await Promise.all([
        lensRun({ domain: 'agriculture', action: 'field-list', input: {} }),
        lensRun({ domain: 'agriculture', action: 'equipment-list', input: {} }),
        lensRun({ domain: 'agriculture', action: 'work-orders-list', input: {} }),
        lensRun({ domain: 'agriculture', action: 'grain-bins-list', input: {} }),
      ]);
      return {
        fields: asList<AgField>(fields.data?.result, 'fields'),
        equipment: asList<AgEquipment>(equipment.data?.result, 'equipment'),
        workOrders: asList<AgWorkOrder>(orders.data?.result, 'orders'),
        bins: asList<{ currentBushels?: number; capacityBushels?: number }>(
          bins.data?.result,
          'bins',
        ),
      };
    },
    staleTime: 30_000,
  });

  const fieldArts = fieldsQ.items;
  const cropArts = cropsQ.items;
  const harvestArts = harvestsQ.items;
  const animalArts = animalsQ.items;
  const equipArts = equipmentArtQ.items;

  const metrics = useMemo(() => {
    const totalAcres = fieldArts.reduce((s, i) => s + (i.data.acreage || 0), 0);
    const totalHead = animalArts.reduce((s, i) => s + (i.data.headCount || 0), 0);
    const cropsGrowing = cropArts.filter((i) => i.data.status === 'growing').length;
    const harvestReady = [...cropArts, ...harvestArts].filter((i) => i.data.status === 'ready')
      .length;
    const totalRevenue = harvestArts
      .filter((i) => i.data.status === 'sold')
      .reduce((s, i) => s + (i.data.quantity || 0) * (i.data.pricePerUnit || 0), 0);
    const seasonYield = harvestArts.reduce((s, i) => s + (i.data.quantity || 0), 0);
    return { totalAcres, totalHead, cropsGrowing, harvestReady, totalRevenue, seasonYield };
  }, [fieldArts, cropArts, harvestArts, animalArts]);

  const weather = weatherData as WeatherPayload | null;
  const todayPrecip = Number(weather?.daily?.precipitation_sum?.[0] ?? 0);
  const last24Precip = Number(weather?.current?.precipitation ?? 0);
  const workable = (d: AgricultureArtifact) => {
    if (todayPrecip > 12) return false;
    if (last24Precip > 8) return false;
    return Boolean(d);
  };
  const workableCount = fieldArts.filter((f) => workable(f.data)).length;

  const noSoilTest = fieldArts.filter((f) => !f.data.lastTested).length;
  const equipmentDue = equipArts.filter((e) =>
    /service|due|overdue|maintenance/i.test(e.data.notes || '') ||
    /service|due|overdue|maintenance/i.test(String(e.data.status || '')),
  ).length;
  const cropsToTrack = cropArts.filter((c) => c.data.plantDate).length;

  const queueItems = [
    noSoilTest > 0 && {
      label: `${noSoilTest} field${noSoilTest === 1 ? '' : 's'} need soil tested`,
      action: () => {
        onOpenRecords('fields');
        void handleAction('analyze-soil', fieldArts[0]?.id);
      },
      color: 'text-amber-300',
    },
    equipmentDue > 0 && {
      label: `${equipmentDue} equipment item${equipmentDue === 1 ? '' : 's'} due for service`,
      action: () => {
        onOpenRecords('equipment');
        void handleAction('equipmentDue', equipArts[0]?.id);
      },
      color: 'text-rose-300',
    },
    cropsToTrack > 0 && {
      label: `${cropsToTrack} crop cycle${cropsToTrack === 1 ? '' : 's'} mid-season — track status`,
      action: () => {
        onOpenRecords('crops');
        void handleAction('track-season', cropArts[0]?.id);
      },
      color: 'text-emerald-300',
    },
  ].filter(Boolean) as Array<{ label: string; action: () => void; color: string }>;

  const crops = cropArts.map((i) => ({ title: i.title, ...i.data }));
  const thriving = crops.filter((c) => !c.pestPressure || c.pestPressure === 'low').length;
  const stressed = crops.filter((c) => c.pestPressure === 'medium').length;
  const critical = crops.filter((c) => c.pestPressure === 'high').length;
  const totalQty = harvestArts.reduce((s, h) => s + (h.data.quantity || 0), 0);
  const totalEstimated = crops.reduce((s, c) => s + (c.estimatedYield || 0), 0);
  const harvestPct = totalEstimated > 0 ? Math.min((totalQty / totalEstimated) * 100, 100) : 0;

  const shellFields = opsQuery.data?.fields ?? [];
  const shellEquip = (opsQuery.data?.equipment ?? []).map((e) => ({
    ...e,
    status: (['idle', 'working', 'transporting', 'maintenance', 'offline'] as const).includes(
      e.status as AgEquipment['status'],
    )
      ? (e.status as AgEquipment['status'])
      : 'idle',
  }));
  const shellOrders = opsQuery.data?.workOrders ?? [];
  const bins = opsQuery.data?.bins ?? [];
  const grainStored = bins.reduce((s, b) => s + (b.currentBushels || 0), 0);
  const grainCapacity = bins.reduce((s, b) => s + (b.capacityBushels || 0), 0);
  const equipmentWorking = shellEquip.filter((e) => e.status === 'working').length;
  const shellAcres = shellFields.reduce((s, f) => s + (f.acreage || 0), 0);
  const avgYield =
    shellAcres > 0 ? Math.round((metrics.seasonYield / shellAcres) * 10) / 10 : 0;

  const fade = reduceMotion ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="space-y-4">
      <AgFarmShell
        totalFields={shellFields.length || fieldArts.length}
        totalAcres={shellAcres || metrics.totalAcres}
        equipmentCount={shellEquip.length || equipArts.length}
        equipmentWorking={equipmentWorking}
        seasonYieldBushels={metrics.seasonYield}
        avgYieldPerAcre={avgYield}
        grainStored={grainStored}
        grainCapacity={grainCapacity}
        grainUtilizationPct={grainCapacity > 0 ? Math.round((grainStored / grainCapacity) * 100) : 0}
        fields={shellFields}
        equipment={shellEquip}
        workOrders={shellOrders}
      />

      <section className="rounded-xl border border-white/10 bg-gradient-to-br from-emerald-900/20 via-zinc-900/40 to-amber-900/15 backdrop-blur-sm p-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-5">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-emerald-300/80 mb-1">
              Today on the farm
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-light text-zinc-100">{workableCount}</span>
              <span className="text-sm text-zinc-400">
                of {fieldArts.length} field{fieldArts.length === 1 ? '' : 's'} workable
              </span>
            </div>
            <div className="mt-2 text-xs text-zinc-400">
              {todayPrecip > 12
                ? `Heavy rain forecast (${todayPrecip.toFixed(1)}mm) — most fields too wet`
                : last24Precip > 8
                  ? `${last24Precip.toFixed(1)}mm last 24h — let fields drain`
                  : todayPrecip > 0
                    ? `Light precip today (${todayPrecip.toFixed(1)}mm) — most fields ok`
                    : 'Dry — fields workable'}
            </div>
            {fieldArts.length === 0 && (
              <button
                type="button"
                onClick={() => onOpenRecords('fields')}
                className="mt-3 text-xs px-3 py-1.5 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10"
              >
                Add your first field →
              </button>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-amber-300/80 mb-1">
              Action queue
            </div>
            {queueItems.length === 0 ? (
              <div className="mt-2 text-sm text-zinc-400">
                {fieldArts.length > 0
                  ? 'Nothing urgent. Books are clean.'
                  : 'Add fields, crops, equipment to track them.'}
              </div>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {queueItems.map((item) => (
                  <li key={item.label}>
                    <button
                      type="button"
                      onClick={item.action}
                      className={cn(
                        'w-full text-left text-sm px-3 py-1.5 rounded border border-white/10 hover:border-white/30 bg-white/[0.02] hover:bg-white/[0.05] transition-colors flex items-center justify-between gap-2',
                        item.color,
                      )}
                    >
                      <span>{item.label}</span>
                      <span className="text-xs opacity-60">→</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-5 h-5 text-green-400" />
            <span className={ds.textMuted}>Total Acreage</span>
          </div>
          <p className="text-3xl font-bold">{metrics.totalAcres.toLocaleString()}</p>
          <p className={ds.textMuted}>Across all fields</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Beef className="w-5 h-5 text-orange-400" />
            <span className={ds.textMuted}>Livestock</span>
          </div>
          <p className="text-3xl font-bold">{metrics.totalHead}</p>
          <p className={ds.textMuted}>Total head count</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Sprout className="w-5 h-5 text-emerald-400" />
            <span className={ds.textMuted}>Crops Growing</span>
          </div>
          <p className="text-3xl font-bold text-green-400">{metrics.cropsGrowing}</p>
          <p className={ds.textMuted}>{metrics.harvestReady} ready for harvest</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-cyan-400" />
            <span className={ds.textMuted}>Revenue (Sold)</span>
          </div>
          <p className="text-3xl font-bold text-neon-green">
            ${metrics.totalRevenue.toLocaleString()}
          </p>
          <p className={ds.textMuted}>From harvests sold</p>
        </div>
      </div>

      {crops.length > 0 && (
        <motion.div {...fade} className={ds.panel}>
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-400" /> Crop Health Overview
          </h3>
          <div className="flex gap-3 flex-wrap">
            <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-500/20 text-green-400">
              thriving: {thriving}
            </span>
            <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500/20 text-amber-400">
              stressed: {stressed}
            </span>
            <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/20 text-red-400">
              critical: {critical}
            </span>
          </div>
          {totalEstimated > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Harvest Progress</span>
                <span>{harvestPct.toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  initial={reduceMotion ? false : { width: 0 }}
                  animate={{ width: `${harvestPct}%` }}
                  transition={{ duration: reduceMotion ? 0 : 1, ease: 'easeOut' }}
                  className="h-full bg-gradient-to-r from-green-500 to-amber-400 rounded-full"
                />
              </div>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
            <CloudRain className="w-3.5 h-3.5 text-blue-400" />
            <span>
              Weather impact:{' '}
              {critical > 0 ? (
                <span className="text-red-400 font-medium">High stress detected</span>
              ) : stressed > 0 ? (
                <span className="text-amber-400 font-medium">Moderate</span>
              ) : (
                <span className="text-green-400 font-medium">Favorable conditions</span>
              )}
            </span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export default OpsDeskPanel;
