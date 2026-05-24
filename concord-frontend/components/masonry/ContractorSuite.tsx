'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ContractorSuite — production contractor workflow surface for the masonry lens.
 * Wires the 8 backlog macros in server/domains/masonry.js to real, purpose-built UI:
 *
 *  1. Visual takeoff      — takeoff-save / takeoff-list / takeoff-delete
 *  2. Proposals           — proposal-create / proposal-list / proposal-update-status / proposal-render
 *  3. Job scheduling      — schedule-add / schedule-list / schedule-delete
 *  4. Photo documentation — photo-add / photo-list / photo-delete
 *  5. Change orders       — change-order-create / change-order-list / change-order-sign
 *  6. Material price book — pricebook-list / pricebook-save / pricebook-delete
 *  7. Invoicing           — invoice-create / invoice-list / invoice-record-payment / invoice-delete
 *  8. Code library        — code-search / code-for-check
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Ruler, FileText, CalendarDays, Camera, ClipboardEdit, BookOpen,
  Receipt, Library, Plus, Trash2, Loader2, X, CheckCircle2,
  CloudRain, DollarSign, Copy,
} from 'lucide-react';
import Image from 'next/image';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { TimelineView, type TimelineEvent } from '@/components/viz';

type SuiteTab =
  | 'takeoff' | 'proposals' | 'schedule' | 'photos'
  | 'changeOrders' | 'pricebook' | 'invoices' | 'codes';

const TABS: { id: SuiteTab; label: string; icon: typeof Ruler }[] = [
  { id: 'takeoff', label: 'Takeoff', icon: Ruler },
  { id: 'proposals', label: 'Proposals', icon: FileText },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'photos', label: 'Photos', icon: Camera },
  { id: 'changeOrders', label: 'Change Orders', icon: ClipboardEdit },
  { id: 'pricebook', label: 'Price Book', icon: BookOpen },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'codes', label: 'Code Library', icon: Library },
];

async function run<T = any>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('masonry', action, input);
  if (!r.data?.ok) return null;
  return r.data.result;
}

const card = 'rounded-xl border border-zinc-800 bg-zinc-950/60 p-4';
const inp = 'w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white';
const lbl = 'block text-[10px] uppercase tracking-wider text-zinc-500 mb-1';
const btnP = 'inline-flex items-center gap-1 rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-50';
const btnS = 'inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 hover:border-amber-500/40';
const money = (n: number | undefined) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ───────────────────────── 1. Visual takeoff ─────────────────────────
interface Segment { id: string; label: string; lengthFeet: number; heightFeet: number; }
interface Opening { id: string; label: string; widthFeet: number; heightFeet: number; }
interface Takeoff {
  id: string; name: string; material: string; materialLabel: string;
  segments: Array<Segment & { areaSqFt: number }>;
  openings: Array<Opening & { areaSqFt: number }>;
  grossAreaSqFt: number; openingAreaSqFt: number; netAreaSqFt: number;
  linearFeet: number; wastePct: number; unitsNeeded: number;
  mortarBags80lb: number; materialCost: number; mortarCost: number; totalMaterialCost: number;
}
let segSeq = 0;
const newSeg = (): Segment => ({ id: `s${++segSeq}`, label: 'Wall', lengthFeet: 0, heightFeet: 0 });
const newOpen = (): Opening => ({ id: `o${++segSeq}`, label: 'Window', widthFeet: 0, heightFeet: 0 });

