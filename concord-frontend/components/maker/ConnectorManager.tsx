'use client';

/**
 * ConnectorManager — bind external APIs / data sources (REST, GraphQL,
 * Google Sheet, Airtable, PostgreSQL, webhook) to a maker project, the way
 * Retool's "Resources" panel does. Backed by `app-maker` connector.* macros
 * (connectorKinds / connectorSave / connectorList / connectorDelete /
 * connectorTest — all real: `connectorTest` issues an actual network probe).
 *
 * Closes a real gap: the Visual Editor's data-binding dropdown has always
 * had a "Connectors" optgroup, but nothing ever populated `project.connectors`
 * because this management surface didn't exist — the optgroup was permanently
 * empty. This is the missing other half.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plug, Plus, Trash2, Loader2, Zap, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';

interface ConnectorKind { kind: string; label: string; authModes: string[] }
interface Connector {
  id: string; name: string; kind: string; endpoint: string; method: string;
  authMode: string; credentialHint: string | null; status: string; lastTestedAt?: string;
}

const STATUS_ICON: Record<string, typeof CheckCircle2> = {
  verified: CheckCircle2, error: XCircle, configured: HelpCircle,
};
const STATUS_COLOR: Record<string, string> = {
  verified: 'text-emerald-400', error: 'text-rose-400', configured: 'text-pink-600',
};

export function ConnectorManager({ projectId, onChanged }: { projectId: string; onChanged?: () => void }) {
  const [kinds, setKinds] = useState<ConnectorKind[]>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: '', endpoint: '', method: 'GET', authMode: '', credential: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('app-maker', 'connectorList', { projectId });
    if (r.data?.ok) setConnectors(r.data.result?.connectors ?? []);
  }, [projectId]);

  useEffect(() => {
    lensRun('app-maker', 'connectorKinds', {}).then((r) => {
      if (r.data?.ok) {
        const k: ConnectorKind[] = r.data.result?.kinds ?? [];
        setKinds(k);
        if (k.length && !form.kind) setForm((p) => ({ ...p, kind: k[0].kind, authMode: k[0].authModes[0] }));
      }
    });
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refresh]);

  const activeKind = kinds.find((k) => k.kind === form.kind);

  async function save() {
    if (!form.name || !form.kind) return;
    setBusy(true);
    const r = await lensRun('app-maker', 'connectorSave', {
      projectId,
      connector: {
        name: form.name, kind: form.kind, endpoint: form.endpoint,
        method: form.method, authMode: form.authMode,
        credential: form.credential || undefined,
      },
    });
    setBusy(false);
    if (r.data?.ok) {
      setForm({ name: '', kind: kinds[0]?.kind ?? '', endpoint: '', method: 'GET', authMode: kinds[0]?.authModes[0] ?? '', credential: '' });
      await refresh();
      onChanged?.();
    }
  }

  async function test(id: string) {
    setTestingId(id);
    await lensRun('app-maker', 'connectorTest', { projectId, connectorId: id });
    setTestingId(null);
    await refresh();
  }

  async function remove(id: string) {
    const r = await lensRun('app-maker', 'connectorDelete', { projectId, connectorId: id });
    if (r.data?.ok) { await refresh(); onChanged?.(); }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-pink-300">
          <Plug className="h-4 w-4" /> Connectors
        </h3>
        <p className="mb-3 text-[11px] text-pink-700">
          External APIs and data sources this app can bind canvas elements to. Test probes issue a real network request.
        </p>
        <ul className="space-y-1.5">
          {connectors.map((c) => {
            const StatusIcon = STATUS_ICON[c.status] ?? HelpCircle;
            return (
              <li key={c.id} className="flex items-center gap-2 rounded border border-pink-900/30 bg-pink-950/10 px-2.5 py-2 text-[11px]">
                <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${STATUS_COLOR[c.status] ?? 'text-pink-600'}`} aria-hidden />
                <span className="font-medium text-pink-100">{c.name}</span>
                <span className="rounded bg-pink-900/40 px-1.5 py-0.5 text-[9px] uppercase text-pink-300">{c.kind}</span>
                {c.endpoint && <span className="truncate text-pink-700">{c.endpoint}</span>}
                {c.credentialHint && <span className="font-mono text-pink-800">{c.credentialHint}</span>}
                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => test(c.id)}
                    disabled={testingId === c.id}
                    className="inline-flex items-center gap-1 rounded bg-pink-800/40 px-2 py-0.5 text-pink-200 hover:bg-pink-700/50 disabled:opacity-40"
                  >
                    {testingId === c.id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Zap className="h-2.5 w-2.5" />} Test
                  </button>
                  <button aria-label={`Delete ${c.name}`} onClick={() => remove(c.id)} className="text-rose-400 hover:text-rose-300">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            );
          })}
          {!connectors.length && (
            <li className="rounded border border-pink-900/30 bg-pink-950/10 px-4 py-6 text-center text-[11px] text-pink-700">
              No connectors yet — add one to bind canvas elements to a live API or data source.
            </li>
          )}
        </ul>
      </div>

      <aside className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-2.5">
        <h4 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-pink-500">
          <Plus className="h-3 w-3" /> Add connector
        </h4>
        <div className="space-y-2">
          <label className="block">
            <span className="mb-0.5 block text-[10px] uppercase text-pink-700">Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="My API"
              className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] uppercase text-pink-700">Kind</span>
            <select
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value;
                const k = kinds.find((x) => x.kind === kind);
                setForm((p) => ({ ...p, kind, authMode: k?.authModes[0] ?? '' }));
              }}
              className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100"
            >
              {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] uppercase text-pink-700">Endpoint</span>
            <input
              value={form.endpoint}
              onChange={(e) => setForm((p) => ({ ...p, endpoint: e.target.value }))}
              placeholder="https://api.example.com/v1"
              className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-pink-100"
            />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase text-pink-700">Method</span>
              <select
                value={form.method}
                onChange={(e) => setForm((p) => ({ ...p, method: e.target.value }))}
                className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100"
              >
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase text-pink-700">Auth</span>
              <select
                value={form.authMode}
                onChange={(e) => setForm((p) => ({ ...p, authMode: e.target.value }))}
                className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100"
              >
                {(activeKind?.authModes ?? ['none']).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
          </div>
          {form.authMode !== 'none' && (
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase text-pink-700">Credential</span>
              <input
                type="password"
                value={form.credential}
                onChange={(e) => setForm((p) => ({ ...p, credential: e.target.value }))}
                placeholder="Stored as a masked hint only"
                className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100"
              />
            </label>
          )}
          <button
            onClick={save}
            disabled={busy || !form.name || !form.kind}
            className="inline-flex w-full items-center justify-center gap-1 rounded bg-pink-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-pink-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add connector
          </button>
        </div>
      </aside>
    </div>
  );
}
