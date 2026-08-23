'use client';

/**
 * DeitySigil — a real per-tone-axis glyph sigil for a deity, replacing the
 * generic name+number card with something that visually encodes the
 * deity's actual composition. Each of the three tone axes (Warmth /
 * Refusal / Mystery) is a real 0..1 value on `toneVector`; this maps each
 * axis onto the platform's real base-6 Refusal Algebra numeral system
 * (server/lib/refusal-algebra/glyphs.js — six symbolic states: Refusal,
 * Pivot, Bridge, and three composites) rather than inventing new symbols.
 * The mapping is deterministic: round(value * 5) → the base-6 digit for
 * that axis → its real glyph character.
 *
 * This is genuinely the SAME glyph algebra that drives the Refusal Field
 * (world-event gating, compound-refusal detection) elsewhere in the
 * platform — reused here as a visual identity, not reinvented.
 */

// Mirrors server/lib/refusal-algebra/glyphs.js#GLYPHS exactly (6 fixed
// Unicode symbols, 0-5). Kept as a small local const rather than a network
// round-trip — there is no math here beyond a table lookup on a single
// digit, so duplicating the table client-side carries no drift risk as
// long as this comment and that file agree on the six symbols.
const BASE6_GLYPHS: Record<number, string> = {
  0: '⟐',   // Refusal
  1: '⟲',   // Pivot
  2: '⊚',   // Bridge
  3: '⟐⟲',  // Refusal-Pivot
  4: '⊚⟲',  // Bridge-Pivot
  5: '⟐⊚',  // Refusal-Bridge
};

export interface ToneVector {
  warmth: number;
  refusal: number;
  mystery: number;
}

const AXES: Array<{ key: keyof ToneVector; label: string; color: string }> = [
  { key: 'warmth', label: 'Warmth', color: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  { key: 'refusal', label: 'Refusal', color: 'text-rose-300 border-rose-500/30 bg-rose-500/10' },
  { key: 'mystery', label: 'Mystery', color: 'text-violet-300 border-violet-500/30 bg-violet-500/10' },
];

function toDigit(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 5);
}

export function DeitySigil({ toneVector, size = 'sm' }: { toneVector: ToneVector | undefined | null; size?: 'sm' | 'lg' }) {
  if (!toneVector) return null;
  const glyphSize = size === 'lg' ? 'h-9 w-9 text-lg' : 'h-6 w-6 text-sm';
  return (
    <div className="flex items-center gap-1.5" title="Tone sigil — base-6 Refusal Algebra glyph per axis">
      {AXES.map(({ key, label, color }) => {
        const value = toneVector[key];
        const digit = toDigit(value ?? 0);
        const glyph = BASE6_GLYPHS[digit];
        return (
          <div
            key={key}
            className={`flex ${glyphSize} items-center justify-center rounded-full border font-mono ${color}`}
            title={`${label}: ${value != null ? value.toFixed(2) : '0.00'} (${glyph})`}
            aria-label={`${label} sigil: ${glyph}`}
          >
            {glyph}
          </div>
        );
      })}
    </div>
  );
}

export default DeitySigil;
