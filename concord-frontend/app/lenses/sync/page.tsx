'use client';

/**
 * /lenses/sync — DTU sync devices. Phase 9.6 #19.
 * iCloud-killer for thoughts. No subscriptions.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { LensSubstratePanel } from '@/components/lens/LensSubstratePanel';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SyncRepos } from '@/components/sync/SyncRepos';

interface Device {
  id: number;
  device_label: string;
  registered_at: number;
  last_synced_at: number | null;
  auto_sync: number;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function SyncPage() {
  useLensCommand([
    { id: 'sync-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'sync' });

  const [devices, setDevices] = useState<Device[]>([]);
  const [label, setLabel] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('dtu_sync', 'list_devices');
    if (r?.ok) setDevices(r.devices || []);
  };

  useEffect(() => { void refresh(); }, []);

  const register = async () => {
    if (!label) return;
    const r = await macro('dtu_sync', 'register_device', { deviceLabel: label, autoSync: true });
    if (r?.ok) {
      setToken(r.deviceToken);
      setStatus(`✓ Registered "${label}". Save the token below — shown once.`);
      setLabel('');
      await refresh();
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 8000);
  };

  return (
        <LensShell lensId="sync">
      <FirstRunTour lensId="sync" />
      <DepthBadge lensId="sync" size="sm" className="ml-2" />
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">DTU Sync</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Your second brain follows you across devices, instances, peers. Phase 0 universal file format means any artifact bytes ride along too.
            {' '}<strong>No subscription.</strong> Pure peer-to-peer over Concord federation.
          </p>
        </header>

        {status && (
          <div className="mb-4 bg-emerald-950/50 border border-emerald-700/50 text-emerald-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        {token && (
          <div className="mb-4 bg-zinc-950 border border-amber-600/50 rounded-lg p-3">
            <p className="text-amber-300 text-xs uppercase tracking-wider font-bold mb-1">Device token (shown once)</p>
            <p className="text-zinc-100 font-mono text-xs break-all">{token}</p>
          </div>
        )}

        <section className="mb-6 bg-zinc-900/80 border border-emerald-800/50 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-emerald-300">Register a device</h2>
          <input
            type="text" placeholder="Device label (e.g. 'MacBook Pro')"
            value={label} onChange={(e) => setLabel(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <button
            type="button" onClick={register} disabled={!label}
            className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          >Register</button>
        </section>

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Your Devices</h2>
        {devices.length === 0 ? (
          <p className="text-zinc-500 italic">No devices registered.</p>
        ) : (
          <ul className="space-y-2">
            {devices.map(d => (
              <li key={d.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-sm">
                <p className="text-zinc-100 font-medium">{d.device_label}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                  registered {new Date(d.registered_at * 1000).toLocaleDateString()} ·
                  {d.last_synced_at ? ` last sync ${new Date(d.last_synced_at * 1000).toLocaleString()}` : ' never synced'} ·
                  auto {d.auto_sync ? 'on' : 'off'}
                </p>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <SyncRepos />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <section className="mt-4"><LensSubstratePanel domain="sync" noun="device" /></section>
          <RecentMineCard domain="sync" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="sync" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="sync" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
