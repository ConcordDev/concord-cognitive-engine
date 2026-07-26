/**
 * TheVault — visual foundation contract.
 *
 * This pins the collaborator's locked visual brief as executable assertions,
 * so a later edit that quietly violates it turns a named test red instead of
 * just looking slightly wrong:
 *
 *   · almost entirely grayscale, ONE accent, and every text role clears WCAG AA
 *   · EXACTLY two typefaces — no mono, no third face
 *   · LIGHT, not dark — no dark-surface token may leak into the Vault
 *   · texture is real (grain / letterpress / emboss actually defined in CSS)
 *   · motion is still — no bounce, and reduced-motion is honored
 *   · the serif addition does NOT regress the 12 files using `font-serif`
 *
 * Contrast is RECOMPUTED here from the hex values rather than trusted from
 * the recorded table, so the numbers in `VAULT_CONTRAST` can't silently rot.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { SPACING_SCALE, TYPE_SCALE } from '@/lib/design-system';
import {
  VAULT_COLOR,
  VAULT_CONTRAST,
  VAULT_TEXT_ROLES,
  VAULT_TYPE,
  VAULT_FONT,
  VAULT_TEXTURE,
  VAULT_MOTION,
  VAULT_RHYTHM,
  AA_TEXT_MIN,
  AA_NONTEXT_MIN,
  vaultSpace,
  vault,
} from '@/lib/vault/tokens';

/* ── WCAG 2.x relative luminance / contrast, computed not asserted ──────── */

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}
function linearize(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PAPERS = [VAULT_COLOR.paper, VAULT_COLOR.card, VAULT_COLOR.sunk];

const REPO = path.resolve(__dirname, '..');
const GLOBALS_CSS = readFileSync(path.join(REPO, 'app', 'globals.css'), 'utf8');
const LAYOUT_TSX = readFileSync(path.join(REPO, 'app', 'layout.tsx'), 'utf8');
const TAILWIND = createRequire(import.meta.url)(
  path.join(REPO, 'tailwind.config.js'),
) as {
  theme: { extend: { colors: Record<string, unknown>; fontFamily: Record<string, string[]> } };
};

/** Every class string the Vault ships, flattened for leak-scanning. */
const ALL_CLASS_STRINGS: string[] = [
  ...Object.values(vault),
  ...Object.values(VAULT_TYPE).map((t) => t.className),
  ...Object.values(VAULT_TEXTURE),
];

describe('TheVault — palette is grayscale + one accent, and legible on paper', () => {
  it('every text role clears WCAG AA (4.5:1) on all three paper surfaces', () => {
    for (const role of VAULT_TEXT_ROLES) {
      for (const paper of PAPERS) {
        const ratio = contrast(VAULT_COLOR[role], paper);
        expect(
          ratio,
          `${role} (${VAULT_COLOR[role]}) on ${paper} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_TEXT_MIN);
      }
    }
  });

  it('brassLine clears the 3:1 non-text minimum so it is a legal control border', () => {
    for (const paper of PAPERS) {
      expect(contrast(VAULT_COLOR.brassLine, paper)).toBeGreaterThanOrEqual(AA_NONTEXT_MIN);
    }
  });

  it('the decorative hairline is NOT strong enough to be a control border (documented limit)', () => {
    // `rule` is deliberately below 3:1 — it is a drawn hairline, not a border
    // of an interactive control. `ruleStrong` exists for that. Pinning the
    // limit stops a future edit from quietly using `rule` on a button.
    expect(contrast(VAULT_COLOR.rule, VAULT_COLOR.paper)).toBeLessThan(AA_NONTEXT_MIN);
    expect(VAULT_TEXTURE.ruleStrong).toBe('vault-rule-strong');
  });

  it('the recorded VAULT_CONTRAST table matches freshly computed values', () => {
    const recorded: Record<string, readonly number[]> = {
      ink: VAULT_CONTRAST.ink,
      graphite: VAULT_CONTRAST.graphite,
      gray: VAULT_CONTRAST.gray,
      brass: VAULT_CONTRAST.brass,
      brassLine: VAULT_CONTRAST.brassLine,
      rule: VAULT_CONTRAST.rule,
    };
    for (const [role, rows] of Object.entries(recorded)) {
      PAPERS.forEach((paper, i) => {
        const actual = contrast(VAULT_COLOR[role as keyof typeof VAULT_COLOR], paper);
        expect(actual, `${role} vs ${paper}`).toBeCloseTo(rows[i], 1);
      });
    }
  });

  it('rejects the pre-existing accent-warm token as Vault Gold, with the measurement to prove it', () => {
    // #E8A44C was unclaimed and looked like a free brass. It is a dark-surface
    // amber: it fails AA for text AND fails the 3:1 non-text minimum on paper.
    const onPaper = contrast('#E8A44C', VAULT_COLOR.paper);
    expect(onPaper).toBeLessThan(AA_NONTEXT_MIN);
    expect(onPaper).toBeCloseTo(VAULT_CONTRAST.accentWarmRejected[0], 1);
    expect(VAULT_COLOR.brass).not.toBe('#E8A44C');
    // ...and it is still present, untouched, for the dark surfaces it suits.
    expect(TAILWIND.theme.extend.colors['accent-warm']).toBe('#E8A44C');
  });

  it('is light, not dark — every surface is far brighter than the ceremonial black', () => {
    for (const paper of PAPERS) {
      expect(luminance(paper)).toBeGreaterThan(0.8);
    }
    expect(luminance(VAULT_COLOR.ceremonial)).toBeLessThan(0.02);
  });

  it('mirrors exactly into tailwind.config.js colors.vault', () => {
    expect(TAILWIND.theme.extend.colors.vault).toEqual({ ...VAULT_COLOR });
  });
});

describe('TheVault — exactly two typefaces', () => {
  it('every type role uses the serif or the sans, and nothing else', () => {
    for (const [role, token] of Object.entries(VAULT_TYPE)) {
      const expected = token.family === 'serif' ? VAULT_FONT.serif : VAULT_FONT.sans;
      expect(token.className, role).toContain(expected);
    }
  });

  it('never reaches for a third face — no mono anywhere, numerics use tabular sans', () => {
    for (const cls of ALL_CLASS_STRINGS) {
      expect(cls).not.toMatch(/\bfont-mono\b/);
    }
    // Accession numbers get figure alignment WITHOUT loading a mono face.
    expect(VAULT_TYPE.accession.family).toBe('sans');
    expect(VAULT_TYPE.accession.className).toContain('tabular-nums');
  });

  it('uses the distinct font-vault key, never the shared font-serif', () => {
    // Critical no-regression check: 17 call sites across 12 other files rely
    // on `font-serif` resolving to Tailwind's default Georgia stack.
    for (const cls of ALL_CLASS_STRINGS) {
      expect(cls).not.toMatch(/\bfont-serif\b/);
    }
    expect(TAILWIND.theme.extend.fontFamily.vault).toBeDefined();
    expect(TAILWIND.theme.extend.fontFamily.vault[0]).toBe('var(--font-vault-serif)');
    expect(TAILWIND.theme.extend.fontFamily.serif).toBeUndefined();
  });

  it('wires the serif through next/font in the root layout, like the other two faces', () => {
    expect(LAYOUT_TSX).toMatch(/Source_Serif_4/);
    expect(LAYOUT_TSX).toMatch(/variable:\s*'--font-vault-serif'/);
    // The variable must actually reach the DOM or `font-vault` resolves to the
    // Georgia fallback and the whole face is silently inert.
    expect(LAYOUT_TSX).toMatch(/sourceSerif\.variable/);
  });
});

describe('TheVault — no dark-surface leakage (it is a self-contained light island)', () => {
  it('no Vault class string carries a dark-surface token', () => {
    for (const cls of ALL_CLASS_STRINGS) {
      expect(cls, cls).not.toMatch(/\btext-white\b/);
      expect(cls, cls).not.toMatch(/\bbg-lattice/);
      expect(cls, cls).not.toMatch(/\bneon-/);
    }
  });

  it('all Vault CSS is namespaced so it cannot reach another lens', () => {
    const block = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('THEVAULT'));
    expect(block.length).toBeGreaterThan(0);
    const selectors = block.match(/^\s*\.[a-zA-Z-]+[^{]*\{/gm) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) {
      expect(sel.trim(), sel).toMatch(/^\.vault-/);
    }
  });
});

describe('TheVault — texture is real, not decorative intent', () => {
  it('defines a rule for every texture and motion class it exports', () => {
    const declared = [
      ...Object.values(VAULT_TEXTURE).flatMap((c) => c.split(' ')),
      ...Object.values(VAULT_MOTION.class),
    ];
    for (const cls of new Set(declared)) {
      expect(GLOBALS_CSS, `.${cls} has no CSS rule`).toContain(`.${cls}`);
    }
  });

  it('paper grain is a real generated noise field, not a flat tint', () => {
    expect(GLOBALS_CSS).toContain('feTurbulence');
    expect(GLOBALS_CSS).toContain("type='fractalNoise'");
    // Subtle was the brief's own word — keep the overlay under 5%.
    const opacity = GLOBALS_CSS.match(/\.vault-paper::before\s*\{[\s\S]*?opacity:\s*([\d.]+)/);
    expect(opacity).not.toBeNull();
    expect(Number(opacity![1])).toBeLessThan(0.05);
    expect(Number(opacity![1])).toBeGreaterThan(0);
  });

  it('letterpress presses type into the sheet and emboss raises the plate', () => {
    expect(GLOBALS_CSS).toMatch(/\.vault-letterpress\s*\{[\s\S]*?text-shadow:/);
    expect(GLOBALS_CSS).toMatch(/\.vault-emboss\s*\{[\s\S]*?inset/);
    expect(GLOBALS_CSS).toMatch(/\.vault-deboss\s*\{[\s\S]*?inset/);
  });
});

describe('TheVault — motion is still', () => {
  it('uses the zero-overshoot expo-out curve, never a bouncing one', () => {
    const block = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('THEVAULT'));
    const animations = block.match(/animation:\s*vault-[a-z]+\s+\d+ms\s+([^;]+);/g) ?? [];
    expect(animations.length).toBeGreaterThanOrEqual(3);
    for (const a of animations) {
      expect(a).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
    }
    expect(VAULT_MOTION.easing).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
  });

  it('never scales or rotates — reveal travel is small and translate-only', () => {
    const keyframes = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('@keyframes vault-reveal'));
    const body = keyframes.slice(0, keyframes.indexOf('}\n}') + 3);
    expect(body).toContain('translateY(6px)');
    expect(body).not.toMatch(/scale\(/);
    expect(body).not.toMatch(/rotate\(/);
  });

  it('the ceremonial curve is roughly double the routine reveal', () => {
    expect(VAULT_MOTION.duration.ceremonial).toBeGreaterThan(VAULT_MOTION.duration.reveal * 1.8);
  });

  it('overrides the global transition-all so controls change color but never move', () => {
    const block = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('THEVAULT'));
    const still = block.match(/\.vault-surface button,[\s\S]*?transition-property:\s*([^;]+);/);
    expect(still).not.toBeNull();
    expect(still![1]).not.toContain('transform');
    expect(still![1]).not.toContain('all');
  });

  it('honors the OS-level reduced-motion signal, not just the in-app class hook', () => {
    expect(GLOBALS_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const query = GLOBALS_CSS.slice(GLOBALS_CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(query).toContain('.vault-reveal');
    expect(query).toContain('.vault-ceremonial');
    expect(query).toContain('animation: none');
  });

  it('replaces the neon-cyan focus ring with brass, and clears the box-shadow ring', () => {
    const focus = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('.vault-surface :focus-visible'));
    const rule = focus.slice(0, focus.indexOf('}') + 1);
    expect(rule).toContain(VAULT_COLOR.brass);
    // Tailwind's ring is box-shadow based — an outline alone would not win.
    expect(rule).toContain('box-shadow: none');
    expect(contrast(VAULT_COLOR.brass, VAULT_COLOR.paper)).toBeGreaterThanOrEqual(AA_NONTEXT_MIN);
  });
});

describe('TheVault — reuses the platform rhythm rather than inventing one', () => {
  it('every type role size comes verbatim from TYPE_SCALE', () => {
    const sizes = new Set(Object.values(TYPE_SCALE).map((t) => t.fontSize));
    for (const [role, token] of Object.entries(VAULT_TYPE)) {
      expect(sizes.has(token.fontSize), `${role} size ${token.fontSize} is off-scale`).toBe(true);
    }
  });

  it('only the long-form serif reading roles open their leading, and sizes never change', () => {
    const adjusted = Object.entries(VAULT_TYPE).filter(([, t]) => t.leadingAdjusted);
    expect(adjusted.map(([k]) => k).sort()).toEqual(['body', 'bodySm']);
    for (const [, token] of adjusted) {
      expect(token.family).toBe('serif');
    }
    // Size still tracks the platform scale exactly; only leading opened.
    expect(VAULT_TYPE.body.fontSize).toBe(TYPE_SCALE.body.fontSize);
    expect(VAULT_TYPE.body.lineHeight).not.toBe(TYPE_SCALE.body.lineHeight);
    expect(parseFloat(VAULT_TYPE.body.lineHeight)).toBeGreaterThan(
      parseFloat(TYPE_SCALE.body.lineHeight),
    );
  });

  it('every rhythm role resolves to a real SPACING_SCALE step', () => {
    for (const role of Object.keys(VAULT_RHYTHM) as (keyof typeof VAULT_RHYTHM)[]) {
      const token = vaultSpace(role);
      expect(token).toBe(SPACING_SCALE[VAULT_RHYTHM[role]]);
      expect(token.px % 4).toBe(0);
    }
    expect(vaultSpace('platePad')).toBe(SPACING_SCALE.lg);
    expect(vaultSpace('wallPad')).toBe(SPACING_SCALE['3xl']);
  });

  it('imports no color class from the dark design system', () => {
    const source = readFileSync(path.join(REPO, 'lib', 'vault', 'tokens.ts'), 'utf8');
    // It may import the rhythm scales; it must not import `ds` itself.
    expect(source).toMatch(/import \{ SPACING_SCALE, TYPE_SCALE/);
    expect(source).not.toMatch(/import \{[^}]*\bds\b[^}]*\} from '@\/lib\/design-system'/);
  });
});

describe('TheVault — the tokens actually apply when rendered', () => {
  it('composes a wall, a plate, and a label with the expected classes on the DOM', () => {
    render(
      <div data-testid="wall" className={vault.wall}>
        <article data-testid="plate" className={`${vault.plate} ${VAULT_MOTION.class.reveal}`}>
          <h1 data-testid="title" className={vault.titlePressed} />
          <p data-testid="label" className={vault.label} />
          <p data-testid="body" className={vault.body} />
          <button data-testid="action" type="button" className={vault.buttonAccent} />
        </article>
      </div>,
    );

    // The surface marker must be present — every focus + stillness override
    // in globals.css is scoped under `.vault-surface`.
    expect(screen.getByTestId('wall')).toHaveClass('vault-surface', 'vault-paper');
    expect(screen.getByTestId('wall')).toHaveClass('text-vault-ink');

    expect(screen.getByTestId('plate')).toHaveClass('vault-plate', 'vault-reveal');

    // Serif + letterpress on the display line.
    expect(screen.getByTestId('title')).toHaveClass('font-vault', 'vault-letterpress-deep');

    // Sans, tracked, uppercase — the wall-label metadata key.
    expect(screen.getByTestId('label')).toHaveClass('font-sans', 'uppercase');

    // Serif reading text, with the opened leading.
    expect(screen.getByTestId('body')).toHaveClass('font-vault', 'leading-[1.75rem]');

    // The single emphasized action carries the accent; nothing else does.
    expect(screen.getByTestId('action')).toHaveClass('bg-vault-brass', 'text-vault-paper');
  });

  it('keeps the accent sparing — only one token in the composed set fills with brass', () => {
    const brassFilled = Object.entries(vault).filter(([, v]) => v.includes('bg-vault-brass '));
    expect(brassFilled).toHaveLength(1);
    expect(brassFilled[0][0]).toBe('buttonAccent');
  });
});
