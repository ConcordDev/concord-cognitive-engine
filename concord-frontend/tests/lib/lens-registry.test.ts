import { describe, it, expect } from 'vitest';
import {
  LENS_REGISTRY,
  CORE_LENSES,
  getLensById,
  getCoreLenses,
  getCoreLensConfig,
} from '@/lib/lens-registry';

describe('LENS_REGISTRY', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(LENS_REGISTRY)).toBe(true);
    expect(LENS_REGISTRY.length).toBeGreaterThan(0);
  });

  it('every lens has required fields', () => {
    for (const lens of LENS_REGISTRY) {
      expect(lens.id).toBeDefined();
      expect(typeof lens.id).toBe('string');
      expect(lens.name).toBeDefined();
      expect(typeof lens.name).toBe('string');
      expect(lens.path).toBeDefined();
      expect(typeof lens.path).toBe('string');
      expect(lens.category).toBeDefined();
    }
  });

  it('has no duplicate IDs', () => {
    const ids = LENS_REGISTRY.map(l => l.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all paths start with /', () => {
    for (const lens of LENS_REGISTRY) {
      expect(lens.path.startsWith('/')).toBe(true);
    }
  });

  it('most paths follow /lenses/ convention', () => {
    const lensesPaths = LENS_REGISTRY.filter(l => l.path.startsWith('/lenses/'));
    // The vast majority should follow the convention
    expect(lensesPaths.length / LENS_REGISTRY.length).toBeGreaterThan(0.9);
  });

  it('every lens has an order number', () => {
    for (const lens of LENS_REGISTRY) {
      expect(typeof lens.order).toBe('number');
    }
  });
});

describe('CORE_LENSES', () => {
  it('has exactly 6 core lenses', () => {
    expect(CORE_LENSES).toHaveLength(6);
  });

  it('includes chat, board, graph, code, studio, world', () => {
    const ids = CORE_LENSES.map(l => l.id);
    expect(ids).toContain('chat');
    expect(ids).toContain('board');
    expect(ids).toContain('graph');
    expect(ids).toContain('code');
    expect(ids).toContain('studio');
    expect(ids).toContain('world');
  });

  it('each core lens has absorbedLensIds array', () => {
    for (const core of CORE_LENSES) {
      expect(Array.isArray(core.absorbedLensIds)).toBe(true);
    }
  });
});

describe('getLensById', () => {
  it('finds chat lens', () => {
    const lens = getLensById('chat');
    expect(lens).toBeDefined();
    expect(lens?.name).toBe('Chat');
    expect(lens?.category).toBe('core');
  });

  it('finds graph lens', () => {
    const lens = getLensById('graph');
    expect(lens).toBeDefined();
    expect(lens?.name).toBe('Graph');
  });

  it('returns undefined for unknown id', () => {
    expect(getLensById('nonexistent-lens-xyz')).toBeUndefined();
  });
});

describe('getCoreLenses', () => {
  it('returns only core category lenses', () => {
    const cores = getCoreLenses();
    for (const lens of cores) {
      expect(lens.category).toBe('core');
    }
  });

  it('returns at least 5 core lenses', () => {
    expect(getCoreLenses().length).toBeGreaterThanOrEqual(5);
  });
});

describe('getCoreLensConfig', () => {
  it('returns config for chat', () => {
    const config = getCoreLensConfig('chat');
    expect(config).toBeDefined();
    expect(config?.path).toBe('/lenses/chat');
    expect(config?.color).toBeDefined();
  });

  it('returns undefined for invalid id', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getCoreLensConfig('invalid' as any)).toBeUndefined();
  });
});
