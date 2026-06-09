'use client';

/**
 * EnergyDevicesPanel — tracked devices, per-device reading entry and a
 * top-consumers ranking.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Plug, Trash2, Flame } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Device { id: string; name: string; category: string; wattage: number; alwaysOn: boolean; totalKwh: number }
interface Consumer { deviceId: string; name: string; kwh: number; cost: number }

const CATEGORIES = ['hvac', 'appliance', 'lighting', 'electronics', 'ev_charger', 'water_heater', 'kitchen', 'laundry'];

export function EnergyDevicesPanel({ onChange }: { onChange: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'appliance', wattage: '' });
  const [readingFor, setReadingFor] = useState<string | null>(null);
  const [readingKwh, setReadingKwh] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [d, t] = await Promise.all([
      lensRun('energy', 'device-list', {}),
      lensRun('energy', 'top-consumers', { days: 30 }),
    ]);
    setDevices(d.data?.result?.devices || []);
    setConsumers(t.data?.result?.devices || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.name.trim()) { setError('Device name is required.'); return; }
    const r = await lensRun('energy', 'device-add', {
      name: form.name.trim(), category: form.category, wattage: Number(form.wattage) || 0,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', category: 'appliance', wattage: '' });
    setShowAdd(false); setError(null);
    await refresh();
  };
  const del = async (id: string) => { await lensRun('energy', 'device-delete', { id }); await refresh(); };
  const logReading = async (deviceId: string) => {
    if (!(Number(readingKwh) > 0)) { setError('Enter a kWh value.'); return; }
    await lensRun('energy', 'reading-log', { deviceId, kwh: Number(readingKwh) });
    setReadingFor(null); setReadingKwh(''); setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {consumers.length > 0 && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <Flame className="w-3.5 h-3.5 text-lime-400" /> Top consumers (30 days)
          </h3>
          <ul className="space-y-1">
            {consumers.slice(0, 5).map((c) => (
              <li key={c.deviceId} className="flex items-center justify-between text-[11px] bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-zinc-200">{c.name}</span>
                <span className="text-zinc-400 font-mono">{c.kwh} kWh · ${c.cost}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
            <Plug className="w-3.5 h-3.5 text-lime-400" /> Devices
          </h3>
          <button type="button" onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {showAdd && (
          <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 mb-2">
            <input placeholder="Device name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
            <input placeholder="Watts" inputMode="numeric" value={form.wattage} onChange={(e) => setForm({ ...form, wattage: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={add}
              className="col-span-3 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add device</button>
          </div>
        )}

        {devices.length === 0 ? (
          <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
            No devices. Add appliances to track their consumption.
          </div>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li key={d.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{d.name}</p>
                    <p className="text-[11px] text-zinc-400 capitalize">
                      {d.category.replace(/_/g, ' ')}{d.wattage > 0 ? ` · ${d.wattage}W` : ''} · {d.totalKwh} kWh logged
                    </p>
                  </div>
                  <button aria-label="Delete" type="button" onClick={() => del(d.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {readingFor === d.id ? (
                  <div className="flex gap-1 mt-2">
                    <input placeholder="kWh" inputMode="decimal" value={readingKwh} onChange={(e) => setReadingKwh(e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                    <button type="button" onClick={() => logReading(d.id)}
                      className="px-2.5 py-1 text-[11px] bg-lime-600 hover:bg-lime-500 text-white rounded-lg">Save</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => { setReadingFor(d.id); setReadingKwh(''); }}
                    className="mt-1.5 text-[11px] text-lime-400 hover:text-lime-300">+ Log reading</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
