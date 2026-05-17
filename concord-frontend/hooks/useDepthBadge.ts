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

export function useDepthBadge(lensId: string): DepthBadgeInfo | null {
  return useMemo(() => {
    if (!lensId) return null;
    const manifest = getLensManifest(lensId);
    if (!manifest?.dataTier) return null;
    return TIER_INFO[manifest.dataTier] ?? null;
  }, [lensId]);
}

export { TIER_INFO };
