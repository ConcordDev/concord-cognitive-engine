'use client';

// concord-frontend/components/common/CapabilityBadge.tsx
//
// Platform-wide honest capability badge — a single, reusable rendering of a
// REAL `reason.verify` verdict. Any lens or surface that presents an
// AI-generated or DTU-derived claim and wants to show "is this actually backed
// by something, or just reasoned?" imports this component and passes the
// verdict object it got back from calling the macro itself:
//   POST /api/lens/run  { domain: "reason", name: "verify", input: { claim, citations } }
//
// Honest by construction (CLAUDE.md "How we work here" #3): this component is
// a PURE function of the `verdict` prop. It never calls the macro itself,
// never fabricates a confidence number, and never invents a "proven" state —
// a missing, pending, or malformed verdict always renders the honest
// "Unverified" tier, never a fake green check.
//
// The real verdict shape (server/lib/reason-verify.js#verifyClaim:159-172,
// registered as the `reason.verify` macro in server/domains/reason.js:13-32):
//   {
//     ok: boolean,
//     claim: string|null,
//     citationsTotal: number,
//     citationsResolved: number,
//     allResolved: boolean,
//     unresolvedIds: string[],
//     supported: boolean|null,
//     confidence: number|null,
//     mode: "deterministic" | "council" | "proof",
//     verdict: "proven" | "refuted" | "grounded" | "unsupported"
//            | "citations_resolve" | "fabricated_citation" | "unverified",
//     council: string|null,
//     proof: object|null,
//   }
//
// This component collapses those seven verdict values into four honest visual
// TIERS — the set any generic surface needs without re-deriving ConKay's own
// richer inline mapping (see concord-frontend/components/conkay/ConKayViz.tsx
// #VerdictBadge, which additionally renders a "pending…" shimmer state and a
// side "· council 82%" judged-by annotation tuned for inline chat messages —
// that richer, chat-specific rendering stays bespoke there; see the note at
// the bottom of this file for why it wasn't folded into this component):
//
//   proven      (green) — verdict is "proven" (Z3 machine-checked) or
//                          "grounded" (multi-brain council confirmed the
//                          cited sources support the claim)
//   flagged     (red)   — verdict is "refuted" or "fabricated_citation" — an
//                          ACTIVE red flag. Never softened into "reasoned";
//                          downplaying a refuted/fabricated claim as merely
//                          "unproven" would itself be a small dishonesty.
//   reasoned    (amber) — a real verdict was computed but it isn't a strong
//                          proof/grounding: "citations_resolve" (citations are
//                          real but no judge ran), "unsupported" (council says
//                          they don't back the claim), "pending" (a caller-side
//                          sentinel for "check in flight"), or the verdict
//                          string "unverified" (nothing was cited to check).
//   unverified  (gray)  — no verdict object was supplied at all, or it isn't
//                          `ok`. No check ran — distinct from the amber
//                          "reasoned" tier, which means a check DID run.

