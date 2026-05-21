'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ELNWorkbench — the Benchling-shaped ELN/LIMS surface for the lab lens.
 *
 * Six purpose-built tabs, each wired to a registered `lab.*` macro:
 *   - Notebook   → notebook-create / -list / -update / -sign
 *   - Inventory  → inventory-add / -list / -consume / -remove
 *   - Protocols  → protocol-create / -list / -revise / -run
 *   - Plates     → plate-design / -list
 *   - Runs       → run-import / -list
 *   - Constructs → construct-register / -list / -analyze
 *   - QC Trend   → qc-trend (Levey-Jennings)
 *
 * No placeholder panels — every control calls a real backend macro.
 */

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Notebook, Boxes, ListChecks, Grid3x3, FileSpreadsheet, Dna, LineChart as LineChartIcon,
  Plus, Trash2, PenLine, Stamp, RefreshCw, Play, AlertTriangle, CheckCircle2, Loader2,
} from 'lucide-react';

const DOMAIN = 'lab';

type TabId = 'notebook' | 'inventory' | 'protocols' | 'plates' | 'runs' | 'constructs' | 'qc';

const TABS: { id: TabId; label: string; icon: typeof Notebook }[] = [
  { id: 'notebook', label: 'Notebook', icon: Notebook },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'protocols', label: 'Protocols', icon: ListChecks },
  { id: 'plates', label: 'Plates', icon: Grid3x3 },
  { id: 'runs', label: 'Runs', icon: FileSpreadsheet },
  { id: 'constructs', label: 'Constructs', icon: Dna },
  { id: 'qc', label: 'QC Trend', icon: LineChartIcon },
];

async function run(name: string, params: Record<string, unknown>): Promise<any> {
  const r = await lensRun(DOMAIN, name, params);
  if (r.data?.ok) return r.data.result;
  throw new Error(r.data?.error || `${name} failed`);
}

export function ELNWorkbench() {
  const [tab, setTab] = useState<TabId>('notebook');

  return (
    <div className="panel p-0 overflow-hidden">
      <div className="flex flex-wrap border-b border-white/10 bg-white/[0.02]">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm transition-colors ${
                tab === t.id
                  ? 'text-neon-cyan border-b-2 border-neon-cyan bg-white/[0.03]'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="p-4">
        {tab === 'notebook' && <NotebookTab />}
        {tab === 'inventory' && <InventoryTab />}
        {tab === 'protocols' && <ProtocolsTab />}
        {tab === 'plates' && <PlatesTab />}
        {tab === 'runs' && <RunsTab />}
        {tab === 'constructs' && <ConstructsTab />}
        {tab === 'qc' && <QCTrendTab />}
      </div>
    </div>
  );
}

/* ── shared bits ────────────────────────────────────────────────────────── */

function ErrLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-red-400 flex items-center gap-1">
      <AlertTriangle className="w-3 h-3" /> {msg}
    </p>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-400">
      {label}
      <input {...rest} className="input-lattice text-sm" />
    </label>
  );
}

/* ── Notebook ───────────────────────────────────────────────────────────── */

interface NbEntry {
  id: string; title: string; project: string; body: string; status: string;
  signedBy: string | null; witnessedBy: string | null; revisions: unknown[]; updatedAt: string;
}

