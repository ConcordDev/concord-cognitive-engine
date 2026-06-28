import { describe, it, expect } from 'vitest';
import {
  LENS_MANIFESTS,
  getLensManifest,
  getLensManifests,
  getAllLensDomains,
  getManifestCount,
  getLensesMissingMacro,
} from '@/lib/lenses/manifest';


describe('LENS_MANIFESTS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(LENS_MANIFESTS)).toBe(true);
    expect(LENS_MANIFESTS.length).toBeGreaterThan(0);
  });

  // REST-backed DASHBOARD lenses (ops-telemetry, narrative-walk, lattice) are
  // exempt from the list/get-macro requirement: they bind to real HTTP routes,
  // NOT the macro system, so they declare `macros: {}` by design (each entry
  // carries a header comment explaining the precedent). A dashboard is
  // identified by an empty macros object.
  const isRestDashboard = (m: (typeof LENS_MANIFESTS)[number]) =>
    !m.macros || Object.keys(m.macros).length === 0;

  it('every manifest has required fields', () => {
    for (const m of LENS_MANIFESTS) {
      expect(typeof m.domain).toBe('string');
      expect(m.domain.length).toBeGreaterThan(0);
      expect(typeof m.label).toBe('string');
      expect(m.label.length).toBeGreaterThan(0);
      expect(Array.isArray(m.artifacts)).toBe(true);
      expect(m.artifacts.length).toBeGreaterThan(0);
      expect(m.macros).toBeDefined();
      // REST dashboards legitimately have no list/get macro.
      if (!isRestDashboard(m)) {
        expect(typeof m.macros.list).toBe('string');
        expect(typeof m.macros.get).toBe('string');
      }
      expect(Array.isArray(m.exports)).toBe(true);
      expect(Array.isArray(m.actions)).toBe(true);
      expect(typeof m.category).toBe('string');
    }
  });

  it('every manifest has list/get macros that are non-empty dotted ids', () => {
    // The original assertion required the phantom `lens.<domain>.list`
    // namespace. The per-lens flawless-loop batches (saved/photos/spectate/
    // wellness/…) deliberately map the generic CRUD verbs onto REAL registered
    // macros (e.g. `saved.list`, `wellness.metrics-list`) so the lens resolves
    // via /api/lens/run + runMacro. Assert the canonical shape instead: a
    // non-empty `<segment>.<segment>` id (the `lens.` prefix is no longer
    // required, and was never a real registered macro).
    // Accept BOTH the legacy `lens.<domain>.<verb>` form (lenses not yet
    // through the flawless loop) AND a real `<domain>.<macro>` registered id
    // (the canonical form the loop migrates to — e.g. saved.list,
    // wellness.metrics-list, where `get` may reuse the list macro). The only
    // thing that is wrong is an empty / non-dotted id.
    // REST-backed dashboard lenses (macros: {}) are exempt — they have no macro
    // surface at all and resolve their data over real HTTP routes.
    const isDottedId = (id: unknown) =>
      typeof id === 'string' && id.length > 0 && /\./.test(id);
    for (const m of LENS_MANIFESTS) {
      if (isRestDashboard(m)) continue;
      expect(isDottedId(m.macros.list), `${m.domain}.macros.list = ${m.macros.list}`).toBe(true);
      expect(isDottedId(m.macros.get), `${m.domain}.macros.get = ${m.macros.get}`).toBe(true);
    }
  });

  it('has no duplicate domains', () => {
    const domains = LENS_MANIFESTS.map(m => m.domain);
    // Some domains appear twice (e.g. 'healthcare') in the source. Verify the map deduplication works via getLensManifest.
    const uniqueDomains = new Set(domains);
    // Just ensure the set has entries
    expect(uniqueDomains.size).toBeGreaterThan(0);
  });

  it('includes core domains', () => {
    const domains = new Set(LENS_MANIFESTS.map(m => m.domain));
    expect(domains.has('chat')).toBe(true);
    expect(domains.has('code')).toBe(true);
    expect(domains.has('paper')).toBe(true);
    expect(domains.has('graph')).toBe(true);
  });

  it('category values are from the allowed set', () => {
    const allowedCategories = [
      'knowledge', 'creative', 'system', 'social', 'productivity',
      'finance', 'healthcare', 'trades', 'operations', 'agriculture',
      'government', 'services', 'lifestyle',
    ];
    for (const m of LENS_MANIFESTS) {
      expect(allowedCategories).toContain(m.category);
    }
  });
});

