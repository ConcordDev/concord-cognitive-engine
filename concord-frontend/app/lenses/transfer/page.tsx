'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
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
import { lensRun } from '@/lib/api/client';
import { KeepRecordActions } from '@/components/lens/KeepRecordActions';
import { transferKeptRecord } from '@/components/transfer/transferKeep';

interface AnalogyMappingRow { from: string; to: string; relation: string }
interface AnalogyResult {
  patternId?: string | null; dtuId?: string; patternName: string;
  sourceDomain: string; targetDomain: string; relevance: number;
  kind?: string; mapping?: AnalogyMappingRow[]; sharedTerms?: string[];
  template?: unknown;
}
interface AnalogyResponse { ok?: boolean; results?: AnalogyResult[]; scanned?: { patterns: number; dtus: number }; error?: string }
interface ClassifyResponse { ok?: boolean; domain?: string; matchedKeywords?: string[]; basis?: string; error?: string }

type TransferView = 'analogies' | 'etl' | 'migration' | 'repos';

const VIEWS: { id: TransferView; label: string; hint: string; icon: typeof Shuffle }[] = [
  { id: 'analogies', label: 'Analogies', hint: 'Find analogies, classify domains, review history', icon: Shuffle },
  { id: 'etl', label: 'ETL workbench', hint: 'Connectors, pipelines, transforms and sync', icon: Network },
  { id: 'migration', label: 'Migration', hint: 'Schema mapping, data quality and migration plan', icon: FileSearch },
  { id: 'repos', label: 'Repos', hint: 'ETL and data-migration repos on GitHub', icon: Boxes },
];

