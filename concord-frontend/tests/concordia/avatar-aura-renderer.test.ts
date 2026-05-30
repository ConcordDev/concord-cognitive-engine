import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { auraVisual, createAvatarAuraRenderer } from '@/lib/world-lens/avatar-aura-renderer';

// WS3.3 — buff/debuff auras on the avatar. Pin the pure colour/intensity fold +
// the renderer's follow-the-player + show/hide lifecycle (fetchEffects seam).

describe('WS3.3 — auraVisual (pure)', () => {
  it('no effects → inactive aura', () => {
    expect(auraVisual([]).active).toBe(false);
  });

  it('expired effects are ignored', () => {
    const v = auraVisual([{ effect_id: 'old', kind: 'buff', magnitude: 0.5, expires_at: 10 }], 1000);
    expect(v.active).toBe(false);
  });

  it('pure-buff stack leans cyan; pure-debuff leans red', () => {
    const buff = auraVisual([{ effect_id: 'b', kind: 'buff', magnitude: 0.6 }], 0);
    const debuff = auraVisual([{ effect_id: 'd', kind: 'debuff', magnitude: 0.6 }], 0);
    expect(buff.active).toBe(true);
    expect(debuff.active).toBe(true);
    // buff's blue channel dominates; debuff's red channel dominates
    const b = new THREE.Color(buff.color);
    const d = new THREE.Color(debuff.color);
    expect(b.b).toBeGreaterThan(b.r);
    expect(d.r).toBeGreaterThan(d.b);
  });

  it('intensity saturates and never exceeds 1', () => {
    const v = auraVisual(
      [
        { effect_id: 'a', kind: 'buff', magnitude: 0.8 },
        { effect_id: 'b', kind: 'buff', magnitude: 0.9 },
      ],
      0,
    );
    expect(v.intensity).toBeLessThanOrEqual(1);
    expect(v.intensity).toBeGreaterThan(0.15);
  });

  it('stronger magnitudes pulse faster', () => {
    const weak = auraVisual([{ effect_id: 'a', kind: 'buff', magnitude: 0.1 }], 0);
    const strong = auraVisual([{ effect_id: 'a', kind: 'buff', magnitude: 1.5 }], 0);
    expect(strong.pulse).toBeGreaterThan(weak.pulse);
  });
});

describe('WS3.3 — createAvatarAuraRenderer lifecycle', () => {
  it('shows the aura when effects exist and follows the player', async () => {
    const group = new THREE.Group();
    let effects = [{ effect_id: 'haste', kind: 'buff' as const, magnitude: 0.5 }];
    const r = createAvatarAuraRenderer(group, {
      fetchEffects: async () => effects,
      playerPos: () => ({ x: 5, y: 0, z: 9 }),
    });
    await r.refresh();
    // The aura group was added under the parent and is now visible.
    expect(group.children.length).toBe(1);
    const auraGroup = group.children[0] as THREE.Group;
    expect(auraGroup.visible).toBe(true);
    r.update(0.016, 1.0);
    expect(auraGroup.position.x).toBeCloseTo(5, 5);
    expect(auraGroup.position.z).toBeCloseTo(9, 5);

    // Clear effects → aura hides on next refresh.
    effects = [];
    await r.refresh();
    expect(auraGroup.visible).toBe(false);

    r.dispose();
    expect(() => r.dispose()).not.toThrow();
  });
});
