'use client';

/**
 * AgencyMutualAidPanel — real cross-org (mutual-aid) incident sharing.
 *
 * WAVE4 (emergency-services): an AGENCY is an org (the same reusable
 * roster/role substrate `server/lib/world-organizations.js` already backs
 * the supplychain/command-center "team" panels with). This panel is the
 * frontend surface for the additive `emergency-services.agency*` +
 * `emergency-services.mutual-aid*` macros (see server/domains/
 * emergencyservices.js). Nothing here is a mock — every roster, incident,
 * unit, and share record comes from a real macro call scoped by a real
 * `orgId`; a brand-new agency with no shared incidents yet shows the same
 * honest empty state as a fresh personal CAD board.
 *
 * The genuinely-new primitive is mutual aid: Agency A can SHARE one of its
 * own real open incidents with Agency B (a real record keyed by both org
 * ids); B only sees it if B has explicitly opted in to receiving mutual
 * aid (agency-mutual-aid-consent) — sharing to a non-existent or
 * non-consenting agency is an honest failure, never a silent success. B
 * can then commit one of ITS OWN real available units to help, which runs
 * it through the same available→dispatched transition a normal dispatch
 * uses. Both agencies see the share and the commitment live.
 *
 * GATED / documented-external: this view never claims a real SMS page,
 * radio call, or 911-console message was sent — those are genuinely
 * external systems (a paging provider, RF hardware, CAD-console
 * integration) this codebase has no credentials or drivers for. The real
 * close here is in-Concord cross-org visibility + real unit commitment.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Building2, Users, UserPlus, Crown, ShieldCheck, ShieldQuestion, Eye, LogOut,
  Loader2, Plus, Check, AlertTriangle, Search, Share2, Truck, Undo2, Siren, Radio,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

/* ──────────────────────────── types ─────────────────────────────────── */

type EmsRole = 'chief' | 'supervisor' | 'responder' | 'trainee';
type OrgRole = 'leader' | 'officer' | 'member' | 'apprentice';

interface OrgSummary {
  id: string; name: string; type: string; leaderId: string;
  memberCount: number; myRole?: OrgRole; myEmsRole?: EmsRole;
}
interface OrgMember { userId: string; role: OrgRole; emsRole: EmsRole }
interface AgencyMembersResult {
  organization: OrgSummary; members: OrgMember[]; myRole: EmsRole | null; myOrgRole: OrgRole;
}
interface Incident {
  id: string; summary: string; kind: string; priority: number; location: string;
  status: string; assignedUnitId: string | null; createdAt: string; orgId: string | null;
}
interface Unit {
  id: string; name: string; kind: string; status: string; station: string; orgId: string | null;
}
interface Commitment {
  unitId: string; unitName: string; unitKind: string; unitOrgId: string;
  committedBy: string; committedAt: string;
}
interface MutualAidShare {
  id: string; incidentId: string; sourceOrgId: string; sourceOrgName: string;
  targetOrgId: string; targetOrgName: string; sharedBy: string; note: string;
  status: 'active' | 'recalled'; sharedAt: string; recalledAt: string | null;
  committedUnits: Commitment[]; incident: Incident | null;
}
interface MutualAidListResult {
  sharedByUs: MutualAidShare[]; sharedWithUs: MutualAidShare[]; mutualAidEnabled: boolean;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;

/* ─────────────────────────── macro helper ────────────────────────────── */

async function run<T>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('emergency-services', action, input);
  if (!r.data?.ok) throw new Error(r.data?.error || `${action} failed`);
  return r.data.result;
}

const INPUT = 'w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white';
const LABEL = 'text-[9px] uppercase tracking-wider text-zinc-400 font-semibold';
const BTN = 'flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const EMS_ROLE_META: Record<EmsRole, { label: string; desc: string; icon: typeof Crown; tone: string }> = {
  chief: { label: 'Chief', desc: 'Full command — roster, roles, incidents, units, mutual-aid consent', icon: Crown, tone: 'text-amber-300 bg-amber-500/15 border-amber-500/30' },
  supervisor: { label: 'Supervisor', desc: 'Full write — incidents, units, mutual-aid consent', icon: ShieldCheck, tone: 'text-blue-300 bg-blue-500/15 border-blue-500/30' },
  responder: { label: 'Responder', desc: 'Full write — log incidents, add/dispatch units', icon: ShieldQuestion, tone: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' },
  trainee: { label: 'Trainee', desc: 'Read-only observer seat', icon: Eye, tone: 'text-zinc-300 bg-zinc-700/30 border-zinc-600/40' },
};

