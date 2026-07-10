'use client';

/**
 * NeuroTrainPanel — wires the one previously-unsurfaced neuro macro: `train`.
 *
 * Two honest modes, matching exactly what the backend supports (see
 * server/domains/neuro.js#train):
 *  - "Toy dataset": generates a small labelled 2-D point-cloud (two gaussian
 *    clusters, explicitly disclosed as synthetic) and runs REAL logistic-
 *    regression gradient descent against it epoch-by-epoch. `simulated:false`.
 *  - "Projection": no dataset — a deterministic learning-curve projection
 *    derived from the network's own hyperparameters (layers/neurons/samples/
 *    optimizer). The backend itself stamps this `simulated:true` and this
 *    panel never hides that flag from the user.
 */

import { useMemo, useState } from 'react';
import { Play, Loader2, Dna, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

type Optimizer = 'sgd' | 'momentum' | 'rmsprop' | 'adam';
const OPTIMIZERS: { id: Optimizer; label: string }[] = [
  { id: 'sgd', label: 'SGD' },
  { id: 'momentum', label: 'Momentum' },
  { id: 'rmsprop', label: 'RMSprop' },
  { id: 'adam', label: 'Adam' },
];

interface HistoryPoint { epoch: number; loss: number; accuracy: number }
interface TrainedResult {
  mode: 'trained'; simulated: false; optimizer: string; epochs: number; samples: number;
  loss: number; accuracy: number; history: HistoryPoint[]; weights: number[]; bias: number;
}
interface ProjectionResult {
  mode: 'projection'; simulated: true; basis: string; note: string; optimizer: string;
  epochs: number; layers: number; neurons: number; samples: number;
  loss: number; accuracy: number; projectedAccuracyCeiling: number; history: HistoryPoint[];
}
type TrainResult = TrainedResult | ProjectionResult;

// Two gaussian clusters in 2-D feature space — a real, if toy, binary
// classification problem (explicitly labelled synthetic, never presented as
// a real recording or dataset).
function generateToyDataset(n: number, seed: number): { features: number[]; label: number }[] {
  let s = seed || 1;
  const rand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const gauss = () => {
    const u1 = Math.max(rand(), 1e-9), u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const out: { features: number[]; label: number }[] = [];
  for (let i = 0; i < n; i++) {
    const label = i % 2;
    const cx = label ? 1.5 : -1.5;
    const cy = label ? 1.2 : -1.2;
    out.push({ features: [cx + gauss() * 0.7, cy + gauss() * 0.7], label });
  }
  return out;
}

export function NeuroTrainPanel() {
  const [mode, setMode] = useState<'toy' | 'projection'>('toy');
  const [epochs, setEpochs] = useState(40);
  const [learningRate, setLearningRate] = useState(0.3);
  const [optimizer, setOptimizer] = useState<Optimizer>('adam');
  const [sampleCount, setSampleCount] = useState(60);
  const [layers, setLayers] = useState(3);
  const [neurons, setNeurons] = useState(64);
  const [projSamples, setProjSamples] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrainResult | null>(null);
  const [datasetSeed, setDatasetSeed] = useState(7);

  const dataset = useMemo(
    () => (mode === 'toy' ? generateToyDataset(sampleCount, datasetSeed) : []),
    [mode, sampleCount, datasetSeed],
  );

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const input = mode === 'toy'
        ? { epochs, learningRate, optimizer, dataset }
        : { epochs, learningRate, optimizer, layers, neurons, samples: projSamples };
      const res = await lensRun<TrainResult>('neuro', 'train', input);
      if (res.data?.ok && res.data.result) setResult(res.data.result);
      else setError(res.data?.error || 'train failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chartData = result?.history.map(h => ({ epoch: h.epoch, loss: h.loss, accuracy: h.accuracy })) || [];

  return (
    <div className="rounded-lg border border-pink-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-pink-500/10 pb-2">
        <Dna className="h-4 w-4 text-pink-400" />
        <h3 className="text-sm font-semibold text-white">Train a Network</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          neuro.train
        </span>
      </header>

      <div className="flex gap-2">
        <button
          onClick={() => setMode('toy')}
          className={`flex-1 rounded px-2 py-1.5 text-xs border ${mode === 'toy' ? 'bg-pink-500/20 border-pink-500/40 text-pink-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'}`}
        >
          Train on toy dataset
        </button>
        <button
          onClick={() => setMode('projection')}
          className={`flex-1 rounded px-2 py-1.5 text-xs border ${mode === 'projection' ? 'bg-pink-500/20 border-pink-500/40 text-pink-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white'}`}
        >
          Hyperparameter projection
        </button>
      </div>

      {mode === 'toy' ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">Synthetic toy dataset</strong> — two gaussian clusters generated
            client-side, not a real dataset. The training itself is real logistic-regression gradient descent
            run server-side against these points (<code className="font-mono">simulated: false</code>).
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-200">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">No dataset attached.</strong> This mode returns a deterministic
            learning-curve projection derived from the hyperparameters below — the server stamps it{' '}
            <code className="font-mono">simulated: true, basis: &quot;hyperparameter_projection&quot;</code>, never
            a trained result.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 flex flex-col gap-1">
          Epochs: {epochs}
          <input type="range" min={5} max={200} value={epochs} onChange={e => setEpochs(Number(e.target.value))} className="accent-pink-500" />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 flex flex-col gap-1">
          Learning rate: {learningRate}
          <input type="range" min={0.01} max={1} step={0.01} value={learningRate} onChange={e => setLearningRate(Number(e.target.value))} className="accent-pink-500" />
        </label>
        <label className="text-[10px] uppercase tracking-wider text-zinc-400 flex flex-col gap-1">
          Optimizer
          <select value={optimizer} onChange={e => setOptimizer(e.target.value as Optimizer)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white normal-case">
            {OPTIMIZERS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        {mode === 'toy' ? (
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 flex flex-col gap-1">
            Samples: {sampleCount}
            <input type="range" min={10} max={200} step={2} value={sampleCount} onChange={e => setSampleCount(Number(e.target.value))} className="accent-pink-500" />
          </label>
        ) : (
          <label className="text-[10px] uppercase tracking-wider text-zinc-400 flex flex-col gap-1">
            Dataset size (projected): {projSamples}
            <input type="range" min={50} max={5000} step={50} value={projSamples} onChange={e => setProjSamples(Number(e.target.value))} className="accent-pink-500" />
          </label>
        )}
        {mode === 'projection' && (
          <>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 flex flex-col gap-1">
              Layers: {layers}
              <input type="range" min={1} max={24} value={layers} onChange={e => setLayers(Number(e.target.value))} className="accent-pink-500" />
            </label>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400 flex flex-col gap-1">
              Neurons/layer: {neurons}
              <input type="range" min={4} max={1024} step={4} value={neurons} onChange={e => setNeurons(Number(e.target.value))} className="accent-pink-500" />
            </label>
          </>
        )}
        {mode === 'toy' && (
          <button
            onClick={() => setDatasetSeed(s => s + 1)}
            className="text-[10px] uppercase tracking-wider text-zinc-400 hover:text-white border border-zinc-800 rounded px-2 py-1"
          >
            Re-roll dataset
          </button>
        )}
      </div>

      <button
        onClick={run}
        disabled={busy}
        className="flex items-center justify-center gap-1.5 rounded border border-pink-500/40 bg-pink-500/10 px-3 py-1.5 text-xs text-pink-200 hover:bg-pink-500/20 disabled:opacity-40 w-full md:w-auto"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {mode === 'toy' ? 'Train' : 'Project learning curve'}
      </button>

      {error && (
        <p className="rounded border border-red-500/30 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-300">{error}</p>
      )}

      {result && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">Mode</div>
              <div className={result.mode === 'trained' ? 'text-emerald-300 font-semibold' : 'text-sky-300 font-semibold'}>
                {result.mode === 'trained' ? 'Trained (real)' : 'Projection'}
              </div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">Final loss</div>
              <div className="font-mono text-white">{result.loss}</div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">Final accuracy</div>
              <div className="font-mono text-white">{(result.accuracy * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-zinc-500">
                {result.mode === 'trained' ? 'Samples' : 'Ceiling'}
              </div>
              <div className="font-mono text-white">
                {result.mode === 'trained' ? result.samples : `${(result.projectedAccuracyCeiling * 100).toFixed(1)}%`}
              </div>
            </div>
          </div>

          {chartData.length > 1 && (
            <ChartKit
              kind="line"
              data={chartData}
              xKey="epoch"
              series={[
                { key: 'loss', label: 'Loss', color: '#ef4444' },
                { key: 'accuracy', label: 'Accuracy', color: '#22c55e' },
              ]}
              height={200}
            />
          )}

          {result.mode === 'trained' && (
            <p className="text-[10px] text-zinc-400 font-mono">
              weights [{result.weights.join(', ')}] · bias {result.bias}
            </p>
          )}
          {result.mode === 'projection' && (
            <p className="text-[10px] text-zinc-400">{result.note}</p>
          )}
        </div>
      )}
    </div>
  );
}