export default function TransferLensPage() {
  useLensNav('transfer');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('transfer');

  const [view, setView] = useState<TransferView>('analogies');
  const [sourceText, setSourceText] = useState('');
  const [targetDomain, setTargetDomain] = useState('');
  const [classifyText, setClassifyText] = useState('');
  const [analogyData, setAnalogyData] = useState<AnalogyResponse | null>(null);
  const [analogyError, setAnalogyError] = useState<string | null>(null);
  const [classifyData, setClassifyData] = useState<ClassifyResponse | null>(null);
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const classifyInputRef = useRef<HTMLInputElement>(null);

  const { data: history, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['transfer-history'],
    queryFn: () => apiHelpers.transfer.history().then((r) => r.data),
  });

  // The ETL run log — the lens's other ledger (S-TR-3). The Analogies
  // surface drinks from both stores; neither is hidden from the other.
  const { data: runLog } = useQuery({
    queryKey: ['transfer-run-log'],
    queryFn: () => lensRun('transfer', 'run-log', {}).then((r) => (r.data?.result ?? null) as { runs?: Array<Record<string, unknown>> } | null),
  });
  const syncRuns = useMemo(() => (Array.isArray(runLog?.runs) ? runLog.runs : []), [runLog]);

  const findAnalogies = useMutation({
    mutationFn: () => apiHelpers.transfer.analogies({ source: sourceText, target: targetDomain || undefined }),
    onSuccess: (res) => { setAnalogyData(res.data as AnalogyResponse); setAnalogyError(null); setClassifyData(null); },
    onError: (err) => { setAnalogyData(null); setAnalogyError(err instanceof Error ? err.message : 'Analogy search failed'); },
  });

  const classifyDomain = useMutation({
    mutationFn: () => apiHelpers.transfer.classifyDomain({ content: classifyText }),
    onSuccess: (res) => { setClassifyData(res.data as ClassifyResponse); setAnalogyData(null); setAnalogyError(null); },
    onError: (err) => { setClassifyData({ ok: false, error: err instanceof Error ? err.message : 'Classification failed' }); },
  });

  const transfers = useMemo(() => history?.transfers || history || [], [history]);

  // One ledger (S-TR-3): stats and history count the lens's transfers —
  // pattern transfers and ETL syncs alike, each labelled for what it is.
  const completedCount = useMemo(
    () => transfers.filter((t: Record<string, unknown>) => t.status === 'completed').length
      + syncRuns.filter((r) => r.status === 'success' || r.status === 'partial').length,
    [transfers, syncRuns],
  );
  const rowsMoved = useMemo(
    () => syncRuns.reduce((sum, r) => sum + (Number(r.rowsWritten) || 0), 0),
    [syncRuns],
  );
  const historyEntries = useMemo(() => {
    const patternEntries = (transfers as Array<Record<string, unknown>>).map((t) => ({
      kind: 'pattern' as const,
      title: `${(t.sourceDomain as string) || 'pattern'} → ${(t.targetDomain as string) || ''}`,
      sub: `pattern transfer · ${(t.status as string) || 'recorded'}${t.confidence != null ? ` · confidence ${t.confidence}` : ''}`,
      at: (t.createdAt as string) || '',
    }));
    const syncEntries = syncRuns.map((r) => ({
      kind: 'sync' as const,
      title: (r.pipelineName as string) || 'sync',
      sub: `ETL sync · ${(r.mode as string) || 'full'} · ${Number(r.rowsWritten) || 0} written${Number(r.rowsSkippedDuplicates) ? ` · ${Number(r.rowsSkippedDuplicates)} duplicates skipped` : ''} · ${(r.status as string) || ''}`,
      at: (r.finishedAt as string) || '',
    }));
    return [...patternEntries, ...syncEntries].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }, [transfers, syncRuns]);

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


  return (
    <LensShell lensId="transfer" asMain={false}>

      <DepthBadge lensId="transfer" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="transfer"
        crumb="Transfer"
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
                  <p className="text-2xl font-bold">{completedCount}</p>
                  <p className="text-sm text-gray-400">Completed (syncs + pattern transfers)</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <Shuffle className="w-5 h-5 text-neon-cyan mb-2" />
                  <p className="text-2xl font-bold">{rowsMoved}</p>
                  <p className="text-sm text-gray-400">Rows Moved (ETL syncs)</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                  <GitCompare className="w-5 h-5 text-yellow-400 mb-2" />
                  <p className="text-2xl font-bold">{[...new Set(transfers.map((t: Record<string, unknown>) => t.targetDomain || t.domain).filter(Boolean))].length}</p>
                  <p className="text-sm text-gray-400">Domains (pattern transfers)</p>
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
                    {analogyError && (
                      <p className="text-sm text-rose-300">Analogy search failed: {analogyError}</p>
                    )}
                    {classifyData && (
                      classifyData.ok === false ? (
                        <p className="text-sm text-rose-300">Classification failed: {classifyData.error || 'the classifier refused the input'}.</p>
                      ) : (
                        <div className="space-y-1 text-sm">
                          <p className="text-gray-200">
                            Classified as <span className="font-semibold text-neon-green">{classifyData.domain}</span>
                            {classifyData.basis === 'content' ? ' — from the content in the box.' : '.'}
                          </p>
                          {classifyData.matchedKeywords && classifyData.matchedKeywords.length > 0 ? (
                            <p className="text-xs text-gray-400">Matched keywords: {classifyData.matchedKeywords.join(', ')} — the words that decided it.</p>
                          ) : (
                            <p className="text-xs text-gray-400">No domain keywords matched, so it lands in general.</p>
                          )}
                        </div>
                      )
                    )}
                    {analogyData && (
                      analogyData.ok === false ? (
                        <p className="text-sm text-rose-300">Analogy search failed: {analogyData.error || 'the search refused the input'}.</p>
                      ) : (analogyData.results && analogyData.results.length > 0 ? (
                        <div className="space-y-3">
                          {analogyData.results.map((r, i) => (
                            <div key={r.patternId || r.dtuId || i} className="rounded-xl border border-white/10 bg-black/30 p-3 space-y-1.5">
                              <p className="text-sm font-medium text-gray-100">{r.patternName}</p>
                              <p className="text-[11px] text-gray-400">
                                {r.kind === 'pattern' ? 'Extracted pattern' : 'From a DTU the platform holds'} · {r.sourceDomain} → {r.targetDomain} · relevance {Math.round(r.relevance * 100)}%
                              </p>
                              {r.mapping && r.mapping.length > 0 ? (
                                <div className="space-y-0.5">
                                  {r.mapping.map((m, j) => (
                                    <p key={j} className="text-xs text-gray-300">
                                      <span className="text-neon-cyan">{m.from}</span>
                                      <span className="text-gray-500"> → </span>
                                      {m.to}
                                      <span className="text-gray-500"> · {m.relation}</span>
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-gray-500">No element mapping recorded for this result.</p>
                              )}
                            </div>
                          ))}
                          <KeepRecordActions
                            record={transferKeptRecord({
                              source: sourceText,
                              target: targetDomain,
                              result: {
                                ...analogyData,
                                results: (analogyData.results || []).map((r) => ({
                                  ...r,
                                  template: typeof r.template === 'string' ? r.template : undefined,
                                })),
                              },
                            })}
                            saveLabel="Keep these analogies"
                          />
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">
                          Nothing the platform holds matches that pair yet — no extracted pattern and no DTU shares its terms
                          {analogyData.scanned ? ` (searched ${analogyData.scanned.patterns} patterns and ${analogyData.scanned.dtus} DTUs)` : ''}.
                          Try broader terms, or a concept the platform already holds work about.
                        </p>
                      ))
                    )}
                    {!analogyError && !classifyData && !analogyData && (
                      <p className="text-center py-8 text-gray-400 text-sm">Run an operation to see results</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                    <h2 className="font-semibold mb-3 flex items-center gap-2">
                      <History className="w-4 h-4 text-neon-blue" /> Transfer History
                    </h2>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {historyEntries.length > 0 ? historyEntries.map((entry, i) => (
                        <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="rounded-xl border border-white/10 bg-[#111] p-3 text-xs">
                          <p className="font-medium">{entry.title}</p>
                          <p className="text-gray-400">{entry.sub}{entry.at ? ` · ${new Date(entry.at).toLocaleString()}` : ''}</p>
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
