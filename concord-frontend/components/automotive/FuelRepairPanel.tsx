'use client';

/**
 * FuelRepairPanel — fuel economy + repair estimator for the
 * automotive lens. Wires automotive.fuelEfficiency +
 * automotive.repairEstimate.
 *
 * Refactored to use `CalcPanel` primitive. See
 * `concord-frontend/components/lens-primitives/CalcPanel.tsx`.
 */

import { useState } from 'react';
import { Plus, Trash2, Fuel, Wrench, Car } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface FillUp { date: string; mileage: string; gallons: string; pricePerGallon: string }
interface Repair { name: string; partsCost: string; laborHours: string; priority: 'low' | 'medium' | 'high' }
interface FuelResult { avgMPG?: number; bestMPG?: number; worstMPG?: number; totalGallons?: number; totalFuelCost?: number; costPerMile?: number; readings?: Array<{ date?: string; mpg: number; miles: number; gallons: number }> }
interface RepairResult { repairs?: Array<{ repair: string; partsCost: number; laborHours: number; laborRate: number; laborCost: number; total: number; priority: string }>; subtotalParts?: number; subtotalLabor?: number; grandTotal?: number; tax?: number; totalWithTax?: number; recommendation?: string }

const today = new Date();
const dayOffset = (n: number) => new Date(today.getTime() - n * 86400000).toISOString().slice(0, 10);

const prBadge = (p: string) => {
  if (p === 'high') return 'bg-rose-500/20 text-rose-200';
  if (p === 'medium') return 'bg-amber-500/20 text-amber-200';
  return 'bg-zinc-700 text-zinc-300';
};

