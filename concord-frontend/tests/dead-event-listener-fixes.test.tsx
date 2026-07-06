// Verification-audit fix — pinning tests for 2 real dead-event-listener
// findings: a real server broadcast with no socket-to-window bridge, and
// a window event nothing ever dispatched despite a listener's own comment
// claiming otherwise.
//
// Both pins are structural/source assertions, matching the established
// convention for this exact class in this codebase (see brawl-hud-wired.
// test.tsx's "socket-to-window bridge" describe block) — subscribe()/
// useSocket.ts require a live socket.io-client connection to exercise
// behaviorally, which no test in this suite mocks.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('social:ping — socket-to-window bridge (server/lib/social-pings.js had no bridge at all)', () => {
  const socketTypesSrc = readFileSync(path.resolve(__dirname, '..', 'lib', 'realtime', 'socket.ts'), 'utf8');
  const useSocketSrc = readFileSync(path.resolve(__dirname, '..', 'hooks', 'useSocket.ts'), 'utf8');
  const worldMarkersSrc = readFileSync(path.resolve(__dirname, '..', 'components', 'world-lens', 'WorldMarkers.tsx'), 'utf8');

  it('SocketEvent union includes social:ping', () => {
    expect(socketTypesSrc).toMatch(/\|\s*'social:ping'/);
  });

  it('useSocket forwards social:ping and renames it to the concordia:-namespaced window event', () => {
    expect(useSocketSrc).toMatch(/'social:ping' as SocketEvent/);
    expect(useSocketSrc).toMatch(/event === \('social:ping' as SocketEvent\)/);
  });

  it('WorldMarkers.tsx really listens for the namespaced name (the consumer this bridge feeds)', () => {
    expect(worldMarkersSrc).toMatch(/addEventListener\(\s*['"]concordia:social-ping['"]/);
  });
});

describe('concordia:skill-level-up — real dispatch (useSkillMastery\'s comment claimed a dispatcher that never existed)', () => {
  const bridgeSrc = readFileSync(path.resolve(__dirname, '..', 'components', 'world-lens', 'LevelUpJuiceBridge.tsx'), 'utf8');
  const hookSrc = readFileSync(path.resolve(__dirname, '..', 'hooks', 'useSkillMastery.ts'), 'utf8');

  it('LevelUpJuiceBridge dispatches concordia:skill-level-up from the real skill:evolved socket handler', () => {
    const evolvedStart = bridgeSrc.indexOf("'skill:evolved'");
    expect(evolvedStart).toBeGreaterThanOrEqual(0);
    const evolvedBlock = bridgeSrc.slice(evolvedStart, evolvedStart + 1200);
    expect(evolvedBlock).toMatch(/dispatchEvent\(new CustomEvent\('concordia:skill-level-up'/);
  });

  it('useSkillMastery still listens for concordia:skill-level-up (the consumer this dispatch feeds)', () => {
    expect(hookSrc).toMatch(/addEventListener\(\s*['"]concordia:skill-level-up['"]/);
  });
});
