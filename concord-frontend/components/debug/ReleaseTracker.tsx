'use client';

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * ReleaseTracker — Sentry-style release / deploy tracking. Ties errors
 * to a version and surfaces crash-free status, regressions, and new
 * issues per release.
 *
 * Wires the `debug` domain macros:
 *   release-create · release-list · release-delete
 *
 * Issue counts are computed server-side from real ingested issues.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { CheckCircle, GitBranch, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';

interface Release {
  id: string;
  version: string;
  environment: string;
  notes: string;
  deployedBy: string;
  deployedAt: string;
  issueCount: number;
  occurrenceCount: number;
  newIssues: number;
  regressions: number;
  openIssues: number;
  crashFree: boolean;
}

export function ReleaseTracker() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    version: '',
    environment: 'production',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('debug', 'release-list', {});
    if (r.data?.ok && r.data.result) {
      setReleases(r.data.result.releases || []);
    } else {
      setError(r.data?.error || 'Failed to load releases');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, []);

  const create = useCallback(async () => {
    if (!form.version.trim()) return;
    setBusy(true);
    const r = await lensRun('debug', 'release-create', {
      version: form.version,
      environment: form.environment,
      notes: form.notes || undefined,
    });
    setBusy(false);
    if (r.data?.ok) {
      setForm({ version: '', environment: 'production', notes: '' });
      load();
    } else {
      setError(r.data?.error || 'Release create failed');
    }
  }, [form, load]);

  const remove = useCallback(
    async (id: string) => {
      const r = await lensRun('debug', 'release-delete', { id });
      if (r.data?.ok) load();
    },
    [load]
  );

  const timeline: TimelineEvent[] = releases.map((rel) => ({
    id: rel.id,
    label: rel.version,
    time: rel.deployedAt,
    tone: rel.regressions > 0 ? 'bad' : rel.crashFree ? 'good' : 'warn',
    detail: `${rel.environment} · ${rel.issueCount} issues`,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-neon-green" /> Release Tracking
        </h3>
        <button
          onClick={load}
          className="text-xs text-neon-cyan hover:underline flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      {/* Create release */}
      <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border space-y-2">
        <p className="text-[10px] text-gray-400 uppercase tracking-wider">Register Deploy</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={form.version}
            onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
            placeholder="Version (e.g. v1.4.0)"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
          />
          <select
            value={form.environment}
            onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs"
          >
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="canary">canary</option>
            <option value="development">development</option>
          </select>
        </div>
        <input
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          placeholder="Release notes (optional)"
          className="w-full px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs"
        />
        <button
          onClick={create}
          disabled={busy || !form.version.trim()}
          className="w-full px-3 py-1.5 text-xs rounded bg-neon-green/15 border border-neon-green/30 text-neon-green hover:bg-neon-green/25 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Track Release
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Deploy timeline */}
      {timeline.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Deploy Timeline</p>
          <TimelineView events={timeline} height={110} />
        </div>
      )}

      {/* Release list */}
      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : releases.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          <GitBranch className="w-7 h-7 mx-auto mb-2 opacity-40" />
          No releases tracked yet
        </div>
      ) : (
        <div className="space-y-2">
          {releases.map((rel) => (
            <div
              key={rel.id}
              className={`rounded-lg border p-3 ${
                rel.regressions > 0
                  ? 'border-orange-500/25 bg-orange-500/[0.03]'
                  : 'border-lattice-border bg-lattice-deep'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-bold text-gray-100">{rel.version}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-lattice-surface text-gray-400">
                  {rel.environment}
                </span>
                {rel.crashFree && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-green/20 text-neon-green flex items-center gap-0.5">
                    <CheckCircle className="w-2.5 h-2.5" /> crash-free
                  </span>
                )}
                <span className="text-[10px] text-gray-400 ml-auto">
                  {new Date(rel.deployedAt).toLocaleString()}
                </span>
                <button
                  onClick={() => remove(rel.id)}
                  className="p-1 rounded text-red-400 hover:bg-red-400/10"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              {rel.notes && <p className="text-xs text-gray-400 mt-1">{rel.notes}</p>}
              <div className="grid grid-cols-4 gap-2 mt-2">
                <div className="text-center">
                  <p className="text-sm font-bold text-gray-200">{rel.issueCount}</p>
                  <p className="text-[10px] text-gray-400">Issues</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-neon-purple">{rel.occurrenceCount}</p>
                  <p className="text-[10px] text-gray-400">Occurrences</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-neon-blue">{rel.newIssues}</p>
                  <p className="text-[10px] text-gray-400">New</p>
                </div>
                <div className="text-center">
                  <p
                    className={`text-sm font-bold ${
                      rel.regressions > 0 ? 'text-orange-400' : 'text-gray-400'
                    }`}
                  >
                    {rel.regressions}
                  </p>
                  <p className="text-[10px] text-gray-400">Regressions</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
