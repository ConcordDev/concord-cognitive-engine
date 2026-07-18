'use client';

/**
 * OrgCollabPanel — role-based collaboration (planner / buyer / analyst).
 *
 * WAVE4_INVENTORY.md flagged "no role-based collaboration (planner/buyer/
 * analyst views)" against the SAP IBP benchmark and deferred it as needing
 * new substrate. It doesn't: `server/lib/world-organizations.js` already
 * has a real org/roster/role primitive (createOrganization / joinOrganization
 * / setMemberRole / getOrgMembers). This panel is the frontend surface for
 * the additive `supplychain.org*` macros that reuse it (see
 * server/domains/supplychain.js). SC role is DERIVED from the org's own
 * 4-tier role ladder:
 *   leader / officer -> planner  (full read+write: demand/inventory/work-orders/network)
 *   member            -> buyer   (read+write: suppliers/shipments/purchasing)
 *   apprentice        -> analyst (read-only across every view)
 *
 * Every number here comes from a real `supplychain.org*` / `shipmentList` /
 * `workOrderList` macro call scoped by `orgId`. No mock rosters, no fake
 * member counts — an org with zero members beyond its creator shows exactly
 * one row, and a firm with no shared shipments/work orders yet shows the
 * same honest empty state Control Tower shows for a brand-new personal
 * workspace.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Building2, Users, UserPlus, Crown, ShieldCheck, Eye, LogOut,
  Loader2, Plus, Check, AlertTriangle, Search, Ship, ClipboardList,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

/* ──────────────────────────── types ─────────────────────────────────── */

type ScRole = 'planner' | 'buyer' | 'analyst';
type OrgRole = 'leader' | 'officer' | 'member' | 'apprentice';

interface OrgSummary {
  id: string; name: string; type: string; leaderId: string;
  memberCount: number; myRole?: OrgRole; myScRole?: ScRole;
}
interface OrgMember { userId: string; role: OrgRole; scRole: ScRole }
interface OrgMembersResult {
  organization: OrgSummary; members: OrgMember[]; myRole: ScRole | null; myOrgRole: OrgRole;
}
interface ShipmentSummary { inTransit: number; delivered: number; delayed: number; shipments: { id: string; reference: string }[] }
interface WorkOrderSummary { openValue: number; overdueCount: number; workOrders: { id: string; poNumber: string; stage: string }[] }

type Feedback = { kind: 'ok' | 'err'; text: string } | null;

/* ─────────────────────────── macro helper ────────────────────────────── */

async function run<T>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('supplychain', action, input);
  if (!r.data?.ok) throw new Error(r.data?.error || `${action} failed`);
  return r.data.result;
}

const INPUT = 'w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white';
const LABEL = 'text-[9px] uppercase tracking-wider text-zinc-400 font-semibold';
const BTN = 'flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const SC_ROLE_META: Record<ScRole, { label: string; desc: string; icon: typeof Crown; tone: string }> = {
  planner: { label: 'Planner', desc: 'Full read+write — demand, inventory, work orders, network', icon: Crown, tone: 'text-amber-300 bg-amber-500/15 border-amber-500/30' },
  buyer: { label: 'Buyer', desc: 'Read+write — suppliers, shipments, purchasing; read elsewhere', icon: ShieldCheck, tone: 'text-blue-300 bg-blue-500/15 border-blue-500/30' },
  analyst: { label: 'Analyst', desc: 'Read-only — every dashboard and forecast', icon: Eye, tone: 'text-zinc-300 bg-zinc-700/30 border-zinc-600/40' },
};

function RoleBadge({ role }: { role: ScRole }) {
  const meta = SC_ROLE_META[role];
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide', meta.tone)}>
      <Icon className="w-2.5 h-2.5" /> {meta.label}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
      <div className={LABEL}>{label}</div>
      <div className={cn('text-lg font-bold', tone || 'text-white')}>{value}</div>
    </div>
  );
}

/* ────────────────────── create / join (no-org state) ─────────────────── */