function RoleBadge({ role }: { role: EmsRole }) {
  const meta = EMS_ROLE_META[role];
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', meta.tone)}>
      <Icon className="w-2.5 h-2.5" /> {meta.label}
    </span>
  );
}

/* ────────────────────── create / join (no-agency state) ──────────────── */

function CreateOrJoin({ notify, onDone }: { notify: (f: Feedback) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'create' | 'join' | 'browse'>('create');
  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [browse, setBrowse] = useState<OrgSummary[] | null>(null);

  const create = async () => {
    if (!name.trim()) { notify({ kind: 'err', text: 'Enter an agency name.' }); return; }
    setBusy(true);
    try {
      await run('agency-create', { name });
      setName('');
      notify({ kind: 'ok', text: 'Agency created — you are its chief.' });
      onDone();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const join = async () => {
    if (!joinId.trim()) { notify({ kind: 'err', text: 'Enter an agency ID to join.' }); return; }
    setBusy(true);
    try {
      const res = await run<{ role: OrgRole; emsRole: EmsRole }>('agency-join', { orgId: joinId.trim() });
      notify({ kind: 'ok', text: `Joined as ${res ? EMS_ROLE_META[res.emsRole].label : 'a member'}.` });
      setJoinId('');
      onDone();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const loadBrowse = useCallback(async () => {
    setBusy(true);
    try { setBrowse((await run<{ organizations: OrgSummary[] }>('agency-list', { limit: 25 }))?.organizations || []); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
  }, [notify]);

  useEffect(() => { if (mode === 'browse' && browse === null) loadBrowse(); }, [mode, browse, loadBrowse]);

  return (
    <div className="rounded-lg border border-red-500/20 bg-zinc-950/60 p-4 space-y-3">
      <div className="flex items-center gap-2 text-zinc-300">
        <Building2 className="w-4 h-4 text-red-400" />
        <p className="text-[12px]">
          You&apos;re not part of an agency yet. Create one to run a shared CAD board with
          your crew, or join one an existing chief invited you to.
        </p>
      </div>
      <div className="flex gap-1">
        {(['create', 'join', 'browse'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={cn('rounded px-2.5 py-1 text-[11px] font-semibold', mode === m ? 'bg-red-500/20 text-red-200' : 'text-zinc-400 hover:bg-zinc-800/60')}>
            {m === 'create' ? 'Create an agency' : m === 'join' ? 'Join by ID' : 'Browse open agencies'}
          </button>
        ))}
      </div>

      {mode === 'create' && (
        <div className="flex gap-2">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Riverside Fire &amp; EMS" />
          <button onClick={create} disabled={busy} className={cn(BTN, 'bg-red-600 text-white hover:bg-red-500 whitespace-nowrap')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
          </button>
        </div>
      )}

      {mode === 'join' && (
        <div className="flex gap-2">
          <input className={INPUT} value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="org_... (ask your chief for the ID)" />
          <button onClick={join} disabled={busy} className={cn(BTN, 'bg-blue-600 text-white hover:bg-blue-500 whitespace-nowrap')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Join as responder
          </button>
        </div>
      )}

      {mode === 'browse' && (
        <div className="space-y-1.5">
          {busy && browse === null && <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>}
          {browse !== null && browse.length === 0 && (
            <p className="text-[11px] text-zinc-500 py-2 text-center">No open agencies exist yet. Create the first one.</p>
          )}
          {(browse || []).map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
              <div>
                <div className="text-[11px] font-semibold text-white">{o.name}</div>
                <div className="text-[9px] text-zinc-500">{o.memberCount} member{o.memberCount === 1 ? '' : 's'} · <span className="font-mono">{o.id}</span></div>
              </div>
              <button onClick={() => { setJoinId(o.id); setMode('join'); }} className="text-[10px] text-red-300 hover:text-red-200 font-semibold">Join →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── mutual-aid sub-view ─────────────────────────── */

function MutualAidView({
  org, myEmsRole, myIncidents, myUnits, notify, reloadTick,
}: {
  org: OrgSummary; myEmsRole: EmsRole | null; myIncidents: Incident[]; myUnits: Unit[];
  notify: (f: Feedback) => void; reloadTick: number;
}) {
  const [data, setData] = useState<MutualAidListResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [targetOrgId, setTargetOrgId] = useState('');
  const [shareIncidentId, setShareIncidentId] = useState('');
  const [note, setNote] = useState('');
  const [commitUnit, setCommitUnit] = useState<Record<string, string>>({});

  const canWrite = myEmsRole === 'chief' || myEmsRole === 'supervisor' || myEmsRole === 'responder';
  const canToggleConsent = myEmsRole === 'chief' || myEmsRole === 'supervisor';

  const load = useCallback(async () => {
    try { setData(await run<MutualAidListResult>('mutual-aid-list', { orgId: org.id })); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  }, [org.id, notify]);

  useEffect(() => { load(); }, [load, reloadTick]);

  const availableUnits = myUnits.filter((u) => u.status === 'available');
  const openIncidents = myIncidents.filter((i) => i.status !== 'resolved' && i.status !== 'cancelled');

  const toggleConsent = async (enabled: boolean) => {
    setBusy(true);
    try {
      await run('agency-mutual-aid-consent', { orgId: org.id, enabled });
      notify({ kind: 'ok', text: enabled ? 'Now accepting mutual aid from other agencies.' : 'Mutual aid intake turned off.' });
      await load();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const share = async () => {
    if (!targetOrgId.trim() || !shareIncidentId) { notify({ kind: 'err', text: 'Pick a target agency and an incident.' }); return; }
    setBusy(true);
    try {
      await run('mutual-aid-share', { sourceOrgId: org.id, targetOrgId: targetOrgId.trim(), incidentId: shareIncidentId, note });
      notify({ kind: 'ok', text: 'Incident shared. The target agency sees it once they refresh.' });
      setTargetOrgId(''); setShareIncidentId(''); setNote('');
      await load();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const recall = async (shareId: string) => {
    setBusy(true);
    try { await run('mutual-aid-recall', { shareId }); notify({ kind: 'ok', text: 'Share recalled.' }); await load(); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const commit = async (shareId: string) => {
    const unitId = commitUnit[shareId];
    if (!unitId) { notify({ kind: 'err', text: 'Pick one of your own units to commit.' }); return; }
    setBusy(true);
    try {
      await run('mutual-aid-commit-unit', { shareId, unitId });
      notify({ kind: 'ok', text: 'Unit committed to the mutual-aid incident.' });
      await load();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  if (!data) {
    return <p className="text-[11px] text-zinc-500 flex items-center gap-1.5 py-4"><Loader2 className="w-3 h-3 animate-spin" /> Loading mutual aid…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-zinc-300">
          <Radio className="w-3.5 h-3.5 text-red-400" />
          Mutual-aid intake for this agency is{' '}
          <span className={data.mutualAidEnabled ? 'text-emerald-400 font-semibold' : 'text-zinc-500 font-semibold'}>
            {data.mutualAidEnabled ? 'ON — other agencies can share incidents with us' : 'OFF — other agencies cannot share incidents with us'}
          </span>
        </div>
        {canToggleConsent && (
          <button onClick={() => toggleConsent(!data.mutualAidEnabled)} disabled={busy}
            className={cn(BTN, data.mutualAidEnabled ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-emerald-600 text-white hover:bg-emerald-500')}>
            {data.mutualAidEnabled ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>

      {canWrite && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5"><Share2 className="w-3.5 h-3.5 text-red-400" /><span className={LABEL}>Share one of our open incidents with another agency</span></div>
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
            <select className={INPUT} value={shareIncidentId} onChange={(e) => setShareIncidentId(e.target.value)}>
              <option value="">Select an open incident…</option>
              {openIncidents.map((i) => <option key={i.id} value={i.id}>{i.summary} (P{i.priority})</option>)}
            </select>
            <input className={INPUT} value={targetOrgId} onChange={(e) => setTargetOrgId(e.target.value)} placeholder="Target agency org_id" />
            <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
          </div>
          <button onClick={share} disabled={busy} className={cn(BTN, 'bg-red-600 text-white hover:bg-red-500')}>
            <Share2 className="w-3.5 h-3.5" /> Share incident
          </button>
          {openIncidents.length === 0 && <p className="text-[9px] text-zinc-600">No open incidents on this agency&apos;s board to share yet.</p>}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5"><Share2 className="w-3.5 h-3.5 text-amber-400" /><span className={LABEL}>Shared by us ({data.sharedByUs.length})</span></div>
          {data.sharedByUs.length === 0 && <p className="text-[10px] text-zinc-500 py-2 text-center">We haven&apos;t requested mutual aid from anyone yet.</p>}
          <div className="space-y-1.5">
            {data.sharedByUs.map((r) => (
              <div key={r.id} className="rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-[10px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200 truncate">{r.incident?.summary ?? '(incident closed)'}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold', r.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700 text-zinc-400')}>{r.status}</span>
                </div>
                <div className="text-zinc-500 mt-0.5">→ {r.targetOrgName} · {r.committedUnits.length} unit{r.committedUnits.length === 1 ? '' : 's'} committed</div>
                {r.committedUnits.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {r.committedUnits.map((c) => <li key={c.unitId} className="text-emerald-300">✓ {c.unitName} ({c.unitKind})</li>)}
                  </ul>
                )}
                {r.status === 'active' && canWrite && (
                  <button onClick={() => recall(r.id)} disabled={busy} className="mt-1 flex items-center gap-1 text-[9px] text-zinc-500 hover:text-rose-400">
                    <Undo2 className="w-2.5 h-2.5" /> Recall
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5"><Siren className="w-3.5 h-3.5 text-rose-400" /><span className={LABEL}>Shared with us ({data.sharedWithUs.length})</span></div>
          {data.sharedWithUs.length === 0 && <p className="text-[10px] text-zinc-500 py-2 text-center">No agency has requested mutual aid from us yet.</p>}
          <div className="space-y-1.5">
            {data.sharedWithUs.map((r) => (
              <div key={r.id} className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1.5 text-[10px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-zinc-200 truncate">{r.incident?.summary ?? '(incident closed)'}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold', r.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700 text-zinc-400')}>{r.status}</span>
                </div>
                <div className="text-zinc-500 mt-0.5">from {r.sourceOrgName}{r.note ? ` — "${r.note}"` : ''}</div>
                {r.committedUnits.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {r.committedUnits.map((c) => <li key={c.unitId} className="text-emerald-300">✓ {c.unitName} ({c.unitKind})</li>)}
                  </ul>
                )}
                {r.status === 'active' && canWrite && (
                  <div className="mt-1 flex gap-1.5">
                    <select className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-[9px] text-white"
                      value={commitUnit[r.id] ?? ''} onChange={(e) => setCommitUnit((cur) => ({ ...cur, [r.id]: e.target.value }))}>
                      <option value="">Commit one of our units…</option>
                      {availableUnits.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.kind})</option>)}
                    </select>
                    <button onClick={() => commit(r.id)} disabled={busy || !commitUnit[r.id]} className={cn(BTN, 'bg-rose-600 text-white hover:bg-rose-500 text-[9px] px-2 py-0.5')}>
                      <Truck className="w-3 h-3" /> Commit
                    </button>
                  </div>
                )}
                {r.status === 'active' && availableUnits.length === 0 && canWrite && (
                  <p className="mt-1 text-[9px] text-zinc-600">No available units on our own roster to commit.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[9px] text-zinc-600 leading-relaxed">
        This is real cross-org visibility + real unit commitment inside Concord. It does not send
        an actual SMS page, radio call, or 911-console message to either agency — those require an
        external paging provider / RF hardware / CAD integration this deployment does not have.
      </p>
    </div>
  );
}

/* ───────────────────────── selected agency workspace ─────────────────────── */

function AgencyWorkspace({
  org, myUserId, notify, onLeft,
}: { org: OrgSummary; myUserId: string | null; notify: (f: Feedback) => void; onLeft: () => void }) {
  const [detail, setDetail] = useState<AgencyMembersResult | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [busy, setBusy] = useState(false);
  const [roleEdits, setRoleEdits] = useState<Record<string, EmsRole>>({});
  const [newSummary, setNewSummary] = useState('');
  const [newUnitName, setNewUnitName] = useState('');
  const [tab, setTab] = useState<'board' | 'mutual-aid'>('board');
  const [reloadTick, setReloadTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [m, i, u] = await Promise.all([
        run<AgencyMembersResult>('agency-members', { orgId: org.id }),
        run<{ incidents: Incident[] }>('incident-list', { orgId: org.id }),
        run<{ units: Unit[] }>('unit-list', { orgId: org.id }),
      ]);
      setDetail(m); setIncidents(i?.incidents || []); setUnits(u?.units || []);
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  }, [org.id, notify]);

  useEffect(() => { load(); }, [load]);

  const myEmsRole = detail?.myRole ?? null;
  const canWrite = myEmsRole === 'chief' || myEmsRole === 'supervisor' || myEmsRole === 'responder';
  const canManageRoles = myEmsRole === 'chief' || myEmsRole === 'supervisor';

  const applyRole = async (targetUserId: string) => {
    const role = roleEdits[targetUserId];
    if (!role) return;
    setBusy(true);
    try {
      await run('agency-set-role', { orgId: org.id, targetUserId, role });
      notify({ kind: 'ok', text: `Updated ${targetUserId} to ${EMS_ROLE_META[role].label}.` });
      await load();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const leave = async () => {
    setBusy(true);
    try {
      const r = await lensRun<{ ok: boolean }>('emergency-services', 'agency-leave', { orgId: org.id });
      if (!r.data?.ok) throw new Error(r.data?.error || 'agency-leave failed');
      notify({ kind: 'ok', text: `Left ${org.name}.` });
      onLeft();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const addIncident = async () => {
    if (!newSummary.trim()) { notify({ kind: 'err', text: 'Enter an incident summary.' }); return; }
    setBusy(true);
    try {
      await run('incident-create', { orgId: org.id, summary: newSummary });
      setNewSummary(''); await load(); setReloadTick((t) => t + 1);
      notify({ kind: 'ok', text: 'Incident logged for the agency.' });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const addUnit = async () => {
    if (!newUnitName.trim()) { notify({ kind: 'err', text: 'Enter a call-sign.' }); return; }
    setBusy(true);
    try {
      await run('unit-add', { orgId: org.id, name: newUnitName });
      setNewUnitName(''); await load(); setReloadTick((t) => t + 1);
      notify({ kind: 'ok', text: 'Unit added to the agency roster.' });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  if (!detail) {
    return <p className="text-[11px] text-zinc-500 flex items-center gap-1.5 py-4"><Loader2 className="w-3 h-3 animate-spin" /> Loading {org.name}…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-red-400" />
          <span className="text-[13px] font-semibold text-white">{detail.organization.name}</span>
          {myEmsRole && <RoleBadge role={myEmsRole} />}
        </div>
        {detail.myOrgRole !== 'leader' && (
          <button onClick={leave} disabled={busy} className={cn(BTN, 'text-zinc-500 hover:text-rose-400')}>
            <LogOut className="w-3.5 h-3.5" /> Leave
          </button>
        )}
      </div>

      {myEmsRole && (
        <p className="text-[10px] text-zinc-500 flex items-center gap-1.5">
          <Search className="w-3 h-3" /> Viewing as <strong className={EMS_ROLE_META[myEmsRole].tone.split(' ')[0]}>{EMS_ROLE_META[myEmsRole].label}</strong> — {EMS_ROLE_META[myEmsRole].desc}.
        </p>
      )}

      <div className="flex gap-1">
        {([['board', 'Incident board'], ['mutual-aid', 'Mutual aid']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('rounded px-2.5 py-1 text-[11px] font-semibold', tab === k ? 'bg-red-500/20 text-red-200' : 'text-zinc-400 hover:bg-zinc-800/60')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'board' && (
        <>
          <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5"><Users className="w-3.5 h-3.5 text-zinc-400" /><span className={LABEL}>Roster ({detail.members.length})</span></div>
            <div className="space-y-1">
              {detail.members.map((m) => {
                const isMe = m.userId === myUserId;
                const isLeader = m.role === 'leader';
                return (
                  <div key={m.userId} className="flex items-center justify-between gap-2 rounded bg-zinc-900/50 px-2 py-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-mono text-zinc-300 truncate">{m.userId}{isMe && <span className="text-red-400"> (you)</span>}</span>
                      <RoleBadge role={m.emsRole} />
                    </div>
                    {canManageRoles && !isLeader && !isMe && (
                      <div className="flex items-center gap-1 shrink-0">
                        <select
                          className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[9px] text-white"
                          value={roleEdits[m.userId] ?? m.emsRole}
                          onChange={(e) => setRoleEdits((cur) => ({ ...cur, [m.userId]: e.target.value as EmsRole }))}
                        >
                          <option value="supervisor">Supervisor</option>
                          <option value="responder">Responder</option>
                          <option value="trainee">Trainee</option>
                        </select>
                        <button onClick={() => applyRole(m.userId)} disabled={busy || (roleEdits[m.userId] ?? m.emsRole) === m.emsRole}
                          className="text-red-400 hover:text-red-300 disabled:text-zinc-700" aria-label={`Set ${m.userId} role`}>
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5"><Siren className="w-3.5 h-3.5 text-rose-400" /><span className={LABEL}>Agency incident board ({incidents.length})</span></div>
              {canWrite && (
                <div className="flex gap-1.5 mb-1.5">
                  <input className={INPUT} value={newSummary} onChange={(e) => setNewSummary(e.target.value)} placeholder="New incident summary" />
                  <button onClick={addIncident} disabled={busy} className={cn(BTN, 'bg-rose-600 text-white hover:bg-rose-500 whitespace-nowrap')}>
                    <Plus className="w-3.5 h-3.5" /> Log
                  </button>
                </div>
              )}
              {!canWrite && <p className="text-[9px] text-zinc-600 mb-1.5">Trainee view — read-only.</p>}
              {incidents.length === 0
                ? <p className="text-[10px] text-zinc-500 py-2 text-center">No incidents logged for this agency yet.</p>
                : <ul className="space-y-0.5">{incidents.slice(0, 8).map((i) => <li key={i.id} className="text-[10px] text-zinc-300">{i.summary} <span className="text-zinc-500">· {i.status}</span></li>)}</ul>}
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5">
              <div className="flex items-center gap-1.5 mb-1.5"><Truck className="w-3.5 h-3.5 text-emerald-400" /><span className={LABEL}>Unit roster ({units.length})</span></div>
              {canWrite && (
                <div className="flex gap-1.5 mb-1.5">
                  <input className={INPUT} value={newUnitName} onChange={(e) => setNewUnitName(e.target.value)} placeholder="New unit call-sign" />
                  <button onClick={addUnit} disabled={busy} className={cn(BTN, 'bg-emerald-600 text-white hover:bg-emerald-500 whitespace-nowrap')}>
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              )}
              {!canWrite && <p className="text-[9px] text-zinc-600 mb-1.5">Trainee view — read-only.</p>}
              {units.length === 0
                ? <p className="text-[10px] text-zinc-500 py-2 text-center">No units on this agency&apos;s roster yet.</p>
                : <ul className="space-y-0.5">{units.slice(0, 8).map((u) => <li key={u.id} className="text-[10px] text-zinc-300">{u.name} <span className="text-zinc-500">· {u.status}</span></li>)}</ul>}
            </div>
          </div>
        </>
      )}

      {tab === 'mutual-aid' && (
        <MutualAidView org={org} myEmsRole={myEmsRole} myIncidents={incidents} myUnits={units} notify={notify} reloadTick={reloadTick} />
      )}
    </div>
  );
}

/* ───────────────────────────── top-level export ───────────────────────── */

export function AgencyMutualAidPanel() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const notify = useCallback((f: Feedback) => {
    setFeedback(f);
    if (f) window.setTimeout(() => setFeedback((cur) => (cur === f ? null : cur)), 4500);
  }, []);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await run<{ organizations: OrgSummary[] }>('agency-mine');
      const list = res?.organizations || [];
      setOrgs(list);
      setSelectedId((cur) => (cur && list.some((o) => o.id === cur)) ? cur : (list[0]?.id ?? null));
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  }, [notify]);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const selected = orgs?.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="rounded-lg border border-red-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-red-500/10 pb-2">
        <Users className="h-4 w-4 text-red-400" />
        <h3 className="text-sm font-semibold text-white">Agency &amp; Mutual Aid</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Chief · Supervisor · Responder · Trainee
        </span>
      </header>

      {feedback && (
        <div className={cn('px-2.5 py-1.5 rounded text-[11px] flex items-center gap-2 border',
          feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            : 'bg-rose-500/10 text-rose-300 border-rose-500/30')}>
          {feedback.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {feedback.text}
        </div>
      )}

      {orgs === null && <p className="text-[11px] text-zinc-500 flex items-center gap-1.5 py-4"><Loader2 className="w-3 h-3 animate-spin" /> Loading your agencies…</p>}

      {orgs !== null && orgs.length === 0 && <CreateOrJoin notify={notify} onDone={loadOrgs} />}

      {orgs !== null && orgs.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className={cn(INPUT, 'max-w-xs')} value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.myEmsRole ? EMS_ROLE_META[o.myEmsRole].label : o.myRole})</option>)}
            </select>
            <button onClick={() => setSelectedId(null)} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline">
              + Create or join another
            </button>
          </div>
          {selected
            ? <AgencyWorkspace org={selected} myUserId={user?.id ?? null} notify={notify} onLeft={loadOrgs} />
            : <CreateOrJoin notify={notify} onDone={loadOrgs} />}
        </div>
      )}
    </div>
  );
}
