'use client';

// Precision-Ag Workbench — wires the seven Climate FieldView feature-parity
// backlog items to real backend macros: satellite NDVI layers, ISOBUS/CAN
// telemetry import, per-field profit/cost analysis, spray-window advisor,
// harvest yield-map overlay, seed-trial comparison, soil-sampling grid.
// All data is real user input or computed from real platform state.

import { useCallback, useEffect, useState } from 'react';
import {
  Satellite,
  Cpu,
  DollarSign,
  Wind,
  Grid3x3,
  FlaskConical,
  Sprout,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { NdviLayersPanel } from './NdviLayersPanel';
import { TelemetryImportPanel } from './TelemetryImportPanel';
import { ProfitAnalysisPanel } from './ProfitAnalysisPanel';
import { SprayWindowPanel } from './SprayWindowPanel';
import { YieldMapPanel } from './YieldMapPanel';
import { SeedTrialPanel } from './SeedTrialPanel';
import { SoilGridPanel } from './SoilGridPanel';

export interface AgField {
  id: string;
  name: string;
  acreage: number;
  lat: number;
  lng: number;
  soilType: string;
  currentCrop: string;
}

type Tab =
  | 'ndvi'
  | 'telemetry'
  | 'profit'
  | 'spray'
  | 'yieldmap'
  | 'trials'
  | 'soilgrid';

const TABS: { id: Tab; label: string; icon: typeof Satellite }[] = [
  { id: 'ndvi', label: 'Satellite NDVI', icon: Satellite },
  { id: 'telemetry', label: 'Machine sync', icon: Cpu },
  { id: 'profit', label: 'Profit / cost', icon: DollarSign },
  { id: 'spray', label: 'Spray window', icon: Wind },
  { id: 'yieldmap', label: 'Yield map', icon: Grid3x3 },
  { id: 'trials', label: 'Seed trials', icon: FlaskConical },
  { id: 'soilgrid', label: 'Soil grid', icon: Sprout },
];

export default function PrecisionAgPanel() {
  const [active, setActive] = useState<Tab>('ndvi');
  const [fields, setFields] = useState<AgField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);

  const refreshFields = useCallback(async () => {
    setFieldsLoading(true);
    try {
      const r = await lensRun('agriculture', 'field-list', {});
      if (r.data?.ok) {
        setFields(((r.data.result as { fields?: AgField[] } | null)?.fields || []) as AgField[]);
      }
    } catch (e) {
      console.error('[PrecisionAg] field-list failed', e);
    } finally {
      setFieldsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshFields();
  }, [refreshFields]);

  return (
    <section className="rounded-xl border border-emerald-900/30 bg-[#0b0f14]">
      <header className="px-4 py-3 border-b border-emerald-900/30 flex items-center gap-2">
        <Satellite className="w-4 h-4 text-emerald-400" />
        <h2 className="text-sm font-semibold text-emerald-300 uppercase tracking-wider">
          Precision-Ag Workbench
        </h2>
        <span className="ml-auto text-[10px] text-gray-400">
          {fields.length} field{fields.length === 1 ? '' : 's'} on record
        </span>
      </header>

      <nav className="flex items-center gap-1 px-3 py-2 border-b border-emerald-900/20 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition',
                active === t.id
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                  : 'text-gray-400 hover:text-emerald-300 hover:bg-emerald-900/10 border border-transparent',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {active === 'ndvi' && (
          <NdviLayersPanel fields={fields} fieldsLoading={fieldsLoading} />
        )}
        {active === 'telemetry' && <TelemetryImportPanel />}
        {active === 'profit' && (
          <ProfitAnalysisPanel fields={fields} fieldsLoading={fieldsLoading} />
        )}
        {active === 'spray' && (
          <SprayWindowPanel fields={fields} fieldsLoading={fieldsLoading} />
        )}
        {active === 'yieldmap' && (
          <YieldMapPanel fields={fields} fieldsLoading={fieldsLoading} />
        )}
        {active === 'trials' && <SeedTrialPanel />}
        {active === 'soilgrid' && (
          <SoilGridPanel fields={fields} fieldsLoading={fieldsLoading} />
        )}
      </div>
    </section>
  );
}
