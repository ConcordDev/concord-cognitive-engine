'use client';

/**
 * HUDContextProvider — single Zustand-backed store for the 5-layer
 * dynamic HUD. Aggregates 12 signals (player position, nearby targets,
 * stamina, oxygen, pain, refusal-field strength, active substrate,
 * realm context, mode, expertise score). Each layer reads only the
 * slices it needs; nothing polls macros from inside layers.
 *
 * The store is refreshed by:
 *   - rAF 12 Hz tick (matches NPCActivityTag's projector cadence)
 *   - Socket events forwarded via window CustomEvents (concordia:*)
 *   - One-shot macro pulls on mode change (e.g., entering dialogue)
 *
 * Design references (see the plan file):
 *   - RDR2's "knows when to pipe down" → mode-aware filtering
 *   - BotW's contextual prompts → proximity-based
 *   - AdaptiveComplexity → expertise score gates HUD density
 */

import { useEffect, useRef } from 'react';
import { create } from 'zustand';

export type InputMode = 'exploration' | 'combat' | 'dialogue' | 'vehicle' | 'photo' | 'creation' | 'spectator' | 'lens_work';
export type ExpertiseLevel = 'newcomer' | 'standard' | 'detailed' | 'engineering';

export interface NearbyTarget {
  id: string;
  kind: 'npc' | 'vehicle' | 'hook' | 'quest_trigger' | 'council_member' | 'marriage_candidate';
  label: string;
  distance: number;
  npcId?: string;
  vehicleId?: string;
  hookId?: string;
}

export interface ActiveSchemeBadge {
  id: string;
  kind: string;
  phase: string;
}
export interface ActiveCraftBadge {
  id: string;
  chain_id: string;
  current_step: number;
}

export interface RulerRealm {
  id: string;
  name: string;
  world_id: string;
  faction_id: string | null;
  legitimacy: number;
  treasury: number;
  tax_rate: number;
  capital_settlement_id: string | null;
}
export interface RulerLoyaltySummary {
  citizen_count: number;
  avg_loyalty: number;
}
export interface RulerDecreeBadge {
  id: string;
  kind: string;
  popularity_delta: number;
  issued_at: number;
  expires_at: number | null;
}
export interface RulerThreat {
  kind: string;        // 'rebellion' | 'faction_war' | 'scheme'
  source: string;      // npcId / factionId
  severity: number;    // 0..1
}

export interface HUDContextState {
  // Player & mode
  inputMode: InputMode;
  playerPosition: { x: number; y: number; z: number };
  worldId: string;

  // Vital signals
  staminaState: 'rest' | 'climbing' | 'sprinting' | 'swimming' | 'exhausted';
  staminaValue: number;
  staminaMax: number;
  healthPct: number;
  oxygenPct: number;
  depthM: number;
  painBudget: number;          // count of unprocessed pain_signals
  refusalCompoundStrength: number;

  // Proximity
  nearbyTargets: NearbyTarget[];

  // Active substrate
  activeSchemes: ActiveSchemeBadge[];
  activeCraftJobs: ActiveCraftBadge[];
  hasPendingHeir: boolean;

  // Kingdom — populated only if player is current ruler of a realm
  rulerOfRealmId: string | null;
  myRealm: RulerRealm | null;
  realmLoyalty: RulerLoyaltySummary | null;
  realmRebellionRisk: number;   // 0..1
  activeDecrees: RulerDecreeBadge[];
  pendingThreats: RulerThreat[];

  // Realm + calendar
  currentRealmId: string | null;
  exiledFromCurrentRealm: boolean;
  openCouncilSessionId: string | null;
  tunyanMonthName: string;
  tunyanMonthIndex: number;
  civicBlockLabel: string;
  festivalActive: string | null;

  // Adaptation
  expertiseLevel: ExpertiseLevel;

  // Actions
  setMode: (mode: InputMode) => void;
  setPlayerPosition: (pos: { x: number; y: number; z: number }) => void;
  setWorldId: (id: string) => void;
  setStamina: (state: HUDContextState['staminaState'], value: number, max: number) => void;
  setHealth: (pct: number) => void;
  setOxygen: (pct: number, depth: number) => void;
  setPainBudget: (n: number) => void;
  setRefusalStrength: (n: number) => void;
  setNearby: (targets: NearbyTarget[]) => void;
  setActiveSchemes: (s: ActiveSchemeBadge[]) => void;
  setActiveCrafts: (c: ActiveCraftBadge[]) => void;
  setPendingHeir: (b: boolean) => void;
  setRealmContext: (realmId: string | null, exiled: boolean, sessionId: string | null) => void;
  setCalendar: (monthName: string, monthIndex: number, civic: string, festival: string | null) => void;
  setExpertise: (lvl: ExpertiseLevel) => void;
  setRulerState: (snapshot: {
    rulerOfRealmId: string | null;
    myRealm: RulerRealm | null;
    realmLoyalty: RulerLoyaltySummary | null;
    realmRebellionRisk: number;
    activeDecrees: RulerDecreeBadge[];
    pendingThreats: RulerThreat[];
  }) => void;
}

