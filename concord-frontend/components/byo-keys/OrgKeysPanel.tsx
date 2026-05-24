'use client';

/**
 * OrgKeysPanel — org-shared key groups with member-level access
 * control. An owner creates a group; admins/owner add members with
 * roles (admin/user/viewer). Reads byo_keys.org_keys_list, writes
 * via org_key_create / org_key_add_member / org_key_remove_member.
 *
 * Plaintext keys never leave the owner's encrypted store — the group
 * is an access-control list, not a key copy.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

interface OrgMember { memberId: string; role: string }
interface OrgGroup {
  orgId: string;
  label: string;
  provider: string;
  slot: string | null;
  myRole: string;
  isOwner: boolean;
  members: OrgMember[];
  memberCount: number;
  createdAt: number;
}

const PROVIDERS = ['openai', 'anthropic', 'xai', 'google'];
const ROLES = ['admin', 'user', 'viewer'];

export function OrgKeysPanel() {
  const [orgs, setOrgs] = useState<OrgGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ label: '', provider: 'anthropic' });
  const [memberForm, setMemberForm] = useState<{ orgId: string; memberId: string; role: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ orgs: OrgGroup[] }>('byo_keys', 'org_keys_list', {});
    if (r.data?.ok && r.data.result) setOrgs(r.data.result.orgs);
    setLoaded(true);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    if (!createForm.label.trim()) return;
    setBusy(true);
    await lensRun('byo_keys', 'org_key_create', {
      label: createForm.label.trim(), provider: createForm.provider,
    });
    setBusy(false);
    setCreating(false);
    setCreateForm({ label: '', provider: 'anthropic' });
    refresh();
  };

  const addMember = async () => {
    if (!memberForm || !memberForm.memberId.trim()) return;
    setBusy(true);
    const r = await lensRun('byo_keys', 'org_key_add_member', {
      orgId: memberForm.orgId, memberId: memberForm.memberId.trim(), role: memberForm.role,
    });
    setBusy(false);
    if (r.data?.ok) {
      setMemberForm(null);
      refresh();
    }
  };

  const removeMember = async (orgId: string, memberId: string) => {
    await lensRun('byo_keys', 'org_key_remove_member', { orgId, memberId });
    refresh();
  };

  const canManage = (org: OrgGroup) => org.myRole === 'owner' || org.myRole === 'admin';

  return (
    <section className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="text-sm font-semibold text-zinc-100">Org-shared key groups</h2>
        <button
          onClick={() => setCreating((c) => !c)}
          className="px-2.5 py-1 rounded-md text-[11px] bg-amber-600/80 hover:bg-amber-600 text-amber-50"
        >
          {creating ? 'cancel' : 'new group'}
        </button>
      </div>
      <p className="text-[11px] text-zinc-400 mb-3">
        Share a provider key across a team without exposing the plaintext. The owner&apos;s
        encrypted key stays put — the group is an access list of who may route through it.
      </p>

      {creating && (
        <div className="mb-4 rounded-lg bg-zinc-950 ring-1 ring-zinc-800 p-3 space-y-2">
          <input
            type="text"
            value={createForm.label}
            onChange={(e) => setCreateForm((f) => ({ ...f, label: e.target.value }))}
            placeholder="Group label (e.g. 'Eng team — Anthropic')"
            className="w-full px-2 py-1.5 rounded-md bg-zinc-900 text-zinc-100 text-xs ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
          />
          <select
            value={createForm.provider}
            onChange={(e) => setCreateForm((f) => ({ ...f, provider: e.target.value }))}
            className="w-full px-2 py-1.5 rounded-md bg-zinc-900 text-zinc-100 text-xs ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
          >
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            onClick={create}
            disabled={busy || !createForm.label.trim()}
            className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-amber-50 text-xs font-medium disabled:opacity-50"
          >
            create group
          </button>
        </div>
      )}

      {loaded && orgs.length === 0 && !creating && (
        <div className="text-xs text-zinc-400 rounded-md border border-dashed border-zinc-800 p-6 text-center">
          No org key groups yet. Create one to share a provider key with a team.
        </div>
      )}

      <ul className="space-y-3">
        {orgs.map((org) => (
          <li key={org.orgId} className="rounded-lg bg-zinc-950 ring-1 ring-zinc-800 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-zinc-200">{org.label}</div>
                <div className="text-[10px] text-zinc-400 font-mono">
                  {org.provider} · {org.memberCount} member{org.memberCount === 1 ? '' : 's'} · you are {org.myRole}
                </div>
              </div>
              {canManage(org) && (
                <button
                  onClick={() => setMemberForm(
                    memberForm?.orgId === org.orgId
                      ? null
                      : { orgId: org.orgId, memberId: '', role: 'user' },
                  )}
                  className="px-2 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 shrink-0"
                >
                  {memberForm?.orgId === org.orgId ? 'cancel' : 'add member'}
                </button>
              )}
            </div>

            <ul className="mt-2 space-y-1">
              {org.members.map((m) => (
                <li key={m.memberId} className="flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-zinc-400 flex-1 truncate">{m.memberId}</span>
                  <span className={`font-mono ${m.role === 'owner' ? 'text-amber-300' : 'text-zinc-400'}`}>
                    {m.role}
                  </span>
                  {canManage(org) && m.role !== 'owner' && (
                    <button
                      onClick={() => removeMember(org.orgId, m.memberId)}
                      className="px-1.5 rounded bg-zinc-800 hover:bg-red-900/50 text-zinc-400"
                    >
                      remove
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {memberForm?.orgId === org.orgId && (
              <div className="mt-2 flex gap-2 border-t border-zinc-800 pt-2">
                <input
                  type="text"
                  value={memberForm.memberId}
                  onChange={(e) => setMemberForm((f) => f && { ...f, memberId: e.target.value })}
                  placeholder="member user id"
                  className="flex-1 px-2 py-1 rounded-md bg-zinc-900 text-zinc-100 text-[11px] ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
                />
                <select
                  value={memberForm.role}
                  onChange={(e) => setMemberForm((f) => f && { ...f, role: e.target.value })}
                  className="px-2 py-1 rounded-md bg-zinc-900 text-zinc-100 text-[11px] ring-1 ring-zinc-700 focus:outline-none"
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <button
                  onClick={addMember}
                  disabled={busy || !memberForm.memberId.trim()}
                  className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-amber-50 text-[11px] font-medium disabled:opacity-50"
                >
                  add
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
