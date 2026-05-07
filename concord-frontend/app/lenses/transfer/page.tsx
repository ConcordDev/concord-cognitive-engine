'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Shuffle, Search, ArrowRight, History, Layers, GitCompare, ChevronDown, Network, Globe, BookOpen, Cpu, Zap, Link2, SendHorizontal, CheckCircle2, X,
} from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';

export default function TransferLensPage() {
  useLensNav('transfer');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('transfer');

  const [sourceText, setSourceText] = useState('');
  const [targetDomain, setTargetDomain] = useState('');
  const [classifyText, setClassifyText] = useState('');
  const [results, setResults] = useState<unknown>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  const { items: transferItems } = useLensData<Record<string, unknown>>('transfer', 'analogy');
  const runTransferAction = useRunArtifact('transfer');
  const [transferActionResult, setTransferActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [transferActiveAction, setTransferActiveAction] = useState<string | null>(null);

  const handleTransferAction = useCallback(async (action: string) => {
    const id = transferItems[0]?.id;
    if (!id) return;
    setTransferActiveAction(action);
    try {
      const res = await runTransferAction.mutateAsync({ id, action });
      if (res.ok) setTransferActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setTransferActiveAction(null);
    }
  }, [transferItems, runTransferAction]);

  // --- Lens Bridge ---
  const bridge = useLensBridge('transfer', 'analogy');

  const { data: history, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['transfer-history'],
    queryFn: () => apiHelpers.transfer.history().then((r) => r.data),
  });

  const findAnalogies = useMutation({
    mutationFn: () => apiHelpers.transfer.analogies({ source: sourceText, target: targetDomain || undefined }),
    onSuccess: (res) => setResults(res.data),
    onError: (err) => console.error('findAnalogies failed:', err instanceof Error ? err.message : err),
  });

  const classifyDomain = useMutation({
    mutationFn: () => apiHelpers.transfer.classifyDomain({ content: classifyText }),
    onSuccess: (res) => setResults(res.data),
    onError: (err) => console.error('classifyDomain failed:', err instanceof Error ? err.message : err),
  });

  const transfers = useMemo(() => history?.transfers || history || [], [history]);

  // Bridge transfer history into lens artifacts
  useEffect(() => {
    bridge.syncList(Array.isArray(transfers) ? transfers : [], (t) => {
      const xfer = t as Record<string, unknown>;
      return { title: `Transfer: ${xfer.source || xfer.id || 'unknown'}`, data: xfer };
    });
  }, [transfers, bridge]);

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

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <div data-lens-theme="transfer" className="p-6 space-y-6">
      <header className="flex items-center gap-3">
        <span className="text-2xl">🔄</span>
        <div>
          <h1 className="text-xl font-bold">Transfer Lens</h1>
          <p className="text-sm text-gray-400">
            Transfer learning — find analogies, classify domains, apply patterns across contexts
          </p>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="transfer" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </header>

      {/* AI Actions */}
      <UniversalActions domain="transfer" artifactId={bridge.selectedId} compact />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <SendHorizontal className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{transfers.filter((t: Record<string, unknown>) => t.status === 'pending' || !t.status).length}</p>
          <p className="text-sm text-gray-400">Transfers Pending</p>
        </div>
        <div className="lens-card">
          <CheckCircle2 className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{transfers.filter((t: Record<string, unknown>) => t.status === 'completed').length || transfers.length}</p>
          <p className="text-sm text-gray-400">Completed</p>
        </div>
        <div className="lens-card">
          <Shuffle className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{transfers.length}</p>
          <p className="text-sm text-gray-400">Total Volume</p>
        </div>
        <div className="lens-card">
          <GitCompare className="w-5 h-5 text-yellow-400 mb-2" />
          <p className="text-2xl font-bold">{[...new Set(transfers.map((t: Record<string, unknown>) => t.domain || t.target).filter(Boolean))].length}</p>
          <p className="text-sm text-gray-400">Domains</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          {/* Find Analogies */}
          <div className="panel p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Search className="w-4 h-4 text-neon-cyan" /> Find Analogies
            </h2>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Source concept or knowledge..."
              className="input-lattice w-full h-24 resize-none"
            />
            <input
              type="text"
              value={targetDomain}
              onChange={(e) => setTargetDomain(e.target.value)}
              placeholder="Target domain (optional)..."
              className="input-lattice w-full"
            />
            <button
              onClick={() => findAnalogies.mutate()}
              disabled={!sourceText || findAnalogies.isPending}
              className="btn-neon purple w-full"
            >
              {findAnalogies.isPending ? 'Searching...' : 'Find Analogies'}
            </button>
          </div>

          {/* Classify Domain */}
          <div className="panel p-4 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4 text-neon-green" /> Classify Domain
            </h2>
            <input
              type="text"
              value={classifyText}
              onChange={(e) => setClassifyText(e.target.value)}
              placeholder="Content to classify..."
              className="input-lattice w-full"
            />
            <button
              onClick={() => classifyDomain.mutate()}
              disabled={!classifyText || classifyDomain.isPending}
              className="btn-neon w-full"
            >
              {classifyDomain.isPending ? 'Classifying...' : 'Classify'}
            </button>
          </div>
        </div>

        {/* Results + History */}
        <div className="space-y-4">
          <div className="panel p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-neon-purple" /> Results
            </h2>
            {results ? (
              <pre className="bg-lattice-surface p-3 rounded-lg whitespace-pre-wrap text-xs text-gray-300 font-mono max-h-64 overflow-y-auto">
                {JSON.stringify(results, null, 2)}
              </pre>
            ) : (
              <p className="text-center py-8 text-gray-500 text-sm">Run an operation to see results</p>
            )}
          </div>

          <div className="panel p-4">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <History className="w-4 h-4 text-neon-blue" /> Transfer History
            </h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {transfers.length > 0 ? transfers.map((t: Record<string, unknown>, i: number) => (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="lens-card text-xs">
                  <p className="font-medium">{(t.source as string) || (t.pattern as string)}</p>
                  <p className="text-gray-400">{(t.target as string) || (t.domain as string)}</p>
                </motion.div>
              )) : (
                <p className="text-center py-4 text-gray-500 text-sm">No transfers yet</p>
              )}
            </div>
          </div>
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="transfer"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Knowledge Transfer - Domain Mapping */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Network className="w-4 h-4 text-neon-cyan" />
          Knowledge Transfer - Domain Mapping
        </h2>
        <p className="text-sm text-gray-400 mb-4">
          Visualize how knowledge domains connect and transfer patterns across the cognitive lattice.
        </p>

        {/* Domain Mapping Visualization */}
        <div className="bg-black/40 border border-white/10 rounded-lg p-6">
          <div className="grid grid-cols-3 gap-4 items-center">
            {/* Source Domains */}
            <div className="space-y-3">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider block text-center mb-2">Source Domains</span>
              {[
                { name: 'Machine Learning', icon: Cpu, color: 'neon-purple' },
                { name: 'Linguistics', icon: BookOpen, color: 'neon-cyan' },
                { name: 'Biology', icon: Globe, color: 'neon-green' },
              ].map((domain) => {
                const Icon = domain.icon;
                return (
                  <div key={domain.name} className={`bg-${domain.color}/5 border border-${domain.color}/20 rounded-lg p-3 flex items-center gap-2`}>
                    <Icon className={`w-4 h-4 text-${domain.color}`} />
                    <span className="text-xs text-white">{domain.name}</span>
                  </div>
                );
              })}
            </div>

            {/* Connections Visualization */}
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="w-full flex items-center justify-center gap-1">
                <div className="h-px flex-1 bg-gradient-to-r from-neon-purple/40 to-neon-cyan/40" />
                <Zap className="w-4 h-4 text-neon-cyan animate-pulse" />
                <div className="h-px flex-1 bg-gradient-to-r from-neon-cyan/40 to-neon-green/40" />
              </div>
              <div className="bg-black/60 border border-neon-cyan/20 rounded-lg p-3 text-center">
                <Link2 className="w-5 h-5 text-neon-cyan mx-auto mb-1" />
                <span className="text-[10px] text-gray-400 block">Transfer Engine</span>
                <span className="text-xs font-mono text-neon-cyan">12 active</span>
              </div>
              <div className="w-full flex items-center justify-center gap-1">
                <div className="h-px flex-1 bg-gradient-to-r from-neon-purple/40 to-neon-cyan/40" />
                <Zap className="w-4 h-4 text-neon-purple animate-pulse" />
                <div className="h-px flex-1 bg-gradient-to-r from-neon-cyan/40 to-neon-green/40" />
              </div>
            </div>

            {/* Target Domains */}
            <div className="space-y-3">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider block text-center mb-2">Target Domains</span>
              {[
                { name: 'Finance', icon: Shuffle, color: 'neon-green' },
                { name: 'Healthcare', icon: Globe, color: 'neon-purple' },
                { name: 'Education', icon: BookOpen, color: 'neon-cyan' },
              ].map((domain) => {
                const Icon = domain.icon;
                return (
                  <div key={domain.name} className={`bg-${domain.color}/5 border border-${domain.color}/20 rounded-lg p-3 flex items-center gap-2`}>
                    <Icon className={`w-4 h-4 text-${domain.color}`} />
                    <span className="text-xs text-white">{domain.name}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Transfer Metrics */}
          <div className="grid grid-cols-4 gap-3 mt-6 pt-4 border-t border-white/5">
            <div className="text-center">
              <p className="text-lg font-bold text-neon-cyan">847</p>
              <p className="text-[10px] text-gray-500">Patterns Mapped</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-neon-purple">94%</p>
              <p className="text-[10px] text-gray-500">Transfer Accuracy</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-neon-green">23</p>
              <p className="text-[10px] text-gray-500">Active Bridges</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-yellow-400">1.2s</p>
              <p className="text-[10px] text-gray-500">Avg. Latency</p>
            </div>
          </div>
        </div>
      </div>

      <ConnectiveTissueBar lensId="transfer" />

      {/* Transfer Actions Panel */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-purple" />
            Transfer Actions
          </h3>
          {transferActionResult && (
            <button onClick={() => setTransferActionResult(null)} className="p-1 rounded hover:bg-white/5 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['schemaMapping', 'dataQuality', 'migrationPlan'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleTransferAction(action)}
              disabled={!transferItems[0]?.id || transferActiveAction !== null}
              className="px-3 py-1.5 text-sm rounded-lg bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {transferActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-purple border-t-transparent rounded-full animate-spin" />
              ) : null}
              {action === 'schemaMapping' ? 'Schema Mapping' : action === 'dataQuality' ? 'Data Quality' : 'Migration Plan'}
            </button>
          ))}
        </div>
        {transferActionResult && (
          <div className="panel p-3 space-y-2 text-sm">
            {transferActionResult.action === 'schemaMapping' && (() => {
              const r = transferActionResult.result;
              const coverage = r.coverage as Record<string, unknown> | undefined;
              return (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span className="text-gray-400">Mappings: <span className="text-white font-medium">{String(r.mappingCount ?? 0)}</span></span>
                    <span className="text-gray-400">Avg Confidence: <span className="text-white font-medium">{String(r.averageConfidence ?? 0)}</span></span>
                    <span className="text-gray-400">Transforms Needed: <span className="text-white font-medium">{String(r.transformsRequired ?? 0)}</span></span>
                  </div>
                  {coverage && (
                    <div className="flex gap-4 text-xs">
                      <span className="text-gray-400">Source Coverage: <span className="text-neon-cyan">{String(coverage.sourceFieldsMapped ?? '-')}</span></span>
                      <span className="text-gray-400">Target Coverage: <span className="text-neon-cyan">{String(coverage.targetFieldsMapped ?? '-')}</span></span>
                      <span className={`text-xs font-medium ${(coverage.allRequiredMapped) ? 'text-neon-green' : 'text-red-400'}`}>
                        {coverage.allRequiredMapped ? '✓ All required mapped' : '✗ Required fields missing'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
            {transferActionResult.action === 'dataQuality' && (() => {
              const r = transferActionResult.result;
              const quality = r.overallQuality as Record<string, unknown> | undefined;
              const grade = String(quality?.grade ?? '-');
              const gradeColor = grade === 'A' ? 'text-neon-green' : grade === 'B' ? 'text-blue-400' : grade === 'C' ? 'text-yellow-400' : 'text-red-400';
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">Grade:</span>
                    <span className={`text-lg font-bold ${gradeColor}`}>{grade}</span>
                    <span className="text-gray-400 text-xs ml-2">Score: <span className="text-white">{String(quality?.compositeScore ?? 0)}</span></span>
                    <span className={`text-xs ml-2 font-medium ${r.transferReadiness === 'ready' ? 'text-neon-green' : 'text-yellow-400'}`}>
                      {r.transferReadiness === 'ready' ? '✓ Ready' : '⚠ Needs Remediation'}
                    </span>
                  </div>
                  {quality && (
                    <div className="flex gap-4 text-xs">
                      <span className="text-gray-400">Completeness: <span className="text-white">{String(quality.completeness ?? 0)}</span></span>
                      <span className="text-gray-400">Accuracy: <span className="text-white">{String(quality.accuracy ?? 0)}</span></span>
                      <span className="text-gray-400">Consistency: <span className="text-white">{String(quality.consistency ?? 0)}</span></span>
                    </div>
                  )}
                </div>
              );
            })()}
            {transferActionResult.action === 'migrationPlan' && (() => {
              const r = transferActionResult.result;
              const summary = r.summary as Record<string, unknown> | undefined;
              const critPath = Array.isArray(r.criticalPath) ? r.criticalPath as string[] : [];
              return (
                <div className="space-y-2">
                  {summary && (
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className="text-gray-400">Entities: <span className="text-white">{String(summary.totalEntities ?? 0)}</span></span>
                      <span className="text-gray-400">Batches: <span className="text-white">{String(summary.totalBatches ?? 0)}</span></span>
                      <span className="text-gray-400">Checkpoints: <span className="text-white">{String(summary.totalCheckpoints ?? 0)}</span></span>
                      <span className="text-gray-400">Phases: <span className="text-white">{String(summary.totalPhases ?? 0)}</span></span>
                      <span className="text-gray-400">Steps: <span className="text-white">{String(r.estimatedSteps ?? 0)}</span></span>
                    </div>
                  )}
                  {critPath.length > 0 && (
                    <div className="text-xs text-gray-400">Critical Path: {critPath.map((c, i) => <span key={i} className="text-neon-cyan ml-1">{c}</span>)}</div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

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
            <LensFeaturePanel lensId="transfer" />
          </div>
        )}
      </div>
    </div>
  );
}
