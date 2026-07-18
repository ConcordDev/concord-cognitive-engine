'use client';

/**
 * PaperVersionHistory — real per-paper version-snapshot history + compare
 * UI. Wires paper.paper-version-save / paper-version-list / paper-version-diff
 * (server/domains/paper.js). This closes the paper lens's ENGINEERING gap
 * documented in docs/lens-specs/paper-capability-map.md: `revisionDiff`
 * previously only diffed caller-supplied text with no persisted history
 * behind it — there was no version-snapshot store to diff against. Now a
 * real snapshot is saved on demand (typically from the notes editor), and
 * the diff runs the same computation against two REAL stored snapshots.
 *
 * Mounted from PaperLibrary's per-paper detail view, right below the notes
 * editor — "Save version snapshot" persists the current notes content
 * alongside (not instead of) the existing paper-update notes autosave.
 */

import { useCallback, useEffect, useState } from 'react';
import { History, Save, Loader2, GitCompare, Plus, Minus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface PaperVersion {
  id: string;
  versionNumber: number;
  content: string;
  label: string | null;
  createdAt: string;
}

interface VersionDiffResult {
  fromVersion: number;
  toVersion: number;
  oldStats: { lines: number; words: number; chars: number };
  newStats: { lines: number; words: number; chars: number };
  diff: { linesAdded: number; linesRemoved: number; linesUnchanged: number; wordDelta: number; charDelta: number };
  changeRate: number;
  addedPreview: string[];
  removedPreview: string[];
}

export function PaperVersionHistory({ paperId, currentContent }: { paperId: string; currentContent: string }) {
  const [versions, setVersions] = useState<PaperVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState('');
  const [fromV, setFromV] = useState<number | ''>('');
  const [toV, setToV] = useState<number | ''>('');
  const [diff, setDiff] = useState<VersionDiffResult | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ versions: PaperVersion[] }>('paper', 'paper-version-list', { paperId });
    if (r.data?.ok) setVersions(r.data.result?.versions || []);
    setLoading(false);
  }, [paperId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const saveSnapshot = useCallback(async () => {
    if (!currentContent.trim()) { setErr('Notes are empty — nothing to snapshot.'); return; }
    setSaving(true);
    const r = await lensRun('paper', 'paper-version-save', {
      paperId, content: currentContent, label: label.trim() || undefined,
    });
    setSaving(false);
    if (!r.data?.ok) { setErr(r.data?.error || 'save failed'); return; }
    setErr(null);
    setLabel('');
    await refresh();
  }, [paperId, currentContent, label, refresh]);

  const runDiff = useCallback(async () => {
    if (fromV === '' || toV === '') return;
    setDiffBusy(true);
    const r = await lensRun<VersionDiffResult>('paper', 'paper-version-diff', {
      paperId, fromVersion: fromV, toVersion: toV,
    });
    setDiffBusy(false);
    if (!r.data?.ok) { setErr(r.data?.error || 'diff failed'); setDiff(null); return; }
    setErr(null);
    setDiff(r.data.result || null);
  }, [paperId, fromV, toV]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 py-1">
        <Loader2 className="w-3 h-3 animate-spin" />Loading version history…
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <History className="w-3 h-3 text-cyan-400" />
        <span className="text-[11px] font-semibold text-zinc-200">Version history</span>
        <span className="text-[9px] text-zinc-500">{versions.length} snapshot{versions.length === 1 ? '' : 's'}</span>
      </div>

      {err && <p className="text-[10px] text-rose-300">{err}</p>}

      <div className="flex gap-1.5">
        <input value={label} onChange={e => setLabel(e.target.value)}
          placeholder="Label (optional) — e.g. 'After reviewer feedback'"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
        <button onClick={saveSnapshot} disabled={saving || !currentContent.trim()}
          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}Save snapshot
        </button>
      </div>

      {versions.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic py-2 text-center">
          No versions saved yet — save a snapshot of your notes above to start a history.
        </p>
      ) : (
        <>
          <ul className="space-y-1 max-h-[140px] overflow-y-auto">
            {versions.map(v => (
              <li key={v.id} className="flex items-center gap-2 text-[10px] text-zinc-300 bg-zinc-950/60 rounded px-2 py-1">
                <span className="font-mono text-cyan-400">v{v.versionNumber}</span>
                <span className="truncate flex-1">{v.label || '(untitled snapshot)'}</span>
                <span className="text-zinc-500 shrink-0">{new Date(v.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>

          {versions.length >= 2 && (
            <div className="pt-1.5 border-t border-zinc-800 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <GitCompare className="w-3 h-3 text-violet-400" />
                <span className="text-[10px] font-semibold text-zinc-300">Compare versions</span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <select aria-label="From version" value={fromV}
                  onChange={e => setFromV(e.target.value ? Number(e.target.value) : '')}
                  className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[10px] text-zinc-200">
                  <option value="">From…</option>
                  {versions.map(v => (
                    <option key={v.id} value={v.versionNumber}>v{v.versionNumber}{v.label ? ` — ${v.label}` : ''}</option>
                  ))}
                </select>
                <span className="text-zinc-600">→</span>
                <select aria-label="To version" value={toV}
                  onChange={e => setToV(e.target.value ? Number(e.target.value) : '')}
                  className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[10px] text-zinc-200">
                  <option value="">To…</option>
                  {versions.map(v => (
                    <option key={v.id} value={v.versionNumber}>v{v.versionNumber}{v.label ? ` — ${v.label}` : ''}</option>
                  ))}
                </select>
                <button onClick={runDiff} disabled={fromV === '' || toV === '' || diffBusy}
                  className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40">
                  {diffBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitCompare className="w-3 h-3" />}Diff
                </button>
              </div>

              {diff && (
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-2 space-y-1.5">
                  <div className="flex items-center gap-3 text-[10px] flex-wrap">
                    <span className="inline-flex items-center gap-0.5 text-emerald-400">
                      <Plus className="w-2.5 h-2.5" />{diff.diff.linesAdded} lines
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-rose-400">
                      <Minus className="w-2.5 h-2.5" />{diff.diff.linesRemoved} lines
                    </span>
                    <span className="text-zinc-400">{diff.diff.wordDelta >= 0 ? '+' : ''}{diff.diff.wordDelta} words</span>
                    <span className="text-zinc-400">{diff.diff.charDelta >= 0 ? '+' : ''}{diff.diff.charDelta} chars</span>
                    <span className="text-zinc-500 ml-auto">{diff.changeRate}% changed</span>
                  </div>
                  {diff.addedPreview.length > 0 && (
                    <div className="space-y-0.5">
                      {diff.addedPreview.map((l, i) => (
                        <p key={`add-${i}`} className="text-[10px] text-emerald-300 font-mono truncate">+ {l}</p>
                      ))}
                    </div>
                  )}
                  {diff.removedPreview.length > 0 && (
                    <div className="space-y-0.5">
                      {diff.removedPreview.map((l, i) => (
                        <p key={`rm-${i}`} className="text-[10px] text-rose-300 font-mono truncate">− {l}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
