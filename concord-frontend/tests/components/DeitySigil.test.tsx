/**
 * DeitySigil — feature-build follow-up pass (#14 of 25 per
 * docs/FEATURE_BUILD_WALK_STATUS.md). Pins the deterministic mapping from a
 * deity's real toneVector (warmth/refusal/mystery, each 0..1) onto the
 * platform's real base-6 Refusal Algebra glyph set (server/lib/refusal-
 * algebra/glyphs.js) — round(value * 5) → digit → glyph. No invented
 * symbols; the six characters here must stay byte-identical to that file.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeitySigil } from '@/components/deities/DeitySigil';

describe('DeitySigil', () => {
  it('renders nothing (honest, no crash) when toneVector is missing', () => {
    const { container } = render(<DeitySigil toneVector={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('maps a 0.0 value to the Refusal glyph (digit 0)', () => {
    render(<DeitySigil toneVector={{ warmth: 0, refusal: 0.5, mystery: 1 }} />);
    expect(screen.getByLabelText('Warmth sigil: ⟐')).toBeInTheDocument();
  });

  it('maps a 1.0 value to the Refusal-Bridge glyph (digit 5, the top of the base-6 range)', () => {
    render(<DeitySigil toneVector={{ warmth: 0.5, refusal: 0.5, mystery: 1 }} />);
    expect(screen.getByLabelText('Mystery sigil: ⟐⊚')).toBeInTheDocument();
  });

  it('rounds a mid-range value to the nearest base-6 digit (0.5 -> round(2.5) -> digit 3 -> Refusal-Pivot)', () => {
    render(<DeitySigil toneVector={{ warmth: 0.5, refusal: 0, mystery: 0 }} />);
    expect(screen.getByLabelText('Warmth sigil: ⟐⟲')).toBeInTheDocument();
  });

  it('renders all three axes with their real values in the tooltip title', () => {
    render(<DeitySigil toneVector={{ warmth: 0.05, refusal: 0.9, mystery: 0.5 }} />);
    expect(screen.getByLabelText(/Warmth sigil/)).toHaveAttribute('title', expect.stringContaining('0.05'));
    expect(screen.getByLabelText(/Refusal sigil/)).toHaveAttribute('title', expect.stringContaining('0.90'));
    expect(screen.getByLabelText(/Mystery sigil/)).toHaveAttribute('title', expect.stringContaining('0.50'));
  });

  it('clamps an out-of-range value instead of producing an undefined glyph', () => {
    render(<DeitySigil toneVector={{ warmth: 1.5, refusal: -0.3, mystery: 0.5 }} />);
    // 1.5 clamps to 1 -> digit 5 -> ⟐⊚; -0.3 clamps to 0 -> digit 0 -> ⟐
    expect(screen.getByLabelText('Warmth sigil: ⟐⊚')).toBeInTheDocument();
    expect(screen.getByLabelText('Refusal sigil: ⟐')).toBeInTheDocument();
  });
});
