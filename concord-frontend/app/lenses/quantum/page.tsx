'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Atom, Zap, Play, Loader2, Layers, ChevronDown, X, StepForward,
  StepBack, Save, FolderOpen, Trash2, Download, Upload, Sparkles,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { QuantumArxiv } from '@/components/quantum/QuantumArxiv';
import { ChartKit } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import {
  CircuitComposer, type GateDef, type PlacedGate,
} from '@/components/quantum/CircuitComposer';
import { BlochSphere, type BlochVector } from '@/components/quantum/BlochSphere';

interface ProbEntry { state: string; probability: number; amplitude?: { re: number; im: number } }
interface SimResult {
  qubits: number;
  gatesApplied: number;
  circuitDepth: number;
  statevector: ProbEntry[];
  measurements: { shots: number; counts: Record<string, number> };
  bloch: BlochVector[];
  entropy: number;
  maxEntanglement: boolean;
}
interface StepFrame { step: number; gate: string; statevector: ProbEntry[]; bloch: BlochVector[] }
interface AnalysisResult {
  totalGates: number; circuitDepth: number; tCount: number; cnotCount: number;
  cliffordCount: number; nonCliffordCount: number; parallelism: number;
  avgUtilization: number; faultToleranceCost: string;
  gateCounts: Record<string, number>;
}
interface ErrorResult {
  preset: string; fidelityPercent: number; quality: string;
  errorBudget: {
    gateErrors: { contribution: number };
    decoherence: { contribution: number; executionTimeUs: number };
    readout: { contribution: number };
    totalError: number;
  };
  recommendations: string[];
}
interface SavedCircuitMeta { id: string; name: string; qubits: number; gateCount: number; updatedAt: string }
interface NoisePreset { id: string; label: string; t1: number; t2: number; gateErrorRate: number; readoutError: number }
interface ApiCircuit { qubits: number; gates: Array<{ gate: string; targets?: number[]; controls?: number[]; params?: { theta: number } }> }

// Convert PlacedGate[] → the { qubits, gates } shape the simulator wants.
function buildCircuit(qubits: number, placed: PlacedGate[]): ApiCircuit {
  return {
    qubits,
    gates: [...placed]
      .sort((a, b) => a.column - b.column)
      .map((g) => ({ gate: g.gate, targets: g.targets, controls: g.controls, params: g.params })),
  };
}

// Convert an API circuit back into placed gates laid out column by column.
function circuitToPlaced(circuit: ApiCircuit): PlacedGate[] {
  return (circuit.gates || []).map((g, i) => ({
    uid: `load_${i}_${Date.now().toString(36)}`,
    gate: String(g.gate || '').toUpperCase(),
    column: i,
    targets: Array.isArray(g.targets) ? g.targets : [],
    controls: Array.isArray(g.controls) ? g.controls : [],
    params: g.params,
  }));
}

const TEMPLATES: { id: string; label: string }[] = [
  { id: 'bell', label: 'Bell pair' },
  { id: 'ghz', label: 'GHZ state' },
  { id: 'qft', label: 'QFT' },
  { id: 'grover', label: 'Grover search' },
  { id: 'teleport', label: 'Teleportation' },
  { id: 'deutsch', label: 'Deutsch-Jozsa' },
  { id: 'superposition', label: 'Superposition' },
];

