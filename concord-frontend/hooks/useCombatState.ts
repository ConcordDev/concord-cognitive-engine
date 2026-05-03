'use client';

import { useState, useCallback, useRef } from 'react';
import { CombatSkill, HotbarState, isOnCooldown } from '@/lib/concordia/combat/hotbar';
import { VATSState, BodyPart, createVATSState, queueVATSShot, exitVATS, regenAP } from '@/lib/concordia/combat/vats';
import { SPECIALStats, DEFAULT_SPECIAL } from '@/lib/concordia/player-stats';
import { canHarm, makeEntity, type EntityTier } from '@/lib/concordia/entity-protection';
import type { DomainType } from '@/lib/concordia/district-domains';
import { emit } from '@/lib/realtime/socket';

// ── Types ────────────────────────────────────────────────────────────

export interface CombatEntity {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
  distance: number;
  isHostile: boolean;
  type?: 'enemy' | 'player' | 'npc';
  level?: number;
}

export interface CombatLogEntry {
  id: string;
  text: string;
  type: 'hit' | 'miss' | 'dodge' | 'block' | 'crit' | 'death' | 'info';
  timestamp: number;
}

// Elden Ring / Hades "you died but learned" — tracks skills used before death
export interface DeathRecord {
  killedBy: string;
  skillsUsed: string[];     // dtuIds
  damageDealt: number;
  damageTaken: number;
  timestamp: number;
  lesson?: string;          // server-generated advice on next attempt
}

export interface CombatState {
  active: boolean;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  target: CombatEntity | null;
  hotbar: HotbarState;
  log: CombatLogEntry[];
  vats: VATSState;
  deaths: DeathRecord[];
  blockHeld: boolean;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useCombatState(
  special: SPECIALStats = DEFAULT_SPECIAL,
  domain: DomainType = 'mainland',
) {
  const [state, setState] = useState<CombatState>(() => ({
    active: false,
    health: 100 + special.endurance * 20,
    maxHealth: 100 + special.endurance * 20,
    stamina: 100 + special.agility * 10,
    maxStamina: 100 + special.agility * 10,
    target: null,
    hotbar: { slots: Array(9).fill(null), activeSlot: 0 },
    log: [],
    vats: createVATSState(special),
    deaths: [],
    blockHeld: false,
  }));

  const stateRef = useRef(state);
  stateRef.current = state;

  const recentSkillIds = useRef<string[]>([]);

  const addLog = useCallback((entry: Omit<CombatLogEntry, 'id' | 'timestamp'>) => {
    setState(s => ({
      ...s,
      log: [
        { ...entry, id: `${Date.now()}-${Math.random()}`, timestamp: Date.now() },
        ...s.log.slice(0, 49), // keep last 50
      ],
    }));
  }, []);

  const activateSkill = useCallback((slot: number, targetTier: EntityTier = 'ambient'): boolean => {
    // Entity protection check — enforced before any skill resolves
    const target = stateRef.current.target;
    if (target) {
      const result = canHarm({
        attacker: { tier: 'player', pvpConsented: false },
        target: makeEntity(target.id, target.name, targetTier),
        domain,
      });
      if (!result.allowed) {
        addLog({ text: result.reason ?? 'Cannot attack this target.', type: 'info' });
        return false;
      }
    }

    const skill: CombatSkill | null = stateRef.current.hotbar.slots[slot] ?? null;
    if (!skill) return false;
    if (isOnCooldown(skill)) {
      addLog({ text: `${skill.name} is on cooldown`, type: 'info' });
      return false;
    }
    if (stateRef.current.stamina < skill.staminaCost) {
      addLog({ text: `Not enough stamina for ${skill.name}`, type: 'info' });
      return false;
    }
    setState(s => ({
      ...s,
      stamina: Math.max(0, s.stamina - skill.staminaCost),
      hotbar: {
        ...s.hotbar,
        slots: s.hotbar.slots.map((sk, i) =>
          i === slot && sk ? { ...sk, lastUsedAt: Date.now() } : sk
        ),
      },
    }));
    addLog({ text: `Used ${skill.name}`, type: 'hit' });

    if (skill.dtuId) {
      const prev = recentSkillIds.current.filter(id => id !== skill.dtuId);
      recentSkillIds.current = [skill.dtuId, ...prev].slice(0, 5);
      emit('skill:use', {
        dtuId: skill.dtuId,
        context: {
          targetId: stateRef.current.target?.id,
          recentSkillIds: prev.slice(0, 4),
        },
      });
    }

    return true;
  }, [addLog, domain]);

  const dodge = useCallback(() => {
    const cost = 15;
    if (stateRef.current.stamina < cost) return false;
    setState(s => ({ ...s, stamina: Math.max(0, s.stamina - cost) }));
    addLog({ text: 'Dodged', type: 'dodge' });
    return true;
  }, [addLog]);

  const setBlock = useCallback((held: boolean) => {
    setState(s => ({ ...s, blockHeld: held }));
  }, []);

  const setTarget = useCallback((entity: CombatEntity | null) => {
    setState(s => ({ ...s, target: entity }));
  }, []);

  const toggleVATS = useCallback(() => {
    setState(s => ({
      ...s,
      vats: s.vats.active
        ? exitVATS(s.vats)
        : { ...s.vats, active: true },
    }));
  }, []);

  const queueShot = useCallback((targetId: string, part: BodyPart, apCost: number) => {
    setState(s => ({ ...s, vats: queueVATSShot(s.vats, targetId, part, apCost) }));
  }, []);

  // Call from game loop with delta time in seconds
  const tick = useCallback((deltaSeconds: number) => {
    setState(s => {
      // Stamina regen: 10/s when not blocking
      const staminaRegen = s.blockHeld ? 2 : 10;
      const newStamina = Math.min(s.maxStamina, s.stamina + staminaRegen * deltaSeconds);
      const newVats = regenAP(s.vats, deltaSeconds);
      return { ...s, stamina: newStamina, vats: newVats };
    });
  }, []);

  const recordDeath = useCallback((killedBy: string, damageDealt: number) => {
    const record: DeathRecord = {
      killedBy,
      skillsUsed: stateRef.current.hotbar.slots
        .filter(Boolean)
        .map(s => s!.dtuId),
      damageDealt,
      damageTaken: stateRef.current.maxHealth - stateRef.current.health,
      timestamp: Date.now(),
    };
    setState(s => ({
      ...s,
      health: s.maxHealth,    // respawn at full health
      deaths: [record, ...s.deaths.slice(0, 9)],
    }));
    addLog({ text: `Defeated by ${killedBy}. You'll do better next time.`, type: 'death' });
  }, [addLog]);

  const setHotbar = useCallback((hotbar: HotbarState) => {
    setState(s => ({ ...s, hotbar }));
  }, []);

  return {
    state,
    activateSkill,
    dodge,
    setBlock,
    setTarget,
    toggleVATS,
    queueShot,
    tick,
    recordDeath,
    setHotbar,
    addLog,
  };
}
