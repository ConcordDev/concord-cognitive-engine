'use client';

/**
 * WorkshopPage — the standalone ConKay routes (/conkay/demo,
 * /conkay/designs[/id[/live]], /conkay/workbench) mounting the one Workshop.
 *
 * /conkay/demo is always guest. The others are guest for a signed-out
 * visitor and the full workshop for a signed-in one — decided from the
 * shared session query before mounting, so the workshop never starts in
 * one mode and flips to the other.
 */

import { Loader2 } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { Workshop, type WorkshopView } from './Workshop';

export function WorkshopPage({ forceGuest = false, initialView, designId = null }: { forceGuest?: boolean; initialView?: WorkshopView; designId?: string | null }) {
  const me = useCurrentUser();
  const decided = forceGuest || me.isSuccess || me.isError;
  const guest = forceGuest || !me.data?.user;
  return (
    <div className="h-[100dvh] min-h-0">
      {decided ? (
        <Workshop guest={guest} initialView={initialView} designId={designId} />
      ) : (
        <div className="workshop flex h-full items-center justify-center" aria-busy="true">
          <Loader2 className="h-5 w-5 animate-spin text-[color:var(--ws-arc)]" aria-label="Opening the workshop" />
        </div>
      )}
    </div>
  );
}

export default WorkshopPage;