export default function QuantumLensPage() {
  useLensNav('quantum');

  const [qubits, setQubits] = useState(2);
  const [placed, setPlaced] = useState<PlacedGate[]>([]);
  const [gateLib, setGateLib] = useState<GateDef[]>([]);
  const [noisePresets, setNoisePresets] = useState<NoisePreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('ideal');

  const [sim, setSim] = useState<SimResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [errAnalysis, setErrAnalysis] = useState<ErrorResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // step-through state
  const [frames, setFrames] = useState<StepFrame[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);

  // saved circuits
  const [saved, setSaved] = useState<SavedCircuitMeta[]>([]);
  const [qasm, setQasm] = useState('');
  const [showFeatures, setShowFeatures] = useState(false);

  const circuit = useMemo(() => buildCircuit(qubits, placed), [qubits, placed]);

  const refreshSaved = useCallback(async () => {
    const r = await lensRun('quantum', 'listCircuits', {});
    if (r.data?.ok && r.data.result) {
      setSaved((r.data.result as { circuits: SavedCircuitMeta[] }).circuits || []);
    }
  }, []);

  // initial load: gate library, noise presets, saved circuits
  useEffect(() => {
    (async () => {
      const lib = await lensRun('quantum', 'gateLibrary', {});
      if (lib.data?.ok && lib.data.result) {
        setGateLib((lib.data.result as { gates: GateDef[] }).gates || []);
      }
      const np = await lensRun('quantum', 'noisePresets', {});
      if (np.data?.ok && np.data.result) {
        setNoisePresets((np.data.result as { presets: NoisePreset[] }).presets || []);
      }
      await refreshSaved();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(async (action: string, input: Record<string, unknown>) => {
    setBusy(action);
    setError(null);
    try {
      const r = await lensRun('quantum', action, input);
      if (!r.data?.ok) { setError(r.data?.error || `${action} failed`); return null; }
      return r.data.result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  const handleSimulate = useCallback(async () => {
    const res = await run('simulateCircuit', { circuit, shots: 1024 });
    if (res) { setSim(res as SimResult); setFrames([]); }
  }, [circuit, run]);

  const handleAnalyze = useCallback(async () => {
    const res = await run('analyzeCircuit', { circuit });
    if (res) setAnalysis(res as AnalysisResult);
  }, [circuit, run]);

  const handleErrorAnalysis = useCallback(async () => {
    const res = await run('errorAnalysis', { circuit, preset: selectedPreset });
    if (res) setErrAnalysis(res as ErrorResult);
  }, [circuit, run, selectedPreset]);

  const handleStepThrough = useCallback(async () => {
    const res = await run('stepCircuit', { circuit });
    if (res) {
      setFrames((res as { frames: StepFrame[] }).frames || []);
      setFrameIdx(0);
      setSim(null);
    }
  }, [circuit, run]);

  const handleTemplate = useCallback(async (id: string) => {
    const res = await run('algorithmTemplate', { template: id, qubits });
    if (res) {
      const c = (res as { circuit: ApiCircuit }).circuit;
      setQubits(c.qubits);
      setPlaced(circuitToPlaced(c));
      setSim(null); setFrames([]); setAnalysis(null); setErrAnalysis(null);
    }
  }, [run, qubits]);

  const handleSave = useCallback(async () => {
    const name = window.prompt('Name this circuit', `Circuit ${new Date().toISOString().slice(0, 16)}`);
    if (!name) return;
    const res = await run('saveCircuit', { circuit, name });
    if (res) await refreshSaved();
  }, [circuit, run, refreshSaved]);

  const handleLoad = useCallback(async (id: string) => {
    const res = await run('loadCircuit', { id });
    if (res) {
      const c = (res as { circuit: ApiCircuit }).circuit;
      setQubits(c.qubits);
      setPlaced(circuitToPlaced(c));
      setSim(null); setFrames([]);
    }
  }, [run]);

  const handleDelete = useCallback(async (id: string) => {
    const res = await run('deleteCircuit', { id });
    if (res) await refreshSaved();
  }, [run, refreshSaved]);

  const handleExportQASM = useCallback(async () => {
    const res = await run('exportQASM', { circuit });
    if (res) setQasm((res as { qasm: string }).qasm || '');
  }, [circuit, run]);

  const handleImportQASM = useCallback(async () => {
    if (!qasm.trim()) { setError('Paste OpenQASM source first.'); return; }
    const res = await run('importQASM', { qasm });
    if (res) {
      const c = (res as { circuit: ApiCircuit }).circuit;
      setQubits(c.qubits);
      setPlaced(circuitToPlaced(c));
      setSim(null); setFrames([]);
    }
  }, [qasm, run]);

  useLensCommand(
    [
      { id: 'run', keys: 'mod+enter', description: 'Simulate circuit', category: 'actions',
        action: () => { if (!busy) handleSimulate(); }, global: true },
      { id: 'step', keys: 'mod+shift+enter', description: 'Step-through execution', category: 'actions',
        action: () => { if (!busy) handleStepThrough(); } },
      { id: 'save', keys: 'mod+s', description: 'Save circuit', category: 'actions',
        action: () => { if (!busy) handleSave(); } },
    ],
    { lensId: 'quantum' },
  );

  // ── histogram data from the active result / step frame ──────────────
  const activeFrame = frames.length > 0 ? frames[frameIdx] : null;
  const histProbs: ProbEntry[] = activeFrame
    ? activeFrame.statevector
    : (sim ? sim.statevector : []);
  const histData = histProbs
    .slice(0, 16)
    .map((p) => ({ state: `|${p.state}⟩`, probability: Math.round(p.probability * 10000) / 100 }));
  const activeBloch: BlochVector[] = activeFrame ? activeFrame.bloch : (sim ? sim.bloch : []);

  // measurement-shot counts as a second chart series
  const shotData = sim
    ? Object.entries(sim.measurements.counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([state, count]) => ({ state: `|${state}⟩`, count }))
    : [];

  return (
    <LensShell lensId="quantum" asMain={false}>
      <FirstRunTour lensId="quantum" />
      <ManifestActionBar />
      <DepthBadge lensId="quantum" size="sm" className="ml-2" />
      <LensVerticalHero lensId="quantum" className="mx-6 mt-4" />

      <div data-lens-theme="quantum" className="p-6 space-y-6">
        <ArxivPanel domain="quantum" title="arXiv · Quantum Physics (quant-ph)" />

        <header className="flex items-center gap-3">
          <Atom className="w-7 h-7 text-neon-purple" />
          <div>
            <h1 className="text-xl font-bold">Quantum Composer</h1>
            <p className="text-sm text-gray-400">
              Visual circuit composer + real state-vector simulator
            </p>
          </div>
        </header>

        {error && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            <span>{error}</span>
            <button aria-label="Dismiss" onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* ── Visual circuit composer ───────────────────────────── */}
        <div className="panel p-4 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Atom className="w-4 h-4 text-neon-purple" /> Circuit Composer
          </h2>
          {gateLib.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading gate library…
            </div>
          ) : (
            <CircuitComposer
              gateLibrary={gateLib}
              qubits={qubits}
              onQubitsChange={(n) => { setQubits(n); setSim(null); setFrames([]); }}
              placed={placed}
              onPlacedChange={(g) => { setPlaced(g); setSim(null); setFrames([]); }}
            />
          )}

          {/* algorithm templates */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 mr-1 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Templates
            </span>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTemplate(t.id)}
                disabled={!!busy}
                className="px-2 py-1 rounded text-xs border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-40"
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* run controls */}
          <div className="flex flex-wrap gap-2">
            <button onClick={handleSimulate} disabled={!!busy || placed.length === 0}
              className="btn-neon purple flex items-center gap-1.5 disabled:opacity-40">
              {busy === 'simulateCircuit'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Play className="w-4 h-4" />}
              Run Simulation
            </button>
            <button onClick={handleStepThrough} disabled={!!busy || placed.length === 0}
              className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
              {busy === 'stepCircuit'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <StepForward className="w-4 h-4" />}
              Step-Through
            </button>
            <button onClick={handleAnalyze} disabled={!!busy || placed.length === 0}
              className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
              <Zap className="w-4 h-4" /> Analyze
            </button>
            <button onClick={handleSave} disabled={!!busy || placed.length === 0}
              className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
              <Save className="w-4 h-4" /> Save
            </button>
          </div>
        </div>

        {/* ── Step-through navigator ─────────────────────────────── */}
        {frames.length > 0 && activeFrame && (
          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <StepForward className="w-4 h-4 text-neon-cyan" /> Step-Through Execution
              </h2>
              <span className="text-xs text-gray-400 font-mono">
                Step {activeFrame.step} / {frames.length - 1}
                {' · '}<span className="text-neon-cyan">{activeFrame.gate}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setFrameIdx((i) => Math.max(0, i - 1))}
                disabled={frameIdx === 0}
                className="btn-neon flex items-center gap-1 disabled:opacity-40">
                <StepBack className="w-4 h-4" /> Prev
              </button>
              <input
                type="range" min={0} max={frames.length - 1} value={frameIdx}
                onChange={(e) => setFrameIdx(Number(e.target.value))}
                className="flex-1"
              />
              <button onClick={() => setFrameIdx((i) => Math.min(frames.length - 1, i + 1))}
                disabled={frameIdx === frames.length - 1}
                className="btn-neon flex items-center gap-1 disabled:opacity-40">
                Next <StepForward className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Probability histogram + Bloch readout ──────────────── */}
        {(sim || activeFrame) && (
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="panel p-4 lg:col-span-2 space-y-3">
              <h2 className="font-semibold flex items-center gap-2">
                <Layers className="w-4 h-4 text-neon-purple" />
                State Probabilities {activeFrame ? `(step ${activeFrame.step})` : ''}
              </h2>
              <ChartKit
                kind="bar"
                data={histData}
                xKey="state"
                series={[{ key: 'probability', label: 'Probability %', color: '#a855f7' }]}
                height={240}
                showLegend={false}
              />
              {sim && (
                <div className="flex flex-wrap gap-4 text-xs text-gray-400 pt-1">
                  <span>Qubits <span className="text-neon-purple font-mono">{sim.qubits}</span></span>
                  <span>Gates <span className="text-white font-mono">{sim.gatesApplied}</span></span>
                  <span>Depth <span className="text-neon-cyan font-mono">{sim.circuitDepth}</span></span>
                  <span>Entropy <span className="text-neon-cyan font-mono">{sim.entropy}</span></span>
                  <span className={sim.maxEntanglement ? 'text-neon-purple' : 'text-gray-400'}>
                    {sim.maxEntanglement ? 'High entanglement' : 'Low entanglement'}
                  </span>
                </div>
              )}
            </div>

            {/* Bloch spheres */}
            <div className="panel p-4 space-y-2">
              <h2 className="font-semibold flex items-center gap-2">
                <Atom className="w-4 h-4 text-neon-cyan" /> Bloch Spheres
              </h2>
              <div className="grid grid-cols-2 gap-2">
                {activeBloch.map((bv) => (
                  <BlochSphere key={bv.qubit} vector={bv} size={110} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Amplitude readout + measurement shots ──────────────── */}
        {(sim || activeFrame) && (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="panel p-4 space-y-2">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Layers className="w-4 h-4 text-neon-purple" /> Amplitude Readout
              </h2>
              <div className="space-y-1 font-mono text-xs">
                {histProbs.slice(0, 12).map((p) => (
                  <div key={p.state} className="flex items-center gap-2">
                    <span className="text-neon-cyan w-16 shrink-0">|{p.state}⟩</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-neon-purple/70 rounded-full"
                        style={{ width: `${p.probability * 100}%` }} />
                    </div>
                    <span className="text-neon-purple w-12 text-right">
                      {(p.probability * 100).toFixed(1)}%
                    </span>
                    {p.amplitude && (
                      <span className="text-gray-400 w-28 text-right">
                        {p.amplitude.re.toFixed(3)}
                        {p.amplitude.im >= 0 ? '+' : ''}{p.amplitude.im.toFixed(3)}i
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {sim && shotData.length > 0 && (
              <div className="panel p-4 space-y-2">
                <h2 className="font-semibold text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-neon-green" />
                  Measurement Shots ({sim.measurements.shots})
                </h2>
                <ChartKit
                  kind="bar"
                  data={shotData}
                  xKey="state"
                  series={[{ key: 'count', label: 'Counts', color: '#22c55e' }]}
                  height={200}
                  showLegend={false}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Circuit analysis ───────────────────────────────────── */}
        {analysis && (
          <div className="panel p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-neon-purple" /> Circuit Analysis
              </h2>
              <button aria-label="Close" onClick={() => setAnalysis(null)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                ['Total gates', analysis.totalGates],
                ['Depth', analysis.circuitDepth],
                ['T-count', analysis.tCount],
                ['CNOT count', analysis.cnotCount],
                ['Clifford', analysis.cliffordCount],
                ['Non-Clifford', analysis.nonCliffordCount],
                ['Parallelism', analysis.parallelism],
                ['Avg utilization', `${analysis.avgUtilization}%`],
              ].map(([label, val]) => (
                <div key={String(label)} className="bg-black/30 rounded p-2">
                  <p className="text-gray-400">{label}</p>
                  <p className="font-mono text-neon-cyan text-base">{String(val)}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400">
              Fault tolerance:{' '}
              <span className={analysis.faultToleranceCost.includes('Clifford-only')
                ? 'text-green-400' : 'text-yellow-400'}>
                {analysis.faultToleranceCost}
              </span>
            </p>
          </div>
        )}

        {/* ── Noise model + error analysis ───────────────────────── */}
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-green" /> Noise Model &amp; Error Analysis
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-gray-200"
            >
              {noisePresets.map((np) => (
                <option key={np.id} value={np.id}>{np.label}</option>
              ))}
            </select>
            <button onClick={handleErrorAnalysis} disabled={!!busy || placed.length === 0}
              className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
              {busy === 'errorAnalysis'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Zap className="w-4 h-4" />}
              Run Error Analysis
            </button>
          </div>
          {(() => {
            const np = noisePresets.find((p) => p.id === selectedPreset);
            return np ? (
              <p className="text-[11px] text-gray-400 font-mono">
                T1 {np.t1}µs · T2 {np.t2}µs · gate err {np.gateErrorRate} · readout err {np.readoutError}
              </p>
            ) : null;
          })()}
          {errAnalysis && (
            <div className="bg-black/30 rounded-lg p-3 space-y-2 text-xs">
              <div className="flex flex-wrap gap-4">
                <span>Preset <span className="text-white">{errAnalysis.preset}</span></span>
                <span>Fidelity{' '}
                  <span className={`font-mono font-bold ${
                    errAnalysis.fidelityPercent > 95 ? 'text-green-400'
                      : errAnalysis.fidelityPercent > 80 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {errAnalysis.fidelityPercent}%
                  </span>
                </span>
                <span>Quality <span className="text-white capitalize">{errAnalysis.quality}</span></span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['Gate errors', errAnalysis.errorBudget.gateErrors.contribution],
                  ['Decoherence', errAnalysis.errorBudget.decoherence.contribution],
                  ['Readout', errAnalysis.errorBudget.readout.contribution],
                ].map(([label, val]) => (
                  <div key={String(label)} className="bg-black/30 rounded p-2">
                    <p className="text-gray-400">{label}</p>
                    <p className="font-mono text-neon-cyan">{((val as number) * 100).toFixed(3)}%</p>
                  </div>
                ))}
              </div>
              {errAnalysis.recommendations.length > 0 && (
                <div className="space-y-0.5">
                  {errAnalysis.recommendations.map((r, i) => (
                    <p key={i} className="text-yellow-300">⚠ {r}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── QASM import / export ───────────────────────────────── */}
        <div className="panel p-4 space-y-2">
          <h2 className="font-semibold flex items-center gap-2">
            <Download className="w-4 h-4 text-neon-cyan" /> OpenQASM Interop
          </h2>
          <textarea
            value={qasm}
            onChange={(e) => setQasm(e.target.value)}
            placeholder="OpenQASM 2.0 source — Export current circuit, or paste QASM and Import."
            spellCheck={false}
            className="w-full h-32 bg-black/40 border border-white/10 rounded p-2 font-mono text-xs text-gray-200"
          />
          <div className="flex gap-2">
            <button onClick={handleExportQASM} disabled={!!busy || placed.length === 0}
              className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
              <Download className="w-4 h-4" /> Export QASM
            </button>
            <button onClick={handleImportQASM} disabled={!!busy}
              className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
              <Upload className="w-4 h-4" /> Import QASM
            </button>
          </div>
        </div>

        {/* ── Saved circuits ─────────────────────────────────────── */}
        <div className="panel p-4 space-y-2">
          <h2 className="font-semibold flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-neon-green" /> Saved Circuits
          </h2>
          {saved.length === 0 ? (
            <p className="text-xs text-gray-400">No saved circuits yet — compose one and click Save.</p>
          ) : (
            <div className="space-y-1.5">
              {saved.map((sc) => (
                <div key={sc.id}
                  className="flex items-center justify-between p-2 bg-black/30 rounded-lg">
                  <div className="text-xs">
                    <p className="text-white font-medium">{sc.name}</p>
                    <p className="text-gray-400 font-mono">
                      {sc.qubits} qubits · {sc.gateCount} gates ·{' '}
                      {new Date(sc.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => handleLoad(sc.id)}
                      className="p-1.5 rounded bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/20"
                      title="Load">
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(sc.id)}
                      className="p-1.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
                      title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lens features */}
        <div className="border-t border-white/10">
          <button
            onClick={() => setShowFeatures(!showFeatures)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
          >
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4" /> Lens Features &amp; Capabilities
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence>
            {showFeatures && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4">
                  <LensFeaturePanel lensId="quantum" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <section className="mt-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <QuantumArxiv />
        </section>
      </div>

      <a href="#quantum-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
        Skip to quantum content
      </a>
      <RecentMineCard domain="quantum" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="quantum" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="quantum" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
