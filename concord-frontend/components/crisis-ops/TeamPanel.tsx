'use client';

/**
 * TeamPanel — incident-command roster for a crisis. Calls crisis.team to
 * list assignments, crisis.assign to add a responder with a command role,
 * and crisis.unassign to remove one.
 */

import { useEffect, useState, useCallback } from 'react';
import { Users, Loader2, UserPlus, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface TeamMember {
  id: string;
  responder: string;
  role: string;
  assignedBy: string;
  assignedAt: number;
}
interface TeamResult {
  crisisId: string;
  team: TeamMember[];
  byRole: Record<string, TeamMember[]>;
  roles: string[];
  count: number;
}

const ROLE_LABEL: Record<string, string> = {
  incident_commander: 'Incident Commander',
  operations_chief: 'Operations Chief',
  logistics_chief: 'Logistics Chief',
  planning_chief: 'Planning Chief',
  safety_officer: 'Safety Officer',
  responder: 'Responder',
};

export function TeamPanel({ crisisId }: { crisisId: string }) {
  const [team, setTeam] = useState<TeamResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [role, setRole] = useState('responder');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<TeamResult>('crisis', 'team', { crisisId });
    if (r.data?.ok && r.data.result) setTeam(r.data.result);
    setLoading(false);
  }, [crisisId]);

  useEffect(() => { load(); }, [load]);

  const assign = useCallback(async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await lensRun('crisis', 'assign', {
      crisisId, responder: name.trim(), role,
    });
    if (r.data?.ok) { setName(''); await load(); }
    setBusy(false);
  }, [crisisId, name, role, load]);

  const unassign = useCallback(async (entryId: string) => {
    const r = await lensRun('crisis', 'unassign', { crisisId, entryId });
    if (r.data?.ok) await load();
  }, [crisisId, load]);

  const roles = team?.roles || Object.keys(ROLE_LABEL);

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        <Users className="h-4 w-4 text-rose-300" />
        <h3 className="text-sm font-semibold text-white">Command roster</h3>
        {team && (
          <span className="font-mono text-[11px] text-zinc-400">{team.count} assigned</span>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && assign()}
          placeholder="Responder name"
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white placeholder:text-zinc-600"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white"
        >
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={assign}
          className="flex items-center gap-1 rounded bg-rose-600/30 px-2 py-1 text-xs text-rose-100 hover:bg-rose-600/50 disabled:opacity-40"
        >
          <UserPlus className="h-3 w-3" /> Assign
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading roster…
        </div>
      )}

      {!loading && team && team.count === 0 && (
        <p className="rounded border border-white/10 bg-white/5 p-3 text-center text-xs text-zinc-500">
          No responders assigned. Assign an Incident Commander to begin.
        </p>
      )}

      {!loading && team && team.count > 0 && (
        <div className="space-y-2">
          {roles.filter((r) => (team.byRole[r] || []).length > 0).map((r) => (
            <div key={r}>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                {ROLE_LABEL[r] || r}
              </div>
              <ul className="space-y-1">
                {(team.byRole[r] || []).map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-zinc-200"
                  >
                    <span className="truncate">{m.responder}</span>
                    <button
                      type="button"
                      onClick={() => unassign(m.id)}
                      className="rounded p-0.5 text-zinc-500 hover:bg-rose-600/30 hover:text-rose-200"
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
