'use client';

/**
 * ConcordiaHUDPanels — single in-world HUD that covers every Concordia
 * subsystem. Concordia is ONE lens (/lenses/world); these panels are
 * the player's interface to all 16 phases of player-experience
 * substrate. No separate routes — everything is here.
 *
 * Tabs:
 *   Bloodline   — choose ancestry, see dilution-based combat multiplier
 *   Schemes     — propose, gather evidence, move, abandon player schemes
 *   Hooks       — satchel of physical evidence handles
 *   Jobs        — Tunyan job catalog, employment, shifts, rations
 *   Crafts      — multi-step authored chains (textile, food cycle, etc.)
 *   Dynasty     — house identity, renown, succession log
 *   Marriage    — active unions, propose, dissolve
 *   Realm       — exile status, opinion-driven access
 *   Council     — seasonal sessions, petitions, votes, lobby
 *   Calendar    — Tunyan 18-month + civic block clock
 *   Stamina     — current state, value, transitions
 *   Underwater  — nearby POIs (kelp / coral / wreck / trench)
 *
 * Opens via the C key, the toggle pill bottom-left, or the
 * `concordia:panel-toggle` CustomEvent. Tabbed surface keeps the
 * 3D world visible behind it.
 */

import { useCallback, useEffect, useState } from 'react';
import { BloodlineBadge } from '@/components/concordia/BloodlineBadge';

type TabId =
  | 'bloodline' | 'schemes' | 'hooks' | 'jobs' | 'crafts'
  | 'dynasty' | 'marriage' | 'realm' | 'council'
  | 'calendar' | 'stamina' | 'underwater';

const TAB_LABELS: Record<TabId, string> = {
  bloodline: 'Bloodline',
  schemes:   'Schemes',
  hooks:     'Hooks',
  jobs:      'Jobs',
  crafts:    'Crafts',
  dynasty:   'Dynasty',
  marriage:  'Marriage',
  realm:     'Realm',
  council:   'Council',
  calendar:  'Calendar',
  stamina:   'Stamina',
  underwater:'Underwater',
};

const TAB_ORDER: TabId[] = [
  'bloodline', 'schemes', 'hooks', 'jobs', 'crafts',
  'dynasty', 'marriage', 'realm', 'council',
  'calendar', 'stamina', 'underwater',
];

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

function readActiveWorldId(): string {
  if (typeof window === 'undefined') return 'concordia-hub';
  return window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub';
}

