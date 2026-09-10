'use client';

/**
 * Planning calculators — projectEstimate / roiCalculator /
 * permitCheck / colorPalette via lensRun. Extracted from page.tsx.
 */

import { useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Hammer, Loader2, BarChart3, X, CheckCircle2, Home, Calculator } from 'lucide-react';
import {
  DOMAIN,
  type ProjectEstimateResult,
  type RoiResult,
  type PermitResult,
  type ColorPaletteResult,
} from './hi-shared';

export function CalculatorsPanel() {
  const [calcPending, setCalcPending] = useState<string | null>(null);
  const [hiActionResult, setHiActionResult] = useState<{ action: string; data: unknown } | null>(null);
  const [estimateForm, setEstimateForm] = useState({ squareFootage: '400', projectType: 'kitchen' });
  const [permitForm, setPermitForm] = useState({ projectType: 'deck' });
  const [paletteForm, setPaletteForm] = useState({ room: 'living room', style: 'modern', squareFootage: '' });
  const [roiRows, setRoiRows] = useState([{ name: '', cost: '', valueAdded: '' }]);

  const runCalc = useCallback(async (action: string, params: Record<string, unknown>) => {
    setCalcPending(action);
    const { data } = await lensRun(DOMAIN, action, params);
    setCalcPending(null);
    if (data.ok) setHiActionResult({ action, data: data.result });
    else setHiActionResult({ action, data: { error: data.error || 'Action failed' } });
  }, []);

  return (
    <div className="panel p-4 space-y-4">
      <h2 className="font-semibold flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-amber-400" />
        Planning Calculators
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Project estimate */}
        <div className="lens-card space-y-2">
          <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5"><Hammer className="w-3.5 h-3.5" />Project Estimate</p>
          <div className="flex gap-2">
            <input type="number" value={estimateForm.squareFootage} onChange={e => setEstimateForm(f => ({ ...f, squareFootage: e.target.value }))} placeholder="Sq ft" className="input-lattice text-xs flex-1" />
            <select value={estimateForm.projectType} onChange={e => setEstimateForm(f => ({ ...f, projectType: e.target.value }))} className="input-lattice text-xs flex-1">
              {['kitchen', 'bathroom', 'flooring', 'painting', 'roofing', 'deck', 'basement', 'addition', 'general'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button onClick={() => runCalc('projectEstimate', estimateForm)} disabled={calcPending === 'projectEstimate'} className="btn-neon text-xs w-full disabled:opacity-50">
            {calcPending === 'projectEstimate' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Estimate'}
          </button>
        </div>

        {/* Permit check */}
        <div className="lens-card space-y-2">
          <p className="text-xs font-semibold text-neon-cyan flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />Permit Check</p>
          <input value={permitForm.projectType} onChange={e => setPermitForm({ projectType: e.target.value })} placeholder="e.g. deck, electrical, painting" className="input-lattice text-xs w-full" />
          <button onClick={() => runCalc('permitCheck', permitForm)} disabled={calcPending === 'permitCheck' || !permitForm.projectType.trim()} className="btn-neon text-xs w-full disabled:opacity-50">
            {calcPending === 'permitCheck' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Check permit'}
          </button>
        </div>

        {/* Color palette */}
        <div className="lens-card space-y-2">
          <p className="text-xs font-semibold text-neon-purple flex items-center gap-1.5"><Home className="w-3.5 h-3.5" />Color Palette</p>
          <div className="flex gap-2">
            <input value={paletteForm.room} onChange={e => setPaletteForm(f => ({ ...f, room: e.target.value }))} placeholder="Room" className="input-lattice text-xs flex-1" />
            <select value={paletteForm.style} onChange={e => setPaletteForm(f => ({ ...f, style: e.target.value }))} className="input-lattice text-xs flex-1">
              {['modern', 'farmhouse', 'coastal', 'traditional', 'minimalist'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={() => runCalc('colorPalette', paletteForm)} disabled={calcPending === 'colorPalette'} className="btn-neon text-xs w-full disabled:opacity-50">
            {calcPending === 'colorPalette' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Suggest palette'}
          </button>
        </div>

        {/* ROI calculator */}
        <div className="lens-card space-y-2">
          <p className="text-xs font-semibold text-neon-green flex items-center gap-1.5"><Calculator className="w-3.5 h-3.5" />ROI Calculator</p>
          {roiRows.map((row, i) => (
            <div key={i} className="flex gap-1.5">
              <input value={row.name} onChange={e => setRoiRows(rows => rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} placeholder="Project" className="input-lattice text-xs flex-1 min-w-0" />
              <input value={row.cost} onChange={e => setRoiRows(rows => rows.map((r, j) => j === i ? { ...r, cost: e.target.value } : r))} type="number" placeholder="Cost" className="input-lattice text-xs w-16" />
              <input value={row.valueAdded} onChange={e => setRoiRows(rows => rows.map((r, j) => j === i ? { ...r, valueAdded: e.target.value } : r))} type="number" placeholder="Value+" className="input-lattice text-xs w-16" />
              {roiRows.length > 1 && (
                <button onClick={() => setRoiRows(rows => rows.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400" aria-label={`Remove ROI row${row.name.trim() ? ` "${row.name.trim()}"` : ''}`}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={() => setRoiRows(rows => [...rows, { name: '', cost: '', valueAdded: '' }])} className="text-xs text-gray-400 hover:text-white">+ row</button>
            <button
              onClick={() => runCalc('roiCalculator', { projects: roiRows.filter(r => r.name.trim()).map(r => ({ name: r.name, cost: r.cost, valueAdded: r.valueAdded })) })}
              disabled={calcPending === 'roiCalculator' || roiRows.every(r => !r.name.trim())}
              className="btn-neon text-xs flex-1 disabled:opacity-50"
            >
              {calcPending === 'roiCalculator' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : 'Calculate ROI'}
            </button>
          </div>
        </div>
      </div>

      {hiActionResult && !calcPending && (() => {
        if ((hiActionResult.data as { error?: string })?.error) {
          return <p className="text-xs text-red-400 pt-2 border-t border-lattice-border">{(hiActionResult.data as { error: string }).error}</p>;
        }
        if (hiActionResult.action === 'projectEstimate') {
          const d = hiActionResult.data as ProjectEstimateResult;
          return (
            <div className="space-y-3 pt-2 border-t border-lattice-border">
              <h3 className="text-sm font-semibold text-amber-400">Project Estimate — {d.projectType}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Materials', value: `$${(d.materialsCost || 0).toLocaleString()}`, color: 'text-neon-cyan' },
                  { label: 'Labor', value: `$${(d.laborCost || 0).toLocaleString()}`, color: 'text-neon-purple' },
                  { label: 'Permits', value: `$${(d.permits || 0).toLocaleString()}`, color: 'text-yellow-400' },
                  { label: 'Total', value: `$${(d.total || 0).toLocaleString()}`, color: 'text-neon-green' },
                ].map(s => (
                  <div key={s.label} className="lens-card text-center">
                    <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-400">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="lens-card">
                  <p className="text-xs text-gray-400 mb-1">DIY Estimate</p>
                  <p className="text-lg font-bold text-neon-cyan">${(d.diyEstimate || 0).toLocaleString()}</p>
                  <p className="text-xs text-neon-green mt-1">Save ${(d.savings || 0).toLocaleString()}</p>
                </div>
                <div className="lens-card">
                  <p className="text-xs text-gray-400 mb-1">Contractor Estimate</p>
                  <p className="text-lg font-bold text-neon-purple">${(d.contractorEstimate || 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-400 mt-1">Timeline: {d.timeline}</p>
                </div>
              </div>
            </div>
          );
        }
        if (hiActionResult.action === 'roiCalculator') {
          const d = hiActionResult.data as RoiResult;
          if (d.message) return <p className="text-xs text-gray-400 pt-2 border-t border-lattice-border">{d.message}</p>;
          return (
            <div className="space-y-3 pt-2 border-t border-lattice-border">
              <h3 className="text-sm font-semibold text-neon-green">ROI Calculator</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="lens-card text-center">
                  <p className="text-lg font-bold text-neon-green">{(d.avgROI || 0).toFixed(1)}%</p>
                  <p className="text-xs text-gray-400">Avg ROI</p>
                </div>
                <div className="lens-card text-center">
                  <p className="text-lg font-bold text-neon-cyan">${(d.totalInvested || 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-400">Total Invested</p>
                </div>
                <div className="lens-card text-center">
                  <p className="text-lg font-bold text-neon-purple">${(d.totalValueAdded || 0).toLocaleString()}</p>
                  <p className="text-xs text-gray-400">Value Added</p>
                </div>
              </div>
              {d.bestROI && <p className="text-xs text-neon-green">Best ROI: {d.bestROI}</p>}
              {d.worstROI && <p className="text-xs text-red-400">Worst ROI: {d.worstROI}</p>}
              {(d.projects || []).map((p, i) => (
                <div key={i} className="lens-card space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white">{p.project}</span>
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${p.worthIt ? 'bg-neon-green/20 text-neon-green' : 'bg-red-400/20 text-red-400'}`}>
                      {p.worthIt ? 'Worth It' : 'Marginal'} · {p.roi.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${p.roi >= 0 ? 'bg-neon-green' : 'bg-red-400'}`} style={{ width: `${Math.min(100, Math.abs(p.roi))}%` }} />
                  </div>
                  <p className="text-xs text-gray-400">Net Gain: ${p.netGain.toLocaleString()}</p>
                </div>
              ))}
            </div>
          );
        }
        if (hiActionResult.action === 'permitCheck') {
          const d = hiActionResult.data as PermitResult;
          return (
            <div className="space-y-3 pt-2 border-t border-lattice-border">
              <h3 className="text-sm font-semibold text-neon-cyan">Permit Check — {d.projectType}</h3>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${d.requiresPermit ? 'bg-yellow-400/20 text-yellow-400' : 'bg-neon-green/20 text-neon-green'}`}>
                  {d.requiresPermit ? 'Permit Required' : 'No Permit Needed'}
                </span>
                {d.permitType && <span className="text-sm text-gray-300">{d.permitType}</span>}
              </div>
              {d.requiresPermit && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="lens-card">
                    <p className="text-xs text-gray-400">Estimated Cost</p>
                    <p className="text-lg font-bold text-neon-cyan">${(d.estimatedCost || 0).toLocaleString()}</p>
                  </div>
                  <div className="lens-card">
                    <p className="text-xs text-gray-400">Processing Time</p>
                    <p className="text-sm font-semibold text-white">{d.processingTime}</p>
                  </div>
                </div>
              )}
              {(d.inspectionsRequired || []).length > 0 && (
                <div>
                  <p className="text-xs text-gray-400 mb-2">Inspections Required</p>
                  <div className="flex flex-wrap gap-2">
                    {d.inspectionsRequired.map((ins, i) => (
                      <span key={i} className="text-xs px-2 py-1 bg-neon-purple/10 text-neon-purple rounded border border-neon-purple/20">{ins}</span>
                    ))}
                  </div>
                </div>
              )}
              {d.tip && <p className="text-xs text-gray-400 italic p-3 bg-lattice-deep rounded-lg">{d.tip}</p>}
            </div>
          );
        }
        if (hiActionResult.action === 'colorPalette') {
          const d = hiActionResult.data as ColorPaletteResult;
          return (
            <div className="space-y-3 pt-2 border-t border-lattice-border">
              <h3 className="text-sm font-semibold text-neon-purple">Color Palette — {d.room} ({d.style})</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  { label: 'Wall Color', value: d.wallColor, color: 'text-amber-400' },
                  { label: 'Trim', value: d.trim, color: 'text-gray-300' },
                  { label: 'Accent', value: d.accent, color: 'text-neon-cyan' },
                  { label: 'Furniture', value: d.furniture, color: 'text-neon-purple' },
                  { label: 'Decor', value: d.decor, color: 'text-neon-green' },
                ].map(c => (
                  <div key={c.label} className="lens-card">
                    <p className="text-xs text-gray-400">{c.label}</p>
                    <p className={`text-sm font-semibold ${c.color}`}>{c.value}</p>
                  </div>
                ))}
              </div>
              {d.coverage && <p className="text-xs text-gray-400">Coverage: {d.coverage}</p>}
              <p className="text-xs text-gray-400">Palette: {d.palette}</p>
            </div>
          );
        }
        return null;
      })()}
    </div>

  );
}
