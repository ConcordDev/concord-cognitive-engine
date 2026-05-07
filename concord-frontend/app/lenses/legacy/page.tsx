'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { Clock, Target, TrendingUp, Calendar, Milestone, Rocket, Loader2, Layers, ChevronDown, Database, Server, HardDrive, Cloud, RefreshCw, Archive, GitMerge, Play } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';

interface MilestoneData {
  year: number;
  description: string;
  status: 'completed' | 'current' | 'future';
  confidence: number;
}

const SEED_MILESTONES: { title: string; data: Record<string, unknown> }[] = [];

export default function LegacyLensPage() {
  useLensNav('legacy');
  const [showFeatures, setShowFeatures] = useState(true);
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('legacy');

  const { items: milestoneItems, isLoading, isError, error, refetch } = useLensData<MilestoneData>('legacy', 'milestone', {
    seed: SEED_MILESTONES,
  });

  const milestones = milestoneItems.map((item) => ({
    year: item.data.year,
    title: item.title,
    description: item.data.description,
    status: item.data.status,
    confidence: item.data.confidence,
  })).sort((a, b) => a.year - b.year);

  const runAction = useRunArtifact('legacy');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = milestoneItems[0]?.id;
    if (!targetId) { setActionResult({ message: 'Add a legacy milestone first to run analysis.' }); return; }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  const currentYear = new Date().getFullYear();
  const bioAge = milestones.length > 0
    ? Math.max(...milestones.map((m) => m.year)) - currentYear
    : 340;

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-neon-purple" />
        <span className="ml-3 text-gray-400">Loading legacy timeline...</span>
      </div>
    );
  }


  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <div data-lens-theme="legacy" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-2xl">🏛️</span>
        <div>
          <h1 className="text-xl font-bold">Legacy Lens</h1>
          <p className="text-sm text-gray-400">
            400-year vision planner based on bioAge projections
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="legacy" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="legacy" artifactId={milestoneItems[0]?.id} compact />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Archive className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{milestoneItems.length}</p>
          <p className="text-sm text-gray-400">Legacy Items</p>
        </div>
        <div className="lens-card">
          <GitMerge className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">58%</p>
          <p className="text-sm text-gray-400">Migration Status</p>
        </div>
        <div className="lens-card">
          <RefreshCw className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{milestones.filter(m => m.confidence > 0.7).length}/{milestones.length || 1}</p>
          <p className="text-sm text-gray-400">Compatibility Score</p>
        </div>
        <div className="lens-card">
          <TrendingUp className="w-5 h-5 text-yellow-400 mb-2" />
          <p className="text-2xl font-bold">{milestones.length > 0 ? (milestones.reduce((s, m) => s + m.confidence, 0) / milestones.length * 100).toFixed(0) : 0}%</p>
          <p className="text-sm text-gray-400">Avg Confidence</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Clock className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{bioAge}</p>
          <p className="text-sm text-gray-400">Projected Years</p>
        </div>
        <div className="lens-card">
          <Target className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">400</p>
          <p className="text-sm text-gray-400">Vision Horizon</p>
        </div>
        <div className="lens-card">
          <Milestone className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{milestones.length}</p>
          <p className="text-sm text-gray-400">Milestones</p>
        </div>
        <div className="lens-card">
          <TrendingUp className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{((bioAge / 400) * 100).toFixed(0)}%</p>
          <p className="text-sm text-gray-400">Progress</p>
        </div>
      </div>

      {/* Vision Timeline */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-neon-purple" />
          400-Year Timeline
        </h2>
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-lattice-border" />
          <div className="space-y-6">
            {milestones.map((milestone, index) => (
              <motion.div key={milestone.year} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="relative flex gap-4 pl-10">
                <div
                  className={`absolute left-2.5 w-3 h-3 rounded-full border-2 ${
                    milestone.status === 'completed'
                      ? 'bg-neon-green border-neon-green'
                      : milestone.status === 'current'
                      ? 'bg-neon-blue border-neon-blue animate-pulse'
                      : 'bg-lattice-surface border-lattice-border'
                  }`}
                />
                <div className="flex-1 lens-card">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-neon-cyan">{milestone.year}</span>
                      <span className="font-semibold">{milestone.title}</span>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        milestone.status === 'current'
                          ? 'bg-neon-blue/20 text-neon-blue'
                          : milestone.status === 'completed'
                          ? 'bg-neon-green/20 text-neon-green'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {milestone.status}
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mb-2">{milestone.description}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Confidence:</span>
                    <div className="flex-1 h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-neon-green to-neon-blue"
                        style={{ width: `${milestone.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400">
                      {(milestone.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Founder Intent */}
      <div className="panel p-4 border-l-4 border-neon-purple">
        <h3 className="font-semibold text-neon-purple mb-2 flex items-center gap-2">
          <Rocket className="w-4 h-4" />
          Founder Intent Structural
        </h3>
        <p className="text-sm text-gray-400">
          This lens embodies the 400-year vision: a self-sustaining cognitive system
          that preserves founder values through structural constraints, not runtime rules.
          The bioAge projection ({bioAge} years) indicates organism health and expected
          continuity based on current organ states and homeostasis levels.
        </p>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="legacy"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Migration Status */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-neon-cyan" />
          Migration Status
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Track the migration progress of legacy systems into the Lattice cognitive architecture.
        </p>

        <div className="space-y-4">
          {/* Oracle Database */}
          <div className="bg-black/40 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-neon-green/10 rounded-lg">
                  <Database className="w-4 h-4 text-neon-green" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Oracle Database</p>
                  <p className="text-xs text-gray-500">Relational data store migration</p>
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green">92%</span>
            </div>
            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-neon-green/80 to-neon-green rounded-full transition-all duration-500" style={{ width: '92%' }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-600">Tables: 847/920</span>
              <span className="text-[10px] text-gray-600">ETA: 3 days</span>
            </div>
          </div>

          {/* COBOL Mainframe */}
          <div className="bg-black/40 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-neon-purple/10 rounded-lg">
                  <Server className="w-4 h-4 text-neon-purple" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">COBOL Mainframe</p>
                  <p className="text-xs text-gray-500">Transaction processing system</p>
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple">67%</span>
            </div>
            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-neon-purple/80 to-neon-purple rounded-full transition-all duration-500" style={{ width: '67%' }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-600">Programs: 1,240/1,850</span>
              <span className="text-[10px] text-gray-600">ETA: 2 weeks</span>
            </div>
          </div>

          {/* File System Archives */}
          <div className="bg-black/40 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-neon-cyan/10 rounded-lg">
                  <HardDrive className="w-4 h-4 text-neon-cyan" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">File System Archives</p>
                  <p className="text-xs text-gray-500">Unstructured document store</p>
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-neon-cyan/20 text-neon-cyan">45%</span>
            </div>
            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-neon-cyan/80 to-neon-cyan rounded-full transition-all duration-500" style={{ width: '45%' }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-600">Files: 234K/520K</span>
              <span className="text-[10px] text-gray-600">ETA: 1 month</span>
            </div>
          </div>

          {/* SOAP/REST APIs */}
          <div className="bg-black/40 border border-white/10 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-500/10 rounded-lg">
                  <Cloud className="w-4 h-4 text-yellow-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">SOAP/REST APIs</p>
                  <p className="text-xs text-gray-500">Service endpoint migration</p>
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-500">28%</span>
            </div>
            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-yellow-500/80 to-yellow-500 rounded-full transition-all duration-500" style={{ width: '28%' }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-gray-600">Endpoints: 56/200</span>
              <span className="text-[10px] text-gray-600">ETA: 6 weeks</span>
            </div>
          </div>
        </div>

        {/* Overall Summary */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Overall Migration Progress</span>
            <span className="text-sm font-mono text-neon-cyan">58%</span>
          </div>
          <div className="w-full h-3 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-neon-purple via-neon-cyan to-neon-green rounded-full transition-all duration-500"
              style={{ width: '58%' }}
            />
          </div>
          <p className="text-xs text-gray-600 mt-2">
            2,377 of 3,490 total components migrated across all legacy systems
          </p>
        </div>
      </div>

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Archive className="w-4 h-4 text-neon-purple" />
          Legacy Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'technicalDebt', label: 'Technical Debt' },
            { action: 'migrationReadiness', label: 'Migration Readiness' },
            { action: 'riskMap', label: 'Risk Map' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'modules' in actionResult && Array.isArray(actionResult.modules) && (
              <div className="space-y-2">
                {'summary' in actionResult && actionResult.summary !== null && typeof actionResult.summary === 'object' && (
                  <div className="flex flex-wrap gap-4 text-xs">
                    {Object.entries(actionResult.summary as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan font-bold">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {'topDebtSources' in actionResult && Array.isArray(actionResult.topDebtSources) && actionResult.topDebtSources.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-500 uppercase tracking-wider">Top Debt Sources</p>
                    {(actionResult.topDebtSources as Array<Record<string, unknown>>).map((m, i) => (
                      <div key={i} className="flex justify-between text-xs bg-lattice-surface rounded px-2 py-1">
                        <span className="text-gray-300">{String(m.name || m.module)}</span>
                        <span className="text-red-400">{String(m.debtScore || m.score || 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'moduleReadiness' in actionResult && Array.isArray(actionResult.moduleReadiness) && (
              <div className="space-y-2">
                {'summary' in actionResult && actionResult.summary !== null && typeof actionResult.summary === 'object' && (
                  <div className="flex flex-wrap gap-4 text-xs">
                    {Object.entries(actionResult.summary as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {'migrationOrder' in actionResult && Array.isArray(actionResult.migrationOrder) && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Migration Order</p>
                    <div className="flex flex-wrap gap-1">
                      {(actionResult.migrationOrder as Array<{phase: number; module: string; readiness: number}>).map((m, i) => (
                        <span key={i} className="text-xs bg-neon-cyan/10 border border-neon-cyan/20 rounded px-2 py-0.5 text-neon-cyan">{m.phase}. {m.module}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {'components' in actionResult && Array.isArray(actionResult.components) && (
              <div className="space-y-2">
                {'summary' in actionResult && actionResult.summary !== null && typeof actionResult.summary === 'object' && (
                  <div className="flex flex-wrap gap-4 text-xs">
                    {Object.entries(actionResult.summary as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-yellow-400">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {'keyPersonRisks' in actionResult && Array.isArray(actionResult.keyPersonRisks) && actionResult.keyPersonRisks.length > 0 && (
                  <div>
                    <p className="text-xs text-red-400 font-semibold mb-1">Key Person Risks</p>
                    {(actionResult.keyPersonRisks as Array<{person: string; componentCount: number; components: string[]}>).map((r, i) => (
                      <div key={i} className="text-xs bg-red-400/10 border border-red-400/20 rounded px-2 py-1 mb-1 text-red-400">
                        {String(r.person)} — {String(r.componentCount)} components
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
          </div>
        )}
      </div>

      <ConnectiveTissueBar lensId="legacy" />

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="legacy" />
          </div>
        )}
      </div>
    </div>
  );
}
