// T3.1 — per-skill mastery query hook.
//
// Consumes GET /api/crafting/skills/mastery (all skills) and
// GET /api/crafting/skills/mastery/:skillType (one). The server resolves the
// mastery tier (novice → grandmaster), progress to the next tier, the
// per-tier bonuses, and the per-skill VFX descriptor the world renderer uses.
// Auth is via httpOnly cookie (the shared `api` axios instance sends
// withCredentials), so no token plumbing is needed here.

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api/client';

export interface MasteryVfx {
  skillType: string | null;
  kind: string | null;
  element: string;
  tier: string;
  tierIndex: number;
  palette: { primary: string; secondary: string; preset: string; light: string };
  particles: { count: number; scale: number; trailLength: number };
  glow: number;
  cameraKickPx: number;
  finisherFlourish: boolean;
}

export interface SkillMastery {
  skillType: string;
  level: number;
  xp: number;
  tier: string;
  tierIndex: number;
  nextTier: string | null;
  nextTierAtLevel: number | null;
  levelsToNext: number;
  progressToNext: number;
  bonuses: {
    frameSpeed: number;
    potency: number;
    poiseBonus: number;
    finisherUnlocked: boolean;
  };
  vfx: MasteryVfx;
}

export interface UseSkillMasteryState {
  skills: SkillMastery[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetch all of the caller's skills with mastery + VFX. Re-fetches on mount and
 * whenever `refresh()` is called (e.g. after a level-up event).
 */
export function useSkillMastery(): UseSkillMasteryState {
  const [skills, setSkills] = useState<SkillMastery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/api/crafting/skills/mastery');
      const data = res.data as { ok?: boolean; skills?: SkillMastery[]; error?: string };
      if (data?.ok && Array.isArray(data.skills)) setSkills(data.skills);
      else setError(data?.error || 'failed to load mastery');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Re-fetch when a skill levels up (LevelUpJuiceBridge dispatches this).
  useEffect(() => {
    const onLevel = () => { load(); };
    window.addEventListener('concordia:skill-level-up', onLevel);
    return () => window.removeEventListener('concordia:skill-level-up', onLevel);
  }, [load]);

  return { skills, loading, error, refresh: load };
}

/** Fetch a single skill's mastery (optionally tagging the VFX element/kind). */
export async function fetchSkillMastery(
  skillType: string,
  opts?: { element?: string; kind?: string },
): Promise<SkillMastery | null> {
  const params = new URLSearchParams();
  if (opts?.element) params.set('element', opts.element);
  if (opts?.kind) params.set('kind', opts.kind);
  const qs = params.toString();
  try {
    const res = await api.get(
      `/api/crafting/skills/mastery/${encodeURIComponent(skillType)}${qs ? `?${qs}` : ''}`,
    );
    const data = res.data as { ok?: boolean; mastery?: SkillMastery };
    return data?.ok && data.mastery ? data.mastery : null;
  } catch {
    return null;
  }
}
