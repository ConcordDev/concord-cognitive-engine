import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createSkyDome, _skyShader } from '@/lib/world-lens/sky-shader';
import { createCloudLayer, _cloudShader } from '@/lib/world-lens/cloud-raymarch';

describe('sky dome', () => {
  it('has required uniforms', () => {
    expect(_skyShader.uniforms.uSunDir).toBeDefined();
    expect(_skyShader.uniforms.uZenithColor).toBeDefined();
    expect(_skyShader.uniforms.uHorizonColor).toBeDefined();
    expect(_skyShader.uniforms.uSunColor).toBeDefined();
  });

  it('creates a mesh with BackSide material', () => {
    const dome = createSkyDome(THREE, { radius: 1000, segments: 16 });
    expect(dome.mesh).toBeInstanceOf(THREE.Mesh);
    const mat = dome.mesh.material as THREE.ShaderMaterial;
    expect(mat.side).toBe(THREE.BackSide);
    dome.dispose();
  });

  it('setSun normalises the direction', () => {
    const dome = createSkyDome(THREE);
    dome.setSun({ x: 0, y: 10, z: 0 });
    const mat = dome.mesh.material as THREE.ShaderMaterial;
    const v = mat.uniforms.uSunDir.value as THREE.Vector3;
    expect(v.length()).toBeCloseTo(1, 5);
    dome.dispose();
  });

  it('setTimeOfDayHour at noon points sun upward', () => {
    const dome = createSkyDome(THREE);
    dome.setTimeOfDayHour(12);
    const mat = dome.mesh.material as THREE.ShaderMaterial;
    const v = mat.uniforms.uSunDir.value as THREE.Vector3;
    expect(v.y).toBeGreaterThan(0.7);
    dome.dispose();
  });

  it('setTimeOfDayHour at midnight points sun down', () => {
    const dome = createSkyDome(THREE);
    dome.setTimeOfDayHour(0);
    const mat = dome.mesh.material as THREE.ShaderMaterial;
    const v = mat.uniforms.uSunDir.value as THREE.Vector3;
    expect(v.y).toBeLessThan(-0.3);
    dome.dispose();
  });

  it('setColors writes the three colour uniforms', () => {
    const dome = createSkyDome(THREE);
    dome.setColors(0xff0000, 0x00ff00, 0x0000ff);
    const mat = dome.mesh.material as THREE.ShaderMaterial;
    const z = mat.uniforms.uZenithColor.value as THREE.Vector3;
    const h = mat.uniforms.uHorizonColor.value as THREE.Vector3;
    const s = mat.uniforms.uSunColor.value as THREE.Vector3;
    expect(z.x).toBeCloseTo(1, 2); expect(z.y).toBeCloseTo(0, 2); expect(z.z).toBeCloseTo(0, 2);
    expect(h.x).toBeCloseTo(0, 2); expect(h.y).toBeCloseTo(1, 2); expect(h.z).toBeCloseTo(0, 2);
    expect(s.x).toBeCloseTo(0, 2); expect(s.y).toBeCloseTo(0, 2); expect(s.z).toBeCloseTo(1, 2);
    dome.dispose();
  });

  it('renderOrder is -1000 so it renders before everything', () => {
    const dome = createSkyDome(THREE);
    expect(dome.mesh.renderOrder).toBe(-1000);
    dome.dispose();
  });
});

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
