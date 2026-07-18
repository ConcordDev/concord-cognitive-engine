'use client';

/**
 * LabOrgPanel — multi-user lab roles/permissions (PI / tech / guest tiers).
 *
 * WAVE4_INVENTORY.md flagged "no multi-user lab roles/permissions" against
 * Benchling/LabWare LIMS as needing a new permissions layer. It doesn't —
 * Concord already has a generic organization/roster substrate
 * (server/lib/world-organizations.js, ORG_TYPES includes "lab"). This panel
 * is the frontend surface for the additive `lab.org-*` macros in
 * server/domains/lab.js, which reuse that substrate with a small tier map:
 *
 *   org role     lab tier   capability
 *   ──────────   ────────   ────────────────────────────────────────
 *   leader       pi         full edit incl. protocols + member mgmt
 *   officer      pi         (same)
 *   member       tech       edit notebook + inventory, NOT protocols
 *   apprentice   guest      read-only everywhere
 *
 * The capability table below MIRRORS that server-side mapping for
 * progressive disclosure (disabling a button a call would be refused for)
 * — it is never the actual security boundary. Every write still goes
 * through the real `lab.*` macro, which re-checks membership + role
 * server-side and returns an honest `{ ok:false, error }` on refusal.
 *
 * No fabricated members, counts, or org state — every value rendered here
 * comes from a real `lab.org-*` / `lab.notebook-*` / `lab.inventory-*`
 * macro response.
 */

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  FlaskConical, Users, Plus, LogIn, Notebook, Boxes, Loader2, AlertTriangle,
  Crown, Wrench, Eye, RefreshCw,
} from 'lucide-react';

const DOMAIN = 'lab';

type Tier = 'pi' | 'tech' | 'guest';

const TIER_CAPS: Record<Tier, { editNotebook: boolean; editInventory: boolean; editProtocols: boolean; manageMembers: boolean }> = {
  pi: { editNotebook: true, editInventory: true, editProtocols: true, manageMembers: true },
  tech: { editNotebook: true, editInventory: true, editProtocols: false, manageMembers: false },
  guest: { editNotebook: false, editInventory: false, editProtocols: false, manageMembers: false },
};

const TIER_LABEL: Record<Tier, string> = { pi: 'PI', tech: 'Tech', guest: 'Guest' };
const TIER_ICON: Record<Tier, typeof Crown> = { pi: Crown, tech: Wrench, guest: Eye };

interface LabOrgSummary {
  orgId: string; name: string; description: string; memberCount: number;
  orgRole: string; tier: Tier; createdAt: string;
}
interface RosterMember { userId: string; orgRole: string; tier: Tier; }
interface NbEntry {
  id: string; title: string; project: string; body: string; status: string;
  author: string; updatedAt: string;
}
interface Reagent {
  id: string; name: string; quantity: number; unit: string; addedBy: string;
  expiryStatus: string; lowStock: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(name: string, params: Record<string, unknown>): Promise<any> {
  const r = await lensRun(DOMAIN, name, params);
  if (r.data?.ok) return r.data.result;
  throw new Error(r.data?.error || `${name} failed`);
}

function ErrLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-red-400 flex items-center gap-1">
      <AlertTriangle className="w-3 h-3" /> {msg}
    </p>
  );
}

