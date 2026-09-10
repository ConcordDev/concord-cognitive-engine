'use client';

/**
 * World lens — Unity viewport first.
 *
 * Retail shell: full-bleed Concordia WebGL + Escape/Menu chrome.
 * Former ~7.6k LOC HUD/OS monolith lives at
 * `@/components/world/WorldOsSurface` and opens from Menu → Advanced OS tools
 * (or `?surface=os`).
 */

import { Suspense } from 'react';
import WorldUnityShell from '@/components/world/WorldUnityShell';

export default function WorldLensPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full min-h-[40vh] items-center justify-center bg-black text-sm text-zinc-400">
          Entering Concordia…
        </div>
      }
    >
      <WorldUnityShell />
    </Suspense>
  );
}
