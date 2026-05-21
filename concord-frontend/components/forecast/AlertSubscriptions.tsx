'use client';

/**
 * AlertSubscriptions — create / list / remove forecast alert subscriptions and
 * run a live check against a freshly composed forecast. A subscription trips
 * when a predicted event / drift / weather kind clears its confidence floor.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

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
        {subs.length === 0 ? (
          <p className="py-6 text-center text-xs italic text-zinc-500">
            No subscriptions yet — add one above to get notified of predicted severe events.
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
                        <span className="text-zinc-500"> · {s.weatherKinds.join(', ')}</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-zinc-500">
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
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                      last fired {new Date(s.lastFiredAt * 1000).toLocaleString()}
                    </p>
                  )}
                  {trip && (
                    <ul className="mt-1.5 space-y-1 border-l-2 border-amber-500/50 pl-2">
                      {trip.hits.map((h, i) => (
                        <li key={i} className="text-[11px] text-amber-200">
                          {h.type === 'event' && `${h.summary} (${((h.confidence ?? 0) * 100).toFixed(0)}%)`}
                          {h.type === 'drift' && `Drift: ${h.driftKind} · ${h.severity}`}
                          {h.type === 'weather' && `Weather: ${h.weatherKind} (${((h.confidence ?? 0) * 100).toFixed(0)}%)`}
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
          <p className="mt-2 text-[11px] text-zinc-500">
            Checked — no subscriptions tripped by the current forecast.
          </p>
        )}
      </div>
    </div>
  );
}