export function LabOrgPanel() {
  const [labs, setLabs] = useState<LabOrgSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [joinOrgId, setJoinOrgId] = useState('');

  const refreshLabs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await run('org-list-mine', {});
      const list: LabOrgSummary[] = res.labs || [];
      setLabs(list);
      setErr(null);
      setSelectedOrgId((prev) => {
        if (prev && list.some((l) => l.orgId === prev)) return prev;
        return list[0]?.orgId ?? null;
      });
    } catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
    finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshLabs(); }, []);

  const createLab = async () => {
    if (!newName.trim()) { setErr('lab name required'); return; }
    setBusy(true);
    try {
      await run('org-create', { name: newName, description: newDesc });
      setNewName(''); setNewDesc('');
      await refreshLabs();
    } catch (e) { setErr(e instanceof Error ? e.message : 'create failed'); }
    finally { setBusy(false); }
  };

  const joinLab = async () => {
    if (!joinOrgId.trim()) { setErr('lab org id required'); return; }
    setBusy(true);
    try {
      await run('org-join', { orgId: joinOrgId.trim() });
      setJoinOrgId('');
      await refreshLabs();
    } catch (e) { setErr(e instanceof Error ? e.message : 'join failed'); }
    finally { setBusy(false); }
  };

  const selected = labs.find((l) => l.orgId === selectedOrgId) || null;

  if (loading) {
    return (
      <div className="panel p-4 flex items-center gap-2 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading lab organizations…
      </div>
    );
  }

  return (
    <div className="panel p-0 overflow-hidden" data-testid="lab-org-panel">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.02]">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Users className="w-4 h-4 text-neon-purple" /> Multi-user Lab (PI / Tech / Guest)
        </h2>
        <button onClick={refreshLabs} className="btn-neon text-xs flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </div>

      <div className="p-4 space-y-4">
        <ErrLine msg={err} />

        {/* Lab selector, when the caller belongs to one or more labs */}
        {labs.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {labs.map((l) => {
              const Icon = TIER_ICON[l.tier];
              return (
                <button
                  key={l.orgId}
                  onClick={() => setSelectedOrgId(l.orgId)}
                  className={`lens-card !inline-flex items-center gap-2 px-3 py-1.5 text-xs ${
                    selectedOrgId === l.orgId ? 'border-neon-purple' : ''
                  }`}
                >
                  <FlaskConical className="w-3.5 h-3.5 text-neon-cyan" />
                  {l.name}
                  <span className="flex items-center gap-1 text-gray-400">
                    <Icon className="w-3 h-3" /> {TIER_LABEL[l.tier]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Honest empty state — no fabricated labs/members */}
        {labs.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-2">
            You&apos;re not a member of any lab organization yet. Create one or join an existing lab below.
          </p>
        )}

        {/* Create / Join */}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="lens-card space-y-2">
            <p className="text-xs font-medium text-gray-300 flex items-center gap-1"><Plus className="w-3 h-3" /> Create a lab</p>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Lab name (e.g. Genomics Core)"
              className="input-lattice text-sm w-full" />
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Description (optional)"
              className="input-lattice text-sm w-full" />
            <button onClick={createLab} disabled={busy} className="btn-neon cyan text-xs flex items-center gap-1 w-full justify-center">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create Lab (you become PI)
            </button>
          </div>
          <div className="lens-card space-y-2">
            <p className="text-xs font-medium text-gray-300 flex items-center gap-1"><LogIn className="w-3 h-3" /> Join a lab</p>
            <input value={joinOrgId} onChange={(e) => setJoinOrgId(e.target.value)} placeholder="Lab org id (ask your PI)"
              className="input-lattice text-sm w-full" />
            <button onClick={joinLab} disabled={busy} className="btn-neon text-xs flex items-center gap-1 w-full justify-center">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogIn className="w-3 h-3" />} Join (enters as Guest)
            </button>
          </div>
        </div>

        {selected && <LabOrgDetail lab={selected} onRosterChange={refreshLabs} />}
      </div>
    </div>
  );
}

/* ── Selected lab: roster + org-shared notebook/inventory ─────────────── */

function LabOrgDetail({ lab, onRosterChange }: { lab: LabOrgSummary; onRosterChange: () => void }) {
  const [tab, setTab] = useState<'roster' | 'notebook' | 'inventory'>('roster');
  const caps = TIER_CAPS[lab.tier];

  return (
    <div className="lens-card space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="font-medium text-sm">{lab.name}</p>
          <p className="text-xs text-gray-400">{lab.description || 'No description'} · {lab.memberCount} member(s) · you are {TIER_LABEL[lab.tier]}</p>
        </div>
        <div className="flex gap-1">
          {(['roster', 'notebook', 'inventory'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`btn-neon text-xs capitalize ${tab === t ? 'purple' : ''}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'roster' && <RosterTab orgId={lab.orgId} canManageMembers={caps.manageMembers} onChange={onRosterChange} />}
      {tab === 'notebook' && <OrgNotebookTab orgId={lab.orgId} canEdit={caps.editNotebook} />}
      {tab === 'inventory' && <OrgInventoryTab orgId={lab.orgId} canEdit={caps.editInventory} />}
    </div>
  );
}

/* ── Roster ─────────────────────────────────────────────────────────────── */

function RosterTab({ orgId, canManageMembers, onChange }: { orgId: string; canManageMembers: boolean; onChange: () => void }) {
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await run('org-members', { orgId });
      setMembers(res.members || []);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
  }, [orgId]);

  useEffect(() => { refresh(); }, [refresh]);

  const setTier = async (userId: string, tier: Tier) => {
    setBusy(userId);
    try {
      await run('org-set-role', { orgId, userId, tier });
      await refresh();
      onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : 'role change failed'); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-2">
      <ErrLine msg={err} />
      {members.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No roster data yet.</p>}
      {members.map((m) => {
        const Icon = TIER_ICON[m.tier];
        return (
          <div key={m.userId} className="flex items-center justify-between text-sm px-2 py-1.5 rounded bg-white/[0.02]">
            <span className="font-mono text-xs">{m.userId}</span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <Icon className="w-3 h-3" /> {TIER_LABEL[m.tier]}
              </span>
              {canManageMembers && m.orgRole !== 'leader' && (
                <select
                  value={m.tier}
                  disabled={busy === m.userId}
                  onChange={(e) => setTier(m.userId, e.target.value as Tier)}
                  className="input-lattice text-xs py-0.5"
                  aria-label={`Set role for ${m.userId}`}
                >
                  <option value="pi">PI</option>
                  <option value="tech">Tech</option>
                  <option value="guest">Guest</option>
                </select>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Org-shared notebook ────────────────────────────────────────────────── */

function OrgNotebookTab({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const [entries, setEntries] = useState<NbEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await run('notebook-list', { orgId });
      setEntries(res.entries || []);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
  }, [orgId]);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    if (!title.trim()) { setErr('entry title required'); return; }
    setBusy(true);
    try {
      await run('notebook-create', { orgId, title });
      setTitle('');
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'create failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400 flex items-center gap-1"><Notebook className="w-3 h-3" /> Shared with every lab member.</p>
      {canEdit ? (
        <div className="flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New shared entry title"
            className="input-lattice text-sm flex-1" />
          <button onClick={create} disabled={busy} className="btn-neon cyan text-xs flex items-center gap-1">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Read-only (guest tier) — a PI or tech can add entries.</p>
      )}
      <ErrLine msg={err} />
      <div className="space-y-1">
        {entries.length === 0 && <p className="text-xs text-gray-400 text-center py-3">No shared notebook entries yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-white/[0.02]">
            <span>{e.title}</span>
            <span className="text-gray-400">{e.author} · {e.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Org-shared inventory ───────────────────────────────────────────────── */

function OrgInventoryTab({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const [items, setItems] = useState<Reagent[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await run('inventory-list', { orgId });
      setItems(res.items || []);
      setErr(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'load failed'); }
  }, [orgId]);

  useEffect(() => { refresh(); }, [refresh]);

  const add = async () => {
    if (!name.trim()) { setErr('reagent name required'); return; }
    setBusy(true);
    try {
      await run('inventory-add', { orgId, name, quantity: Number(quantity) || 0 });
      setName(''); setQuantity('');
      await refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'add failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400 flex items-center gap-1"><Boxes className="w-3 h-3" /> Shared reagent/consumable inventory.</p>
      {canEdit ? (
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Reagent name"
            className="input-lattice text-sm flex-1" />
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qty" type="number"
            className="input-lattice text-sm w-20" />
          <button onClick={add} disabled={busy} className="btn-neon cyan text-xs flex items-center gap-1">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-500">Read-only (guest tier) — a PI or tech can add/consume reagents.</p>
      )}
      <ErrLine msg={err} />
      <div className="space-y-1">
        {items.length === 0 && <p className="text-xs text-gray-400 text-center py-3">No shared inventory yet.</p>}
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-white/[0.02]">
            <span>{it.name}</span>
            <span className={`text-gray-400 ${it.lowStock ? 'text-yellow-400' : ''}`}>{it.quantity} {it.unit} · added by {it.addedBy}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
