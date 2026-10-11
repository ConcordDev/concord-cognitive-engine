import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { LENS_REGISTRY } from '@/lib/lens-registry';
import { TAB_LABEL_REDIRECTS, redirectsForTabLabels, tabLabelRoute } from '@/lib/lens-tab-redirects';

const require = createRequire(import.meta.url);

describe('lens tabLabel redirects', () => {
  it('maps Threads and Visuals onto the canonical lens paths', () => {
    expect(tabLabelRoute('Threads')).toBe('/lenses/threads');
    expect(tabLabelRoute('Visuals')).toBe('/lenses/visuals');
    const redirects = redirectsForTabLabels(LENS_REGISTRY);
    expect(redirects).toEqual(expect.arrayContaining([
      { source: '/lenses/threads', destination: '/lenses/thread' },
      { source: '/lenses/visuals', destination: '/lenses/fractal' },
    ]));
    expect(TAB_LABEL_REDIRECTS).toEqual(redirects);
  });

  it('never aliases a path that is already a lens route', () => {
    const paths = new Set(LENS_REGISTRY.map((lens) => lens.path));
    for (const redirect of redirectsForTabLabels(LENS_REGISTRY)) {
      expect(paths.has(redirect.source)).toBe(false);
      expect(paths.has(redirect.destination)).toBe(true);
      expect(redirect.source).not.toBe(redirect.destination);
    }
  });

  it('next.config publishes every tabLabel alias as a permanent redirect', async () => {
    const nextConfig = require('../../next.config.js') as { redirects: () => Promise<{ source: string; destination: string; permanent: boolean }[]> };
    const published = await nextConfig.redirects();
    const aliases = redirectsForTabLabels(LENS_REGISTRY).map((alias) => ({ ...alias, permanent: true }));
    const permanentLenses = published.filter((entry) => entry.permanent && entry.source.startsWith('/lenses/'));
    expect(permanentLenses).toEqual(expect.arrayContaining(aliases));
    expect(permanentLenses).toHaveLength(aliases.length);
  });
});
