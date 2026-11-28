/**
 * The lens contrast contract.
 *
 * Every lens has its own look (no two share a palette, per the redesign playbook),
 * so the kit does not hand out colours. It sets a contract instead: a lens's token
 * file defines these `--lk-*` tokens in its own colours, and each pair that carries
 * text or a control must reach its WCAG 2.2 ratio — in every mode the file defines
 * (base, light, dark). "Contrast theme tokens" was one of the November walk's largest
 * root causes (69 tickets); this check is meant to make it impossible to ship.
 *
 * `checkLensTokens(css)` parses the file and returns every pair that fails, with its
 * measured ratio. The ratio is the WCAG formula, computed, not estimated.
 */

export const REQUIRED_TOKENS = [
  '--lk-surface', '--lk-surface-raised', '--lk-text', '--lk-text-muted',
  '--lk-accent', '--lk-on-accent', '--lk-line', '--lk-ok', '--lk-warn', '--lk-danger',
] as const;

/** [foreground, background, minimum ratio, what it is] — WCAG 1.4.3 (text 4.5:1) and 1.4.11 (controls 3:1). */
export const CONTRAST_PAIRS: Array<[string, string, number, string]> = [
  ['--lk-text', '--lk-surface', 4.5, 'body text'],
  ['--lk-text', '--lk-surface-raised', 4.5, 'text on cards'],
  ['--lk-text-muted', '--lk-surface', 4.5, 'secondary text'],
  ['--lk-text-muted', '--lk-surface-raised', 4.5, 'secondary text on cards'],
  ['--lk-on-accent', '--lk-accent', 4.5, 'text on the accent (buttons, the active tab)'],
  ['--lk-accent', '--lk-surface', 3, 'the accent as a control or focus ring'],
  ['--lk-ok', '--lk-surface-raised', 4.5, 'pass text'],
  ['--lk-warn', '--lk-surface-raised', 4.5, 'warning text'],
  ['--lk-danger', '--lk-surface-raised', 4.5, 'failure text'],
];

export interface Rgb { r: number; g: number; b: number; a: number }

export function parseColor(v: string): Rgb | null {
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) { const [r, g, b, a] = [...h].map((c) => parseInt(c + c, 16)); return { r, g, b, a: h.length === 4 ? a / 255 : 1 }; }
    if (h.length === 6 || h.length === 8) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]); return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a }; }
  if (s === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  return null;
}

const channel = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = (c: Rgb) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
/** A translucent colour over an opaque one. */
export const over = (top: Rgb, bottom: Rgb): Rgb => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const b = bg.a < 1 ? over(bg, { r: 255, g: 255, b: 255, a: 1 }) : bg;
  const f = fg.a < 1 ? over(fg, b) : fg;
  const [l1, l2] = [luminance(f), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

type Mode = 'base' | 'light' | 'dark';
/** The --lk-* declarations a stylesheet makes, by mode. Comments are ignored; var() refers within the mode. */
export function readTokens(css: string): Record<Mode, Record<string, string>> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<Mode, Record<string, string>> = { base: {}, light: {}, dark: {} };
  const visit = (src: string, inDark: boolean) => {
    const re = /([^{}]+)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g; let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const sel = m[1].trim(), body = m[2];
      if (sel.startsWith('@media')) { visit(body, inDark || /prefers-color-scheme:\s*dark/.test(sel)); continue; }
      if (sel.startsWith('@')) continue;
      const mode: Mode = inDark || /\bdark\b|data-theme=['"]?dark/.test(sel) ? 'dark' : /\blight\b|data-theme=['"]?light/.test(sel) ? 'light' : 'base';
      for (const d of body.matchAll(/(--lk-[a-z0-9-]+)\s*:\s*([^;]+);?/g)) out[mode][d[1]] = d[2].trim();
    }
  };
  visit(text, false);
  return out;
}

export interface ContrastFailure { mode: Mode; fg: string; bg: string; ratio: number | null; min: number; what: string; detail?: string }

/** Every contrast-contract failure in a lens's token CSS (empty when it holds). */
export function checkLensTokens(css: string): { ok: boolean; failures: ContrastFailure[]; modes: Mode[] } {
  const t = readTokens(css);
  // the base block is a mode of its own (the app's default); each override is checked on top of it
  const modes: Mode[] = ['base', ...(['light', 'dark'] as Mode[]).filter((m) => Object.keys(t[m]).length)];
  const failures: ContrastFailure[] = [];
  for (const mode of modes) {
    const vars = { ...t.base, ...(mode === 'base' ? {} : t[mode]) };
    const resolve = (name: string, depth = 0): string | undefined => {
      const v = vars[name]; if (v === undefined || depth > 8) return v;
      const ref = /^var\(\s*(--lk-[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/.exec(v);
      return ref ? resolve(ref[1], depth + 1) ?? ref[2]?.trim() : v;
    };
    for (const tok of REQUIRED_TOKENS) if (resolve(tok) === undefined) failures.push({ mode, fg: tok, bg: '', ratio: null, min: 0, what: 'required token', detail: `${tok} is not defined` });
    for (const [fg, bg, min, what] of CONTRAST_PAIRS) {
      const fv = resolve(fg), bv = resolve(bg);
      if (fv === undefined || bv === undefined) continue; // reported as missing above
      const f = parseColor(fv), b = parseColor(bv);
      if (!f || !b) { failures.push({ mode, fg, bg, ratio: null, min, what, detail: `cannot read ${!f ? `${fg}: ${fv}` : `${bg}: ${bv}`} as a colour (use #hex or rgb())` }); continue; }
      const ratio = Math.round(contrastRatio(f, b) * 100) / 100;
      if (ratio < min) failures.push({ mode, fg, bg, ratio, min, what });
    }
  }
  return { ok: failures.length === 0, failures, modes };
}
