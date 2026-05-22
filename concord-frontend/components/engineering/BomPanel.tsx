'use client';

import { useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Plus, Trash2, Calculator, ExternalLink, Loader2 } from 'lucide-react';

interface BomItem {
  partNumber: string;
  description: string;
  quantity: number;
  unitCost: number;
  supplier: string;
  leadTimeDays: number;
}

interface BomRow extends BomItem {
  extendedCost: number;
  supplierLinks: { mcmaster: string; digikey: string; grainger: string };
}

interface BomRollup {
  rows: BomRow[];
  buildQty: number;
  rollup: {
    lineItems: number;
    totalParts: number;
    materialCost: number;
    overheadRate: number;
    overhead: number;
    totalCost: number;
    costPerUnit: number;
    procurementLeadDays: number;
  };
  criticalPath: { partNumber: string; leadTimeDays: number }[];
  bySupplier: { supplier: string; lineItems: number; cost: number }[];
}

const BLANK: BomItem = {
  partNumber: '',
  description: '',
  quantity: 1,
  unitCost: 0,
  supplier: 'TBD',
  leadTimeDays: 0,
};

const STARTER: BomItem[] = [
  { partNumber: 'W8X31', description: 'Wide-flange beam', quantity: 4, unitCost: 142, supplier: 'Ryerson', leadTimeDays: 14 },
  { partNumber: 'HEX-M12-50', description: 'M12×50 hex bolt', quantity: 32, unitCost: 0.85, supplier: 'McMaster', leadTimeDays: 2 },
  { partNumber: 'BASEPLATE-A', description: 'Welded base plate 12mm', quantity: 4, unitCost: 78, supplier: 'TBD', leadTimeDays: 21 },
];

