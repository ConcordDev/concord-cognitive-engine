'use client';

/**
 * SyncDashboard — the cross-device synchronization experience surface.
 *
 * Wires the `sync` domain macros (server/domains/sync.js) into real
 * purpose-built UI: aggregate status, per-device cards with sync-now /
 * revoke / auto-sync / quota / selective-sync, a conflict-resolution
 * panel, and an activity-feed timeline.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Trash2, HardDrive, AlertTriangle, CheckCircle2,
  WifiOff, Wifi, Loader2, Plus, FolderTree, Gauge, Clock, GitMerge,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';

const DOMAIN = 'sync';

interface Device {
  id: string;
  label: string;
  autoSync: boolean;
  online: boolean;
  lastSeenAt: number | null;
  lastSyncAt: number | null;
  lastSyncStatus: string;
  scopes: string[];
  quotaBytes: number;
  usedBytes: number;
  quotaPct: number;
  dtusSynced: number;
  revoked: boolean;
}

interface Conflict {
  id: string;
  dtuId: string;
  title: string;
  status: 'open' | 'resolved';
  detectedAt: number;
  local: { deviceLabel: string; editedAt: number; summary: string };
  remote: { deviceLabel: string; editedAt: number; summary: string };
  resolution: { choice: string; resolvedAt: number } | null;
}

interface ScopeMeta { id: string; label: string; note: string; }

interface StatusSummary {
  deviceCount: number;
  onlineCount: number;
  lastSyncAt: number | null;
  dtusSynced: number;
  usedBytes: number;
  quotaBytes: number;
  quotaPct: number;
  openConflicts: number;
  state: string;
}

interface LogEntry {
  id: string;
  at: number;
  kind: string;
  message?: string;
  deviceId?: string | null;
  label?: string | null;
}

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}
function ago(t: number | null | undefined): string {
  if (!t) return 'never';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TONE_FOR_KIND: Record<string, TimelineEvent['tone']> = {
  device_registered: 'info',
  device_revoked: 'bad',
  sync: 'good',
  auto_sync_changed: 'default',
  scopes_changed: 'default',
  quota_changed: 'default',
  conflict_detected: 'warn',
  conflict_resolved: 'good',
};

const STATE_BADGE: Record<string, { text: string; cls: string }> = {
  synced: { text: 'All synced', cls: 'bg-emerald-900/60 text-emerald-200 border-emerald-700/50' },
  needs_attention: { text: 'Needs attention', cls: 'bg-amber-900/60 text-amber-200 border-amber-700/50' },
  all_offline: { text: 'All devices offline', cls: 'bg-zinc-800 text-zinc-300 border-zinc-700' },
  no_devices: { text: 'No devices', cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' },
};

export function SyncDashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [status, setStatus] = useState<StatusSummary | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [scopeCatalog, setScopeCatalog] = useState<ScopeMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [scopeEditor, setScopeEditor] = useState<string | null>(null);
  const [quotaEditor, setQuotaEditor] = useState<string | null>(null);
  const [quotaInput, setQuotaInput] = useState('50');
  const [conflictForm, setConflictForm] = useState({ dtuId: '', title: '', localDev: '', remoteDev: '' });
  const [showConflictForm, setShowConflictForm] = useState(false);

  const flash = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 4000);
  };

  const refresh = useCallback(async () => {
    const [dRes, sRes, cRes, hRes] = await Promise.all([
      lensRun(DOMAIN, 'list_devices', {}),
      lensRun(DOMAIN, 'sync_status', {}),
      lensRun(DOMAIN, 'list_conflicts', {}),
      lensRun(DOMAIN, 'sync_history', { limit: 60 }),
    ]);
    if (dRes.data?.ok) setDevices(dRes.data.result?.devices || []);
    if (sRes.data?.ok) setStatus(sRes.data.result || null);
    if (cRes.data?.ok) setConflicts(cRes.data.result?.conflicts || []);
    if (hRes.data?.ok) setLogs(hRes.data.result?.entries || []);
  }, []);

  useEffect(() => {
    void refresh();
    void (async () => {
      const r = await lensRun(DOMAIN, 'available_scopes', {});
      if (r.data?.ok) setScopeCatalog(r.data.result?.scopes || []);
    })();
  }, [refresh]);

  // Presence: heartbeat all known devices and re-derive status every 30s.
  useEffect(() => {
    const t = window.setInterval(() => { void refresh(); }, 30000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const registerDevice = async () => {
    const label = newLabel.trim();
    if (!label) return;
    setBusy('register');
    const r = await lensRun(DOMAIN, 'register_device', { deviceLabel: label, autoSync: true });
    setBusy(null);
    if (r.data?.ok) {
      setNewLabel('');
      flash(`Registered "${label}"`);
      await refresh();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const syncNow = async (id: string) => {
    setBusy(`sync:${id}`);
    const r = await lensRun(DOMAIN, 'sync_now', { deviceId: id });
    setBusy(null);
    if (r.data?.ok) {
      const res = r.data.result as { dtuCount: number; status: string };
      flash(res.status === 'quota_exceeded'
        ? `Sync partial — quota exceeded`
        : `Synced ${res.dtuCount} DTUs`);
      await refresh();
    } else {
      flash(`Sync failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const revokeDevice = async (id: string, label: string) => {
    setBusy(`revoke:${id}`);
    const r = await lensRun(DOMAIN, 'revoke_device', { deviceId: id });
    setBusy(null);
    if (r.data?.ok) {
      flash(`Revoked "${label}"`);
      await refresh();
    } else {
      flash(`Revoke failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const toggleAutoSync = async (id: string, next: boolean) => {
    setBusy(`auto:${id}`);
    const r = await lensRun(DOMAIN, 'set_auto_sync', { deviceId: id, autoSync: next });
    setBusy(null);
    if (r.data?.ok) await refresh();
    else flash(`Failed: ${r.data?.error || 'unknown'}`);
  };

  const setScopes = async (id: string, scopes: string[]) => {
    if (scopes.length === 0) { flash('Pick at least one collection'); return; }
    setBusy(`scopes:${id}`);
    const r = await lensRun(DOMAIN, 'set_scopes', { deviceId: id, scopes });
    setBusy(null);
    if (r.data?.ok) { flash('Selective sync updated'); await refresh(); }
    else flash(`Failed: ${r.data?.error || 'unknown'}`);
  };

  const applyQuota = async (id: string) => {
    const gb = Number(quotaInput);
    if (!Number.isFinite(gb) || gb <= 0) { flash('Enter a positive GB value'); return; }
    setBusy(`quota:${id}`);
    const r = await lensRun(DOMAIN, 'set_quota', { deviceId: id, quotaGb: gb });
    setBusy(null);
    if (r.data?.ok) { flash(`Quota set to ${gb} GB`); setQuotaEditor(null); await refresh(); }
    else flash(`Failed: ${r.data?.error || 'unknown'}`);
  };

  const reportConflict = async () => {
    const dtuId = conflictForm.dtuId.trim();
    if (!dtuId) { flash('Enter a DTU id'); return; }
    setBusy('report-conflict');
    const localDev = devices.find((d) => d.id === conflictForm.localDev);
    const remoteDev = devices.find((d) => d.id === conflictForm.remoteDev);
    const r = await lensRun(DOMAIN, 'report_conflict', {
      dtuId,
      title: conflictForm.title.trim() || dtuId,
      localDeviceId: localDev?.id || null,
      localDeviceLabel: localDev?.label || 'this device',
      localSummary: 'Local edit',
      localEditedAt: Date.now(),
      remoteDeviceId: remoteDev?.id || null,
      remoteDeviceLabel: remoteDev?.label || 'other device',
      remoteSummary: 'Remote edit',
      remoteEditedAt: Date.now() - 60000,
    });
    setBusy(null);
    if (r.data?.ok) {
      flash('Conflict registered for resolution');
      setConflictForm({ dtuId: '', title: '', localDev: '', remoteDev: '' });
      setShowConflictForm(false);
      await refresh();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const resolveConflict = async (conflictId: string, choice: string) => {
    setBusy(`conflict:${conflictId}`);
    const r = await lensRun(DOMAIN, 'resolve_conflict', { conflictId, choice });
    setBusy(null);
    if (r.data?.ok) { flash('Conflict resolved'); await refresh(); }
    else flash(`Failed: ${r.data?.error || 'unknown'}`);
  };

  const openConflicts = conflicts.filter((c) => c.status === 'open');
  const timeline: TimelineEvent[] = logs.map((l) => ({
    id: l.id,
    label: l.label ? `${l.kind.replace(/_/g, ' ')} · ${l.label}` : l.kind.replace(/_/g, ' '),
    time: l.at,
    tone: TONE_FOR_KIND[l.kind] || 'default',
    detail: l.message,
  }));

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-lg border border-emerald-700/50 bg-emerald-950/90 px-4 py-2 text-sm text-emerald-100 shadow-lg">
          {toast}
        </div>
      )}

      {/* Aggregate status banner */}
      {status && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {status.state === 'synced' && <CheckCircle2 className="h-6 w-6 text-emerald-400" />}
              {status.state === 'needs_attention' && <AlertTriangle className="h-6 w-6 text-amber-400" />}
              {(status.state === 'all_offline' || status.state === 'no_devices') && <WifiOff className="h-6 w-6 text-zinc-500" />}
              <div>
                <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${(STATE_BADGE[status.state] || STATE_BADGE.no_devices).cls}`}>
                  {(STATE_BADGE[status.state] || STATE_BADGE.no_devices).text}
                </span>
                <p className="mt-1 text-xs text-zinc-500">
                  Last sync {status.lastSyncAt ? ago(status.lastSyncAt) : 'never'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Devices" value={`${status.onlineCount}/${status.deviceCount}`} hint="online" />
              <Stat label="DTUs synced" value={status.dtusSynced.toLocaleString()} />
              <Stat label="Storage" value={fmtBytes(status.usedBytes)} hint={`${status.quotaPct}% of quota`} />
              <Stat label="Conflicts" value={String(status.openConflicts)} hint="open" warn={status.openConflicts > 0} />
            </div>
          </div>
        </section>
      )}

      {/* Conflict resolution panel */}
      {openConflicts.length > 0 && (
        <section className="rounded-xl border border-amber-700/50 bg-amber-950/30 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-amber-200">
            <AlertTriangle className="h-4 w-4" /> Sync conflicts ({openConflicts.length})
          </h2>
          <ul className="space-y-3">
            {openConflicts.map((c) => (
              <li key={c.id} className="rounded-lg border border-amber-800/40 bg-zinc-950/60 p-3">
                <p className="text-sm font-semibold text-zinc-100">{c.title}</p>
                <p className="text-[11px] text-zinc-500">DTU {c.dtuId} · detected {ago(c.detectedAt)}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <ConflictSide tag="LOCAL" side={c.local} />
                  <ConflictSide tag="REMOTE" side={c.remote} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {([
                    ['keep_local', `Keep ${c.local.deviceLabel}`],
                    ['keep_remote', `Keep ${c.remote.deviceLabel}`],
                    ['keep_both', 'Keep both (fork)'],
                  ] as const).map(([choice, lbl]) => (
                    <button
                      key={choice} type="button"
                      onClick={() => resolveConflict(c.id, choice)}
                      disabled={busy === `conflict:${c.id}`}
                      className="rounded-lg border border-amber-600/50 bg-amber-800/40 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-700/50 disabled:opacity-50"
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Report a conflict (occurs when two devices edit the same DTU offline) */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
        <button
          type="button"
          onClick={() => setShowConflictForm((v) => !v)}
          className="flex items-center gap-2 text-sm font-bold text-zinc-300 hover:text-zinc-100"
        >
          <GitMerge className="h-4 w-4 text-amber-400" />
          Report a sync conflict
          <span className="text-[11px] font-normal text-zinc-500">
            {showConflictForm ? '(hide)' : '(when two devices edited the same DTU)'}
          </span>
        </button>
        {showConflictForm && (
          <div className="mt-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="text" placeholder="DTU id"
                value={conflictForm.dtuId}
                onChange={(e) => setConflictForm((f) => ({ ...f, dtuId: e.target.value }))}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
              <input
                type="text" placeholder="DTU title (optional)"
                value={conflictForm.title}
                onChange={(e) => setConflictForm((f) => ({ ...f, title: e.target.value }))}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
              <select
                value={conflictForm.localDev}
                onChange={(e) => setConflictForm((f) => ({ ...f, localDev: e.target.value }))}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="">Local device…</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
              <select
                value={conflictForm.remoteDev}
                onChange={(e) => setConflictForm((f) => ({ ...f, remoteDev: e.target.value }))}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              >
                <option value="">Remote device…</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
            <button
              type="button" onClick={reportConflict}
              disabled={!conflictForm.dtuId.trim() || busy === 'report-conflict'}
              className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {busy === 'report-conflict' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Register conflict'}
            </button>
          </div>
        )}
      </section>

      {/* Register device */}
      <section className="rounded-xl border border-emerald-800/50 bg-zinc-900/70 p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-emerald-300">
          <Plus className="h-4 w-4" /> Register a device
        </h2>
        <div className="flex gap-2">
          <input
            type="text" value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void registerDevice(); }}
            placeholder="Device label (e.g. 'MacBook Pro')"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
          <button
            type="button" onClick={registerDevice} disabled={!newLabel.trim() || busy === 'register'}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {busy === 'register' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
          </button>
        </div>
      </section>

      {/* Device cards */}
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Devices</h2>
        {devices.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">
            No devices registered yet. Add one above to start syncing your DTUs.
          </p>
        ) : (
          <ul className="space-y-3">
            {devices.map((d) => (
              <li key={d.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {d.online
                      ? <Wifi className="h-5 w-5 text-emerald-400" aria-label="online" />
                      : <WifiOff className="h-5 w-5 text-zinc-600" aria-label="offline" />}
                    <div>
                      <p className="text-sm font-semibold text-zinc-100">{d.label}</p>
                      <p className="text-[11px] text-zinc-500">
                        {d.online ? 'Online' : `Last seen ${ago(d.lastSeenAt)}`}
                        {' · '}<Clock className="inline h-3 w-3" /> last sync {ago(d.lastSyncAt)}
                        {d.lastSyncStatus === 'quota_exceeded' && (
                          <span className="ml-1 text-amber-400">· quota exceeded</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button" onClick={() => syncNow(d.id)} disabled={busy === `sync:${d.id}`}
                      className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {busy === `sync:${d.id}`
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <RefreshCw className="h-3.5 w-3.5" />}
                      Sync now
                    </button>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <input
                        type="checkbox" checked={d.autoSync}
                        onChange={(e) => toggleAutoSync(d.id, e.target.checked)}
                        disabled={busy === `auto:${d.id}`}
                        className="accent-emerald-600"
                      />
                      Auto-sync
                    </label>
                    <button
                      type="button" onClick={() => revokeDevice(d.id, d.label)}
                      disabled={busy === `revoke:${d.id}`}
                      className="flex items-center gap-1 rounded-lg border border-rose-800/60 bg-rose-950/40 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-900/50 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Revoke
                    </button>
                  </div>
                </div>

                {/* Quota usage bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" /> {fmtBytes(d.usedBytes)} of {fmtBytes(d.quotaBytes)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setQuotaEditor(quotaEditor === d.id ? null : d.id);
                        setQuotaInput(String(Math.round(d.quotaBytes / 1024 ** 3)));
                      }}
                      className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200"
                    >
                      <Gauge className="h-3 w-3" /> {d.quotaPct}% · edit quota
                    </button>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full ${d.quotaPct > 90 ? 'bg-rose-500' : d.quotaPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                      style={{ width: `${Math.min(100, d.quotaPct)}%` }}
                    />
                  </div>
                  {quotaEditor === d.id && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number" min={1} value={quotaInput}
                        onChange={(e) => setQuotaInput(e.target.value)}
                        className="w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
                      />
                      <span className="text-xs text-zinc-500">GB</span>
                      <button
                        type="button" onClick={() => applyQuota(d.id)}
                        disabled={busy === `quota:${d.id}`}
                        className="rounded bg-zinc-700 px-2 py-1 text-xs text-zinc-100 hover:bg-zinc-600"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>

                {/* Selective sync */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setScopeEditor(scopeEditor === d.id ? null : d.id)}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    <FolderTree className="h-3 w-3" />
                    Selective sync: {d.scopes.join(', ')}
                  </button>
                  {scopeEditor === d.id && scopeCatalog.length > 0 && (
                    <div className="mt-2 grid gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 sm:grid-cols-2">
                      {scopeCatalog.map((sc) => {
                        const on = d.scopes.includes(sc.id);
                        return (
                          <button
                            key={sc.id} type="button"
                            onClick={() => {
                              const next = on
                                ? d.scopes.filter((x) => x !== sc.id)
                                : [...d.scopes, sc.id];
                              void setScopes(d.id, next);
                            }}
                            disabled={busy === `scopes:${d.id}`}
                            className={`rounded-lg border px-2 py-1.5 text-left text-[11px] transition-colors ${
                              on
                                ? 'border-emerald-700/60 bg-emerald-950/50 text-emerald-200'
                                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600'
                            }`}
                          >
                            <span className="font-semibold">{sc.label}</span>
                            <span className="block text-[10px] text-zinc-500">{sc.note}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Activity feed */}
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Sync activity</h2>
        {timeline.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">
            No sync activity yet.
          </p>
        ) : (
          <>
            <TimelineView events={timeline} height={110} />
            <ul className="mt-3 space-y-1.5">
              {logs.slice(0, 12).map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-xs text-zinc-400">
                  <span className="mt-0.5 w-20 shrink-0 font-mono text-[10px] text-zinc-600">{ago(l.at)}</span>
                  <span>{l.message || l.kind}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Resolved conflicts history */}
      {conflicts.some((c) => c.status === 'resolved') && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Resolved conflicts</h2>
          <ul className="space-y-1.5">
            {conflicts.filter((c) => c.status === 'resolved').map((c) => (
              <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-400">
                <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />
                <span className="text-zinc-200">{c.title}</span>
                {' — '}{c.resolution?.choice.replace(/_/g, ' ')}
                {c.resolution?.resolvedAt ? ` · ${ago(c.resolution.resolvedAt)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-lg ${warn ? 'text-amber-300' : 'text-emerald-300'}`}>{value}</div>
      {hint && <div className="text-[10px] text-zinc-600">{hint}</div>}
    </div>
  );
}

function ConflictSide({ tag, side }: {
  tag: string;
  side: { deviceLabel: string; editedAt: number; summary: string };
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">{tag} · {side.deviceLabel}</p>
      <p className="mt-0.5 text-xs text-zinc-200">{side.summary}</p>
      <p className="text-[10px] text-zinc-600">edited {new Date(side.editedAt).toLocaleString()}</p>
    </div>
  );
}
