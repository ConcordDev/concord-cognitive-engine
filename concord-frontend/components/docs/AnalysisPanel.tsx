'use client';

/**
 * AI Document Analysis — readabilityScore / crossReference / versionDiff,
 * bound to the workspace's real documents (S-DOCS-1 / F3).
 *
 * The three computations live server-side as artifact-form handlers
 * (they read artifact.data), but the workspace's documents are
 * domain-state pages and nothing mints a 'document' artifact from a
 * page — so the previous binding (the lens-data hook over 'document' artifacts)
 * left the tools permanently disabled over real documents. The panel
 * now picks a page from page-list and runs the page-bound
 * docs-analyze action, which synthesizes each handler's input from
 * the page store and delegates to the same computation. Results name
 * the page they describe.
 */

import { useCallback, useEffect, useState } from 'react';
import { Zap, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { PageMeta } from './types';

interface SnapshotMeta { id: string; label: string; createdAt?: string }

type Tool = 'readabilityScore' | 'crossReference' | 'versionDiff';

export function AnalysisPanel() {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [pageId, setPageId] = useState<string>('');
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [fromSnap, setFromSnap] = useState<string>('');
  const [toSnap, setToSnap] = useState<string>('current');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [activeAction, setActiveAction] = useState<Tool | null>(null);
  const [loadNote, setLoadNote] = useState<string | null>(null);

  const loadPages = useCallback(async () => {
    const r = await lensRun<{ pages?: PageMeta[] }>('docs', 'page-list', {});
    if (r.data?.ok) {
      const list = r.data.result?.pages ?? [];
      setPages(list);
      setLoadNote(null);
      setPageId((prev) => {
        if (prev && list.some((pg) => pg.id === prev)) return prev;
        const sorted = [...list].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
        return sorted[0]?.id ?? '';
      });
    } else {
      setLoadNote('Could not load the workspace pages.');
    }
  }, []);

  useEffect(() => { void loadPages(); }, [loadPages]);

  useEffect(() => {
    if (!pageId) { setSnapshots([]); return; }
    let alive = true;
    void lensRun<{ snapshots?: SnapshotMeta[] }>('docs', 'version-list', { pageId }).then((r) => {
      if (!alive) return;
      const list = r.data?.ok ? (r.data.result?.snapshots ?? []) : [];
      setSnapshots(list);
      setFromSnap(list[0]?.id ?? '');
      setToSnap('current');
    });
    return () => { alive = false; };
  }, [pageId]);

  const handleDocsAction = useCallback(
    async (tool: Tool) => {
      if (!pageId) return;
      setActiveAction(tool);
      setActionResult(null);
      try {
        const r = await lensRun<Record<string, unknown>>('docs', 'docs-analyze', {
          pageId,
          tool,
          ...(tool === 'versionDiff'
            ? { fromSnapshotId: fromSnap || undefined, toSnapshotId: toSnap === 'current' ? undefined : toSnap }
            : {}),
        });
        if (r.data?.ok) {
          setActionResult(r.data.result as Record<string, unknown>);
        } else {
          setActionResult({ message: `Action failed: ${r.data?.error || 'Unknown error'}` });
        }
      } catch (e) {
        setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` });
      }
      setActiveAction(null);
    },
    [pageId, fromSnap, toSnap]
  );

  const selectedPage = pages.find((pg) => pg.id === pageId);

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <Zap className="w-4 h-4 text-neon-blue" /> AI Document Analysis
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={pageId}
          onChange={(e) => { setPageId(e.target.value); setActionResult(null); }}
          className="bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 px-2 py-1.5 max-w-full"
          aria-label="Page to analyze"
        >
          {pages.length === 0 && <option value="">No pages yet</option>}
          {pages.map((pg) => (
            <option key={pg.id} value={pg.id}>{pg.icon} {pg.title}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void loadPages()}
          className="flex items-center gap-1 px-2 py-1.5 text-xs rounded bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
        {loadNote && <span className="text-[11px] text-red-400">{loadNote}</span>}
      </div>
      {snapshots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
          <span>Version Diff:</span>
          <select
            value={fromSnap}
            onChange={(e) => setFromSnap(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded text-[11px] text-zinc-200 px-1.5 py-1"
            aria-label="Diff from snapshot"
          >
            {snapshots.map((sn) => (
              <option key={sn.id} value={sn.id}>{sn.label}</option>
            ))}
          </select>
          <span>→</span>
          <select
            value={toSnap}
            onChange={(e) => setToSnap(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded text-[11px] text-zinc-200 px-1.5 py-1"
            aria-label="Diff to"
          >
            <option value="current">Current page</option>
            {snapshots.map((sn) => (
              <option key={sn.id} value={sn.id}>{sn.label}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {(['readabilityScore', 'crossReference', 'versionDiff'] as const).map((action) => (
          <button
            key={action}
            onClick={() => void handleDocsAction(action)}
            disabled={activeAction !== null || !pageId}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-neon-blue/10 border border-neon-blue/30 text-neon-blue hover:bg-neon-blue/20 disabled:opacity-50 transition-colors"
          >
            {activeAction === action ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            {action === 'readabilityScore'
              ? 'Readability Score'
              : action === 'crossReference'
                ? 'Cross Reference'
                : 'Version Diff'}
          </button>
        ))}
      </div>
      {selectedPage && (
        <p className="text-[11px] text-gray-400">
          Analyzing “{selectedPage.title}” — the tools run over this page’s real content.
        </p>
      )}
      {!!actionResult?.page && (
        <p className="text-[11px] text-neon-cyan">
          Results for “{String((actionResult.page as Record<string, unknown>).title ?? '')}”
          {actionResult.from !== undefined && actionResult.to !== undefined
            ? ` — ${String(actionResult.from)} → ${String(actionResult.to)}`
            : ''}
        </p>
      )}

        {actionResult &&
          actionResult.metrics !== undefined &&
          actionResult.summary !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number((actionResult.metrics as Record<string, number>)?.fleschReadingEase) >= 60 ? 'text-neon-green' : Number((actionResult.metrics as Record<string, number>)?.fleschReadingEase) >= 30 ? 'text-yellow-400' : 'text-red-400'}`}
                  >
                    {String(
                      (actionResult.metrics as Record<string, number>)?.fleschReadingEase ?? 0
                    )}
                  </p>
                  <p className="text-[10px] text-gray-400">Flesch Ease</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-cyan">
                    {String(
                      (actionResult.summary as Record<string, unknown>)?.averageGradeLevel ?? 0
                    )}
                  </p>
                  <p className="text-[10px] text-gray-400">Grade Level</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-purple">
                    {String((actionResult.statistics as Record<string, unknown>)?.wordCount ?? 0)}
                  </p>
                  <p className="text-[10px] text-gray-400">Words</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-yellow-400">
                    {String(
                      (actionResult.summary as Record<string, unknown>)?.readingTimeMinutes ?? 0
                    )}
                    m
                  </p>
                  <p className="text-[10px] text-gray-400">Read Time</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-xs">
                  <p className="text-gray-400 mb-1">Difficulty</p>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      (actionResult.summary as Record<string, string>)?.difficulty === 'elementary'
                        ? 'bg-neon-green/20 text-neon-green'
                        : (actionResult.summary as Record<string, string>)?.difficulty ===
                            'middle-school'
                          ? 'bg-neon-cyan/20 text-neon-cyan'
                          : (actionResult.summary as Record<string, string>)?.difficulty ===
                              'high-school'
                            ? 'bg-yellow-400/20 text-yellow-400'
                            : 'bg-red-400/20 text-red-400'
                    }`}
                  >
                    {String(
                      (actionResult.summary as Record<string, string>)?.difficulty ?? '—'
                    ).replace('-', ' ')}
                  </span>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-xs">
                  <p className="text-gray-400 mb-1">Flesch Category</p>
                  <span className="text-gray-300">
                    {String(
                      (actionResult.summary as Record<string, string>)?.fleschCategory ?? '—'
                    )}
                  </span>
                </div>
              </div>
              {!!actionResult.technicalIndicators && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-orange-400">
                      {String(
                        (actionResult.technicalIndicators as Record<string, unknown>)
                          ?.abbreviationCount ?? 0
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400">Abbrevs</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-red-400">
                      {String(
                        (actionResult.technicalIndicators as Record<string, unknown>)
                          ?.longSentenceCount ?? 0
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400">Long Sentences</p>
                  </div>
                  <div className="p-2 bg-lattice-surface rounded text-center">
                    <p className="text-sm font-bold text-yellow-400">
                      {String(
                        (actionResult.technicalIndicators as Record<string, unknown>)
                          ?.passiveVoiceInstances ?? 0
                      )}
                    </p>
                    <p className="text-[10px] text-gray-400">Passive Voice</p>
                  </div>
                </div>
              )}
            </div>
          )}

        {/* crossReference result */}
        {actionResult &&
          actionResult.graphDensity !== undefined &&
          actionResult.totalPages !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-cyan">
                    {String(actionResult.totalPages)}
                  </p>
                  <p className="text-[10px] text-gray-400">Pages</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-lg font-bold text-neon-green">
                    {String(actionResult.totalLinks)}
                  </p>
                  <p className="text-[10px] text-gray-400">Links</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number((actionResult.brokenLinks as Record<string, number>)?.count) > 0 ? 'text-red-400' : 'text-neon-green'}`}
                  >
                    {String((actionResult.brokenLinks as Record<string, number>)?.count ?? 0)}
                  </p>
                  <p className="text-[10px] text-gray-400">Broken Links</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.healthScore) >= 80 ? 'text-neon-green' : Number(actionResult.healthScore) >= 60 ? 'text-yellow-400' : 'text-red-400'}`}
                  >
                    {String(actionResult.healthScore ?? 0)}
                  </p>
                  <p className="text-[10px] text-gray-400">Health Score</p>
                </div>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-neon-blue rounded-full transition-all"
                  style={{ width: `${actionResult.healthScore ?? 0}%` }}
                />
              </div>
              {!!actionResult.orphanPages &&
                Number((actionResult.orphanPages as Record<string, number>)?.count) > 0 && (
                  <p className="text-xs text-yellow-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{' '}
                    {String((actionResult.orphanPages as Record<string, number>).count)} orphan
                    page(s)
                  </p>
                )}
              {!!actionResult.circularReferences &&
                Number((actionResult.circularReferences as Record<string, number>)?.count) > 0 && (
                  <p className="text-xs text-red-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />{' '}
                    {String((actionResult.circularReferences as Record<string, number>).count)}{' '}
                    circular reference(s)
                  </p>
                )}
            </div>
          )}

        {/* versionDiff result */}
        {actionResult &&
          actionResult.changeSignificance !== undefined &&
          actionResult.summary !== undefined &&
          actionResult.wordDelta !== undefined && (
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.changeSignificance) >= 70 ? 'text-red-400' : Number(actionResult.changeSignificance) >= 40 ? 'text-yellow-400' : 'text-neon-green'}`}
                  >
                    {String(actionResult.changeSignificance)}
                  </p>
                  <p className="text-[10px] text-gray-400">Significance</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p
                    className={`text-lg font-bold ${Number(actionResult.wordDelta) >= 0 ? 'text-neon-green' : 'text-red-400'}`}
                  >
                    {Number(actionResult.wordDelta) >= 0 ? '+' : ''}
                    {String(actionResult.wordDelta)}
                  </p>
                  <p className="text-[10px] text-gray-400">Word Delta</p>
                </div>
                <div className="p-2 bg-lattice-surface rounded text-center">
                  <p className="text-xs font-bold text-neon-cyan capitalize">
                    {String(actionResult.significanceLabel ?? '—')}
                  </p>
                  <p className="text-[10px] text-gray-400">Label</p>
                </div>
              </div>
              {!!actionResult.summary && (
                <div className="grid grid-cols-5 gap-1 text-center">
                  {Object.entries(actionResult.summary as Record<string, number>).map(
                    ([key, val]) => (
                      <div
                        key={key}
                        className={`p-1.5 rounded text-xs ${
                          key === 'added'
                            ? 'bg-neon-green/10 border border-neon-green/20'
                            : key === 'deleted'
                              ? 'bg-red-400/10 border border-red-400/20'
                              : key === 'modified'
                                ? 'bg-yellow-400/10 border border-yellow-400/20'
                                : key === 'moved'
                                  ? 'bg-neon-purple/10 border border-neon-purple/20'
                                  : 'bg-white/5 border border-white/5'
                        }`}
                      >
                        <p
                          className={`font-bold ${key === 'added' ? 'text-neon-green' : key === 'deleted' ? 'text-red-400' : key === 'modified' ? 'text-yellow-400' : key === 'moved' ? 'text-neon-purple' : 'text-gray-400'}`}
                        >
                          {val}
                        </p>
                        <p className="text-[10px] text-gray-400 capitalize">{key}</p>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )}

        {actionResult && !!actionResult.message && (
          <p className="text-xs text-gray-400 italic pt-1">{String(actionResult.message)}</p>
        )}

    </div>
  );
}
