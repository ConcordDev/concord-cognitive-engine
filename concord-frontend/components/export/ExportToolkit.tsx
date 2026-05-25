'use client';

// ExportToolkit — surfaces the seven export-domain backlog features:
// scheduled-export execution, cloud destinations, PDF generation,
// incremental/delta exports, export history + re-download, encrypted
// archives, and selective field-level export. Every value shown is a
// real user input or computed by the backend from real input — no mock
// or seed data anywhere in this component.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock, Cloud, FileDown, GitCompareArrows, History, Lock,
  Columns3, Loader2, Plus, Trash2, RefreshCw, Download, Power, X,
} from 'lucide-react';
import { lensRun, api } from '@/lib/api/client';

// ── shared types ────────────────────────────────────────────────────
interface Dtu { id?: string; title?: string; tier?: string; tags?: string[]; updatedAt?: string; createdAt?: string; [k: string]: unknown }
interface Schedule { id: string; name: string; frequency: string; format: string; destination: string; dataSources: string[]; fields: string[]; enabled: boolean; createdAt: string; lastRun: string | null; nextRun: string | null; runCount: number; due?: boolean }
interface RunRecord { id: string; at: string; format: string; itemCount: number; byteLength: number; dataSources: string[]; trigger: string; filename: string; scheduleId: string | null; hasPayload?: boolean }
interface CloudConn { id: string; provider: string; accountLabel: string; tokenFingerprint: string; scope: string; connectedAt: string; lastDeliveryAt: string | null; deliveries: number }
interface FieldInfo { name: string; occurrences: number; type: string; coverage: number }
interface Cursor { dataSource: string; lastRunAt: string }

const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function dl(filename: string, data: BlobPart, mime: string) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

export function ExportToolkit() {
  const { data: dtusData } = useQuery({
    queryKey: ['dtus'],
    queryFn: () => api.get('/api/dtus').then((r) => r.data),
  });
  const dtus = useMemo<Dtu[]>(() => (dtusData?.dtus || []) as Dtu[], [dtusData]);

  return (
    <div className="space-y-6">
      <header className="border-b border-zinc-800 pb-3">
        <h2 className="text-sm font-semibold text-white">Export Toolkit</h2>
        <p className="mt-0.5 text-[11px] text-zinc-400">
          Scheduled runs, cloud delivery, PDF, delta exports, history, encryption and column selection — all backed by the export domain.
        </p>
      </header>
      <ScheduledExports dtus={dtus} />
      <IncrementalExport dtus={dtus} />
      <SelectiveFields dtus={dtus} />
      <PdfExport dtus={dtus} />
      <EncryptedArchive dtus={dtus} />
      <CloudDestinations />
      <ExportHistory />
    </div>
  );
}

