'use client';

/**
 * PetProfileCard — the selected pet's live profile (pet-detail: age, record
 * counts, overdue shots, open reminders) with edit (pet-update) and an
 * in-place-confirmed delete (pet-delete, which also removes that pet's
 * health records, reminders and expenses on the server).
 */

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Trash2, Loader2, Syringe, Pill, Stethoscope, Scale, BellRing } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Detail {
  pet: {
    id: string; name: string; species: string; breed: string | null; weightKg?: number;
    birthdate?: string | null; microchipId?: string | null; neutered?: boolean;
    age?: { years: number; months: number } | null;
  };
  counts: { vaccines: number; medications: number; vetVisits: number; weightLogs: number };
  overdueVaccines: number;
  openReminders: number;
}

const input = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 focus:border-teal-500/60 focus:outline-none';

export function PetProfileCard({ petId, onChange }: { petId: string; onChange: () => Promise<void> | void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', breed: '', weightKg: '', birthdate: '', microchipId: '', neutered: false });

  const load = useCallback(async () => {
    const r = await lensRun<Detail>('pets', 'pet-detail', { id: petId });
    if (!r.data.ok || !r.data.result) { setError(r.data.error || 'Could not load this pet.'); return; }
    setError(null);
    setDetail(r.data.result);
  }, [petId]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const startEdit = () => {
    if (!detail) return;
    const p = detail.pet;
    setForm({
      name: p.name, breed: p.breed || '', weightKg: p.weightKg != null ? String(p.weightKg) : '',
      birthdate: p.birthdate || '', microchipId: p.microchipId || '', neutered: p.neutered === true,
    });
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await lensRun('pets', 'pet-update', {
        id: petId, name: form.name, breed: form.breed, weightKg: Number(form.weightKg) || 0,
        birthdate: form.birthdate, microchipId: form.microchipId, neutered: form.neutered,
      });
      if (!r.data.ok) { setError(r.data.error || 'Could not save.'); return; }
      setEditing(false);
      await load();
      await onChange();
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await lensRun('pets', 'pet-delete', { id: petId });
      if (!r.data.ok) { setError(r.data.error || 'Could not remove this pet.'); setConfirmDelete(false); return; }
      await onChange();
    } finally { setBusy(false); }
  };

  if (error && !detail) return <p role="alert" className="mx-4 mt-3 text-xs text-rose-400">{error}</p>;
  if (!detail) {
    return <div role="status" aria-busy="true" className="mx-4 mt-3 flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading profile…</div>;
  }

  const p = detail.pet;
  const age = p.age ? (p.age.years > 0 ? `${p.age.years}y ${p.age.months}m` : `${p.age.months} months`) : null;
  const chips: Array<{ icon: typeof Syringe; label: string; alert?: boolean }> = [
    { icon: Syringe, label: `${detail.counts.vaccines} vaccines${detail.overdueVaccines ? ` · ${detail.overdueVaccines} overdue` : ''}`, alert: detail.overdueVaccines > 0 },
    { icon: Pill, label: `${detail.counts.medications} active meds` },
    { icon: Stethoscope, label: `${detail.counts.vetVisits} vet visits` },
    { icon: Scale, label: `${detail.counts.weightLogs} weigh-ins` },
    { icon: BellRing, label: `${detail.openReminders} open reminders` },
  ];

  return (
    <div className="border-b border-zinc-800 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-100">{p.name}</p>
          <p className="text-[11px] capitalize text-zinc-400">
            {[p.species, p.breed, age, p.weightKg ? `${p.weightKg} kg` : null, p.neutered ? 'neutered' : null].filter(Boolean).join(' · ')}
          </p>
          {p.microchipId && <p className="font-mono text-[10px] text-zinc-500">Chip {p.microchipId}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={startEdit} className="inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-200">
            <Pencil className="h-3 w-3" /> Edit
          </button>
          {confirmDelete ? (
            <>
              <button type="button" onClick={() => void remove()} disabled={busy} className="rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-50">
                Remove {p.name} and all records
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-[11px] text-zinc-400 hover:text-zinc-200">Keep</button>
            </>
          ) : (
            <button type="button" aria-label={`Remove ${p.name}`} onClick={() => setConfirmDelete(true)} className="rounded-full border border-zinc-800 p-1.5 text-zinc-500 transition-colors hover:border-rose-500/40 hover:text-rose-300">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map(({ icon: Icon, label, alert }) => (
          <span key={label} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]', alert ? 'bg-rose-500/15 text-rose-300' : 'bg-zinc-800/70 text-zinc-400')}>
            <Icon className="h-3 w-3" /> {label}
          </span>
        ))}
      </div>
      {editing && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-teal-600/30 bg-teal-950/20 p-3 sm:grid-cols-3">
          <input aria-label="Pet name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          <input aria-label="Breed" placeholder="Breed" value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} className={input} />
          <input aria-label="Weight (kg)" inputMode="decimal" placeholder="Weight (kg)" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} className={input} />
          <input aria-label="Birthdate" type="date" value={form.birthdate} onChange={(e) => setForm({ ...form, birthdate: e.target.value })} className={input} />
          <input aria-label="Microchip ID" placeholder="Microchip ID" value={form.microchipId} onChange={(e) => setForm({ ...form, microchipId: e.target.value })} className={input} />
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={form.neutered} onChange={(e) => setForm({ ...form, neutered: e.target.checked })} /> Spayed / neutered
          </label>
          <div className="col-span-2 flex gap-2 sm:col-span-3">
            <button type="button" onClick={() => void save()} disabled={busy} className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-500 disabled:opacity-40">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-zinc-400 hover:text-zinc-200">Cancel</button>
          </div>
        </div>
      )}
      {error && detail && <p role="alert" className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
