'use client';

// Wave 4 gap-closure — Dungeon instance HUD.
//
// server/lib/dungeon-instance.js is a real, working phase-gated boss engine
// (HP% phase thresholds, per-member damage accounting, loot-by-damage-share,
// lockouts) that had ZERO frontend consumer — no component called any
// `dungeon.*` macro (docs/concordia-specs/runmodes-endgame-social-capability-map.md
// §2.5). This HUD is that consumer.
//
// Every number shown here — boss hp/phase, each participant's damage_dealt,
// loot share — comes straight from a `dungeon.*` macro response
// (server/domains/dungeon.js). The only client-chosen number is the attack
// roll offered by the "Strike" button (an honest dice-roll input, same shape
// as a player picking an attack), and the server is authoritative: this pass
// also closed `dungeon.hit`'s previously-unbounded damage report — it now
// REJECTS any report above the shared combat ceiling
// (server/lib/combat-limits.js#resolvedDamageCap) instead of trusting it, so
// this HUD's roll is deliberately kept well under that cap.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Skull, Swords, X, Trophy, HeartCrack } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';

// ── Backend shapes (verified against server/domains/dungeon.js + lib/dungeon-instance.js) ──
//
// lensRun('dungeon', 'encounters', {})
//   → { ok, encounters: [{ id, name, baseHp, phases:[{name,atHpPct,mechanic}], lockoutH }] }
// lensRun('dungeon', 'active', { worldId })
//   → { ok, instance: Instance | null }
// lensRun('dungeon', 'lockouts', {})
//   → { ok, lockouts: [{ encounterId, tier, lockedUntil }] }
// lensRun('dungeon', 'open', { worldId, encounterId, tier })
//   → { ok, instanceId, boss:{name,hp,maxHp,phase}, roster } | { ok:false, reason }
// lensRun('dungeon', 'hit', { instanceId, damage })
//   → { ok, bossHp, bossMaxHp, hpPct, phaseIdx, phaseName, phaseAdvanced, cleared }
//     | { ok:false, reason:'damage_cap_exceeded', cap, requested }
// lensRun('dungeon', 'down', { instanceId }) → { ok, wiped, alive? }
// lensRun('dungeon', 'state', { instanceId }) → { ok, instance: Instance }

interface EncounterPhase { name: string; atHpPct: number; mechanic: string }
interface Encounter { id: string; name: string; baseHp: number; phases: EncounterPhase[]; lockoutH: number }
interface Participant { user_id: string; role: string; damage_dealt: number; downed: number; loot_json: string | null }
interface Instance {
  id: string; world_id: string; leader_user: string; encounter_id: string; tier: string;
  boss_name: string; boss_hp: number; boss_max_hp: number; phase_idx: number; phase_name: string;
  status: 'active' | 'cleared' | 'wiped' | 'abandoned';
  participants: Participant[];
}
interface Lockout { encounterId: string; tier: string; lockedUntil: number }

// A "swing" is an honest client-chosen dice roll, not a fabricated result —
// the server independently decides what actually happens to the boss. Kept
// well under COMBAT_DAMAGE_HARD_CAP (500 by default) so a legitimate report
// is never the one that gets rejected.
const ATTACK_ROLL_MIN = 60;
const ATTACK_ROLL_MAX = 220;
function rollAttack(): number {
  return Math.floor(ATTACK_ROLL_MIN + Math.random() * (ATTACK_ROLL_MAX - ATTACK_ROLL_MIN));
}

function parseLoot(json: string | null): { share: number; rolls: number } | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (typeof v?.share === 'number' && typeof v?.rolls === 'number') return v;
    return null;
  } catch {
    return null;
  }
}

interface Props {
  worldId: string;
  /** Poll cadence while checking for / tracking an active instance. */
  pollMs?: number;
}

