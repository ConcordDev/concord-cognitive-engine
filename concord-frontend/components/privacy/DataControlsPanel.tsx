'use client';

/**
 * DataControlsPanel — the user-exercisable side of the privacy lens.
 *
 * Mounts seven OneTrust/Apple-Privacy parity surfaces, every one wired to a
 * real privacy-domain macro (no mock data anywhere):
 *   - DSAR handler          → dsarSubmit / dsarList / dsarAdvance
 *   - Per-lens sharing grid  → lensSharingGet / lensSharingSet
 *   - Privacy activity log   → accessLog / recordAccess
 *   - Data export bundle     → dataExport
 *   - Cookie banner config   → cookieConfigGet / cookieConfigSet
 *   - Retention policy editor→ retentionGet / retentionSet
 *   - Data-flow map          → flowMap / flowRegister / flowToggle
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, TreeDiagram } from '@/components/viz';
import type { TimelineEvent, TreeNode } from '@/components/viz';
import {
  FileSearch,
  SlidersHorizontal,
  ScrollText,
  Download,
  Cookie,
  Timer,
  Network,
  Loader2,
  Plus,
  RefreshCw,
  CheckCircle2,
  X,
} from 'lucide-react';

// ── Wire types ────────────────────────────────────────────────────────────

interface DsarRequest {
  id: string;
  kind: string;
  note: string;
  status: string;
  submittedAt: number;
  dueAt: number;
  resolvedAt: number | null;
  history: { status: string; at: number }[];
}
interface DsarListResult {
  requests: DsarRequest[];
  totalRequests: number;
  openCount: number;
  overdueCount: number;
}
interface LensShare { lensId: string; read: boolean; share: boolean }
interface LensSharingResult {
  lenses: LensShare[];
  readEnabled: number;
  shareEnabled: number;
}
interface AccessEvent {
  id: string;
  at: number;
  actor: string;
  actorKind: string;
  lensId: string;
  dataCategory: string;
  operation: string;
}
interface AccessLogResult {
  events: AccessEvent[];
  totalEvents: number;
  byActor: Record<string, number>;
  byOperation: Record<string, number>;
}
interface ExportResult {
  counts: Record<string, number>;
  totalRecords: number;
  estimatedBytes: number;
  bundle: unknown;
}
interface CookieCategory { enabled: boolean; locked: boolean }
interface CookieConfig {
  bannerEnabled: boolean;
  position: string;
  defaultState: string;
  categories: Record<string, CookieCategory>;
  consentString: string | null;
  updatedAt: number | null;
}
interface RetentionPolicy {
  category: string;
  windowDays: number;
  action: string;
  isDefault: boolean;
}
interface DataFlow {
  id: string;
  destination: string;
  destinationKind: string;
  dataCategory: string;
  direction: string;
  purpose: string;
  active: boolean;
}
interface FlowMapResult {
  flows: DataFlow[];
  graph: { nodes: { id: string; label: string; kind: string }[]; edges: unknown[] };
  outboundCount: number;
  inboundCount: number;
}

// ── Small shared bits ─────────────────────────────────────────────────────

function fmt(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
  action,
}: {
  icon: typeof FileSearch;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="p-1.5 rounded-lg bg-neon-blue/15 border border-neon-blue/25">
            <Icon className="w-4 h-4 text-neon-blue" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-xs text-gray-500">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  received: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  in_review: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

// ── DSAR section ──────────────────────────────────────────────────────────

function DsarSection() {
  const [list, setList] = useState<DsarListResult | null>(null);
  const [kind, setKind] = useState('access');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await lensRun<DsarListResult>('privacy', 'dsarList', {});
    if (r.data.ok && r.data.result) setList(r.data.result);
    else setError(r.data.error || 'failed to load requests');
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<{ totalRequests: number }>('privacy', 'dsarSubmit', { kind, note });
    if (r.data.ok) { setNote(''); await reload(); }
    else setError(r.data.error || 'submit failed');
    setBusy(false);
  }, [kind, note, reload]);

  const advance = useCallback(async (dsarId: string, status: string) => {
    const r = await lensRun('privacy', 'dsarAdvance', { dsarId, status });
    if (r.data.ok) await reload();
    else setError(r.data.error || 'advance failed');
  }, [reload]);

  return (
    <SectionCard
      icon={FileSearch}
      title="Data Subject Requests (DSAR)"
      subtitle="Submit and track access, export, deletion and rectification requests."
      action={
        list ? (
          <div className="text-right text-xs">
            <span className="text-gray-500">{list.openCount} open</span>
            {list.overdueCount > 0 && (
              <span className="ml-2 text-rose-400">{list.overdueCount} overdue</span>
            )}
          </div>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
        >
          <option value="access">Access my data</option>
          <option value="export">Export my data</option>
          <option value="deletion">Delete my data</option>
          <option value="rectification">Rectify my data</option>
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the request…"
          className="flex-1 min-w-[180px] bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-gray-600"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="px-3 py-1.5 text-xs bg-neon-blue/15 border border-neon-blue/30 rounded-lg hover:bg-neon-blue/25 disabled:opacity-50 flex items-center gap-1.5 text-neon-blue"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Submit Request
        </button>
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="space-y-1.5">
        {list?.requests.length === 0 && (
          <p className="text-xs text-gray-600">No requests yet.</p>
        )}
        {list?.requests.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/30 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white capitalize">{r.kind}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] border ${STATUS_TONE[r.status] || 'bg-gray-500/15 text-gray-300 border-gray-500/30'}`}
                >
                  {r.status.replace('_', ' ')}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 truncate">
                Filed {fmt(r.submittedAt)} · due {fmt(r.dueAt)}
                {r.note ? ` · ${r.note}` : ''}
              </p>
            </div>
            {r.status !== 'completed' && r.status !== 'rejected' && (
              <div className="flex gap-1 shrink-0">
                {r.status === 'received' && (
                  <button
                    onClick={() => advance(r.id, 'in_review')}
                    className="px-2 py-1 text-[10px] rounded bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                  >
                    Start review
                  </button>
                )}
                <button
                  onClick={() => advance(r.id, 'completed')}
                  className="px-2 py-1 text-[10px] rounded bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                >
                  Complete
                </button>
                <button
                  onClick={() => advance(r.id, 'rejected')}
                  className="px-2 py-1 text-[10px] rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ── Per-lens sharing grid ─────────────────────────────────────────────────

function LensSharingSection() {
  const [data, setData] = useState<LensSharingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await lensRun<LensSharingResult>('privacy', 'lensSharingGet', {});
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setError(r.data.error || 'failed to load sharing settings');
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const set = useCallback(
    async (lensId: string, patch: { read?: boolean; share?: boolean }) => {
      const r = await lensRun('privacy', 'lensSharingSet', { lensId, ...patch });
      if (r.data.ok) await reload();
      else setError(r.data.error || 'update failed');
    },
    [reload],
  );

  return (
    <SectionCard
      icon={SlidersHorizontal}
      title="Per-Lens Data Sharing"
      subtitle="Granular control of which lenses may read your data and share it onward."
      action={
        data ? (
          <p className="text-xs text-gray-500">
            {data.readEnabled} read · {data.shareEnabled} share
          </p>
        ) : null
      }
    >
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {data?.lenses.map((l) => (
          <div
            key={l.lensId}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/30 px-3 py-2"
          >
            <span className="text-xs font-medium text-white capitalize">{l.lensId}</span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={l.read}
                  onChange={(e) => set(l.lensId, { read: e.target.checked })}
                  className="accent-neon-blue"
                />
                read
              </label>
              <label className="flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={l.share}
                  onChange={(e) => set(l.lensId, { share: e.target.checked })}
                  className="accent-neon-purple"
                />
                share
              </label>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ── Privacy activity log ──────────────────────────────────────────────────

const OP_TONE: Record<string, TimelineEvent['tone']> = {
  read: 'info',
  write: 'warn',
  share: 'bad',
  delete: 'bad',
};

function AccessLogSection() {
  const [data, setData] = useState<AccessLogResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await lensRun<AccessLogResult>('privacy', 'accessLog', { limit: 100 });
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setError(r.data.error || 'failed to load access log');
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const events: TimelineEvent[] = useMemo(
    () =>
      (data?.events || []).map((e) => ({
        id: e.id,
        time: e.at,
        label: `${e.actor} · ${e.operation}`,
        detail: `${e.dataCategory}${e.lensId ? ` (${e.lensId})` : ''}`,
        tone: OP_TONE[e.operation] || 'default',
      })),
    [data],
  );

  return (
    <SectionCard
      icon={ScrollText}
      title="Privacy Activity Log"
      subtitle="Recent data accesses — which lens or agent read what, and when."
      action={
        <button
          onClick={reload}
          className="px-2 py-1 text-[10px] rounded bg-white/5 text-gray-400 hover:bg-white/10 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      }
    >
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {data && data.totalEvents === 0 ? (
        <p className="text-xs text-gray-600">No data accesses recorded yet.</p>
      ) : (
        <>
          <TimelineView events={events} height={110} />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {Object.entries(data?.byOperation || {}).map(([op, n]) => (
              <span
                key={op}
                className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-gray-400"
              >
                {op}: {n}
              </span>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ── Data export ───────────────────────────────────────────────────────────

function DataExportSection() {
  const [result, setResult] = useState<ExportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<ExportResult>('privacy', 'dataExport', {});
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setError(r.data.error || 'export failed');
    setBusy(false);
  }, []);

  const download = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `concord-privacy-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <SectionCard
      icon={Download}
      title="Download My Data"
      subtitle="Generate a full export bundle of your personal privacy corpus."
      action={
        <button
          onClick={generate}
          disabled={busy}
          className="px-3 py-1.5 text-xs bg-neon-green/15 border border-neon-green/30 rounded-lg hover:bg-neon-green/25 disabled:opacity-50 flex items-center gap-1.5 text-neon-green"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Generate Bundle
        </button>
      }
    >
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {Object.entries(result.counts).map(([k, n]) => (
              <span
                key={k}
                className="px-2 py-1 rounded-lg text-[10px] bg-black/40 border border-white/5 text-gray-300"
              >
                {k}: <span className="text-white font-mono">{n}</span>
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-gray-500">
              {result.totalRecords} records · ~
              {(result.estimatedBytes / 1024).toFixed(1)} KB
            </p>
            <button
              onClick={download}
              className="px-3 py-1.5 text-xs bg-neon-blue/15 border border-neon-blue/30 rounded-lg hover:bg-neon-blue/25 flex items-center gap-1.5 text-neon-blue"
            >
              <Download className="w-3 h-3" /> Download .json
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── Cookie / tracker banner config ────────────────────────────────────────

const COOKIE_CATS = ['essential', 'functional', 'analytics', 'advertising'] as const;

function CookieConfigSection() {
  const [cfg, setCfg] = useState<CookieConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await lensRun<{ config: CookieConfig }>('privacy', 'cookieConfigGet', {});
      if (r.data.ok && r.data.result) setCfg(r.data.result.config);
      else setError(r.data.error || 'failed to load cookie config');
    })();
  }, []);

  const save = useCallback(async () => {
    if (!cfg) return;
    setBusy(true);
    setError(null);
    const r = await lensRun<{ config: CookieConfig }>('privacy', 'cookieConfigSet', {
      config: cfg,
    });
    if (r.data.ok && r.data.result) {
      setCfg(r.data.result.config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else setError(r.data.error || 'save failed');
    setBusy(false);
  }, [cfg]);

  if (!cfg) {
    return (
      <SectionCard
        icon={Cookie}
        title="Cookie & Tracker Consent Banner"
        subtitle="Configure the consent surface shown to visitors."
      >
        <p className="text-xs text-gray-600">{error || 'Loading…'}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      icon={Cookie}
      title="Cookie & Tracker Consent Banner"
      subtitle="Configure the consent surface shown to visitors."
      action={
        <button
          onClick={save}
          disabled={busy}
          className="px-3 py-1.5 text-xs bg-neon-blue/15 border border-neon-blue/30 rounded-lg hover:bg-neon-blue/25 disabled:opacity-50 flex items-center gap-1.5 text-neon-blue"
        >
          {busy ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="w-3 h-3" />
          ) : null}
          {saved ? 'Saved' : 'Save Banner'}
        </button>
      }
    >
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-300">
          <input
            type="checkbox"
            checked={cfg.bannerEnabled}
            onChange={(e) => setCfg({ ...cfg, bannerEnabled: e.target.checked })}
            className="accent-neon-blue"
          />
          Banner enabled
        </label>
        <select
          value={cfg.position}
          onChange={(e) => setCfg({ ...cfg, position: e.target.value })}
          className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
        >
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="modal">Modal</option>
        </select>
        <select
          value={cfg.defaultState}
          onChange={(e) => setCfg({ ...cfg, defaultState: e.target.value })}
          className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
        >
          <option value="opt_in">Opt-in default</option>
          <option value="opt_out">Opt-out default</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {COOKIE_CATS.map((c) => {
          const cat = cfg.categories[c];
          return (
            <label
              key={c}
              className={`flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-black/30 px-3 py-2 text-xs ${cat.locked ? 'opacity-70' : 'cursor-pointer'}`}
            >
              <span className="capitalize text-white">{c}</span>
              <input
                type="checkbox"
                checked={cat.enabled}
                disabled={cat.locked}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    categories: {
                      ...cfg.categories,
                      [c]: { ...cat, enabled: e.target.checked },
                    },
                  })
                }
                className="accent-neon-blue"
              />
            </label>
          );
        })}
      </div>
      {cfg.consentString && (
        <p className="text-[10px] text-gray-500 font-mono">
          consent string: {cfg.consentString}
        </p>
      )}
    </SectionCard>
  );
}

// ── Retention policy editor ───────────────────────────────────────────────

function RetentionSection() {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await lensRun<{ policies: RetentionPolicy[] }>('privacy', 'retentionGet', {});
    if (r.data.ok && r.data.result) setPolicies(r.data.result.policies);
    else setError(r.data.error || 'failed to load retention policies');
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const update = useCallback(
    async (category: string, patch: { windowDays?: number; action?: string }) => {
      const cur = policies.find((p) => p.category === category);
      const r = await lensRun('privacy', 'retentionSet', {
        category,
        windowDays: patch.windowDays ?? cur?.windowDays ?? 0,
        action: patch.action ?? cur?.action ?? 'delete',
      });
      if (r.data.ok) await reload();
      else setError(r.data.error || 'update failed');
    },
    [policies, reload],
  );

  return (
    <SectionCard
      icon={Timer}
      title="Retention Policy Editor"
      subtitle="Auto-expire data categories after a chosen window."
    >
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="space-y-1.5">
        {policies.map((p) => (
          <div
            key={p.category}
            className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/30 px-3 py-2"
          >
            <span className="text-xs text-white">
              {p.category.replace(/_/g, ' ')}
              {p.isDefault && (
                <span className="ml-1.5 text-[9px] text-gray-600">(default)</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={3650}
                value={p.windowDays}
                onChange={(e) =>
                  update(p.category, { windowDays: parseInt(e.target.value) || 0 })
                }
                className="w-16 bg-black/40 border border-white/10 rounded px-1.5 py-1 text-xs text-white"
              />
              <span className="text-[10px] text-gray-500">days</span>
              <select
                value={p.action}
                onChange={(e) => update(p.category, { action: e.target.value })}
                className="bg-black/40 border border-white/10 rounded px-1.5 py-1 text-xs text-white"
              >
                <option value="delete">delete</option>
                <option value="anonymize">anonymize</option>
                <option value="archive">archive</option>
              </select>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-gray-600">0 days = keep forever.</p>
    </SectionCard>
  );
}

// ── Third-party data-flow map ─────────────────────────────────────────────

function FlowMapSection() {
  const [data, setData] = useState<FlowMapResult | null>(null);
  const [destination, setDestination] = useState('');
  const [direction, setDirection] = useState('outbound');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const r = await lensRun<FlowMapResult>('privacy', 'flowMap', {});
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setError(r.data.error || 'failed to load flow map');
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const register = useCallback(async () => {
    if (!destination.trim()) return;
    const r = await lensRun('privacy', 'flowRegister', { destination, direction });
    if (r.data.ok) { setDestination(''); await reload(); }
    else setError(r.data.error || 'register failed');
  }, [destination, direction, reload]);

  const toggle = useCallback(
    async (flowId: string, active: boolean) => {
      const r = await lensRun('privacy', 'flowToggle', { flowId, active });
      if (r.data.ok) await reload();
      else setError(r.data.error || 'toggle failed');
    },
    [reload],
  );

  const tree: TreeNode[] = useMemo(() => {
    if (!data) return [];
    const outbound = data.flows.filter((f) => f.direction === 'outbound');
    const inbound = data.flows.filter((f) => f.direction === 'inbound');
    const branch = (label: string, flows: DataFlow[]): TreeNode => ({
      id: label,
      label: `${label} (${flows.length})`,
      tone: 'info',
      children: flows.map((f) => ({
        id: f.id,
        label: f.destination,
        detail: `${f.dataCategory} · ${f.purpose}`,
        tone: f.active ? 'warn' : 'default',
      })),
    });
    return [
      {
        id: 'you',
        label: 'Your data',
        tone: 'good',
        children: [branch('Outbound', outbound), branch('Inbound', inbound)],
      },
    ];
  }, [data]);

  return (
    <SectionCard
      icon={Network}
      title="Third-Party Data-Flow Map"
      subtitle="Visualize where your data leaves the platform via federation."
      action={
        data ? (
          <p className="text-xs text-gray-500">
            {data.outboundCount} out · {data.inboundCount} in
          </p>
        ) : null
      }
    >
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Federation peer / destination…"
          className="flex-1 min-w-[160px] bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder:text-gray-600"
        />
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white"
        >
          <option value="outbound">Outbound</option>
          <option value="inbound">Inbound</option>
        </select>
        <button
          onClick={register}
          className="px-3 py-1.5 text-xs bg-neon-blue/15 border border-neon-blue/30 rounded-lg hover:bg-neon-blue/25 flex items-center gap-1.5 text-neon-blue"
        >
          <Plus className="w-3 h-3" /> Register Flow
        </button>
      </div>
      {data && data.flows.length === 0 ? (
        <p className="text-xs text-gray-600">No data flows registered yet.</p>
      ) : (
        <>
          <TreeDiagram root={tree} />
          <div className="space-y-1 pt-1">
            {data?.flows.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/30 px-3 py-1.5"
              >
                <span className="text-[11px] text-gray-300 truncate">
                  {f.direction === 'outbound' ? '→ ' : '← '}
                  {f.destination}
                </span>
                <button
                  onClick={() => toggle(f.id, !f.active)}
                  className={`px-2 py-0.5 rounded text-[10px] flex items-center gap-1 ${f.active ? 'bg-amber-500/15 text-amber-300' : 'bg-gray-500/15 text-gray-400'}`}
                >
                  {f.active ? <CheckCircle2 className="w-3 h-3" /> : <X className="w-3 h-3" />}
                  {f.active ? 'active' : 'paused'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────

export function DataControlsPanel() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-white">Data Controls</h2>
        <span className="text-xs text-gray-500">
          OneTrust / Apple Privacy parity — the controls you actually exercise.
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DsarSection />
        <LensSharingSection />
        <AccessLogSection />
        <DataExportSection />
        <CookieConfigSection />
        <RetentionSection />
        <div className="lg:col-span-2">
          <FlowMapSection />
        </div>
      </div>
    </div>
  );
}
