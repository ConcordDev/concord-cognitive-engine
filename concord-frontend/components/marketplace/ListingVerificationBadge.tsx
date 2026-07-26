'use client';

// concord-frontend/components/marketplace/ListingVerificationBadge.tsx
//
// V1.2 Wave C — Creation → Economy Loop, closing the "verified means
// nothing" gap a grounding audit found: the marketplace has real royalty
// math and real provenance, but nothing tied a REAL check (an FEA
// structural pass) to a marketplace listing's presentation. "Verified"
// effectively meant "has royalty math," not "was actually checked."
//
// getListingVerification (below) is a canonical CLIENT-SIDE port of
// server/lib/marketplace-verification.js#getListingVerification — same
// three honest states, same field reads, kept in step for the same reason
// server/lib/capability-tier.js ports CapabilityBadge.tsx's classifier the
// other direction: a listing row already in hand (from
// `marketplace.myListings` / `marketplace.dtu_browse`) should classify
// without a network round trip. The one real source of "was this actually
// checked" data for a listing today is
// server/lib/asset-gen/asset-marketplace.js#mintGeneratedAssetAsDtu, which
// stamps a verbatim FEA summary onto the minted DTU's `meta`
// (`feaVerified`/`feaSummary`) — `marketplace.myListings` (server.js)
// forwards those two fields verbatim onto each listing row for exactly this
// purpose.
//
// Deliberately NOT built on top of <CapabilityBadge> even though this repo
// treats that component as the platform's canonical honesty-badge pattern
// (see components/common/CapabilityBadge.tsx): its tier copy ("Machine-
// checked: ... Z3 proved...", "a cited source does not exist") is specific
// to reason.verify's citation/proof vocabulary. Showing that copy verbatim
// for an FEA structural check (a different real check, with different real
// numbers — utilization ratio, safety factor, not citations) would itself
// be a small dishonesty. Checked and rejected: reason.verify verdicts are
// NEVER actually persisted onto a marketplace listing today (every call
// site — ConKayOverlay.tsx — only ever stores a verdict in ephemeral chat
// message state), so a "reasoned via reason.verify" listing state would be
// a fabricated code path for a case that can't happen; this component
// intentionally has no fourth state for it. This component reuses
// CapabilityBadge's TIER PATTERN (three-way honest classification, never a
// default "verified", same icon family) with domain-correct labels.

import { BadgeCheck, XOctagon, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ListingVerificationState = 'fea_verified' | 'fea_failed' | 'no_data';

export const LISTING_VERIFICATION_STATES: Record<string, ListingVerificationState> = {
  FEA_VERIFIED: 'fea_verified',
  FEA_FAILED: 'fea_failed',
  NO_DATA: 'no_data',
};

/** The real, verbatim FEA summary shape `asset-marketplace.js#summarizeFeaResult`
 * writes — every field optional so a partial/absent summary still type-checks. */
export interface FeaSummary {
  ok?: boolean;
  maxUtilization?: number | null;
  worstStress?: number | null;
  allowable?: number | null;
  safetyFactor?: number | null;
  tipLoadN?: number | null;
  material?: string | null;
  reason?: string | null;
}

/** Either a full resolved DTU object (`dtu.meta.feaSummary`) or the
 * flattened listing-row projection `marketplace.myListings` returns
 * (`listing.feaSummary` at the top level) — both are read identically. */
export interface ListingLike {
  feaVerified?: boolean | null;
  feaSummary?: FeaSummary | null;
  meta?: { feaVerified?: boolean | null; feaSummary?: FeaSummary | null } | null;
}

export interface ListingVerification {
  state: ListingVerificationState;
  verified: boolean;
  label: string;
  detail: string;
  feaSummary: FeaSummary | null;
}

function fmt(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a';
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return n.toExponential(3);
  return String(Math.round(n * 1000) / 1000);
}

/**
 * Classify a marketplace listing's real verification state. PURE — no
 * fetch, no macro call. Never defaults to "verified": absent/malformed
 * input always falls to the honest `no_data` state.
 */
export function getListingVerification(listing?: ListingLike | null): ListingVerification {
  const feaSummary: FeaSummary | null =
    (listing && typeof listing === 'object' && (listing.feaSummary ?? listing.meta?.feaSummary)) || null;

  if (!feaSummary || typeof feaSummary !== 'object') {
    return {
      state: 'no_data',
      verified: false,
      label: 'Not verified',
      detail: 'No verification data is attached to this listing.',
      feaSummary: null,
    };
  }

  const passed = feaSummary.ok === true;
  if (passed) {
    return {
      state: 'fea_verified',
      verified: true,
      label: 'FEA Verified',
      detail: `Structural FEA check passed (max utilization ${fmt(feaSummary.maxUtilization)}, safety factor ${fmt(feaSummary.safetyFactor)}).`,
      feaSummary,
    };
  }

  return {
    state: 'fea_failed',
    verified: false,
    label: 'Unverified (FEA failed)',
    detail: `A structural FEA check ran and did NOT pass (max utilization ${fmt(feaSummary.maxUtilization)}, safety factor ${fmt(feaSummary.safetyFactor)}) — listed unverified at the seller's explicit request.`,
    feaSummary,
  };
}

const STATE_STYLE: Record<ListingVerificationState, { icon: typeof BadgeCheck; text: string }> = {
  fea_verified: { icon: BadgeCheck, text: 'text-emerald-400' },
  fea_failed: { icon: XOctagon, text: 'text-rose-400' },
  no_data: { icon: HelpCircle, text: 'text-zinc-500' },
};

export interface ListingVerificationBadgeProps {
  /** The listing row (or full DTU) to classify. `null`/`undefined` renders
   * the honest "Not verified" state, never a placeholder "verified". */
  listing?: ListingLike | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * ListingVerificationBadge — the honest per-listing verification indicator
 * for the marketplace. A pure function of `listing`; never fetches and
 * never fabricates a "verified" default.
 */
export function ListingVerificationBadge({ listing, size = 'sm', className }: ListingVerificationBadgeProps) {
  const v = getListingVerification(listing);
  const { icon: Icon, text } = STATE_STYLE[v.state];
  const iconSize = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  const textSize = size === 'md' ? 'text-xs' : 'text-[10px]';

  return (
    <span
      className={cn('inline-flex items-center gap-1 font-medium', textSize, text, className)}
      title={v.detail}
      data-listing-verification-state={v.state}
    >
      <Icon className={iconSize} />
      {v.label}
    </span>
  );
}

export default ListingVerificationBadge;
