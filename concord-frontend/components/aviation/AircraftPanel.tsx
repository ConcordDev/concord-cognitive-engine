'use client';

import { useEffect, useState } from 'react';
import { Plane, Plus, Trash2, Loader2, Fuel, Weight, Pencil, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Aircraft {
  id: string; tail: string; make: string; model: string; year: number | null; kind: string;
  cruiseKts: number; fuelBurnGph: number; fuelCapacityGal: number;
  maxTakeoffWeightLbs: number; emptyWeightLbs: number; hobbsHours: number; tachHours: number;
}

// aviation.aircraft-update only accepts these 5 numeric fields (server/domains/aviation.js) —
// tail/make/model/kind are set at creation and not editable via this macro.
const EDITABLE_FIELDS = ['cruiseKts', 'fuelBurnGph', 'fuelCapacityGal', 'hobbsHours', 'tachHours'] as const;
type EditableField = typeof EDITABLE_FIELDS[number];
type EditForm = Record<EditableField, string>;

const EDIT_FIELD_LABELS: Record<EditableField, string> = {
  cruiseKts: 'Cruise kts', fuelBurnGph: 'Burn gph', fuelCapacityGal: 'Fuel cap gal',
  hobbsHours: 'Hobbs', tachHours: 'Tach',
};

const KINDS = ['single_engine_piston', 'multi_engine_piston', 'turboprop', 'jet', 'helicopter', 'light_sport', 'experimental'];

function editFormFromAircraft(a: Aircraft): EditForm {
  return {
    cruiseKts: String(a.cruiseKts), fuelBurnGph: String(a.fuelBurnGph),
    fuelCapacityGal: String(a.fuelCapacityGal), hobbsHours: String(a.hobbsHours), tachHours: String(a.tachHours),
  };
}

export function AircraftPanel() {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ tail: '', make: '', model: '', year: '', kind: 'single_engine_piston', cruiseKts: '120', fuelBurnGph: '9', fuelCapacityGal: '50', hobbsHours: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'aviation', action: 'aircraft-list', input: {} });
      setAircraft((res.data?.result?.aircraft || []) as Aircraft[]);
    } catch (e) { console.error('[Aircraft] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!form.tail.trim() || !form.make.trim() || !form.model.trim()) return;
    try {
      await lensRun({ domain: 'aviation', action: 'aircraft-add', input: { ...form, year: Number(form.year) || undefined, cruiseKts: Number(form.cruiseKts), fuelBurnGph: Number(form.fuelBurnGph), fuelCapacityGal: Number(form.fuelCapacityGal), hobbsHours: Number(form.hobbsHours) || 0 } });
      setForm({ tail: '', make: '', model: '', year: '', kind: 'single_engine_piston', cruiseKts: '120', fuelBurnGph: '9', fuelCapacityGal: '50', hobbsHours: '' });
      await refresh();
    } catch (e) { console.error('[Aircraft] add', e); }
  }

  async function remove(id: string) {
    try {
      await lensRun({ domain: 'aviation', action: 'aircraft-delete', input: { id } });
      setAircraft(prev => prev.filter(a => a.id !== id));
    } catch (e) { console.error('[Aircraft] delete', e); }
  }

  function startEdit(a: Aircraft) {
    setEditingId(a.id);
    setEditForm(editFormFromAircraft(a));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }

  async function saveEdit(id: string) {
    if (!editForm) return;
    setSaving(true);
    try {
      const input: Record<string, string | number> = { id };
      for (const key of EDITABLE_FIELDS) {
        const n = Number(editForm[key]);
        if (Number.isFinite(n)) input[key] = n;
      }
      const res = await lensRun({ domain: 'aviation', action: 'aircraft-update', input });
      if (res.data?.ok) {
        setEditingId(null);
        setEditForm(null);
        await refresh();
      } else {
        console.error('[Aircraft] update rejected', res.data);
      }
    } catch (e) { console.error('[Aircraft] update', e); }
    finally { setSaving(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Plane className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Aircraft fleet</span>
        <span className="ml-auto text-[10px] text-gray-400">{aircraft.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <input value={form.tail} onChange={e => setForm({ ...form, tail: e.target.value.toUpperCase() })} placeholder="N12345" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={form.make} onChange={e => setForm({ ...form, make: e.target.value })} placeholder="Make" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Model" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} placeholder="Year" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {KINDS.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
        </select>
        <input type="number" value={form.cruiseKts} onChange={e => setForm({ ...form, cruiseKts: e.target.value })} placeholder="Cruise kts" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" step="0.1" value={form.fuelBurnGph} onChange={e => setForm({ ...form, fuelBurnGph: e.target.value })} placeholder="Burn gph" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.fuelCapacityGal} onChange={e => setForm({ ...form, fuelCapacityGal: e.target.value })} placeholder="Fuel cap gal" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" step="0.1" value={form.hobbsHours} onChange={e => setForm({ ...form, hobbsHours: e.target.value })} placeholder="Hobbs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={add} className="col-span-2 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Add aircraft</button>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : aircraft.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Plane className="w-6 h-6 mx-auto mb-2 opacity-30" />No aircraft. Add yours above.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {aircraft.map(a => (
              <li key={a.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                {editingId === a.id && editForm ? (
                  <div className="space-y-2">
                    <div className="text-xs font-mono font-semibold text-white">{a.tail} <span className="text-[10px] text-gray-400 font-sans">{a.make} {a.model}</span></div>
                    <div className="grid grid-cols-5 gap-2">
                      {EDITABLE_FIELDS.map(key => (
                        <input
                          key={key}
                          type="number"
                          step="0.1"
                          value={editForm[key]}
                          onChange={e => setEditForm(f => (f ? { ...f, [key]: e.target.value } : f))}
                          placeholder={EDIT_FIELD_LABELS[key]}
                          aria-label={EDIT_FIELD_LABELS[key]}
                          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => saveEdit(a.id)}
                        disabled={saving}
                        className="px-2 py-1 text-[10px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Save
                      </button>
                      <button onClick={cancelEdit} className="px-2 py-1 text-[10px] rounded border border-white/10 text-gray-400 hover:text-white inline-flex items-center gap-1">
                        <X className="w-3 h-3" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Plane className="w-4 h-4 text-cyan-300" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono font-semibold text-white">{a.tail}</div>
                      <div className="text-[10px] text-gray-400">{a.year} {a.make} {a.model} · {a.kind.replace(/_/g, ' ')}</div>
                    </div>
                    <span className="text-[10px] text-gray-400 inline-flex items-center gap-1"><Fuel className="w-2.5 h-2.5" />{a.fuelBurnGph}gph</span>
                    <span className="text-[10px] text-gray-400 inline-flex items-center gap-1"><Weight className="w-2.5 h-2.5" />{a.maxTakeoffWeightLbs || '—'}lbs</span>
                    <span className="text-[10px] text-amber-300 font-mono">{a.hobbsHours.toFixed(1)}h</span>
                    <button aria-label="Edit" onClick={() => startEdit(a)} className="opacity-0 group-hover:opacity-100 p-1 text-cyan-300"><Pencil className="w-3 h-3" /></button>
                    <button aria-label="Delete" onClick={() => remove(a.id)} className="opacity-0 group-hover:opacity-100 p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AircraftPanel;
