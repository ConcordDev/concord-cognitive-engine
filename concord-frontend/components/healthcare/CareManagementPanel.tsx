'use client';

/**
 * CareManagementPanel — Epic Health Maintenance + Care Team. Surfaces
 * care-gap Best Practice Advisories (overdue screenings & vaccines) and
 * the patient's assigned care team.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, HeartPulse, ShieldCheck, AlertTriangle, UserPlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Gap { item: string; status: 'due' | 'overdue'; reason: string; lastDone: string | null }
interface TeamMember { id: string; providerName: string; role: string; specialty: string }

const ROLES = ['pcp', 'attending', 'specialist', 'nurse', 'care-coordinator', 'pharmacist', 'social-worker', 'other'];

export function CareManagementPanel({ patientId }: { patientId: string }) {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [gapsClear, setGapsClear] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ providerName: '', role: 'pcp', specialty: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [g, t] = await Promise.all([
        lensRun({ domain: 'healthcare', action: 'care-gaps', input: { patientId } }),
        lensRun({ domain: 'healthcare', action: 'care-team-list', input: { patientId } }),
      ]);
      setGaps((g.data?.result?.gaps || []) as Gap[]);
      setGapsClear(!!g.data?.result?.allClear);
      setTeam((t.data?.result?.careTeam || []) as TeamMember[]);
    } catch (e) { console.error('[Care] failed', e); }
    finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function assign() {
    if (!form.providerName.trim()) return;
    await lensRun({ domain: 'healthcare', action: 'care-team-assign', input: { patientId, ...form, providerName: form.providerName.trim() } });
    setForm({ providerName: '', role: 'pcp', specialty: '' });
    await refresh();
  }
  async function remove(id: string) {
    await lensRun({ domain: 'healthcare', action: 'care-team-remove', input: { id } });
    await refresh();
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>;
  }

  return (
    <div className="space-y-3">
      {/* Care gaps */}
      <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Health maintenance</span>
          <span className="text-[10px] text-gray-400">{gaps.length} gap(s)</span>
        </header>
        {gapsClear ? (
          <div className="px-3 py-8 text-center text-xs text-emerald-300 inline-flex items-center justify-center gap-1.5 w-full">
            <ShieldCheck className="w-4 h-4" />All preventive care is up to date.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {gaps.map((g, i) => (
              <li key={i} className="px-3 py-2 flex items-start gap-2">
                <AlertTriangle className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', g.status === 'overdue' ? 'text-rose-400' : 'text-amber-400')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-white">{g.item}</span>
                    <span className={cn('text-[9px] uppercase font-bold px-1 rounded',
                      g.status === 'overdue' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300')}>
                      {g.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-400">{g.reason}</div>
                  {g.lastDone && <div className="text-[10px] text-gray-400">Last done: {String(g.lastDone).slice(0, 10)}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Care team */}
      <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Care team</span>
          <span className="text-[10px] text-gray-400">{team.length}</span>
        </header>
        <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-white/10">
          <input value={form.providerName} onChange={(e) => setForm({ ...form, providerName: e.target.value })}
            placeholder="Provider name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white capitalize">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })}
            placeholder="Specialty (optional)" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button type="button" onClick={assign}
            className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-white font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1">
            <Plus className="w-3 h-3" />Assign
          </button>
        </div>
        {team.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">No care team members assigned.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {team.map((m) => (
              <div key={m.id} className="px-3 py-2 flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-200 flex items-center justify-center text-[10px] font-bold">
                  {m.providerName.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white font-medium truncate">{m.providerName}</div>
                  <div className="text-[10px] text-gray-400 capitalize">{m.role.replace('-', ' ')}{m.specialty ? ` · ${m.specialty}` : ''}</div>
                </div>
                <button aria-label="Delete" type="button" onClick={() => remove(m.id)} className="text-gray-400 hover:text-rose-300">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CareManagementPanel;