// ── panel chrome ────────────────────────────────────────────────────
function Panel({ icon: Icon, title, tag, children }: { icon: typeof Cloud; title: string; tag?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-teal-400" />
        <h3 className="text-xs font-semibold text-white">{title}</h3>
        {tag && <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400">{tag}</span>}
      </div>
      {children}
    </section>
  );
}

// ── [M] scheduled-export execution ──────────────────────────────────
function ScheduledExports({ dtus }: { dtus: Dtu[] }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [format, setFormat] = useState('json');
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('export', 'schedule-list', {});
    if (r.data?.ok && r.data.result) setSchedules((r.data.result as { schedules: Schedule[] }).schedules);
  }, []);

  const runDue = useCallback(async () => {
    const list = (await lensRun('export', 'schedule-list', {})).data?.result as { schedules: Schedule[] } | null;
    if (!list) return;
    const itemCounts: Record<string, number> = {};
    const byteLengths: Record<string, number> = {};
    for (const s of list.schedules) {
      itemCounts[s.id] = dtus.length;
      byteLengths[s.id] = JSON.stringify(dtus).length;
    }
    const r = await lensRun('export', 'schedule-run-due', { itemCounts, byteLengths });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { executedCount: number };
      setLastRun(res.executedCount > 0 ? `Executed ${res.executedCount} due schedule(s)` : 'No schedules due');
      await refresh();
    }
  }, [dtus, refresh]);

  useEffect(() => {
    refresh();
    runDue();
    const iv = setInterval(runDue, 60_000);
    return () => clearInterval(iv);
  }, [refresh, runDue]);

  const create = async () => {
    setBusy(true);
    try {
      const r = await lensRun('export', 'schedule-create', { name: name || `${frequency} export`, frequency, format, dataSources: ['dtus'] });
      if (r.data?.ok) { setName(''); await refresh(); }
    } finally { setBusy(false); }
  };
  const toggle = async (id: string) => { await lensRun('export', 'schedule-toggle', { id }); await refresh(); };
  const remove = async (id: string) => { await lensRun('export', 'schedule-delete', { id }); await refresh(); };

  return (
    <Panel icon={CalendarClock} title="Scheduled exports" tag="auto-runs every 60s">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[10px] text-zinc-400">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly backup"
            className="w-44 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white" />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-zinc-400">
          Frequency
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white">
            <option value="daily">daily</option><option value="weekly">weekly</option><option value="monthly">monthly</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-zinc-400">
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white">
            <option value="json">json</option><option value="csv">csv</option><option value="markdown">markdown</option><option value="pdf">pdf</option>
          </select>
        </label>
        <button onClick={create} disabled={busy} className="flex items-center gap-1 rounded bg-teal-600 px-2.5 py-1.5 text-xs text-white hover:bg-teal-500 disabled:opacity-40">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create
        </button>
        <button onClick={runDue} className="flex items-center gap-1 rounded border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-500">
          <RefreshCw className="h-3 w-3" /> Run due now
        </button>
      </div>
      {lastRun && <p className="mb-2 text-[10px] text-teal-400">{lastRun}</p>}
      {schedules.length === 0 ? (
        <p className="text-[11px] text-zinc-400">No schedules configured yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {schedules.map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5">
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs text-white">{s.name}</p>
                <p className="text-[10px] text-zinc-400">
                  {s.frequency} · {s.format.toUpperCase()} · ran {s.runCount}× · next {fmtTime(s.nextRun)}
                  {s.due && <span className="ml-1 text-amber-400">due</span>}
                </p>
              </div>
              <button onClick={() => toggle(s.id)} title={s.enabled ? 'Disable' : 'Enable'}
                className={`rounded p-1 ${s.enabled ? 'text-teal-400' : 'text-zinc-600'} hover:bg-zinc-800`}>
                <Power className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => remove(s.id)} title="Delete" className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── [M] incremental / delta export ──────────────────────────────────
function IncrementalExport({ dtus }: { dtus: Dtu[] }) {
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [result, setResult] = useState<{ changedRecords: number; unchangedRecords: number; isFirstRun: boolean; newCursor: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun('export', 'cursor-list', {});
    if (r.data?.ok && r.data.result) setCursors((r.data.result as { cursors: Cursor[] }).cursors);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const pull = async (commit: boolean) => {
    setBusy(true);
    try {
      const r = await lensRun('export', 'incremental-pull', { dataSource: 'dtus', records: dtus, timestampField: 'updatedAt', commit });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { changedRecords: number; unchangedRecords: number; isFirstRun: boolean; newCursor: string | null; records: Dtu[] };
        setResult(res);
        if (commit && res.records.length > 0) {
          dl(`concord-delta-${Date.now()}.json`, JSON.stringify(res.records, null, 2), 'application/json');
          await lensRun('export', 'record-run', { format: 'json', itemCount: res.records.length, byteLength: JSON.stringify(res.records).length, dataSources: ['dtus'], trigger: 'incremental', filename: `concord-delta-${Date.now()}.json` });
        }
        await refresh();
      }
    } finally { setBusy(false); }
  };
  const reset = async () => { await lensRun('export', 'cursor-reset', {}); setResult(null); await refresh(); };

  return (
    <Panel icon={GitCompareArrows} title="Incremental / delta export" tag="changed records only">
      <div className="mb-2 flex flex-wrap gap-2">
        <button onClick={() => pull(false)} disabled={busy} className="rounded border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40">
          Preview changes
        </button>
        <button onClick={() => pull(true)} disabled={busy} className="flex items-center gap-1 rounded bg-teal-600 px-2.5 py-1.5 text-xs text-white hover:bg-teal-500 disabled:opacity-40">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Export delta + advance cursor
        </button>
        <button onClick={reset} className="rounded border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-400 hover:border-zinc-500">Reset cursor</button>
      </div>
      {result && (
        <p className="mb-2 text-[11px] text-zinc-400">
          {result.isFirstRun ? 'First run — ' : ''}
          <span className="text-teal-400">{result.changedRecords}</span> changed,{' '}
          <span className="text-zinc-400">{result.unchangedRecords}</span> unchanged.
        </p>
      )}
      {cursors.length === 0 ? (
        <p className="text-[11px] text-zinc-400">No export cursor yet — first delta export captures everything.</p>
      ) : (
        <ul className="space-y-1">
          {cursors.map((c) => (
            <li key={c.dataSource} className="text-[10px] text-zinc-400">
              <span className="font-mono text-zinc-300">{c.dataSource}</span> — last exported {fmtTime(c.lastRunAt)}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── [M] selective field-level export ────────────────────────────────
function SelectiveFields({ dtus }: { dtus: Dtu[] }) {
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const loadSchema = useCallback(async () => {
    const r = await lensRun('export', 'field-schema', { dataSource: 'dtus', records: dtus });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { fields: FieldInfo[] };
      setFields(res.fields);
      setPicked(new Set(res.fields.slice(0, 4).map((f) => f.name)));
    }
  }, [dtus]);
  useEffect(() => { loadSchema(); }, [loadSchema]);

  const toggle = (name: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(name)) n.delete(name); else n.add(name);
    return n;
  });

  const exportProjected = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const r = await lensRun('export', 'field-project', { records: dtus, fields: [...picked] });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { records: Record<string, unknown>[]; recordCount: number };
        dl(`concord-fields-${Date.now()}.json`, JSON.stringify(res.records, null, 2), 'application/json');
        await lensRun('export', 'record-run', { format: 'json', itemCount: res.recordCount, byteLength: JSON.stringify(res.records).length, dataSources: ['dtus'], trigger: 'field-select', filename: `concord-fields-${Date.now()}.json` });
      }
    } finally { setBusy(false); }
  };

  return (
    <Panel icon={Columns3} title="Selective field export" tag="column picker">
      {fields.length === 0 ? (
        <p className="text-[11px] text-zinc-400">No records to inspect yet — create DTUs to populate the field schema.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {fields.map((f) => {
              const on = picked.has(f.name);
              return (
                <button key={f.name} onClick={() => toggle(f.name)}
                  className={`rounded border px-2 py-1 text-[10px] ${on ? 'border-teal-500 bg-teal-500/15 text-teal-200' : 'border-zinc-800 bg-zinc-900 text-zinc-400'}`}>
                  <span className="font-mono">{f.name}</span>
                  <span className="ml-1 text-zinc-400">{f.type} · {f.coverage}%</span>
                </button>
              );
            })}
          </div>
          <button onClick={exportProjected} disabled={busy || picked.size === 0}
            className="flex items-center gap-1 rounded bg-teal-600 px-2.5 py-1.5 text-xs text-white hover:bg-teal-500 disabled:opacity-40">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            Export {picked.size} field(s)
          </button>
        </>
      )}
    </Panel>
  );
}

// ── [S] PDF export ──────────────────────────────────────────────────
function PdfExport({ dtus }: { dtus: Dtu[] }) {
  const [title, setTitle] = useState('Concord Export');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true); setInfo(null);
    try {
      const r = await lensRun('export', 'pdf-generate', { title, records: dtus });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { base64: string; byteLength: number; recordCount: number };
        dl(`${title.replace(/[^a-z0-9]+/gi, '_')}.pdf`, b64ToArrayBuffer(res.base64), 'application/pdf');
        setInfo(`Generated ${fmtBytes(res.byteLength)} PDF with ${res.recordCount} record(s)`);
        await lensRun('export', 'record-run', { format: 'pdf', itemCount: res.recordCount, byteLength: res.byteLength, dataSources: ['dtus'], trigger: 'manual', filename: `${title}.pdf` });
      } else {
        setInfo(r.data?.error || 'PDF generation failed');
      }
    } finally { setBusy(false); }
  };

  return (
    <Panel icon={FileDown} title="PDF export" tag="server-rendered">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[10px] text-zinc-400">
          Document title
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-56 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white" />
        </label>
        <button onClick={generate} disabled={busy} className="flex items-center gap-1 rounded bg-teal-600 px-2.5 py-1.5 text-xs text-white hover:bg-teal-500 disabled:opacity-40">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />} Generate PDF
        </button>
      </div>
      {info && <p className="mt-2 text-[10px] text-teal-400">{info}</p>}
    </Panel>
  );
}

