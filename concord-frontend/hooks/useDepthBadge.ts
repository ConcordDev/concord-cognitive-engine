'use client';

/**
 * useDepthBadge — read the manifest's dataTier for a lens.
 *
 * Phase 1 of the 10-dimension UX completeness sprint. Wires the
 * IntegrationRegistry (Phase 2) → manifest → in-header chip so a user
 * always knows whether they're looking at live data, free open data,
 * a high-fidelity simulation, or honest demo data.
 *
 * Returns { tier, label, tone } where tone is the colour family the
 * DepthBadge component renders.
 */

import { useMemo } from 'react';
import { getLensManifest } from '@/lib/lenses/manifest';
import type { DataTier } from '@/lib/lenses/manifest';

export interface DepthBadgeInfo {
  tier: DataTier;
  label: string;
  /** Short caption shown on hover. */
  caption: string;
  /** Tone family the DepthBadge maps to a colour. */
  tone: 'live' | 'free' | 'sim' | 'demo';
}

const TIER_INFO: Record<DataTier, DepthBadgeInfo> = {
  REAL_LIVE: {
    tier: 'REAL_LIVE',
    label: 'Live',
    caption: 'Real, polled live from an external source.',
    tone: 'live',
  },
  REAL_FREE: {
    tier: 'REAL_FREE',
    label: 'Real',
    caption: 'Real but static / open-access dataset.',
    tone: 'free',
  },
  SIM_GRADE_A: {
    tier: 'SIM_GRADE_A',
    label: 'Simulated',
    caption: 'High-fidelity simulation grounded against a domain schema. Not real data.',
    tone: 'sim',
  },
  DEMO: {
    tier: 'DEMO',
    label: 'Demo',
    caption: 'Synthetic. This domain requires paywalled feeds we haven’t licensed yet.',
    tone: 'demo',
  },
};

/**
 * Game profile XP, quests, and achievements are the user's own activity.
 * The generic SIM_GRADE_A line ("Not real data") is false for those. The
 * chip names the two surfaces that actually are simulations.
 */
const LENS_DEPTH_OVERRIDE: Record<string, Pick<DepthBadgeInfo, 'label' | 'caption'>> = {
  game: {
    label: 'Lab & arcade sim',
    caption: 'Simulated: Design Lab forecasts and mini-game practice XP. Profile XP, quests, and achievements are your real activity.',
  },
  /**
   * Database connections are workspace copies held by Concord — no
   * remote server is contacted, so the generic REAL_LIVE line ("polled
   * live from an external source") is false for this lens (F14).
   */
  database: {
    label: 'Workspace',
    caption: 'Your workspace store: connections and datasets live in Concord’s workspace, not on a remote database server.',
  },
  /**
   * Emergency Services' registry is the user's own live substrate —
   * units, incidents and agency records persist per account on
   * Concord's backend — so the generic REAL_FREE line ("static /
   * open-access dataset") was false for this lens (F1). The seismic
   * half is a live USGS feed; the caption names both halves.
   */
  'emergency-services': {
    label: 'Live',
    caption: 'Live: units, incidents and agency records are your own data, stored on Concord’s backend and persisted per account. Seismic data is a live USGS feed.',
  },
  /**
   * Masonry's calculators execute for real against published spec tables
   * and the contractor suite's records persist server-side — the generic
   * REAL_LIVE line ("polled live from an external source") would claim a
   * feed this lens does not poll (F1 flip, Review 4 determination
   * 2026-11-01: real execution under a Simulated banner).
   */
  masonry: {
    label: 'Live',
    caption: 'Real execution: the calculators run against published masonry spec tables and your suite records are saved in your own workspace. No external feed is polled.',
  },
  /**
   * Environment is two halves under one tier: per-user records (sites,
   * samples, the GHG inventory) kept live in the workspace, plus live
   * open data (Open-Meteo air quality, USGS, GBIF). The generic REAL_LIVE
   * line ("polled live from an external source") describes only the
   * second half, so the caption names both.
   */
  environment: {
    label: 'Live workspace + open data',
    caption: 'Your sites, samples and GHG inventory, kept live in your workspace — plus live open data: Open-Meteo air quality, USGS water and GBIF species records.',
  },
  /**
   * Housing's substrate is the member's own persistent world state —
   * land claims and houses live in the platform database, owner-gated
   * in the lib (PROBE-BLOCKED at the then-missing claim surface in
   * Review 3's first pass; the claim path is wired in the full build).
   * The generic REAL_LIVE line ("polled live from an external source")
   * is false for this lens; no external source is polled (S-HO-3).
   */
  housing: {
    label: 'Live',
    caption: 'Your world records: land claims and houses are your real persistent state in Concord’s worlds, and the tools work on your own plots and buildings. No external feed is polled.',
  },
};

export function useDepthBadge(lensId: string): DepthBadgeInfo | null {
  return useMemo(() => {
    if (!lensId) return null;
    const manifest = getLensManifest(lensId);
    if (!manifest?.dataTier) return null;
    const info = TIER_INFO[manifest.dataTier];
    if (!info) return null;
    const override = LENS_DEPTH_OVERRIDE[lensId];
    return override ? { ...info, ...override } : info;
  }, [lensId]);
}

export { TIER_INFO };
