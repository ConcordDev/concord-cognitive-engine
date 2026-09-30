'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { TransferRepos } from '@/components/transfer/TransferRepos';
import { EtlWorkbench } from '@/components/transfer/EtlWorkbench';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Shuffle, Search, ArrowRight, History, Layers, GitCompare, Network, SendHorizontal, CheckCircle2,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { TransferAnalysisPanel } from '@/components/transfer/TransferAnalysisPanel';

export default function TransferLensPage() {
  useLensNav('transfer');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('transfer');

  const [showEtlWorkbench, setShowEtlWorkbench] = useState(false);
  const [showTransferRepos, setShowTransferRepos] = useState(false);
  const [sourceText, setSourceText] = useState('');
  const [targetDomain, setTargetDomain] = useState('');
  const [classifyText, setClassifyText] = useState('');
  const [results, setResults] = useState<unknown>(null);
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const classifyInputRef = useRef<HTMLInputElement>(null);

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

  useLensCommand(
    [
      { id: 'focus-source',   keys: 'a', description: 'Focus analogy source', category: 'navigation', action: () => sourceInputRef.current?.focus() },
      { id: 'focus-classify', keys: 'c', description: 'Focus classify field', category: 'navigation', action: () => classifyInputRef.current?.focus() },
      { id: 'find-analogies', keys: 'mod+enter', description: 'Find analogies', category: 'actions',
        action: () => { if (sourceText.trim() && !findAnalogies.isPending) findAnalogies.mutate(); }, global: true },
    ],
    { lensId: 'transfer' }
  );

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
    <LensShell lensId="transfer" asMain={false}>
      <FirstRunTour lensId="transfer" />      <DepthBadge lensId="transfer" size="sm" className="ml-2" />
      <LensVerticalHero lensId="transfer" className="mx-6 mt-4" />
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
              ref={sourceInputRef}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sourceText.trim() && !findAnalogies.isPending) { e.preventDefault(); findAnalogies.mutate(); } }}
              placeholder="Source concept or knowledge…  ⌘⏎ finds analogies"
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
              ref={classifyInputRef}
              type="text"
              value={classifyText}
              onChange={(e) => setClassifyText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && classifyText.trim() && !classifyDomain.isPending) { e.preventDefault(); classifyDomain.mutate(); } }}
              placeholder="Content to classify…  ⏎ runs"
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
              <p className="text-center py-8 text-gray-400 text-sm">Run an operation to see results</p>
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
                <p className="text-center py-4 text-gray-400 text-sm">No transfers yet</p>
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

      {/* ETL Workbench — real connectors, pipelines, transforms, sync, run log */}
      <div className="panel p-4">
        <button
          type="button"
          onClick={() => setShowEtlWorkbench(v => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <h2 className="font-semibold flex items-center gap-2">
            <Network className="w-4 h-4 text-neon-cyan" />
            ETL Workbench — Connectors, Pipelines &amp; Sync
          </h2>
          {showEtlWorkbench ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showEtlWorkbench && (
          <>
            <p className="text-sm text-gray-400 mb-4 mt-1">
              Register real CSV/JSON connectors, build transformation pipelines with a drag-connect
              mapping editor, dry-run a preview, then run full or incremental change-data-capture syncs.
              Every metric below is computed live from your own data.
            </p>
            <EtlWorkbench />
          </>
        )}
      </div>

      <ConnectiveTissueBar lensId="transfer" />

      {/* Migration analysis — schema mapping, data quality, migration plan */}
      <TransferAnalysisPanel />

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowTransferRepos(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>ETL / data-migration repos (GitHub)</span>
          {showTransferRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showTransferRepos && (
          <div className="mt-3">
            <TransferRepos />
          </div>
        )}
      </section>
    </div>

      <a href="#transfer-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to transfer content</a>          <CrossLensRecentsPanel lensId="transfer" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