export const useHUDContext = create<HUDContextState>((set) => ({
  inputMode: 'exploration',
  playerPosition: { x: 0, y: 0, z: 0 },
  worldId: 'concordia-hub',

  staminaState: 'rest',
  staminaValue: 100,
  staminaMax: 100,
  healthPct: 100,
  oxygenPct: 100,
  depthM: 0,
  painBudget: 0,
  refusalCompoundStrength: 0,

  nearbyTargets: [],

  activeSchemes: [],
  activeCraftJobs: [],
  hasPendingHeir: false,

  rulerOfRealmId: null,
  myRealm: null,
  realmLoyalty: null,
  realmRebellionRisk: 0,
  activeDecrees: [],
  pendingThreats: [],

  currentRealmId: null,
  exiledFromCurrentRealm: false,
  openCouncilSessionId: null,
  tunyanMonthName: 'Arbor',
  tunyanMonthIndex: 1,
  civicBlockLabel: 'morning open',
  festivalActive: null,

  expertiseLevel: 'standard',

  setMode: (mode) => set({ inputMode: mode }),
  setPlayerPosition: (pos) => set({ playerPosition: pos }),
  setWorldId: (id) => set({ worldId: id }),
  setStamina: (state, value, max) => set({ staminaState: state, staminaValue: value, staminaMax: max }),
  setHealth: (pct) => set({ healthPct: Math.max(0, Math.min(100, pct)) }),
  setOxygen: (pct, depth) => set({ oxygenPct: Math.max(0, Math.min(100, pct)), depthM: depth }),
  setPainBudget: (n) => set({ painBudget: Math.max(0, n) }),
  setRefusalStrength: (n) => set({ refusalCompoundStrength: Math.max(0, Math.min(9, n)) }),
  setNearby: (targets) => set({ nearbyTargets: targets }),
  setActiveSchemes: (s) => set({ activeSchemes: s }),
  setActiveCrafts: (c) => set({ activeCraftJobs: c }),
  setPendingHeir: (b) => set({ hasPendingHeir: b }),
  setRealmContext: (realmId, exiled, sessionId) => set({ currentRealmId: realmId, exiledFromCurrentRealm: exiled, openCouncilSessionId: sessionId }),
  setCalendar: (monthName, monthIndex, civic, festival) => set({ tunyanMonthName: monthName, tunyanMonthIndex: monthIndex, civicBlockLabel: civic, festivalActive: festival }),
  setExpertise: (lvl) => set({ expertiseLevel: lvl }),
  setRulerState: (snapshot) => set(snapshot),
}));

/**
 * Mount once at the world-lens root. Subscribes to:
 *   - Socket-forwarded window CustomEvents (concordia:*, scheme:*, refusal:*)
 *   - 12 Hz rAF tick that pulls active substrate via macros (throttled)
 *   - localStorage for current world id
 *
 * No-op render; pure side-effects. Layers consume `useHUDContext()`.
 */
async function macroCall(domain: string, name: string, input: Record<string, unknown> = {}) {
  try {
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, name, input }),
    });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

const PROXIMITY_RADIUS_M = 4;
const POLL_INTERVAL_MS = 6000;

