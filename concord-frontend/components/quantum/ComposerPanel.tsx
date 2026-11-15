'use client';

/**
 * ComposerPanel — visual circuit composer + simulator/analysis/QASM/saved.
 * Extracted from lenses/quantum/page.tsx. Preserves all quantum.* macros.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Atom, Zap, Play, Loader2, Layers, X, StepForward,
  StepBack, Save, FolderOpen, Trash2, Download, Upload, Sparkles, Copy, Check, Pencil,
} from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensState } from '@/hooks/useLensState';
import { ChartKit } from '@/components/viz';
import { lensRun } from '@/lib/api/client';
import {
  CircuitComposer, type GateDef, type PlacedGate,
} from '@/components/quantum/CircuitComposer';
import { BlochSphere, type BlochVector } from '@/components/quantum/BlochSphere';
import {
  type ProbEntry, type SimResult, type StepFrame, type AnalysisResult,
  type ErrorResult, type SavedCircuitMeta, type NoisePreset, type ApiCircuit,
  buildCircuit, circuitToPlaced, TEMPLATES,
  QUANTUM_NEW_CIRCUIT_EVENT, QUANTUM_NEW_CIRCUIT_PENDING_KEY,
} from '@/components/quantum/quantum-shared';

export function ComposerPanel() {
  // Working-circuit draft (F1's second half): the error boundary's
  // recovery copy promises the working circuit survives a recovery, but
  // the circuit lived only in mount-scoped state, so "Try again"
  // remounted to the empty default. The draft now rides the lens-state
  // store's customState bag — restored synchronously on mount, saved on
  // every change — so a boundary remount (or a view switch) restores
  // the circuit exactly as composed.
  const { restored, save: saveLensState } = useLensState('quantum');
  const draft = restored?.customState?.composerDraft as
    | { qubits: number; placed: PlacedGate[] }
    | undefined;
  const [qubits, setQubits] = useState(draft?.qubits ?? 2);
  const [placed, setPlaced] = useState<PlacedGate[]>(draft?.placed ?? []);
  const [gateLib, setGateLib] = useState<GateDef[]>([]);
  const [noisePresets, setNoisePresets] = useState<NoisePreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('ideal');

  const [sim, setSim] = useState<SimResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [errAnalysis, setErrAnalysis] = useState<ErrorResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [frames, setFrames] = useState<StepFrame[]>([]);
  const [frameIdx, setFrameIdx] = useState(0);

  const [saved, setSaved] = useState<SavedCircuitMeta[]>([]);
  const [qasm, setQasm] = useState('');

  // Save runs off an inline name field, not window.prompt (F4): the
  // native dialog never returned a name in the product shell, so the
  // old handler returned silently before saveCircuit was ever called.
  const [saveName, setSaveName] = useState('');
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // Saved-row delete arms first and names the circuit (the S3 guard).
  const [confirmDelete, setConfirmDelete] = useState<SavedCircuitMeta | null>(null);
  // "New circuit" with gates on the canvas asks first (F5's guard).
  const [confirmNew, setConfirmNew] = useState(false);

  // Persist the working circuit as the lens draft on every change.
  useEffect(() => {
    saveLensState({ customState: { composerDraft: { qubits, placed } } });
  }, [qubits, placed, saveLensState]);

  const circuit = useMemo(() => buildCircuit(qubits, placed), [qubits, placed]);

  const refreshSaved = useCallback(async () => {
    const r = await lensRun('quantum', 'listCircuits', {});
    if (r.data?.ok && r.data.result) {
      setSaved((r.data.result as { circuits: SavedCircuitMeta[] }).circuits || []);
    }
  }, []);

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
    // The name comes from the inline field in the Saved Circuits panel;
    // blank falls back to a timestamped name. No native dialog (F4).
    const name = saveName.trim() || `Circuit ${new Date().toISOString().slice(0, 16)}`;
    const res = await run('saveCircuit', { circuit, name });
    if (res) {
      setSavedNote(name);
      setSaveName('');
      await refreshSaved();
    }
  }, [circuit, run, refreshSaved, saveName]);

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

  // FIX-quantum-004: saved circuits gain an inline rename.
  const [renaming, setRenaming] = useState<SavedCircuitMeta | null>(null);
  const [renameText, setRenameText] = useState('');
  const handleRename = useCallback(async () => {
    if (!renaming || !renameText.trim()) return;
    const res = await run('renameCircuit', { id: renaming.id, name: renameText.trim() });
    if (res) { setRenaming(null); await refreshSaved(); }
  }, [run, refreshSaved, renaming, renameText]);

  const handleExportQASM = useCallback(async () => {
    const res = await run('exportQASM', { circuit });
    if (res) setQasm((res as { qasm: string }).qasm || '');
  }, [circuit, run]);

  // FIX-quantum-005: the exported QASM used to land in the textarea
  // and stop there — no way to take the file out of the lens. Copy
  // puts the exact source on the clipboard with a visible confirm.
  const [qasmCopied, setQasmCopied] = useState(false);
  const handleCopyQASM = useCallback(async () => {
    if (!qasm.trim()) return;
    try {
      await navigator.clipboard.writeText(qasm);
      setQasmCopied(true);
      setTimeout(() => setQasmCopied(false), 2000);
    } catch {
      setError('Copy failed — select the QASM text and copy it manually.');
    }
  }, [qasm]);

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

  // "New circuit" (F5): the page CTA used to only switch to the
  // Composer view — on the Composer view itself it did nothing at all.
  // It now reaches the panel (window event, or the pending flag when
  // the panel was unmounted) and performs a real fresh-circuit action,
  // guarded when the current circuit has gates that would be lost.
  const doNewCircuit = useCallback(() => {
    setPlaced([]);
    setQubits(2);
    setSim(null);
    setFrames([]);
    setFrameIdx(0);
    setAnalysis(null);
    setErrAnalysis(null);
    setConfirmNew(false);
  }, []);

  const handleNewCircuitRequest = useCallback(() => {
    try { sessionStorage.removeItem(QUANTUM_NEW_CIRCUIT_PENDING_KEY); } catch { /* storage unavailable */ }
    if (placed.length > 0) setConfirmNew(true);
    else doNewCircuit();
  }, [placed.length, doNewCircuit]);

  useEffect(() => {
    let pending = false;
    try { pending = sessionStorage.getItem(QUANTUM_NEW_CIRCUIT_PENDING_KEY) === '1'; } catch { /* storage unavailable */ }
    if (pending) handleNewCircuitRequest();
    window.addEventListener(QUANTUM_NEW_CIRCUIT_EVENT, handleNewCircuitRequest);
    return () => window.removeEventListener(QUANTUM_NEW_CIRCUIT_EVENT, handleNewCircuitRequest);
  }, [handleNewCircuitRequest]);

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

  const activeFrame = frames.length > 0 ? frames[frameIdx] : null;
  // F1/F2: the render path reads the result defensively. Run crashed
  // the whole lens on `sim.measurements.counts` and Analyze on
  // `analysis.faultToleranceCost.includes` whenever a result arrived
  // without those fields — one undefined read took the lens to the
  // error boundary. A partial result now degrades to an empty render;
  // the verb contracts themselves are pinned by tests at both ends.
  const histProbs: ProbEntry[] = activeFrame
    ? activeFrame.statevector
    : (sim ? (sim.statevector ?? []) : []);
  const histData = histProbs
    .slice(0, 16)
    .map((p) => ({ state: `|${p.state}⟩`, probability: Math.round(p.probability * 10000) / 100 }));
  const activeBloch: BlochVector[] = activeFrame ? activeFrame.bloch : (sim ? (sim.bloch ?? []) : []);
  const shotData = sim
    ? Object.entries(sim.measurements?.counts ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(([state, count]) => ({ state: `|${state}⟩`, count }))
    : [];

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          <span>{error}</span>
          <button aria-label="Dismiss" onClick={() => setError(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {confirmNew && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
          <span>
            Start a new circuit? The current circuit ({placed.length} gate{placed.length === 1 ? '' : 's'}) will be
            cleared. Saved circuits are not affected.
          </span>
          <span className="ml-auto flex gap-1.5">
            <button onClick={doNewCircuit}
              className="px-2.5 py-1 rounded bg-amber-500/80 text-white font-semibold hover:bg-amber-500">
              Start new
            </button>
            <button onClick={() => setConfirmNew(false)}
              className="px-2.5 py-1 rounded border border-zinc-600 text-zinc-200 hover:text-white">
              Keep working
            </button>
          </span>
        </div>
      )}

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

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 mr-1 flex items-center gap-1">
            <Sparkles className="w-3 h-3" /> Templates
          </span>
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => handleTemplate(t.id)} disabled={!!busy}
              className="px-2 py-1 rounded text-xs border border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 disabled:opacity-40">
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={handleSimulate} disabled={!!busy || placed.length === 0}
            className="btn-neon purple flex items-center gap-1.5 disabled:opacity-40">
            {busy === 'simulateCircuit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run Simulation
          </button>
          <button onClick={handleStepThrough} disabled={!!busy || placed.length === 0}
            className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
            {busy === 'stepCircuit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <StepForward className="w-4 h-4" />}
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

      {frames.length > 0 && activeFrame && (
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <StepForward className="w-4 h-4 text-neon-cyan" /> Step-Through Execution
            </h2>
            <span className="flex items-center gap-2 text-xs text-gray-400 font-mono">
              Step {activeFrame.step} / {frames.length - 1}
              {' · '}<span className="text-neon-cyan">{activeFrame.gate}</span>
              <button aria-label="Close step-through" onClick={() => { setFrames([]); setFrameIdx(0); }}
                className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setFrameIdx((i) => Math.max(0, i - 1))} disabled={frameIdx === 0}
              className="btn-neon flex items-center gap-1 disabled:opacity-40">
              <StepBack className="w-4 h-4" /> Prev
            </button>
            <input type="range" min={0} max={frames.length - 1} value={frameIdx}
              onChange={(e) => setFrameIdx(Number(e.target.value))} aria-label="Animation frame" className="flex-1" />
            <button onClick={() => setFrameIdx((i) => Math.min(frames.length - 1, i + 1))}
              disabled={frameIdx === frames.length - 1}
              className="btn-neon flex items-center gap-1 disabled:opacity-40">
              Next <StepForward className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {(sim || activeFrame) && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="panel p-4 lg:col-span-2 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-neon-purple" />
              State Probabilities {activeFrame ? `(step ${activeFrame.step})` : ''}
            </h2>
            <ChartKit kind="bar" data={histData} xKey="state"
              series={[{ key: 'probability', label: 'Probability %', color: '#a855f7' }]}
              height={240} showLegend={false} />
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
                    <div className="h-full bg-neon-purple/70 rounded-full" style={{ width: `${p.probability * 100}%` }} />
                  </div>
                  <span className="text-neon-purple w-12 text-right">{(p.probability * 100).toFixed(1)}%</span>
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
                Measurement Shots ({sim.measurements?.shots ?? 0})
              </h2>
              <ChartKit kind="bar" data={shotData} xKey="state"
                series={[{ key: 'count', label: 'Counts', color: '#22c55e' }]}
                height={200} showLegend={false} />
            </div>
          )}
        </div>
      )}

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
            <span className={(analysis.faultToleranceCost ?? '').includes('Clifford-only') ? 'text-green-400' : 'text-yellow-400'}>
              {analysis.faultToleranceCost ?? 'unknown'}
            </span>
          </p>
        </div>
      )}

      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-green" /> Noise Model &amp; Error Analysis
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={selectedPreset} onChange={(e) => setSelectedPreset(e.target.value)} aria-label="Noise preset"
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-gray-200">
            {noisePresets.map((np) => (
              <option key={np.id} value={np.id}>{np.label}</option>
            ))}
          </select>
          <button onClick={handleErrorAnalysis} disabled={!!busy || placed.length === 0}
            className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
            {busy === 'errorAnalysis' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
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
            {(errAnalysis.recommendations ?? []).length > 0 && (
              <div className="space-y-0.5">
                {(errAnalysis.recommendations ?? []).map((r, i) => (
                  <p key={i} className="text-yellow-300">⚠ {r}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="panel p-4 space-y-2">
        <h2 className="font-semibold flex items-center gap-2">
          <Download className="w-4 h-4 text-neon-cyan" /> OpenQASM Interop
        </h2>
        <textarea value={qasm} onChange={(e) => setQasm(e.target.value)}
          placeholder="OpenQASM 2.0 source — Export current circuit, or paste QASM and Import."
          aria-label="OpenQASM source"
          spellCheck={false}
          className="w-full h-32 bg-black/40 border border-white/10 rounded p-2 font-mono text-xs text-gray-200" />
        <div className="flex gap-2">
          <button onClick={handleExportQASM} disabled={!!busy || placed.length === 0}
            className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
            <Download className="w-4 h-4" /> Export QASM
          </button>
          <button onClick={handleImportQASM} disabled={!!busy}
            className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
            <Upload className="w-4 h-4" /> Import QASM
          </button>
          <button onClick={handleCopyQASM} disabled={!qasm.trim()}
            data-testid="quantum-copy-qasm"
            className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
            {qasmCopied
              ? <><Check className="w-4 h-4" /> Copied</>
              : <><Copy className="w-4 h-4" /> Copy QASM</>}
          </button>
        </div>
      </div>

      <div className="panel p-4 space-y-2">
        <h2 className="font-semibold flex items-center gap-2">
          <FolderOpen className="w-4 h-4 text-neon-green" /> Saved Circuits
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={saveName}
            onChange={(e) => { setSaveName(e.target.value); setSavedNote(null); }}
            placeholder="Name this circuit"
            aria-label="Circuit name"
            className="flex-1 min-w-48 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-100"
          />
          <button onClick={handleSave} disabled={!!busy || placed.length === 0}
            className="btn-neon flex items-center gap-1.5 disabled:opacity-40">
            <Save className="w-4 h-4" /> Save circuit
          </button>
        </div>
        {savedNote && (
          <p className="text-xs text-emerald-300">
            Saved &ldquo;{savedNote}&rdquo; — it is in your list below and will be here when you return.
          </p>
        )}
        {saved.length === 0 ? (
          <p className="text-xs text-gray-400">No saved circuits yet — compose one and click Save.</p>
        ) : (
          <div className="space-y-1.5">
            {saved.map((sc) => (
              <div key={sc.id} className="flex items-center justify-between p-2 bg-black/30 rounded-lg">
                <div className="text-xs">
                  <p className="text-white font-medium">{sc.name}</p>
                  <p className="text-gray-400 font-mono">
                    {sc.qubits} qubits · {sc.gateCount} gates ·{' '}
                    {new Date(sc.updatedAt).toLocaleString()}
                  </p>
                </div>
                {renaming?.id === sc.id ? (
                  <span className="flex items-center gap-1.5 text-xs">
                    <input value={renameText} onChange={(e) => setRenameText(e.target.value)} maxLength={120}
                      className="w-36 rounded border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs text-zinc-100" aria-label="New circuit name" autoFocus />
                    <button onClick={handleRename} disabled={!renameText.trim()}
                      className="px-2 py-1 rounded bg-emerald-600 text-white font-semibold hover:bg-emerald-500 disabled:opacity-40">
                      Save
                    </button>
                    <button onClick={() => setRenaming(null)}
                      className="px-2 py-1 rounded border border-zinc-600 text-zinc-200 hover:text-white">
                      Cancel
                    </button>
                  </span>
                ) : confirmDelete?.id === sc.id ? (
                  <span className="flex items-center gap-1.5 text-xs text-red-300">
                    Delete &ldquo;{sc.name}&rdquo;?
                    <button
                      onClick={async () => { await handleDelete(sc.id); setConfirmDelete(null); }}
                      className="px-2 py-1 rounded bg-red-500/80 text-white font-semibold hover:bg-red-500"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="px-2 py-1 rounded border border-zinc-600 text-zinc-200 hover:text-white"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <div className="flex gap-1">
                    <button onClick={() => handleLoad(sc.id)}
                      className="p-1.5 rounded bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/20"
                      title="Load">
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { setRenaming(sc); setRenameText(sc.name); }}
                      className="p-1.5 rounded bg-zinc-500/10 border border-zinc-500/30 text-zinc-300 hover:bg-zinc-500/20"
                      title="Rename">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setConfirmDelete(sc)}
                      className="p-1.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
                      title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
