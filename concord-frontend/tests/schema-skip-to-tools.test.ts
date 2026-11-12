// FIX-schema-013 — reaching the schema lens tabs took ~70 Tabs: the
// AppShell skip link lands on <main>, but the tab strip sits behind
// the shell chrome and the page's header row, and nothing in the page
// offered a shorter path. The page now opens with an in-page skip
// affordance (revealed on focus, the AppShell skip-link pattern) that
// moves focus straight to the Schema tools nav, which is focusable
// for exactly that landing. Source-shape pins, as with the studio and
// import name guards.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.resolve(__dirname, '..', 'app', 'lenses', 'schema', 'page.tsx'), 'utf8');

describe('FIX-schema-013 — skip to schema tools', () => {
  it('the page opens with a focus-revealed skip link to the tab strip', () => {
    expect(page).toContain('href="#schema-tools"');
    expect(page).toContain('Skip to schema tools');
    expect(page).toContain('focus:not-sr-only');
    // The skip link precedes the header row and the tab nav in the page.
    const skipAt = page.indexOf('Skip to schema tools');
    const navAt = page.indexOf('aria-label="Schema tools"');
    expect(skipAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(skipAt);
  });

  it('the tab nav is the focusable landing target', () => {
    expect(page).toContain('id="schema-tools"');
    expect(page).toContain('tabIndex={-1}');
    expect(page).toContain("document.getElementById('schema-tools')?.focus()");
  });
});