export function DungeonHUD({ worldId, pollMs = 6000 }: Props) {
  const { user } = useAuth();
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [lockouts, setLockouts] = useState<Lockout[]>([]);
  const [instance, setInstance] = useState<Instance | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Instance | null>(null);

  // Tracks the last-known instance synchronously (not via a `useEffect` keyed
  // on the `instance` state, which would only update on the NEXT commit —
  // under a fast poll cadence a second `refreshActive` call could race ahead
  // of that commit and miss the active→cleared transition). Assigned inline
  // in `refreshActive` itself so it's always current for the next call.
  const instanceRef = useRef<Instance | null>(null);

  const refreshActive = useCallback(async () => {
    try {
      const r = await lensRun<{ instance: Instance | null }>('dungeon', 'active', { worldId });
      const next = r.data?.ok ? (r.data.result?.instance ?? null) : null;
      const prior = instanceRef.current;
      instanceRef.current = next;
      if (!next && prior) {
        // The instance the HUD was tracking just left "active" status
        // (cleared or wiped). Pull its real final state for the result
        // banner instead of guessing from the last poll.
        try {
          const final = await lensRun<{ instance: Instance }>('dungeon', 'state', { instanceId: prior.id });
          if (final.data?.ok && final.data.result?.instance) setLastResult(final.data.result.instance);
        } catch { /* best-effort — the live HP panel already cleared */ }
      }
      setInstance(next);
    } catch (e) {
      console.error('[DungeonHUD] active refresh failed', e);
    }
  }, [worldId]);

  const refreshCatalog = useCallback(async () => {
    try {
      const [enc, lock] = await Promise.all([
        lensRun<{ encounters: Encounter[] }>('dungeon', 'encounters', {}),
        lensRun<{ lockouts: Lockout[] }>('dungeon', 'lockouts', {}),
      ]);
      setEncounters(enc.data?.ok ? (enc.data.result?.encounters ?? []) : []);
      setLockouts(lock.data?.ok ? (lock.data.result?.lockouts ?? []) : []);
    } catch (e) {
      console.error('[DungeonHUD] catalog refresh failed', e);
    }
  }, []);

  useEffect(() => { refreshActive(); }, [refreshActive]);
  useEffect(() => {
    const id = setInterval(refreshActive, pollMs);
    return () => clearInterval(id);
  }, [refreshActive, pollMs]);

  useEffect(() => {
    if (browserOpen) refreshCatalog();
  }, [browserOpen, refreshCatalog]);

  // Discoverable via the command palette (Ctrl/Cmd+K → "Dungeons"), matching
  // the same `concordia:open-*` dispatch idiom RogueliteUnlockShop uses.
  useEffect(() => {
    function onOpen() { setBrowserOpen(true); }
    window.addEventListener('concordia:open-dungeon-hud', onOpen);
    return () => window.removeEventListener('concordia:open-dungeon-hud', onOpen);
  }, []);

  const openEncounter = useCallback(async (encounterId: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun<{ instanceId?: string; reason?: string }>('dungeon', 'open', {
        worldId, encounterId, tier: 'finder',
      });
      const result = r.data?.result as { instanceId?: string; reason?: string } | null;
      if (!r.data?.ok || result?.reason) {
        setError(result?.reason || r.data?.error || 'Failed to open instance');
      } else {
        setBrowserOpen(false);
        await refreshActive();
      }
    } catch {
      setError('Failed to open instance');
    } finally {
      setBusy(false);
    }
  }, [worldId, refreshActive]);

  const strike = useCallback(async () => {
    if (!instance) return;
    setBusy(true);
    try {
      const damage = rollAttack();
      const r = await lensRun('dungeon', 'hit', { instanceId: instance.id, damage });
      if (!r.data?.ok) {
        const reason = (r.data?.result as { reason?: string } | null)?.reason || r.data?.error;
        setError(reason ? `Attack failed: ${reason}` : 'Attack failed');
      } else {
        setError(null);
      }
      await refreshActive();
    } finally {
      setBusy(false);
    }
  }, [instance, refreshActive]);

  const goDown = useCallback(async () => {
    if (!instance) return;
    setBusy(true);
    try {
      await lensRun('dungeon', 'down', { instanceId: instance.id });
      await refreshActive();
    } finally {
      setBusy(false);
    }
  }, [instance, refreshActive]);

  const catalogModal = browserOpen && (
    <div
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur"
      onClick={(e) => { if (e.currentTarget === e.target) setBrowserOpen(false); }}
      onKeyDown={(e) => { if (e.key === 'Escape') setBrowserOpen(false); }}
    >
      <div className="w-full max-w-md rounded-xl border border-fuchsia-500/40 bg-zinc-950/95 p-4 shadow-2xl">
        <header className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fuchsia-200">
            <Skull size={14} /> Dungeon encounters
          </h2>
          <button aria-label="Close" onClick={() => setBrowserOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800">
            <X size={12} />
          </button>
        </header>
        {error && <p className="mb-2 text-[11px] text-rose-300">{error}</p>}
        {instance && (
          <p className="mb-2 text-[11px] text-amber-300">Already in an active instance — finish or wipe it first.</p>
        )}
        <ul className="space-y-2">
          {encounters.length === 0 && (
            <li className="py-4 text-center text-[12px] text-zinc-500">No encounters loaded.</li>
          )}
          {encounters.map((enc) => {
            const lock = lockouts.find((l) => l.encounterId === enc.id && l.tier === 'finder');
            const lockedForS = lock ? Math.max(0, lock.lockedUntil - Math.floor(Date.now() / 1000)) : 0;
            return (
              <li key={enc.id} className="rounded border border-zinc-800 bg-zinc-900/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-fuchsia-100">{enc.name}</div>
                    <div className="text-[10px] text-zinc-400">{enc.baseHp.toLocaleString()} hp · {enc.phases.length} phases</div>
                  </div>
                  <button
                    disabled={busy || !!instance || lockedForS > 0}
                    onClick={() => openEncounter(enc.id)}
                    className="shrink-0 rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-1 text-[11px] text-fuchsia-100 hover:bg-fuchsia-500/20 disabled:opacity-40"
                  >
                    {lockedForS > 0 ? `Locked ${Math.max(1, Math.ceil(lockedForS / 3600))}h` : 'Start'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );

  const selfLoot = user ? parseLoot(lastResult?.participants.find((p) => p.user_id === user.id)?.loot_json ?? null) : null;
  const resultFlash = lastResult && (
    <div className="pointer-events-auto fixed left-1/2 top-24 z-40 w-72 -translate-x-1/2 rounded-lg border border-emerald-500/40 bg-zinc-950/95 p-3 text-center shadow-xl backdrop-blur">
      <div className="mb-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-200">
        <Trophy size={14} />
        {lastResult.status === 'cleared' ? `${lastResult.boss_name} defeated` : `${lastResult.boss_name} — wipe`}
      </div>
      {selfLoot && (
        <p className="text-[11px] text-emerald-300">
          Your share: {(selfLoot.share * 100).toFixed(0)}% · {selfLoot.rolls} loot roll{selfLoot.rolls === 1 ? '' : 's'}
        </p>
      )}
      <button
        onClick={() => setLastResult(null)}
        className="mt-2 rounded border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
      >
        Dismiss
      </button>
    </div>
  );

  if (!instance) {
    return (
      <>
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          title="Dungeon instances"
          className="pointer-events-auto fixed bottom-40 right-4 z-20 rounded-lg border border-fuchsia-500/30 bg-black/70 px-2 py-1.5 text-center text-[10px] text-fuchsia-200 backdrop-blur-sm hover:bg-fuchsia-500/10"
        >
          <Skull size={12} className="mb-0.5 inline" />
          <div>Dungeons</div>
        </button>
        {catalogModal}
        {resultFlash}
      </>
    );
  }

  const hpPct = instance.boss_max_hp > 0 ? Math.round((instance.boss_hp / instance.boss_max_hp) * 100) : 0;
  const self = user ? instance.participants.find((p) => p.user_id === user.id) : undefined;
  const totalDamage = instance.participants.reduce((s, p) => s + (p.damage_dealt || 0), 0) || 1;

  return (
    <>
      <div className="pointer-events-auto fixed bottom-40 right-4 z-30 w-60 rounded-lg border border-fuchsia-500/40 bg-black/80 p-2 shadow-lg backdrop-blur-sm">
        <header className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-fuchsia-300/70">
          <span className="flex items-center gap-1 truncate"><Skull size={11} /> {instance.boss_name}</span>
          <span className="shrink-0">{instance.phase_name}</span>
        </header>
        <div className="mb-1 h-2 overflow-hidden rounded bg-slate-900">
          <div className="h-full bg-fuchsia-500 transition-[width]" style={{ width: `${hpPct}%` }} />
        </div>
        <div className="mb-2 text-right text-[10px] text-fuchsia-200">
          {Math.round(instance.boss_hp).toLocaleString()} / {Math.round(instance.boss_max_hp).toLocaleString()} ({hpPct}%)
        </div>

        <ul className="mb-2 space-y-0.5">
          {instance.participants.map((p) => (
            <li key={p.user_id} className="flex items-center justify-between text-[10px] text-zinc-300">
              <span className={`flex items-center truncate ${p.user_id === user?.id ? 'font-semibold text-fuchsia-200' : ''}`}>
                {!!p.downed && <HeartCrack size={9} className="mr-1 shrink-0 text-rose-400" />}
                {p.user_id === user?.id ? 'You' : p.user_id.slice(-6)}
              </span>
              <span className="shrink-0">{Math.round(p.damage_dealt)} ({Math.round((p.damage_dealt / totalDamage) * 100)}%)</span>
            </li>
          ))}
        </ul>

        {error && <p className="mb-1 text-[10px] text-rose-300">{error}</p>}

        <div className="flex gap-1">
          <button
            onClick={strike}
            disabled={busy || !!self?.downed}
            className="flex-1 rounded bg-fuchsia-500/30 px-2 py-1 text-[10px] text-fuchsia-100 hover:bg-fuchsia-500/40 disabled:opacity-40"
          >
            <Swords size={10} className="mb-0.5 mr-1 inline" />Strike
          </button>
          {!self?.downed && (
            <button onClick={goDown} disabled={busy} className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40">
              Downed
            </button>
          )}
        </div>
      </div>
      {catalogModal}
      {resultFlash}
    </>
  );
}

export default DungeonHUD;
