'use client';

/**
 * AlertSubscriptions — create / list / remove forecast alert subscriptions.
 * A subscription trips when a predicted event / drift / weather kind clears
 * its confidence floor.
 *
 * Two delivery paths, both honest about what they actually are:
 *  - LIVE: the forecast-alert-sweep heartbeat (server/lib/world-forecast.js)
 *    pushes a `forecast:alert-triggered` socket event to this user's room
 *    the moment a fresh forecast trips one of their subscriptions, ~5min
 *    cadence. That only reaches a tab that is currently open and connected —
 *    it is NOT an OS-level push/desktop notification (this codebase has no
 *    service-worker Web Push pipeline), so it is labeled "while this tab is
 *    open" rather than implied to work when the app is closed.
 *  - MANUAL: "Check against fresh forecast" calls checkAlerts directly — the
 *    original path, kept exactly as-is as the fallback for alerts that
 *    tripped while this tab was closed or disconnected (checkAlerts still
 *    evaluates + stamps `last_fired_at` server-side either way).
 */

import { useCallback, useEffect, useState } from 'react';
import { Radio, BellRing } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useSocket } from '@/hooks/useSocket';
import { useUIStore } from '@/store/ui';

type AlertKind = 'severe_event' | 'drift' | 'weather' | 'any';

interface Subscription {
  id: string;
  worldId: string;
  kind: AlertKind;
  minConfidence: number;
  weatherKinds: string[];
  createdAt: number;
  lastFiredAt: number | null;
}

interface AlertHit {
  type: string;
  summary?: string;
  eventKind?: string;
  driftKind?: string;
  severity?: string;
  weatherKind?: string;
  confidence?: number;
  eta_hours?: number | null;
}

interface TriggeredAlert {
  subscriptionId: string;
  kind: AlertKind;
  hits: AlertHit[];
}

interface LiveFiredEntry {
  worldId: string;
  triggered: TriggeredAlert[];
  receivedAt: number;
}

interface AlertTriggeredPayload {
  userId?: string;
  worldId?: string;
  triggered?: TriggeredAlert[];
  forecastComposedAt?: number | null;
}

function summarizeHit(h: AlertHit): string {
  if (h.type === 'event') return `${h.summary ?? 'Event'} (${((h.confidence ?? 0) * 100).toFixed(0)}%)`;
  if (h.type === 'drift') return `Drift: ${h.driftKind ?? 'unknown'} · ${h.severity ?? ''}`;
  if (h.type === 'weather') return `Weather: ${h.weatherKind ?? 'unknown'} (${((h.confidence ?? 0) * 100).toFixed(0)}%)`;
  return h.type;
}

const KINDS: Array<{ value: AlertKind; label: string }> = [
  { value: 'severe_event', label: 'Severe event' },
  { value: 'drift', label: 'Drift (high/critical)' },
  { value: 'weather', label: 'Weather kind' },
  { value: 'any', label: 'Any of the above' },
];