export function FuelRepairPanel() {
  const [fillups, setFillups] = useState<FillUp[]>([{ date: dayOffset(0), mileage: '', gallons: '', pricePerGallon: '' }, { date: dayOffset(0), mileage: '', gallons: '', pricePerGallon: '' }]);
  const [repairs, setRepairs] = useState<Repair[]>([{ name: '', partsCost: '', laborHours: '', priority: 'medium' }]);
  const [shopRate, setShopRate] = useState(120);

  const addFill = () => setFillups((fs) => [...fs, { date: dayOffset(0), mileage: '', gallons: '', pricePerGallon: '' }]);
  const updateFill = <K extends keyof FillUp>(i: number, key: K, value: FillUp[K]) =>
    setFillups((fs) => fs.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  const removeFill = (i: number) => setFillups((fs) => fs.filter((_, idx) => idx !== i));

  const addRep = () => setRepairs((rs) => [...rs, { name: '', partsCost: '', laborHours: '', priority: 'medium' }]);
  const updateRep = <K extends keyof Repair>(i: number, key: K, value: Repair[K]) =>
    setRepairs((rs) => rs.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const removeRep = (i: number) => setRepairs((rs) => rs.filter((_, idx) => idx !== i));

  return (
    <CalcPanel<FuelResult, RepairResult>
      title="Fuel economy + repair estimate"
      domain="automotive"
      icon={<Car className="h-5 w-5 text-blue-400" />}
      macroBadge="automotive.fuelEfficiency + repairEstimate"
      accent="blue"
      left={{
        macro: 'fuelEfficiency',
        buildArtifact: () => ({ data: { fillups: fillups.filter((f) => f.mileage && f.gallons) } }),
        render: (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Fill-ups (chronological)</div>
            <div className="grid grid-cols-[130px_100px_90px_90px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
              <span>Date</span><span>Mileage</span><span>Gallons</span><span>$ / gal</span><span></span>
            </div>
            {fillups.map((f, i) => (
              <div key={i} className="grid grid-cols-[130px_100px_90px_90px_30px] gap-1.5">
                <input type="date" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={f.date} onChange={(e) => updateFill(i, 'date', e.target.value)} />
                <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={f.mileage} onChange={(e) => updateFill(i, 'mileage', e.target.value)} />
                <input type="number" step={0.1} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={f.gallons} onChange={(e) => updateFill(i, 'gallons', e.target.value)} />
                <input type="number" step={0.01} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={f.pricePerGallon} onChange={(e) => updateFill(i, 'pricePerGallon', e.target.value)} />
                <button type="button" onClick={() => removeFill(i)} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            ))}
            <button type="button" onClick={addFill} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-blue-500/40 hover:text-blue-200"><Plus className="h-3 w-3" />Add fill-up</button>
          </div>
        ),
      }}
      right={{
        macro: 'repairEstimate',
        buildArtifact: () => ({ data: { repairs: repairs.filter((r) => r.name.trim()), shopRate } }),
        render: (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Repair line items</div>
              <label className="text-[10px] text-zinc-400">Shop labor rate ($/hr)
                <input type="number" min={50} max={300} value={shopRate} onChange={(e) => setShopRate(Math.max(50, Math.min(300, Number(e.target.value) || 120)))} className="ml-2 w-16 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-xs text-white font-mono" />
              </label>
            </div>
            <div className="grid grid-cols-[1fr_90px_80px_100px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
              <span>Repair</span><span>Parts $</span><span>Labor (h)</span><span>Priority</span><span></span>
            </div>
            {repairs.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_80px_100px_30px] gap-1.5">
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Repair name" value={r.name} onChange={(e) => updateRep(i, 'name', e.target.value)} />
                <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={r.partsCost} onChange={(e) => updateRep(i, 'partsCost', e.target.value)} />
                <input type="number" step={0.1} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={r.laborHours} onChange={(e) => updateRep(i, 'laborHours', e.target.value)} />
                <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={r.priority} onChange={(e) => updateRep(i, 'priority', e.target.value as Repair['priority'])}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
                <button type="button" onClick={() => removeRep(i)} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            ))}
            <button type="button" onClick={addRep} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-blue-500/40 hover:text-blue-200"><Plus className="h-3 w-3" />Add repair</button>
          </div>
        ),
      }}
      renderResults={(fuelResult, repairResult) => (
        <>
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Fuel className="h-3 w-3" />Fuel economy</div>
            {!fuelResult && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {fuelResult && (
              <div className="space-y-2 text-[11px]">
                <div className="rounded border border-blue-500/20 bg-zinc-950/40 px-2 py-1">
                  <div className="text-[9px] text-zinc-400">Average MPG</div>
                  <div className="font-mono text-2xl text-blue-200">{fuelResult.avgMPG}</div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="rounded border border-emerald-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Best</div><div className="font-mono text-emerald-200">{fuelResult.bestMPG}</div></div>
                  <div className="rounded border border-rose-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Worst</div><div className="font-mono text-rose-200">{fuelResult.worstMPG}</div></div>
                  <div className="rounded border border-blue-500/15 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">$/mile</div><div className="font-mono text-blue-200">${fuelResult.costPerMile}</div></div>
                </div>
                {fuelResult.readings && fuelResult.readings.length > 0 && (
                  <details className="text-[10px]">
                    <summary className="cursor-pointer text-zinc-400 hover:text-zinc-300">Per-fillup readings ({fuelResult.readings.length})</summary>
                    <div className="mt-1 space-y-0.5">
                      {fuelResult.readings.map((r, i) => (
                        <div key={i} className="flex items-center justify-between rounded border border-blue-500/10 bg-zinc-950/40 px-2 py-0.5"><span className="text-zinc-300">{r.date || `Fillup ${i + 2}`}</span><span className="font-mono text-blue-200">{r.mpg} MPG</span></div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Wrench className="h-3 w-3" />Repair estimate</div>
            {!repairResult && <div className="text-[11px] text-zinc-400">Analyze to compute.</div>}
            {repairResult && (
              <div className="space-y-1.5 text-[11px]">
                <div className="rounded border border-orange-500/20 bg-zinc-950/40 px-2 py-1">
                  <div className="text-[9px] text-zinc-400">Total with tax</div>
                  <div className="font-mono text-2xl text-orange-200">${repairResult.totalWithTax?.toLocaleString()}</div>
                  <div className="text-[10px] text-zinc-400">parts ${repairResult.subtotalParts} + labor ${repairResult.subtotalLabor} + tax ${repairResult.tax}</div>
                </div>
                <div className="space-y-1">
                  {repairResult.repairs?.map((r, i) => (
                    <div key={i} className="rounded border border-orange-500/15 bg-zinc-950/40 px-2 py-1">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-100">{r.repair}</span>
                        <span className="font-mono text-orange-200">${r.total}</span>
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-zinc-400">
                        <span>parts ${r.partsCost} + labor {r.laborHours}h × ${r.laborRate} = ${r.laborCost}</span>
                        <span className={`rounded px-1 ${prBadge(r.priority)}`}>{r.priority}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {repairResult.recommendation && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-[10px] text-amber-200">{repairResult.recommendation}</div>}
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-auto-fuel-repair',
        title: (f, r) => `Auto — ${f.avgMPG ?? '—'} MPG · $${r.totalWithTax ?? '—'} repair est`,
        content: (f, r) => `Fuel:\n  Avg MPG: ${f.avgMPG} (best ${f.bestMPG}, worst ${f.worstMPG})\n  Total gallons: ${f.totalGallons} | Cost: $${f.totalFuelCost?.toFixed?.(2) ?? '—'} | Cost/mile: $${f.costPerMile}\n\nRepair estimate (shop rate $${shopRate}/hr):\n${(r.repairs || []).map((rr) => `  ${rr.repair} — parts $${rr.partsCost} + labor ${rr.laborHours}h ($${rr.laborCost}) = $${rr.total} [${rr.priority}]`).join('\n')}\n  Parts subtotal: $${r.subtotalParts}\n  Labor subtotal: $${r.subtotalLabor}\n  Tax: $${r.tax}\n  Total with tax: $${r.totalWithTax}\n  Note: ${r.recommendation}`,
        tags: () => ['automotive', 'fuel-economy', 'repair'],
        rawData: (f, r) => ({ fillups, repairs, shopRate, fuelResult: f, repairResult: r }),
      }}
    />
  );
}
