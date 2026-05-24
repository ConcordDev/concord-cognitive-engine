'use client';

/**
 * WarPanel — campaign HUD. Three tabs:
 *
 *   Active     — list of active campaigns in this world
 *   Declare    — ruler-only form to open a new campaign
 *   Manage     — full state of one campaign (troops, skirmishes, kidnaps)
 *
 * Mounted in PanelHost via panelId='war'. Players use it from the
 * RulerOverlay's "Declare war" button (declare path) or the
 * Active-wars list when a war touches their realm.
 */

import { useCallback, useEffect, useState } from 'react';
import { useHUDContext } from '../HUDContextProvider';

interface Campaign {
  id: string;
  world_id: string;
  attacker_realm_id: string;
  defender_realm_id: string;
  target_territory: string;
  state: string;
  attacker_morale: number;
  defender_morale: number;
  attacker_troops: number;
  defender_troops: number;
  casus_belli: string;
  declared_at: number;
  outcome: string | null;
}

interface Skirmish {
  id: string;
  attacker_losses: number;
  defender_losses: number;
  morale_swing: number;
  summary: string;
  occurred_at: number;
}

interface Kidnap {
  id: string;
  victim_id: string;
  ransom_cc: number;
  captor_id: string;
}

interface CampaignFull extends Campaign {
  troops: Array<{ side: string; participant_kind: string; participant_id: string; role: string; hp: number; departed_at: number | null }>;
  recentSkirmishes: Skirmish[];
  activeKidnaps: Kidnap[];
}

type Tab = 'active' | 'declare' | 'manage';

