import { describe, it, expect } from 'vitest';
import { nodeVisual } from '@/lib/world-lens/resource-node-renderer';

describe('nodeVisual — pure resource-node visual descriptor', () => {
  describe('scale tracks remaining/max', () => {
    it('a full node renders at scale 1.0', () => {
      const v = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      expect(v.scale).toBe(1.0);
    });

    it('a near-empty node shrinks toward the floor', () => {
      const full = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      const nearEmpty = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 1,
        max_quantity: 100,
      });
      expect(nearEmpty.scale).toBeLessThan(full.scale);
      // 0.35 + 0.65 * 0.01 = 0.3565
      expect(nearEmpty.scale).toBeCloseTo(0.3565, 4);
    });

    it('scale decreases monotonically as quantity drops', () => {
      const ratios = [100, 75, 50, 25, 10, 1];
      const scales = ratios.map((q) =>
        nodeVisual({
          node_type: 'ore_vein',
          quantity_remaining: q,
          max_quantity: 100,
        }).scale,
      );
      for (let i = 1; i < scales.length; i++) {
        expect(scales[i]).toBeLessThan(scales[i - 1]);
      }
    });

    it('scale is clamped to [0.2, 1.0]', () => {
      const over = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 999,
        max_quantity: 100,
      });
      expect(over.scale).toBe(1.0);
      const zero = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 0,
        max_quantity: 100,
      });
      // 0.35 + 0 = 0.35, above the 0.2 floor
      expect(zero.scale).toBeGreaterThanOrEqual(0.2);
      expect(zero.scale).toBeLessThanOrEqual(1.0);
    });

    it('guards against max_quantity of 0', () => {
      const v = nodeVisual({
        node_type: 'stone',
        quantity_remaining: 0,
        max_quantity: 0,
      });
      expect(Number.isFinite(v.scale)).toBe(true);
      expect(v.scale).toBeGreaterThanOrEqual(0.2);
    });
  });

  describe('depleted detection', () => {
    it('marks depleted when is_depleted = 1', () => {
      const v = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 50,
        max_quantity: 100,
        is_depleted: 1,
      });
      expect(v.depleted).toBe(true);
    });

    it('marks depleted when is_depleted = true', () => {
      const v = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 50,
        max_quantity: 100,
        is_depleted: true,
      });
      expect(v.depleted).toBe(true);
    });

    it('marks depleted when quantity_remaining <= 0', () => {
      const v = nodeVisual({
        node_type: 'ore_vein',
        quantity_remaining: 0,
        max_quantity: 100,
      });
      expect(v.depleted).toBe(true);
    });

    it('is not depleted when quantity remains and flag is unset', () => {
      const v = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 30,
        max_quantity: 100,
        is_depleted: 0,
      });
      expect(v.depleted).toBe(false);
    });

    it('is not depleted when is_depleted is omitted and quantity remains', () => {
      const v = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 30,
        max_quantity: 100,
      });
      expect(v.depleted).toBe(false);
    });
  });

  describe('node_type → kind + color mapping', () => {
    it('tree → green tree', () => {
      const v = nodeVisual({
        node_type: 'tree',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      expect(v.kind).toBe('tree');
      expect(v.color).toBe(0x3f8f3a);
    });

    it('ore_vein → grey rock', () => {
      const v = nodeVisual({
        node_type: 'ore_vein',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      expect(v.kind).toBe('rock');
      expect(v.color).toBe(0x808080);
    });

    it('stone → grey rock', () => {
      const v = nodeVisual({
        node_type: 'stone',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      expect(v.kind).toBe('rock');
      expect(v.color).toBe(0x808080);
    });

    it('fuel → grey rock', () => {
      const v = nodeVisual({
        node_type: 'fuel',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      expect(v.kind).toBe('rock');
      expect(v.color).toBe(0x808080);
    });

    it('crystal → cyan crystal', () => {
      const v = nodeVisual({
        node_type: 'crystal',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      expect(v.kind).toBe('crystal');
      expect(v.color).toBe(0x35d6e0);
    });

    it('herb → light-green bush', () => {
      const v = nodeVisual({
        node_type: 'herb',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      expect(v.kind).toBe('bush');
      expect(v.color).toBe(0x9fdf6a);
    });

    it('spring → blue water', () => {
      const v = nodeVisual({
        node_type: 'spring',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      expect(v.kind).toBe('water');
      expect(v.color).toBe(0x3a7fdf);
    });

    it('unknown type → generic', () => {
      const v = nodeVisual({
        node_type: 'wormhole',
        quantity_remaining: 100,
        max_quantity: 100,
      });
      expect(v.kind).toBe('generic');
      expect(v.color).toBe(0xb0a070);
    });
  });
});
