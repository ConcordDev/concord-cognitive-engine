'use client';

import { useEffect, useState } from 'react';
import { Users, Loader2, Plus, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Patient {
  id: string; mrn: string; firstName: string; lastName: string;
  dob: string; sex: string; phone: string; email: string;
  insurancePlan: string; insuranceMemberId: string;
}

export function PatientsPanel({ onSelect }: { onSelect: (patientId: string) => void }) {
  const [list, setList] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({ firstName: '', lastName: '', dob: '', sex: 'U' as 'M' | 'F' | 'X' | 'U', phone: '', email: '', insurancePlan: '', insuranceMemberId: '', address: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh(query = '') {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'patients-list', input: query ? { q: query } : {} });
      setList((r.data?.result?.patients || []) as Patient[]);
    } catch (e) { console.error('[Patients] list failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.firstName.trim() || !draft.lastName.trim()) return;
    try {
      const r = await lensRun({ domain: 'healthcare', action: 'patients-create', input: draft });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setDraft({ firstName: '', lastName: '', dob: '', sex: 'U', phone: '', email: '', insurancePlan: '', insuranceMemberId: '', address: '' });
      setCreating(false);
      await refresh();
      if (r.data?.result?.patient) onSelect(r.data.result.patient.id);
    } catch (e) { console.error('[Patients] create failed', e); }
  }

  function age(dob: string): string {
    if (!dob) return '—';
    const d = new Date(dob); if (isNaN(d.getTime())) return '—';
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
    return `${a}y`;
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">Patients</span>
        <span className="text-[10px] text-gray-500">{list.length}</span>
        <div className="ml-2 flex items-center gap-1 flex-1 max-w-[300px]">
          <Search className="w-3.5 h-3.5 text-gray-500" />
          <input
            value={q}
            onChange={e => { setQ(e.target.value); refresh(e.target.value); }}
            placeholder="Search name or MRN…"
            className="flex-1 bg-transparent text-xs text-white outline-none px-1"
          />
        </div>
        <button onClick={() => setCreating(v => !v)} className="px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />New
        </button>
      </header>

      {creating && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input value={draft.firstName} onChange={e => setDraft({ ...draft, firstName: e.target.value })} placeholder="First name *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.lastName} onChange={e => setDraft({ ...draft, lastName: e.target.value })} placeholder="Last name *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="date" value={draft.dob} onChange={e => setDraft({ ...draft, dob: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <select value={draft.sex} onChange={e => setDraft({ ...draft, sex: e.target.value as typeof draft.sex })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="U">Unknown</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="X">Non-binary</option>
          </select>
          <input value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} placeholder="Phone" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} placeholder="Email" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.insurancePlan} onChange={e => setDraft({ ...draft, insurancePlan: e.target.value })} placeholder="Insurance plan" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.insuranceMemberId} onChange={e => setDraft({ ...draft, insuranceMemberId: e.target.value })} placeholder="Member ID" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={draft.address} onChange={e => setDraft({ ...draft, address: e.target.value })} placeholder="Address" className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Register patient</button>
        </div>
      )}

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Users className="w-6 h-6 mx-auto mb-2 opacity-30" />No patients yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(p => (
              <li key={p.id} onClick={() => onSelect(p.id)} className="px-4 py-2.5 hover:bg-white/[0.02] cursor-pointer flex items-center gap-3">
                <div className={cn(
                  'w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                  p.sex === 'F' ? 'bg-rose-500/15 text-rose-300' : p.sex === 'M' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-amber-500/15 text-amber-300',
                )}>{p.firstName.slice(0, 1)}{p.lastName.slice(0, 1)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{p.lastName}, {p.firstName}</div>
                  <div className="text-[10px] text-gray-500 truncate">
                    <span className="font-mono">{p.mrn}</span>
                    {p.dob && <span> · DOB {p.dob} ({age(p.dob)})</span>}
                    <span> · {p.sex}</span>
                    {p.insurancePlan && <span> · {p.insurancePlan}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-cyan-300">Open chart →</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PatientsPanel;
