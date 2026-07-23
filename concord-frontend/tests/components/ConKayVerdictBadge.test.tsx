import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConKayMessage, type ConKayReplyFields } from '@/components/conkay/ConKayViz';

/**
 * ConKay Phase 4 (multibrain loop) — the TrustBadge surfaces HOW reason.verify
 * reached its verdict, straight from the macro's returned mode + confidence.
 * Every value here is a real reason.verify return field; nothing is implied.
 */

const base: ConKayReplyFields = { content: 'The claim.' };
const renderMsg = (f: Partial<ConKayReplyFields>) =>
  render(<ConKayMessage fields={{ ...base, ...f }} renderProse={(t) => <span>{t}</span>} />);

describe('ConKay verdict badge — multibrain annotation', () => {
  it('a council-judged "grounded" verdict shows the council + real confidence', () => {
    renderMsg({ verifyVerdict: 'grounded', verifyMode: 'council', verifyConfidence: 0.82 });
    expect(screen.getByText(/Grounded/)).toBeInTheDocument();
    // 0.82 → "82%" — the REAL confidence the council reported, not a guess.
    expect(screen.getByText(/council\s*82%/i)).toBeInTheDocument();
  });

  it('a council "unsupported" verdict annotates council without inventing a percent when confidence is null', () => {
    renderMsg({ verifyVerdict: 'unsupported', verifyMode: 'council', verifyConfidence: null });
    expect(screen.getByText(/Unsupported/)).toBeInTheDocument();
    const council = screen.getByText(/council/i);
    expect(council).toBeInTheDocument();
    expect(council.textContent).not.toMatch(/%/); // no fabricated confidence
  });

  it('a Z3 "proven" verdict is self-labelled and does NOT show the council annotation', () => {
    renderMsg({ verifyVerdict: 'proven', verifyMode: 'proof', verifyConfidence: 1 });
    expect(screen.getByText(/Proven/)).toBeInTheDocument();
    expect(screen.queryByText(/council/i)).toBeNull();
  });

  it('a deterministic-floor verdict (no mode) shows no judged-by annotation', () => {
    renderMsg({ verifyVerdict: 'citations_resolve' });
    expect(screen.getByText(/Citations resolve/)).toBeInTheDocument();
    expect(screen.queryByText(/council/i)).toBeNull();
  });
});

/**
 * Grounded research mode (V1.1 R3) — `capabilityVerdict` (the client-side
 * adapted `reason.evaluate_answer` result) renders an ADDITIONAL
 * `CapabilityBadge` alongside the existing TrustBadge — dual-render, not a
 * swap. The existing verifyVerdict-only path (no `capabilityVerdict` at all)
 * must keep rendering exactly as before.
 */
describe('ConKay capability badge — grounded research mode dual-render', () => {
  it('no capabilityVerdict at all: only the existing TrustBadge renders, nothing new appears', () => {
    renderMsg({ verifyVerdict: 'grounded', verifyMode: 'council', verifyConfidence: 0.82 });
    expect(screen.getByText(/Grounded/)).toBeInTheDocument();
    // No second badge — CapabilityBadge is entirely absent when the field is unset.
    expect(screen.queryByText(/Proven ✓/)).toBeNull();
    expect(screen.queryByText(/^Flagged$/)).toBeNull();
    expect(screen.queryByText(/^Unverified$/)).toBeNull();
  });

  it('a successful evaluate_answer "grounded" verdict renders CapabilityBadge alongside TrustBadge', () => {
    renderMsg({
      verifyVerdict: 'grounded',
      verifyMode: 'council',
      verifyConfidence: 0.82,
      capabilityVerdict: { ok: true, verdict: 'grounded', mode: 'deterministic', confidence: 0.95 },
    });
    // The existing citation-only badge is untouched...
    expect(screen.getByText(/Grounded/)).toBeInTheDocument();
    // ...and the new whole-answer capability badge renders alongside it.
    expect(screen.getByText(/Proven ✓/)).toBeInTheDocument();
  });

  it('a failed/missing evaluation renders the honest "Unverified" tier — never a fabricated "grounded"', () => {
    renderMsg({
      verifyVerdict: 'citations_resolve',
      // The overlay's failure path stamps this exact `{ ok: false }` sentinel
      // (never a synthesized verdict string) when reason.evaluate_answer
      // throws, times out, or is unreachable.
      capabilityVerdict: { ok: false },
    });
    expect(screen.getByText(/Citations resolve/)).toBeInTheDocument();
    expect(screen.getByText(/^Unverified$/)).toBeInTheDocument();
    // Never a fake proven/grounded state on a failed check.
    expect(screen.queryByText(/Proven ✓/)).toBeNull();
  });

  it('an unrecognized/empty verdict object also falls back to "Unverified" — the component never guesses', () => {
    renderMsg({ capabilityVerdict: { ok: true, verdict: undefined } });
    expect(screen.getByText(/^Unverified$/)).toBeInTheDocument();
  });
});
