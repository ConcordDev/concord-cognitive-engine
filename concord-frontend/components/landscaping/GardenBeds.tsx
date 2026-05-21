'use client';

/**
 * GardenBeds — garden-bed substrate UI for the landscaping lens.
 * Wires the bed CRUD + planting + care-log macros in
 * server/domains/landscaping.js so the design-studio features
 * (care reminders, maintenance calendar) have real data to operate on.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Flower2, Plus, Trash2, Loader2, Sprout, Droplets } from 'lucide-react';

interface Planting {
  id: string;
  plant: string;
  quantity: number;
  plantedDate: string;
  status: string;
}
interface CareEntry {
  id: string;
  kind: string;
  date: string;
  notes: string;
}
interface Bed {
  id: string;
  name: string;
  sizeSqft: number;
  sunExposure: string;
  soilType: string;
  plantings: Planting[];
  careLog: CareEntry[];
  plantingCount?: number;
  careCount?: number;
}
interface Dashboard {
  beds: number;
  totalSqft: number;
  plantings: number;
  careEvents: number;
}

const SUN = ['full', 'partial', 'shade'];
const SOIL = ['loam', 'clay', 'sandy', 'silt', 'chalk', 'peat'];
const PLANT_STATUS = ['planned', 'growing', 'thriving', 'struggling', 'removed'];
const CARE_KINDS = ['water', 'fertilize', 'prune', 'weed', 'mulch', 'pest_treat', 'harvest'];

const inputCls =
  'w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-white outline-none focus:border-emerald-500/40';
const btnCls =
  'inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50';

export function GardenBeds() {
  const [beds, setBeds] = useState<Bed[]>([]);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [size, setSize] = useState('');
  const [sun, setSun] = useState('full');
  const [soil, setSoil] = useState('loam');

  const load = useCallback(async () => {
    setErr(null);
    const [bedRes, dashRes] = await Promise.all([
      lensRun<{ beds: Bed[] }>('landscaping', 'bed-list', {}),
      lensRun<Dashboard>('landscaping', 'landscaping-dashboard', {}),
    ]);
    if (bedRes.data.ok && bedRes.data.result) setBeds(bedRes.data.result.beds);
    else setErr(bedRes.data.error || 'failed to load beds');
    if (dashRes.data.ok && dashRes.data.result) setDash(dashRes.data.result);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addBed = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await lensRun('landscaping', 'bed-add', {
      name: name.trim(),
      sizeSqft: size ? Number(size) : 0,
      sunExposure: sun,
      soilType: soil,
    });
    setBusy(false);
    if (r.data.ok) {
      setName('');
      setSize('');
      await load();
    } else setErr(r.data.error || 'add bed failed');
  };

  const deleteBed = async (id: string) => {
    await lensRun('landscaping', 'bed-delete', { id });
    if (expanded === id) setExpanded(null);
    await load();
  };

  const chartData = beds.map((b) => ({
    bed: b.name.slice(0, 12),
    plantings: b.plantings.length,
    care: b.careLog.length,
  }));

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 border-b border-emerald-500/15 pb-3">
        <Flower2 className="h-5 w-5 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Garden Beds</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          beds · plantings · care log
        </span>
      </header>

      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {dash && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Beds" value={String(dash.beds)} />
          <Stat label="Total sq ft" value={dash.totalSqft.toLocaleString()} />
          <Stat label="Plantings" value={String(dash.plantings)} />
          <Stat label="Care events" value={String(dash.careEvents)} />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500">Bed name</label>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rose bed"
          />
        </div>
        <div className="w-24">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500">Sq ft</label>
          <input
            type="number"
            className={inputCls}
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </div>
        <div className="w-28">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500">Sun</label>
          <select className={inputCls} value={sun} onChange={(e) => setSun(e.target.value)}>
            {SUN.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500">Soil</label>
          <select className={inputCls} value={soil} onChange={(e) => setSoil(e.target.value)}>
            {SOIL.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button onClick={addBed} disabled={!name.trim() || busy} className={btnCls}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add bed
        </button>
      </div>

      {chartData.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-emerald-400">
            Plantings &amp; care per bed
          </p>
          <ChartKit
            kind="bar"
            data={chartData}
            xKey="bed"
            series={[
              { key: 'plantings', label: 'Plantings', color: '#22c55e' },
              { key: 'care', label: 'Care events', color: '#0ea5e9' },
            ]}
            height={200}
          />
        </div>
      )}

      <div className="space-y-2">
        {beds.map((b) => (
          <BedRow
            key={b.id}
            bed={b}
            expanded={expanded === b.id}
            onToggle={() => setExpanded(expanded === b.id ? null : b.id)}
            onDelete={() => deleteBed(b.id)}
            onChanged={load}
          />
        ))}
        {beds.length === 0 && (
          <p className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">
            No garden beds yet. Add one above — beds feed the care-reminders and maintenance-calendar
            features in the Garden Studio.
          </p>
        )}
      </div>
    </div>
  );
}

function BedRow({
  bed,
  expanded,
  onToggle,
  onDelete,
  onChanged,
}: {
  bed: Bed;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onChanged: () => Promise<void>;
}) {
  const [plant, setPlant] = useState('');
  const [qty, setQty] = useState('1');
  const [pStatus, setPStatus] = useState('growing');
  const [careKind, setCareKind] = useState('water');
  const [careDate, setCareDate] = useState('');
  const [careNotes, setCareNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const addPlanting = async () => {
    if (!plant.trim()) return;
    setBusy(true);
    await lensRun('landscaping', 'planting-add', {
      bedId: bed.id,
      plant: plant.trim(),
      quantity: Number(qty) || 1,
      status: pStatus,
    });
    setBusy(false);
    setPlant('');
    setQty('1');
    await onChanged();
  };

  const logCare = async () => {
    setBusy(true);
    await lensRun('landscaping', 'care-log', {
      bedId: bed.id,
      kind: careKind,
      date: careDate || undefined,
      notes: careNotes,
    });
    setBusy(false);
    setCareNotes('');
    await onChanged();
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between px-3 py-2">
        <button onClick={onToggle} className="flex items-center gap-2 text-sm text-white">
          <Flower2 className="h-4 w-4 text-emerald-400" />
          {bed.name}
          <span className="text-[11px] text-zinc-500">
            {bed.sizeSqft} sq ft · {bed.sunExposure} sun · {bed.soilType} ·{' '}
            {bed.plantingCount ?? bed.plantings.length}🌱 · {bed.careCount ?? bed.careLog.length}💧
          </span>
        </button>
        <button onClick={onDelete} aria-label="Delete bed">
          <Trash2 className="h-3.5 w-3.5 text-red-400" />
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-zinc-800 px-3 py-3">
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400">
              <Sprout className="h-3 w-3" /> Plantings
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <input
                className={`${inputCls} w-36`}
                placeholder="Plant"
                value={plant}
                onChange={(e) => setPlant(e.target.value)}
              />
              <input
                type="number"
                className={`${inputCls} w-20`}
                placeholder="Qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              <select
                className={`${inputCls} w-28`}
                value={pStatus}
                onChange={(e) => setPStatus(e.target.value)}
              >
                {PLANT_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button onClick={addPlanting} disabled={!plant.trim() || busy} className={btnCls}>
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {bed.plantings.map((p) => (
                <span
                  key={p.id}
                  className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300"
                >
                  {p.plant} ×{p.quantity}{' '}
                  <span className="text-zinc-600">{p.status}</span>
                </span>
              ))}
              {bed.plantings.length === 0 && (
                <span className="text-[11px] text-zinc-600">No plantings yet</span>
              )}
            </div>
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-sky-400">
              <Droplets className="h-3 w-3" /> Care log
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <select
                className={`${inputCls} w-32`}
                value={careKind}
                onChange={(e) => setCareKind(e.target.value)}
              >
                {CARE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className={`${inputCls} w-40`}
                value={careDate}
                onChange={(e) => setCareDate(e.target.value)}
              />
              <input
                className={`${inputCls} flex-1 min-w-[120px]`}
                placeholder="Notes"
                value={careNotes}
                onChange={(e) => setCareNotes(e.target.value)}
              />
              <button onClick={logCare} disabled={busy} className={btnCls}>
                <Plus className="h-3.5 w-3.5" /> Log
              </button>
            </div>
            <div className="space-y-1">
              {bed.careLog
                .slice()
                .reverse()
                .slice(0, 8)
                .map((c) => (
                  <div key={c.id} className="flex gap-2 text-[11px] text-zinc-400">
                    <span className="text-sky-300 capitalize">{c.kind.replace('_', ' ')}</span>
                    <span className="text-zinc-600">{c.date}</span>
                    {c.notes && <span className="truncate">{c.notes}</span>}
                  </div>
                ))}
              {bed.careLog.length === 0 && (
                <span className="text-[11px] text-zinc-600">No care logged yet</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-emerald-300">{value}</div>
    </div>
  );
}
