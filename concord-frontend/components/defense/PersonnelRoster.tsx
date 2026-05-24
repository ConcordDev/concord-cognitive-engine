'use client';

/**
 * PersonnelRoster — roster with roles, assignments and availability.
 * Backed by defense.personnel-upsert / personnel-delete /
 * personnel-roster macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plus, Trash2, Loader2, Users, Edit2, X, UserCheck } from 'lucide-react';

interface Person {
  id: string;
  name: string;
  rank: string;
  role: string;
  unit: string;
  assignment: string;
  availability: 'available' | 'deployed' | 'transit' | 'leave' | 'unavailable';
}

interface RosterResult {
  roster: Person[];
  total: number;
  byAvailability: Record<string, number>;
  byRole: Record<string, number>;
  unassigned: { id: string; name: string }[];
  deployable: number;
}

const AVAILABILITY = ['available', 'deployed', 'transit', 'leave', 'unavailable'] as const;

const AVAIL_COLOR: Record<string, string> = {
  available: 'text-green-400',
  deployed: 'text-cyan-400',
  transit: 'text-yellow-400',
  leave: 'text-purple-400',
  unavailable: 'text-red-400',
};

interface PersonForm {
  id?: string;
  name: string;
  rank: string;
  role: string;
  unit: string;
  assignment: string;
  availability: string;
}

const EMPTY_FORM: PersonForm = {
  name: '',
  rank: '',
  role: '',
  unit: '',
  assignment: '',
  availability: 'available',
};

export function PersonnelRoster() {
  const [data, setData] = useState<RosterResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<PersonForm | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<RosterResult>('defense', 'personnel-roster', {});
    if (r.data?.ok && r.data.result) setData(r.data.result);
    else setError(r.data?.error || 'Failed to load roster');
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    if (!form) return;
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun('defense', 'personnel-upsert', {
      id: form.id,
      name: form.name.trim(),
      rank: form.rank.trim(),
      role: form.role.trim(),
      unit: form.unit.trim(),
      assignment: form.assignment.trim(),
      availability: form.availability,
    });
    if (r.data?.ok) {
      setForm(null);
      await refresh();
    } else {
      setError(r.data?.error || 'Failed to save personnel record');
    }
    setBusy(false);
  }, [form, refresh]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    const r = await lensRun('defense', 'personnel-delete', { id });
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Failed to delete personnel record');
    setBusy(false);
  }, [refresh]);

  const roster = data?.roster || [];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Personnel Roster</h3>
        </div>
        {data && (
          <div className="flex gap-3 text-[11px]">
            <span className="text-green-400">
              <UserCheck className="w-3 h-3 inline mr-1" />
              {data.deployable} deployable
            </span>
            <span className="text-cyan-400">{data.byAvailability.deployed || 0} deployed</span>
            <span className="text-zinc-400">{data.total} total</span>
          </div>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Availability rollup */}
      {data && data.total > 0 && (
        <div className="grid grid-cols-5 gap-1.5">
          {AVAILABILITY.map((a) => (
            <div key={a} className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-center">
              <div className={`text-sm font-bold ${AVAIL_COLOR[a]}`}>
                {data.byAvailability[a] || 0}
              </div>
              <div className="text-[9px] uppercase tracking-wider text-zinc-400">{a}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {roster.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {p.rank && <span className="text-[10px] text-zinc-400 shrink-0 font-mono">{p.rank}</span>}
                <span className="text-xs text-white truncate">{p.name}</span>
                {p.role && <span className="text-[10px] text-indigo-400 shrink-0">{p.role}</span>}
                {p.unit && <span className="text-[10px] text-zinc-400 shrink-0">{p.unit}</span>}
                {p.assignment ? (
                  <span className="text-[10px] text-zinc-400 shrink-0 truncate">→ {p.assignment}</span>
                ) : (
                  <span className="text-[10px] text-amber-500 shrink-0">unassigned</span>
                )}
                <span className={`text-[10px] shrink-0 ${AVAIL_COLOR[p.availability]}`}>
                  {p.availability}
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() =>
                    setForm({
                      id: p.id,
                      name: p.name,
                      rank: p.rank,
                      role: p.role,
                      unit: p.unit,
                      assignment: p.assignment,
                      availability: p.availability,
                    })
                  }
                  aria-label="Edit personnel"
                  className="p-1 text-zinc-400 hover:text-blue-400"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => remove(p.id)}
                  disabled={busy}
                  aria-label="Delete personnel"
                  className="p-1 text-zinc-400 hover:text-red-400 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {roster.length === 0 && (
            <div className="text-center py-6 text-xs text-zinc-400">
              <Users className="w-6 h-6 mx-auto mb-2 opacity-30" />
              No personnel on the roster. Add one below.
            </div>
          )}
        </div>
      )}

      {/* Editor */}
      {form ? (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              {form.id ? 'Edit Personnel' : 'New Personnel'}
            </span>
            <button onClick={() => setForm(null)} aria-label="Close editor" className="text-zinc-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Name"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
            <input
              value={form.rank}
              onChange={(e) => setForm({ ...form, rank: e.target.value })}
              placeholder="Rank"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
            <input
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              placeholder="Role / MOS"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
            <input
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="Unit"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
            <input
              value={form.assignment}
              onChange={(e) => setForm({ ...form, assignment: e.target.value })}
              placeholder="Assignment"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            />
            <select
              value={form.availability}
              onChange={(e) => setForm({ ...form, availability: e.target.value })}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white"
            >
              {AVAILABILITY.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={save}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      ) : (
        <button
          onClick={() => setForm({ ...EMPTY_FORM })}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 hover:border-blue-500/50 px-3 py-1.5 text-xs font-medium text-zinc-300"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Personnel
        </button>
      )}
    </section>
  );
}
