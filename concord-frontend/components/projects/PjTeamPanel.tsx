'use client';

/**
 * PjTeamPanel — project members and their active workload.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, User } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { SkeletonTableRows, ErrorState } from '@/components/ui';

interface Member { id: string; name: string; role: string; assigned: number }

export function PjTeamPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', role: '' });

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
    if (!form.name.trim()) { setError('Member name is required.'); return; }
    const r = await lensRun('projects', 'member-add', { projectId, name: form.name.trim(), role: form.role.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', role: '' });
    setError(null);
    await refresh();
  };

  const del = async (id: string) => {
    await lensRun('projects', 'member-delete', { id });
    await refresh();
  };

  if (loading) {
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
        <input placeholder="Member name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-lattice-void border border-lattice-border rounded-lg px-2 py-1.5 text-xs text-white" />
        <input placeholder="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
          className="bg-lattice-void border border-lattice-border rounded-lg px-2 py-1.5 text-xs text-white" />
        <button type="button" onClick={addMember}
          className="flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Member
        </button>
      </section>

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
                </p>
                <p className="text-[10px] text-gray-400 capitalize">{m.role}</p>
              </div>
              <span className="text-[11px] text-gray-400 tabular-nums">{m.assigned} active</span>
              <button aria-label="Delete" type="button" onClick={() => del(m.id)} className="text-gray-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
