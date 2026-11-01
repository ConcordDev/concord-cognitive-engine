'use client';

/**
 * MonitorsPanel — uptime monitors (S11). Concord probes the URLs you
 * register, from the server, on each monitor's interval (and on demand
 * here). No DSN, no SDK, nothing inbound — the feed is ours. Down and
 * recovery transitions arrive as Concord notifications.
 *
 * Wires the `debug` domain macros:
 *   monitor-create · monitor-list · monitor-update · monitor-delete ·
 *   monitor-check
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Globe, Loader2, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';

interface MonitorCheck {
  at: string;
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  error: string | null;
}
interface Monitor {
  id: string;
  name: string;
  url: string;
  intervalMinutes: number;
  enabled: boolean;
  status: 'unknown' | 'up' | 'down';
  lastCheckedAt: string | null;
  lastStatusCode: number | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  history: MonitorCheck[];
}

const STATUS_TONE: Record<string, string> = {
  up: 'bg-neon-green/20 text-neon-green',
  down: 'bg-red-500/20 text-red-400',
  unknown: 'bg-gray-500/20 text-gray-400',
};

export function MonitorsPanel() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [downCount, setDownCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', url: '', intervalMinutes: '5' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('debug', 'monitor-list', {});
    if (r.data?.ok && r.data.result) {
      setMonitors(r.data.result.monitors || []);
      setDownCount(r.data.result.down || 0);
    } else {
      setError(r.data?.error || 'Failed to load monitors');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const create = useCallback(async () => {
    if (!form.url.trim()) return;
    setBusy(true);
    const r = await lensRun('debug', 'monitor-create', {
      name: form.name || undefined,
      url: form.url,
      intervalMinutes: Number(form.intervalMinutes) || 5,
    });
    setBusy(false);
    if (r.data?.ok) {
      setForm({ name: '', url: '', intervalMinutes: '5' });
      load();
    } else {
      setError(r.data?.error || 'Monitor create failed');
    }
  }, [form, load]);

  const checkNow = useCallback(
    async (id?: string) => {
      setBusy(true);
      const r = await lensRun('debug', 'monitor-check', id ? { id } : {});
      setBusy(false);
      if (r.data?.ok) load();
      else setError(r.data?.error || 'Check failed');
    },
    [load]
  );

  const toggle = useCallback(
    async (m: Monitor) => {
      const r = await lensRun('debug', 'monitor-update', { id: m.id, enabled: !m.enabled });
      if (r.data?.ok) load();
    },
    [load]
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await lensRun('debug', 'monitor-delete', { id });
      if (r.data?.ok) load();
    },
    [load]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Globe className="w-4 h-4 text-neon-green" /> Uptime Monitors
          {downCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
              {downCount} down
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => checkNow()}
            disabled={busy || monitors.length === 0}
            className="text-xs px-2 py-1 rounded bg-neon-green/10 border border-neon-green/30 text-neon-green hover:bg-neon-green/20 flex items-center gap-1 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Check all now
          </button>
          <button
            onClick={load}
            className="text-xs text-neon-cyan hover:underline flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        Concord&rsquo;s server probes each URL on its interval; a down or recovery transition
        lands in your notifications. There is nothing to install and nothing phones in —
        the checks originate here.
      </p>

      {/* Register monitor */}
      <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border grid grid-cols-2 md:grid-cols-4 gap-2">
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Name (optional)"
          className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs"
        />
        <input
          value={form.url}
          onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
          placeholder="https://example.com/health"
          className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono md:col-span-2"
        />
        <input
          value={form.intervalMinutes}
          onChange={(e) => setForm((f) => ({ ...f, intervalMinutes: e.target.value }))}
          placeholder="minutes"
          type="number"
          min={1}
          className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
        />
        <button
          onClick={create}
          disabled={busy || !form.url.trim()}
          className="px-3 py-1.5 text-xs rounded bg-neon-green/15 border border-neon-green/30 text-neon-green hover:bg-neon-green/25 disabled:opacity-50 flex items-center justify-center gap-1 md:col-span-4"
        >
          <Plus className="w-3 h-3" /> Register Monitor
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading...
        </div>
      ) : monitors.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          <Globe className="w-7 h-7 mx-auto mb-2 opacity-40" />
          No monitors yet — register a URL above and Concord will keep an eye on it.
        </div>
      ) : (
        <div className="space-y-2">
          {monitors.map((m) => (
            <div key={m.id} className="rounded-lg border border-lattice-border bg-lattice-deep p-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggle(m)}
                  title={m.enabled ? 'Pause checks' : 'Resume checks'}
                  className={`w-9 h-5 rounded-full shrink-0 relative transition-colors ${
                    m.enabled ? 'bg-neon-green/40' : 'bg-gray-600/40'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                      m.enabled ? 'left-4' : 'left-0.5'
                    }`}
                  />
                </button>
                <button
                  onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-xs text-gray-200 truncate">{m.name}</p>
                  <p className="text-[10px] text-gray-500 font-mono truncate">{m.url}</p>
                </button>
                <span className="text-[10px] text-gray-500 shrink-0">every {m.intervalMinutes}m</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${STATUS_TONE[m.status]}`}
                >
                  {m.status}
                  {m.lastStatusCode != null && ` · ${m.lastStatusCode}`}
                </span>
                <button
                  onClick={() => checkNow(m.id)}
                  disabled={busy}
                  className="px-2 py-1 rounded text-[10px] border border-lattice-border text-gray-300 hover:text-white shrink-0 disabled:opacity-50"
                >
                  Check now
                </button>
                <button
                  onClick={() => remove(m.id)}
                  className="p-1 rounded text-red-400 hover:bg-red-400/10 shrink-0"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                <span>
                  {m.lastCheckedAt
                    ? `last checked ${new Date(m.lastCheckedAt).toLocaleTimeString()}`
                    : 'not checked yet'}
                </span>
                {m.lastLatencyMs != null && <span>{m.lastLatencyMs}ms</span>}
                {m.lastError && <span className="text-red-400 truncate">{m.lastError}</span>}
              </div>
              {expanded === m.id && m.history.length > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-white/5 pt-2">
                  {[...m.history].reverse().slice(0, 12).map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] font-mono text-gray-400">
                      <span className={h.ok ? 'text-neon-green' : 'text-red-400'}>
                        {h.ok ? 'up' : 'down'}
                      </span>
                      <span>{new Date(h.at).toLocaleString()}</span>
                      <span>{h.statusCode ?? '—'}</span>
                      <span>{h.latencyMs}ms</span>
                      {h.error && <span className="text-red-400 truncate">{h.error}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
