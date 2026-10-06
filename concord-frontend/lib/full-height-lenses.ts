// Lenses that fill the viewport as an app, with their own scroll regions and
// a composer docked at the bottom. The shell skips the legal footer on them
// (it would make the page itself scroll) and lifts floating launchers above
// the composer.
export const FULL_HEIGHT_LENSES: ReadonlySet<string> = new Set(['/lenses/world', '/lenses/chat', '/lenses/conkay']);

export function isFullHeightLens(pathname: string | null | undefined): boolean {
  return FULL_HEIGHT_LENSES.has(pathname ?? '');
}