function TakeoffTab() {
  const [name, setName] = useState('');
  const [material, setMaterial] = useState('brick');
  const [waste, setWaste] = useState(5);
  const [segments, setSegments] = useState<Segment[]>([newSeg()]);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [saved, setSaved] = useState<Takeoff[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Takeoff | null>(null);

  const load = useCallback(async () => {
    const r = await run<{ takeoffs: Takeoff[] }>('takeoff-list');
    if (r) setSaved(r.takeoffs || []);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    const r = await run<Takeoff>('takeoff-save', { name, material, wastePct: waste, segments, openings });
    setBusy(false);
    if (r) { setPreview(r); await load(); }
  };
  const del = async (id: string) => { await run('takeoff-delete', { id }); await load(); };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <div className={card}>
        <h4 className="mb-3 text-sm font-semibold text-white">Draw the wall</h4>
        <label className={lbl}>Takeoff name</label>
        <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Garden retaining wall" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Material</label>
            <select className={inp} value={material} onChange={(e) => setMaterial(e.target.value)}>
              <option value="brick">Brick</option>
              <option value="block">Concrete block</option>
              <option value="stone">Stone veneer</option>
            </select>
          </div>
          <div>
            <label className={lbl}>Waste %</label>
            <input type="number" className={inp} value={waste} onChange={(e) => setWaste(Number(e.target.value) || 0)} />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Wall segments</span>
          <button className={btnS} onClick={() => setSegments((s) => [...s, newSeg()])}><Plus className="h-3 w-3" />Segment</button>
        </div>
        {segments.map((sg, i) => (
          <div key={sg.id} className="mt-2 grid grid-cols-[1fr_60px_60px_28px] gap-1.5">
            <input className={inp} value={sg.label} onChange={(e) => setSegments((s) => s.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
            <input type="number" className={inp} placeholder="L ft" value={sg.lengthFeet || ''} onChange={(e) => setSegments((s) => s.map((x, idx) => idx === i ? { ...x, lengthFeet: Number(e.target.value) || 0 } : x))} />
            <input type="number" className={inp} placeholder="H ft" value={sg.heightFeet || ''} onChange={(e) => setSegments((s) => s.map((x, idx) => idx === i ? { ...x, heightFeet: Number(e.target.value) || 0 } : x))} />
            <button className="rounded border border-zinc-800 text-zinc-500 hover:text-rose-300" onClick={() => setSegments((s) => s.filter((_, idx) => idx !== i))} aria-label="Remove segment"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Openings (deduct)</span>
          <button className={btnS} onClick={() => setOpenings((s) => [...s, newOpen()])}><Plus className="h-3 w-3" />Opening</button>
        </div>
        {openings.map((op, i) => (
          <div key={op.id} className="mt-2 grid grid-cols-[1fr_60px_60px_28px] gap-1.5">
            <input className={inp} value={op.label} onChange={(e) => setOpenings((s) => s.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
            <input type="number" className={inp} placeholder="W ft" value={op.widthFeet || ''} onChange={(e) => setOpenings((s) => s.map((x, idx) => idx === i ? { ...x, widthFeet: Number(e.target.value) || 0 } : x))} />
            <input type="number" className={inp} placeholder="H ft" value={op.heightFeet || ''} onChange={(e) => setOpenings((s) => s.map((x, idx) => idx === i ? { ...x, heightFeet: Number(e.target.value) || 0 } : x))} />
            <button className="rounded border border-zinc-800 text-zinc-500 hover:text-rose-300" onClick={() => setOpenings((s) => s.filter((_, idx) => idx !== i))} aria-label="Remove opening"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <button className={`${btnP} mt-4`} onClick={save} disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ruler className="h-3.5 w-3.5" />}Compute & save takeoff
        </button>
      </div>

      <div className="space-y-3">
        {preview && (
          <div className={card}>
            <h4 className="mb-2 text-sm font-semibold text-white">{preview.name}</h4>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Net area" value={`${preview.netAreaSqFt} sf`} />
              <Stat label="Units" value={preview.unitsNeeded.toLocaleString()} />
              <Stat label="Mortar" value={`${preview.mortarBags80lb} bags`} />
              <Stat label="Linear ft" value={String(preview.linearFeet)} />
              <Stat label="Gross/open" value={`${preview.grossAreaSqFt}/${preview.openingAreaSqFt}`} />
              <Stat label="Material $" value={money(preview.totalMaterialCost)} />
            </div>
            <ChartKit
              kind="bar"
              xKey="label"
              height={160}
              series={[{ key: 'areaSqFt', label: 'Area (sf)', color: '#f59e0b' }]}
              data={preview.segments.map((s) => ({ label: s.label, areaSqFt: s.areaSqFt }))}
            />
          </div>
        )}
        <div className={card}>
          <h4 className="mb-2 text-sm font-semibold text-white">Saved takeoffs ({saved.length})</h4>
          {saved.length === 0 && <p className="text-xs text-zinc-600">No takeoffs yet.</p>}
          {saved.map((t) => (
            <div key={t.id} className="mt-2 flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
              <button className="text-left" onClick={() => setPreview(t)}>
                <p className="text-xs font-medium text-white">{t.name}</p>
                <p className="text-[10px] text-zinc-500">{t.materialLabel} · {t.netAreaSqFt} sf · {t.unitsNeeded} units · {money(t.totalMaterialCost)}</p>
              </button>
              <button onClick={() => del(t.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Delete takeoff"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
      <div className="text-[9px] uppercase tracking-wider text-amber-300">{label}</div>
      <div className="font-mono text-sm text-amber-100">{value}</div>
    </div>
  );
}

// ───────────────────────── 2. Proposals ─────────────────────────
interface PLine { id: string; description: string; unit: string; quantity: number; unitCost: number; lineTotal: number; }
interface Proposal {
  id: string; number: string; client: string; projectTitle: string; scopeOfWork: string;
  terms: string; status: string; lines: PLine[]; subtotal: number; marginPct: number;
  margin: number; taxPct: number; tax: number; total: number; createdAt: string;
}
let liSeq = 0;
const newLine = () => ({ id: `l${++liSeq}`, description: '', unit: 'each', quantity: 1, unitCost: 0 });

function ProposalsTab() {
  const [client, setClient] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [margin, setMargin] = useState(15);
  const [tax, setTax] = useState(0);
  const [lines, setLines] = useState(() => [newLine()]);
  const [list, setList] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [rendered, setRendered] = useState<{ number: string; document: string } | null>(null);

  const load = useCallback(async () => {
    const r = await run<{ proposals: Proposal[] }>('proposal-list');
    if (r) setList(r.proposals || []);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    const r = await run<Proposal>('proposal-create', {
      client, projectTitle: title, scopeOfWork: scope, marginPct: margin, taxPct: tax,
      lineItems: lines.filter((l) => l.description.trim()),
    });
    setBusy(false);
    if (r) { setClient(''); setTitle(''); setScope(''); setLines([newLine()]); await load(); }
  };
  const setStatus = async (id: string, status: string) => { await run('proposal-update-status', { id, status }); await load(); };
  const render = async (id: string) => {
    const r = await run<{ number: string; document: string }>('proposal-render', { id });
    if (r) setRendered(r);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <div className={card}>
        <h4 className="mb-3 text-sm font-semibold text-white">New proposal</h4>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Client</label><input className={inp} value={client} onChange={(e) => setClient(e.target.value)} /></div>
          <div><label className={lbl}>Project</label><input className={inp} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        </div>
        <label className={`${lbl} mt-3`}>Scope of work</label>
        <textarea className={inp} rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Line items</span>
          <button className={btnS} onClick={() => setLines((l) => [...l, newLine()])}><Plus className="h-3 w-3" />Line</button>
        </div>
        {lines.map((l, i) => (
          <div key={l.id} className="mt-2 grid grid-cols-[1fr_56px_50px_70px_28px] gap-1.5">
            <input className={inp} placeholder="Description" value={l.description} onChange={(e) => setLines((s) => s.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
            <input className={inp} placeholder="unit" value={l.unit} onChange={(e) => setLines((s) => s.map((x, idx) => idx === i ? { ...x, unit: e.target.value } : x))} />
            <input type="number" className={inp} placeholder="qty" value={l.quantity || ''} onChange={(e) => setLines((s) => s.map((x, idx) => idx === i ? { ...x, quantity: Number(e.target.value) || 0 } : x))} />
            <input type="number" className={inp} placeholder="$/unit" value={l.unitCost || ''} onChange={(e) => setLines((s) => s.map((x, idx) => idx === i ? { ...x, unitCost: Number(e.target.value) || 0 } : x))} />
            <button className="rounded border border-zinc-800 text-zinc-500 hover:text-rose-300" onClick={() => setLines((s) => s.filter((_, idx) => idx !== i))} aria-label="Remove line"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><label className={lbl}>Overhead/profit %</label><input type="number" className={inp} value={margin} onChange={(e) => setMargin(Number(e.target.value) || 0)} /></div>
          <div><label className={lbl}>Tax %</label><input type="number" className={inp} value={tax} onChange={(e) => setTax(Number(e.target.value) || 0)} /></div>
        </div>
        <button className={`${btnP} mt-4`} onClick={create} disabled={busy || !client.trim()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}Create proposal
        </button>
      </div>

      <div className={card}>
        <h4 className="mb-2 text-sm font-semibold text-white">Proposals ({list.length})</h4>
        {list.length === 0 && <p className="text-xs text-zinc-600">No proposals yet.</p>}
        {list.map((p) => (
          <div key={p.id} className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-white">{p.number} · {p.projectTitle}</p>
                <p className="text-[10px] text-zinc-500">{p.client} · {money(p.total)}</p>
              </div>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] uppercase text-amber-300">{p.status}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(['sent', 'accepted', 'declined'] as const).map((st) => (
                <button key={st} className={btnS} onClick={() => setStatus(p.id, st)}>{st}</button>
              ))}
              <button className={btnS} onClick={() => render(p.id)}><Copy className="h-3 w-3" />Render PDF text</button>
            </div>
          </div>
        ))}
      </div>

      {rendered && (
        <Modal title={`Proposal ${rendered.number}`} onClose={() => setRendered(null)}>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] text-zinc-200">{rendered.document}</pre>
          <button className={`${btnS} mt-3`} onClick={() => navigator.clipboard?.writeText(rendered.document)}><Copy className="h-3 w-3" />Copy to clipboard</button>
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────── 3. Schedule ─────────────────────────
interface SchedJob {
  id: string; title: string; startDate: string; durationDays: number; crew: string[];
  status: string; forecastLowF: number; precipChancePct: number;
  weather: { risk: string; advisories: string[] };
}

function ScheduleTab() {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [days, setDays] = useState(1);
  const [crew, setCrew] = useState('');
  const [lowF, setLowF] = useState(55);
  const [precip, setPrecip] = useState(0);
  const [jobs, setJobs] = useState<SchedJob[]>([]);
  const [crewLoad, setCrewLoad] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await run<{ jobs: SchedJob[]; crewLoad: Record<string, number> }>('schedule-list');
    if (r) { setJobs(r.jobs || []); setCrewLoad(r.crewLoad || {}); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const add = async () => {
    setBusy(true);
    const r = await run('schedule-add', {
      title, startDate: start, durationDays: days, forecastLowF: lowF, precipChancePct: precip,
      crew: crew.split(',').map((c) => c.trim()).filter(Boolean),
    });
    setBusy(false);
    if (r) { setTitle(''); setStart(''); setCrew(''); await load(); }
  };
  const del = async (id: string) => { await run('schedule-delete', { id }); await load(); };

  const timeline: TimelineEvent[] = jobs.map((j) => ({
    id: j.id, label: j.title, time: j.startDate,
    tone: j.weather.risk === 'high' ? 'bad' : j.weather.risk === 'caution' ? 'warn' : 'good',
    detail: `${j.durationDays}d · crew ${j.crew.join(', ') || 'unassigned'}`,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className={card}>
        <h4 className="mb-3 text-sm font-semibold text-white">Schedule a job</h4>
        <label className={lbl}>Job title</label>
        <input className={inp} value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><label className={lbl}>Start date</label><input type="date" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label className={lbl}>Duration (days)</label><input type="number" className={inp} value={days} onChange={(e) => setDays(Number(e.target.value) || 1)} /></div>
        </div>
        <label className={`${lbl} mt-3`}>Crew (comma separated)</label>
        <input className={inp} placeholder="Mike, Dave, Sam" value={crew} onChange={(e) => setCrew(e.target.value)} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><label className={lbl}>Forecast low °F</label><input type="number" className={inp} value={lowF} onChange={(e) => setLowF(Number(e.target.value) || 0)} /></div>
          <div><label className={lbl}>Precip chance %</label><input type="number" className={inp} value={precip} onChange={(e) => setPrecip(Number(e.target.value) || 0)} /></div>
        </div>
        <button className={`${btnP} mt-4`} onClick={add} disabled={busy || !title.trim() || !start}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarDays className="h-3.5 w-3.5" />}Add to calendar
        </button>
        {Object.keys(crewLoad).length > 0 && (
          <div className="mt-4">
            <p className={lbl}>Crew workload (days)</p>
            <ChartKit kind="bar" xKey="name" height={150}
              series={[{ key: 'days', label: 'Days booked', color: '#06b6d4' }]}
              data={Object.entries(crewLoad).map(([name, d]) => ({ name, days: d }))} />
          </div>
        )}
      </div>

      <div className={card}>
        <h4 className="mb-2 text-sm font-semibold text-white">Job calendar ({jobs.length})</h4>
        {jobs.length > 0 && <TimelineView events={timeline} height={110} />}
        {jobs.length === 0 && <p className="text-xs text-zinc-600">No jobs scheduled.</p>}
        {jobs.map((j) => (
          <div key={j.id} className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-white">{j.title}</p>
                <p className="text-[10px] text-zinc-500">{j.startDate} · {j.durationDays}d · {j.crew.join(', ') || 'no crew'}</p>
              </div>
              <button onClick={() => del(j.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Delete job"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            {j.weather.advisories.length > 0 && (
              <div className={`mt-1.5 rounded px-2 py-1 text-[10px] ${j.weather.risk === 'high' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>
                <CloudRain className="mr-1 inline h-3 w-3" />
                {j.weather.advisories.join(' · ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── 4. Photos ─────────────────────────
interface Photo { id: string; jobId: string; url: string; phase: string; caption: string; takenAt: string; }

function PhotosTab() {
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState('');
  const [phase, setPhase] = useState('before');
  const [caption, setCaption] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await run<{ photos: Photo[] }>('photo-list');
    if (r) setPhotos(r.photos || []);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const add = async () => {
    setBusy(true);
    const r = await run('photo-add', { url, jobId, phase, caption });
    setBusy(false);
    if (r) { setUrl(''); setCaption(''); await load(); }
  };
  const del = async (id: string) => { await run('photo-delete', { id }); await load(); };

  const phases: Array<'before' | 'during' | 'after'> = ['before', 'during', 'after'];

  return (
    <div className="space-y-4">
      <div className={card}>
        <h4 className="mb-3 text-sm font-semibold text-white">Add job photo</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className={lbl}>Photo URL</label><input className={inp} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." /></div>
          <div><label className={lbl}>Job ID / name</label><input className={inp} value={jobId} onChange={(e) => setJobId(e.target.value)} /></div>
          <div>
            <label className={lbl}>Phase</label>
            <select className={inp} value={phase} onChange={(e) => setPhase(e.target.value)}>
              <option value="before">Before</option>
              <option value="during">During</option>
              <option value="after">After</option>
            </select>
          </div>
          <div><label className={lbl}>Caption</label><input className={inp} value={caption} onChange={(e) => setCaption(e.target.value)} /></div>
        </div>
        <button className={`${btnP} mt-4`} onClick={add} disabled={busy || !url.trim()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}Add photo
        </button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {phases.map((ph) => {
          const list = photos.filter((p) => p.phase === ph);
          return (
            <div key={ph} className={card}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">{ph} ({list.length})</h4>
              {list.length === 0 && <p className="text-[11px] text-zinc-600">None.</p>}
              {list.map((p) => (
                <div key={p.id} className="mt-2 overflow-hidden rounded border border-zinc-800 bg-zinc-950">
                  <div className="relative h-28 w-full bg-zinc-900">
                    <Image src={p.url} alt={p.caption || 'job photo'} fill className="object-cover" unoptimized
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="truncate text-[10px] text-zinc-400">{p.caption || p.takenAt.slice(0, 10)}</span>
                    <button onClick={() => del(p.id)} className="text-zinc-600 hover:text-rose-400" aria-label="Delete photo"><Trash2 className="h-3 w-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── 5. Change orders ─────────────────────────
interface ChangeOrder {
  id: string; number: string; jobId: string; description: string; laborHours: number;
  laborRate: number; laborCost: number; materialCost: number; amount: number;
  status: string; scheduleImpactDays: number; signedBy: string | null;
}

function ChangeOrdersTab() {
  const [jobId, setJobId] = useState('');
  const [desc, setDesc] = useState('');
  const [hours, setHours] = useState(0);
  const [rate, setRate] = useState(55);
  const [matCost, setMatCost] = useState(0);
  const [impact, setImpact] = useState(0);
  const [list, setList] = useState<ChangeOrder[]>([]);
  const [totals, setTotals] = useState({ approvedTotal: 0, pendingTotal: 0 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await run<{ changeOrders: ChangeOrder[]; approvedTotal: number; pendingTotal: number }>('change-order-list');
    if (r) { setList(r.changeOrders || []); setTotals({ approvedTotal: r.approvedTotal, pendingTotal: r.pendingTotal }); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    const r = await run('change-order-create', {
      jobId, description: desc, laborHours: hours, laborRate: rate, materialCost: matCost, scheduleImpactDays: impact,
    });
    setBusy(false);
    if (r) { setDesc(''); setHours(0); setMatCost(0); setImpact(0); await load(); }
  };
  const sign = async (id: string, status: string) => { await run('change-order-sign', { id, status, signedBy: 'Client' }); await load(); };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <div className={card}>
        <h4 className="mb-3 text-sm font-semibold text-white">New change order</h4>
        <label className={lbl}>Job ID / name</label>
        <input className={inp} value={jobId} onChange={(e) => setJobId(e.target.value)} />
        <label className={`${lbl} mt-3`}>Scope addition</label>
        <textarea className={inp} rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div><label className={lbl}>Labor hours</label><input type="number" className={inp} value={hours} onChange={(e) => setHours(Number(e.target.value) || 0)} /></div>
          <div><label className={lbl}>Labor rate $/h</label><input type="number" className={inp} value={rate} onChange={(e) => setRate(Number(e.target.value) || 0)} /></div>
          <div><label className={lbl}>Material cost $</label><input type="number" className={inp} value={matCost} onChange={(e) => setMatCost(Number(e.target.value) || 0)} /></div>
          <div><label className={lbl}>Schedule impact (days)</label><input type="number" className={inp} value={impact} onChange={(e) => setImpact(Number(e.target.value) || 0)} /></div>
        </div>
        <button className={`${btnP} mt-4`} onClick={create} disabled={busy || !desc.trim()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardEdit className="h-3.5 w-3.5" />}Create change order
        </button>
      </div>

      <div className={card}>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-white">Change orders ({list.length})</h4>
          <span className="text-[10px] text-zinc-500">Approved {money(totals.approvedTotal)} · Pending {money(totals.pendingTotal)}</span>
        </div>
        {list.length === 0 && <p className="text-xs text-zinc-600">No change orders yet.</p>}
        {list.map((co) => (
          <div key={co.id} className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-white">{co.number} · {money(co.amount)}</p>
              <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${co.status === 'approved' ? 'bg-emerald-500/20 text-emerald-300' : co.status === 'rejected' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}`}>{co.status}</span>
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-500">{co.description}</p>
            <p className="text-[10px] text-zinc-600">{co.laborHours}h labor · {money(co.materialCost)} materials · {co.scheduleImpactDays}d impact</p>
            {co.signedBy && <p className="text-[10px] text-emerald-400">Signed off by {co.signedBy}</p>}
            {co.status === 'pending' && (
              <div className="mt-1.5 flex gap-1.5">
                <button className={btnS} onClick={() => sign(co.id, 'approved')}><CheckCircle2 className="h-3 w-3" />Approve & sign</button>
                <button className={btnS} onClick={() => sign(co.id, 'rejected')}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── 6. Price book ─────────────────────────
interface PriceItem { id: string; sku: string; name: string; unit: string; unitCost: number; category: string; }

function PriceBookTab() {
  const [list, setList] = useState<PriceItem[]>([]);
  const [editing, setEditing] = useState<Partial<PriceItem> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await run<{ items: PriceItem[] }>('pricebook-list');
    if (r) setList(r.items || []);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const r = await run('pricebook-save', { ...editing });
    setBusy(false);
    if (r) { setEditing(null); await load(); }
  };
  const del = async (id: string) => { await run('pricebook-delete', { id }); await load(); };

  return (
    <div className={card}>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">Material price book ({list.length})</h4>
        <button className={btnP} onClick={() => setEditing({ unit: 'each', category: 'general', unitCost: 0 })}><Plus className="h-3.5 w-3.5" />Add item</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-zinc-500">
            <tr><th className="py-1">SKU</th><th>Name</th><th>Unit</th><th>Category</th><th className="text-right">Unit cost</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-t border-zinc-800">
                <td className="py-1.5 font-mono text-zinc-400">{p.sku}</td>
                <td className="text-white">{p.name}</td>
                <td className="text-zinc-400">{p.unit}</td>
                <td className="text-zinc-400">{p.category}</td>
                <td className="text-right font-mono text-amber-200">{money(p.unitCost)}</td>
                <td className="text-right">
                  <button onClick={() => setEditing(p)} className="mr-2 text-zinc-500 hover:text-amber-400" aria-label="Edit"><ClipboardEdit className="inline h-3.5 w-3.5" /></button>
                  <button onClick={() => del(p.id)} className="text-zinc-500 hover:text-rose-400" aria-label="Delete"><Trash2 className="inline h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <p className="mt-2 text-xs text-zinc-600">No price-book items.</p>}

      {editing && (
        <Modal title={editing.id ? 'Edit price item' : 'New price item'} onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>SKU</label><input className={inp} value={editing.sku || ''} onChange={(e) => setEditing((s) => ({ ...s, sku: e.target.value }))} /></div>
            <div><label className={lbl}>Name</label><input className={inp} value={editing.name || ''} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} /></div>
            <div><label className={lbl}>Unit</label><input className={inp} value={editing.unit || ''} onChange={(e) => setEditing((s) => ({ ...s, unit: e.target.value }))} /></div>
            <div><label className={lbl}>Category</label><input className={inp} value={editing.category || ''} onChange={(e) => setEditing((s) => ({ ...s, category: e.target.value }))} /></div>
            <div><label className={lbl}>Unit cost $</label><input type="number" className={inp} value={editing.unitCost ?? 0} onChange={(e) => setEditing((s) => ({ ...s, unitCost: Number(e.target.value) || 0 }))} /></div>
          </div>
          <button className={`${btnP} mt-4`} onClick={save} disabled={busy || !(editing.name || '').trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Save
          </button>
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────── 7. Invoices ─────────────────────────
interface Payment { id: string; amount: number; method: string; date: string; }
interface Invoice {
  id: string; number: string; client: string; jobId: string; contractTotal: number;
  progressPct: number; amount: number; dueDate: string; status: string;
  payments: Payment[]; amountPaid: number; balance: number;
}

function InvoicesTab() {
  const [client, setClient] = useState('');
  const [jobId, setJobId] = useState('');
  const [contract, setContract] = useState(0);
  const [progress, setProgress] = useState(100);
  const [due, setDue] = useState('');
  const [list, setList] = useState<Invoice[]>([]);
  const [totals, setTotals] = useState({ totalBilled: 0, totalCollected: 0, outstanding: 0 });
  const [busy, setBusy] = useState(false);
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [payAmt, setPayAmt] = useState(0);
  const [payMethod, setPayMethod] = useState('check');

  const load = useCallback(async () => {
    const r = await run<{ invoices: Invoice[]; totalBilled: number; totalCollected: number; outstanding: number }>('invoice-list');
    if (r) { setList(r.invoices || []); setTotals({ totalBilled: r.totalBilled, totalCollected: r.totalCollected, outstanding: r.outstanding }); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true);
    const r = await run('invoice-create', { client, jobId, contractTotal: contract, progressPct: progress, dueDate: due });
    setBusy(false);
    if (r) { setClient(''); setJobId(''); setContract(0); await load(); }
  };
  const recordPay = async () => {
    if (!payFor) return;
    const r = await run('invoice-record-payment', { id: payFor.id, amount: payAmt, method: payMethod });
    if (r) { setPayFor(null); setPayAmt(0); await load(); }
  };
  const del = async (id: string) => { await run('invoice-delete', { id }); await load(); };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total billed" value={money(totals.totalBilled)} />
        <Stat label="Collected" value={money(totals.totalCollected)} />
        <Stat label="Outstanding" value={money(totals.outstanding)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className={card}>
          <h4 className="mb-3 text-sm font-semibold text-white">New invoice (progress billing)</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Client</label><input className={inp} value={client} onChange={(e) => setClient(e.target.value)} /></div>
            <div><label className={lbl}>Job ID / name</label><input className={inp} value={jobId} onChange={(e) => setJobId(e.target.value)} /></div>
            <div><label className={lbl}>Contract total $</label><input type="number" className={inp} value={contract} onChange={(e) => setContract(Number(e.target.value) || 0)} /></div>
            <div><label className={lbl}>Progress %</label><input type="number" className={inp} value={progress} onChange={(e) => setProgress(Number(e.target.value) || 0)} /></div>
            <div className="col-span-2"><label className={lbl}>Due date</label><input type="date" className={inp} value={due} onChange={(e) => setDue(e.target.value)} /></div>
          </div>
          <p className="mt-2 text-[10px] text-zinc-500">This invoice bills {money((contract * progress) / 100)} ({progress}% of contract).</p>
          <button className={`${btnP} mt-3`} onClick={create} disabled={busy || !client.trim() || contract <= 0}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}Create invoice
          </button>
        </div>

        <div className={card}>
          <h4 className="mb-2 text-sm font-semibold text-white">Invoices ({list.length})</h4>
          {list.length === 0 && <p className="text-xs text-zinc-600">No invoices yet.</p>}
          {list.map((iv) => (
            <div key={iv.id} className="mt-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-white">{iv.number} · {iv.client}</p>
                  <p className="text-[10px] text-zinc-500">{money(iv.amount)} billed · {money(iv.amountPaid)} paid · {money(iv.balance)} due</p>
                </div>
                <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${iv.status === 'paid' ? 'bg-emerald-500/20 text-emerald-300' : iv.status === 'partial' ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-700 text-zinc-300'}`}>{iv.status}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-emerald-500" style={{ width: `${iv.amount > 0 ? Math.min(100, (iv.amountPaid / iv.amount) * 100) : 0}%` }} />
              </div>
              <div className="mt-1.5 flex gap-1.5">
                {iv.balance > 0 && <button className={btnS} onClick={() => { setPayFor(iv); setPayAmt(iv.balance); }}><DollarSign className="h-3 w-3" />Record payment</button>}
                <button className={btnS} onClick={() => del(iv.id)}><Trash2 className="h-3 w-3" />Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {payFor && (
        <Modal title={`Record payment — ${payFor.number}`} onClose={() => setPayFor(null)}>
          <p className="mb-3 text-xs text-zinc-400">Balance due: {money(payFor.balance)}</p>
          <label className={lbl}>Amount $</label>
          <input type="number" className={inp} value={payAmt} onChange={(e) => setPayAmt(Number(e.target.value) || 0)} />
          <label className={`${lbl} mt-3`}>Method</label>
          <select className={inp} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
            <option value="check">Check</option>
            <option value="card">Card</option>
            <option value="cash">Cash</option>
            <option value="ach">ACH transfer</option>
          </select>
          <button className={`${btnP} mt-4`} onClick={recordPay} disabled={payAmt <= 0}>
            <CheckCircle2 className="h-3.5 w-3.5" />Record payment
          </button>
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────── 8. Code library ─────────────────────────
interface CodeRef { code: string; section: string; topic: string; standard: string; summary: string; tags: string[]; }

function CodesTab() {
  const [query, setQuery] = useState('');
  const [standard, setStandard] = useState('');
  const [results, setResults] = useState<CodeRef[]>([]);
  const [standards, setStandards] = useState<string[]>([]);
  const [checkRefs, setCheckRefs] = useState<CodeRef[]>([]);

  const search = useCallback(async () => {
    const r = await run<{ results: CodeRef[]; standards: string[] }>('code-search', { query, standard });
    if (r) { setResults(r.results || []); setStandards(r.standards || []); }
  }, [query, standard]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { search(); }, []);

  const forCheck = async (checkType: string) => {
    const r = await run<{ references: CodeRef[] }>('code-for-check', { checkType });
    if (r) setCheckRefs(r.references || []);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className={card}>
        <h4 className="mb-3 text-sm font-semibold text-white">Masonry code library (IBC / ACI / TMS / ASTM)</h4>
        <div className="flex gap-2">
          <input className={inp} placeholder="Search topic, code, tag..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
          <select className={`${inp} w-32`} value={standard} onChange={(e) => setStandard(e.target.value)}>
            <option value="">All standards</option>
            {standards.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className={btnP} onClick={search}><Library className="h-3.5 w-3.5" />Search</button>
        </div>
        <div className="mt-3 space-y-2">
          {results.length === 0 && <p className="text-xs text-zinc-600">No matching code references.</p>}
          {results.map((c, i) => (
            <div key={`${c.code}-${c.section}-${i}`} className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-amber-300">{c.code} §{c.section}</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{c.standard}</span>
              </div>
              <p className="mt-0.5 text-xs font-medium text-white">{c.topic}</p>
              <p className="text-[11px] text-zinc-400">{c.summary}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={card}>
        <h4 className="mb-3 text-sm font-semibold text-white">Codes tied to a check</h4>
        <div className="flex flex-wrap gap-1.5">
          {['wall-strength', 'mortar', 'reinforcement', 'weather', 'inspection', 'veneer'].map((t) => (
            <button key={t} className={btnS} onClick={() => forCheck(t)}>{t}</button>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {checkRefs.length === 0 && <p className="text-xs text-zinc-600">Pick a check type to surface its governing codes.</p>}
          {checkRefs.map((c, i) => (
            <div key={`chk-${c.code}-${i}`} className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <span className="font-mono text-xs text-amber-300">{c.code} §{c.section}</span>
              <p className="text-[11px] text-zinc-300">{c.topic}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Modal helper ─────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-4" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ───────────────────────── Shell ─────────────────────────
export function ContractorSuite() {
  const [tab, setTab] = useState<SuiteTab>('takeoff');
  return (
    <div className="rounded-xl border border-amber-700/30 bg-gradient-to-br from-zinc-950 via-amber-950/10 to-zinc-950 p-4">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-amber-300">Contractor Suite</h3>
      <nav className="mb-4 flex flex-wrap gap-1.5 border-b border-zinc-800 pb-3">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${tab === t.id ? 'bg-amber-500/20 text-amber-200' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white'}`}>
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </button>
        ))}
      </nav>
      {tab === 'takeoff' && <TakeoffTab />}
      {tab === 'proposals' && <ProposalsTab />}
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'photos' && <PhotosTab />}
      {tab === 'changeOrders' && <ChangeOrdersTab />}
      {tab === 'pricebook' && <PriceBookTab />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'codes' && <CodesTab />}
    </div>
  );
}
