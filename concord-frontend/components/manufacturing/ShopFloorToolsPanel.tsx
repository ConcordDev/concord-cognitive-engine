'use client';

/**
 * ShopFloorToolsPanel — work-order execution tools.
 *
 * manufacturing.advanceStep / defectAnalysis / generateTraveler / logDowntime
 * are compute-on-supplied-data macros (they read `artifact.data`, they don't
 * own a persisted work-order table of their own — manufacturing.work-orders
 * is an empty-by-design placeholder until a real ERP feed is wired, per its
 * own `source:"empty"` response). Previously these were only reachable
 * through the page's fabricated generic-artifact CRUD system, which meant
 * they were permanently dead on a fresh install (no artifact ever existed)
 * and field-shape-mismatched even when one did (a fake "WorkOrder" artifact
 * has fields like product/quantity/dueDate, never the `steps`/`defects`/
 * `durationMinutes` these macros actually read). This panel calls them
 * directly via lensRun with real, honestly-entered shop-floor data — no
 * persisted artifact required (POST /api/lens/run builds the virtual
 * artifact from the input body directly).
 */

import { useState } from 'react';
import {
  ListChecks,
  ClipboardCheck,
  FileText,
  Timer,
  Loader2,
  Plus,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AdvanceStepResult {
  workOrder: string;
  currentStep: number;
  totalSteps: number;
  status: string;
  currentStepName: string | null;
  nextStepName: string | null;
  percentComplete: number;
}

interface DefectAnalysisResult {
  defectCount: number;
  inspected: number;
  defectRatePct: number;
  byType: Record<string, number>;
  bySeverity: { critical: number; major: number; minor: number };
  topDefect: string | null;
  riskLevel: string;
}

interface TravelerResult {
  travelerId: string;
  partNumber: string;
  quantity: number;
  stepCount: number;
  content: string;
}

interface DowntimeResult {
  downtimeId: string;
  machine: string;
  reason: string;
  durationMinutes: number;
  availabilityImpactPct: number;
}

interface DefectRow {
  type: string;
  severity: 'critical' | 'major' | 'minor';
}

const card = 'rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 space-y-3';
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-amber-600 hover:bg-amber-500 text-white`;
const inputCls = 'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none';
const labelCls = 'mb-1 block text-xs font-medium text-zinc-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

export function ShopFloorToolsPanel() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Advance step
  const [woTitle, setWoTitle] = useState('');
  const [stepNames, setStepNames] = useState('');
  const [currentStep, setCurrentStep] = useState('0');
  const [stepResult, setStepResult] = useState<AdvanceStepResult | null>(null);

  // Defect analysis
  const [defects, setDefects] = useState<DefectRow[]>([{ type: '', severity: 'minor' }]);
  const [inspected, setInspected] = useState('');
  const [defectResult, setDefectResult] = useState<DefectAnalysisResult | null>(null);

  // Traveler
  const [partNumber, setPartNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [travelerSteps, setTravelerSteps] = useState('');
  const [travelerResult, setTravelerResult] = useState<TravelerResult | null>(null);

  // Downtime
  const [machine, setMachine] = useState('');
  const [reason, setReason] = useState('unplanned');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [plannedTime, setPlannedTime] = useState('480');
  const [downtimeResult, setDowntimeResult] = useState<DowntimeResult | null>(null);

  function splitSteps(text: string): string[] {
    return text.split(',').map((s) => s.trim()).filter(Boolean);
  }

  async function runAdvanceStep() {
    setBusy('step');
    setError(null);
    try {
      const steps = splitSteps(stepNames);
      const res = await lensRun('manufacturing', 'advanceStep', {
        artifact: { title: woTitle || 'work order', data: { steps, currentStep: Number(currentStep) || 0 } },
        steps,
        currentStep: Number(currentStep) || 0,
      });
      if (res.data?.ok) setStepResult(res.data.result as AdvanceStepResult);
      else setError(res.data?.error || 'advanceStep failed');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function runDefectAnalysis() {
    setBusy('defect');
    setError(null);
    try {
      const valid = defects.filter((d) => d.type.trim());
      if (valid.length === 0) {
        setError('Add at least one defect row.');
        return;
      }
      const res = await lensRun('manufacturing', 'defectAnalysis', {
        defects: valid,
        inspected: Number(inspected) || valid.length,
      });
      if (res.data?.ok) setDefectResult(res.data.result as DefectAnalysisResult);
      else setError(res.data?.error || 'defectAnalysis failed');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function runGenerateTraveler() {
    setBusy('traveler');
    setError(null);
    try {
      if (!partNumber.trim()) {
        setError('Part number required.');
        return;
      }
      const steps = splitSteps(travelerSteps);
      const res = await lensRun('manufacturing', 'generateTraveler', {
        partNumber: partNumber.trim(),
        quantity: Number(quantity) || 1,
        steps,
      });
      if (res.data?.ok) setTravelerResult(res.data.result as TravelerResult);
      else setError(res.data?.error || 'generateTraveler failed');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function runLogDowntime() {
    setBusy('downtime');
    setError(null);
    try {
      if (!machine.trim()) {
        setError('Machine name required.');
        return;
      }
      const res = await lensRun('manufacturing', 'logDowntime', {
        machine: machine.trim(),
        reason: reason.trim() || 'unplanned',
        durationMinutes: Number(durationMinutes) || 0,
        plannedTime: Number(plannedTime) || 480,
      });
      if (res.data?.ok) setDowntimeResult(res.data.result as DowntimeResult);
      else setError(res.data?.error || 'logDowntime failed');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  function updateDefect(i: number, field: keyof DefectRow, value: string) {
    setDefects((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  }
  function addDefectRow() {
    setDefects((prev) => [...prev, { type: '', severity: 'minor' }]);
  }
  function removeDefectRow(i: number) {
    setDefects((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-zinc-200">Work-order execution tools</h3>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Advance step */}
        <div className={card}>
          <header className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-cyan-400" />
            <span className="text-xs uppercase font-semibold text-zinc-300 tracking-wider">Advance routing step</span>
          </header>
          <Field label="Work order">
            <input className={inputCls} value={woTitle} onChange={(e) => setWoTitle(e.target.value)} placeholder="WO-1042" />
          </Field>
          <Field label="Routing steps (comma-separated)">
            <input className={inputCls} value={stepNames} onChange={(e) => setStepNames(e.target.value)} placeholder="Cut, Weld, Paint, Inspect" />
          </Field>
          <Field label="Current step index">
            <input type="number" className={inputCls} value={currentStep} onChange={(e) => setCurrentStep(e.target.value)} min={0} />
          </Field>
          <button className={btnPrimary} disabled={busy === 'step'} onClick={runAdvanceStep}>
            {busy === 'step' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListChecks className="w-3.5 h-3.5" />} Advance
          </button>
          {stepResult && (
            <div className="text-xs space-y-1 pt-1 border-t border-zinc-800">
              <p className="text-zinc-300">
                Step <span className="text-cyan-300 font-mono">{stepResult.currentStep}/{stepResult.totalSteps}</span> · {stepResult.status.replace(/_/g, ' ')} · <span className="text-green-400 font-mono">{stepResult.percentComplete}%</span>
              </p>
              {stepResult.currentStepName && (
                <p className="text-zinc-400">Now: {stepResult.currentStepName}{stepResult.nextStepName ? ` → next: ${stepResult.nextStepName}` : ''}</p>
              )}
            </div>
          )}
        </div>

        {/* Defect analysis */}
        <div className={card}>
          <header className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-xs uppercase font-semibold text-zinc-300 tracking-wider">Defect analysis</span>
          </header>
          {defects.map((d, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_auto] gap-1.5">
              <input className={inputCls} value={d.type} onChange={(e) => updateDefect(i, 'type', e.target.value)} placeholder="Defect type (e.g. scratch)" />
              <select className={inputCls} value={d.severity} onChange={(e) => updateDefect(i, 'severity', e.target.value)}>
                <option value="minor">minor</option>
                <option value="major">major</option>
                <option value="critical">critical</option>
              </select>
              <button aria-label="Remove defect row" className="p-1 text-rose-400 disabled:opacity-30" disabled={defects.length <= 1} onClick={() => removeDefectRow(i)}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button onClick={addDefectRow} className="text-xs text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add defect
          </button>
          <Field label="Units inspected (optional — defaults to defect count)">
            <input type="number" className={inputCls} value={inspected} onChange={(e) => setInspected(e.target.value)} placeholder="100" />
          </Field>
          <button className={btnPrimary} disabled={busy === 'defect'} onClick={runDefectAnalysis}>
            {busy === 'defect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />} Analyze
          </button>
          {defectResult && (
            <div className="text-xs space-y-1 pt-1 border-t border-zinc-800">
              <p className="text-zinc-300">
                {defectResult.defectCount}/{defectResult.inspected} · rate{' '}
                <span className={cn('font-mono', defectResult.defectRatePct > 5 ? 'text-red-400' : defectResult.defectRatePct > 1 ? 'text-amber-400' : 'text-green-400')}>
                  {defectResult.defectRatePct}%
                </span>{' '}
                · risk {defectResult.riskLevel}
              </p>
              {defectResult.topDefect && <p className="text-zinc-400">Top defect: {defectResult.topDefect}</p>}
            </div>
          )}
        </div>

        {/* Traveler */}
        <div className={card}>
          <header className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-neon-purple" />
            <span className="text-xs uppercase font-semibold text-zinc-300 tracking-wider">Generate routing traveler</span>
          </header>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Part number">
              <input className={inputCls} value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder="HA-400" />
            </Field>
            <Field label="Quantity">
              <input type="number" className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} min={1} />
            </Field>
          </div>
          <Field label="Routing steps (comma-separated)">
            <input className={inputCls} value={travelerSteps} onChange={(e) => setTravelerSteps(e.target.value)} placeholder="Cut, Weld, Paint, Inspect" />
          </Field>
          <button className={btnPrimary} disabled={busy === 'traveler'} onClick={runGenerateTraveler}>
            {busy === 'traveler' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} Generate
          </button>
          {travelerResult && (
            <pre className="text-[10px] text-zinc-300 font-mono bg-zinc-900 rounded p-2 overflow-auto max-h-40 whitespace-pre">{travelerResult.content}</pre>
          )}
        </div>

        {/* Downtime */}
        <div className={card}>
          <header className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-amber-400" />
            <span className="text-xs uppercase font-semibold text-zinc-300 tracking-wider">Log machine downtime</span>
          </header>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Machine">
              <input className={inputCls} value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="CNC-03" />
            </Field>
            <Field label="Reason">
              <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="tooling change" />
            </Field>
            <Field label="Duration (min)">
              <input type="number" className={inputCls} value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} min={0} />
            </Field>
            <Field label="Planned shift (min)">
              <input type="number" className={inputCls} value={plannedTime} onChange={(e) => setPlannedTime(e.target.value)} min={1} />
            </Field>
          </div>
          <button className={btnPrimary} disabled={busy === 'downtime'} onClick={runLogDowntime}>
            {busy === 'downtime' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Timer className="w-3.5 h-3.5" />} Log downtime
          </button>
          {downtimeResult && (
            <div className="text-xs space-y-1 pt-1 border-t border-zinc-800">
              <p className="text-zinc-300">
                <span className="text-cyan-300 font-mono">{downtimeResult.downtimeId}</span> · {downtimeResult.machine} · {downtimeResult.reason}
              </p>
              <p className="text-zinc-400">
                {downtimeResult.durationMinutes} min · availability impact{' '}
                <span className="text-amber-400 font-mono">{downtimeResult.availabilityImpactPct}%</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ShopFloorToolsPanel;
