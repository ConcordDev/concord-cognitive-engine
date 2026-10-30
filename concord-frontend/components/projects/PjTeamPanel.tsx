'use client';

/**
 * PjTeamPanel — project members (S4: real Concord accounts only).
 * Membership IS the platform ACL grant on this project: the owner plus
 * every account holding a grant, with the grant's level (view / edit)
 * as the role. Adding takes a @username — a free-text name is not an
 * identity and the domain refuses it in those words.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, User } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { SkeletonTableRows, ErrorState } from '@/components/ui';

interface Member { id: string; userId: string; name: string; username: string | null; level: string; assigned: number }

export function PjTeamPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ account: '', level: 'edit' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'member-list', { projectId });
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load team members.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setMembers(r.data?.result?.members || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addMember = async () => {
    if (!form.account.trim()) { setError('Enter the member’s Concord username.'); return; }
    const r = await lensRun('projects', 'member-add', { projectId, account: form.account.trim(), level: form.level });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    // S12 (F18): the new member renders in the same interaction (the
    // macro returns it); the refetch reconciles its workload count.
    const m = (r.data?.result as { member?: Member } | null)?.member;
    if (m) setMembers((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, { ...m, assigned: 0 }]));
    setForm({ account: '', level: 'edit' });
    setError(null);
    await refresh();
  };

  const del = async (id: string) => {
    setMembers((prev) => prev.filter((x) => x.id !== id));
    await lensRun('projects', 'member-delete', { projectId, id });
    await refresh();
  };

  if (loading && members.length === 0) {
    return (
      <div className="rounded-lg border border-lattice-border bg-lattice-surface/70 overflow-hidden" aria-busy="true">
        <SkeletonTableRows rows={5} columns={4} />
      </div>
    );
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-lattice-surface/70 border border-lattice-border rounded-xl p-3">
        <input placeholder="Concord username (@name)" value={form.account} onChange={(e) => { setForm({ ...form, account: e.target.value }); setError(null); }}
          className="bg-lattice-void border border-lattice-border rounded-lg px-2 py-1.5 text-xs text-white" />
        <select value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })}
          className="bg-lattice-void border border-lattice-border rounded-lg px-2 py-1.5 text-xs text-white" aria-label="Access level">
          <option value="edit">Can edit</option>
          <option value="view">Can view</option>
        </select>
        <button type="button" onClick={addMember}
          className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Member
        </button>
      </section>
      <p className="text-[11px] text-gray-500">Members are Concord accounts — add them by username. They get the access level you choose, and you can assign them work in this project. Removing a member revokes their access and unassigns their open work here.</p>

      {members.length === 0 ? (
        <p className="text-[11px] text-gray-400 italic py-6 text-center">No team members yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 bg-lattice-surface/70 border border-lattice-border rounded-lg px-3 py-2">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-900/50 text-indigo-300 text-xs font-bold shrink-0">
                {m.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white flex items-center gap-1">
                  <User className="w-3 h-3 text-gray-400" />{m.name}
                  {m.username && <span className="text-gray-500 font-normal">@{m.username}</span>}
                </p>
                <p className="text-[10px] text-gray-400 capitalize">{m.level === 'owner' ? 'Owner' : m.level === 'edit' ? 'Can edit' : 'Can view'}</p>
              </div>
              <span className="text-[11px] text-gray-400 tabular-nums">{m.assigned} active</span>
              {m.level !== 'owner' && (
                <button aria-label="Remove member" type="button" onClick={() => del(m.id)} className="text-gray-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