export function HUDContextProvider() {
  const setWorldId = useHUDContext((s) => s.setWorldId);
  const setActiveSchemes = useHUDContext((s) => s.setActiveSchemes);
  const setActiveCrafts = useHUDContext((s) => s.setActiveCrafts);
  const setStamina = useHUDContext((s) => s.setStamina);
  const setOxygen = useHUDContext((s) => s.setOxygen);
  const setRealmContext = useHUDContext((s) => s.setRealmContext);
  const setCalendar = useHUDContext((s) => s.setCalendar);
  const setRefusalStrength = useHUDContext((s) => s.setRefusalStrength);
  const pollRef = useRef<number | null>(null);

  // Bootstrap worldId from localStorage and listen for changes.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const wid = window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub';
    setWorldId(wid);
    function onStorage(e: StorageEvent) {
      if (e.key === 'concordia:activeWorldId' && e.newValue) setWorldId(e.newValue);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [setWorldId]);

  // Socket-forwarded refusal field event (already in useSocket forwarders).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onRefusal(e: Event) {
      const d = (e as CustomEvent).detail as { strength?: number } | undefined;
      if (d?.strength != null) setRefusalStrength(d.strength);
    }
    window.addEventListener('world:refusal-field', onRefusal);
    window.addEventListener('refusal:compound', onRefusal);
    return () => {
      window.removeEventListener('world:refusal-field', onRefusal);
      window.removeEventListener('refusal:compound', onRefusal);
    };
  }, [setRefusalStrength]);

  // Periodic poll of substrate macros that aren't socket-pushed yet.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    async function poll() {
      const worldId = useHUDContext.getState().worldId;
      const [sch, crafts, stam, months, realm] = await Promise.all([
        macroCall('schemes', 'list_for_user'),
        macroCall('craft_chains', 'my_jobs', { worldId }),
        macroCall('stamina', 'get', { worldId }),
        macroCall('tunyan', 'current_month', { yearDay: Math.floor(Date.now() / 1000 / 86400) % 42 }),
        macroCall('kingdoms', 'my_realm'),
      ]);
      if (sch?.ok) setActiveSchemes(sch.schemes || []);
      if (crafts?.ok) setActiveCrafts(crafts.jobs || []);
      if (stam?.ok && stam.stamina) setStamina(stam.stamina.state, stam.stamina.value, stam.stamina.max_value);
      if (months?.ok && months.monthName) setCalendar(months.monthName, months.monthIndex, '5sun-7sun morning', null);
      // Kingdom slice — null if player rules nothing.
      if (realm?.ok) {
        if (realm.realm) {
          const r = realm.realm;
          const rebellions = realm.rebellions || [];
          const threats: RulerThreat[] = rebellions.map((reb: { leader_npc_id?: string; score?: number }) => ({
            kind: 'rebellion',
            source: reb.leader_npc_id || 'unknown',
            severity: Math.max(0, Math.min(1, Number(reb.score) || 0)),
          }));
          useHUDContext.getState().setRulerState({
            rulerOfRealmId: r.id,
            myRealm: {
              id: r.id, name: r.name, world_id: r.world_id, faction_id: r.faction_id,
              legitimacy: r.legitimacy, treasury: r.treasury, tax_rate: r.tax_rate,
              capital_settlement_id: r.capital_settlement_id,
            },
            realmLoyalty: realm.loyalty || null,
            realmRebellionRisk: typeof realm.rebellionRisk === 'number' ? realm.rebellionRisk : (realm.rebellionRisk?.score ?? 0),
            activeDecrees: realm.activeDecrees || [],
            pendingThreats: threats,
          });
        } else {
          useHUDContext.getState().setRulerState({
            rulerOfRealmId: null, myRealm: null, realmLoyalty: null,
            realmRebellionRisk: 0, activeDecrees: [], pendingThreats: [],
          });
        }
      }
    }
    void poll();
    pollRef.current = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [setActiveSchemes, setActiveCrafts, setStamina, setCalendar]);

  // Proximity tick — reads nearby NPCs from existing world state via a
  // CustomEvent that AvatarSystem3D / NpcPerceptionBridge dispatch.
  // For Phase 1 we just listen to `concordia:proximity-update`.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onProximity(e: Event) {
      const d = (e as CustomEvent).detail as { targets?: NearbyTarget[] } | undefined;
      if (Array.isArray(d?.targets)) useHUDContext.getState().setNearby(d.targets);
    }
    window.addEventListener('concordia:proximity-update', onProximity);
    return () => window.removeEventListener('concordia:proximity-update', onProximity);
  }, []);

  // Realm context — pulled when player changes worlds or every 30s.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    async function pull() {
      const exiles = await macroCall('realm_access', 'list_my_exiles');
      if (cancelled) return;
      if (exiles?.ok) {
        const wid = useHUDContext.getState().worldId;
        const match = (exiles.exiles || []).find((x: { realm_id: string }) => x.realm_id === wid);
        setRealmContext(wid, !!match, null);
      }
    }
    void pull();
    const id = window.setInterval(pull, 30000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [setRealmContext]);

  // Initial dispatch — also reset oxygen when not underwater so UI hides.
  useEffect(() => {
    setOxygen(100, 0);
  }, [setOxygen]);

  return null;
}

export const HUD_CONTEXT_CONSTANTS = Object.freeze({
  PROXIMITY_RADIUS_M,
  POLL_INTERVAL_MS,
});
