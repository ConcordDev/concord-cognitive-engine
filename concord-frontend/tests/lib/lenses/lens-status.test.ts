import { describe, it, expect } from 'vitest';
import {
  LENS_STATUS_MAP,
  getLensStatus,
  getLensesByStatus,
  getLensesMergingInto,
  getProductLenses,
  getDeprecatedLenses,
  isPublicLens,
  getLensStatusSummary,
} from '@/lib/lenses/lens-status';
import type { LensStatus } from '@/lib/lenses/lens-status';

describe('LENS_STATUS_MAP', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(LENS_STATUS_MAP)).toBe(true);
    expect(LENS_STATUS_MAP.length).toBeGreaterThan(0);
  });

  it('every entry has required fields', () => {
    for (const entry of LENS_STATUS_MAP) {
      expect(typeof entry.id).toBe('string');
      expect(entry.id.length).toBeGreaterThan(0);
      expect(['product', 'hybrid', 'viewer', 'system', 'deprecated']).toContain(entry.status);
      expect(['standalone', 'mode', 'engine', 'absorbed']).toContain(entry.postMergeRole);
      expect(typeof entry.rationale).toBe('string');
      expect(entry.rationale.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate IDs', () => {
    const ids = LENS_STATUS_MAP.map(e => e.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('product standalone lenses have no merge target', () => {
    const products = LENS_STATUS_MAP.filter(
      e => e.status === 'product' && e.postMergeRole === 'standalone',
    );
    for (const p of products) {
      expect(p.mergeTarget).toBeNull();
    }
  });

  it('deprecated lenses have a merge target', () => {
    const deprecated = LENS_STATUS_MAP.filter(e => e.status === 'deprecated');
    for (const d of deprecated) {
      expect(d.mergeTarget).not.toBeNull();
      expect(typeof d.mergeTarget).toBe('string');
    }
  });

  it('system lenses have no merge target', () => {
    const system = LENS_STATUS_MAP.filter(e => e.status === 'system');
    for (const s of system) {
      expect(s.mergeTarget).toBeNull();
    }
  });
});

describe('getLensStatus', () => {
  it('returns status entry for known lens', () => {
    const entry = getLensStatus('paper');
    expect(entry).toBeDefined();
    expect(entry!.id).toBe('paper');
    expect(entry!.status).toBe('product');
  });

  it('returns status entry for chat', () => {
    const entry = getLensStatus('chat');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('product');
    expect(entry!.postMergeRole).toBe('standalone');
  });

  it('returns status for deprecated lens', () => {
    const entry = getLensStatus('hypothesis');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('deprecated');
    expect(entry!.mergeTarget).toBe('paper');
  });

  it('returns status for system lens', () => {
    const entry = getLensStatus('admin');
    expect(entry).toBeDefined();
    expect(entry!.status).toBe('system');
  });

  it('returns undefined for unknown lens', () => {
    expect(getLensStatus('nonexistent-lens')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(getLensStatus('')).toBeUndefined();
  });
});

describe('getLensesByStatus', () => {
  it('returns product lenses', () => {
    const products = getLensesByStatus('product');
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect(p.status).toBe('product');
    }
  });

  it('returns hybrid lenses', () => {
    const hybrids = getLensesByStatus('hybrid');
    expect(hybrids.length).toBeGreaterThan(0);
    for (const h of hybrids) {
      expect(h.status).toBe('hybrid');
    }
  });

  it('returns viewer lenses', () => {
    const viewers = getLensesByStatus('viewer');
    expect(viewers.length).toBeGreaterThan(0);
    for (const v of viewers) {
      expect(v.status).toBe('viewer');
    }
  });

  it('returns system lenses', () => {
    const system = getLensesByStatus('system');
    expect(system.length).toBeGreaterThan(0);
    for (const s of system) {
      expect(s.status).toBe('system');
    }
  });

  it('returns deprecated lenses', () => {
    const deprecated = getLensesByStatus('deprecated');
    expect(deprecated.length).toBeGreaterThan(0);
    for (const d of deprecated) {
      expect(d.status).toBe('deprecated');
    }
  });

  it('total of all statuses equals LENS_STATUS_MAP length', () => {
    const statuses: LensStatus[] = ['product', 'hybrid', 'viewer', 'system', 'deprecated'];
    let total = 0;
    for (const s of statuses) {
      total += getLensesByStatus(s).length;
    }
    expect(total).toBe(LENS_STATUS_MAP.length);
  });
});

describe('getLensesMergingInto', () => {
  it('returns lenses merging into paper', () => {
    const mergingIntoPaper = getLensesMergingInto('paper');
    expect(mergingIntoPaper.length).toBeGreaterThan(0);
    const ids = mergingIntoPaper.map(e => e.id);
    expect(ids).toContain('hypothesis');
    expect(ids).toContain('reflection');
  });

  it('returns lenses merging into sim', () => {
    const mergingIntoSim = getLensesMergingInto('sim');
    expect(mergingIntoSim.length).toBeGreaterThan(0);
    const ids = mergingIntoSim.map(e => e.id);
    expect(ids).toContain('math');
    expect(ids).toContain('physics');
  });

  it('returns empty array for lens with no merge sources', () => {
    // Wallet is a leaf product lens — no other lens declares it as a
    // mergeTarget. (chat used to satisfy this but now hosts the
    // answers oracle as a hybrid mode.)
    const merging = getLensesMergingInto('wallet');
    expect(merging).toEqual([]);
  });

  it('returns empty array for unknown lens', () => {
    const merging = getLensesMergingInto('nonexistent');
    expect(merging).toEqual([]);
  });
});

describe('getProductLenses', () => {
  it('returns standalone product lenses', () => {
    const products = getProductLenses();
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect(p.status).toBe('product');
      expect(p.postMergeRole).toBe('standalone');
    }
  });

  it('includes core product lenses', () => {
    const ids = getProductLenses().map(p => p.id);
    expect(ids).toContain('paper');
    expect(ids).toContain('chat');
    expect(ids).toContain('code');
    expect(ids).toContain('graph');
  });

  it('includes super-lens product lenses', () => {
    const ids = getProductLenses().map(p => p.id);
    expect(ids).toContain('healthcare');
    expect(ids).toContain('legal');
    expect(ids).toContain('accounting');
  });
});

describe('getDeprecatedLenses', () => {
  it('returns deprecated lenses', () => {
    const deprecated = getDeprecatedLenses();
    expect(deprecated.length).toBeGreaterThan(0);
    for (const d of deprecated) {
      expect(d.status).toBe('deprecated');
    }
  });

  it('all deprecated lenses have merge targets', () => {
    const deprecated = getDeprecatedLenses();
    for (const d of deprecated) {
      expect(d.mergeTarget).not.toBeNull();
    }
  });

  it('includes known deprecated lenses', () => {
    const ids = getDeprecatedLenses().map(d => d.id);
    expect(ids).toContain('hypothesis');
    expect(ids).toContain('math');
    expect(ids).toContain('physics');
  });
});

describe('isPublicLens', () => {
  it('returns true for product lenses', () => {
    expect(isPublicLens('paper')).toBe(true);
    expect(isPublicLens('chat')).toBe(true);
    expect(isPublicLens('code')).toBe(true);
  });

  it('returns true for hybrid lenses', () => {
    expect(isPublicLens('vote')).toBe(true);
    expect(isPublicLens('music')).toBe(true);
  });

  it('returns false for system lenses', () => {
    expect(isPublicLens('admin')).toBe(false);
    expect(isPublicLens('debug')).toBe(false);
  });

  it('returns false for deprecated lenses', () => {
    expect(isPublicLens('hypothesis')).toBe(false);
    expect(isPublicLens('math')).toBe(false);
  });

  it('returns false for viewer lenses', () => {
    expect(isPublicLens('fractal')).toBe(false);
  });

  it('returns false for unknown lenses', () => {
    expect(isPublicLens('nonexistent')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPublicLens('')).toBe(false);
  });
});

describe('getLensStatusSummary', () => {
  it('returns counts for all statuses', () => {
    const summary = getLensStatusSummary();
    expect(typeof summary.product).toBe('number');
    expect(typeof summary.hybrid).toBe('number');
    expect(typeof summary.viewer).toBe('number');
    expect(typeof summary.system).toBe('number');
    expect(typeof summary.deprecated).toBe('number');
  });

  it('total counts match LENS_STATUS_MAP length', () => {
    const summary = getLensStatusSummary();
    const total = summary.product + summary.hybrid + summary.viewer + summary.system + summary.deprecated;
    expect(total).toBe(LENS_STATUS_MAP.length);
  });

  it('has positive count for each status', () => {
    const summary = getLensStatusSummary();
    expect(summary.product).toBeGreaterThan(0);
    expect(summary.hybrid).toBeGreaterThan(0);
    expect(summary.viewer).toBeGreaterThan(0);
    expect(summary.system).toBeGreaterThan(0);
    expect(summary.deprecated).toBeGreaterThan(0);
  });

  it('product count matches getLensesByStatus product count', () => {
    const summary = getLensStatusSummary();
    const products = getLensesByStatus('product');
    expect(summary.product).toBe(products.length);
  });
});
