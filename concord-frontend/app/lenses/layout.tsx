'use client';

import { Suspense, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { CoreLensNav } from '@/components/common/CoreLensNav';
import { DestinationNav } from '@/components/common/DestinationNav';
import { getDestinationForLens } from '@/lib/destinations';
import { ConKayOverlay } from '@/components/conkay/ConKayOverlay';
import { GlobalPanelHost } from '@/components/panels/GlobalPanelHost';
import { CrossMountedPanels } from '@/components/panels/CrossMountedPanels';
import { LensErrorBoundary } from '@/components/common/LensErrorBoundary';
import { RepairBoundary } from '@/components/RepairBoundary';
import { QuickCapture } from '@/components/common/QuickCapture';
import { LensToolbar } from '@/components/lens/LensToolbar';
import { DepthBadgeHostContext } from '@/components/lens/DepthBadge';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import DomainAssistant from '@/components/common/DomainAssistant';
import { CrossDomainConnections } from '@/components/common/CrossDomainConnections';
import { SkeletonCard } from '@/components/common/Skeleton';
import { LensStateProvider } from '@/components/lens/LensStateProvider';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useDiegetic } from '@/hooks/useDiegetic';
import {
  isCoreLens,
  getParentCoreLens,
  getLensById,
  type CoreLensId,
} from '@/lib/lens-registry';

/**
 * Automatically renders CoreLensNav for any lens in a core workspace.
 * Works for core lenses (chat, board, graph, code, studio) and absorbed sub-lenses.
 */
function CoreLensNavWrapper() {
  const pathname = usePathname();
  const match = pathname.match(/^\/lenses\/([^/]+)/);
  const slug = match?.[1];

  if (!slug) return null;

  if (isCoreLens(slug)) {
    return <CoreLensNav coreLensId={slug as CoreLensId} />;
  }

  const parentId = getParentCoreLens(slug);
  if (parentId) {
    return <CoreLensNav coreLensId={parentId} />;
  }

  // Destinations get the same integrated workspace tab bar: the destination +
  // its grouped lenses as tabs, shown on the destination and any of its members.
  const dest = getDestinationForLens(slug);
  if (dest) {
    return <DestinationNav destinationId={dest.id} />;
  }

  return null;
}

/**
 * Derives domain slug and human-readable label from the current pathname.
 */
function useLensMeta() {
  const pathname = usePathname();
  return useMemo(() => {
    const match = pathname.match(/^\/lenses\/([^/]+)/);
    const slug = match?.[1] || '';
    const entry = slug ? getLensById(slug) : undefined;
    const label = entry?.name || slug.charAt(0).toUpperCase() + slug.slice(1);
    return { slug, label };
  }, [pathname]);
}

/**
 * Universal features on every lens page, behind ONE header row:
 *   left  — workspace tabs (core lens / destination) when the lens has any
 *   right — LensToolbar: DTU count, Ask, and one button per mounted tool
 *           (capture ⌘N, assistant ⌘/, agent, connections, cross-lens panels,
 *           activity), share, export
 * The tools render their panels on demand and no floating triggers of their
 * own, so nothing stacks over the lens. System status lives in the Topbar.
 */
