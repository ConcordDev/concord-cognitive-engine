// Combat hotbar — skills are DTUs in the player's personal locker.
// On load, queries /api/personal-locker/dtus and maps matching DTUs to
// CombatSkill slots. Skills are created through training (text/voice spec
// → subconscious brain validation → DTU with lineage).

import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────

export interface CombatSkill {
  dtuId: string;
  name: string;
  description: string;
  cooldownMs: number;
  staminaCost: number;
  apCost: number;           // VATS Action Point cost
  damageRange: [number, number];
  range: 'melee' | 'close' | 'mid' | 'long';
  targetType: 'single' | 'aoe' | 'self';
  animationClip: string;
  derivedFrom: string[];    // lineage DTU ids
  /** Control scheme ID — overrides inference when set (e.g. 'karate', 'firearm_pistol') */
  controlScheme?: string;
  // runtime state
  lastUsedAt: number;
}

export interface HotbarState {
  slots: (CombatSkill | null)[];  // 9 slots (1–9 keys)
  activeSlot: number;             // 0-indexed
}

// ── Skill creation through training ─────────────────────────────────

export interface SkillSpec {
  name: string;
  description: string;   // player's text/voice spec
}

export interface SkillCreationResult {
  skill?: CombatSkill;
  dtuId?: string;
  error?: string;
}

export async function createCombatSkill(
  spec: SkillSpec,
  _playerId: string,
): Promise<SkillCreationResult> {
  try {
    // Validate technique via subconscious brain
    const validationRes = await api.post('/api/chat', {
      message: `Validate this combat technique for use in Concordia. Return JSON with fields: passed (bool), reason (string), computedCooldownMs (number), computedStaminaCost (number), computedApCost (number), computedDamageMin (number), computedDamageMax (number), derivedFrom (string[]), animationClip (string), controlSchemeId (one of: bare_hands, boxer, karate, firearm_pistol, firearm_rifle, blade, magic_channel, stealth — pick the most fitting). Technique: ${spec.description}`,
      lensContext: { lens: 'game', intent: 'combat-skill-validation' },
      brainOverride: 'subconscious',
    });

    const raw = validationRes.data?.response ?? validationRes.data?.text ?? '';
    let validation: {
      passed: boolean;
      reason: string;
      computedCooldownMs: number;
      computedStaminaCost: number;
      computedApCost: number;
      computedDamageMin: number;
      computedDamageMax: number;
      derivedFrom: string[];
      animationClip: string;
      controlSchemeId?: string;
    };

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      validation = jsonMatch ? JSON.parse(jsonMatch[0]) : { passed: false, reason: 'Parse error' };
    } catch {
      return { error: 'Validation response could not be parsed' };
    }

    if (!validation.passed) {
      return { error: validation.reason };
    }

    // Create combat skill DTU. Default to scope='personal' so the skill is
    // private to this user's avatar; they can explicitly publish later via
    // POST /api/personal-locker/dtus/:id/list-on-marketplace.
    const dtuRes = await api.post('/api/dtus', {
      title: spec.name,
      content: spec.description,
      tags: ['combat_skill', 'concordia'],
      scope: 'personal',
      meta: {
        type: 'combat_skill',
        cooldownMs: validation.computedCooldownMs,
        staminaCost: validation.computedStaminaCost,
        apCost: validation.computedApCost ?? 10,
        damageRange: [validation.computedDamageMin, validation.computedDamageMax],
        animationClip: validation.animationClip ?? 'attack',
        derivedFrom: validation.derivedFrom ?? [],
        controlScheme: validation.controlSchemeId,
      },
    });

    const dtu = dtuRes.data?.dtu;
    if (!dtu) return { error: 'DTU creation failed' };

    const skill: CombatSkill = {
      dtuId: dtu.id,
      name: spec.name,
      description: spec.description,
      cooldownMs: validation.computedCooldownMs,
      staminaCost: validation.computedStaminaCost,
      apCost: validation.computedApCost ?? 10,
      damageRange: [validation.computedDamageMin, validation.computedDamageMax],
      range: 'melee',
      targetType: 'single',
      animationClip: validation.animationClip ?? 'attack',
      derivedFrom: validation.derivedFrom ?? [],
      controlScheme: validation.controlSchemeId,
      lastUsedAt: 0,
    };

    return { skill, dtuId: dtu.id };
  } catch (err) {
    return { error: String(err) };
  }
}

// ── Load hotbar from personal locker ────────────────────────────────

export async function loadHotbarFromSubstrate(
  _playerId: string,
): Promise<HotbarState> {
  try {
    const res = await api.get('/api/personal-locker/dtus?lens=game');
    const dtus: Array<{
      id: string;
      title?: string;
      content_type?: string;
      meta?: Record<string, unknown>;
    }> = res.data?.dtus ?? [];

    const skills = dtus
      .filter(d => d.meta?.type === 'combat_skill')
      .slice(0, 9)
      .map((d): CombatSkill => {
        const m = d.meta ?? {};
        return {
          dtuId: d.id,
          name: (d.title as string) ?? 'Unknown Skill',
          description: '',
          cooldownMs: (m.cooldownMs as number) ?? 2000,
          staminaCost: (m.staminaCost as number) ?? 20,
          apCost: (m.apCost as number) ?? 10,
          damageRange: (m.damageRange as [number, number]) ?? [5, 15],
          range: 'melee',
          targetType: 'single',
          animationClip: (m.animationClip as string) ?? 'attack',
          derivedFrom: (m.derivedFrom as string[]) ?? [],
          controlScheme: (m.controlScheme as string | undefined),
          lastUsedAt: 0,
        };
      });

    const slots: (CombatSkill | null)[] = Array.from({ length: 9 }, (_, i) => skills[i] ?? null);
    return { slots, activeSlot: 0 };
  } catch {
    return { slots: Array(9).fill(null), activeSlot: 0 };
  }
}

// ── Cooldown helpers ─────────────────────────────────────────────────

export function isOnCooldown(skill: CombatSkill): boolean {
  return Date.now() - skill.lastUsedAt < skill.cooldownMs;
}

export function cooldownProgress(skill: CombatSkill): number {
  const elapsed = Date.now() - skill.lastUsedAt;
  return Math.min(1, elapsed / skill.cooldownMs);
}
