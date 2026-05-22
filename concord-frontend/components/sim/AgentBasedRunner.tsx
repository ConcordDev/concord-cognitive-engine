'use client';

/**
 * AgentBasedRunner — runs the `sim.agentBased` runtime for the three built-in
 * agent models (SIR epidemic, Schelling segregation, Lotka-Volterra
 * predator-prey), charts the population/compartment time series, and paints
 * the final agent grid as a spatial scatter heatmap.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Play, RefreshCw, Users, AlertCircle, Grid3x3 } from 'lucide-react';

type AgentKind = 'sir' | 'schelling' | 'predator-prey';

interface AgentPoint { x: number; y: number; state: string }
interface ABMResult {
  kind: string;
  steps: number;
  gridSize: number;
  series: Array<Record<string, number>>;
  agents: AgentPoint[];
  finalState: Record<string, number>;
  peakInfected?: number;
  totalInfected?: number;
  peakPrey?: number;
  peakPredators?: number;
}

const MODEL_META: Record<AgentKind, {
  label: string;
  description: string;
  seriesKeys: Array<{ key: string; label: string; color: string }>;
  stateColors: Record<string, string>;
}> = {
  sir: {
    label: 'SIR Epidemic',
    description: 'Susceptible / Infected / Recovered agents on a toroidal grid. Infection spreads within a radius; agents recover stochastically.',
    seriesKeys: [
      { key: 'susceptible', label: 'Susceptible', color: '#3b82f6' },
      { key: 'infected', label: 'Infected', color: '#ef4444' },
      { key: 'recovered', label: 'Recovered', color: '#22c55e' },
    ],
    stateColors: { S: '#3b82f6', I: '#ef4444', R: '#22c55e' },
  },
  schelling: {
    label: 'Schelling Segregation',
    description: 'Two agent types relocate when their same-type neighbour fraction falls below the happiness threshold — emergent segregation.',
    seriesKeys: [
      { key: 'unhappy', label: 'Unhappy', color: '#f59e0b' },
      { key: 'occupied', label: 'Occupied', color: '#6366f1' },
    ],
    stateColors: { A: '#06b6d4', B: '#ec4899' },
  },
  'predator-prey': {
    label: 'Predator-Prey',
    description: 'Lotka-Volterra agent dynamics: prey breed, predators hunt and starve. Watch the characteristic oscillation.',
    seriesKeys: [
      { key: 'prey', label: 'Prey', color: '#22c55e' },
      { key: 'predators', label: 'Predators', color: '#ef4444' },
    ],
    stateColors: { prey: '#22c55e', predator: '#ef4444' },
  },
};

export function AgentBasedRunner() {
  const [kind, setKind] = useState<AgentKind>('sir');
  const [steps, setSteps] = useState(80);
  const [gridSize, setGridSize] = useState(40);
  const [population, setPopulation] = useState(300);
  const [seed, setSeed] = useState(12345);
  const [infectionRate, setInfectionRate] = useState(0.35);
  const [recoveryRate, setRecoveryRate] = useState(0.08);
  const [threshold, setThreshold] = useState(0.4);
  const [result, setResult] = useState<ABMResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    const params: Record<string, unknown> = { kind, steps, gridSize, seed };
    if (kind === 'sir') {
      params.population = population;
      params.infectionRate = infectionRate;
      params.recoveryRate = recoveryRate;
    } else if (kind === 'schelling') {
      params.threshold = threshold;
    }
    const r = await lensRun<ABMResult>('sim', 'agentBased', params);
    if (r.data.ok && r.data.result) {
      setResult(r.data.result);
    } else {
      setResult(null);
      setError(r.data.error || 'Agent simulation failed.');
    }
    setRunning(false);
  }, [kind, steps, gridSize, seed, population, infectionRate, recoveryRate, threshold]);

  const meta = MODEL_META[kind];
  const cell = result ? Math.max(2, Math.floor(280 / result.gridSize)) : 6;

  return (
    <div className="space-y-4">
      <div className={cn(ds.panel, 'space-y-3')}>
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-400" />
          <h4 className={cn(ds.heading3, 'text-base')}>Agent-Based Model</h4>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MODEL_META) as AgentKind[]).map((k) => (
            <button
              key={k}
              onClick={() => { setKind(k); setResult(null); }}
              className={cn(ds.btnSmall, kind === k ? ds.btnPrimary : ds.btnSecondary)}
            >
              {MODEL_META[k].label}
            </button>
          ))}
        </div>
        <p className={ds.textMuted}>{meta.description}</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className={ds.label}>Steps</label>
            <input type="number" className={ds.input} value={steps}
              onChange={(e) => setSteps(Math.max(1, parseInt(e.target.value) || 1))} />
          </div>
          <div>
            <label className={ds.label}>Grid Size</label>
            <input type="number" className={ds.input} value={gridSize}
              onChange={(e) => setGridSize(Math.max(8, parseInt(e.target.value) || 8))} />
          </div>
          <div>
            <label className={ds.label}>Seed</label>
            <input type="number" className={ds.input} value={seed}
              onChange={(e) => setSeed(parseInt(e.target.value) || 0)} />
          </div>
          {kind === 'sir' && (
            <div>
              <label className={ds.label}>Population</label>
              <input type="number" className={ds.input} value={population}
                onChange={(e) => setPopulation(Math.max(4, parseInt(e.target.value) || 4))} />
            </div>
          )}
          {kind === 'sir' && (
            <>
              <div>
                <label className={ds.label}>Infection Rate β</label>
                <input type="number" step="0.01" className={ds.input} value={infectionRate}
                  onChange={(e) => setInfectionRate(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className={ds.label}>Recovery Rate γ</label>
                <input type="number" step="0.01" className={ds.input} value={recoveryRate}
                  onChange={(e) => setRecoveryRate(parseFloat(e.target.value) || 0)} />
              </div>
            </>
          )}
          {kind === 'schelling' && (
            <div>
              <label className={ds.label}>Happiness Threshold</label>
              <input type="number" step="0.05" className={ds.input} value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value) || 0)} />
            </div>
          )}
        </div>

        <button onClick={run} disabled={running} className={ds.btnPrimary}>
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? 'Stepping agents…' : 'Run Agent Model'}
        </button>
      </div>

      {error && (
        <div className={cn(ds.panel, 'border-red-500/30 bg-red-500/5 flex items-center gap-2')}>
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {(result.peakInfected !== undefined || result.peakPrey !== undefined) && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {result.peakInfected !== undefined && (
                <Stat label="Peak Infected" value={result.peakInfected} />
              )}
              {result.totalInfected !== undefined && (
                <Stat label="Total Infected" value={result.totalInfected} />
              )}
              {result.peakPrey !== undefined && (
                <Stat label="Peak Prey" value={result.peakPrey} />
              )}
              {result.peakPredators !== undefined && (
                <Stat label="Peak Predators" value={result.peakPredators} />
              )}
              <Stat label="Steps Run" value={result.steps} />
            </div>
          )}

          <div className={ds.panel}>
            <h4 className={cn(ds.heading3, 'text-base mb-3')}>Population Time Series</h4>
            <ChartKit
              kind={kind === 'sir' ? 'area' : 'line'}
              data={result.series}
              xKey="t"
              series={meta.seriesKeys}
              height={260}
              stacked={kind === 'sir'}
            />
          </div>

          <div className={ds.panel}>
            <h4 className={cn(ds.heading3, 'text-base mb-3 flex items-center gap-2')}>
              <Grid3x3 className="w-4 h-4 text-cyan-400" /> Final Agent Grid
              <span className="text-xs text-gray-500">({result.agents.length} agents shown)</span>
            </h4>
            <div className="flex justify-center">
              <svg
                width={result.gridSize * cell}
                height={result.gridSize * cell}
                className="rounded-lg border border-lattice-border bg-black/40"
              >
                {result.agents.map((a, i) => (
                  <rect
                    key={i}
                    x={a.x * cell}
                    y={a.y * cell}
                    width={cell}
                    height={cell}
                    fill={meta.stateColors[a.state] || '#71717a'}
                    opacity={0.85}
                  />
                ))}
              </svg>
            </div>
            <div className="flex flex-wrap gap-3 justify-center mt-3">
              {Object.entries(meta.stateColors).map(([state, color]) => (
                <span key={state} className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-3 h-3 rounded-sm" style={{ background: color }} /> {state}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-lattice-surface/50 rounded-lg p-3 text-center">
      <p className={ds.textMuted}>{label}</p>
      <p className={cn(ds.textMono, 'text-lg text-white mt-1')}>{value.toLocaleString()}</p>
    </div>
  );
}