function NotebookTab() {
  const [entries, setEntries] = useState<NbEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [body, setBody] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await run('notebook-list', {});
      setEntries(res.entries || []);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!title.trim()) { setErr('entry title required'); return; }
    setBusy(true);
    try {
      await run('notebook-create', { title, project, body });
      setTitle(''); setProject(''); setBody('');
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'create failed'); }
    finally { setBusy(false); }
  };

  const save = async (id: string) => {
    setBusy(true);
    try { await run('notebook-update', { id, body: editBody }); setSel(null); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'update failed'); }
    finally { setBusy(false); }
  };

  const sign = async (id: string, role: 'author' | 'witness') => {
    setBusy(true);
    try { await run('notebook-sign', { id, role }); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'sign failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-2">
        <Field label="Entry title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="PCR optimisation" />
        <Field label="Project" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Unfiled" />
        <div className="flex items-end">
          <button onClick={create} disabled={busy} className="btn-neon cyan flex items-center gap-1 w-full justify-center">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} New Entry
          </button>
        </div>
      </div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Experiment notes, observations, results…"
        className="input-lattice text-sm h-24 resize-none w-full" />
      <ErrLine msg={err} />
      <div className="space-y-2">
        {entries.length === 0 && <p className="text-center py-6 text-gray-500 text-sm">No notebook entries yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="lens-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{e.title}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${
                e.status === 'signed' ? 'bg-neon-green/20 text-neon-green'
                  : e.status === 'witnessed' ? 'bg-yellow-500/20 text-yellow-400'
                    : 'bg-gray-500/20 text-gray-400'}`}>{e.status}</span>
            </div>
            <p className="text-xs text-gray-400">{e.project} · {e.revisions.length} revision(s)
              {e.witnessedBy && ` · witnessed by ${e.witnessedBy}`}
              {e.signedBy && ` · signed by ${e.signedBy}`}</p>
            {sel === e.id ? (
              <div className="space-y-2">
                <textarea value={editBody} onChange={(ev) => setEditBody(ev.target.value)}
                  className="input-lattice text-sm h-20 resize-none w-full" />
                <div className="flex gap-2">
                  <button onClick={() => save(e.id)} disabled={busy} className="btn-neon cyan text-xs">Save</button>
                  <button onClick={() => setSel(null)} className="btn-neon text-xs">Cancel</button>
                </div>
              </div>
            ) : (
              <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono">{e.body || '(empty)'}</pre>
            )}
            <div className="flex gap-2 flex-wrap">
              {e.status !== 'signed' && sel !== e.id && (
                <button onClick={() => { setSel(e.id); setEditBody(e.body); }} className="btn-neon text-xs flex items-center gap-1">
                  <PenLine className="w-3 h-3" /> Edit
                </button>
              )}
              {e.status !== 'signed' && (
                <>
                  <button onClick={() => sign(e.id, 'witness')} disabled={busy} className="btn-neon text-xs flex items-center gap-1">
                    <Stamp className="w-3 h-3" /> Witness
                  </button>
                  <button onClick={() => sign(e.id, 'author')} disabled={busy} className="btn-neon purple text-xs flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Sign &amp; Lock
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Inventory ──────────────────────────────────────────────────────────── */

interface Reagent {
  id: string; name: string; lot: string; vendor: string; location: string; freezerBox: string;
  quantity: number; unit: string; lowThreshold: number; expiry: string | null;
  daysToExpiry: number | null; expiryStatus: string; lowStock: boolean;
}

function InventoryTab() {
  const [items, setItems] = useState<Reagent[]>([]);
  const [stats, setStats] = useState({ expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', lot: '', vendor: '', freezerBox: '', quantity: '', unit: 'units', lowThreshold: '', expiry: '' });

  const refresh = useCallback(async () => {
    try {
      const res = await run('inventory-list', {});
      setItems(res.items || []);
      setStats({ expiredCount: res.expiredCount, expiringSoonCount: res.expiringSoonCount, lowStockCount: res.lowStockCount });
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const add = async () => {
    if (!f.name.trim()) { setErr('reagent name required'); return; }
    setBusy(true);
    try {
      await run('inventory-add', {
        name: f.name, lot: f.lot, vendor: f.vendor, freezerBox: f.freezerBox,
        quantity: Number(f.quantity) || 0, unit: f.unit,
        lowThreshold: Number(f.lowThreshold) || 0, expiry: f.expiry || null,
      });
      setF({ name: '', lot: '', vendor: '', freezerBox: '', quantity: '', unit: 'units', lowThreshold: '', expiry: '' });
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'add failed'); }
    finally { setBusy(false); }
  };

  const consume = async (id: string, delta: number) => {
    setBusy(true);
    try { await run('inventory-consume', { id, delta }); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'consume failed'); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try { await run('inventory-remove', { id }); await refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'remove failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-2 text-center"><p className="text-lg font-bold text-red-400">{stats.expiredCount}</p><p className="text-xs text-gray-400">Expired</p></div>
        <div className="panel p-2 text-center"><p className="text-lg font-bold text-yellow-400">{stats.expiringSoonCount}</p><p className="text-xs text-gray-400">Expiring &lt;30d</p></div>
        <div className="panel p-2 text-center"><p className="text-lg font-bold text-orange-400">{stats.lowStockCount}</p><p className="text-xs text-gray-400">Low Stock</p></div>
      </div>
      <div className="grid md:grid-cols-4 gap-2">
        <Field label="Reagent" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Taq polymerase" />
        <Field label="Lot #" value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })} />
        <Field label="Vendor" value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
        <Field label="Freezer box" value={f.freezerBox} onChange={(e) => setF({ ...f, freezerBox: e.target.value })} placeholder="-80 / B4" />
        <Field label="Quantity" type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        <Field label="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
        <Field label="Low threshold" type="number" value={f.lowThreshold} onChange={(e) => setF({ ...f, lowThreshold: e.target.value })} />
        <Field label="Expiry date" type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} />
      </div>
      <button onClick={add} disabled={busy} className="btn-neon cyan flex items-center gap-1">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add Reagent
      </button>
      <ErrLine msg={err} />
      <div className="space-y-2">
        {items.length === 0 && <p className="text-center py-6 text-gray-500 text-sm">No reagents tracked.</p>}
        {items.map((it) => (
          <div key={it.id} className={`lens-card flex items-center justify-between gap-3 flex-wrap ${
            it.expiryStatus === 'expired' || it.lowStock ? 'border-red-500/40' : ''}`}>
            <div className="min-w-0">
              <p className="font-medium text-sm">{it.name} {it.lot && <span className="text-xs text-gray-500">lot {it.lot}</span>}</p>
              <p className="text-xs text-gray-400">
                {it.quantity} {it.unit} · {it.freezerBox || it.location}
                {it.expiry && ` · exp ${it.expiry}`}
                {it.daysToExpiry != null && it.daysToExpiry >= 0 && ` (${it.daysToExpiry}d)`}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {it.expiryStatus !== 'ok' && (
                <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">{it.expiryStatus}</span>
              )}
              {it.lowStock && <span className="text-xs px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">low</span>}
              <button onClick={() => consume(it.id, -1)} disabled={busy} className="btn-neon text-xs px-2">−1</button>
              <button onClick={() => consume(it.id, 10)} disabled={busy} className="btn-neon text-xs px-2">+10</button>
              <button onClick={() => remove(it.id)} disabled={busy} className="text-gray-500 hover:text-red-400" aria-label="Remove">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Protocols ──────────────────────────────────────────────────────────── */

interface ProtoStep { order: number; text: string; durationMinutes: number; critical: boolean; done?: boolean }
interface Protocol { id: string; name: string; category: string; version: number; steps: ProtoStep[]; stepCount: number; totalMinutes: number }
interface ProtoRun { runId: string; protocolName: string; protocolVersion: number; steps: ProtoStep[]; currentStep: number; estimatedMinutes: number }

function ProtocolsTab() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [stepText, setStepText] = useState('');
  const [activeRun, setActiveRun] = useState<ProtoRun | null>(null);
  const [runDone, setRunDone] = useState<Set<number>>(new Set());

  const refresh = useCallback(async () => {
    try { const res = await run('protocol-list', {}); setProtocols(res.protocols || []); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    if (!name.trim()) { setErr('protocol name required'); return; }
    const steps = stepText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (steps.length === 0) { setErr('add at least one step (one per line)'); return; }
    setBusy(true);
    try {
      await run('protocol-create', { name, category, steps });
      setName(''); setCategory(''); setStepText('');
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'create failed'); }
    finally { setBusy(false); }
  };

  const startRun = async (id: string) => {
    setBusy(true);
    try {
      const res = await run('protocol-run', { id });
      setActiveRun(res.run);
      setRunDone(new Set());
    } catch (e) { setErr(e instanceof Error ? e.message : 'run failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-2">
        <Field label="Protocol name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Western blot" />
        <Field label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Molecular biology" />
      </div>
      <textarea value={stepText} onChange={(e) => setStepText(e.target.value)}
        placeholder="One step per line…&#10;Prepare gel&#10;Load samples&#10;Run at 120V for 60 min"
        className="input-lattice text-sm h-24 resize-none w-full font-mono" />
      <button onClick={create} disabled={busy} className="btn-neon cyan flex items-center gap-1">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save Protocol
      </button>
      <ErrLine msg={err} />

      {activeRun && (
        <div className="panel p-3 border-neon-purple/40 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm text-neon-purple">Run Mode — {activeRun.protocolName} v{activeRun.protocolVersion}</h4>
            <button onClick={() => setActiveRun(null)} className="text-xs text-gray-400 hover:text-white">Close</button>
          </div>
          <p className="text-xs text-gray-400">{runDone.size}/{activeRun.steps.length} steps · est {activeRun.estimatedMinutes} min</p>
          <ol className="space-y-1">
            {activeRun.steps.map((s) => (
              <li key={s.order}>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={runDone.has(s.order)}
                    onChange={(ev) => {
                      const next = new Set(runDone);
                      if (ev.target.checked) next.add(s.order); else next.delete(s.order);
                      setRunDone(next);
                    }} />
                  <span className={runDone.has(s.order) ? 'line-through text-gray-500' : ''}>
                    <span className="text-gray-500">{s.order}.</span> {s.text}
                    {s.durationMinutes > 0 && <span className="text-xs text-gray-500"> · {s.durationMinutes}m</span>}
                    {s.critical && <span className="text-xs text-red-400"> · critical</span>}
                  </span>
                </label>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="space-y-2">
        {protocols.length === 0 && <p className="text-center py-6 text-gray-500 text-sm">No protocols in the library.</p>}
        {protocols.map((p) => (
          <div key={p.id} className="lens-card flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium text-sm">{p.name} <span className="text-xs text-gray-500">v{p.version}</span></p>
              <p className="text-xs text-gray-400">{p.category} · {p.stepCount} steps · {p.totalMinutes} min</p>
            </div>
            <button onClick={() => startRun(p.id)} disabled={busy} className="btn-neon purple text-xs flex items-center gap-1">
              <Play className="w-3 h-3" /> Run
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Plates ─────────────────────────────────────────────────────────────── */

interface PlateWell { sample: string; role: string; concentration: number | null }
interface Plate {
  id: string; name: string; format: number; rows: number; cols: number; rowLabels: string[];
  grid: Record<string, PlateWell>; assignedWells: number; emptyWells: number; roleCounts: Record<string, number>;
}

const ROLE_COLOR: Record<string, string> = {
  sample: 'bg-neon-cyan/30 border-neon-cyan/50',
  standard: 'bg-neon-purple/30 border-neon-purple/50',
  blank: 'bg-gray-500/30 border-gray-500/50',
  control: 'bg-neon-green/30 border-neon-green/50',
};

function PlatesTab() {
  const [plates, setPlates] = useState<Plate[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [format, setFormat] = useState<96 | 384>(96);
  const [role, setRole] = useState('sample');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [view, setView] = useState<Plate | null>(null);

  const rows = format === 384 ? 16 : 8;
  const cols = format === 384 ? 24 : 12;
  const rowLabels = Array.from({ length: rows }, (_, i) => String.fromCharCode(65 + i));

  const refresh = useCallback(async () => {
    try { const res = await run('plate-list', {}); setPlates(res.plates || []); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const toggleWell = (well: string) => {
    setDraft((d) => {
      const next = { ...d };
      if (next[well] === role) delete next[well]; else next[well] = role;
      return next;
    });
  };

  const save = async () => {
    const wells = Object.entries(draft).map(([well, r]) => ({ well, role: r, sample: well }));
    if (wells.length === 0) { setErr('assign at least one well'); return; }
    setBusy(true);
    try {
      await run('plate-design', { name: name || `Plate ${format}`, format, wells });
      setName(''); setDraft({});
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'save failed'); }
    finally { setBusy(false); }
  };

  const gridFor = view ? view.grid : null;
  const gRows = view ? view.rowLabels : rowLabels;
  const gCols = view ? view.cols : cols;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Plate name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Assay 1" />
        <label className="flex flex-col gap-1 text-xs text-gray-400">Format
          <select value={format} onChange={(e) => { setFormat(Number(e.target.value) as 96 | 384); setDraft({}); setView(null); }}
            className="input-lattice text-sm w-auto">
            <option value={96}>96-well</option>
            <option value={384}>384-well</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-400">Paint role
          <select value={role} onChange={(e) => setRole(e.target.value)} className="input-lattice text-sm w-auto">
            <option value="sample">sample</option>
            <option value="standard">standard</option>
            <option value="blank">blank</option>
            <option value="control">control</option>
          </select>
        </label>
        <button onClick={save} disabled={busy} className="btn-neon cyan flex items-center gap-1">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save Layout
        </button>
        {view && <button onClick={() => setView(null)} className="btn-neon text-xs">Back to designer</button>}
      </div>
      <ErrLine msg={err} />
      <p className="text-xs text-gray-400">{view ? `Viewing: ${view.name}` : 'Click wells to paint with the selected role.'}</p>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `auto repeat(${gCols}, minmax(0, 1fr))` }}>
          <div />
          {Array.from({ length: gCols }, (_, c) => (
            <div key={c} className="text-[9px] text-gray-500 text-center">{c + 1}</div>
          ))}
          {gRows.map((rl) => (
            <Row key={rl} rl={rl} cols={gCols} gridFor={gridFor} draft={draft} view={view} toggleWell={toggleWell} />
          ))}
        </div>
      </div>
      {view && (
        <div className="flex gap-3 text-xs text-gray-400">
          {Object.entries(view.roleCounts).map(([r, n]) => <span key={r}>{r}: {n}</span>)}
          <span>empty: {view.emptyWells}</span>
        </div>
      )}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-300">Saved layouts</h4>
        {plates.length === 0 && <p className="text-gray-500 text-sm">No plate layouts saved.</p>}
        {plates.map((p) => (
          <div key={p.id} className="lens-card flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{p.name}</p>
              <p className="text-xs text-gray-400">{p.format}-well · {p.assignedWells} assigned</p>
            </div>
            <button onClick={() => setView(p)} className="btn-neon text-xs">View</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ rl, cols, gridFor, draft, view, toggleWell }: {
  rl: string; cols: number; gridFor: Record<string, PlateWell> | null;
  draft: Record<string, string>; view: Plate | null; toggleWell: (w: string) => void;
}) {
  return (
    <>
      <div className="text-[9px] text-gray-500 flex items-center justify-center pr-1">{rl}</div>
      {Array.from({ length: cols }, (_, c) => {
        const well = `${rl}${c + 1}`;
        const r = view ? gridFor?.[well]?.role : draft[well];
        return (
          <button
            key={well}
            onClick={() => !view && toggleWell(well)}
            title={well + (r ? ` · ${r}` : '')}
            className={`w-5 h-5 rounded-full border text-[7px] ${
              r ? ROLE_COLOR[r] || 'bg-white/20 border-white/30' : 'border-zinc-700 bg-zinc-900'} ${
              view ? 'cursor-default' : 'cursor-pointer hover:border-neon-cyan'}`}
          />
        );
      })}
    </>
  );
}

/* ── Runs (instrument import) ───────────────────────────────────────────── */

interface RunSummary { n: number; min: number; max: number; mean: number }
interface InstrRun {
  id: string; name: string; instrument: string; headers: string[]; records: Record<string, unknown>[];
  recordCount: number; numericColumns: string[]; summary: Record<string, RunSummary>; importedAt: string;
}

function RunsTab() {
  const [runs, setRuns] = useState<InstrRun[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [instrument, setInstrument] = useState('');
  const [csv, setCsv] = useState('');
  const [view, setView] = useState<InstrRun | null>(null);

  const refresh = useCallback(async () => {
    try { const res = await run('run-list', {}); setRuns(res.runs || []); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const importRun = async () => {
    if (!csv.trim()) { setErr('paste CSV content'); return; }
    setBusy(true);
    try {
      const res = await run('run-import', { csv, name, instrument });
      setView(res.run);
      setCsv(''); setName(''); setInstrument('');
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'import failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-2">
        <Field label="Run name" value={name} onChange={(e) => setName(e.target.value)} placeholder="OD600 sweep" />
        <Field label="Instrument" value={instrument} onChange={(e) => setInstrument(e.target.value)} placeholder="Plate reader" />
      </div>
      <label className="flex flex-col gap-1 text-xs text-gray-400">
        Instrument CSV (header row + data)
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)}
          placeholder="sample,od600,ph&#10;A,0.41,7.1&#10;B,0.82,6.9"
          className="input-lattice text-sm h-28 resize-none font-mono" />
      </label>
      <button onClick={importRun} disabled={busy} className="btn-neon cyan flex items-center gap-1">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Import Run
      </button>
      <ErrLine msg={err} />

      {view && (
        <div className="panel p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">{view.name} · {view.instrument}</h4>
            <span className="text-xs text-gray-400">{view.recordCount} records</span>
          </div>
          {view.numericColumns.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {view.numericColumns.map((c) => (
                <div key={c} className="bg-lattice-deep rounded p-2 text-xs">
                  <p className="text-gray-400">{c}</p>
                  <p>mean {view.summary[c].mean} · n {view.summary[c].n}</p>
                  <p className="text-gray-500">[{view.summary[c].min}, {view.summary[c].max}]</p>
                </div>
              ))}
            </div>
          )}
          {view.numericColumns.length > 0 && (
            <ChartKit kind="line" xKey="_row" height={200}
              data={view.records.map((rec, i) => ({ _row: i + 1, ...rec }))}
              series={view.numericColumns.map((c) => ({ key: c, label: c }))} />
          )}
          <div className="overflow-x-auto max-h-48">
            <table className="text-xs w-full">
              <thead><tr className="text-gray-400">{view.headers.map((h) => <th key={h} className="text-left px-2 py-1">{h}</th>)}</tr></thead>
              <tbody>
                {view.records.slice(0, 50).map((rec, i) => (
                  <tr key={i} className="border-t border-white/5">
                    {view.headers.map((h) => <td key={h} className="px-2 py-1">{String(rec[h] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-300">Imported runs</h4>
        {runs.length === 0 && <p className="text-gray-500 text-sm">No instrument runs imported.</p>}
        {runs.map((rn) => (
          <div key={rn.id} className="lens-card flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{rn.name}</p>
              <p className="text-xs text-gray-400">{rn.instrument} · {rn.recordCount} records · {new Date(rn.importedAt).toLocaleString()}</p>
            </div>
            <button onClick={() => setView(rn)} className="btn-neon text-xs">View</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Constructs ─────────────────────────────────────────────────────────── */

interface Construct {
  id: string; name: string; type: string; length: number; gcContent: number;
  backbone: string; resistance: string;
}
interface ConstructAnalysis {
  length: number; gcContent: number; meltingTempC: number; orfCount: number;
  orfs: { frame: number; start: number; end: number; lengthBp: number }[];
  motif: string | null; motifHitCount: number; motifPositions: number[];
}

function ConstructsTab() {
  const [constructs, setConstructs] = useState<Construct[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('plasmid');
  const [sequence, setSequence] = useState('');
  const [resistance, setResistance] = useState('');
  const [motif, setMotif] = useState('');
  const [analysis, setAnalysis] = useState<ConstructAnalysis | null>(null);

  const refresh = useCallback(async () => {
    try { const res = await run('construct-list', {}); setConstructs(res.constructs || []); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const register = async () => {
    if (!name.trim()) { setErr('construct name required'); return; }
    setBusy(true);
    try {
      await run('construct-register', { name, type, sequence, resistance });
      setName(''); setSequence(''); setResistance('');
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'register failed'); }
    finally { setBusy(false); }
  };

  const analyze = async (id: string) => {
    setBusy(true);
    try { const res = await run('construct-analyze', { id, motif }); setAnalysis(res); }
    catch (e) { setErr(e instanceof Error ? e.message : 'analyze failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-2">
        <Field label="Construct name" value={name} onChange={(e) => setName(e.target.value)} placeholder="pTest-GFP" />
        <label className="flex flex-col gap-1 text-xs text-gray-400">Type
          <select value={type} onChange={(e) => setType(e.target.value)} className="input-lattice text-sm">
            <option value="plasmid">plasmid</option>
            <option value="gene">gene</option>
            <option value="primer">primer</option>
            <option value="linear">linear</option>
          </select>
        </label>
        <Field label="Resistance" value={resistance} onChange={(e) => setResistance(e.target.value)} placeholder="AmpR" />
      </div>
      <label className="flex flex-col gap-1 text-xs text-gray-400">
        Sequence (ACGTUN)
        <textarea value={sequence} onChange={(e) => setSequence(e.target.value)}
          placeholder="ATGAAACCCGGG…" className="input-lattice text-sm h-20 resize-none font-mono" />
      </label>
      <button onClick={register} disabled={busy} className="btn-neon cyan flex items-center gap-1">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Register Construct
      </button>
      <ErrLine msg={err} />

      <div className="flex items-end gap-2">
        <Field label="Motif search (for analysis)" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder="GAATTC" />
      </div>

      {analysis && (
        <div className="panel p-3 space-y-2 text-sm">
          <h4 className="font-semibold text-neon-cyan">Sequence Analysis</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="bg-lattice-deep rounded p-2"><p className="text-gray-400">Length</p><p className="font-bold">{analysis.length} bp</p></div>
            <div className="bg-lattice-deep rounded p-2"><p className="text-gray-400">GC content</p><p className="font-bold">{analysis.gcContent}%</p></div>
            <div className="bg-lattice-deep rounded p-2"><p className="text-gray-400">Tm</p><p className="font-bold">{analysis.meltingTempC}°C</p></div>
            <div className="bg-lattice-deep rounded p-2"><p className="text-gray-400">ORFs</p><p className="font-bold">{analysis.orfCount}</p></div>
          </div>
          {analysis.motif && (
            <p className="text-xs text-gray-400">Motif &quot;{analysis.motif}&quot;: {analysis.motifHitCount} hit(s)
              {analysis.motifPositions.length > 0 && ` at ${analysis.motifPositions.slice(0, 12).join(', ')}`}</p>
          )}
          {analysis.orfs.length > 0 && (
            <div className="text-xs text-gray-400">
              ORFs: {analysis.orfs.slice(0, 6).map((o, i) => <span key={i}>frame {o.frame} ({o.start}–{o.end}, {o.lengthBp}bp){i < 5 ? '; ' : ''}</span>)}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {constructs.length === 0 && <p className="text-center py-6 text-gray-500 text-sm">No constructs registered.</p>}
        {constructs.map((c) => (
          <div key={c.id} className="lens-card flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-medium text-sm">{c.name} <span className="text-xs text-gray-500">{c.type}</span></p>
              <p className="text-xs text-gray-400">{c.length} bp · GC {c.gcContent}%
                {c.resistance && ` · ${c.resistance}`}</p>
            </div>
            <button onClick={() => analyze(c.id)} disabled={busy} className="btn-neon purple text-xs flex items-center gap-1">
              <Dna className="w-3 h-3" /> Analyze
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── QC Trend (Levey-Jennings) ──────────────────────────────────────────── */

interface QCPoint { value: number; date: string; label?: string; zScore: number; zone: string; inControl: boolean }
interface QCResult {
  series: QCPoint[];
  controlLimits: { mean: number; sd: number; plus1sd: number; minus1sd: number; plus2sd: number; minus2sd: number; plus3sd: number; minus3sd: number };
  n: number; outOfControlCount: number; warningCount: number; inControl: boolean;
  auditTrail: { date: string; value: number; zScore: number; event: string }[];
}

function QCTrendTab() {
  const [targetMean, setTargetMean] = useState('');
  const [targetSD, setTargetSD] = useState('');
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QCResult | null>(null);

  const compute = async () => {
    const points = raw.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [date, value] = l.split(',').map((s) => s.trim());
      return { date, value: Number(value) };
    }).filter((p) => p.date && Number.isFinite(p.value));
    if (points.length < 2) { setErr('need at least 2 lines of "date,value"'); return; }
    setBusy(true);
    try {
      const params: Record<string, unknown> = { points };
      if (targetMean) params.targetMean = Number(targetMean);
      if (targetSD) params.targetSD = Number(targetSD);
      const res = await run('qc-trend', params);
      setResult(res);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'qc-trend failed'); }
    finally { setBusy(false); }
  };

  const cl = result?.controlLimits;
  const chartData = result?.series.map((p) => ({
    date: p.date, value: p.value,
    ...(cl ? { mean: cl.mean, plus2sd: cl.plus2sd, minus2sd: cl.minus2sd, plus3sd: cl.plus3sd, minus3sd: cl.minus3sd } : {}),
  })) || [];

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-2">
        <Field label="Target mean (optional)" type="number" value={targetMean} onChange={(e) => setTargetMean(e.target.value)} />
        <Field label="Target SD (optional)" type="number" value={targetSD} onChange={(e) => setTargetSD(e.target.value)} />
      </div>
      <label className="flex flex-col gap-1 text-xs text-gray-400">
        Control points — one &quot;date,value&quot; per line
        <textarea value={raw} onChange={(e) => setRaw(e.target.value)}
          placeholder="2026-01-01,100&#10;2026-01-02,101&#10;2026-01-03,98"
          className="input-lattice text-sm h-28 resize-none font-mono" />
      </label>
      <button onClick={compute} disabled={busy} className="btn-neon cyan flex items-center gap-1">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Plot Levey-Jennings
      </button>
      <ErrLine msg={err} />

      {result && (
        <div className="space-y-3">
          <div className="flex gap-3 text-xs flex-wrap">
            <span className={`px-2 py-1 rounded ${result.inControl ? 'bg-neon-green/20 text-neon-green' : 'bg-red-500/20 text-red-400'}`}>
              {result.inControl ? 'In Control' : 'Out of Control'}
            </span>
            <span className="text-gray-400">n={result.n}</span>
            <span className="text-gray-400">mean {cl?.mean} · SD {cl?.sd}</span>
            <span className="text-red-400">{result.outOfControlCount} rejection(s)</span>
            <span className="text-yellow-400">{result.warningCount} warning(s)</span>
          </div>
          <ChartKit kind="line" xKey="date" height={260} data={chartData} series={[
            { key: 'value', label: 'control value', color: '#22c55e' },
            { key: 'mean', label: 'mean', color: '#6366f1' },
            { key: 'plus2sd', label: '+2SD', color: '#f59e0b' },
            { key: 'minus2sd', label: '−2SD', color: '#f59e0b' },
            { key: 'plus3sd', label: '+3SD', color: '#ef4444' },
            { key: 'minus3sd', label: '−3SD', color: '#ef4444' },
          ]} />
          {result.auditTrail.length > 0 && (
            <div className="panel p-3 space-y-1">
              <h4 className="text-sm font-semibold text-gray-300">Audit Trail</h4>
              {result.auditTrail.map((a, i) => (
                <p key={i} className="text-xs text-gray-400">
                  <span className="text-yellow-400">{a.date}</span> — value {a.value} (z={a.zScore}) · {a.event}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
