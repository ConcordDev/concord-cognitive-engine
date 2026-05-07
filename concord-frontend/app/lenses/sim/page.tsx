'use client';

import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Play, Sliders, Clock, Plus, Trash2, Copy, Download,
  Upload, BarChart3, GitCompare, Library, ChevronRight,
  GripVertical, Settings, FlaskConical, TrendingUp, Activity,
  AlertTriangle, CheckCircle2,
  Layers, FileJson, FileSpreadsheet, Save, FolderOpen, X,
  Shuffle, Sigma, Boxes, DollarSign, Users,
  Hash, ToggleLeft, ToggleRight, Info
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useUIStore } from '@/store/ui';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// ─── Type Definitions ────────────────────────────────────────────────────────

type SimTab = 'scenarios' | 'parameters' | 'runs' | 'results' | 'comparison' | 'models';
type ModelType = 'monte-carlo' | 'agent-based' | 'system-dynamics' | 'discrete-event' | 'financial';
type VarType = 'continuous' | 'discrete' | 'boolean';
type Distribution = 'uniform' | 'normal' | 'exponential' | 'poisson' | 'beta' | 'triangular';
type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

interface SimVariable {
  id: string;
  name: string;
  type: VarType;
  min: number;
  max: number;
  defaultValue: number;
  distribution: Distribution;
  sensitive: boolean;
  description: string;
}

interface Assumption {
  id: string;
  text: string;
  order: number;
}

interface Scenario {
  id: string;
  name: string;
  description: string;
  modelType: ModelType;
  variables: SimVariable[];
  assumptions: Assumption[];
  iterations: number;
  createdAt: string;
  updatedAt: string;
  status: string;
}

interface SimRun {
  id: string;
  scenarioId: string;
  scenarioName: string;
  status: RunStatus;
  progress: number;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  errorCount: number;
  iterations: number;
  results?: SimResults;
}

interface SimResults {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  outcomes: OutcomeBucket[];
  sensitivity: SensitivityEntry[];
  riskAssessment: RiskEntry[];
}

interface OutcomeBucket {
  label: string;
  count: number;
  percentage: number;
}

interface SensitivityEntry {
  variable: string;
  impact: number;
  direction: 'positive' | 'negative' | 'mixed';
}

