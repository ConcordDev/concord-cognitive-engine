import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCloudLayer, _cloudShader } from '@/lib/world-lens/cloud-raymarch';

// World Lens Phase 7a — `lib/world-lens/sky-shader.ts` (and its own
// `describe('sky dome', ...)` block that used to live here) was deleted:
// it built a second, redundant static sky dome (frozen at
// `setTimeOfDayHour(15)`, never updated again) alongside
// `SkyWeatherRenderer`'s real, live, clock-synced sky. See the removal
// site's comment in `components/world-lens/ConcordiaScene.tsx` for the
// full reasoning. The volumetric cloud layer below is a distinct, still
// real and still used effect (actual 3D cloud geometry, not a duplicate
// of anything the sky shader does) and was NOT removed.

describe('cloud layer', () => {
  it('has required uniforms', () => {
    expect(_cloudShader.uniforms.uTime).toBeDefined();
    expect(_cloudShader.uniforms.uDensity).toBeDefined();
    expect(_cloudShader.uniforms.uSunDir).toBeDefined();
  });

  it('creates a mesh', () => {
    const layer = createCloudLayer(THREE);
    expect(layer.mesh).toBeInstanceOf(THREE.Mesh);
    const mat = layer.mesh.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    layer.dispose();
  });

  it('tick advances time uniform', () => {
    const layer = createCloudLayer(THREE);
    const mat = layer.mesh.material as THREE.ShaderMaterial;
    expect(mat.uniforms.uTime.value).toBe(0);
    layer.tick(1.0);
    expect(mat.uniforms.uTime.value).toBeGreaterThan(0);
    layer.dispose();
  });

  it('setWeatherDensity clamps [0, 1.2]', () => {
    const layer = createCloudLayer(THREE);
    layer.setWeatherDensity(-1);
    expect((layer.mesh.material as THREE.ShaderMaterial).uniforms.uDensity.value).toBe(0);
    layer.setWeatherDensity(5);
    expect((layer.mesh.material as THREE.ShaderMaterial).uniforms.uDensity.value).toBe(1.2);
    layer.dispose();
  });

  it('setSunDirection normalises input', () => {
    const layer = createCloudLayer(THREE);
    layer.setSunDirection({ x: 0, y: 5, z: 0 });
    const v = (layer.mesh.material as THREE.ShaderMaterial).uniforms.uSunDir.value as THREE.Vector3;
    expect(v.length()).toBeCloseTo(1, 5);
    layer.dispose();
  });
});