export function ConcordiaHUDPanels() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('bloodline');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onToggle(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab && (TAB_ORDER as string[]).includes(detail.tab)) setTab(detail.tab);
      setOpen((o) => detail?.force == null ? !o : !!detail.force);
    }
    function onKey(ev: KeyboardEvent) {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable)) return;
      if (ev.key === 'c' && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
        setOpen((o) => !o);
      } else if (ev.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('concordia:panel-toggle', onToggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('concordia:panel-toggle', onToggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open Concordia HUD"
      data-testid="concordia-hud-toggle"
      className="fixed left-4 bottom-24 z-30 bg-zinc-950/85 border border-zinc-700/60 rounded-full px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-900 backdrop-blur-md"
    >
      ☰ Concordia (C)
    </button>
  );

  return (
    <div
      className="fixed left-4 bottom-24 z-40 w-[30rem] max-h-[60vh] bg-zinc-950/95 border border-zinc-700/60 rounded-lg backdrop-blur-md flex flex-col"
      data-testid="concordia-hud-panels"
      role="dialog"
      aria-label="Concordia HUD"
    >
      <div className="flex items-center border-b border-zinc-800 overflow-x-auto">
        {TAB_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-label={`Open ${TAB_LABELS[t]} tab`}
            aria-pressed={tab === t}
            data-tab={t}
            className={`px-2.5 py-2 text-xs whitespace-nowrap ${tab === t ? 'bg-amber-900/40 text-amber-200 border-b-2 border-amber-500' : 'text-zinc-400 hover:bg-zinc-900'}`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close HUD"
          className="ml-auto px-3 py-2 text-xs text-zinc-500 hover:text-zinc-200"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {tab === 'bloodline'  && <BloodlinePanel />}
        {tab === 'schemes'    && <SchemesPanel />}
        {tab === 'hooks'      && <HooksPanel />}
        {tab === 'jobs'       && <JobsPanel />}
        {tab === 'crafts'     && <CraftsPanel />}
        {tab === 'dynasty'    && <DynastyPanel />}
        {tab === 'marriage'   && <MarriagePanel />}
        {tab === 'realm'      && <RealmPanel />}
        {tab === 'council'    && <CouncilPanel />}
        {tab === 'calendar'   && <CalendarPanel />}
        {tab === 'stamina'    && <StaminaPanel />}
        {tab === 'underwater' && <UnderwaterPanel />}
      </div>
    </div>
  );
}

// ─── BloodlinePanel ─────────────────────────────────────────────────────
function BloodlinePanel() {
  const [ancestry, setAncestry] = useState<{ primary_bloodline: string; dilution: number } | null>(null);
  const [known, setKnown] = useState<Array<{ id: string; elements: string[]; description: string }>>([]);
  const refresh = useCallback(async () => {
    const [a, k] = await Promise.all([macro('bloodline', 'get_ancestry'), macro('bloodline', 'list_known')]);
    if (a?.ok) setAncestry(a.ancestry);
    if (k?.ok) setKnown(k.bloodlines || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Current ancestry</h3>
      {ancestry ? (
        <div className="flex items-center gap-2 mb-3"><BloodlineBadge bloodline={ancestry.primary_bloodline} dilution={ancestry.dilution} /><span className="text-xs text-zinc-400">dilution {ancestry.dilution.toFixed(2)}</span></div>
      ) : (<p className="text-zinc-500 text-xs italic mb-3">No ancestry chosen. Pick one — it modulates elemental combat damage.</p>)}
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Bloodlines</h3>
      <ul className="space-y-1">
        {known.map((b) => (
          <li key={b.id} className="flex items-start justify-between gap-2 bg-zinc-900/50 border border-zinc-800 rounded p-2">
            <div className="flex-1 min-w-0"><BloodlineBadge bloodline={b.id} dilution={0.1} compact /><p className="mt-0.5 text-[10px] text-zinc-500 truncate">{b.description}</p></div>
            <button type="button" onClick={async () => { await macro('bloodline', 'choose', { bloodline: b.id, dilution: 0.2 }); refresh(); }} aria-label={`Choose ${b.id}`} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white shrink-0">choose</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── SchemesPanel ───────────────────────────────────────────────────────
function SchemesPanel() {
  const [mine, setMine] = useState<Array<{ id: string; kind: string; phase: string; target_id: string; evidence_count: number; success_pct: number; discovery_pct: number }>>([]);
  const [against, setAgainst] = useState<Array<{ id: string; kind: string; plotter_id: string; phase: string }>>([]);
  const refresh = useCallback(async () => {
    const [m, a] = await Promise.all([macro('schemes', 'list_for_user'), macro('schemes', 'list_against_user')]);
    if (m?.ok) setMine(m.schemes || []);
    if (a?.ok) setAgainst(a.schemes || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">My schemes ({mine.length})</h3>
      {mine.length === 0 ? <p className="text-zinc-500 text-xs italic mb-3">Nothing in motion.</p> : (
        <ul className="space-y-1 mb-3">
          {mine.map((s) => (
            <li key={s.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2 flex items-center gap-2">
              <span className="text-zinc-200">{s.kind}</span><span className="text-zinc-500">→ {s.target_id}</span>
              <span className="ml-auto text-amber-300/80">{s.phase}</span>
              <button type="button" onClick={async () => { await macro('schemes', 'discover_evidence', { schemeId: s.id }); refresh(); }} aria-label="Investigate" className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100">advance</button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Suspected against you ({against.length})</h3>
      {against.length === 0 ? <p className="text-zinc-500 text-xs italic">No schemes detected.</p> : (
        <ul className="space-y-1">
          {against.map((s) => (
            <li key={s.id} className="text-xs bg-zinc-900/50 border border-red-900/40 rounded p-2">
              <span className="text-red-300">{s.plotter_id}</span> plots <span className="text-zinc-200">{s.kind}</span>
              <span className="ml-2 text-red-300/80">{s.phase}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── HooksPanel ─────────────────────────────────────────────────────────
function HooksPanel() {
  const [hooks, setHooks] = useState<Array<{ id: string; label: string; secret_id: string | null; evidence_id: string | null }>>([]);
  const refresh = useCallback(async () => {
    const r = await macro('hooks', 'list', { worldId: readActiveWorldId() });
    if (r?.ok) setHooks(r.hooks || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Satchel ({hooks.length})</h3>
      {hooks.length === 0 ? <p className="text-zinc-500 text-xs italic">Empty. Gather evidence on schemes to drop hooks; pick them up off the ground.</p> : (
        <ul className="space-y-1">
          {hooks.map((h) => (
            <li key={h.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2 flex items-center gap-2">
              <span className="text-zinc-200 truncate flex-1">{h.label}</span>
              <button type="button" onClick={async () => { if (!window.confirm('Destroy hook?')) return; await macro('hooks', 'destroy', { hookId: h.id }); refresh(); }} aria-label="Destroy" className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/60 hover:bg-red-800 text-red-200">destroy</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── JobsPanel ──────────────────────────────────────────────────────────
function JobsPanel() {
  const [emp, setEmp] = useState<{ job_id: string | null; demographic_kind: string; shifts_completed: number } | null>(null);
  const [jobs, setJobs] = useState<Array<{ id: string; name: string; wage_sparks: number }>>([]);
  const [rations, setRations] = useState<Array<{ demographic_kind: string; monthly_sparks: number }>>([]);
  const refresh = useCallback(async () => {
    const [e, j, r] = await Promise.all([macro('jobs', 'my_employment'), macro('jobs', 'list'), macro('jobs', 'rations_table')]);
    if (e?.ok) setEmp(e.employment);
    if (j?.ok) setJobs(j.jobs || []);
    if (r?.ok) setRations(r.entitlements || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">My job</h3>
      {emp?.job_id ? (
        <div className="flex items-center justify-between mb-3 bg-zinc-900/50 border border-zinc-800 rounded p-2">
          <span className="text-zinc-200">{emp.job_id}</span><span className="text-xs text-zinc-500">{emp.shifts_completed} shifts</span>
          <button type="button" onClick={async () => { const r = await macro('jobs', 'complete_shift'); if (r?.ok) refresh(); }} aria-label="Complete shift" className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100">+shift</button>
        </div>
      ) : <p className="text-zinc-500 text-xs italic mb-3">Unemployed. Pick a job below.</p>}
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Open positions</h3>
      <ul className="space-y-1 mb-3">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center justify-between bg-zinc-900/50 border border-zinc-800 rounded p-2">
            <span className="text-xs text-zinc-200">{j.name}</span>
            <span className="text-xs text-amber-300 font-mono">{j.wage_sparks}</span>
            <button type="button" onClick={async () => { await macro('jobs', 'apply', { jobId: j.id }); refresh(); }} aria-label={`Apply for ${j.name}`} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white">apply</button>
          </li>
        ))}
      </ul>
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Ration floor</h3>
      <ul className="grid grid-cols-2 gap-1 text-[10px]">
        {rations.map((r) => (
          <li key={r.demographic_kind} className="bg-zinc-900/40 border border-zinc-800 rounded p-1.5 flex items-center justify-between">
            <span className="text-zinc-300">{r.demographic_kind}</span><span className="text-amber-300 font-mono">{r.monthly_sparks}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── CraftsPanel ────────────────────────────────────────────────────────
function CraftsPanel() {
  const [chains, setChains] = useState<Array<{ id: string; name: string; steps: unknown[] }>>([]);
  const [my, setMy] = useState<Array<{ id: string; chain_id: string; current_step: number; status: string }>>([]);
  const refresh = useCallback(async () => {
    const [c, m] = await Promise.all([macro('craft_chains', 'list', { worldId: readActiveWorldId() }), macro('craft_chains', 'my_jobs', { worldId: readActiveWorldId() })]);
    if (c?.ok) setChains(c.chains || []);
    if (m?.ok) setMy(m.jobs || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">In progress</h3>
      {my.length === 0 ? <p className="text-zinc-500 text-xs italic mb-3">Nothing in motion.</p> : (
        <ul className="space-y-1 mb-3">
          {my.map((j) => (
            <li key={j.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2">
              <span className="text-zinc-200">{j.chain_id}</span>
              <span className="ml-2 text-amber-300/80">step {j.current_step}</span>
              <span className="ml-2 text-zinc-500">{j.status}</span>
              <button type="button" onClick={async () => { await macro('craft_chains', 'advance', { jobId: j.id }); refresh(); }} aria-label="Advance step" className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100">+step</button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Available chains</h3>
      <ul className="space-y-1">
        {chains.map((c) => (
          <li key={c.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2 flex items-center gap-2">
            <span className="text-zinc-200">{c.name}</span><span className="text-zinc-500">({c.steps.length} steps)</span>
            <button type="button" onClick={async () => { await macro('craft_chains', 'start', { chainId: c.id, worldId: readActiveWorldId() }); refresh(); }} aria-label={`Start ${c.name}`} className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white">start</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── DynastyPanel ───────────────────────────────────────────────────────
function DynastyPanel() {
  const [dyn, setDyn] = useState<{ id: string; house_name: string; renown: number; generations: number; current_head_user_id: string } | null>(null);
  const [log, setLog] = useState<Array<{ id: number; predecessor_user_id: string; heir_user_id: string; cause: string | null }>>([]);
  const [houseName, setHouseName] = useState('');
  const refresh = useCallback(async () => {
    const r = await macro('dynasty', 'mine');
    if (r?.ok && r.dynasty) {
      setDyn(r.dynasty);
      const lg = await macro('dynasty', 'log', { dynastyId: r.dynasty.id });
      if (lg?.ok) setLog(lg.takeovers || []);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!dyn) return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Found a house</h3>
      <p className="text-xs text-zinc-400 mb-2">Your dynasty survives individual avatars. Pick a name.</p>
      <input value={houseName} onChange={(e) => setHouseName(e.target.value)} aria-label="House name" placeholder="House name…" className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs w-full mb-2" />
      <button type="button" onClick={async () => { if (!houseName.trim()) return; await macro('dynasty', 'found', { houseName: houseName.trim() }); refresh(); }} aria-label="Found house" className="text-xs px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white">Found</button>
    </div>
  );
  return (
    <div className="text-sm">
      <h3 className="text-base font-bold text-zinc-100 mb-2">{dyn.house_name}</h3>
      <dl className="grid grid-cols-2 gap-1 text-xs mb-3">
        <dt className="text-zinc-500">Head</dt><dd className="text-zinc-200 font-mono truncate">{dyn.current_head_user_id}</dd>
        <dt className="text-zinc-500">Renown</dt><dd className="text-amber-300">{dyn.renown} / 1000</dd>
        <dt className="text-zinc-500">Generation</dt><dd className="text-zinc-200">{dyn.generations}</dd>
      </dl>
      {log.length > 0 && (
        <>
          <h4 className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Succession</h4>
          <ul className="space-y-1">
            {log.map((t) => (
              <li key={t.id} className="text-[10px] text-zinc-300 bg-zinc-900/50 border border-zinc-800 rounded p-1.5">
                <span className="font-mono truncate">{t.predecessor_user_id}</span> → <span className="font-mono text-emerald-300 truncate">{t.heir_user_id}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── MarriagePanel ──────────────────────────────────────────────────────
function MarriagePanel() {
  const [mar, setMar] = useState<Array<{ id: string; partner_a_kind: string; partner_a_id: string; partner_b_kind: string; partner_b_id: string }>>([]);
  const [pid, setPid] = useState('');
  const refresh = useCallback(async () => {
    const r = await macro('marriage', 'list_mine');
    if (r?.ok) setMar(r.marriages || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Active unions</h3>
      {mar.length === 0 ? <p className="text-zinc-500 text-xs italic mb-3">No marriages.</p> : (
        <ul className="space-y-1 mb-3">
          {mar.map((m) => (
            <li key={m.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2 flex items-center gap-2">
              <span className="text-zinc-200 truncate flex-1">{m.partner_a_id} ⨯ {m.partner_b_id}</span>
              <button type="button" onClick={async () => { if (!window.confirm('Dissolve?')) return; await macro('marriage', 'dissolve', { marriageId: m.id, reason: 'divorced' }); refresh(); }} aria-label="Dissolve" className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/60 hover:bg-red-800 text-red-200">divorce</button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Propose to NPC</h3>
      <div className="flex gap-2">
        <input value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Partner NPC id" placeholder="npc_id…" className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs flex-1" />
        <button type="button" onClick={async () => { if (!pid.trim()) return; await macro('marriage', 'marry', { partnerKind: 'npc', partnerId: pid.trim() }); setPid(''); refresh(); }} aria-label="Propose" className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white">propose</button>
      </div>
    </div>
  );
}

// ─── RealmPanel ─────────────────────────────────────────────────────────
function RealmPanel() {
  const [exiles, setExiles] = useState<Array<{ realm_id: string; reason: string; expires_at: number | null }>>([]);
  const refresh = useCallback(async () => {
    const r = await macro('realm_access', 'list_my_exiles');
    if (r?.ok) setExiles(r.exiles || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">My exiles</h3>
      {exiles.length === 0 ? <p className="text-zinc-500 text-xs italic">Welcome everywhere. No active exiles.</p> : (
        <ul className="space-y-1">
          {exiles.map((e) => (
            <li key={e.realm_id} className="text-xs bg-zinc-900/50 border border-red-900/40 rounded p-2">
              <span className="text-red-300">{e.realm_id}</span>
              <span className="ml-2 text-zinc-500">{e.reason}</span>
              {e.expires_at && <span className="ml-2 text-zinc-600">expires {new Date(e.expires_at * 1000).toLocaleDateString()}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── CouncilPanel ───────────────────────────────────────────────────────
function CouncilPanel() {
  const [sessions, setSessions] = useState<Array<{ id: string; realm_id: string; season_id: number; year: number }>>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [petitions, setPetitions] = useState<Array<{ id: string; topic: string; resolution: string | null }>>([]);
  const [topic, setTopic] = useState('');
  const refresh = useCallback(async () => {
    const r = await macro('realm_council', 'open_sessions');
    if (r?.ok) setSessions(r.sessions || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!activeSession) return;
    void (async () => {
      const r = await macro('realm_council', 'list_petitions', { sessionId: activeSession });
      if (r?.ok) setPetitions(r.petitions || []);
    })();
  }, [activeSession]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Open sessions</h3>
      {sessions.length === 0 ? <p className="text-zinc-500 text-xs italic">No councils in session.</p> : (
        <ul className="space-y-1 mb-3">
          {sessions.map((s) => (
            <li key={s.id} className={`text-xs border rounded p-2 cursor-pointer ${activeSession === s.id ? 'bg-amber-950/50 border-amber-700' : 'bg-zinc-900/50 border-zinc-800'}`} onClick={() => setActiveSession(s.id)}>
              <span className="text-zinc-200">{s.realm_id}</span>
              <span className="ml-2 text-zinc-500">season {s.season_id} · year {s.year}</span>
            </li>
          ))}
        </ul>
      )}
      {activeSession && (
        <>
          <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Petitions ({petitions.length})</h3>
          {petitions.length === 0 ? <p className="text-zinc-500 text-xs italic mb-2">None yet.</p> : (
            <ul className="space-y-1 mb-3">
              {petitions.map((p) => (
                <li key={p.id} className="text-xs bg-zinc-900/50 border border-zinc-800 rounded p-2">
                  <span className="text-zinc-200">{p.topic}</span>
                  {p.resolution && <span className="ml-2 text-amber-300/80">{p.resolution}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Petition topic" placeholder="petition topic…" className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs flex-1" />
            <button type="button" onClick={async () => { if (!topic.trim()) return; await macro('realm_council', 'submit_petition', { sessionId: activeSession, topic: topic.trim() }); setTopic(''); const r = await macro('realm_council', 'list_petitions', { sessionId: activeSession }); if (r?.ok) setPetitions(r.petitions || []); }} aria-label="Submit petition" className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white">submit</button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── CalendarPanel ──────────────────────────────────────────────────────
function CalendarPanel() {
  const [months, setMonths] = useState<Array<{ index: number; name: string; days: number; seasonIndex: number }>>([]);
  const [civic, setCivic] = useState<Array<{ idx: number; range: string; label: string }>>([]);
  const [yearDay, setYearDay] = useState(0);
  const refresh = useCallback(async () => {
    const [m, c] = await Promise.all([macro('tunyan', 'months'), macro('tunyan', 'civic_blocks')]);
    if (m?.ok) setMonths(m.months || []);
    if (c?.ok) setCivic(c.blocks || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const currentMonth = months.find((m) => m.index === Math.floor(yearDay / 2.33) + 1);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Tunyan 18-month ledger</h3>
      <label className="block mb-2">
        <span className="text-xs text-zinc-400">Year-day</span>
        <input type="range" min="0" max="41" value={yearDay} onChange={(e) => setYearDay(Number(e.target.value))} aria-label="Year day" className="ml-2 w-48" />
        <span className="ml-2 text-xs font-mono text-zinc-300">{yearDay}</span>
      </label>
      {currentMonth && <p className="text-xs text-amber-300 mb-2">Currently: <strong>{currentMonth.name}</strong> (season {currentMonth.seasonIndex})</p>}
      <ul className="grid grid-cols-3 gap-1 text-[10px] mb-3">
        {months.map((m) => (
          <li key={m.index} className={`border rounded p-1 ${currentMonth?.index === m.index ? 'bg-amber-950/40 border-amber-700' : 'bg-zinc-900/40 border-zinc-800'}`}>
            <span className="text-zinc-300">{m.name}</span><span className="ml-1 text-zinc-500">·{m.days}d</span>
          </li>
        ))}
      </ul>
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Civic clock</h3>
      <ul className="grid grid-cols-2 gap-1 text-[10px]">
        {civic.map((b) => (
          <li key={b.idx} className="bg-zinc-900/40 border border-zinc-800 rounded p-1">
            <span className="text-zinc-300 font-mono">{b.range}</span>
            <span className="ml-1 text-zinc-500">{b.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── StaminaPanel ───────────────────────────────────────────────────────
function StaminaPanel() {
  const [s, setS] = useState<{ value: number; max_value: number; state: string } | null>(null);
  const refresh = useCallback(async () => {
    const r = await macro('stamina', 'get', { worldId: readActiveWorldId() });
    if (r?.ok) setS(r.stamina);
  }, []);
  useEffect(() => { void refresh(); const id = window.setInterval(refresh, 4000); return () => window.clearInterval(id); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Current</h3>
      {!s ? <p className="text-zinc-500 text-xs italic">Loading…</p> : (
        <>
          <p className="text-xs text-zinc-300 mb-2">{Math.round(s.value)} / {s.max_value} · <span className="text-amber-300">{s.state}</span></p>
          <div className="flex gap-1 flex-wrap">
            {['rest', 'climbing', 'sprinting', 'swimming'].map((st) => (
              <button key={st} type="button" onClick={async () => { await macro('stamina', st === 'rest' ? 'release' : `start_${st === 'climbing' ? 'climb' : st === 'sprinting' ? 'sprint' : 'swim'}`, { worldId: readActiveWorldId() }); refresh(); }} aria-label={`Set ${st}`} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">{st}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── UnderwaterPanel ────────────────────────────────────────────────────
function UnderwaterPanel() {
  const [feats, setFeats] = useState<Array<{ id: string; kind: string; name: string; depth_min_m: number; depth_max_m: number; aggression: number }>>([]);
  const refresh = useCallback(async () => {
    const r = await macro('underwater', 'list_features', { worldId: readActiveWorldId() });
    if (r?.ok) setFeats(r.features || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">POIs in this world</h3>
      {feats.length === 0 ? <p className="text-zinc-500 text-xs italic">No authored underwater features.</p> : (
        <ul className="space-y-1">
          {feats.map((f) => (
            <li key={f.id} className={`text-xs border rounded p-2 ${f.aggression >= 2 ? 'bg-red-950/30 border-red-900/60' : f.aggression >= 1 ? 'bg-amber-950/30 border-amber-900/60' : 'bg-zinc-900/50 border-zinc-800'}`}>
              <span className="text-zinc-200">{f.name}</span>
              <span className="ml-2 text-zinc-500">{f.kind}</span>
              <span className="ml-2 text-[10px] text-zinc-600">depth {f.depth_min_m}–{f.depth_max_m}m</span>
              {f.aggression > 0 && <span className="ml-2 text-red-400">★ {f.aggression}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
