'use client';

/**
 * SkillWheelMount — wires the radial skill wheel to the player's REAL moves.
 *
 * The Starfield lesson, applied: the wheel must surface what's actually
 * *possible* (your learned skills), not a hardcoded demo list. It fetches
 * `/api/worlds/skills/mine`, maps the top skills into wheel spokes, and each
 * spoke fires the SAME `concordia:spell-cast` event the combat hotbar uses — so
 * flicking the radial mid-combat does exactly what slot-casting does, by
 * construction (one consistent cast path, no menu-diving — the Saints Row
 * "traversal/abilities are a flick away" feel for combat).
 *
 * Falls back to ActionWheel's built-in defaults when the player has no skills
 * yet (brand-new account), so the wheel is never empty.
 */

import { useEffect, useState, useCallback } from 'react';
import { ActionWheel, type WheelSpoke } from './ActionWheel';

interface SkillDTU {
  id: string;
  title?: string;
  name?: string;
  skill_level?: number;
  data?: string | Record<string, unknown>;
}

const ELEMENT_GLYPH: Record<string, string> = {
  fire: '✦', ice: '❄', frost: '❄', lightning: '⚡', electric: '⚡',
  water: '≈', bio: '☣', poison: '☣', energy: '◉', force: '◉',
  physical: '✖', light: '✺', heal: '☥', wind: '✧',
};

function glyphFor(skill: SkillDTU): string {
  let element = '';
  try {
    const d = typeof skill.data === 'string' ? JSON.parse(skill.data) : skill.data;
    element = String((d as Record<string, unknown>)?.element || '').toLowerCase();
  } catch { /* ignore */ }
  if (element && ELEMENT_GLYPH[element]) return ELEMENT_GLYPH[element];
  const name = String(skill.title || skill.name || '').toLowerCase();
  for (const key of Object.keys(ELEMENT_GLYPH)) if (name.includes(key)) return ELEMENT_GLYPH[key];
  return '✶';
}

/** Element parsed from the skill's data blob (falls back to a name match), so
 *  the cast carries a real element instead of defaulting to 'physical'. */
function elementFor(skill: SkillDTU): string | undefined {
  try {
    const d = typeof skill.data === 'string' ? JSON.parse(skill.data) : skill.data;
    const el = String((d as Record<string, unknown>)?.element || '').toLowerCase();
    if (el) return el;
  } catch { /* ignore */ }
  const name = String(skill.title || skill.name || '').toLowerCase();
  for (const key of Object.keys(ELEMENT_GLYPH)) if (name.includes(key)) return key;
  return undefined;
}

function castSpoke(skill: SkillDTU): WheelSpoke {
  let costs: unknown;
  try {
    const d = typeof skill.data === 'string' ? JSON.parse(skill.data) : skill.data;
    costs = (d as Record<string, unknown>)?.costs;
  } catch { /* ignore */ }
  const name = skill.title || skill.name || 'Skill';
  const element = elementFor(skill);
  return {
    id: skill.id,
    label: name,
    glyph: glyphFor(skill),
    action: () => {
      // Ride the canonical cast channel (same as CombatFlowHotbar).
      window.dispatchEvent(new CustomEvent('concordia:spell-cast', {
        detail: { spellId: skill.id, spellName: name, element, costs },
      }));
    },
  };
}

export default function SkillWheelMount() {
  const [spokes, setSpokes] = useState<WheelSpoke[] | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/worlds/skills/mine', { credentials: 'include' });
      if (!r.ok) return;
      const j = await r.json();
      const skills: SkillDTU[] = Array.isArray(j?.skills) ? j.skills : [];
      if (!skills.length) { setSpokes(undefined); return; } // fall back to defaults
      const top = skills
        .slice()
        .sort((a, b) => (b.skill_level || 0) - (a.skill_level || 0))
        .slice(0, 8)
        .map(castSpoke);
      setSpokes(top);
    } catch { /* offline — keep current/defaults */ }
  }, []);

  useEffect(() => {
    load();
    // Refresh when a skill is learned/evolved so the wheel stays current.
    const onChange = () => load();
    window.addEventListener('concordia:skill-learned', onChange);
    window.addEventListener('skill:evolved', onChange);
    return () => {
      window.removeEventListener('concordia:skill-learned', onChange);
      window.removeEventListener('skill:evolved', onChange);
    };
  }, [load]);

  return <ActionWheel variant="skill" spokes={spokes} />;
}
