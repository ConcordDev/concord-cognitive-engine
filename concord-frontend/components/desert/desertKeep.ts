/**
 * Keep a computed desert expedition route plan as a private DTU, then a Thread
 * draft (shared dtu.create -> dtu.get read-back -> thread.thread-draft
 * handoff in components/lens/recordKeep.ts). Built only from the preview the
 * planner already rendered — no computed totals, nothing to keep.
 */

import type { KeptRecord } from '@/components/lens/recordKeep';

export interface DesertRouteLegInput {
  index?: number;
  from?: string;
  to?: string;
  terrain?: string;
  distanceKm?: number;
  travelHours?: number;
  waterLiters?: number;
  foodKg?: number;
}

export interface DesertRouteTotalsInput {
  teamSize?: number;
  distanceKm?: number;
  travelHours?: number;
  travelDays?: number;
  waterLiters?: number;
  waterLitersPerPerson?: number;
  foodKg?: number;
}

export interface DesertRoutePlanInput {
  name?: string;
  totals?: DesertRouteTotalsInput | null;
  legs?: DesertRouteLegInput[] | null;
}

function text(value: unknown, max = 4000): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pushNum(lines: string[], label: string, value: unknown, unit = ''): void {
  const n = num(value);
  if (n == null) return;
  lines.push(`${label}: ${n}${unit}`);
}

/** The planner's computed route plan. Null with no computed totals or name to title it. */
export function desertKeptRecord(plan: DesertRoutePlanInput | null | undefined): KeptRecord | null {
  const totals = plan?.totals && typeof plan.totals === 'object' ? plan.totals : null;
  if (!plan || !totals) return null;
  const legs = (plan.legs || []).filter((l) => text(l?.from, 120) || text(l?.to, 120));
  const name = text(plan.name, 240);
  const first = text(legs[0]?.from, 120);
  const last = text(legs[legs.length - 1]?.to, 120);
  const title = name || (first && last ? `${first} → ${last}` : first || last);
  if (!title) return null;
  const lines = [title];
  pushNum(lines, 'Team', totals.teamSize);
  pushNum(lines, 'Distance', totals.distanceKm, ' km');
  pushNum(lines, 'Travel days', totals.travelDays);
  pushNum(lines, 'Water', totals.waterLiters, ' L');
  pushNum(lines, 'Water per person', totals.waterLitersPerPerson, ' L');
  pushNum(lines, 'Food', totals.foodKg, ' kg');
  if (legs.length) {
    lines.push('Legs:');
    for (const l of legs.slice(0, 40)) {
      const from = text(l.from, 120);
      const to = text(l.to, 120);
      const head = from && to ? `${from} → ${to}` : from || to;
      const fields: string[] = [];
      const terrain = text(l.terrain, 40);
      if (terrain) fields.push(terrain);
      const distance = num(l.distanceKm);
      if (distance != null) fields.push(`${distance} km`);
      const hours = num(l.travelHours);
      if (hours != null) fields.push(`${hours} h`);
      const water = num(l.waterLiters);
      if (water != null) fields.push(`${water} L`);
      const food = num(l.foodKg);
      if (food != null) fields.push(`${food} kg`);
      lines.push(fields.length ? `- ${head}: ${fields.join(', ')}` : `- ${head}`);
    }
  }
  return {
    title,
    body: lines.join('\n'),
    tags: ['desert', 'route-plan'],
    source: 'desert-lens:route-plan',
    createdFrom: 'desert',
    draftTitle: `Desert route — ${title}`.slice(0, 120),
    machine: {
      kind: 'desert_route_plan',
      name: name || null,
      totals,
      legs: legs.slice(0, 40),
    },
  };
}