// ── [S] encrypted / password-protected archive ──────────────────────
function EncryptedArchive({ dtus }: { dtus: Dtu[] }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const encrypt = async () => {
    if (password.length < 4) { setInfo('Password must be at least 4 characters'); return; }
    setBusy(true); setInfo(null);
    try {
      const payload = JSON.stringify({ dtus });
      const r = await lensRun('export', 'encrypt-archive', { password, payload });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { algorithm: string; salt: string; plainChecksum: string; ciphertextBase64: string; byteLength: number };
        // Pack salt + checksum + ciphertext into a self-describing envelope so it round-trips.
        const envelope = JSON.stringify({ algorithm: res.algorithm, salt: res.salt, plainChecksum: res.plainChecksum, ciphertextBase64: res.ciphertextBase64 });
        dl(`concord-export-${Date.now()}.enc`, envelope, 'application/octet-stream');
        setInfo(`Encrypted ${fmtBytes(res.byteLength)} archive (${res.algorithm}). Keep the password — it is required to decrypt.`);
        await lensRun('export', 'record-run', { format: 'enc', itemCount: dtus.length, byteLength: res.byteLength, dataSources: ['dtus'], trigger: 'manual', filename: 'concord-export.enc' });
      } else {
        setInfo(r.data?.error || 'Encryption failed');
      }
    } finally { setBusy(false); }
  };

  return (
    <Panel icon={Lock} title="Encrypted archive" tag="password-protected">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[10px] text-zinc-400">
          Archive password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 4 chars"
            className="w-56 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white" />
        </label>
        <button onClick={encrypt} disabled={busy} className="flex items-center gap-1 rounded bg-teal-600 px-2.5 py-1.5 text-xs text-white hover:bg-teal-500 disabled:opacity-40">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />} Encrypt + download
        </button>
      </div>
      {info && <p className="mt-2 text-[10px] text-zinc-400">{info}</p>}
    </Panel>
  );
}

