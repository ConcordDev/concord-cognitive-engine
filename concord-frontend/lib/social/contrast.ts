/**
 * WCAG contrast helpers for the Social profile accent (job
 * oc-social-5, Social identity / JOB 8).
 *
 * Pure math, shared by the picker (client-side refusal) and mirrored in
 * server/lib/social-identity.js (server-side 400 rejection). The
 * background is the dark Social surface colour actually used behind the
 * avatar ring — the profile info card is `bg-lattice-surface`, i.e.
 * --lattice-surface in app/globals.css (#12121a).
 */

/** The dark Social surface the avatar ring sits on (app/globals.css --lattice-surface). */
export const SOCIAL_SURFACE_HEX = '#12121a';

/** WCAG AA for normal text — the bar an accent must clear. */
export const ACCENT_MIN_CONTRAST = 4.5;

/** Strict #rrggbb hex (case-insensitive input). Returns lowercase or null. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

/** Parse #rgb or #rrggbb to [r, g, b] (0-255), or null when invalid. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const norm = normalizeHex(hex);
  if (!norm) {
    const short = /^#?([0-9a-fA-F]{3})$/.exec(hex.trim());
    if (!short) return null;
    const [r, g, b] = short[1].split('');
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  return [
    parseInt(norm.slice(1, 3), 16),
    parseInt(norm.slice(3, 5), 16),
    parseInt(norm.slice(5, 7), 16),
  ];
}

/** WCAG 2.x relative luminance of an sRGB channel. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return (
    0.2126 * channelLuminance(rgb[0]) +
    0.7152 * channelLuminance(rgb[1]) +
    0.0722 * channelLuminance(rgb[2])
  );
}

/** WCAG contrast ratio (1..21), or null when either colour is invalid. */
export function contrastRatio(foreground: string, background: string): number | null {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  if (l1 === null || l2 === null) return null;
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Contrast of a candidate accent against the Social surface behind the avatar ring. */
export function accentContrast(hex: string): number | null {
  return contrastRatio(hex, SOCIAL_SURFACE_HEX);
}

export interface AccentCheck {
  valid: boolean;
  contrast: number | null;
  error: string | null;
}

/**
 * Validate an accent candidate: strict hex and ≥ 4.5:1 contrast against
 * the dark Social surface. Returns an honest error string for the UI.
 */
export function checkAccent(rawInput: string | null | undefined): AccentCheck {
  const hex = normalizeHex(rawInput);
  if (!hex) {
    return { valid: false, contrast: null, error: 'Accent must be a hex colour like #14b8a6.' };
  }
  const ratio = accentContrast(hex);
  if (ratio === null) {
    return { valid: false, contrast: null, error: 'Accent must be a hex colour like #14b8a6.' };
  }
  if (ratio < ACCENT_MIN_CONTRAST) {
    return {
      valid: false,
      contrast: ratio,
      error: `Accent needs at least ${ACCENT_MIN_CONTRAST}:1 contrast against the dark profile surface (currently ${ratio.toFixed(2)}:1). Pick a brighter colour.`,
    };
  }
  return { valid: true, contrast: ratio, error: null };
}