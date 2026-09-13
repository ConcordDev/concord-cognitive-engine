'use client';

/**
 * Honest Concordia download door.
 * WebGL plays at /unity-client (and /lenses/world). A desktop player
 * build is not exported from this tree — the Editor project is the
 * standalone client.
 */

import Link from 'next/link';
import { Gamepad2 } from 'lucide-react';
import { UtilityPageShell } from '@/components/shell/UtilityPageShell';
import { ds } from '@/lib/design-system';

export default function ConcordiaDownloadPage() {
  return (
    <UtilityPageShell
      icon={Gamepad2}
      title="Play Concordia"
      subtitle="WebGL is live. A packaged desktop player is not exported."
      showBackButton
    >
      <div className={`${ds.panel} space-y-4`} data-testid="concordia-download">
        <p className="text-sm leading-relaxed text-zinc-200">
          Concordia plays in the browser at{' '}
          <Link href="/lenses/world" className="text-amber-200 underline">
            /lenses/world
          </Link>
          , which loads the Unity WebGL export at{' '}
          <code className="font-mono text-[11px] text-amber-200">/unity-client/</code>
          {' '}over <code className="font-mono text-[11px] text-zinc-400">/unity-ws</code>.
        </p>
        <p className="text-sm leading-relaxed text-zinc-300">
          There is no standalone desktop installer in this repository. The AAA
          client is the Unity Editor project at{' '}
          <code className="font-mono text-[11px] text-amber-200">
            apps/concordia-living-world/unity-client/
          </code>
          . Soldier.glb Mixamo mocap is not in git; the WebGL hero is the
          modular person.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/lenses/world" className={ds.btnPrimary}>
            Play in browser
          </Link>
          <a href="/unity-client/index.html" className={ds.btnSecondary}>
            Open WebGL directly
          </a>
        </div>
      </div>
    </UtilityPageShell>
  );
}