interface RiskEntry {
  outcome: string;
  probability: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface ParameterPreset {
  id: string;
  name: string;
  values: Record<string, number>;
}

interface ModelTemplate {
  id: string;
  name: string;
  type: ModelType;
  description: string;
  icon: string;
  parameters: Array<{ name: string; type: VarType; default: number; min: number; max: number }>;
  expectedOutcomes: string[];
  category: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TAB_CONFIG: Array<{ key: SimTab; label: string; icon: React.ReactNode }> = [
  { key: 'scenarios', label: 'Scenarios', icon: <FlaskConical className="w-4 h-4" /> },
  { key: 'parameters', label: 'Parameters', icon: <Sliders className="w-4 h-4" /> },
  { key: 'runs', label: 'Runs', icon: <Activity className="w-4 h-4" /> },
  { key: 'results', label: 'Results', icon: <BarChart3 className="w-4 h-4" /> },
  { key: 'comparison', label: 'Comparison', icon: <GitCompare className="w-4 h-4" /> },
  { key: 'models', label: 'Models', icon: <Library className="w-4 h-4" /> },
];

const MODEL_TYPES: Array<{ value: ModelType; label: string; icon: React.ReactNode }> = [
  { value: 'monte-carlo', label: 'Monte Carlo', icon: <Shuffle className="w-4 h-4" /> },
  { value: 'agent-based', label: 'Agent-Based', icon: <Users className="w-4 h-4" /> },
  { value: 'system-dynamics', label: 'System Dynamics', icon: <TrendingUp className="w-4 h-4" /> },
  { value: 'discrete-event', label: 'Discrete Event', icon: <Boxes className="w-4 h-4" /> },
  { value: 'financial', label: 'Financial', icon: <DollarSign className="w-4 h-4" /> },
];

const DISTRIBUTIONS: Distribution[] = ['uniform', 'normal', 'exponential', 'poisson', 'beta', 'triangular'];
const ITERATION_OPTIONS = [100, 1000, 10000, 100000];

const MODEL_TEMPLATES: ModelTemplate[] = [
  {
    id: 'financial-projection',
    name: 'Financial Projection',
    type: 'monte-carlo',
    description: 'Monte Carlo simulation for revenue forecasting with variable growth rates, market conditions, and cost structures. Models uncertainty in financial outcomes over configurable time horizons.',
    icon: 'dollar',
    category: 'Finance',
    parameters: [
      { name: 'Initial Revenue', type: 'continuous', default: 1000000, min: 0, max: 100000000 },
      { name: 'Growth Rate', type: 'continuous', default: 0.15, min: -0.5, max: 2.0 },
      { name: 'Market Volatility', type: 'continuous', default: 0.2, min: 0, max: 1.0 },
      { name: 'Operating Margin', type: 'continuous', default: 0.25, min: -0.5, max: 0.9 },
      { name: 'Time Horizon (years)', type: 'discrete', default: 5, min: 1, max: 30 },
    ],
    expectedOutcomes: ['Revenue distribution at horizon', 'Probability of target achievement', 'Value at Risk (VaR)', 'Break-even probability'],
  },
  {
    id: 'population-growth',
    name: 'Population Growth',
    type: 'agent-based',
    description: 'Agent-based model of population dynamics incorporating birth rates, death rates, migration, and carrying capacity constraints. Supports multiple population segments.',
    icon: 'users',
    category: 'Demographics',
    parameters: [
      { name: 'Initial Population', type: 'discrete', default: 10000, min: 100, max: 10000000 },
      { name: 'Birth Rate', type: 'continuous', default: 0.02, min: 0, max: 0.1 },
      { name: 'Death Rate', type: 'continuous', default: 0.01, min: 0, max: 0.1 },
      { name: 'Migration Rate', type: 'continuous', default: 0.005, min: -0.05, max: 0.05 },
      { name: 'Carrying Capacity', type: 'discrete', default: 100000, min: 1000, max: 50000000 },
    ],
    expectedOutcomes: ['Population trajectory', 'Equilibrium point', 'Growth rate over time', 'Resource utilization'],
  },
  {
    id: 'supply-chain',
    name: 'Supply Chain',
    type: 'discrete-event',
    description: 'Discrete event simulation for supply chain optimization. Models inventory levels, lead times, demand variability, and supplier reliability across a multi-echelon network.',
    icon: 'truck',
    category: 'Operations',
    parameters: [
      { name: 'Daily Demand (mean)', type: 'continuous', default: 500, min: 10, max: 50000 },
      { name: 'Lead Time (days)', type: 'discrete', default: 7, min: 1, max: 90 },
      { name: 'Reorder Point', type: 'discrete', default: 1000, min: 100, max: 100000 },
      { name: 'Supplier Reliability', type: 'continuous', default: 0.95, min: 0.5, max: 1.0 },
      { name: 'Holding Cost / Unit', type: 'continuous', default: 2.5, min: 0.01, max: 100 },
    ],
    expectedOutcomes: ['Service level', 'Stockout frequency', 'Average inventory cost', 'Optimal reorder point'],
  },
  {
    id: 'market-simulation',
    name: 'Market Simulation',
    type: 'agent-based',
    description: 'Multi-agent market simulation with heterogeneous traders, order books, and price discovery. Captures emergent market dynamics, flash crashes, and herding behavior.',
    icon: 'chart',
    category: 'Finance',
    parameters: [
      { name: 'Number of Agents', type: 'discrete', default: 1000, min: 50, max: 100000 },
      { name: 'Initial Price', type: 'continuous', default: 100, min: 1, max: 10000 },
      { name: 'Fundamental Value', type: 'continuous', default: 100, min: 1, max: 10000 },
      { name: 'Noise Trader Fraction', type: 'continuous', default: 0.3, min: 0, max: 1.0 },
      { name: 'Tick Size', type: 'continuous', default: 0.01, min: 0.001, max: 1.0 },
    ],
    expectedOutcomes: ['Price distribution', 'Volatility clustering', 'Fat tail analysis', 'Market efficiency ratio'],
  },
  {
    id: 'epidemiological',
    name: 'Epidemiological (SIR)',
    type: 'system-dynamics',
    description: 'Compartmental SIR/SEIR model for infectious disease spread. Configurable transmission rate, recovery rate, vaccination coverage, and intervention strategies.',
    icon: 'virus',
    category: 'Healthcare',
    parameters: [
      { name: 'Population Size', type: 'discrete', default: 1000000, min: 1000, max: 100000000 },
      { name: 'R0 (Basic Reproduction)', type: 'continuous', default: 2.5, min: 0.1, max: 20 },
      { name: 'Recovery Rate', type: 'continuous', default: 0.1, min: 0.01, max: 1.0 },
      { name: 'Vaccination Rate', type: 'continuous', default: 0.01, min: 0, max: 0.1 },
      { name: 'Intervention Day', type: 'discrete', default: 30, min: 0, max: 365 },
    ],
    expectedOutcomes: ['Peak infection count', 'Total infected', 'Herd immunity threshold', 'Intervention effectiveness'],
  },
];

// ─── Utility Functions ───────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(2)}K`;
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(4);
}

function severityColor(s: string): string {
  switch (s) {
    case 'critical': return 'text-red-400';
    case 'high': return 'text-orange-400';
    case 'medium': return 'text-yellow-400';
    case 'low': return 'text-green-400';
    default: return 'text-gray-400';
  }
}

function statusColor(s: RunStatus): string {
  switch (s) {
    case 'completed': return 'text-green-400 bg-green-400/10 border-green-400/30';
    case 'running': return 'text-blue-400 bg-blue-400/10 border-blue-400/30';
    case 'failed': return 'text-red-400 bg-red-400/10 border-red-400/30';
    case 'queued': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
    case 'cancelled': return 'text-gray-400 bg-gray-400/10 border-gray-400/30';
    default: return 'text-gray-400 bg-gray-400/10 border-gray-400/30';
  }
}

function createEmptyVariable(): SimVariable {
  return {
    id: generateId(),
    name: '',
    type: 'continuous',
    min: 0,
    max: 100,
    defaultValue: 50,
    distribution: 'uniform',
    sensitive: false,
    description: '',
  };
}

function createDefaultScenario(): Scenario {
  return {
    id: generateId(),
    name: '',
    description: '',
    modelType: 'monte-carlo',
    variables: [createEmptyVariable()],
    assumptions: [],
    iterations: 1000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'draft',
  };
}

// ─── Monte Carlo Simulation Utilities ────────────────────────────────────────

/** Box-Muller transform: two uniform samples -> one standard-normal sample */
function boxMullerNormal(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Sample a single value from a SimVariable according to its distribution */
function sampleVariable(v: SimVariable): number {
  const { min, max, defaultValue, distribution, type } = v;

  if (type === 'boolean') {
    // defaultValue treated as probability of 1 (scaled 0-100 -> 0-1)
    const p = defaultValue <= 1 ? defaultValue : defaultValue / 100;
    return Math.random() < p ? 1 : 0;
  }

  let raw: number;
  switch (distribution) {
    case 'uniform':
      raw = min + Math.random() * (max - min);
      break;
    case 'normal': {
      // mean = midpoint, stdDev chosen so ±3σ spans [min, max]
      const mean = (min + max) / 2;
      const std = (max - min) / 6;
      raw = mean + boxMullerNormal() * std;
      break;
    }
    case 'triangular': {
      // mode = defaultValue (clamped between min/max)
      const mode = Math.max(min, Math.min(max, defaultValue));
      const u = Math.random();
      const fc = (mode - min) / (max - min);
      raw = u < fc
        ? min + Math.sqrt(u * (max - min) * (mode - min))
        : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
      break;
    }
    case 'exponential': {
      // lambda chosen so that mean = defaultValue (at least 0.001 to avoid Inf)
      const lambda = 1 / Math.max(0.001, defaultValue || 1);
      raw = -Math.log(1 - Math.random()) / lambda;
      break;
    }
    case 'beta': {
      // Simple beta(2,5) rescaled to [min, max] — lightweight approximation
      // using the Jöhnk algorithm for small alpha/beta
      const alpha = 2, beta = 5;
      const ga = () => { let s = 0; for (let i = 0; i < alpha; i++) s -= Math.log(Math.random()); return s; };
      const gb = () => { let s = 0; for (let i = 0; i < beta; i++) s -= Math.log(Math.random()); return s; };
      const x = ga(); const y = gb();
      raw = min + (x / (x + y)) * (max - min);
      break;
    }
    case 'poisson': {
      // Knuth algorithm; lambda = defaultValue
      const L = Math.exp(-(defaultValue || 1));
      let k = 0, p = 1;
      do { k++; p *= Math.random(); } while (p > L);
      raw = k - 1;
      break;
    }
    default:
      raw = min + Math.random() * (max - min);
  }

  // Clamp continuous to [min,max], round discrete
  if (type === 'discrete') return Math.round(Math.max(min, Math.min(max, raw)));
  return Math.max(min, Math.min(max, raw));
}

/** Compute percentile from a *sorted* array */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Run Monte Carlo simulation in chunked batches via setTimeout to keep the UI
 * responsive. Returns a promise that resolves with the final SimResults.
 *
 * `onProgress(fraction)` is called after each chunk so the caller can update
 * a progress bar.
 */
function runMonteCarloChunked(
  variables: SimVariable[],
  totalIterations: number,
  onProgress: (fraction: number) => void,
): Promise<SimResults> {
  return new Promise((resolve) => {
    const CHUNK = 500; // iterations per tick
    const aggregatedValues: number[] = new Array(totalIterations);
    // Per-variable accumulators for sensitivity analysis
    const perVarSums: number[][] = variables.map(() => []);
    let done = 0;

    function processChunk() {
      const end = Math.min(done + CHUNK, totalIterations);
      for (let i = done; i < end; i++) {
        let total = 0;
        for (let vi = 0; vi < variables.length; vi++) {
          const sample = sampleVariable(variables[vi]);
          total += sample;
          perVarSums[vi].push(sample);
        }
        aggregatedValues[i] = total;
      }
      done = end;
      onProgress(done / totalIterations);

      if (done < totalIterations) {
        setTimeout(processChunk, 0);
      } else {
        // ── Compute statistics ────────────────────────────────
        const sorted = aggregatedValues.slice().sort((a, b) => a - b);
        const n = sorted.length;
        const sum = sorted.reduce((s, x) => s + x, 0);
        const mean = sum / n;
        const variance = sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
        const stdDev = Math.sqrt(variance);
        const median = percentile(sorted, 50);
        const minVal = sorted[0];
        const maxVal = sorted[n - 1];
        const p5 = percentile(sorted, 5);
        const p25 = percentile(sorted, 25);
        const p75 = percentile(sorted, 75);
        const p95 = percentile(sorted, 95);

        // ── Outcome distribution (histogram buckets) ─────────
        const bucketCount = 8;
        const range = maxVal - minVal || 1;
        const bucketSize = range / bucketCount;
        const buckets: OutcomeBucket[] = [];
        for (let b = 0; b < bucketCount; b++) {
          const lo = minVal + b * bucketSize;
          const hi = lo + bucketSize;
          const label = `${formatNumber(lo)} – ${formatNumber(hi)}`;
          const count = sorted.filter(x => x >= lo && (b === bucketCount - 1 ? x <= hi : x < hi)).length;
          buckets.push({ label, count, percentage: Math.round((count / n) * 100) });
        }

        // ── Sensitivity (correlation-based impact) ───────────
        const sensitivity: SensitivityEntry[] = variables.map((v, vi) => {
          const samples = perVarSums[vi];
          const vMean = samples.reduce((s, x) => s + x, 0) / n;
          const cov = samples.reduce((s, x, i) => s + (x - vMean) * (aggregatedValues[i] - mean), 0) / n;
          const vStd = Math.sqrt(samples.reduce((s, x) => s + (x - vMean) ** 2, 0) / n) || 1;
          const corr = cov / (vStd * (stdDev || 1));
          return {
            variable: v.name || v.id,
            impact: Math.round(Math.abs(corr) * 100) / 100,
            direction: (corr > 0.05 ? 'positive' : corr < -0.05 ? 'negative' : 'mixed') as SensitivityEntry['direction'],
          };
        }).sort((a, b) => b.impact - a.impact);

        // ── Risk assessment ──────────────────────────────────
        const riskAssessment: RiskEntry[] = [];
        const belowP5Pct = 5;
        riskAssessment.push({
          outcome: `Below ${formatNumber(p5)}`,
          probability: belowP5Pct,
          severity: 'high',
        });
        const aboveP95Pct = 5;
        riskAssessment.push({
          outcome: `Above ${formatNumber(p95)}`,
          probability: aboveP95Pct,
          severity: 'low',
        });
        if (stdDev > mean * 0.5) {
          riskAssessment.push({
            outcome: 'High volatility (CV > 50%)',
            probability: Math.round((stdDev / (Math.abs(mean) || 1)) * 100),
            severity: 'medium',
          });
        }

        resolve({
          mean: Math.round(mean * 1e4) / 1e4,
          median: Math.round(median * 1e4) / 1e4,
          stdDev: Math.round(stdDev * 1e4) / 1e4,
          min: Math.round(minVal * 1e4) / 1e4,
          max: Math.round(maxVal * 1e4) / 1e4,
          p5: Math.round(p5 * 1e4) / 1e4,
          p25: Math.round(p25 * 1e4) / 1e4,
          p75: Math.round(p75 * 1e4) / 1e4,
          p95: Math.round(p95 * 1e4) / 1e4,
          outcomes: buckets,
          sensitivity,
          riskAssessment,
        });
      }
    }

    // Kick off the first chunk
    setTimeout(processChunk, 0);
  });
}

// ─── Empty results placeholder (shown when no simulation has been run) ────────

function getEmptyResults(): SimResults {
  return {
    mean: 0, median: 0, stdDev: 0, min: 0, max: 0,
    p5: 0, p25: 0, p75: 0, p95: 0,
    outcomes: [],
    sensitivity: [],
    riskAssessment: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN PAGE COMPONENT ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export default function SimLensPage() {
  useLensNav('sim');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('sim');
  const queryClient = useQueryClient();

  // ── State ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<SimTab>('scenarios');
  const [editingScenario, setEditingScenario] = useState<Scenario | null>(null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [showScenarioBuilder, setShowScenarioBuilder] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [parameterPresets, setParameterPresets] = useState<ParameterPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // ── API: Backend simulations ───────────────────────────────────────────────
  const { data: simulations, isLoading, isError: isError2, error: error2, refetch: refetch2 } = useQuery({
    queryKey: ['simulations'],
    queryFn: () => apiHelpers.simulations.list().then((r) => r.data),
  });

  const runSim = useMutation({
    mutationFn: async (payload: { title: string; prompt: string; assumptions: string[] }) => {
      return apiHelpers.simulations.run({ prompt: `${payload.title}: ${payload.prompt}` }).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['simulations'] });
    },
    onError: (err) => console.error('runSim failed:', err instanceof Error ? err.message : err),
  });

  // ── Lens artifact persistence ──────────────────────────────────────────────
  const {
    isError, error, refetch,
    items: scenarioArtifacts,
    create: createScenarioArtifact,
    update: updateScenarioArtifact,
    remove: removeScenarioArtifact,
  } = useLensData<Scenario>('sim', 'scenario', { noSeed: true });

  const {
    items: runArtifacts,
    create: createRunArtifact,
    update: updateRunArtifact,
  } = useLensData<SimRun>('sim', 'run', { noSeed: true });

  const runArtifactAction = useRunArtifact('sim');

  // ── Derived data ───────────────────────────────────────────────────────────
  const scenarios: Scenario[] = useMemo(() =>
    scenarioArtifacts.map(a => ({
      ...a.data,
      id: a.id,
      name: a.title || a.data.name || 'Untitled',
    })),
    [scenarioArtifacts]
  );

  const runs: SimRun[] = useMemo(() =>
    runArtifacts.map(a => ({
      ...a.data,
      id: a.id,
    })),
    [runArtifacts]
  );

  const backendSims = useMemo(() => simulations?.simulations || [], [simulations]);

  const selectedScenario = useMemo(() =>
    scenarios.find(s => s.id === selectedScenarioId) || null,
    [scenarios, selectedScenarioId]
  );

  const selectedRun = useMemo(() =>
    runs.find(r => r.id === selectedRunId) || null,
    [runs, selectedRunId]
  );

  const completedRuns = useMemo(() => runs.filter(r => r.status === 'completed'), [runs]);

  // ── Dashboard stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    totalScenarios: scenarios.length + backendSims.length,
    runsCompleted: completedRuns.length + backendSims.length,
    avgConvergence: completedRuns.length > 0
      ? (completedRuns.reduce((s, r) => s + (r.results?.stdDev || 0), 0) / completedRuns.length).toFixed(2)
      : '--',
    activeModels: new Set(scenarios.map(s => s.modelType)).size || 0,
  }), [scenarios, completedRuns, backendSims]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSaveScenario = useCallback(async () => {
    if (!editingScenario) return;
    const payload = {
      title: editingScenario.name,
      data: { ...editingScenario, updatedAt: new Date().toISOString() },
      meta: { tags: [editingScenario.modelType], status: 'draft' },
    };
    if (editingScenario.id && scenarios.find(s => s.id === editingScenario.id)) {
      await updateScenarioArtifact(editingScenario.id, payload);
    } else {
      await createScenarioArtifact(payload);
    }
    setEditingScenario(null);
    setShowScenarioBuilder(false);
  }, [editingScenario, scenarios, createScenarioArtifact, updateScenarioArtifact]);

  const handleDeleteScenario = useCallback(async (id: string) => {
    await removeScenarioArtifact(id);
    if (selectedScenarioId === id) {
      setSelectedScenarioId(null);
      setDetailPanelOpen(false);
    }
  }, [removeScenarioArtifact, selectedScenarioId]);

  const handleCloneScenario = useCallback((scenario: Scenario) => {
    const cloned = {
      ...scenario,
      id: generateId(),
      name: `${scenario.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setEditingScenario(cloned);
    setShowScenarioBuilder(true);
  }, []);

  const handleRunSimulation = useCallback(async (scenario: Scenario) => {
    if (!scenario.variables || scenario.variables.length === 0) {
      useUIStore.getState().addToast({ type: 'error', message: 'Add at least one variable before running a simulation.' });
      return;
    }
    const iterations = scenario.iterations || 1000;
    const runId = generateId();
    const newRun: SimRun = {
      id: runId,
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status: 'running',
      progress: 0,
      startedAt: new Date().toISOString(),
      errorCount: 0,
      iterations,
    };
    const artifact = await createRunArtifact({
      title: `Run: ${scenario.name}`,
      data: newRun as unknown as Partial<SimRun>,
      meta: { tags: ['run', scenario.modelType], status: 'running' },
    });
    const artifactId = artifact?.id || runId;
    setActiveTab('runs');

    try {
      // Run client-side Monte Carlo in chunked batches (non-blocking)
      const results = await runMonteCarloChunked(
        scenario.variables,
        iterations,
        (fraction) => {
          // Update progress in the artifact store so the UI reflects it
          updateRunArtifact(artifactId, {
            data: { progress: Math.round(fraction * 100), status: 'running' } as Partial<SimRun>,
          }).catch(() => { /* swallow stale-update errors during rapid progress ticks */ });
        },
      );

      const completedAt = new Date().toISOString();
      const duration = new Date(completedAt).getTime() - new Date(newRun.startedAt).getTime();

      await updateRunArtifact(artifactId, {
        data: {
          status: 'completed',
          progress: 100,
          completedAt,
          duration,
          results,
        } as Partial<SimRun>,
        meta: { tags: ['run', scenario.modelType], status: 'completed' },
      });

      useUIStore.getState().addToast({
        type: 'success',
        message: `Simulation "${scenario.name}" completed — ${iterations.toLocaleString()} iterations in ${formatDuration(duration)}.`,
      });
    } catch (err) {
      console.error('Monte Carlo simulation failed:', err);
      await updateRunArtifact(artifactId, {
        data: {
          status: 'failed',
          progress: 0,
          errorCount: 1,
        } as Partial<SimRun>,
        meta: { status: 'failed' },
      }).catch(() => {});
      useUIStore.getState().addToast({
        type: 'error',
        message: `Simulation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }

    // Also fire the backend simulation for AI-enriched analysis (best-effort)
    runSim.mutate({
      title: scenario.name,
      prompt: `Simulate ${scenario.modelType} model: ${scenario.description}`,
      assumptions: scenario.assumptions.map(a => a.text),
    });
  }, [createRunArtifact, updateRunArtifact, runSim]);

  const handleRunSensitivity = useCallback(async (scenario: Scenario) => {
    const sensitiveVars = scenario.variables.filter(v => v.sensitive);
    if (sensitiveVars.length === 0) {
      useUIStore.getState().addToast({ type: 'error', message: 'Mark at least one parameter as sensitive in the Parameter Space Explorer to run sensitivity analysis.' });
      return;
    }
    try {
      await runArtifactAction.mutateAsync({
        id: scenario.id,
        action: 'sensitivityAnalysis',
        params: { variables: sensitiveVars.map(v => v.name), iterations: scenario.iterations },
      });
      setActiveTab('results');
    } catch (e) { console.error('Sensitivity analysis failed:', e); useUIStore.getState().addToast({ type: 'error', message: `Sensitivity analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
  }, [runArtifactAction]);

  const handleExportResults = useCallback((run: SimRun) => {
    if (!run.results) return;
    const csv = [
      'Metric,Value',
      `Mean,${run.results.mean}`,
      `Median,${run.results.median}`,
      `Std Dev,${run.results.stdDev}`,
      `Min,${run.results.min}`,
      `Max,${run.results.max}`,
      `P5,${run.results.p5}`,
      `P25,${run.results.p25}`,
      `P75,${run.results.p75}`,
      `P95,${run.results.p95}`,
      '',
      'Outcome,Count,Percentage',
      ...run.results.outcomes.map(o => `${o.label},${o.count},${o.percentage}%`),
      '',
      'Sensitivity Variable,Impact,Direction',
      ...run.results.sensitivity.map(s => `${s.variable},${s.impact},${s.direction}`),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sim-results-${run.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportScenarioJson = useCallback((scenario: Scenario) => {
    const json = JSON.stringify(scenario, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scenario-${scenario.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportScenario = useCallback(async () => {
    try {
      const parsed = JSON.parse(importJson) as Scenario;
      parsed.id = generateId();
      parsed.createdAt = new Date().toISOString();
      parsed.updatedAt = new Date().toISOString();
      await createScenarioArtifact({
        title: parsed.name,
        data: parsed as unknown as Partial<Scenario>,
        meta: { tags: [parsed.modelType], status: 'draft' },
      });
      setImportJson('');
      setShowImportModal(false);
    } catch {
      useUIStore.getState().addToast({ type: 'error', message: 'Invalid JSON. Please check the format and try again.' });
    }
  }, [importJson, createScenarioArtifact]);

  const handleSavePreset = useCallback(() => {
    if (!selectedScenario || !presetName) return;
    const values: Record<string, number> = {};
    selectedScenario.variables.forEach(v => { values[v.name] = v.defaultValue; });
    setParameterPresets(prev => [...prev, { id: generateId(), name: presetName, values }]);
    setPresetName('');
  }, [selectedScenario, presetName]);

  const handleLoadPreset = useCallback((preset: ParameterPreset) => {
    if (!editingScenario) return;
    const updated = { ...editingScenario };
    updated.variables = updated.variables.map(v => ({
      ...v,
      defaultValue: preset.values[v.name] ?? v.defaultValue,
    }));
    setEditingScenario(updated);
  }, [editingScenario]);

  const toggleComparison = useCallback((id: string) => {
    setComparisonIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }, []);

  // ── Drag-and-drop for assumptions ─────────────────────────────────────────
  const handleDragStart = (idx: number) => { dragItem.current = idx; };
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx; };
  const handleDragEnd = () => {
    if (!editingScenario || dragItem.current === null || dragOverItem.current === null) return;
    const assumptions = [...editingScenario.assumptions];
    const draggedItem = assumptions[dragItem.current];
    assumptions.splice(dragItem.current, 1);
    assumptions.splice(dragOverItem.current, 0, draggedItem);
    const reordered = assumptions.map((a, i) => ({ ...a, order: i }));
    setEditingScenario({ ...editingScenario, assumptions: reordered });
    dragItem.current = null;
    dragOverItem.current = null;
  };

  // ── Variable mutations ─────────────────────────────────────────────────────
  const addVariable = useCallback(() => {
    if (!editingScenario) return;
    setEditingScenario({
      ...editingScenario,
      variables: [...editingScenario.variables, createEmptyVariable()],
    });
  }, [editingScenario]);

  const updateVariable = useCallback((varId: string, field: keyof SimVariable, value: unknown) => {
    if (!editingScenario) return;
    setEditingScenario({
      ...editingScenario,
      variables: editingScenario.variables.map(v =>
        v.id === varId ? { ...v, [field]: value } : v
      ),
    });
  }, [editingScenario]);

  const removeVariable = useCallback((varId: string) => {
    if (!editingScenario) return;
    setEditingScenario({
      ...editingScenario,
      variables: editingScenario.variables.filter(v => v.id !== varId),
    });
  }, [editingScenario]);

  const addAssumption = useCallback(() => {
    if (!editingScenario) return;
    setEditingScenario({
      ...editingScenario,
      assumptions: [
        ...editingScenario.assumptions,
        { id: generateId(), text: '', order: editingScenario.assumptions.length },
      ],
    });
  }, [editingScenario]);

  // ── Domain action state ────────────────────────────────────────────────────
  const [simActionRunning, setSimActionRunning] = useState<string | null>(null);
  const [scenarioRunResult, setScenarioRunResult] = useState<Record<string, unknown> | null>(null);
  const [paramSweepResult, setParamSweepResult] = useState<Record<string, unknown> | null>(null);
  const [monteCarloResult, setMonteCarloResult] = useState<Record<string, unknown> | null>(null);
  const [sensitivityResult, setSensitivityResult] = useState<Record<string, unknown> | null>(null);

  const handleSimAction = useCallback(async (
    action: string,
    setter: (val: Record<string, unknown> | null) => void
  ) => {
    setSimActionRunning(action);
    try {
      const artifactId = scenarioArtifacts[0]?.id || 'sim';
      const res = await runArtifactAction.mutateAsync({ id: artifactId, action });
      if (res.ok === false) { setter({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` } as Record<string, unknown>); } else { setter((res.result as Record<string, unknown>) || null); }
    } catch (e) {
      console.error(`Sim action ${action} failed:`, e);
    }
    setSimActionRunning(null);
  }, [scenarioArtifacts, runArtifactAction]);

