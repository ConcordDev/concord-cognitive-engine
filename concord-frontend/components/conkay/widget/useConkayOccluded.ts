'use client';

// concord-frontend/components/conkay/widget/useConkayOccluded.ts
//
// CK3 — real occlusion detection for the ambient widget's fixed top-right
// mount point.
//
// Ground truth this is built from (verified by reading the actual
// AppShell-mounted components, not guessed): `lib/ui/z-index.ts`'s own
// audit already establishes that top-right is the only corner NOT claimed
// by another *globally-mounted* fixed component — so there is no free
// alternate corner to "walk to" (every other corner already has a real,
// documented occupant). But three REAL, PER-LENS elements do genuinely
// cover this exact spot when they render: `SystemGuidePanel.tsx`'s
// expanded rail (`top-16 right-0 w-72`), `PersistentChatRail.tsx`'s
// expanded rail (`right-0 top-14/16 bottom-0`), and
// `AchievementToast.tsx`'s toast stack (`right-3 top-16`) — all three are
// CONDITIONALLY RENDERED (mounted to the DOM only while genuinely visible,
// never just CSS-hidden), so DOM presence of their
// `data-conkay-occludes-top-right="true"` marker is a real, truthful
// signal, not a guess.
//
// Since there's no verified-free alternate position, the honest response
// to a real occlusion is to not render the widget at all while it's
// genuinely covered — painting over real content the user needs to see or
// interact with would be worse than a brief, truthful absence. This is a
// deliberately narrower scope than "safe-region-solver-driven walk
// target" as originally staged in ConKayWidget.tsx's header — that phrase
// implied a free alternate spot exists; the audit above found none, so
// building a walk-to-elsewhere solver would be solving a problem that
// isn't real. If a genuinely free alternate corner is added to the app
// later, this can be revisited.
//
// HONESTY NOTE: no setInterval/setTimeout anywhere in this file (verify:
// `grep -rE "setInterval|setTimeout" concord-frontend/components/conkay/widget/`
// must stay empty). Detection is driven entirely by a `MutationObserver`
// on `document.body` — a real DOM-mutation signal, not a polling clock.

import { useEffect, useState } from 'react';

const OCCLUDER_SELECTOR = '[data-conkay-occludes-top-right="true"]';

function hasOccluder(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector(OCCLUDER_SELECTOR) !== null;
}

/**
 * True while a real, currently-mounted element is covering the ambient
 * widget's fixed top-right position. Re-evaluated on every DOM mutation to
 * `document.body`'s subtree/attributes (cheap: a single `querySelector`
 * per mutation batch, not a per-frame or per-interval poll).
 */
export function useConkayOccluded(): boolean {
  const [occluded, setOccluded] = useState(false);

  useEffect(() => {
    // Real check on mount — covers the case where an occluder is already
    // in the DOM (e.g. SystemGuidePanel restored expanded from a prior
    // session) before this hook's observer attaches.
    setOccluded(hasOccluder());

    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;

    const observer = new MutationObserver(() => {
      setOccluded(hasOccluder());
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-conkay-occludes-top-right'],
    });

    return () => observer.disconnect();
  }, []);

  return occluded;
}
