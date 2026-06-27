'use client';

/**
 * World-creator anomaly viewer — Wave 1 deferral 8.
 *
 * Per user direction: no admin role. World creators have full control over
 * their own user-created worlds; everything else is rule-governed +
 * publicly transparent.
 *
 * This page renders both surfaces:
 *   - Public: anomaly counts by kind, no user-identifying detail
 *     (constitutional transparency for any logged-in user)
 *   - World-creator: per-world resolve/dismiss interface, gated server-side
 *     by `worlds.created_by = me`
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';

interface Anomaly {
  id: string;
  detected_at: number;
  kind: string;
  user_id: string | null;
  item_id: string | null;
  inventory_id: string | null;
  details_json: string | null;
  status: string;
}

interface PublicStats {
  byKind: Array<{ kind: string; status: string; n: number }>;
  recent7d: Array<{ kind: string; n: number }>;
}

export default function AnomaliesPage() {
  const viewLog = useArtifacts<{ at: string }>('world-creator/anomalies', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('world-creator/anomalies');
  void viewLog; void recordView;
  const [worldId, setWorldId] = useState('');
  const [worldAnomalies, setWorldAnomalies] = useState<Anomaly[]>([]);
  const [publicStats, setPublicStats] = useState<PublicStats | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPublic = useCallback(async () => {
    setPublicError(null);
    try {
      const res = await fetch('/api/anomalies/public');
      const json = await res.json();
      if (json?.ok) setPublicStats({ byKind: json.byKind, recent7d: json.recent7d });
      else setPublicError(json?.error || `HTTP ${res.status}`);
    } catch (e) {
      // Do NOT swallow into a perpetual "Loading…" — surface it with a Retry.
      setPublicError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { fetchPublic(); }, [fetchPublic]);

  const fetchWorld = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/anomalies/world/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      const json = await res.json();
      if (!json?.ok) {
        setError(json?.error || `HTTP ${res.status}`);
        setWorldAnomalies([]);
      } else {
        setWorldAnomalies(json.anomalies || []);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const resolve = async (a: Anomaly, kind: 'resolve' | 'dismiss') => {
    try {
      await fetch(`/api/anomalies/world/${encodeURIComponent(worldId)}/${a.id}/${kind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ resolution: `${kind} via world-creator panel`, reason: kind }),
      });
      await fetchWorld(worldId);
    } catch { /* network error silent */ }
  };

  return (
    <LensShell lensId="world-creator" asMain={false}>
    <main className="min-h-screen p-6 max-w-5xl mx-auto text-gray-100">
      <h1 className="text-2xl font-bold mb-2">Inventory anomaly review</h1>
      <p className="text-sm text-gray-400 mb-6">
        World creators have full control over their own world&apos;s anomalies. Platform-wide
        anomalies are handled by rule-based auto-resolution and shown here for transparency.
      </p>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-cyan-300 mb-3">Public transparency log</h2>
        {!publicStats && !publicError && (
          <div role="status" aria-live="polite" className="text-xs text-gray-400">Loading…</div>
        )}
        {!publicStats && publicError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded border border-red-700 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            <span>Could not load the transparency log: {publicError}</span>
            <button onClick={() => fetchPublic()}
              className="rounded border border-red-600 bg-red-900/40 px-2 py-1 text-[11px] text-red-100 hover:bg-red-900/70">
              Try again
            </button>
          </div>
        )}
        {publicStats && (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900/60 border border-gray-700 rounded p-3">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">By kind + status</h3>
              <ul className="space-y-1 text-xs">
                {publicStats.byKind.length === 0 && <li className="text-gray-400 italic">No anomalies recorded</li>}
                {publicStats.byKind.map((row, i) => (
                  <li key={i} className="flex justify-between">
                    <span>
                      <span className="text-gray-400">{row.status}</span>{' '}
                      <span className="text-gray-200">{row.kind}</span>
                    </span>
                    <span className="text-cyan-300 font-mono">{row.n}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-gray-900/60 border border-gray-700 rounded p-3">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">Last 7 days</h3>
              <ul className="space-y-1 text-xs">
                {publicStats.recent7d.length === 0 && <li className="text-gray-400 italic">Quiet week</li>}
                {publicStats.recent7d.map((row, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-gray-200">{row.kind}</span>
                    <span className="text-cyan-300 font-mono">{row.n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-cyan-300 mb-3">My world&apos;s anomalies</h2>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="World ID you own…"
            value={worldId}
            onChange={(e) => setWorldId(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
          />
          <button
            onClick={() => fetchWorld(worldId)}
            disabled={!worldId || loading}
            className="px-4 py-2 bg-cyan-600 text-white rounded hover:bg-cyan-500 text-sm disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
        {error && <div className="text-xs text-red-400 mb-3">{error}</div>}
        {worldAnomalies.length === 0 && !loading && !error && (
          <div className="text-xs text-gray-400 italic">No open anomalies in this world.</div>
        )}
        <ul className="space-y-2">
          {worldAnomalies.map((a) => (
            <li key={a.id} className="bg-gray-900/60 border border-gray-700 rounded p-3 text-xs">
              <div className="flex justify-between items-start gap-3 mb-2">
                <div>
                  <span className="font-semibold text-yellow-300">{a.kind}</span>{' '}
                  <span className="text-gray-400">@ {new Date(a.detected_at * 1000).toISOString().slice(0, 16).replace('T', ' ')}</span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => resolve(a, 'resolve')}
                    className="px-2 py-1 bg-green-600/30 text-green-300 hover:bg-green-600/50 border border-green-500/40 rounded text-[10px]"
                  >
                    Resolve
                  </button>
                  <button
                    onClick={() => resolve(a, 'dismiss')}
                    className="px-2 py-1 bg-gray-700 text-gray-300 hover:bg-gray-600 border border-gray-600 rounded text-[10px]"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <div className="text-gray-300 font-mono whitespace-pre-wrap">
                user: {a.user_id || '—'}
                {' / '}item: {a.item_id || '—'}
              </div>
              {a.details_json && (
                <details className="mt-1">
                  <summary className="text-gray-400 cursor-pointer">details</summary>
                  <pre className="text-[10px] text-gray-400 mt-1 overflow-x-auto">{a.details_json}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
    </LensShell>
  );
}