function macroCall<T = unknown>(domain: string, name: string, input: unknown): Promise<T> {
  return fetch('/api/lens/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).then((r) => r.json());
}

function fmtAgo(epochS: number): string {
  const dt = Math.floor(Date.now() / 1000) - epochS;
  if (dt < 60) return `${dt}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
  return `${Math.floor(dt / 86400)}d ago`;
}

function moraleTone(m: number): string {
  if (m >= 70) return 'text-emerald-300';
  if (m >= 40) return 'text-amber-300';
  return 'text-red-300';
}

function stateChip(state: string): string {
  switch (state) {
    case 'mustering':  return 'bg-zinc-800 text-zinc-300';
    case 'marching':   return 'bg-amber-900/50 text-amber-200';
    case 'engaging':   return 'bg-red-900/60 text-red-200 animate-pulse';
    case 'occupying':  return 'bg-emerald-900/60 text-emerald-200';
    case 'won':        return 'bg-emerald-900 text-emerald-100';
    case 'lost':       return 'bg-red-900 text-red-100';
    case 'truced':     return 'bg-zinc-700 text-zinc-200';
    default:           return 'bg-zinc-900 text-zinc-400';
  }
}

export function WarPanel() {
  const worldId = useHUDContext((s) => s.worldId);
  const myRealm = useHUDContext((s) => s.myRealm);
  const [tab, setTab] = useState<Tab>('active');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [active, setActive] = useState<CampaignFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Declare-form state
  const [defenderRealmId, setDefenderRealmId] = useState('');
  const [targetTerritory, setTargetTerritory] = useState('');
  const [casusBelli, setCasusBelli] = useState('expansion');

  const fetchActive = useCallback(async () => {
    setLoading(true);
    try {
      const r = await macroCall<{ ok: boolean; result?: { campaigns: Campaign[] } }>('war', 'active', { worldId });
      if (r?.ok && r.result?.campaigns) setCampaigns(r.result.campaigns);
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  const fetchOne = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const r = await macroCall<{ ok: boolean; result?: { campaign: CampaignFull } }>('war', 'get_campaign', { campaignId: id });
      if (r?.ok && r.result?.campaign) {
        setActive(r.result.campaign);
        setTab('manage');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === 'active') fetchActive(); }, [tab, fetchActive]);

  // Poll active campaign every 10s while open.
  useEffect(() => {
    if (tab !== 'manage' || !active?.id) return;
    const id = setInterval(() => fetchOne(active.id), 10000);
    return () => clearInterval(id);
  }, [tab, active?.id, fetchOne]);

  async function declareWar() {
    if (!myRealm) { setStatus('You must rule a realm.'); return; }
    if (!defenderRealmId || !targetTerritory) { setStatus('All fields required.'); return; }
    setStatus('Declaring…');
    const r = await macroCall<{ ok: boolean; result?: { ok: boolean; campaignId?: string; reason?: string } }>('war', 'declare', {
      attackerRealmId: myRealm.id,
      defenderRealmId,
      targetTerritory,
      casusBelli,
    });
    const inner = r?.result;
    if (inner?.ok && inner.campaignId) {
      setStatus(`War declared. Campaign ${inner.campaignId.slice(0, 14)}…`);
      setDefenderRealmId(''); setTargetTerritory('');
      fetchOne(inner.campaignId);
    } else {
      setStatus(`Failed: ${inner?.reason || 'unknown'}`);
    }
    setTimeout(() => setStatus(null), 6000);
  }

  async function rallyTo(side: 'attacker' | 'defender') {
    if (!active) return;
    const r = await macroCall<{ ok: boolean; result?: { ok: boolean; reason?: string } }>('war', 'rally', {
      campaignId: active.id,
      side,
    });
    if (r?.result?.ok) {
      setStatus(`Rallied to ${side}.`);
      fetchOne(active.id);
    } else {
      setStatus(`Failed: ${r?.result?.reason || 'unknown'}`);
    }
    setTimeout(() => setStatus(null), 4000);
  }

  async function payRansom(kidnapId: string) {
    const r = await macroCall<{ ok: boolean; result?: { ok: boolean; ransomCc?: number } }>('war', 'pay_ransom', { kidnapId });
    if (r?.result?.ok) {
      setStatus(`Ransom paid (${r.result.ransomCc} CC). Captive released.`);
      if (active) fetchOne(active.id);
    } else {
      setStatus('Ransom failed.');
    }
    setTimeout(() => setStatus(null), 4000);
  }

  async function seekTruce() {
    if (!active) return;
    const r = await macroCall<{ ok: boolean; result?: { ok: boolean; reason?: string } }>('war', 'seek_truce', { campaignId: active.id });
    if (r?.result?.ok) {
      setStatus('Truce signed. All kidnaps released.');
      fetchOne(active.id);
    } else {
      setStatus(`Truce failed: ${r?.result?.reason || 'unknown'}`);
    }
    setTimeout(() => setStatus(null), 4000);
  }

  return (
    <div className="text-sm" data-testid="war-panel">
      <p className="text-xs text-zinc-400 mb-2">
        Realm-scale war in <span className="font-bold text-amber-200">{worldId}</span>. Skirmishes resolve every ~2 min while active.
      </p>

      <div className="flex gap-1 mb-3 border-b border-zinc-800">
        {(['active', 'declare', 'manage'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-tab={t}
            aria-pressed={tab === t}
            className={`px-3 py-1 text-xs font-medium rounded-t ${
              tab === t ? 'bg-zinc-800 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t === 'active' ? 'Active wars' : t === 'declare' ? 'Declare' : 'Manage'}
          </button>
        ))}
      </div>

      {status && (
        <div role="status" aria-live="polite" className="mb-2 bg-amber-950/50 border border-amber-700/50 text-amber-200 px-3 py-1.5 rounded text-xs">{status}</div>
      )}

      {tab === 'active' && (
        <div className="space-y-2 max-h-[24rem] overflow-auto">
          {loading && <p className="text-xs text-zinc-500">Loading…</p>}
          {!loading && campaigns.length === 0 && (
            <p className="text-xs text-zinc-500 italic">No active campaigns in this world.</p>
          )}
          {campaigns.map((c) => (
            <div
              key={c.id}
              data-campaign-id={c.id}
              className="p-2 rounded border bg-zinc-900/40 border-zinc-800 hover:bg-zinc-900 cursor-pointer"
              onClick={() => fetchOne(c.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-medium text-zinc-100">{c.attacker_realm_id} → {c.defender_realm_id}</span>
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${stateChip(c.state)}`}>{c.state}</span>
              </div>
              <p className="text-[10px] text-zinc-500">target: <span className="font-mono text-amber-200">{c.target_territory}</span> · {c.casus_belli} · {fmtAgo(c.declared_at)}</p>
              <p className="mt-1 text-[10px] font-mono text-zinc-400">
                <span className={moraleTone(c.attacker_morale)}>A:{c.attacker_troops}t/{c.attacker_morale}m</span>
                {' · '}
                <span className={moraleTone(c.defender_morale)}>D:{c.defender_troops}t/{c.defender_morale}m</span>
              </p>
            </div>
          ))}
        </div>
      )}

      {tab === 'declare' && (
        <div className="space-y-2">
          {!myRealm && (
            <p className="text-xs text-red-300">You must rule a realm to declare war.</p>
          )}
          {myRealm && (
            <>
              <p className="text-[10px] text-zinc-500">Declaring on behalf of <span className="font-mono text-amber-200">{myRealm.name}</span>.</p>
              <label className="block">
                <span className="block text-[10px] text-zinc-500 mb-0.5">Target realm id</span>
                <input
                  type="text" value={defenderRealmId}
                  onChange={(e) => setDefenderRealmId(e.target.value)}
                  aria-label="Defender realm id"
                  placeholder="realm_aekon"
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] text-zinc-500 mb-0.5">Target territory</span>
                <input
                  type="text" value={targetTerritory}
                  onChange={(e) => setTargetTerritory(e.target.value)}
                  aria-label="Target territory"
                  placeholder="aekon_capital"
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] text-zinc-500 mb-0.5">Casus belli</span>
                <select
                  value={casusBelli} onChange={(e) => setCasusBelli(e.target.value)}
                  aria-label="Casus belli"
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1 text-xs"
                >
                  <option value="expansion">Expansion</option>
                  <option value="reclamation">Reclamation</option>
                  <option value="vendetta">Vendetta</option>
                  <option value="religious">Religious</option>
                  <option value="resource">Resource</option>
                </select>
              </label>
              <button
                type="button" onClick={declareWar}
                aria-label="Declare war"
                className="w-full text-xs px-3 py-1.5 rounded bg-red-800 hover:bg-red-700 text-white font-medium"
              >
                Declare war
              </button>
            </>
          )}
        </div>
      )}

      {tab === 'manage' && (
        <div className="space-y-2 max-h-[24rem] overflow-auto">
          {!active && (
            <p className="text-xs text-zinc-500 italic">Select an active campaign first.</p>
          )}
          {active && (
            <>
              <div className="p-2 rounded border bg-zinc-900/40 border-amber-700/40">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-200">{active.attacker_realm_id} → {active.defender_realm_id}</span>
                  <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${stateChip(active.state)}`}>{active.state}</span>
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">target: <span className="font-mono text-amber-200">{active.target_territory}</span></p>
                <p className="mt-1 text-[10px] font-mono">
                  <span className={moraleTone(active.attacker_morale)}>Attacker: {active.attacker_troops} troops / {active.attacker_morale} morale</span>
                </p>
                <p className="text-[10px] font-mono">
                  <span className={moraleTone(active.defender_morale)}>Defender: {active.defender_troops} troops / {active.defender_morale} morale</span>
                </p>
                <div className="flex gap-1 mt-2">
                  <button type="button" onClick={() => rallyTo('attacker')} aria-label="Rally attacker"
                    className="flex-1 text-[10px] px-2 py-1 rounded bg-amber-800 hover:bg-amber-700 text-white">Rally → Attacker</button>
                  <button type="button" onClick={() => rallyTo('defender')} aria-label="Rally defender"
                    className="flex-1 text-[10px] px-2 py-1 rounded bg-indigo-800 hover:bg-indigo-700 text-white">Rally → Defender</button>
                  <button type="button" onClick={seekTruce} aria-label="Seek truce"
                    className="text-[10px] px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200">Truce</button>
                </div>
              </div>

              {active.activeKidnaps?.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-red-300 mb-1">Captives</p>
                  {active.activeKidnaps.map((k) => (
                    <div key={k.id} data-kidnap-id={k.id} className="flex items-center justify-between p-1.5 rounded bg-red-950/40 border border-red-800/50 mb-1">
                      <span className="text-[10px] font-mono text-red-200">{k.victim_id}</span>
                      <button type="button" onClick={() => payRansom(k.id)} aria-label={`Pay ransom ${k.id}`}
                        className="text-[10px] px-2 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white">
                        Ransom {k.ransom_cc} CC
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {active.recentSkirmishes?.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Skirmishes</p>
                  {active.recentSkirmishes.slice(0, 6).map((s) => (
                    <div key={s.id} className="text-[10px] text-zinc-300 mb-0.5">
                      <span className="font-mono text-zinc-500">{fmtAgo(s.occurred_at)}</span> {s.summary}
                      <span className="ml-1 font-mono text-zinc-500">(−{s.attacker_losses}/−{s.defender_losses})</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