export function BomPanel() {
  const [items, setItems] = useState<BomItem[]>(STARTER);
  const [buildQty, setBuildQty] = useState(1);
  const [overheadRate, setOverheadRate] = useState(0.15);
  const [result, setResult] = useState<BomRollup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addRow = () => setItems((i) => [...i, { ...BLANK }]);
  const removeRow = (idx: number) =>
    setItems((i) => i.filter((_, n) => n !== idx));
  const setField = (idx: number, f: keyof BomItem, v: string) => {
    setItems((i) => {
      const next = [...i];
      const numeric: (keyof BomItem)[] = ['quantity', 'unitCost', 'leadTimeDays'];
      next[idx] = {
        ...next[idx],
        [f]: numeric.includes(f) ? parseFloat(v) || 0 : v,
      };
      return next;
    });
  };

  const compute = useCallback(async () => {
    setLoading(true);
    setError('');
    const r = await lensRun<BomRollup>('engineering', 'bomRollup', {
      items,
      buildQty,
      overheadRate,
    });
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setError(r.data.error || 'BOM rollup failed');
    setLoading(false);
  }, [items, buildQty, overheadRate]);

  return (
    <div className="space-y-4">
      {/* Item editor */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Calculator className="w-4 h-4 text-neon-cyan" /> Bill of Materials
          </h3>
          <button
            onClick={addRow}
            className="text-xs px-2 py-1 bg-neon-cyan/20 text-neon-cyan rounded hover:bg-neon-cyan/30"
          >
            <Plus className="w-3 h-3 inline mr-1" /> Item
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-white/10">
                <th className="text-left py-1 px-2">Part #</th>
                <th className="text-left py-1 px-2">Description</th>
                <th className="text-right py-1 px-2">Qty</th>
                <th className="text-right py-1 px-2">Unit $</th>
                <th className="text-left py-1 px-2">Supplier</th>
                <th className="text-right py-1 px-2">Lead (d)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-1 px-2">
                    <input
                      className="w-24 bg-black/30 border border-white/10 rounded px-1 font-mono"
                      value={it.partNumber}
                      onChange={(e) => setField(i, 'partNumber', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-2">
                    <input
                      className="w-40 bg-black/30 border border-white/10 rounded px-1"
                      value={it.description}
                      onChange={(e) => setField(i, 'description', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-2 text-right">
                    <input
                      className="w-14 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={it.quantity}
                      onChange={(e) => setField(i, 'quantity', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-2 text-right">
                    <input
                      className="w-16 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={it.unitCost}
                      onChange={(e) => setField(i, 'unitCost', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-2">
                    <input
                      className="w-24 bg-black/30 border border-white/10 rounded px-1"
                      value={it.supplier}
                      onChange={(e) => setField(i, 'supplier', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-2 text-right">
                    <input
                      className="w-12 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={it.leadTimeDays}
                      onChange={(e) => setField(i, 'leadTimeDays', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-1">
                    <button
                      onClick={() => removeRow(i)}
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Delete item"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-gray-400">Build Qty</label>
            <input
              type="number"
              min={1}
              value={buildQty}
              onChange={(e) => setBuildQty(parseInt(e.target.value) || 1)}
              className="w-20 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm font-mono block mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Overhead Rate</label>
            <input
              type="number"
              step="0.01"
              value={overheadRate}
              onChange={(e) => setOverheadRate(parseFloat(e.target.value) || 0)}
              className="w-24 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm font-mono block mt-1"
            />
          </div>
          <button
            onClick={compute}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-neon-cyan text-black rounded-lg text-sm font-semibold hover:bg-neon-cyan/90 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Calculator className="w-4 h-4" />
            )}
            Roll Up Cost
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {/* Rollup result */}
      {result && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="panel p-3 text-center">
              <p className="text-xs text-gray-400">Material Cost</p>
              <p className="text-lg font-mono font-bold text-neon-cyan">
                ${result.rollup.materialCost.toLocaleString()}
              </p>
            </div>
            <div className="panel p-3 text-center">
              <p className="text-xs text-gray-400">
                + Overhead ({(result.rollup.overheadRate * 100).toFixed(0)}%)
              </p>
              <p className="text-lg font-mono font-bold text-purple-400">
                ${result.rollup.overhead.toLocaleString()}
              </p>
            </div>
            <div className="panel p-3 text-center">
              <p className="text-xs text-gray-400">Total Cost</p>
              <p className="text-lg font-mono font-bold text-green-400">
                ${result.rollup.totalCost.toLocaleString()}
              </p>
            </div>
            <div className="panel p-3 text-center">
              <p className="text-xs text-gray-400">Cost / Unit</p>
              <p className="text-lg font-mono font-bold text-yellow-400">
                ${result.rollup.costPerUnit.toLocaleString()}
              </p>
            </div>
          </div>

          {/* Supplier links table */}
          <div className="panel p-4">
            <h3 className="font-semibold text-sm mb-2">
              Procurement · {result.rollup.procurementLeadDays} day lead
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-white/10">
                    <th className="text-left py-1 px-2">Part #</th>
                    <th className="text-right py-1 px-2">Qty</th>
                    <th className="text-right py-1 px-2">Ext. $</th>
                    <th className="text-left py-1 px-2">Find at supplier</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-1.5 px-2 font-mono">{r.partNumber}</td>
                      <td className="py-1.5 px-2 text-right font-mono">
                        {r.quantity}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-green-400">
                        ${r.extendedCost.toLocaleString()}
                      </td>
                      <td className="py-1.5 px-2">
                        <div className="flex gap-2">
                          {(['mcmaster', 'digikey', 'grainger'] as const).map(
                            (s) => (
                              <a
                                key={s}
                                href={r.supplierLinks[s]}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-neon-cyan hover:underline flex items-center gap-0.5 capitalize"
                              >
                                {s}
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            ),
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cost by supplier chart */}
          {result.bySupplier.length > 0 && (
            <div className="panel p-4">
              <h3 className="font-semibold text-sm mb-2">Cost by Supplier</h3>
              <ChartKit
                kind="bar"
                data={result.bySupplier.map((s) => ({
                  supplier: s.supplier,
                  cost: s.cost,
                }))}
                xKey="supplier"
                series={[{ key: 'cost', label: 'Cost ($)', color: '#22c55e' }]}
                height={200}
              />
            </div>
          )}

          {/* Critical path */}
          {result.criticalPath.length > 0 && (
            <div className="panel p-4">
              <h3 className="font-semibold text-sm mb-2">
                Critical Path (longest lead)
              </h3>
              <div className="flex flex-wrap gap-2">
                {result.criticalPath.map((c) => (
                  <span
                    key={c.partNumber}
                    className="px-3 py-1 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-400 text-xs font-mono"
                  >
                    {c.partNumber} · {c.leadTimeDays}d
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