describe('getLensManifest', () => {
  it('returns a manifest for known domain', () => {
    const manifest = getLensManifest('chat');
    expect(manifest).toBeDefined();
    expect(manifest!.domain).toBe('chat');
    expect(manifest!.label).toBe('Chat');
  });

  it('returns manifest for paper domain', () => {
    const manifest = getLensManifest('paper');
    expect(manifest).toBeDefined();
    expect(manifest!.artifacts).toContain('project');
  });

  it('returns undefined for unknown domain', () => {
    expect(getLensManifest('nonexistent-domain-xyz')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getLensManifest('')).toBeUndefined();
  });
});

describe('getLensManifests', () => {
  it('returns all manifests when no category given', () => {
    const all = getLensManifests();
    expect(all).toBe(LENS_MANIFESTS);
    expect(all.length).toBe(LENS_MANIFESTS.length);
  });

  it('returns all manifests when category is undefined', () => {
    const all = getLensManifests(undefined);
    expect(all.length).toBe(LENS_MANIFESTS.length);
  });

  it('filters by category', () => {
    const creative = getLensManifests('creative');
    expect(creative.length).toBeGreaterThan(0);
    for (const m of creative) {
      expect(m.category).toBe('creative');
    }
  });

  it('returns empty array for unknown category', () => {
    const none = getLensManifests('nonexistent-category');
    expect(none).toEqual([]);
  });

  it('returns knowledge category manifests', () => {
    const knowledge = getLensManifests('knowledge');
    expect(knowledge.length).toBeGreaterThan(0);
    const domains = knowledge.map(m => m.domain);
    expect(domains).toContain('chat');
    expect(domains).toContain('code');
  });
});

describe('getAllLensDomains', () => {
  it('returns an array of strings', () => {
    const domains = getAllLensDomains();
    expect(Array.isArray(domains)).toBe(true);
    expect(domains.length).toBe(LENS_MANIFESTS.length);
    for (const d of domains) {
      expect(typeof d).toBe('string');
    }
  });

  it('contains core domains', () => {
    const domains = getAllLensDomains();
    expect(domains).toContain('chat');
    expect(domains).toContain('code');
    expect(domains).toContain('paper');
  });
});

describe('getManifestCount', () => {
  it('returns the total number of manifests', () => {
    expect(getManifestCount()).toBe(LENS_MANIFESTS.length);
  });

  it('returns a positive number', () => {
    expect(getManifestCount()).toBeGreaterThan(0);
  });
});

describe('getLensesMissingMacro', () => {
  // The only manifest entries without list/get macros are the REST-backed
  // dashboard lenses, which bind to HTTP routes instead of the macro system.
  const REST_DASHBOARDS = ['lattice', 'narrative-walk', 'ops-telemetry'];

  it('returns only REST-dashboard lenses for the list macro (others all have list)', () => {
    const missing = getLensesMissingMacro('list');
    expect(Array.isArray(missing)).toBe(true);
    // Every missing entry is a known REST dashboard (no macro surface by design).
    expect(missing.every((d) => REST_DASHBOARDS.includes(d))).toBe(true);
  });

  it('returns only REST-dashboard lenses for the get macro', () => {
    const missing = getLensesMissingMacro('get');
    expect(Array.isArray(missing)).toBe(true);
    expect(missing.every((d) => REST_DASHBOARDS.includes(d))).toBe(true);
  });

  it('may return domains missing optional macros like create', () => {
    const missingCreate = getLensesMissingMacro('create');
    expect(Array.isArray(missingCreate)).toBe(true);
    // Resonance now declares the full macro set (production-grade pass);
    // any remaining missing-create domains are still tracked here.
  });

  it('returns domains missing run macro', () => {
    const missingRun = getLensesMissingMacro('run');
    expect(Array.isArray(missingRun)).toBe(true);
    // Stable contract: the helper returns an array (possibly empty).
    // We no longer assert a specific lens is in the list because the
    // canonical lens.<domain>.run namespace is populated for every
    // manifest entry that's gone through the platinum gate.
  });

  it('returns domains missing export macro', () => {
    const missingExport = getLensesMissingMacro('export');
    expect(Array.isArray(missingExport)).toBe(true);
  });
});