export function AlertSubscriptions({ worldId }: { worldId: string }) {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [triggered, setTriggered] = useState<TriggeredAlert[] | null>(null);
  const [kind, setKind] = useState<AlertKind>('severe_event');
  const [minConfidence, setMinConfidence] = useState(0.7);
  const [weatherKinds, setWeatherKinds] = useState('');
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [liveFired, setLiveFired] = useState<LiveFiredEntry[]>([]);
  const { on, off, isConnected } = useSocket({ autoConnect: true });
  const addToast = useUIStore((s) => s.addToast);

  const loadSubs = useCallback(async () => {
    const r = await lensRun<{ ok: boolean; subscriptions: Subscription[] }>(
      'forecast', 'listAlerts', { worldId },
    );
    if (r.data?.ok && r.data.result?.ok) {
      setSubs(r.data.result.subscriptions || []);
    } else {
      setSubs([]);
    }
  }, [worldId]);

  useEffect(() => { void loadSubs(); }, [loadSubs]);

  // Live delivery: the forecast-alert-sweep heartbeat pushes this event to
  // `user:<id>` the moment a fresh forecast trips a subscription. Only fires
  // while this tab is connected — see the module doc comment above. Scoped
  // to the world currently being viewed; a trigger for a different world
  // this user is also subscribed to is real but not shown in this view.
  useEffect(() => {
    const handleTriggered = (payload: unknown) => {
      const p = payload as AlertTriggeredPayload;
      const trig = p?.triggered;
      if (!Array.isArray(trig) || !trig.length || p.worldId !== worldId) return;
      setLiveFired((prev) => [
        { worldId: p.worldId as string, triggered: trig, receivedAt: Date.now() },
        ...prev,
      ].slice(0, 5));
      setTriggered(trig);
      setChecked(true);
      const first = trig[0]?.hits?.[0];
      addToast({
        type: 'info',
        message: first ? `Forecast alert: ${summarizeHit(first)}` : 'A forecast alert subscription tripped.',
        duration: 10000,
      });
      void loadSubs();
    };
    on('forecast:alert-triggered', handleTriggered);
    return () => off('forecast:alert-triggered', handleTriggered);
  }, [on, off, worldId, loadSubs, addToast]);

  const create = async () => {
    setBusy(true);
    const wk = weatherKinds.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await lensRun('forecast', 'subscribeAlert', {
      worldId,
      kind,
      minConfidence,
      weatherKinds: wk,
    });
    if (r.data?.ok && (r.data.result as { ok?: boolean })?.ok) {
      setWeatherKinds('');
      await loadSubs();
    }
    setBusy(false);
  };

  const remove = async (id: string) => {
    const r = await lensRun('forecast', 'unsubscribeAlert', { subscriptionId: id });
    if (r.data?.ok && (r.data.result as { ok?: boolean })?.ok) await loadSubs();
  };

  const check = async () => {
    setBusy(true);
    setChecked(false);
    const r = await lensRun<{ ok: boolean; triggered: TriggeredAlert[] }>(
      'forecast', 'checkAlerts', { worldId },
    );
    if (r.data?.ok && r.data.result?.ok) {
      setTriggered(r.data.result.triggered || []);
      setChecked(true);
      await loadSubs();
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-indigo-300">
          New subscription
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs text-zinc-400">
            Trigger
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AlertKind)}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
            >
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            Min confidence: {(minConfidence * 100).toFixed(0)}%
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={minConfidence}
              onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
              className="mt-1 w-full accent-indigo-500"
            />
          </label>
          {(kind === 'weather' || kind === 'any') && (
            <label className="text-xs text-zinc-400 sm:col-span-2">
              Weather kinds (comma-separated, e.g. storm, snow)
              <input
                type="text"
                value={weatherKinds}
                onChange={(e) => setWeatherKinds(e.target.value)}
                placeholder="storm, snow, fog"
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
              />
            </label>
          )}
        </div>
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="mt-2 rounded bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          Add subscription
        </button>
      </div>

      {/* Honest live-vs-manual delivery labeling */}
      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
        <Radio className={isConnected ? 'w-3 h-3 text-emerald-400' : 'w-3 h-3 text-zinc-600'} />
        <span>
          {isConnected
            ? 'Live alerts — while this tab is open, a tripped subscription notifies you within a few minutes of the sweep.'
            : 'Live delivery is offline right now — subscriptions still evaluate and fire on the server, but only "Check against fresh forecast" below will surface them until this tab reconnects.'}
        </span>
      </div>

      {liveFired.length > 0 && (
        <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/30 p-3 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold flex items-center gap-1">
            <Radio className="w-3 h-3" /> Live — delivered just now
          </p>
          {liveFired.map((f) => (
            <p key={f.receivedAt} className="text-xs text-emerald-200">
              <BellRing className="inline w-3 h-3 mr-1" />
              {f.triggered.length} subscription{f.triggered.length === 1 ? '' : 's'} tripped
              {f.triggered[0]?.hits?.[0] ? ` — ${summarizeHit(f.triggered[0].hits[0])}` : ''}
            </p>
          ))}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
            Your subscriptions ({subs.length})
          </h3>
          {subs.length > 0 && (
            <button
              type="button"
              onClick={check}
              disabled={busy}
              className="rounded bg-emerald-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-600 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {busy ? 'Checking…' : 'Check against fresh forecast'}
            </button>
          )}
        </div>
        {subs.length > 0 && (
          <p className="mb-2 text-[10px] text-zinc-500">
            Subscriptions deliver live to this tab (~5min sweep cadence) while connected. Use &quot;Check against fresh forecast&quot; (or press <kbd className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 font-mono">7</kbd> then check) any time for an immediate read, or to catch alerts that fired while this tab was closed.
          </p>
        )}
        {subs.length === 0 ? (
          <p className="py-6 text-center text-xs italic text-zinc-400">
            No subscriptions yet — add one above. It will then be checked automatically (~5min while this tab is open) and stay available for an on-demand check any time via &quot;Check against fresh forecast&quot;.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {subs.map((s) => {
              const trip = triggered?.find((t) => t.subscriptionId === s.id);
              return (
                <li
                  key={s.id}
                  className={`rounded-lg border px-3 py-2 ${
                    trip ? 'border-amber-600/50 bg-amber-500/10' : 'border-zinc-800 bg-zinc-950/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-zinc-100">
                      {KINDS.find((k) => k.value === s.kind)?.label ?? s.kind}
                      {s.weatherKinds.length > 0 && (
                        <span className="text-zinc-400"> · {s.weatherKinds.join(', ')}</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-zinc-400">
                        ≥{(s.minConfidence * 100).toFixed(0)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(s.id)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/15 focus:outline-none focus:ring-1 focus:ring-rose-500"
                      >
                        remove
                      </button>
                    </div>
                  </div>
                  {s.lastFiredAt && (
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                      last fired {new Date(s.lastFiredAt * 1000).toLocaleString()}
                    </p>
                  )}
                  {trip && (
                    <ul className="mt-1.5 space-y-1 border-l-2 border-amber-500/50 pl-2">
                      {trip.hits.map((h, i) => (
                        <li key={i} className="text-[11px] text-amber-200">
                          {summarizeHit(h)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {checked && triggered && triggered.length === 0 && (
          <p className="mt-2 text-[11px] text-zinc-400">
            Checked — no subscriptions tripped by the current forecast.
          </p>
        )}
      </div>
    </div>
  );
}
