'use client';

/**
 * MS-P2 — the System Move Builder lens. The player's creation surface for moves:
 * compose element + kind + a diminishing-returns modifier budget, preview exactly
 * how it animates (resolveMove), and mint. The creation→verb loop, player-facing.
 */

import SystemMoveBuilder from '@/components/concordia/SystemMoveBuilder';

export default function MoveBuilderLensPage() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <SystemMoveBuilder />
    </div>
  );
}