function CreateOrJoin({ notify, onDone }: { notify: (f: Feedback) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'create' | 'join' | 'browse'>('create');
  const [name, setName] = useState('');
  const [type, setType] = useState<'firm' | 'department'>('firm');
  const [joinId, setJoinId] = useState('');
  const [browse, setBrowse] = useState<OrgSummary[] | null>(null);

  const create = async () => {
    if (!name.trim()) { notify({ kind: 'err', text: 'Enter a firm name.' }); return; }
    setBusy(true);
    try {
      await run('orgCreate', { name, type });
      setName('');
      notify({ kind: 'ok', text: `${type === 'firm' ? 'Firm' : 'Department'} created — you are its planner.` });
      onDone();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const join = async () => {
    if (!joinId.trim()) { notify({ kind: 'err', text: 'Enter an org ID to join.' }); return; }
    setBusy(true);
    try {
      const res = await run<{ role: OrgRole; scRole: ScRole }>('orgJoin', { orgId: joinId.trim() });
      notify({ kind: 'ok', text: `Joined as ${res ? SC_ROLE_META[res.scRole].label : 'a member'}.` });
      setJoinId('');
      onDone();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const loadBrowse = useCallback(async () => {
    setBusy(true);
    try { setBrowse((await run<{ organizations: OrgSummary[] }>('orgList', { limit: 25 }))?.organizations || []); }
    catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
    finally { setBusy(false); }
  }, [notify]);

  useEffect(() => { if (mode === 'browse' && browse === null) loadBrowse(); }, [mode, browse, loadBrowse]);

  return (
    <div className="rounded-lg border border-teal-500/20 bg-zinc-950/60 p-4 space-y-3">
      <div className="flex items-center gap-2 text-zinc-300">
        <Building2 className="w-4 h-4 text-teal-400" />
        <p className="text-[12px]">
          You&apos;re not part of a supply-chain team yet. Create a firm to plan with teammates,
          or join one an existing planner invited you to.
        </p>
      </div>
      <div className="flex gap-1">
        {(['create', 'join', 'browse'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={cn('rounded px-2.5 py-1 text-[11px] font-semibold', mode === m ? 'bg-teal-500/20 text-teal-200' : 'text-zinc-400 hover:bg-zinc-800/60')}>
            {m === 'create' ? 'Create a firm' : m === 'join' ? 'Join by ID' : 'Browse open firms'}
          </button>
        ))}
      </div>

      {mode === 'create' && (
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2"><div className={LABEL}>Firm name</div>
            <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meridian Logistics" />
          </div>
          <div><div className={LABEL}>Type</div>
            <select className={INPUT} value={type} onChange={(e) => setType(e.target.value as 'firm' | 'department')}>
              <option value="firm">Firm</option>
              <option value="department">Department</option>
            </select>
          </div>
          <button onClick={create} disabled={busy} className={cn(BTN, 'bg-teal-600 text-white hover:bg-teal-500 self-end justify-center')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
          </button>
        </div>
      )}

      {mode === 'join' && (
        <div className="flex gap-2">
          <input className={INPUT} value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="org_... (ask your planner for the ID)" />
          <button onClick={join} disabled={busy} className={cn(BTN, 'bg-blue-600 text-white hover:bg-blue-500 whitespace-nowrap')}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Join as buyer
          </button>
        </div>
      )}

      {mode === 'browse' && (
        <div className="space-y-1.5">
          {busy && browse === null && <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</p>}
          {browse !== null && browse.length === 0 && (
            <p className="text-[11px] text-zinc-500 py-2 text-center">No open firms or departments exist yet. Create the first one.</p>
          )}
          {(browse || []).map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
              <div>
                <div className="text-[11px] font-semibold text-white">{o.name}</div>
                <div className="text-[9px] text-zinc-500">{o.type} · {o.memberCount} member{o.memberCount === 1 ? '' : 's'} · <span className="font-mono">{o.id}</span></div>
              </div>
              <button onClick={() => { setJoinId(o.id); setMode('join'); }} className="text-[10px] text-teal-300 hover:text-teal-200 font-semibold">Join →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── selected org workspace ─────────────────────── */

function OrgWorkspace({
  org, myUserId, notify, onLeft,
}: { org: OrgSummary; myUserId: string | null; notify: (f: Feedback) => void; onLeft: () => void }) {
  const [detail, setDetail] = useState<OrgMembersResult | null>(null);
  const [shipments, setShipments] = useState<ShipmentSummary | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrderSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [roleEdits, setRoleEdits] = useState<Record<string, ScRole>>({});
  const [newRef, setNewRef] = useState('');
  const [newPo, setNewPo] = useState('');

  const load = useCallback(async () => {
    try {
      const [m, s, w] = await Promise.all([
        run<OrgMembersResult>('orgMembers', { orgId: org.id }),
        run<ShipmentSummary>('shipmentList', { orgId: org.id }),
        run<WorkOrderSummary>('workOrderList', { orgId: org.id }),
      ]);
      setDetail(m); setShipments(s); setWorkOrders(w);
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  }, [org.id, notify]);

  useEffect(() => { load(); }, [load]);

  const myScRole = detail?.myRole ?? null;
  const canWritePlanner = myScRole === 'planner';
  const canWriteBuyer = myScRole === 'planner' || myScRole === 'buyer';

  const applyRole = async (targetUserId: string) => {
    const role = roleEdits[targetUserId];
    if (!role) return;
    setBusy(true);
    try {
      await run('orgSetRole', { orgId: org.id, targetUserId, role });
      notify({ kind: 'ok', text: `Updated ${targetUserId} to ${SC_ROLE_META[role].label}.` });
      await load();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const leave = async () => {
    setBusy(true);
    try {
      const r = await lensRun<{ ok: boolean }>('supplychain', 'orgLeave', { orgId: org.id });
      if (!r.data?.ok) throw new Error(r.data?.error || 'orgLeave failed');
      notify({ kind: 'ok', text: `Left ${org.name}.` });
      onLeft();
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const addShipment = async () => {
    if (!newRef.trim()) { notify({ kind: 'err', text: 'Enter a reference.' }); return; }
    setBusy(true);
    try {
      await run('shipmentCreate', { orgId: org.id, reference: newRef });
      setNewRef(''); await load();
      notify({ kind: 'ok', text: 'Shipment booked for the team.' });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  const addWorkOrder = async () => {
    if (!newPo.trim()) { notify({ kind: 'err', text: 'Enter an item name.' }); return; }
    setBusy(true);
    try {
      await run('workOrderCreate', { orgId: org.id, item: newPo });
      setNewPo(''); await load();
      notify({ kind: 'ok', text: 'Work order raised for the team.' });
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); } finally { setBusy(false); }
  };

  if (!detail) {
    return <p className="text-[11px] text-zinc-500 flex items-center gap-1.5 py-4"><Loader2 className="w-3 h-3 animate-spin" /> Loading {org.name}…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-teal-400" />
          <span className="text-[13px] font-semibold text-white">{detail.organization.name}</span>
          <span className="text-[9px] text-zinc-500 uppercase">{detail.organization.type}</span>
          {myScRole && <RoleBadge role={myScRole} />}
        </div>
        {detail.myOrgRole !== 'leader' && (
          <button onClick={leave} disabled={busy} className={cn(BTN, 'text-zinc-500 hover:text-rose-400')}>
            <LogOut className="w-3.5 h-3.5" /> Leave
          </button>
        )}
      </div>

      {myScRole && (
        <p className="text-[10px] text-zinc-500 flex items-center gap-1.5">
          <Search className="w-3 h-3" /> Viewing as <strong className={SC_ROLE_META[myScRole].tone.split(' ')[0]}>{SC_ROLE_META[myScRole].label}</strong> — {SC_ROLE_META[myScRole].desc}.
        </p>
      )}

      {/* Roster */}
      <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5">
        <div className="flex items-center gap-1.5 mb-1.5"><Users className="w-3.5 h-3.5 text-zinc-400" /><span className={LABEL}>Roster ({detail.members.length})</span></div>
        <div className="space-y-1">
          {detail.members.map((m) => {
            const isMe = m.userId === myUserId;
            const isLeader = m.role === 'leader';
            return (
              <div key={m.userId} className="flex items-center justify-between gap-2 rounded bg-zinc-900/50 px-2 py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-mono text-zinc-300 truncate">{m.userId}{isMe && <span className="text-teal-400"> (you)</span>}</span>
                  <RoleBadge role={m.scRole} />
                </div>
                {canWritePlanner && !isLeader && !isMe && (
                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[9px] text-white"
                      value={roleEdits[m.userId] ?? m.scRole}
                      onChange={(e) => setRoleEdits((cur) => ({ ...cur, [m.userId]: e.target.value as ScRole }))}
                    >
                      <option value="planner">Planner</option>
                      <option value="buyer">Buyer</option>
                      <option value="analyst">Analyst</option>
                    </select>
                    <button onClick={() => applyRole(m.userId)} disabled={busy || (roleEdits[m.userId] ?? m.scRole) === m.scRole}
                      className="text-teal-400 hover:text-teal-300 disabled:text-zinc-700" aria-label={`Set ${m.userId} role`}>
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Shared workspace summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Stat label="In transit" value={shipments?.inTransit ?? 0} tone="text-blue-300" />
        <Stat label="Delivered" value={shipments?.delivered ?? 0} tone="text-emerald-300" />
        <Stat label="Delayed" value={shipments?.delayed ?? 0} tone="text-rose-300" />
        <Stat label="Open PO value" value={workOrders ? `$${Math.round(workOrders.openValue).toLocaleString()}` : '$0'} />
        <Stat label="Overdue POs" value={workOrders?.overdueCount ?? 0} tone={(workOrders?.overdueCount ?? 0) > 0 ? 'text-rose-300' : undefined} />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5"><Ship className="w-3.5 h-3.5 text-blue-400" /><span className={LABEL}>Team shipments</span></div>
          {canWriteBuyer && (
            <div className="flex gap-1.5 mb-1.5">
              <input className={INPUT} value={newRef} onChange={(e) => setNewRef(e.target.value)} placeholder="New shipment reference" />
              <button onClick={addShipment} disabled={busy} className={cn(BTN, 'bg-blue-600 text-white hover:bg-blue-500 whitespace-nowrap')}>
                <Plus className="w-3.5 h-3.5" /> Book
              </button>
            </div>
          )}
          {!canWriteBuyer && <p className="text-[9px] text-zinc-600 mb-1.5">Analyst view — read-only.</p>}
          {(shipments?.shipments.length ?? 0) === 0
            ? <p className="text-[10px] text-zinc-500 py-2 text-center">No shared shipments yet.</p>
            : <ul className="space-y-0.5">{shipments!.shipments.slice(0, 8).map((s) => <li key={s.id} className="text-[10px] text-zinc-300 font-mono">{s.reference}</li>)}</ul>}
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-2.5">
          <div className="flex items-center gap-1.5 mb-1.5"><ClipboardList className="w-3.5 h-3.5 text-amber-400" /><span className={LABEL}>Team work orders</span></div>
          {canWritePlanner && (
            <div className="flex gap-1.5 mb-1.5">
              <input className={INPUT} value={newPo} onChange={(e) => setNewPo(e.target.value)} placeholder="New PO item" />
              <button onClick={addWorkOrder} disabled={busy} className={cn(BTN, 'bg-amber-600 text-white hover:bg-amber-500 whitespace-nowrap')}>
                <Plus className="w-3.5 h-3.5" /> Raise PO
              </button>
            </div>
          )}
          {!canWritePlanner && <p className="text-[9px] text-zinc-600 mb-1.5">{myScRole === 'buyer' ? 'Buyer view — work orders are planner-only.' : 'Analyst view — read-only.'}</p>}
          {(workOrders?.workOrders.length ?? 0) === 0
            ? <p className="text-[10px] text-zinc-500 py-2 text-center">No shared work orders yet.</p>
            : <ul className="space-y-0.5">{workOrders!.workOrders.slice(0, 8).map((w) => <li key={w.id} className="text-[10px] text-zinc-300 font-mono">{w.poNumber} · {w.stage}</li>)}</ul>}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── top-level export ───────────────────────── */

export function OrgCollabPanel() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<OrgSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const notify = useCallback((f: Feedback) => {
    setFeedback(f);
    if (f) window.setTimeout(() => setFeedback((cur) => (cur === f ? null : cur)), 4000);
  }, []);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await run<{ organizations: OrgSummary[] }>('orgMine');
      const list = res?.organizations || [];
      setOrgs(list);
      setSelectedId((cur) => (cur && list.some((o) => o.id === cur)) ? cur : (list[0]?.id ?? null));
    } catch (e) { notify({ kind: 'err', text: (e as Error).message }); }
  }, [notify]);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const selected = orgs?.find((o) => o.id === selectedId) ?? null;

  return (
    <div className="rounded-lg border border-teal-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-teal-500/10 pb-2">
        <Users className="h-4 w-4 text-teal-400" />
        <h3 className="text-sm font-semibold text-white">Team Collaboration</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          Planner · Buyer · Analyst
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

      {orgs === null && <p className="text-[11px] text-zinc-500 flex items-center gap-1.5 py-4"><Loader2 className="w-3 h-3 animate-spin" /> Loading your teams…</p>}

      {orgs !== null && orgs.length === 0 && <CreateOrJoin notify={notify} onDone={loadOrgs} />}

      {orgs !== null && orgs.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <select className={cn(INPUT, 'max-w-xs')} value={selectedId ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.myScRole ? SC_ROLE_META[o.myScRole].label : o.myRole})</option>)}
            </select>
            <button onClick={() => setSelectedId(null)} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline">
              + Create or join another
            </button>
          </div>
          {selected
            ? <OrgWorkspace org={selected} myUserId={user?.id ?? null} notify={notify} onLeft={loadOrgs} />
            : <CreateOrJoin notify={notify} onDone={loadOrgs} />}
        </div>
      )}
    </div>
  );
}