function UniversalLensFeatures({ children }: { children: React.ReactNode }) {
  const { slug, label } = useLensMeta();

  // Apply per-lens visual identity (CSS variables)
  useLensIdentity(slug);

  if (!slug) return <>{children}</>;

  return (
    <DepthBadgeHostContext.Provider value={true}>
    <div className="flex flex-col h-full min-h-0">
      {/* One header row: workspace tabs + lens toolbar */}
      <div className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-lattice-border px-3">
        <div className="min-w-0 flex-1">
          <CoreLensNavWrapper />
        </div>
        <LensToolbar domain={slug} domainLabel={label} />
      </div>

      {/* Main lens content — per-lens Suspense boundary.
          LensStateProvider preserves scroll/filter/draft state across
          lens navigation, keyed by the current domain slug. */}
      <LensStateProvider domain={slug} className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="space-y-4 p-6">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          }
        >
          {children}
        </Suspense>
      </LensStateProvider>

      {/* Cross-lens panels — curated panels from OTHER lenses that deepen this
          destination (lib/panel-affinity). Renders only on destinations with a
          curated affinity list; null elsewhere. Pure recombination, no new build. */}
      <CrossMountedPanels destination={slug} />

      {/* Bottom: Activity Timeline */}
      <ActivityTimeline domain={slug} />

      {/* Tool panels — opened from LensToolbar, no floating triggers */}
      <QuickCapture domain={slug} />
      <DomainAssistant domain={slug} domainLabel={label} />
      <CrossDomainConnections domain={slug} domainLabel={label} />

    </div>
    </DepthBadgeHostContext.Provider>
  );
}

/**
 * Diegetic layout — a lens opened inside the in-world station frame
 * (LensStationOverlay, ?diegetic=1). Drops the lens chrome (nav, context bar,
 * timeline, floating FABs, command palette) and renders the lens full-bleed,
 * keeping only the error/repair boundaries, state preservation, and per-lens
 * visual identity. The StationOverlayShell already frames it in-world.
 */
function DiegeticLensLayout({ children }: { children: React.ReactNode }) {
  const { slug } = useLensMeta();
  useLensIdentity(slug);
  return (
    <LensErrorBoundary name="Lens">
      <RepairBoundary lens={slug || 'unknown'}>
        <LensStateProvider domain={slug} className="h-full min-h-0">
          <Suspense
            fallback={
              <div className="space-y-4 p-6">
                <SkeletonCard />
                <SkeletonCard />
              </div>
            }
          >
            {children}
          </Suspense>
        </LensStateProvider>
      </RepairBoundary>
    </LensErrorBoundary>
  );
}

/**
 * FE-012 + FE-014: Lens layout with loading isolation, error containment,
 * automatic CoreLensNav for core workspace lenses, and universal features
 * (Smart Context Bar, Quick Capture, Domain AI Assistant, Cross-Domain
 * Connections, Brain Monitor, Activity Timeline, Export Menu). Command
 * Palette (Cmd+K) is mounted once, app-wide, by AppShell — not here.
 */
export default function LensLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const lensName = pathname.split('/lenses/')[1]?.split('/')[0] || 'unknown';
  const diegetic = useDiegetic();

  // In-world station frame: render the lens bare (chrome lives in the world).
  if (diegetic) {
    return <DiegeticLensLayout>{children}</DiegeticLensLayout>;
  }

  return (
    <>
      {/* CommandPalette is NOT mounted here — AppShell (the app-wide shell
          wrapping every route) already mounts one instance. A second copy
          here double-rendered the whole overlay on every lens page: two
          `[role="dialog"]` trees, duplicate `id="palette-item-*"` DOM ids,
          and two independent Ctrl+K listeners racing on the same shared
          store value (this is what broke keyboard nav — see AppShell.tsx). */}
      {/* ConKay — summonable on ANY lens (⌘/Ctrl+J), operates the host lens'
          real macros. The cross-lens "take over and operate" surface. */}
      {/* @modal-escape-ok: ConKayOverlay manages its own Escape-to-close (ConKayOverlay.tsx:168). */}
      <ConKayOverlay />
      {/* GlobalPanelHost — summon ANY registered panel as a modal over any lens
          (lib/panel-dispatcher openPanel + command palette). The ad-hoc half of
          cross-mounting; the inverse of ConKay (a feature into any lens). */}
      <GlobalPanelHost />
      <LensErrorBoundary name="Lens">
        <RepairBoundary lens={lensName}>
          <Suspense
            fallback={
              <div className="space-y-4 p-6">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            }
          >
            <UniversalLensFeatures>
              {children}
            </UniversalLensFeatures>
          </Suspense>
        </RepairBoundary>
      </LensErrorBoundary>
    </>
  );
}
