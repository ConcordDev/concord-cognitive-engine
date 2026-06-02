// Classification helpers for the import-smoke harness.
//
// The test itself globs the source tree with vite's `import.meta.glob` (the only
// reliable way to dynamically import-by-pattern under vite/vitest). This module
// just classifies the resulting keys.

// Subtrees that genuinely cannot load under jsdom — they pull in Three.js / Rapier
// WASM / WebGL / Web Workers at module-eval time. They need a real browser /
// integration harness, not this net. Skipped explicitly (auditable), NOT hidden in
// the generated allowlist. Drive this list DOWN as 3D test infra lands.
export const JSDOM_INCOMPATIBLE: RegExp[] = [
  /(^|\/)world-lens\//,
  /(^|\/)concordia\//,
  /(^|\/)world\/(concordia-hud|concord-link|mahjong)\//,
  /\.worker\.(ts|tsx)$/,
];

export const EXCLUDE: RegExp[] = [
  /\.test\.(ts|tsx)$/,
  /\.d\.ts$/,
  /\.stories\.(ts|tsx)$/,
  /(^|\/)__mocks__\//,
];

/** Normalize an import.meta.glob key (e.g. "../../components/x.tsx") to a repo-relative path. */
export function relFromGlobKey(key: string): string {
  return key.replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
}

export function isExcluded(rel: string): boolean {
  return EXCLUDE.some((re) => re.test(rel));
}

export function isJsdomIncompatible(rel: string): boolean {
  return JSDOM_INCOMPATIBLE.some((re) => re.test(rel));
}