  // Use results from the selected run, or empty placeholder if no run selected
  const runResults: SimResults = useMemo(() => {
    if (selectedRun?.results) {
      return selectedRun.results;
    }
    return getEmptyResults();
  }, [selectedRun]);
  const fallbackResults = runResults;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  // ── Error boundary ─────────────────────────────────────────────────────────
  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }

  // ─── Load template into builder ────────────────────────────────────────────
  const handleLoadTemplate = (template: ModelTemplate) => {
    const newScenario = createDefaultScenario();
    newScenario.name = template.name;
    newScenario.description = template.description;
    newScenario.modelType = template.type;
    newScenario.variables = template.parameters.map(p => ({
      id: generateId(),
      name: p.name,
      type: p.type,
      min: p.min,
      max: p.max,
      defaultValue: p.default,
      distribution: 'normal' as Distribution,
      sensitive: false,
      description: '',
    }));
    setEditingScenario(newScenario);
    setShowScenarioBuilder(true);
    setActiveTab('scenarios');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── RENDER ────────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className={ds.pageContainer}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className={ds.sectionHeader}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/30 to-blue-500/30 border border-purple-500/30 flex items-center justify-center">
            <FlaskConical className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className={ds.heading1}>Simulation Engine</h1>
            <p className={ds.textMuted}>
              Monte Carlo, Agent-Based, System Dynamics, Discrete Event, and Financial modeling
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="sim" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className={cn(ds.btnGhost, ds.btnSmall)}
          >
            <Upload className="w-4 h-4" /> Import
          </button>
          <button
            onClick={() => {
              setEditingScenario(createDefaultScenario());
              setShowScenarioBuilder(true);
            }}
            className={cn(ds.btnPrimary, ds.btnSmall)}
          >
            <Plus className="w-4 h-4" /> New Scenario
          </button>
        </div>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(() => {
          const completedRuns = runs.filter(r => r.status === 'completed');
          const avgRuntime = completedRuns.length > 0 ? (completedRuns.reduce((s, r) => s + (r.duration || 0), 0) / completedRuns.length / 1000).toFixed(1) : '0';
          const successRate = runs.length > 0 ? Math.round((completedRuns.length / runs.length) * 100) : 0;
          return [
            { label: 'Simulations', value: scenarios.length, icon: FlaskConical },
            { label: 'Avg Runtime', value: `${avgRuntime}s`, icon: Clock },
            { label: 'Success Rate', value: `${successRate}%`, icon: CheckCircle2 },
            { label: 'Total Runs', value: runs.length, icon: Activity },
          ].map((stat) => (
            <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
              <stat.icon className="w-5 h-5 text-purple-400 shrink-0" />
              <div>
                <p className="text-xs text-gray-400">{stat.label}</p>
                <p className="text-lg font-bold text-white">{stat.value}</p>
              </div>
            </div>
          ));
        })()}
      </div>

      {/* ── Dashboard Stats (4 cards) ────────────────────────────────────── */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <FlaskConical className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.totalScenarios}</p>
              <p className={ds.textMuted}>Total Scenarios</p>
            </div>
          </div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.runsCompleted}</p>
              <p className={ds.textMuted}>Runs Completed</p>
            </div>
          </div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Sigma className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.avgConvergence}</p>
              <p className={ds.textMuted}>Avg Convergence</p>
            </div>
          </div>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Layers className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{stats.activeModels}</p>
              <p className={ds.textMuted}>Active Models</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Domain Actions ──────────────────────────────────────────────── */}
      <div className={cn(ds.panel, 'flex flex-wrap items-center gap-2')}>
        <button
          onClick={() => {
            if (selectedScenario) handleRunSimulation(selectedScenario);
            else useUIStore.getState().addToast({ type: 'error', message: 'Select a scenario first.' });
          }}
          className={cn(ds.btnPrimary, ds.btnSmall)}
          disabled={runSim.isPending}
        >
          <Play className="w-4 h-4" />
          {runSim.isPending ? 'Running...' : 'Run Simulation'}
        </button>
        <button
          onClick={() => {
            if (selectedScenario) handleRunSensitivity(selectedScenario);
            else useUIStore.getState().addToast({ type: 'error', message: 'Select a scenario first.' });
          }}
          className={cn(ds.btnSecondary, ds.btnSmall)}
        >
          <TrendingUp className="w-4 h-4" /> Sensitivity Analysis
        </button>
        <button
          onClick={() => {
            const r = runs.find(r => r.results);
            if (r) handleExportResults(r);
            else useUIStore.getState().addToast({ type: 'info', message: 'No results to export yet.' });
          }}
          className={cn(ds.btnSecondary, ds.btnSmall)}
        >
          <FileSpreadsheet className="w-4 h-4" /> Export Results
        </button>
        <button
          onClick={() => {
            if (selectedScenario) handleCloneScenario(selectedScenario);
            else useUIStore.getState().addToast({ type: 'error', message: 'Select a scenario first.' });
          }}
          className={cn(ds.btnGhost, ds.btnSmall)}
        >
          <Copy className="w-4 h-4" /> Clone Scenario
        </button>
      </div>

      {/* ── Tab Navigation ────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-lattice-border flex-wrap pb-px">
        {TAB_CONFIG.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap',
              activeTab === tab.key
                ? 'bg-lattice-surface border border-lattice-border border-b-transparent text-white'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface/50'
            )}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ───────────────────────────────────────────────────── */}
      <div className="flex gap-4">
        <div className={cn('flex-1 min-w-0', detailPanelOpen && 'max-w-[calc(100%-380px)]')}>
          {activeTab === 'scenarios' && (
            <ScenariosTab
              scenarios={scenarios}
              backendSims={backendSims}
              selectedId={selectedScenarioId}
              onSelect={(id) => { setSelectedScenarioId(id); setDetailPanelOpen(true); }}
              onEdit={(s) => { setEditingScenario(s); setShowScenarioBuilder(true); }}
              onDelete={handleDeleteScenario}
              onClone={handleCloneScenario}
              onRun={handleRunSimulation}
              onExport={handleExportScenarioJson}
            />
          )}
          {activeTab === 'parameters' && (
            <ParametersTab
              scenario={selectedScenario}
              presets={parameterPresets}
              presetName={presetName}
              onPresetNameChange={setPresetName}
              onSavePreset={handleSavePreset}
              onLoadPreset={handleLoadPreset}
              onEdit={() => {
                if (selectedScenario) {
                  setEditingScenario(selectedScenario);
                  setShowScenarioBuilder(true);
                }
              }}
            />
          )}
          {activeTab === 'runs' && (
            <RunsTab
              runs={runs}
              backendSims={backendSims}
              selectedRunId={selectedRunId}
              onSelectRun={setSelectedRunId}
              comparisonIds={comparisonIds}
              onToggleComparison={toggleComparison}
            />
          )}
          {activeTab === 'results' && (
            <ResultsTab
              run={selectedRun}
              fallbackResults={fallbackResults}
              onExport={() => {
                if (selectedRun) handleExportResults(selectedRun);
              }}
            />
          )}
          {activeTab === 'comparison' && (
            <ComparisonTab
              scenarios={scenarios}
              runs={runs}
              comparisonIds={comparisonIds}
              fallbackResults={fallbackResults}
            />
          )}
          {activeTab === 'models' && (
            <ModelsTab
              templates={MODEL_TEMPLATES}
              onLoadTemplate={handleLoadTemplate}
            />
          )}
        </div>

        {/* ── Detail Panel (right sidebar) ────────────────────────────────── */}
        {detailPanelOpen && selectedScenario && (
          <div className={cn(ds.panel, 'w-[360px] flex-shrink-0 overflow-y-auto max-h-[calc(100vh-280px)]')}>
            <div className={ds.sectionHeader}>
              <h3 className={ds.heading3}>Scenario Details</h3>
              <button onClick={() => setDetailPanelOpen(false)} className={ds.btnGhost}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <span className={ds.label}>Name</span>
                <p className="text-white font-medium">{selectedScenario.name || 'Untitled'}</p>
              </div>
              <div>
                <span className={ds.label}>Model Type</span>
                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400')}>
                  {selectedScenario.modelType}
                </span>
              </div>
              <div>
                <span className={ds.label}>Description</span>
                <p className="text-sm text-gray-300">{selectedScenario.description || 'No description'}</p>
              </div>
              <div>
                <span className={ds.label}>Iterations</span>
                <p className={ds.textMono}>{selectedScenario.iterations?.toLocaleString()}</p>
              </div>
              <div>
                <span className={ds.label}>Parameters ({selectedScenario.variables?.length || 0})</span>
                <div className="space-y-2 mt-1">
                  {(selectedScenario.variables || []).map(v => (
                    <div key={v.id} className="flex items-center justify-between text-sm bg-lattice-surface/50 rounded px-2 py-1">
                      <span className="text-gray-300">{v.name || '(unnamed)'}</span>
                      <span className={ds.textMono}>{v.defaultValue}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <span className={ds.label}>Assumptions ({selectedScenario.assumptions?.length || 0})</span>
                <ul className="mt-1 space-y-1">
                  {(selectedScenario.assumptions || []).map((a, i) => (
                    <li key={a.id} className="text-sm text-gray-400 flex gap-2">
                      <span className="text-gray-600">{i + 1}.</span> {a.text}
                    </li>
                  ))}
                  {(selectedScenario.assumptions || []).length === 0 && (
                    <li className="text-sm text-gray-600 italic">No assumptions defined</li>
                  )}
                </ul>
              </div>
              <div>
                <span className={ds.label}>Linked Runs</span>
                <div className="space-y-1 mt-1">
                  {runs.filter(r => r.scenarioId === selectedScenario.id).map(r => (
                    <div key={r.id} className="flex items-center justify-between text-sm">
                      <span className={cn('px-1.5 py-0.5 rounded text-xs border', statusColor(r.status))}>{r.status}</span>
                      <span className={ds.textMuted}>{r.startedAt ? new Date(r.startedAt).toLocaleDateString() : '--'}</span>
                    </div>
                  ))}
                  {runs.filter(r => r.scenarioId === selectedScenario.id).length === 0 && (
                    <p className="text-sm text-gray-600 italic">No runs yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ── Scenario Builder Modal ──────────────────────────────────────── */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {showScenarioBuilder && editingScenario && (
        <div className={ds.modalBackdrop} onClick={() => setShowScenarioBuilder(false)}>
          <div className={ds.modalContainer} onClick={(e) => e.stopPropagation()}>
            <div className={cn(ds.modalPanel, 'max-w-4xl max-h-[90vh] overflow-y-auto')}>
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b border-lattice-border">
                <h2 className={ds.heading2}>Scenario Builder</h2>
                <button onClick={() => setShowScenarioBuilder(false)} className={ds.btnGhost}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Name + Description */}
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Scenario Name</label>
                    <input
                      className={ds.input}
                      value={editingScenario.name}
                      onChange={e => setEditingScenario({ ...editingScenario, name: e.target.value })}
                      placeholder="e.g., Q3 Revenue Forecast"
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Model Type</label>
                    <select
                      className={ds.select}
                      value={editingScenario.modelType}
                      onChange={e => setEditingScenario({ ...editingScenario, modelType: e.target.value as ModelType })}
                    >
                      {MODEL_TYPES.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className={ds.label}>Description</label>
                  <textarea
                    className={cn(ds.textarea, 'h-20')}
                    value={editingScenario.description}
                    onChange={e => setEditingScenario({ ...editingScenario, description: e.target.value })}
                    placeholder="Describe the simulation scenario and its purpose..."
                  />
                </div>

                {/* Iteration Count */}
                <div>
                  <label className={ds.label}>Iteration Count</label>
                  <div className="flex gap-2 mt-1">
                    {ITERATION_OPTIONS.map(n => (
                      <button
                        key={n}
                        onClick={() => setEditingScenario({ ...editingScenario, iterations: n })}
                        className={cn(
                          ds.btnSmall,
                          editingScenario.iterations === n ? ds.btnPrimary : ds.btnSecondary
                        )}
                      >
                        {n.toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Variable Definition */}
                <div>
                  <div className={ds.sectionHeader}>
                    <label className={ds.label}>Variables ({editingScenario.variables.length})</label>
                    <button onClick={addVariable} className={cn(ds.btnGhost, ds.btnSmall)}>
                      <Plus className="w-3 h-3" /> Add Variable
                    </button>
                  </div>
                  <div className="space-y-3 mt-2">
                    {editingScenario.variables.map((v, _vi) => (
                      <div key={v.id} className={cn(ds.panel, 'p-3')}>
                        <div className="flex items-start gap-3">
                          <div className="flex-1 space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className={cn(ds.label, 'text-xs')}>Name</label>
                                <input
                                  className={ds.input}
                                  value={v.name}
                                  onChange={e => updateVariable(v.id, 'name', e.target.value)}
                                  placeholder="Variable name"
                                />
                              </div>
                              <div>
                                <label className={cn(ds.label, 'text-xs')}>Type</label>
                                <select
                                  className={ds.select}
                                  value={v.type}
                                  onChange={e => updateVariable(v.id, 'type', e.target.value)}
                                >
                                  <option value="continuous">Continuous</option>
                                  <option value="discrete">Discrete</option>
                                  <option value="boolean">Boolean</option>
                                </select>
                              </div>
                              <div>
                                <label className={cn(ds.label, 'text-xs')}>Distribution</label>
                                <select
                                  className={ds.select}
                                  value={v.distribution}
                                  onChange={e => updateVariable(v.id, 'distribution', e.target.value)}
                                >
                                  {DISTRIBUTIONS.map(d => (
                                    <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className={cn(ds.label, 'text-xs')}>Min</label>
                                <input
                                  type="number"
                                  className={ds.input}
                                  value={v.min}
                                  onChange={e => updateVariable(v.id, 'min', parseFloat(e.target.value) || 0)}
                                />
                              </div>
                              <div>
                                <label className={cn(ds.label, 'text-xs')}>Max</label>
                                <input
                                  type="number"
                                  className={ds.input}
                                  value={v.max}
                                  onChange={e => updateVariable(v.id, 'max', parseFloat(e.target.value) || 100)}
                                />
                              </div>
                              <div>
                                <label className={cn(ds.label, 'text-xs')}>Default</label>
                                <input
                                  type="number"
                                  className={ds.input}
                                  value={v.defaultValue}
                                  onChange={e => updateVariable(v.id, 'defaultValue', parseFloat(e.target.value) || 0)}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-1 pt-5">
                            <button
                              onClick={() => updateVariable(v.id, 'sensitive', !v.sensitive)}
                              className={cn(ds.btnGhost, 'p-1')}
                              title={v.sensitive ? 'Marked for sensitivity' : 'Mark for sensitivity analysis'}
                            >
                              {v.sensitive
                                ? <ToggleRight className="w-5 h-5 text-purple-400" />
                                : <ToggleLeft className="w-5 h-5 text-gray-500" />
                              }
                            </button>
                            <button
                              onClick={() => removeVariable(v.id)}
                              className={cn(ds.btnGhost, 'p-1 text-red-400 hover:text-red-300')}
                              title="Remove variable"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Assumption Builder */}
                <div>
                  <div className={ds.sectionHeader}>
                    <label className={ds.label}>Assumptions (drag to reorder)</label>
                    <button onClick={addAssumption} className={cn(ds.btnGhost, ds.btnSmall)}>
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                  <div className="space-y-2 mt-2">
                    {editingScenario.assumptions.map((a, ai) => (
                      <div
                        key={a.id}
                        draggable
                        onDragStart={() => handleDragStart(ai)}
                        onDragEnter={() => handleDragEnter(ai)}
                        onDragEnd={handleDragEnd}
                        onDragOver={e => e.preventDefault()}
                        className="flex items-center gap-2 bg-lattice-surface/50 rounded-lg p-2 cursor-move"
                      >
                        <GripVertical className="w-4 h-4 text-gray-600 flex-shrink-0" />
                        <span className="text-xs text-gray-500 w-5">{ai + 1}</span>
                        <input
                          className={cn(ds.input, 'flex-1 text-sm')}
                          value={a.text}
                          onChange={e => {
                            const assumptions = [...editingScenario.assumptions];
                            assumptions[ai] = { ...assumptions[ai], text: e.target.value };
                            setEditingScenario({ ...editingScenario, assumptions });
                          }}
                          placeholder="e.g., Network latency remains under 100ms"
                        />
                        <button
                          onClick={() => {
                            setEditingScenario({
                              ...editingScenario,
                              assumptions: editingScenario.assumptions.filter((_, i) => i !== ai),
                            });
                          }}
                          className={cn(ds.btnGhost, 'p-1')}
                        >
                          <X className="w-3 h-3 text-gray-500" />
                        </button>
                      </div>
                    ))}
                    {editingScenario.assumptions.length === 0 && (
                      <p className="text-sm text-gray-600 italic text-center py-4">
                        No assumptions yet. Add assumptions to constrain your simulation.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 p-6 border-t border-lattice-border">
                <button onClick={() => setShowScenarioBuilder(false)} className={ds.btnSecondary}>
                  Cancel
                </button>
                <button
                  onClick={handleSaveScenario}
                  disabled={!editingScenario.name}
                  className={ds.btnPrimary}
                >
                  <Save className="w-4 h-4" /> Save Scenario
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <RealtimeDataPanel data={realtimeInsights} />

      {/* ── Sim Domain Action Panel ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={ds.panel + ' space-y-4'}>
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-neon-cyan" />
          <h2 className="font-semibold text-sm">Simulation Analysis Engine</h2>
          <span className={cn(ds.textMuted, 'ml-auto text-xs')}>Scenario · Sweep · Monte Carlo · Sensitivity</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { action: 'scenarioRun', label: 'Run Scenario', setter: setScenarioRunResult, icon: Play, color: 'text-neon-cyan' },
            { action: 'parameterSweep', label: 'Param Sweep', setter: setParamSweepResult, icon: Sliders, color: 'text-violet-400' },
            { action: 'monteCarlo', label: 'Monte Carlo', setter: setMonteCarloResult, icon: Shuffle, color: 'text-orange-400' },
            { action: 'sensitivityAnalysis', label: 'Sensitivity', setter: setSensitivityResult, icon: Activity, color: 'text-green-400' },
          ].map(({ action, label, setter, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleSimAction(action, setter)}
              disabled={simActionRunning !== null}
              className={cn(ds.btnSecondary, 'flex items-center gap-1.5 justify-center disabled:opacity-40 disabled:cursor-not-allowed text-xs')}
            >
              {simActionRunning === action
                ? <Sigma className="w-3.5 h-3.5 animate-spin" />
                : <Icon className={cn('w-3.5 h-3.5', color)} />}
              {simActionRunning === action ? 'Running…' : label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Scenario Run Result */}
          {scenarioRunResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-neon-cyan uppercase tracking-wider flex items-center gap-1.5">
                <Play className="w-3.5 h-3.5" /> Scenario Run
              </span>
              {'message' in scenarioRunResult ? (
                <p className="text-xs text-gray-400">{String(scenarioRunResult.message)}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className={cn(ds.panel, 'text-center')}>
                      <p className="text-xs text-gray-500">Steps Run</p>
                      <p className="text-lg font-bold text-neon-cyan">{String(scenarioRunResult.stepsRun ?? 0)}</p>
                    </div>
                    <div className={cn(ds.panel, 'text-center')}>
                      <p className="text-xs text-gray-500">Variables</p>
                      <p className="text-lg font-bold text-white">
                        {scenarioRunResult.initialState && typeof scenarioRunResult.initialState === 'object'
                          ? Object.keys(scenarioRunResult.initialState as object).length
                          : 0}
                      </p>
                    </div>
                  </div>
                  {'deltas' in scenarioRunResult && typeof scenarioRunResult.deltas === 'object' && scenarioRunResult.deltas !== null && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500 font-medium">State Changes</p>
                      {Object.entries(scenarioRunResult.deltas as Record<string, Record<string, unknown>>).map(([key, delta]) => (
                        <div key={key} className="flex items-center gap-2 text-xs">
                          <span className="text-gray-400 flex-1 font-mono">{key}</span>
                          <span className="text-gray-500">{String(delta.start)}</span>
                          <span className="text-gray-600">→</span>
                          <span className="text-white font-mono">{String(delta.end)}</span>
                          <span className={`font-mono ${Number(delta.change) > 0 ? 'text-green-400' : Number(delta.change) < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                            ({Number(delta.change) > 0 ? '+' : ''}{String(delta.change)})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Parameter Sweep Result */}
          {paramSweepResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5" /> Parameter Sweep
              </span>
              {'message' in paramSweepResult ? (
                <p className="text-xs text-gray-400">{String(paramSweepResult.message)}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    {'parameter' in paramSweepResult && <span>Param: <span className="text-white font-mono">{String(paramSweepResult.parameter)}</span></span>}
                    {'runsCompleted' in paramSweepResult && <span>{String(paramSweepResult.runsCompleted)} runs</span>}
                    {'stepsPerRun' in paramSweepResult && <span>{String(paramSweepResult.stepsPerRun)} steps/run</span>}
                  </div>
                  {Array.isArray(paramSweepResult.results) && (paramSweepResult.results as Array<Record<string, unknown>>).length > 0 && (() => {
                    const results = paramSweepResult.results as Array<Record<string, unknown>>;
                    const param = String(paramSweepResult.parameter);
                    const outcomeKey = 'outcome';
                    const maxOutcome = Math.max(...results.map(r => Number(r[outcomeKey]) || 0));
                    return (
                      <div className="space-y-1.5">
                        <p className="text-xs text-gray-500 font-medium">Sweep Results</p>
                        {results.slice(0, 10).map((r, i) => {
                          const pct = maxOutcome > 0 ? (Number(r[outcomeKey]) / maxOutcome) * 100 : 0;
                          return (
                            <div key={i} className="space-y-0.5">
                              <div className="flex justify-between text-xs text-gray-400">
                                <span className="font-mono">{param}={String(r[param])}</span>
                                <span className="font-mono text-white">{Number(r[outcomeKey]).toFixed(3)}</span>
                              </div>
                              <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${pct}%` }}
                                  transition={{ delay: i * 0.03, duration: 0.3 }}
                                  className="h-full rounded-full bg-violet-500/70"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}
            </motion.div>
          )}

          {/* Monte Carlo Result */}
          {monteCarloResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Shuffle className="w-3.5 h-3.5" /> Monte Carlo
                </span>
                {'trials' in monteCarloResult && (
                  <span className="text-xs text-gray-500">{String(monteCarloResult.trials)} trials</span>
                )}
              </div>
              {'message' in monteCarloResult ? (
                <p className="text-xs text-gray-400">{String(monteCarloResult.message)}</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Mean', value: String(monteCarloResult.mean ?? '—'), color: 'text-orange-400' },
                      { label: 'Std Dev', value: String(monteCarloResult.stddev ?? '—'), color: 'text-white' },
                      { label: 'Formula', value: String(monteCarloResult.formula ?? '—'), color: 'text-gray-300' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className={cn(ds.panel, 'text-center')}>
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className={cn('text-sm font-bold font-mono', color)}>{value}</p>
                      </div>
                    ))}
                  </div>
                  {'percentiles' in monteCarloResult && typeof monteCarloResult.percentiles === 'object' && monteCarloResult.percentiles !== null && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-2">Percentile Distribution</p>
                      <div className="space-y-1.5">
                        {[
                          { key: 'p5', label: 'P5 (5%)', color: 'bg-red-500/60' },
                          { key: 'p25', label: 'P25 (25%)', color: 'bg-orange-500/60' },
                          { key: 'p50', label: 'P50 (median)', color: 'bg-yellow-500/60' },
                          { key: 'p75', label: 'P75 (75%)', color: 'bg-green-500/60' },
                          { key: 'p95', label: 'P95 (95%)', color: 'bg-emerald-500/60' },
                        ].map(({ key, label, color }) => {
                          const pcts = monteCarloResult.percentiles as Record<string, number>;
                          const maxVal = Math.abs(pcts.p95 || 1);
                          const barWidth = maxVal > 0 ? Math.min((Math.abs(pcts[key] || 0) / maxVal) * 100, 100) : 0;
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-500 w-24 shrink-0">{label}</span>
                              <div className="flex-1 h-2 bg-black/30 rounded-full overflow-hidden">
                                <motion.div initial={{ width: 0 }} animate={{ width: `${barWidth}%` }} transition={{ duration: 0.4 }} className={`h-full rounded-full ${color}`} />
                              </div>
                              <span className="text-xs font-mono text-gray-300 w-16 text-right">{String(pcts[key] ?? '—')}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {'confidenceInterval90' in monteCarloResult && typeof monteCarloResult.confidenceInterval90 === 'object' && monteCarloResult.confidenceInterval90 !== null && (
                    <div className="flex items-center gap-2 text-xs bg-black/20 rounded p-2">
                      <span className="text-gray-500">90% CI:</span>
                      <span className="font-mono text-orange-300">
                        [{String((monteCarloResult.confidenceInterval90 as Record<string, unknown>).lower)} — {String((monteCarloResult.confidenceInterval90 as Record<string, unknown>).upper)}]
                      </span>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Sensitivity Analysis Result */}
          {sensitivityResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-green-400 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" /> Sensitivity Analysis
              </span>
              {'message' in sensitivityResult ? (
                <p className="text-xs text-gray-400">{String(sensitivityResult.message)}</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    {'outputField' in sensitivityResult && (
                      <span>Output: <span className="text-white font-mono">{String(sensitivityResult.outputField)}</span></span>
                    )}
                    {'baselineOutput' in sensitivityResult && (
                      <span>Baseline: <span className="text-white font-mono">{String(sensitivityResult.baselineOutput)}</span></span>
                    )}
                    {'mostSensitive' in sensitivityResult && (
                      <span>Most Sensitive: <span className="text-green-400 font-mono">{String(sensitivityResult.mostSensitive)}</span></span>
                    )}
                  </div>
                  {Array.isArray(sensitivityResult.sensitivity) && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500 font-medium">Parameter Sensitivity Ranking</p>
                      {(sensitivityResult.sensitivity as Array<Record<string, unknown>>).map((item, i) => {
                        const maxSens = Math.max(...(sensitivityResult.sensitivity as Array<Record<string, unknown>>).map(x => Number(x.sensitivity) || 0), 1);
                        const barPct = (Number(item.sensitivity) / maxSens) * 100;
                        return (
                          <div key={i} className="space-y-0.5">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="w-4 text-gray-600 font-mono shrink-0">{i + 1}.</span>
                              <span className="flex-1 text-gray-300 font-mono">{String(item.parameter)}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                String(item.direction) === 'positive' ? 'bg-green-500/20 text-green-400' :
                                String(item.direction) === 'negative' ? 'bg-red-500/20 text-red-400' :
                                'bg-gray-500/20 text-gray-400'
                              }`}>{String(item.direction)}</span>
                              <span className="text-gray-400 font-mono w-10 text-right">{String(item.sensitivity)}</span>
                            </div>
                            <div className="h-1.5 bg-black/30 rounded-full overflow-hidden ml-5">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${barPct}%` }}
                                transition={{ delay: i * 0.05, duration: 0.4 }}
                                className={`h-full rounded-full ${i === 0 ? 'bg-green-500' : i === 1 ? 'bg-emerald-400' : 'bg-green-400/60'}`}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>

      <UniversalActions domain="sim" artifactId={null} compact />

      {/* ── Import Modal ──────────────────────────────────────────────────── */}
      {showImportModal && (
        <div className={ds.modalBackdrop} onClick={() => setShowImportModal(false)}>
          <div className={ds.modalContainer} onClick={e => e.stopPropagation()}>
            <div className={cn(ds.modalPanel, 'max-w-lg')}>
              <div className="flex items-center justify-between p-6 border-b border-lattice-border">
                <h2 className={ds.heading2}>Import Scenario</h2>
                <button onClick={() => setShowImportModal(false)} className={ds.btnGhost}>
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className={ds.label}>Paste Scenario JSON</label>
                  <textarea
                    className={cn(ds.textarea, 'h-48 font-mono text-xs')}
                    value={importJson}
                    onChange={e => setImportJson(e.target.value)}
                    placeholder='{"name": "My Scenario", "modelType": "monte-carlo", ...}'
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 p-6 border-t border-lattice-border">
                <button onClick={() => setShowImportModal(false)} className={ds.btnSecondary}>
                  Cancel
                </button>
                <button onClick={handleImportScenario} disabled={!importJson.trim()} className={ds.btnPrimary}>
                  <FileJson className="w-4 h-4" /> Import
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── TAB COMPONENTS ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ─── SCENARIOS TAB ───────────────────────────────────────────────────────────

function ScenariosTab({
  scenarios, backendSims, selectedId, onSelect, onEdit, onDelete, onClone, onRun, onExport,
}: {
  scenarios: Scenario[];
  backendSims: Array<Record<string, unknown>>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (s: Scenario) => void;
  onDelete: (id: string) => void;
  onClone: (s: Scenario) => void;
  onRun: (s: Scenario) => void;
  onExport: (s: Scenario) => void;
}) {
  return (
    <div className="space-y-3">
      {scenarios.length === 0 && backendSims.length === 0 && (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <FlaskConical className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className={ds.heading3}>No scenarios yet</h3>
          <p className={ds.textMuted}>Create your first simulation scenario or load a model template.</p>
        </div>
      )}

      {scenarios.map((scenario, index) => (
        <motion.div
          key={scenario.id}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
          onClick={() => onSelect(scenario.id)}
          className={cn(
            ds.panelHover,
            selectedId === scenario.id && 'border-neon-cyan/50 bg-lattice-surface/80'
          )}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-white truncate">{scenario.name || 'Untitled'}</h3>
                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400')}>
                  {scenario.modelType}
                </span>
              </div>
              <p className="text-sm text-gray-400 line-clamp-2">{scenario.description || 'No description'}</p>
              <div className="flex items-center gap-4 mt-2">
                <span className={cn(ds.textMuted, 'flex items-center gap-1')}>
                  <Sliders className="w-3 h-3" /> {scenario.variables?.length || 0} params
                </span>
                <span className={cn(ds.textMuted, 'flex items-center gap-1')}>
                  <Hash className="w-3 h-3" /> {(scenario.iterations || 0).toLocaleString()} iterations
                </span>
                <span className={ds.textMuted}>
                  {scenario.createdAt ? new Date(scenario.createdAt).toLocaleDateString() : ''}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 ml-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
              <button onClick={() => onRun(scenario)} className={cn(ds.btnGhost, 'p-1.5')} title="Run">
                <Play className="w-4 h-4 text-green-400" />
              </button>
              <button onClick={() => onEdit(scenario)} className={cn(ds.btnGhost, 'p-1.5')} title="Edit">
                <Settings className="w-4 h-4" />
              </button>
              <button onClick={() => onClone(scenario)} className={cn(ds.btnGhost, 'p-1.5')} title="Clone">
                <Copy className="w-4 h-4" />
              </button>
              <button onClick={() => onExport(scenario)} className={cn(ds.btnGhost, 'p-1.5')} title="Export JSON">
                <Download className="w-4 h-4" />
              </button>
              <button onClick={() => onDelete(scenario.id)} className={cn(ds.btnGhost, 'p-1.5 text-red-400')} title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      ))}

      {/* Backend simulations (legacy) */}
      {backendSims.length > 0 ? (
        <>
          <div className="flex items-center gap-2 mt-6 mb-2">
            <div className="h-px flex-1 bg-lattice-border" />
            <span className={ds.textMuted}>Backend Simulations</span>
            <div className="h-px flex-1 bg-lattice-border" />
          </div>
          {backendSims.slice(0, 10).map((sim: Record<string, unknown>) => (
            <details key={sim.id as string} className={ds.panel}>
              <summary className="flex items-center justify-between cursor-pointer">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white truncate">{sim.title as string}</p>
                  <p className={ds.textMuted}>{sim.createdAt as string}</p>
                </div>
                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 ml-3')}>
                  <CheckCircle2 className="w-3 h-3" /> Complete
                </span>
              </summary>
              <div className="mt-3 pt-3 border-t border-lattice-border">
                <p className="text-sm text-gray-400 mb-2">{sim.prompt as string}</p>
                {Boolean(sim.results) && (
                  <div className="bg-lattice-surface/50 p-3 rounded-lg text-xs font-mono space-y-1">
                    <p>Summary: {(sim.results as Record<string, unknown>).summary as string}</p>
                    <p>Risks: {((sim.results as Record<string, unknown>).keyRisks as string[])?.join(', ')}</p>
                  </div>
                )}
              </div>
            </details>
          ))}
        </>
      ) : (
        <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
          <p>No backend simulations found. Create a simulation to get started.</p>
        </div>
      )}
    </div>
  );
}

// ─── PARAMETERS TAB ──────────────────────────────────────────────────────────

function ParametersTab({
  scenario, presets, presetName, onPresetNameChange, onSavePreset, onLoadPreset, onEdit,
}: {
  scenario: Scenario | null;
  presets: ParameterPreset[];
  presetName: string;
  onPresetNameChange: (v: string) => void;
  onSavePreset: () => void;
  onLoadPreset: (p: ParameterPreset) => void;
  onEdit: () => void;
}) {
  if (!scenario) {
    return (
      <div className={cn(ds.panel, 'text-center py-12')}>
        <Sliders className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <h3 className={ds.heading3}>Select a Scenario</h3>
        <p className={ds.textMuted}>Choose a scenario from the Scenarios tab to explore its parameter space.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={cn(ds.panel)}>
        <div className={ds.sectionHeader}>
          <h3 className={ds.heading3}>Parameter Space: {scenario.name}</h3>
          <button onClick={onEdit} className={cn(ds.btnSecondary, ds.btnSmall)}>
            <Settings className="w-4 h-4" /> Edit Parameters
          </button>
        </div>

        {/* Preset Management */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className={ds.textMuted}>Presets:</span>
          {presets.map(p => (
            <button key={p.id} onClick={() => onLoadPreset(p)} className={cn(ds.btnSecondary, ds.btnSmall)}>
              <FolderOpen className="w-3 h-3" /> {p.name}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <input
              className={cn(ds.input, 'w-32 text-sm')}
              value={presetName}
              onChange={e => onPresetNameChange(e.target.value)}
              placeholder="Preset name"
            />
            <button onClick={onSavePreset} disabled={!presetName} className={cn(ds.btnGhost, ds.btnSmall)}>
              <Save className="w-3 h-3" /> Save
            </button>
          </div>
        </div>
      </div>

      {/* Parameter Grid with Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(scenario.variables || []).map(v => (
          <div key={v.id} className={cn(ds.panel)}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{v.name || '(unnamed)'}</span>
                {v.sensitive && (
                  <span className="text-xs text-purple-400 flex items-center gap-0.5">
                    <TrendingUp className="w-3 h-3" /> sensitive
                  </span>
                )}
              </div>
              <span className={cn(ds.textMono, 'text-xs')}>
                {v.distribution} ({v.type})
              </span>
            </div>

            {/* Slider visualization */}
            <div className="relative mt-3">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{v.min}</span>
                <span className="text-white font-medium">{v.defaultValue}</span>
                <span>{v.max}</span>
              </div>
              <div className="h-2 bg-lattice-surface rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    v.sensitive ? 'bg-purple-500' : 'bg-blue-500'
                  )}
                  style={{
                    width: `${Math.min(100, Math.max(0, ((v.defaultValue - v.min) / (v.max - v.min || 1)) * 100))}%`,
                  }}
                />
              </div>
              {/* Range indicator */}
              <div className="flex items-center gap-2 mt-2">
                <span className={cn(ds.textMuted, 'text-xs')}>Range: {v.max - v.min}</span>
                <span className={cn(ds.textMuted, 'text-xs')}>|</span>
                <span className={cn(ds.textMuted, 'text-xs')}>
                  Position: {(((v.defaultValue - v.min) / (v.max - v.min || 1)) * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(scenario.variables || []).length === 0 && (
        <div className={cn(ds.panel, 'text-center py-8')}>
          <p className={ds.textMuted}>No parameters defined for this scenario.</p>
        </div>
      )}
    </div>
  );
}

// ─── RUNS TAB ────────────────────────────────────────────────────────────────

function RunsTab({
  runs, backendSims, selectedRunId, onSelectRun, comparisonIds, onToggleComparison,
}: {
  runs: SimRun[];
  backendSims: Array<Record<string, unknown>>;
  selectedRunId: string | null;
  onSelectRun: (id: string) => void;
  comparisonIds: string[];
  onToggleComparison: (id: string) => void;
}) {
  const activeRuns = runs.filter(r => r.status === 'running');
  const queuedRuns = runs.filter(r => r.status === 'queued');
  const completedRuns = runs.filter(r => r.status === 'completed' || r.status === 'failed');

  return (
    <div className="space-y-4">
      {/* Active Runs */}
      {activeRuns.length > 0 ? (
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-3')}>
            <Activity className="w-4 h-4 text-blue-400 animate-pulse" /> Active Runs
          </h3>
          <div className="space-y-3">
            {activeRuns.map(run => (
              <div key={run.id} className="bg-lattice-surface/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-white">{run.scenarioName}</span>
                  <span className={cn('px-2 py-0.5 rounded-full text-xs border', statusColor(run.status))}>
                    {run.status}
                  </span>
                </div>
                <div className="w-full bg-lattice-surface rounded-full h-2.5 mb-2">
                  <div
                    className="bg-blue-500 h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${run.progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className={ds.textMuted}>{run.progress}% complete</span>
                  <span className={ds.textMuted}>
                    {run.iterations?.toLocaleString()} iterations
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
          <p>No active simulations running. Start a simulation to see live results.</p>
        </div>
      )}

      {/* Queued Runs */}
      {queuedRuns.length > 0 && (
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-3')}>
            <Clock className="w-4 h-4 text-yellow-400" /> Queued ({queuedRuns.length})
          </h3>
          <div className="space-y-2">
            {queuedRuns.map(run => (
              <div key={run.id} className="flex items-center justify-between bg-lattice-surface/50 rounded-lg p-3">
                <span className="text-white">{run.scenarioName}</span>
                <span className={cn('px-2 py-0.5 rounded-full text-xs border', statusColor(run.status))}>
                  queued
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Run History */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-3')}>
          <Clock className="w-4 h-4 text-gray-400" /> Run History
        </h3>
        {completedRuns.length === 0 && backendSims.length === 0 && (
          <p className={cn(ds.textMuted, 'text-center py-8')}>
            No completed runs yet. Run a scenario to see results here.
          </p>
        )}
        <div className="space-y-2">
          {completedRuns.map(run => (
            <div
              key={run.id}
              onClick={() => onSelectRun(run.id)}
              className={cn(
                'flex items-center justify-between bg-lattice-surface/50 rounded-lg p-3 cursor-pointer hover:bg-lattice-surface transition-colors',
                selectedRunId === run.id && 'ring-1 ring-neon-cyan/50'
              )}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleComparison(run.id); }}
                  className={cn(
                    'w-5 h-5 rounded border flex items-center justify-center transition-colors',
                    comparisonIds.includes(run.id)
                      ? 'bg-cyan-500/30 border-cyan-500 text-cyan-400'
                      : 'border-gray-600 text-transparent hover:border-gray-400'
                  )}
                  title="Toggle comparison"
                >
                  <CheckCircle2 className="w-3 h-3" />
                </button>
                <div>
                  <p className="text-white font-medium">{run.scenarioName}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className={ds.textMuted}>
                      {run.startedAt ? new Date(run.startedAt).toLocaleString() : '--'}
                    </span>
                    {run.duration && (
                      <span className={ds.textMuted}>{formatDuration(run.duration)}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {run.errorCount > 0 && (
                  <span className="text-xs text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {run.errorCount} errors
                  </span>
                )}
                <span className={cn('px-2 py-0.5 rounded-full text-xs border', statusColor(run.status))}>
                  {run.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison Selector */}
      {comparisonIds.length > 0 && (
        <div className={cn(ds.panel, 'flex items-center justify-between')}>
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-cyan-400" />
            <span className="text-white font-medium">
              {comparisonIds.length} run{comparisonIds.length > 1 ? 's' : ''} selected for comparison
            </span>
          </div>
          <span className={ds.textMuted}>(max 3)</span>
        </div>
      )}
    </div>
  );
}

// ─── RESULTS TAB ─────────────────────────────────────────────────────────────

function ResultsTab({
  run, fallbackResults, onExport,
}: {
  run: SimRun | null;
  fallbackResults: SimResults;
  onExport: () => void;
}) {
  // Use run.results if available, otherwise show empty fallback
  const results = run?.results || fallbackResults;

  return (
    <div className="space-y-4">
      {!run && (
        <div className={cn(ds.panel, 'border-yellow-500/20 bg-yellow-500/5')}>
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-yellow-400" />
            <span className="text-sm text-yellow-400">
              Showing sample results. Select a completed run to view actual data.
            </span>
          </div>
        </div>
      )}

      {/* Summary Statistics */}
      <div className={ds.panel}>
        <div className={ds.sectionHeader}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
            <Sigma className="w-4 h-4 text-blue-400" /> Summary Statistics
          </h3>
          <button onClick={onExport} className={cn(ds.btnGhost, ds.btnSmall)}>
            <FileSpreadsheet className="w-4 h-4" /> Export CSV
          </button>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3 mt-4">
          {[
            { label: 'Mean', value: results.mean },
            { label: 'Median', value: results.median },
            { label: 'Std Dev', value: results.stdDev },
            { label: 'Min', value: results.min },
            { label: 'Max', value: results.max },
          ].map(s => (
            <div key={s.label} className="bg-lattice-surface/50 rounded-lg p-3 text-center">
              <p className={ds.textMuted}>{s.label}</p>
              <p className={cn(ds.textMono, 'text-lg text-white mt-1')}>{formatNumber(s.value)}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-3 mt-3">
          {[
            { label: 'P5', value: results.p5 },
            { label: 'P25', value: results.p25 },
            { label: 'P75', value: results.p75 },
            { label: 'P95', value: results.p95 },
          ].map(s => (
            <div key={s.label} className="bg-lattice-surface/50 rounded-lg p-3 text-center">
              <p className={ds.textMuted}>{s.label}</p>
              <p className={cn(ds.textMono, 'text-white mt-1')}>{formatNumber(s.value)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Outcome Distribution (horizontal bar chart) */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
          <BarChart3 className="w-4 h-4 text-purple-400" /> Outcome Distribution
        </h3>
        <div className="space-y-2">
          {results.outcomes.map((o, i) => {
            const maxPct = Math.max(...results.outcomes.map(x => x.percentage));
            const barWidth = (o.percentage / maxPct) * 100;
            return (
              <div key={i} className="flex items-center gap-3">
                <span className={cn(ds.textMono, 'w-28 text-right text-xs text-gray-400 flex-shrink-0')}>
                  {o.label}
                </span>
                <div className="flex-1 h-6 bg-lattice-surface rounded overflow-hidden relative">
                  <div
                    className={cn(
                      'h-full rounded transition-all duration-700',
                      i <= 1 ? 'bg-red-500/60' :
                      i === 2 ? 'bg-yellow-500/60' :
                      i <= 4 ? 'bg-green-500/60' :
                      'bg-blue-500/60'
                    )}
                    style={{ width: `${barWidth}%` }}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white font-mono">
                    {o.count}
                  </span>
                </div>
                <span className={cn(ds.textMono, 'w-14 text-xs text-gray-400 text-right flex-shrink-0')}>
                  {o.percentage}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Risk Assessment */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
          <AlertTriangle className="w-4 h-4 text-orange-400" /> Risk Assessment
        </h3>
        <div className="space-y-2">
          {results.riskAssessment.map((r, i) => (
            <div key={i} className="flex items-center justify-between bg-lattice-surface/50 rounded-lg p-3">
              <div className="flex items-center gap-3">
                <span className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  r.severity === 'critical' ? 'bg-red-400' :
                  r.severity === 'high' ? 'bg-orange-400' :
                  r.severity === 'medium' ? 'bg-yellow-400' :
                  'bg-green-400'
                )} />
                <span className="text-sm text-white">{r.outcome}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn('text-xs font-medium', severityColor(r.severity))}>
                  {r.severity.toUpperCase()}
                </span>
                <span className={cn(ds.textMono, 'text-sm text-white')}>
                  {(r.probability * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sensitivity Analysis */}
      <div className={ds.panel}>
        <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
          <TrendingUp className="w-4 h-4 text-cyan-400" /> Sensitivity Analysis
        </h3>
        <div className="space-y-2">
          {results.sensitivity.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-36 text-sm text-gray-300 flex-shrink-0 truncate">{s.variable}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-3 bg-lattice-surface rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        s.direction === 'positive' ? 'bg-green-500' :
                        s.direction === 'negative' ? 'bg-red-500' :
                        'bg-yellow-500'
                      )}
                      style={{ width: `${s.impact * 100}%` }}
                    />
                  </div>
                  <span className={cn(ds.textMono, 'w-12 text-xs text-right')}>
                    {(s.impact * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <span className={cn(
                'text-xs w-16 text-right',
                s.direction === 'positive' ? 'text-green-400' :
                s.direction === 'negative' ? 'text-red-400' :
                'text-yellow-400'
              )}>
                {s.direction === 'positive' ? '+corr' : s.direction === 'negative' ? '-corr' : 'mixed'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── COMPARISON TAB ──────────────────────────────────────────────────────────

function ComparisonTab({
  scenarios, runs, comparisonIds, fallbackResults,
}: {
  scenarios: Scenario[];
  runs: SimRun[];
  comparisonIds: string[];
  fallbackResults: SimResults;
}) {
  const comparedRuns = runs.filter(r => comparisonIds.includes(r.id));
  const comparedScenarios = scenarios.filter(s => comparisonIds.includes(s.id));

  // If comparing runs
  if (comparedRuns.length >= 2) {
    const results = comparedRuns.map(r => r.results || fallbackResults);
    return (
      <div className="space-y-4">
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
            <GitCompare className="w-4 h-4 text-cyan-400" /> Run Comparison ({comparedRuns.length})
          </h3>

          {/* Side-by-side stats */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border">
                  <th className="text-left py-2 px-3 text-gray-400 font-medium">Metric</th>
                  {comparedRuns.map(r => (
                    <th key={r.id} className="text-right py-2 px-3 text-white font-medium">
                      {r.scenarioName}
                    </th>
                  ))}
                  {comparedRuns.length === 2 && (
                    <th className="text-right py-2 px-3 text-cyan-400 font-medium">Delta</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {['mean', 'median', 'stdDev', 'min', 'max', 'p5', 'p25', 'p75', 'p95'].map(metric => (
                  <tr key={metric} className="border-b border-lattice-border/50">
                    <td className="py-2 px-3 text-gray-400">{metric}</td>
                    {results.map((r, i) => (
                      <td key={i} className={cn(ds.textMono, 'text-right py-2 px-3 text-white')}>
                        {formatNumber(r[metric as keyof SimResults] as number)}
                      </td>
                    ))}
                    {results.length === 2 && (
                      <td className={cn(ds.textMono, 'text-right py-2 px-3')}>
                        {(() => {
                          const delta = (results[1][metric as keyof SimResults] as number) - (results[0][metric as keyof SimResults] as number);
                          return (
                            <span className={delta >= 0 ? 'text-green-400' : 'text-red-400'}>
                              {delta >= 0 ? '+' : ''}{formatNumber(delta)}
                            </span>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Outcome comparison */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-4')}>Outcome Distribution Comparison</h3>
          <div className="space-y-2">
            {results[0].outcomes.map((o, oi) => (
              <div key={oi} className="space-y-1">
                <span className={cn(ds.textMono, 'text-xs text-gray-400')}>{o.label}</span>
                {results.map((r, ri) => (
                  <div key={ri} className="flex items-center gap-2">
                    <span className="w-6 text-xs text-gray-500">{ri + 1}</span>
                    <div className="flex-1 h-4 bg-lattice-surface rounded overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded',
                          ri === 0 ? 'bg-blue-500/70' : ri === 1 ? 'bg-purple-500/70' : 'bg-cyan-500/70'
                        )}
                        style={{ width: `${r.outcomes[oi]?.percentage || 0}%` }}
                      />
                    </div>
                    <span className={cn(ds.textMono, 'text-xs w-10 text-right text-gray-400')}>
                      {r.outcomes[oi]?.percentage || 0}%
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // If comparing scenarios
  if (comparedScenarios.length >= 2) {
    return (
      <div className="space-y-4">
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
            <GitCompare className="w-4 h-4 text-cyan-400" /> Scenario Comparison ({comparedScenarios.length})
          </h3>

          {/* Parameter diff table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-lattice-border">
                  <th className="text-left py-2 px-3 text-gray-400 font-medium">Parameter</th>
                  {comparedScenarios.map(s => (
                    <th key={s.id} className="text-right py-2 px-3 text-white font-medium">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-lattice-border/50">
                  <td className="py-2 px-3 text-gray-400">Model Type</td>
                  {comparedScenarios.map(s => (
                    <td key={s.id} className={cn(ds.textMono, 'text-right py-2 px-3 text-white')}>
                      {s.modelType}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-lattice-border/50">
                  <td className="py-2 px-3 text-gray-400">Iterations</td>
                  {comparedScenarios.map(s => (
                    <td key={s.id} className={cn(ds.textMono, 'text-right py-2 px-3 text-white')}>
                      {(s.iterations || 0).toLocaleString()}
                    </td>
                  ))}
                </tr>
                {/* Merge all variables across scenarios for comparison */}
                {(() => {
                  const allVarNames = new Set<string>();
                  comparedScenarios.forEach(s => (s.variables || []).forEach(v => allVarNames.add(v.name)));
                  return Array.from(allVarNames).map(varName => (
                    <tr key={varName} className="border-b border-lattice-border/50">
                      <td className="py-2 px-3 text-gray-400">{varName}</td>
                      {comparedScenarios.map(s => {
                        const v = (s.variables || []).find(x => x.name === varName);
                        return (
                          <td key={s.id} className={cn(ds.textMono, 'text-right py-2 px-3')}>
                            {v ? (
                              <span className="text-white">{v.defaultValue}</span>
                            ) : (
                              <span className="text-gray-600">--</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(ds.panel, 'text-center py-12')}>
      <GitCompare className="w-12 h-12 text-gray-600 mx-auto mb-4" />
      <h3 className={ds.heading3}>Select Items to Compare</h3>
      <p className={ds.textMuted}>
        Select 2-3 runs from the Runs tab (using the checkboxes) or scenarios to compare them side by side.
      </p>
      <p className={cn(ds.textMuted, 'mt-2')}>
        Currently selected: {comparisonIds.length} item{comparisonIds.length !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

// ─── MODELS TAB ──────────────────────────────────────────────────────────────

function ModelsTab({
  templates, onLoadTemplate,
}: {
  templates: ModelTemplate[];
  onLoadTemplate: (t: ModelTemplate) => void;
}) {
  const categories = Array.from(new Set(templates.map(t => t.category)));

  return (
    <div data-lens-theme="sim" className="space-y-6">
      {categories.map(category => (
        <div key={category}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <Library className="w-4 h-4 text-purple-400" /> {category}
          </h3>
          <div className={ds.grid2}>
            {templates.filter(t => t.category === category).map(template => (
              <div key={template.id} className={cn(ds.panelHover, 'group')}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
                    {template.type === 'monte-carlo' && <Shuffle className="w-5 h-5 text-purple-400" />}
                    {template.type === 'agent-based' && <Users className="w-5 h-5 text-blue-400" />}
                    {template.type === 'system-dynamics' && <TrendingUp className="w-5 h-5 text-green-400" />}
                    {template.type === 'discrete-event' && <Boxes className="w-5 h-5 text-orange-400" />}
                    {template.type === 'financial' && <DollarSign className="w-5 h-5 text-yellow-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-white">{template.name}</h4>
                    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 mt-1')}>
                      {template.type}
                    </span>
                    <p className="text-sm text-gray-400 mt-2 line-clamp-3">{template.description}</p>

                    {/* Parameters preview */}
                    <div className="mt-3">
                      <span className={cn(ds.textMuted, 'text-xs')}>Parameters ({template.parameters.length}):</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {template.parameters.map(p => (
                          <span key={p.name} className="text-xs px-1.5 py-0.5 bg-lattice-surface rounded text-gray-400">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Expected Outcomes */}
                    <div className="mt-3">
                      <span className={cn(ds.textMuted, 'text-xs')}>Expected Outcomes:</span>
                      <ul className="mt-1 space-y-0.5">
                        {template.expectedOutcomes.map(o => (
                          <li key={o} className="text-xs text-gray-400 flex items-center gap-1.5">
                            <ChevronRight className="w-3 h-3 text-gray-600" /> {o}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <button
                      onClick={() => onLoadTemplate(template)}
                      className={cn(ds.btnPrimary, ds.btnSmall, 'mt-4')}
                    >
                      <Play className="w-3 h-3" /> Load Template
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
