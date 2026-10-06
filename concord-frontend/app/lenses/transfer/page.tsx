'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TransferRepos } from '@/components/transfer/TransferRepos';
import { EtlWorkbench } from '@/components/transfer/EtlWorkbench';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Shuffle, Search, ArrowRight, History, Layers, GitCompare, Network, SendHorizontal, CheckCircle2, Boxes, FileSearch,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { TransferAnalysisPanel } from '@/components/transfer/TransferAnalysisPanel';

type TransferView = 'analogies' | 'etl' | 'migration' | 'repos';

const VIEWS: { id: TransferView; label: string; title: string; hint: string; icon: typeof Shuffle }[] = [
  { id: 'analogies', label: 'Analogies', title: 'What carries over', hint: 'Find analogies, classify domains, review history', icon: Shuffle },
  { id: 'etl', label: 'ETL workbench', title: 'Move the data', hint: 'Connectors, pipelines, transforms and sync', icon: Network },
  { id: 'migration', label: 'Migration', title: 'Plan the migration', hint: 'Schema mapping, data quality and migration plan', icon: FileSearch },
  { id: 'repos', label: 'Repos', title: 'Open-source ETL tooling', hint: 'ETL and data-migration repos on GitHub', icon: Boxes },
];

export default function TransferLensPage() {
  useLensNav('transfer');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('transfer');

  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<TransferView>('analogies');
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
      ...VIEWS.map((v, i) => ({ id: `goto-${v.id}`, keys: String(i + 1), description: `${v.label} — ${v.hint}`, category: 'navigation' as const, action: () => setView(v.id) })),
      { id: 'focus-source',   keys: 'a', description: 'Focus analogy source', category: 'navigation', action: () => { setView('analogies'); setTimeout(() => sourceInputRef.current?.focus(), 0); } },
      { id: 'focus-classify', keys: 'c', description: 'Focus classify field', category: 'navigation', action: () => { setView('analogies'); setTimeout(() => classifyInputRef.current?.focus(), 0); } },
      { id: 'find-analogies', keys: 'mod+enter', description: 'Find analogies', category: 'actions',
        action: () => { if (sourceText.trim() && !findAnalogies.isPending) findAnalogies.mutate(); }, global: true },
    ],
    { lensId: 'transfer' }
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="transfer" asMain={false}>
      <FirstRunTour lensId="transfer" />
      <DepthBadge lensId="transfer" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="transfer"
        crumb="Transfer"
        title={`${current.title}${view === 'analogies' && who ? `, ${who}` : ''}`}
        subtitle="Transfer learning: find analogies, classify domains, apply patterns across contexts, and move data between systems."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="transfer" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        )}
        tabs={VIEWS.map((v, i) => ({ id: v.id, label: v.label, icon: v.icon, keys: String(i + 1), hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as TransferView)}
        tabsLabel="Transfer views"
        cta={{ label: 'Find analogies', icon: Search, onClick: () => { setView('analogies'); setTimeout(() => sourceInputRef.current?.focus(), 0); }, title: 'Jump to the analogy finder (A)' }}
      >
        {isLoading && (
          <div role="status" aria-live="polite" className="mb-4 rounded-2xl border border-white/10 bg-[#111] p-4 text-sm text-zinc-400">Loading transfer history…</div>
        )}
        {isError && (
          <div className="mb-4"><ErrorState error={error?.message} onRetry={refetch} /></div>
        )}

        <div className="space-y-5">
          {view === 'analogies' && (
            <>
      {/* Stats Row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <SendHorizontal className="w-5 h-5 text-neon-purple mb-2" />
                  <p className="text-2xl font-bold">{transfers.filter((t: Record<string, unknown>) => t.status === 'pending' || !t.status).length}</p>
                  <p className="text-sm text-gray-400">Transfers Pending</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <CheckCircle2 className="w-5 h-5 text-neon-green mb-2" />
                  <p className="text-2xl font-bold">{transfers.filter((t: Record<string, unknown>) => t.status === 'completed').length || transfers.length}</p>
                  <p className="text-sm text-gray-400">Completed</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <Shuffle className="w-5 h-5 text-neon-cyan mb-2" />
                  <p className="text-2xl font-bold">{transfers.length}</p>
                  <p className="text-sm text-gray-400">Total Volume</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <GitCompare className="w-5 h-5 text-yellow-400 mb-2" />
                  <p className="text-2xl font-bold">{[...new Set(transfers.map((t: Record<string, unknown>) => t.domain || t.target).filter(Boolean))].length}</p>
                  <p className="text-sm text-gray-400">Domains</p>
                </div>
              </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  {/* Find Analogies */}
                  <div className="rounded-2xl border border-white/10 bg-[#111] p-4 space-y-3">
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
                  <div className="rounded-2xl border border-white/10 bg-[#111] p-4 space-y-3">
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
                  <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
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

                  <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                    <h2 className="font-semibold mb-3 flex items-center gap-2">
                      <History className="w-4 h-4 text-neon-blue" /> Transfer History
                    </h2>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {transfers.length > 0 ? transfers.map((t: Record<string, unknown>, i: number) => (
                        <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="rounded-xl border border-white/10 bg-[#111] p-3 text-xs">
                          <p className="font-medium">{(t.source as string) || (t.pattern as string)}</p>
                          <p className="text-gray-400">{(t.target as string) || (t.domain as string)}</p>
                        </motion.div>
                      )) : (
                        <p className="text-center py-4 text-gray-400 text-sm">No transfers yet</p>
                      )}
                    </div>
                  </div>
                </div>

              </div>
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
            </>
          )}

          {view === 'etl' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <h2 className="mb-1 flex items-center gap-2 font-semibold">
                <Network className="h-4 w-4 text-neon-cyan" /> ETL Workbench: connectors, pipelines &amp; sync
              </h2>
              <p className="mb-4 text-sm text-gray-400">
                Register real CSV/JSON connectors, build transformation pipelines with a drag-connect
                mapping editor, dry-run a preview, then run full or incremental change-data-capture syncs.
                Every metric below is computed live from your own data.
              </p>
              <EtlWorkbench />
            </section>
          )}

          {view === 'migration' && <TransferAnalysisPanel />}

          {view === 'repos' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <TransferRepos />
            </section>
          )}

          <ConnectiveTissueBar lensId="transfer" />
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
