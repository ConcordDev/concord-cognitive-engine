// Verification-audit fix — pinning tests for 2 real dead-event-listener
// findings: a real server broadcast with no socket-to-window bridge, and
// a window event nothing ever dispatched despite a listener's own comment
// claiming otherwise.
//
// The social:ping pins below are structural/source assertions — useSocket.ts
// requires a live socket.io-client connection to exercise behaviorally.
//
// The concordia:skill-level-up pin (2026-07-06 re-fix) is NOT a source
// assertion anymore: this session established a working mock pattern for
// `@/lib/realtime/socket`'s `subscribe()` (see tests/components/
// seasonal-effects-events.test.tsx and tests/components/
// arena-panel-match-found.test.tsx) that renders the real consumer, mocks
// `subscribe`, fires the captured handler, and asserts a real state change.
// Applied here: render the real `LevelUpJuiceBridge` (the dispatcher) next to
// a tiny probe component that calls the real `useSkillMastery` hook (the
// consumer), fire the mocked `skill:evolved` handler, and assert the probe's
// rendered skill list actually changes via a real `useSkillMastery` refetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, waitFor, act } from '@testing-library/react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { subscribeHandlers, subscribeMock } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    subscribeHandlers: handlers,
    subscribeMock: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    }),
  };
});
vi.mock('@/lib/realtime/socket', () => ({
  subscribe: subscribeMock,
}));

const apiGetMock = vi.fn();
vi.mock('@/lib/api/client', () => {
  const client = { get: (...a: unknown[]) => apiGetMock(...a) };
  return { default: client, api: client };
});

// Imported after the mocks above so both pick up the mocked modules.
import { useSkillMastery } from '@/hooks/useSkillMastery';
import { LevelUpJuiceBridge } from '@/components/world-lens/LevelUpJuiceBridge';

function MasteryProbe() {
  const { skills, loading } = useSkillMastery();
  return (
    <div data-testid="mastery-probe">
      {loading ? 'loading' : skills.map((s) => s.skillType).join(',')}
    </div>
  );
}

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

  it('LevelUpJuiceBridge dispatches concordia:skill-level-up from the real skill:evolved socket handler', () => {
    const evolvedStart = bridgeSrc.indexOf("'skill:evolved'");
    expect(evolvedStart).toBeGreaterThanOrEqual(0);
    const evolvedBlock = bridgeSrc.slice(evolvedStart, evolvedStart + 1200);
    expect(evolvedBlock).toMatch(/dispatchEvent\(new CustomEvent\('concordia:skill-level-up'/);
  });

  describe('useSkillMastery really refetches on the real dispatch (rendered, not source-matched)', () => {
    beforeEach(() => {
      subscribeHandlers.clear();
      subscribeMock.mockClear();
      apiGetMock.mockReset();
      let calls = 0;
      apiGetMock.mockImplementation((url: string) => {
        if (url === '/api/crafting/skills/mastery') {
          calls += 1;
          return Promise.resolve({
            data: {
              ok: true,
              // First fetch (on mount) returns no skills; the second fetch,
              // which should only happen after the real
              // concordia:skill-level-up dispatch, returns the leveled-up
              // skill. If the dispatch (or the hook's listener) is broken,
              // the probe never sees the second payload.
              skills: calls === 1 ? [] : [{ skillType: 'fireball', level: 12 }],
            },
          });
        }
        return Promise.resolve({ data: {} });
      });
    });

    it('useSkillMastery still listens for concordia:skill-level-up (the consumer this dispatch feeds)', async () => {
      const { getByTestId } = render(
        <>
          <LevelUpJuiceBridge />
          <MasteryProbe />
        </>,
      );

      // Initial fetch on mount resolves to no skills.
      await waitFor(() => expect(getByTestId('mastery-probe').textContent).toBe(''));
      // LevelUpJuiceBridge has registered its skill:evolved handler.
      await waitFor(() => expect(subscribeHandlers.has('skill:evolved')).toBe(true));

      // Fire the real skill:evolved handler exactly as the server payload
      // shapes it — this exercises the real dispatchEvent('concordia:skill
      // -level-up') call inside LevelUpJuiceBridge, not a synthetic window
      // dispatch from the test itself.
      act(() => {
        subscribeHandlers.get('skill:evolved')!({
          skillName: 'Fireball', level: 12, title: 'Arisen: Fireball',
        });
      });

      // If the dispatch — or useSkillMastery's window listener — were
      // missing, the probe would stay stuck on the first (empty) fetch.
      await waitFor(() => expect(getByTestId('mastery-probe').textContent).toBe('fireball'));
    });
  });
});
