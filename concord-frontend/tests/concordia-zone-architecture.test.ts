// T3.3 — per-world zone architecture (skybox/silhouette) resolver tests + wiring pins.
//
// Pins the pure resolvers (buildingStyleForWorld, sunDiskForWorld) and that the
// world lens actually wires the sun disk + building style into the renderers.

import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildingStyleForWorld, sunDiskForWorld, themeForWorldId,
} from '@/lib/world-lens/concordia-theme';

describe('T3.3 — building silhouette resolver', () => {
  test('canon worlds read as distinct silhouettes', () => {
    expect(buildingStyleForWorld('cyber').style).toBe('neon-tower');
    expect(buildingStyleForWorld('crime').style).toBe('noir-lowrise');
    expect(buildingStyleForWorld('sovereign-ruins').style).toBe('ruins-marble');
    expect(buildingStyleForWorld('tunya').style).toBe('frontier-timber');
    expect(buildingStyleForWorld('superhero').style).toBe('arcology');
  });

  test('cyber is tall + emissive; crime is squat + matte', () => {
    const cyber = buildingStyleForWorld('cyber');
    const crime = buildingStyleForWorld('crime');
    expect(cyber.heightMul).toBeGreaterThan(crime.heightMul);
    expect(cyber.emissiveIntensity).toBeGreaterThan(crime.emissiveIntensity);
    expect(crime.roughness).toBeGreaterThan(cyber.roughness);
  });

  test('unknown world falls back to a valid default spec', () => {
    const spec = buildingStyleForWorld('no-such-world');
    expect(spec.style).toBeTruthy();
    expect(typeof spec.heightMul).toBe('number');
  });
});

describe('T3.3 — sun disk resolver', () => {
  test('every world resolves a sun disk with a colour + size', () => {
    for (const w of ['cyber', 'tunya', 'crime', 'concordia-hub', 'no-such-world']) {
      const d = sunDiskForWorld(w);
      expect(typeof d.color).toBe('number');
      expect(d.sizeM).toBeGreaterThan(0);
      expect(d.glow).toBeGreaterThanOrEqual(0);
    }
  });

  test("legacy 'concordia' alias resolves to the hub theme", () => {
    expect(themeForWorldId('concordia')).toBe('concordia-hub');
  });
});

describe('T3.3 — world lens wires the new identity', () => {
  const page = fs.readFileSync(
    path.resolve(__dirname, '..', 'app/lenses/world/page.tsx'), 'utf8',
  );
  test('sun disk is passed to SkyWeatherRenderer', () => {
    expect(page).toMatch(/sunDisk=\{sunDiskForWorld\(/);
  });
  test('building style is passed to BuildingRenderer3D', () => {
    expect(page).toMatch(/buildingStyle=\{buildingStyleForWorld\(/);
  });
});
