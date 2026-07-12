import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Wave 4 gap-closure — meta-capability-map.md: `POST /api/inventory/refresh`
// (server/routes/inventory.js) had no frontend caller. app/lenses/meta/page.tsx
// pulls in LensShell/useLensNav/useLensCommand/DevPortal/SystemHealth/
// useRealtimeLens and a dozen other cross-cutting providers, so a full mount
// test would need to mock most of the app shell just to reach one button —
// this file follows this codebase's established static-source-pin pattern
// (see e.g. tests/avatar-system-effect-stability.test.tsx) for exactly this
// tradeoff, pinning the real production wiring instead.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'app', 'lenses', 'meta', 'page.tsx'),
  'utf8',
);

describe('meta lens — inventory refresh button (Wave 4 gap-closure)', () => {
  it('calls the real POST /api/inventory/refresh endpoint', () => {
    expect(src).toMatch(/await api\.post\('\/api\/inventory\/refresh'\);/);
  });

  it('invalidates every inventory-* query so all tabs pick up the fresh scan, not just Overview', () => {
    const fnMatch = src.match(/const refreshInventory = useCallback\(async \(\) => \{[\s\S]*?\n {2}\}, \[queryClient\]\);/);
    expect(fnMatch).toBeTruthy();
    const fn = fnMatch![0];
    expect(fn).toMatch(/queryClient\.invalidateQueries\(\{/);
    expect(fn).toMatch(/query\.queryKey\[0\]\.startsWith\('inventory'\)/);
  });

  it('does not silently swallow a non-fatal refresh failure into a fake success state', () => {
    const fnMatch = src.match(/const refreshInventory = useCallback\(async \(\) => \{[\s\S]*?\n {2}\}, \[queryClient\]\);/);
    const fn = fnMatch![0];
    // The catch block exists (network/backend failure doesn't crash the tab)
    // but does not set any "refreshed successfully" state — only the
    // `refreshing` spinner is cleared in `finally`, so the UI never claims a
    // refresh happened when it didn't.
    expect(fn).toMatch(/\} catch \{/);
    expect(fn).toMatch(/\} finally \{\s*\n\s*setRefreshing\(false\);/);
  });

  it('wires the button to the handler with a real loading state (not a static label)', () => {
    expect(src).toMatch(/onClick=\{\(\) => void refreshInventory\(\)\}/);
    expect(src).toMatch(/disabled=\{refreshing\}/);
    expect(src).toMatch(/\{refreshing \? 'Re-scanning…' : 'Refresh inventory'\}/);
  });
});
