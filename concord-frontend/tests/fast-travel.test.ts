// world:fast-travel — was an orphaned event (marker "Travel" button did nothing).
// Now teleports the player avatar via a real physics-world method.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('fast-travel teleport', () => {
  it('physics-world exposes teleportCharacter that resets velocity/flags', () => {
    const src = read('lib/world-lens/physics-world.ts');
    expect(src).toMatch(/teleportCharacter\(id: string/);
    expect(src).toMatch(/setNextKinematicTranslation\(p\)/);
    expect(src).toMatch(/ks\.verticalVel = 0/);
    expect(src).toMatch(/ks\.isAirborne = false/);
  });

  it('AvatarSystem3D consumes world:fast-travel and teleports the player', () => {
    const src = read('components/world-lens/AvatarSystem3D.tsx');
    expect(src).toMatch(/addEventListener\('world:fast-travel'/);
    expect(src).toMatch(/physicsWorld\.teleportCharacter\('player'/);
    // keeps logical position + mesh in sync with the physics body
    expect(src).toMatch(/playerPositionRef\.current\.x = d\.x/);
  });
});
