'use client';

/**
 * StravaWearablePanel — wearable device linking (Apple Health / Garmin /
 * Fitbit / Whoop) and manual HR/sleep/steps sample ingest. Linked devices
 * are stored via fitness.wearable-link; the sample form posts real device
 * readings through fitness.wearable-sync into the recovery + activity logs.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Watch, Link2, Unlink, HeartPulse, Plus, CheckCircle2, Moon, Footprints,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface WearableLink {
  provider: string;
  linkedAt: string;
  lastSyncAt: string | null;
  deviceName: string | null;
}

const PROVIDERS: { id: string; label: string }[] = [
  { id: 'apple_health', label: 'Apple Health' },
  { id: 'garmin', label: 'Garmin Connect' },
  { id: 'fitbit', label: 'Fitbit' },
  { id: 'whoop', label: 'Whoop' },
];

function providerLabel(id: string): string {
  return PROVIDERS.find((p) => p.id === id)?.label || id;
}

export function StravaWearablePanel() {
  const [links, setLinks] = useState<WearableLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [syncProvider, setSyncProvider] = useState('');
  const [sample, setSample] = useState({
    date: new Date().toISOString().slice(0, 10),
    restingHr: '', hrv: '', sleepHours: '', recoveryScore: '',
    steps: '', activeCalories: '', exerciseMinutes: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fitness', 'wearable-status', {});
    if (r.data?.ok) setLinks(r.data.result?.links || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const link = async (provider: string) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    const r = await lensRun('fitness', 'wearable-link', {
      provider,
      deviceName: deviceName.trim() || undefined,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not link device'); return; }
    setDeviceName('');
    setNotice(`${providerLabel(provider)} linked.`);
    await refresh();
  };

  const unlink = async (provider: string) => {
    setBusy(true);
    await lensRun('fitness', 'wearable-link', { provider, unlink: true });
    setBusy(false);
    if (syncProvider === provider) setSyncProvider('');
    await refresh();
  };

  const sync = async () => {
    if (!syncProvider) { setError('Select a linked device to sync into.'); return; }
    const row: Record<string, unknown> = { date: sample.date };
    for (const k of ['restingHr', 'hrv', 'sleepHours', 'recoveryScore', 'steps', 'activeCalories', 'exerciseMinutes'] as const) {
      const v = Number(sample[k]);
      if (sample[k] !== '' && Number.isFinite(v) && v > 0) row[k] = v;
    }
    if (Object.keys(row).length < 2) { setError('Enter at least one metric value.'); return; }
    setError(null);
    setBusy(true);
    const r = await lensRun('fitness', 'wearable-sync', {
      provider: syncProvider,
      samples: [row],
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Sync failed'); return; }
    const res = r.data?.result as { synced?: number } | undefined;
    setNotice(`Synced ${res?.synced ?? 0} reading(s) from ${providerLabel(syncProvider)}.`);
    setSample({
      date: new Date().toISOString().slice(0, 10),
      restingHr: '', hrv: '', sleepHours: '', recoveryScore: '',
      steps: '', activeCalories: '', exerciseMinutes: '',
    });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const linkedIds = new Set(links.map((l) => l.provider));

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-900/50 rounded-lg px-3 py-2">{notice}</div>}

      {/* devices */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Watch className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Connected devices</h3>
        </div>
        <input
          placeholder="Device name (optional, e.g. Forerunner 965)"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
        />
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map((p) => {
            const linked = linkedIds.has(p.id);
            return (
              <div
                key={p.id}
                className={cn(
                  'rounded-lg border px-3 py-2 flex items-center justify-between',
                  linked ? 'border-emerald-800/60 bg-emerald-950/30' : 'border-zinc-800 bg-zinc-950',
                )}
              >
                <span className="text-xs font-medium text-zinc-200">{p.label}</span>
                {linked ? (
                  <button
                    type="button"
                    onClick={() => unlink(p.id)}
                    disabled={busy}
                    className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 disabled:opacity-50"
                  >
                    <Unlink className="w-3 h-3" /> Unlink
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => link(p.id)}
                    disabled={busy}
                    className="flex items-center gap-1 text-[11px] text-orange-400 hover:text-orange-300 disabled:opacity-50"
                  >
                    <Link2 className="w-3 h-3" /> Link
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {links.length > 0 && (
          <ul className="space-y-1">
            {links.map((l) => (
              <li key={l.provider} className="text-[11px] text-zinc-500 flex items-center gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                <span className="text-zinc-300">{providerLabel(l.provider)}</span>
                {l.deviceName && <span>· {l.deviceName}</span>}
                <span>· last sync: {l.lastSyncAt ? new Date(l.lastSyncAt).toLocaleString() : 'never'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* sample ingest */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
        <div className="flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-zinc-100">Sync a daily reading</h3>
        </div>
        {links.length === 0 ? (
          <p className="text-xs text-zinc-500 italic">Link a device above before syncing readings.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={syncProvider}
                onChange={(e) => setSyncProvider(e.target.value)}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
              >
                <option value="">Select device…</option>
                {links.map((l) => <option key={l.provider} value={l.provider}>{providerLabel(l.provider)}</option>)}
              </select>
              <input
                type="date"
                value={sample.date}
                onChange={(e) => setSample({ ...sample, date: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
              />
              <input placeholder="Resting HR (bpm)" inputMode="numeric" value={sample.restingHr}
                onChange={(e) => setSample({ ...sample, restingHr: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="HRV (ms)" inputMode="decimal" value={sample.hrv}
                onChange={(e) => setSample({ ...sample, hrv: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Sleep (hours)" inputMode="decimal" value={sample.sleepHours}
                onChange={(e) => setSample({ ...sample, sleepHours: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Recovery score (%)" inputMode="numeric" value={sample.recoveryScore}
                onChange={(e) => setSample({ ...sample, recoveryScore: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Steps" inputMode="numeric" value={sample.steps}
                onChange={(e) => setSample({ ...sample, steps: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Active calories" inputMode="numeric" value={sample.activeCalories}
                onChange={(e) => setSample({ ...sample, activeCalories: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Exercise minutes" inputMode="numeric" value={sample.exerciseMinutes}
                onChange={(e) => setSample({ ...sample, exerciseMinutes: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button
                type="button"
                onClick={sync}
                disabled={busy}
                className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg px-2 py-1.5"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Sync reading
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 flex items-center gap-2">
              <Moon className="w-3 h-3" /> Recovery metrics feed HRV + readiness.
              <Footprints className="w-3 h-3" /> Steps + calories feed activity rings.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
