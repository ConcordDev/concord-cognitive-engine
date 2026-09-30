'use client';

/**
 * PhysicsLabPanel — PhET / Algodoo scene editor (server-authoritative).
 */

import { PhysicsLab } from '@/components/physics/PhysicsLab';
import { ds } from '@/lib/design-system';

export function PhysicsLabPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Lab</h2>
        <p className={ds.textMuted}>
          Persistent scenes, curriculum modules, measurement tools — the engine runs on the server.
        </p>
      </div>
      <PhysicsLab />
    </div>
  );
}
