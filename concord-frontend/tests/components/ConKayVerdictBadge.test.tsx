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
