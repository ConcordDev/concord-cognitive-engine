// The splash homepage's modules import under the test environment (they declare
// next/font faces at module scope; tests/setup.ts mocks next/font/google).
import { describe, it, expect } from 'vitest';

describe('splash modules import under vitest', () => {
  it('fonts.ts gives each splash face a className', async () => {
    const f = await import('@/components/splash/fonts');
    expect(f.splashWordmarkFont.className).toMatch(/^font-montserrat$/);
    expect(f.splashQuoteFont.className).toMatch(/^font-instrument-serif$/);
  });

  it('SplashHome imports and exports a component', async () => {
    const m = await import('@/components/splash/SplashHome');
    const exported = Object.values(m).filter((x) => typeof x === 'function');
    expect(exported.length).toBeGreaterThan(0);
  });
});