import { ShieldCheck, BadgeCheck, AlertTriangle, XOctagon, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The real return shape of the `reason.verify` macro. Every field optional so
 * a partial/pending verdict object still type-checks — the component decides
 * what to render, it never assumes a field is present. */
export interface CapabilityVerdict {
  ok?: boolean;
  verdict?: string | null;
  mode?: 'deterministic' | 'council' | 'proof' | string | null;
  confidence?: number | null;
  claim?: string | null;
  citationsTotal?: number;
  citationsResolved?: number;
  allResolved?: boolean;
  unresolvedIds?: string[];
  supported?: boolean | null;
}

export type CapabilityTier = 'proven' | 'flagged' | 'reasoned' | 'unverified';

const PROVEN_VERDICTS = new Set(['proven', 'grounded']);
const FLAGGED_VERDICTS = new Set(['refuted', 'fabricated_citation']);

/** Pure classification — the only place the 7 raw verdict strings map to a
 * visual tier. No branch here fabricates a result: absence of a usable
 * verdict always falls to 'unverified'. */
export function capabilityTierFor(verdict?: CapabilityVerdict | null): CapabilityTier {
  if (!verdict || verdict.ok !== true || !verdict.verdict) return 'unverified';
  const v = String(verdict.verdict);
  if (PROVEN_VERDICTS.has(v)) return 'proven';
  if (FLAGGED_VERDICTS.has(v)) return 'flagged';
  return 'reasoned'; // citations_resolve | unsupported | pending | unverified(string) | anything unrecognized
}

const TIER_STYLE: Record<CapabilityTier, { icon: typeof ShieldCheck; text: string; label: string }> = {
  proven: { icon: BadgeCheck, text: 'text-emerald-400', label: 'Proven ✓' },
  flagged: { icon: XOctagon, text: 'text-rose-400', label: 'Flagged' },
  reasoned: { icon: AlertTriangle, text: 'text-amber-400/90', label: 'Reasoned — verify' },
  unverified: { icon: HelpCircle, text: 'text-zinc-500', label: 'Unverified' },
};

function tierTitle(tier: CapabilityTier, verdict?: CapabilityVerdict | null): string {
  switch (tier) {
    case 'proven':
      return verdict?.verdict === 'proven'
        ? 'Machine-checked: the subconscious brain formalised this claim into SMT-LIB and Z3 proved it valid. Sound, not a model’s opinion.'
        : 'The multi-brain council confirmed the cited sources support this claim.';
    case 'flagged':
      return verdict?.verdict === 'refuted'
        ? 'Machine-checked: Z3 found a counterexample — this claim is provably false. Do not rely on it.'
        : 'A cited source does not exist (or is not visible to you) — a fabricated citation. Do not rely on this claim.';
    case 'reasoned':
      return 'A verification check ran, but it is not a strong proof or grounded confirmation. Verify before relying on it.';
    case 'unverified':
    default:
      return 'No verification has been run on this claim. Call reason.verify to check it before relying on it.';
  }
}

export interface CapabilityBadgeProps {
  /** The real verdict returned by the `reason.verify` macro. Pass `null`/
   * `undefined` (or omit) when no verification has been run yet — the badge
   * renders the honest "Unverified" tier, never a placeholder "proven". */
  verdict?: CapabilityVerdict | null;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * CapabilityBadge — the platform-wide honest verification badge. A pure
 * function of `verdict`; never calls the macro itself and never fabricates a
 * confidence figure it wasn't given.
 */
export function CapabilityBadge({ verdict, size = 'sm', className }: CapabilityBadgeProps) {
  const tier = capabilityTierFor(verdict);
  const { icon: Icon, text, label } = TIER_STYLE[tier];
  const iconSize = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  const textSize = size === 'md' ? 'text-xs' : 'text-[10px]';
  // Only ever shown when a REAL number came back on a real verdict — never
  // computed or guessed by this component.
  const hasConfidence = tier !== 'unverified' && typeof verdict?.confidence === 'number';
  const pct = hasConfidence ? ` ${Math.round((verdict!.confidence as number) * 100)}%` : '';

  return (
    <span
      className={cn('inline-flex items-center gap-1 font-medium', textSize, text, className)}
      title={tierTitle(tier, verdict)}
      data-capability-tier={tier}
    >
      <Icon className={iconSize} />
      {label}
      {hasConfidence && (
        <span className="opacity-70 font-normal">{pct}</span>
      )}
    </span>
  );
}

export default CapabilityBadge;

// Note on ConKay: components/conkay/ConKayViz.tsx already has an inline
// VerdictBadge/TrustBadge pinned by tests/components/ConKayVerdictBadge.test.tsx.
// It renders a superset of behavior this component intentionally doesn't
// replicate — a "pending…" shimmer state, and a separate "· council 82%"
// judged-by annotation appended INSIDE the badge text specifically for
// chat-message layout. Swapping ConKay over to this shared component would
// mean either dropping those chat-specific behaviors or growing this
// component to carry chat-layout concerns it shouldn't own — not a clean
// swap, so ConKay's badge was left as-is. New platform surfaces (any lens,
// any DTU/claim presentation outside ConKay's chat thread) should use
// CapabilityBadge as the canonical export instead of hand-rolling another
// bespoke verdict renderer.
