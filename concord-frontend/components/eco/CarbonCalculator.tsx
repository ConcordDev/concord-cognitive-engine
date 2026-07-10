'use client';

/**
 * CarbonCalculator — bespoke UI for the real `eco.carbonFootprint` macro
 * (server/domains/eco.js:15). That handler does genuine scope 1/2/3 GHG
 * accounting (built-in emission factors, per-category breakdown, offset
 * netting, equivalency figures) but had no reachable UI: the only prior
 * caller was a generic artifact-run path (`useRunArtifact` -> POST
 * /api/lens/eco/:id/run) that required a pre-existing "metric" artifact
 * with populated `.data.activities` — and nothing on the page ever created
 * one, so the button was permanently disabled. This calls the macro
 * directly via `/api/lens/run` (POST {domain,action,input}), which the
 * server turns into a virtual artifact whose `.data` IS the input object
 * (server.js `/api/lens/run` handler: `virtualArtifact = {..., data: rest}`)
 * — so `input.activities` lands exactly where the handler reads it.
 *
 * The activity/offset catalogs below are a curated subset of the handler's
 * own `emissionFactors` / `offsetFactors` tables (category+type concatenate
 * to the lookup key) so every entry hits a real, cited built-in factor.
 */

import { useCallback, useMemo, useState } from 'react';
import { Calculator, Loader2, Plus, Trash2, Leaf, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ActivityCatalogEntry { category: string; type: string; label: string; unit: string; group: string }
interface OffsetCatalogEntry { type: string; unit: string; label: string }

// Mirrors server/domains/eco.js `emissionFactors` keys exactly.
const ACTIVITY_CATALOG: ActivityCatalogEntry[] = [
  { category: 'electricity', type: 'kwh', label: 'Grid electricity', unit: 'kWh', group: 'Energy' },
  { category: 'electricity', type: 'kwh_renewable', label: 'Renewable electricity', unit: 'kWh', group: 'Energy' },
  { category: 'natural_gas', type: 'kwh', label: 'Natural gas (heating)', unit: 'kWh', group: 'Energy' },
  { category: 'diesel', type: 'liter', label: 'Diesel', unit: 'L', group: 'Energy' },
  { category: 'gasoline', type: 'liter', label: 'Gasoline', unit: 'L', group: 'Energy' },
  { category: 'propane', type: 'liter', label: 'Propane', unit: 'L', group: 'Energy' },
  { category: 'car', type: 'km', label: 'Car travel', unit: 'km', group: 'Transport' },
  { category: 'bus', type: 'km', label: 'Bus travel', unit: 'km', group: 'Transport' },
  { category: 'train', type: 'km', label: 'Train travel', unit: 'km', group: 'Transport' },
  { category: 'flight_short', type: 'km', label: 'Short-haul flight', unit: 'km', group: 'Transport' },
  { category: 'flight_long', type: 'km', label: 'Long-haul flight', unit: 'km', group: 'Transport' },
  { category: 'beef', type: 'kg', label: 'Beef', unit: 'kg', group: 'Food' },
  { category: 'pork', type: 'kg', label: 'Pork', unit: 'kg', group: 'Food' },
  { category: 'poultry', type: 'kg', label: 'Poultry', unit: 'kg', group: 'Food' },
  { category: 'fish', type: 'kg', label: 'Fish', unit: 'kg', group: 'Food' },
  { category: 'dairy', type: 'kg', label: 'Dairy', unit: 'kg', group: 'Food' },
  { category: 'vegetables', type: 'kg', label: 'Vegetables', unit: 'kg', group: 'Food' },
  { category: 'grains', type: 'kg', label: 'Grains', unit: 'kg', group: 'Food' },
  { category: 'landfill_waste', type: 'kg', label: 'Landfill waste', unit: 'kg', group: 'Waste' },
  { category: 'recycled_waste', type: 'kg', label: 'Recycled waste', unit: 'kg', group: 'Waste' },
  { category: 'compost_waste', type: 'kg', label: 'Composted waste', unit: 'kg', group: 'Waste' },
  { category: 'water', type: 'm3', label: 'Water use', unit: 'm³', group: 'Water' },
];

const OFFSET_CATALOG: OffsetCatalogEntry[] = [
  { type: 'tree_planting', unit: 'tree', label: 'Trees planted' },
  { type: 'solar', unit: 'kwh', label: 'Solar generation offset' },
  { type: 'wind', unit: 'kwh', label: 'Wind generation offset' },
  { type: 'carbon_credit', unit: 'tonne', label: 'Carbon credits purchased' },
  { type: 'reforestation', unit: 'hectare', label: 'Reforestation funded' },
  { type: 'biochar', unit: 'kg', label: 'Biochar produced' },
];

interface Row { id: string; catalogIdx: number; quantity: string }

interface CarbonResult {
  totalEmissionsKgCO2e: number;
  totalEmissionsTonneCO2e: number;
  totalOffsetsKgCO2e: number;
  netEmissionsKgCO2e: number;
  offsetPercentage: number;
  carbonNeutral: boolean;
  scopeBreakdown: Record<string, { kgCO2e: number; percentage: number; label: string }>;
  categoryBreakdown: { category: string; emissionsKgCO2e: number; percentage: number }[];
  equivalencies: { treesNeededToOffset: number; carKmEquivalent: number; londonToNewYorkFlights: number };
}

let rowSeq = 0;
const nextRowId = () => `row_${(rowSeq += 1)}_${Date.now()}`;

const GROUPS = ['Energy', 'Transport', 'Food', 'Waste', 'Water'];

export function CarbonCalculator({ onSaved }: { onSaved?: () => void }) {
  const [activities, setActivities] = useState<Row[]>([{ id: nextRowId(), catalogIdx: 6, quantity: '' }]);
  const [offsets, setOffsets] = useState<Row[]>([]);
  const [result, setResult] = useState<CarbonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [label, setLabel] = useState('');

  const addActivity = useCallback(() => setActivities((a) => [...a, { id: nextRowId(), catalogIdx: 0, quantity: '' }]), []);
  const removeActivity = useCallback((id: string) => setActivities((a) => a.filter((r) => r.id !== id)), []);
  const updateActivity = useCallback(
    (id: string, patch: Partial<Row>) => setActivities((a) => a.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    [],
  );

  const addOffset = useCallback(() => setOffsets((o) => [...o, { id: nextRowId(), catalogIdx: 0, quantity: '' }]), []);
  const removeOffset = useCallback((id: string) => setOffsets((o) => o.filter((r) => r.id !== id)), []);
  const updateOffset = useCallback(
    (id: string, patch: Partial<Row>) => setOffsets((o) => o.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    [],
  );

  const calculate = useCallback(async () => {
    const validActivities = activities
      .filter((r) => Number(r.quantity) > 0)
      .map((r) => {
        const c = ACTIVITY_CATALOG[r.catalogIdx];
        return { category: c.category, type: c.type, quantity: Number(r.quantity), unit: c.unit };
      });
    if (validActivities.length === 0) {
      setError('Add at least one activity with a quantity greater than 0.');
      return;
    }
    const validOffsets = offsets
      .filter((r) => Number(r.quantity) > 0)
      .map((r) => {
        const c = OFFSET_CATALOG[r.catalogIdx];
        return { type: c.type, quantity: Number(r.quantity), unit: c.unit };
      });
    setCalculating(true);
    setError(null);
    setSaved(false);
    const r = await lensRun<CarbonResult>('eco', 'carbonFootprint', { activities: validActivities, offsets: validOffsets });
    if (r.data?.ok && r.data.result) {
      setResult(r.data.result);
    } else {
      setError(r.data?.error || 'Could not compute footprint.');
      setResult(null);
    }
    setCalculating(false);
  }, [activities, offsets]);

  const save = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    const r = await lensRun('eco', 'footprint-record', {
      totalKgCO2e: result.totalEmissionsKgCO2e,
      netKgCO2e: result.netEmissionsKgCO2e,
      categoryBreakdown: result.categoryBreakdown,
      label: label.trim(),
    });
    setSaving(false);
    if (r.data?.ok) {
      setLabel('');
      setSaved(true);
      onSaved?.();
    } else {
      setError(r.data?.error || 'Could not save snapshot.');
    }
  }, [result, label, onSaved]);

  const catalogOptions = useMemo(
    () =>
      GROUPS.map((group) => ({
        group,
        options: ACTIVITY_CATALOG.map((c, idx) => ({ ...c, idx })).filter((c) => c.group === group),
      })),
    [],
  );

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calculator className="w-4 h-4 text-green-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Carbon footprint calculator</span>
        <span className="ml-auto text-[10px] text-gray-400">scope 1/2/3 · built-in emission factors</span>
      </header>

      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400 uppercase">Activities</span>
            <button
              onClick={addActivity}
              className="inline-flex items-center gap-1 text-[11px] text-green-400 hover:text-green-300"
            >
              <Plus className="w-3 h-3" /> Add activity
            </button>
          </div>
          {activities.map((row) => {
            const c = ACTIVITY_CATALOG[row.catalogIdx];
            return (
              <div key={row.id} className="flex items-center gap-2">
                <select
                  value={row.catalogIdx}
                  onChange={(e) => updateActivity(row.id, { catalogIdx: Number(e.target.value) })}
                  className="flex-1 px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-xs focus:outline-none focus:border-green-500/50"
                >
                  {catalogOptions.map(({ group, options }) => (
                    <optgroup key={group} label={group}>
                      {options.map((o) => (
                        <option key={o.idx} value={o.idx}>{o.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input
                  value={row.quantity}
                  onChange={(e) => updateActivity(row.id, { quantity: e.target.value })}
                  inputMode="decimal"
                  placeholder="qty"
                  className="w-20 px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-xs focus:outline-none focus:border-green-500/50"
                />
                <span className="w-8 text-[10px] text-gray-400">{c.unit}</span>
                <button
                  onClick={() => removeActivity(row.id)}
                  disabled={activities.length === 1}
                  className="p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400 disabled:opacity-30"
                  aria-label="Remove activity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-400 uppercase">Offsets (optional)</span>
            <button
              onClick={addOffset}
              className="inline-flex items-center gap-1 text-[11px] text-green-400 hover:text-green-300"
            >
              <Plus className="w-3 h-3" /> Add offset
            </button>
          </div>
          {offsets.map((row) => {
            const c = OFFSET_CATALOG[row.catalogIdx];
            return (
              <div key={row.id} className="flex items-center gap-2">
                <select
                  value={row.catalogIdx}
                  onChange={(e) => updateOffset(row.id, { catalogIdx: Number(e.target.value) })}
                  className="flex-1 px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-xs focus:outline-none focus:border-green-500/50"
                >
                  {OFFSET_CATALOG.map((o, idx) => (
                    <option key={idx} value={idx}>{o.label}</option>
                  ))}
                </select>
                <input
                  value={row.quantity}
                  onChange={(e) => updateOffset(row.id, { quantity: e.target.value })}
                  inputMode="decimal"
                  placeholder="qty"
                  className="w-20 px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-xs focus:outline-none focus:border-green-500/50"
                />
                <span className="w-12 text-[10px] text-gray-400">{c.unit}</span>
                <button
                  onClick={() => removeOffset(row.id)}
                  className="p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400"
                  aria-label="Remove offset"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          {offsets.length === 0 && (
            <p className="text-[10px] text-gray-500 italic">No offsets added — net will equal gross emissions.</p>
          )}
        </div>

        <button
          onClick={calculate}
          disabled={calculating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-500 text-black text-sm font-bold hover:bg-green-400 disabled:opacity-50"
        >
          {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
          Calculate
        </button>

        {error && <div className="text-xs text-red-400">{error}</div>}

        {result && (
          <div className="space-y-3 pt-3 border-t border-white/5">
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className="text-lg font-bold text-green-400">{result.totalEmissionsTonneCO2e}</p>
                <p className="text-[10px] text-gray-400">Tonnes CO₂e</p>
              </div>
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className={`text-lg font-bold ${result.netEmissionsKgCO2e <= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {result.netEmissionsKgCO2e}
                </p>
                <p className="text-[10px] text-gray-400">Net kg CO₂e</p>
              </div>
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className="text-lg font-bold text-cyan-400">{result.offsetPercentage}%</p>
                <p className="text-[10px] text-gray-400">Offset</p>
              </div>
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className={`text-xs font-bold ${result.carbonNeutral ? 'text-green-400' : 'text-red-400'}`}>
                  {result.carbonNeutral ? 'NEUTRAL' : 'NOT NEUTRAL'}
                </p>
                <p className="text-[10px] text-gray-400">Status</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {Object.entries(result.scopeBreakdown).map(([scope, d]) => (
                <div key={scope} className="p-2 bg-white/[0.02] border border-white/5 rounded text-center">
                  <p className="text-sm font-bold text-cyan-300">{d.percentage}%</p>
                  <p className="text-[9px] text-gray-400">{d.label}</p>
                  <p className="text-[9px] text-gray-400">{d.kgCO2e} kg</p>
                </div>
              ))}
            </div>

            {result.categoryBreakdown.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Category breakdown</p>
                {result.categoryBreakdown.slice(0, 6).map((c) => (
                  <div key={c.category} className="flex items-center gap-2">
                    <span className="text-gray-300 text-xs flex-1 capitalize">{c.category.replace(/_/g, ' ')}</span>
                    <span className="text-green-400 text-xs w-16 text-right">{c.emissionsKgCO2e} kg</span>
                    <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${c.percentage}%` }} />
                    </div>
                    <span className="text-gray-400 text-[10px] w-8 text-right">{c.percentage}%</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 bg-white/[0.02] rounded text-center">
                <p className="text-green-400 font-bold">{result.equivalencies.treesNeededToOffset}</p>
                <p className="text-[10px] text-gray-400">Trees to offset/yr</p>
              </div>
              <div className="p-2 bg-white/[0.02] rounded text-center">
                <p className="text-cyan-400 font-bold">{result.equivalencies.carKmEquivalent} km</p>
                <p className="text-[10px] text-gray-400">Car-km equivalent</p>
              </div>
              <div className="p-2 bg-white/[0.02] rounded text-center">
                <p className="text-yellow-400 font-bold">{result.equivalencies.londonToNewYorkFlights}</p>
                <p className="text-[10px] text-gray-400">LHR→JFK flights</p>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label this snapshot (optional)"
                className="flex-1 px-2 py-1.5 bg-white/[0.03] border border-white/10 rounded text-xs focus:outline-none focus:border-green-500/50"
              />
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Leaf className="w-3.5 h-3.5" />}
                {saved ? 'Saved to trend' : 'Save to footprint trend'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CarbonCalculator;
