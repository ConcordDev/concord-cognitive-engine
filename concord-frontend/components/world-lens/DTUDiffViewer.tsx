'use client';

/**
 * DTUDiffViewer — real DTU version-history diff.
 *
 * HONESTY NOTE (fixed 2026-07): this component used to ship with a
 * hardcoded `VERSIONS` array of three invented "USB-A Beam 6m" revisions
 * (fake authors `eng.martinez`/`eng.chen`, fake dates, fake seismic/wind
 * ratings, a fake "Validation Comparison" panel, and a "3D Diff Overlay"
 * callout describing a feature that does not exist anywhere in the
 * codebase). It rendered as though the backend had supplied real DTU
 * revision history — it had not; nothing was ever fetched.
 *
 * The real substrate: `dtu_versions` (migration 001_core_tables.js) is a
 * genuine per-version `body_json` snapshot table, written on every
 * `/api/dtus/guided` create/update and `/api/dtus/durable` create (see
 * `server/guidance.js`, `server/durable.js`). `GET /api/dtus/:id/versions`
 * (added alongside this fix) projects those rows with full body content so
 * two real versions of the same DTU can be diffed field-by-field.
 *
 * Honest limits, stated rather than papered over:
 *  - A DTU created only through the in-memory macro path
 *    (`dtu.create`/`dtu.update` in server.js) never gets a `dtu_versions`
 *    row, so this legitimately renders "no version history" for most DTUs
 *    today. That is the correct, honest behavior — not a bug to hide.
 *  - There is no per-version author field in the real schema, so this
 *    component does not invent one. It shows the DTU's single owner once,
 *    not a fabricated per-revision engineer name.
 *  - The diff is a generic recursive field/value comparison over whatever
 *    `body_json` actually contains — never a fixed beam-engineering schema
 *    (material/seismic/wind/etc.) that only ever matched the old fake data.
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────

interface DTUVersionRecord {
  id: string;
  version: number;
  createdAt: string;
  body: Record<string, unknown>;
}

interface DTUVersionsResponse {
  ok: boolean;
  error?: string;
  dtu?: { id: string; title: string | null; tier: string | null; ownerId: string | null };
  versions?: DTUVersionRecord[];
}

interface DTUDiffViewerProps {
  dtuId?: string | null;
}

// ── Generic body_json flattening (no domain-specific schema) ───────────────

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value === null || value === undefined) {
    out[prefix || '(root)'] = '—';
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out[prefix || '(root)'] = '[]';
      return out;
    }
    value.forEach((item, i) => flatten(item, prefix ? `${prefix}[${i}]` : `[${i}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      out[prefix || '(root)'] = '{}';
      return out;
    }
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out[prefix || '(value)'] = String(value);
  return out;
}

// ── Diff helpers ─────────────────────────────────────────────────────────

type DiffStatus = 'added' | 'removed' | 'modified' | 'unchanged';

interface DiffRow {
  field: string;
  v1: string | undefined;
  v2: string | undefined;
  delta: string;
  status: DiffStatus;
}

function computeDelta(v1Val: string | undefined, v2Val: string | undefined): string {
  if (v1Val === undefined) return '+ new';
  if (v2Val === undefined) return '- removed';
  if (v1Val === v2Val) return '—';

  const n1 = parseFloat(v1Val);
  const n2 = parseFloat(v2Val);
  if (!isNaN(n1) && !isNaN(n2) && String(n1) === v1Val.trim() && String(n2) === v2Val.trim()) {
    const diff = n2 - n1;
    const pct = n1 !== 0 ? ((diff / n1) * 100).toFixed(1) : null;
    const arrow = diff > 0 ? '▲' : '▼';
    const sign = diff > 0 ? '+' : '';
    return pct !== null ? `${arrow} ${sign}${diff.toFixed(2)} (${sign}${pct}%)` : `${arrow} ${sign}${diff.toFixed(2)}`;
  }
  return 'changed';
}

function buildDiffRows(a: Record<string, unknown>, b: Record<string, unknown>): DiffRow[] {
  const flatA = flatten(a);
  const flatB = flatten(b);
  const fields = Array.from(new Set([...Object.keys(flatA), ...Object.keys(flatB)])).sort();

  return fields.map((field) => {
    const v1 = flatA[field];
    const v2 = flatB[field];
    let status: DiffStatus = 'unchanged';
    if (v1 === undefined && v2 !== undefined) status = 'added';
    else if (v1 !== undefined && v2 === undefined) status = 'removed';
    else if (v1 !== v2) status = 'modified';
    return { field, v1, v2, delta: computeDelta(v1, v2), status };
  });
}

const statusRowBg: Record<DiffStatus, string> = {
  added: 'bg-green-900/30 border-l-2 border-green-500',
  removed: 'bg-red-900/30 border-l-2 border-red-500',
  modified: 'bg-yellow-900/20 border-l-2 border-yellow-500',
  unchanged: 'bg-white/[0.02]',
};

const statusDeltaColor: Record<DiffStatus, string> = {
  added: 'text-green-400',
  removed: 'text-red-400',
  modified: 'text-yellow-300',
  unchanged: 'text-white/30',
};

const legendItems: { status: DiffStatus; label: string; color: string }[] = [
  { status: 'added', label: 'Added', color: 'bg-green-500' },
  { status: 'removed', label: 'Removed', color: 'bg-red-500' },
  { status: 'modified', label: 'Modified', color: 'bg-yellow-500' },
  { status: 'unchanged', label: 'Unchanged', color: 'bg-white/20' },
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// ── Component ────────────────────────────────────────────────────────────

export default function DTUDiffViewer({ dtuId = null }: DTUDiffViewerProps) {
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState<number | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [timelineSide, setTimelineSide] = useState<'left' | 'right'>('left');

  const { data, isLoading, isError } = useQuery<DTUVersionsResponse>({
    queryKey: ['dtu-versions', dtuId],
    queryFn: async () => (await api.get(`/api/dtus/${dtuId}/versions`)).data,
    enabled: !!dtuId,
  });

  const versions = data?.versions ?? [];
  const rIdx = rightIdx === null ? Math.max(versions.length - 1, 0) : rightIdx;
  const leftVersion = versions[leftIdx];
  const rightVersion = versions[rIdx];

  const diffRows = useMemo(
    () => (leftVersion && rightVersion ? buildDiffRows(leftVersion.body, rightVersion.body) : []),
    [leftVersion, rightVersion]
  );

  const visibleRows = useMemo(
    () => (showUnchanged ? diffRows : diffRows.filter((r) => r.status !== 'unchanged')),
    [diffRows, showUnchanged]
  );

  const unchangedCount = diffRows.filter((r) => r.status === 'unchanged').length;
  const addedCount = diffRows.filter((r) => r.status === 'added').length;
  const removedCount = diffRows.filter((r) => r.status === 'removed').length;
  const modifiedCount = diffRows.filter((r) => r.status === 'modified').length;

  const handleTimelineClick = (idx: number, side: 'left' | 'right') => {
    if (side === 'left') setLeftIdx(idx);
    else setRightIdx(idx);
  };

  // ── Honest empty / unavailable states ────────────────────────────────

  if (!dtuId) {
    return (
      <div className="w-full max-w-5xl mx-auto p-6 font-mono text-sm text-white/60">
        <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-5">
          <h2 className="text-lg font-semibold mb-2 tracking-wide text-white/90">DTU Diff Viewer</h2>
          <p>No DTU selected. Select a placed component in the world to view its recorded version history.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="w-full max-w-5xl mx-auto p-6 font-mono text-sm text-white/60">
        <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-5">
          Loading version history for {dtuId}&hellip;
        </div>
      </div>
    );
  }

  if (isError || data?.ok === false) {
    return (
      <div className="w-full max-w-5xl mx-auto p-6 font-mono text-sm text-white/60">
        <div className="rounded-xl bg-black/80 backdrop-blur border border-red-500/20 p-5">
          <h2 className="text-lg font-semibold mb-2 tracking-wide text-white/90">DTU Diff Viewer</h2>
          <p className="text-red-400/80">
            Version history unavailable for this DTU{data?.error ? ` (${data.error})` : ''}.
          </p>
        </div>
      </div>
    );
  }

  if (versions.length < 2) {
    return (
      <div className="w-full max-w-5xl mx-auto p-6 font-mono text-sm text-white/60">
        <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-5">
          <h2 className="text-lg font-semibold mb-2 tracking-wide text-white/90">DTU Diff Viewer</h2>
          <p>
            {versions.length === 0
              ? 'This DTU has no recorded version history yet.'
              : 'Only one recorded version on file — nothing to compare yet.'}
          </p>
          <p className="text-white/30 text-xs mt-2">
            Version snapshots are recorded on each edit made through the guided DTU editor. DTUs
            authored through other paths may not yet have snapshot history.
          </p>
        </div>
      </div>
    );
  }

  // ── Real diff UI ──────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-4 font-mono text-sm text-white/90">
      {/* Header / Version Selectors */}
      <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold tracking-wide">DTU Diff Viewer</h2>
          <span className="text-xs text-white/30">
            {data?.dtu?.title || dtuId}
            {data?.dtu?.ownerId ? ` · owner ${data.dtu.ownerId}` : ''}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-xs text-white/50 mb-1 uppercase tracking-wider">
              Base Version
            </label>
            <select
              value={leftIdx}
              onChange={(e) => setLeftIdx(Number(e.target.value))}
              className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white/90 focus:outline-none focus:border-blue-500/60"
            >
              {versions.map((v, i) => (
                <option key={v.id} value={i} className="bg-black text-white">
                  v{v.version} — {formatDate(v.createdAt)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end justify-center text-white/30 text-xl pb-2">&rarr;</div>

          <div className="flex-1">
            <label className="block text-xs text-white/50 mb-1 uppercase tracking-wider">
              Compare Version
            </label>
            <select
              value={rIdx}
              onChange={(e) => setRightIdx(Number(e.target.value))}
              className="w-full bg-black/60 border border-white/10 rounded-lg px-3 py-2 text-white/90 focus:outline-none focus:border-blue-500/60"
            >
              {versions.map((v, i) => (
                <option key={v.id} value={i} className="bg-black text-white">
                  v{v.version} — {formatDate(v.createdAt)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Summary Banner — a real, computed count of the diff, not a narrative */}
      <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-blue-400 text-lg">i</span>
          <p className="text-white/70 leading-relaxed">
            <span className="text-white/90 font-medium">
              v{leftVersion.version} &rarr; v{rightVersion.version}:
            </span>{' '}
            {modifiedCount} modified, {addedCount} added, {removedCount} removed, {unchangedCount} unchanged.
          </p>
        </div>
      </div>

      {/* Properties Diff Table */}
      <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <h3 className="font-semibold tracking-wide">Field Diff</h3>
          <button
            onClick={() => setShowUnchanged(!showUnchanged)}
            className="text-xs px-3 py-1 rounded-md border border-white/10 hover:border-white/30 transition-colors text-white/50 hover:text-white/80"
          >
            {showUnchanged ? 'Hide' : 'Show'} unchanged ({unchangedCount})
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/10 text-xs text-white/40 uppercase tracking-wider">
                <th className="px-5 py-3 w-1/4">Field</th>
                <th className="px-5 py-3 w-1/4">v{leftVersion.version}</th>
                <th className="px-5 py-3 w-1/4">v{rightVersion.version}</th>
                <th className="px-5 py-3 w-1/4">Delta</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-4 text-white/30 text-center">
                    No differences between these two versions.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.field} className={`${statusRowBg[row.status]} transition-colors`}>
                    <td className="px-5 py-2.5 text-white/70 font-medium">{row.field}</td>
                    <td className="px-5 py-2.5 text-white/60">{row.v1 ?? '—'}</td>
                    <td className="px-5 py-2.5 text-white/80">{row.v2 ?? '—'}</td>
                    <td className={`px-5 py-2.5 font-medium ${statusDeltaColor[row.status]}`}>
                      {row.delta}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Diff status legend */}
      <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-5">
        <h3 className="font-semibold tracking-wide mb-3">Diff Legend</h3>
        <div className="flex flex-wrap gap-4">
          {legendItems.map((item) => (
            <div key={item.status} className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded ${item.color}`} />
              <span className="text-white/60 text-xs uppercase tracking-wider">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Version Timeline — real version numbers + real recorded timestamps */}
      <div className="rounded-xl bg-black/80 backdrop-blur border border-white/10 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold tracking-wide">Version Timeline</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setTimelineSide('left')}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                timelineSide === 'left'
                  ? 'border-blue-500/60 text-blue-400 bg-blue-500/10'
                  : 'border-white/10 text-white/40 hover:text-white/60'
              }`}
            >
              Select Base
            </button>
            <button
              onClick={() => setTimelineSide('right')}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                timelineSide === 'right'
                  ? 'border-blue-500/60 text-blue-400 bg-blue-500/10'
                  : 'border-white/10 text-white/40 hover:text-white/60'
              }`}
            >
              Select Compare
            </button>
          </div>
        </div>

        <div className="relative flex items-center justify-between px-4 py-6 overflow-x-auto">
          <div className="absolute left-8 right-8 top-1/2 h-px bg-white/10" />

          {versions.map((v, i) => {
            const isLeft = i === leftIdx;
            const isRight = i === rIdx;
            return (
              <button
                key={v.id}
                onClick={() => handleTimelineClick(i, timelineSide)}
                className="relative z-10 flex flex-col items-center gap-2 group shrink-0 px-2"
              >
                <div
                  className={`w-5 h-5 rounded-full border-2 transition-all ${
                    isLeft && isRight
                      ? 'border-purple-400 bg-purple-500/40 scale-125'
                      : isLeft
                      ? 'border-blue-400 bg-blue-500/40 scale-110'
                      : isRight
                      ? 'border-green-400 bg-green-500/40 scale-110'
                      : 'border-white/20 bg-white/5 group-hover:border-white/40 group-hover:scale-110'
                  }`}
                />
                <span
                  className={`text-xs transition-colors ${
                    isLeft || isRight ? 'text-white/90 font-medium' : 'text-white/40'
                  }`}
                >
                  v{v.version}
                </span>
                <span className="text-[10px] text-white/30 whitespace-nowrap">{formatDate(v.createdAt)}</span>
                {isLeft && <span className="text-[10px] text-blue-400 font-medium">BASE</span>}
                {isRight && !isLeft && <span className="text-[10px] text-green-400 font-medium">COMPARE</span>}
                {isLeft && isRight && <span className="text-[10px] text-purple-400 font-medium">BOTH</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
