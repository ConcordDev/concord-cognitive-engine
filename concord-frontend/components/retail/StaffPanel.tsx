'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users, Loader2, UserPlus, Power, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface StaffMember {
  id: string; name: string; email: string; role: string;
  permissions: string[]; status: string; invitedAt: string; activatedAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  invited: 'bg-amber-500/15 text-amber-300',
  active: 'bg-emerald-500/15 text-emerald-300',
  suspended: 'bg-rose-500/15 text-rose-300',
};

/**
 * StaffPanel — staff accounts + permissions for the admin. Invites
 * team members with a role (owner / manager / fulfillment / cashier /
 * marketing), each carrying a fixed permission set; merchants activate,
 * suspend, change roles and remove accounts.
 */
export function StaffPanel() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'cashier' });
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('retail', 'staff-list', {});
      setStaff((r.data?.result?.staff || []) as StaffMember[]);
      const rl = (r.data?.result?.roles || []) as string[];
      setRoles(rl);
      if (rl.length > 0 && !rl.includes(form.role)) setForm(f => ({ ...f, role: rl[rl.length - 1] }));
    } catch (e) { console.error('[Staff] refresh failed', e); }
    finally { setLoading(false); }
  }, [form.role]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function invite() {
    if (!form.name.trim() || !form.email.trim()) { setNotice('Enter a name and email'); return; }
    setBusy(true); setNotice(null);
    try {
      const r = await lensRun('retail', 'staff-invite', { name: form.name, email: form.email, role: form.role });
      if (r.data?.ok === false) setNotice(r.data.error || 'Invite failed');
      else { setForm({ name: '', email: '', role: form.role }); await refresh(); }
    } catch (e) { console.error('[Staff] invite failed', e); }
    finally { setBusy(false); }
  }

  async function toggleActive(id: string) {
    setBusy(true);
    try {
      await lensRun('retail', 'staff-activate', { id });
      await refresh();
    } catch (e) { console.error('[Staff] activate failed', e); }
    finally { setBusy(false); }
  }

  async function changeRole(id: string, role: string) {
    setBusy(true);
    try {
      await lensRun('retail', 'staff-update-role', { id, role });
      await refresh();
    } catch (e) { console.error('[Staff] update-role failed', e); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await lensRun('retail', 'staff-remove', { id });
      await refresh();
    } catch (e) { console.error('[Staff] remove failed', e); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Users className="w-4 h-4 text-indigo-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Staff & permissions</span>
        <span className="ml-auto text-[10px] text-gray-400">{staff.length}</span>
      </header>

      {/* Invite */}
      <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="Email" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={invite} disabled={busy} className="px-3 py-1.5 text-xs rounded bg-indigo-500 text-white font-bold hover:bg-indigo-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          <UserPlus className="w-3 h-3" /> Invite
        </button>
      </div>
      {notice && <div className="px-3 py-2 text-[11px] text-amber-300 border-b border-white/10">{notice}</div>}

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : staff.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Users className="w-6 h-6 mx-auto mb-2 opacity-30" />No staff accounts yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {staff.map(m => (
              <li key={m.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{m.name}</p>
                    <p className="text-[10px] text-gray-400">{m.email}</p>
                  </div>
                  <select value={m.role} onChange={e => changeRole(m.id, e.target.value)} disabled={busy} className="px-1.5 py-0.5 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white">
                    {roles.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <span className={cn('px-1.5 py-0.5 text-[9px] uppercase rounded', STATUS_COLORS[m.status] || 'bg-gray-500/15 text-gray-300')}>{m.status}</span>
                  <button onClick={() => toggleActive(m.id)} disabled={busy} className="p-1 text-gray-400 hover:text-emerald-300" title={m.status === 'active' ? 'Suspend' : 'Activate'}>
                    <Power className="w-3 h-3" />
                  </button>
                  <button aria-label="Delete" onClick={() => remove(m.id)} disabled={busy} className="p-1 text-gray-400 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {m.permissions.map(p => (
                    <span key={p} className="px-1.5 py-0.5 text-[9px] rounded bg-indigo-500/10 text-indigo-300">{p}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default StaffPanel;
