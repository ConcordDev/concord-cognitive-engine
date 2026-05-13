'use client';

/**
 * CinematicTriggerBridge — Phase M
 *
 * Listens for server-emitted events that should trigger cinematic
 * sequences and routes them through cinematic-director.playSequence.
 *
 * Triggers wired:
 *   - quest:lattice-born          (lattice quest realisation)
 *   - quest:ecology-born          (ecology quest spawned)
 *   - war:declared
 *   - war:town-captured
 *   - kingdom:takeover
 *   - world:refusal-field         (with strength >= 9)
 *   - rebellion:fired
 *   - spawn:boss
 *
 * The director's registry is empty by default. Authored sequences
 * register via registerSequence at module load; if no sequence
 * matches the trigger name the director skips (graceful).
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';

export function CinematicTriggerBridge() {
  useEffect(() => {
    let disposed = false;
    const offs: Array<() => void> = [];

    (async () => {
      const dir = await import('@/lib/world-lens/cinematic-director');
      // Phase W — load all authored sequences (idempotent).
      const { ensureCinematicsRegistered } = await import('@/lib/world-lens/cinematic-sequences-registry');
      ensureCinematicsRegistered();
      if (disposed) return;

      function fire(trigger: string, payload: unknown) {
        try {
          dir.playSequence(trigger, payload).catch(() => { /* director failures are non-fatal */ });
        } catch { /* noop */ }
      }

      offs.push(subscribe('quest:lattice-born' as Parameters<typeof subscribe>[0], (p) => fire('quest_lattice_realised', p)));
      offs.push(subscribe('quest:ecology-born' as Parameters<typeof subscribe>[0], (p) => fire('quest_ecology_realised', p)));
      offs.push(subscribe('war:declared' as Parameters<typeof subscribe>[0], (p) => fire('war_declared', p)));
      offs.push(subscribe('war:town-captured' as Parameters<typeof subscribe>[0], (p) => fire('town_captured', p)));
      offs.push(subscribe('kingdom:takeover' as Parameters<typeof subscribe>[0], (p) => fire('kingdom_takeover', p)));
      offs.push(subscribe('world:refusal-field' as Parameters<typeof subscribe>[0], (payload: unknown) => {
        const ev = payload as { strength?: number };
        if ((ev?.strength ?? 0) >= 9) fire('refusal_field_compound', payload);
      }));
      offs.push(subscribe('rebellion:fired' as Parameters<typeof subscribe>[0], (p) => fire('rebellion_fired', p)));
      offs.push(subscribe('spawn:boss' as Parameters<typeof subscribe>[0], (p) => fire('boss_arrival', p)));
    })();

    return () => {
      disposed = true;
      for (const off of offs) off();
    };
  }, []);

  return null;
}
