'use client';

/**
 * AstroGearPanel — observing equipment (telescopes, eyepieces, …).
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Wrench, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Equipment {
  id: string; name: string; kind: string; specs: string | null;
  aperture: number | null; focalLength: number | null;
}

const KINDS = ['telescope', 'eyepiece', 'camera', 'binoculars', 'mount', 'filter', 'other'];

export function AstroGearPanel() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'telescope', specs: '', aperture: '', focalLength: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('astronomy', 'equipment-list', {});
    setEquipment(r.data?.result?.equipment || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.name.trim()) { setError('Equipment name is required.'); return; }
    const r = await lensRun('astronomy', 'equipment-add', {
      name: form.name.trim(), kind: form.kind, specs: form.specs.trim(),
      aperture: form.aperture ? Number(form.aperture) : undefined,
      focalLength: form.focalLength ? Number(form.focalLength) : undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', kind: 'telescope', specs: '', aperture: '', focalLength: '' });
    setError(null);
    await refresh();
  };
  const del = async (id: string) => { await lensRun('astronomy', 'equipment-delete', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <input placeholder="Aperture (mm)" inputMode="numeric" value={form.aperture} onChange={(e) => setForm({ ...form, aperture: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Focal length (mm)" inputMode="numeric" value={form.focalLength} onChange={(e) => setForm({ ...form, focalLength: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={add}
          className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      {equipment.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No equipment. Add telescopes, eyepieces and cameras.
        </div>
      ) : (
        <ul className="space-y-2">
          {equipment.map((e) => (
            <li key={e.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-indigo-400" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{e.name}</p>
                  <p className="text-[11px] text-zinc-400 capitalize">
                    {e.kind}
                    {e.aperture ? ` · ${e.aperture}mm aperture` : ''}
                    {e.focalLength ? ` · f=${e.focalLength}mm` : ''}
                    {e.specs ? ` · ${e.specs}` : ''}
                  </p>
                </div>
              </div>
              <button aria-label="Delete" type="button" onClick={() => del(e.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
