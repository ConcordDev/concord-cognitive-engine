import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapabilityBadge, capabilityTierFor } from '@/components/common/CapabilityBadge';

/**
 * CapabilityBadge — the platform-wide honest verification badge. It is a pure
 * function of the `verdict` prop, which is the REAL shape `reason.verify`
 * returns (server/lib/reason-verify.js#verifyClaim). Nothing here is a guess:
 * a missing verdict must render "Unverified", never a fabricated "Proven".
 */

describe('CapabilityBadge — honest verdict rendering', () => {
  it('renders Proven for a council-confirmed "grounded" verdict', () => {
    render(
      <CapabilityBadge
        verdict={{ ok: true, verdict: 'grounded', mode: 'council', confidence: 0.82 }}
      />
    );
    expect(screen.getByText(/Proven/)).toBeInTheDocument();
    // The REAL confidence the council reported, not a guess.
    expect(screen.getByText(/82%/)).toBeInTheDocument();
  });

  it('renders Proven for a Z3 machine-checked "proven" verdict', () => {
    render(<CapabilityBadge verdict={{ ok: true, verdict: 'proven', mode: 'proof', confidence: 1 }} />);
    expect(screen.getByText(/Proven/)).toBeInTheDocument();
  });

  it('renders Reasoned for a reasoned-only "citations_resolve" verdict (no judge ran)', () => {
    render(<CapabilityBadge verdict={{ ok: true, verdict: 'citations_resolve', mode: 'deterministic' }} />);
    expect(screen.getByText(/Reasoned/)).toBeInTheDocument();
  });

  it('renders Reasoned for a council "unsupported" verdict without inventing a confidence figure', () => {
    render(<CapabilityBadge verdict={{ ok: true, verdict: 'unsupported', mode: 'council', confidence: null }} />);
    const badge = screen.getByText(/Reasoned/);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).not.toMatch(/%/); // no fabricated confidence
  });

  it('renders Flagged (not softened into Reasoned) for a fabricated citation', () => {
    render(<CapabilityBadge verdict={{ ok: true, verdict: 'fabricated_citation' }} />);
    expect(screen.getByText(/Flagged/)).toBeInTheDocument();
    expect(screen.queryByText(/Reasoned/)).toBeNull();
  });

  it('renders Flagged for a Z3-refuted verdict', () => {
    render(<CapabilityBadge verdict={{ ok: true, verdict: 'refuted', mode: 'proof', confidence: 1 }} />);
    expect(screen.getByText(/Flagged/)).toBeInTheDocument();
  });

  it('renders Unverified when no verdict object was supplied at all', () => {
    render(<CapabilityBadge verdict={null} />);
    expect(screen.getByText(/Unverified/)).toBeInTheDocument();
  });

  it('renders Unverified when the verdict prop is omitted entirely', () => {
    render(<CapabilityBadge />);
    expect(screen.getByText(/Unverified/)).toBeInTheDocument();
  });

  it('renders Unverified when the verdict object is not ok (e.g. { ok: false, reason: "no_db" })', () => {
    render(<CapabilityBadge verdict={{ ok: false } as any} />);
    expect(screen.getByText(/Unverified/)).toBeInTheDocument();
  });

  describe('capabilityTierFor — pure classification', () => {
    it('maps grounded/proven to the proven tier', () => {
      expect(capabilityTierFor({ ok: true, verdict: 'grounded' })).toBe('proven');
      expect(capabilityTierFor({ ok: true, verdict: 'proven' })).toBe('proven');
    });

    it('maps refuted/fabricated_citation to the flagged tier', () => {
      expect(capabilityTierFor({ ok: true, verdict: 'refuted' })).toBe('flagged');
      expect(capabilityTierFor({ ok: true, verdict: 'fabricated_citation' })).toBe('flagged');
    });

    it('maps citations_resolve/unsupported/unverified(string) to the reasoned tier', () => {
      expect(capabilityTierFor({ ok: true, verdict: 'citations_resolve' })).toBe('reasoned');
      expect(capabilityTierFor({ ok: true, verdict: 'unsupported' })).toBe('reasoned');
      expect(capabilityTierFor({ ok: true, verdict: 'unverified' })).toBe('reasoned');
    });

    it('maps a missing/null/not-ok verdict to the unverified tier', () => {
      expect(capabilityTierFor(null)).toBe('unverified');
      expect(capabilityTierFor(undefined)).toBe('unverified');
      expect(capabilityTierFor({ ok: false, verdict: 'grounded' })).toBe('unverified');
      expect(capabilityTierFor({ ok: true })).toBe('unverified');
    });
  });
});