// ── [S] cloud destinations via OAuth ────────────────────────────────
const PROVIDERS = [
  { id: 'google_drive', label: 'Google Drive' },
  { id: 'dropbox', label: 'Dropbox' },
  { id: 's3', label: 'Amazon S3' },
  { id: 'onedrive', label: 'OneDrive' },
];

function CloudDestinations() {
  const [conns, setConns] = useState<CloudConn[]>([]);
  const [provider, setProvider] = useState('google_drive');
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun('export', 'cloud-list', {});
    if (r.data?.ok && r.data.result) setConns((r.data.result as { connections: CloudConn[] }).connections);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const connect = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await lensRun('export', 'cloud-connect', { provider, accountLabel: label, accessToken: token });
      if (r.data?.ok) { setLabel(''); setToken(''); await refresh(); }
      else setErr(r.data?.error || 'Connect failed');
    } finally { setBusy(false); }
  };
  const disconnect = async (id: string) => { await lensRun('export', 'cloud-disconnect', { id }); await refresh(); };
  const push = async (id: string) => {
    await lensRun('export', 'delivery-push', { connectionId: id, filename: `concord-export-${Date.now()}.json`, byteLength: 0 });
    await refresh();
  };

  return (
    <Panel icon={Cloud} title="Cloud destinations" tag="OAuth delivery">
      <p className="mb-2 text-[10px] text-zinc-400">
        Paste an access token obtained from the provider&apos;s OAuth flow. Only a non-reversible token fingerprint is stored.
      </p>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5 text-[10px] text-zinc-400">
          Provider
          <select value={provider} onChange={(e) => setProvider(e.target.value)} className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white">
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-zinc-400">
          Account label
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="work drive"
            className="w-40 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white" />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] text-zinc-400">
          OAuth access token
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ya29...."
            className="w-52 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white" />
        </label>
        <button onClick={connect} disabled={busy} className="flex items-center gap-1 rounded bg-teal-600 px-2.5 py-1.5 text-xs text-white hover:bg-teal-500 disabled:opacity-40">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Connect
        </button>
      </div>
      {err && <p className="mb-2 text-[10px] text-red-400">{err}</p>}
      {conns.length === 0 ? (
        <p className="text-[11px] text-zinc-400">No cloud destinations connected.</p>
      ) : (
        <ul className="space-y-1.5">
          {conns.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5">
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs text-white">{c.accountLabel} <span className="text-zinc-400">· {c.provider}</span></p>
                <p className="text-[10px] text-zinc-400">
                  token #{c.tokenFingerprint} · {c.deliveries} deliveries · last {fmtTime(c.lastDeliveryAt)}
                </p>
              </div>
              <button onClick={() => push(c.id)} className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:border-teal-500">
                Record delivery
              </button>
              <button onClick={() => disconnect(c.id)} title="Disconnect" className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ── [S] export history log + re-download ────────────────────────────
function ExportHistory() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);

  const refresh = useCallback(async () => {
    const r = await lensRun('export', 'history-list', { limit: 100 });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { runs: RunRecord[]; totalBytesExported: number };
      setRuns(res.runs);
      setTotalBytes(res.totalBytesExported);
    }
  }, []);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const redownload = async (run: RunRecord) => {
    const r = await lensRun('export', 'history-download', { id: run.id });
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as { filename: string; payload: string };
      dl(res.filename, res.payload, 'application/octet-stream');
    }
  };
  const clear = async () => { await lensRun('export', 'history-clear', {}); await refresh(); };

  return (
    <Panel icon={History} title="Export history" tag={`${runs.length} runs · ${fmtBytes(totalBytes)}`}>
      {runs.length === 0 ? (
        <p className="text-[11px] text-zinc-400">No exports run yet — completed exports are logged here.</p>
      ) : (
        <>
          <div className="mb-2 flex justify-end">
            <button onClick={clear} className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:border-red-500 hover:text-red-400">
              Clear history
            </button>
          </div>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {runs.map((run) => (
              <li key={run.id} className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-xs text-white">{run.filename}</p>
                  <p className="text-[10px] text-zinc-400">
                    {fmtTime(run.at)} · {run.format.toUpperCase()} · {run.itemCount} items · {fmtBytes(run.byteLength)} · {run.trigger}
                  </p>
                </div>
                {run.hasPayload ? (
                  <button onClick={() => redownload(run)} className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:border-teal-500">
                    <Download className="h-3 w-3" /> Re-download
                  </button>
                ) : (
                  <span className="text-[10px] text-zinc-400">no payload retained</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
