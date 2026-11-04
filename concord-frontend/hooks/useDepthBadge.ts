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
   * Construction's substrate is the user's own project record — jobs,
   * RFIs, submittals, logs and budgets persist server-side per account
   * (PROBE-LIVE in Review 5's full first pass) and the bench tools
   * compute over the user's own inputs. The generic REAL_LIVE line
   * ("polled live from an external source") is false for this lens;
   * its one external surface (federal datasets) links out and claims
   * no feed (F1/F4).
   */
  construction: {
    label: 'Live',
    caption: 'Your project records: jobs, RFIs, submittals, logs and budgets are your real workspace data, and the bench tools compute over your inputs. Federal datasets open on catalog.data.gov — no external feed is polled.',
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
