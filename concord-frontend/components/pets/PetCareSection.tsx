'use client';

/**
 * PetCareSection — pet-care 2026-shape workbench (PetNoter / Petfetti
 * health management + Rover-shape caregiver booking). Owns the pet
 * picker and tab nav; pet-scoped panels receive the selected petId.
 */

import { useCallback, useEffect, useState } from 'react';
import { PawPrint, Plus, HeartPulse, Activity, BellRing, CalendarHeart, ShieldCheck, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PetHealthPanel } from './PetHealthPanel';
import { PetWellnessPanel } from './PetWellnessPanel';
import { PetRemindersPanel } from './PetRemindersPanel';
import { PetServicesPanel } from './PetServicesPanel';
import { PetRecordsPanel } from './PetRecordsPanel';

interface Pet { id: string; name: string; species: string; breed: string | null }
interface Dash { pets: number; overdueVaccines: number; openReminders: number; overdueReminders: number; monthSpend: number; activeBookings: number }

type TabId = 'health' | 'wellness' | 'reminders' | 'services' | 'records';
const TABS: { id: TabId; label: string; icon: typeof HeartPulse }[] = [
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'wellness', label: 'Weight & Care', icon: Activity },
  { id: 'reminders', label: 'Reminders', icon: BellRing },
  { id: 'services', label: 'Care Services', icon: CalendarHeart },
  { id: 'records', label: 'Records & ID', icon: ShieldCheck },
];

export function PetCareSection() {
  const [pets, setPets] = useState<Pet[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [tab, setTab] = useState<TabId>('health');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', species: 'dog', breed: '', birthdate: '', weightKg: '' });

  const refresh = useCallback(async () => {
    const [p, d] = await Promise.all([
      lensRun('pets', 'pet-list', {}),
      lensRun('pets', 'pets-dashboard', {}),
    ]);
    const list: Pet[] = p.data?.result?.pets || [];
    setPets(list);
    setDash((d.data?.result as Dash | null) || null);
    setSelected((cur) => (cur && list.some((x) => x.id === cur)) ? cur : (list[0]?.id || ''));
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const addPet = async () => {
    if (!form.name.trim()) { setError('Pet name is required.'); return; }
    const r = await lensRun('pets', 'pet-add', {
      name: form.name.trim(), species: form.species, breed: form.breed.trim(),
      birthdate: form.birthdate, weightKg: Number(form.weightKg) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not add pet'); return; }
    setForm({ name: '', species: 'dog', breed: '', birthdate: '', weightKg: '' });
    setShowAdd(false);
    setError(null);
    setSelected(r.data?.result?.pet?.id || '');
    await refresh();
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-teal-600/15 to-transparent">
        <PawPrint className="w-5 h-5 text-teal-400" />
        <h2 className="text-sm font-bold text-zinc-100">Pet Care</h2>
        <span className="text-[11px] text-zinc-500">Health records, reminders &amp; sitter booking</span>
      </header>

      {/* Dashboard strip */}
      {dash && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Pets" value={dash.pets} />
          <Stat label="Overdue shots" value={dash.overdueVaccines} alert={dash.overdueVaccines > 0} />
          <Stat label="Open reminders" value={dash.openReminders} alert={dash.overdueReminders > 0} />
          <Stat label="Month spend" value={`$${dash.monthSpend}`} />
          <Stat label="Bookings" value={dash.activeBookings} />
        </div>
      )}

      {/* Pet picker */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 overflow-x-auto">
        {pets.map((p) => (
          <button
            key={p.id} type="button" onClick={() => setSelected(p.id)}
            className={cn('flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border whitespace-nowrap',
              selected === p.id ? 'border-teal-600/60 bg-teal-950/40 text-teal-200' : 'border-zinc-700 text-zinc-400')}
          >
            <PawPrint className="w-3 h-3" /> {p.name}
          </button>
        ))}
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white rounded-full whitespace-nowrap">
          <Plus className="w-3 h-3" /> Add pet
        </button>
      </div>

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/50">
          <input placeholder="Pet name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['dog', 'cat', 'bird', 'rabbit', 'reptile', 'other'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input placeholder="Breed" value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" value={form.birthdate} onChange={(e) => setForm({ ...form, birthdate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Weight (kg)" inputMode="decimal" value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addPet}
            className="bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Save pet</button>
        </div>
      )}

      {error && <div className="mx-4 mt-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {pets.length === 0 ? (
        <div className="p-8 text-center text-zinc-500 text-sm italic">
          No pets yet. Add your first pet to start tracking health records.
        </div>
      ) : (
        <>
          <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setTab(t.id)}
                  className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap',
                    active ? 'bg-zinc-900 text-teal-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </nav>
          <div className="p-4">
            {tab === 'health' && <PetHealthPanel petId={selected} onChange={refresh} />}
            {tab === 'wellness' && <PetWellnessPanel petId={selected} onChange={refresh} />}
            {tab === 'reminders' && <PetRemindersPanel petId={selected} onChange={refresh} />}
            {tab === 'services' && <PetServicesPanel petId={selected} onChange={refresh} />}
            {tab === 'records' && (() => {
              const sel = pets.find((p) => p.id === selected);
              return (
                <PetRecordsPanel
                  petId={selected}
                  petName={sel?.name || 'this pet'}
                  species={sel?.species || 'dog'}
                  breed={sel?.breed || null}
                  onChange={refresh}
                />
              );
            })()}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-lg font-bold', alert ? 'text-rose-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
