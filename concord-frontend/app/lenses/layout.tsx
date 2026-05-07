'use client';

import { Suspense, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { CoreLensNav } from '@/components/common/CoreLensNav';
import { CommandPalette } from '@/components/common/CommandPalette';
import { LensErrorBoundary } from '@/components/common/LensErrorBoundary';
import { RepairBoundary } from '@/components/RepairBoundary';
import { SmartContextBar } from '@/components/common/SmartContextBar';
import { QuickCapture } from '@/components/common/QuickCapture';
import { ExportMenu } from '@/components/common/ExportMenu';
import { ActivityTimeline } from '@/components/common/ActivityTimeline';
import DomainAssistant from '@/components/common/DomainAssistant';
import { CrossDomainConnections } from '@/components/common/CrossDomainConnections';
import { BrainMonitor } from '@/components/common/BrainMonitor';
import { SkeletonCard } from '@/components/common/Skeleton';
import { ContentPublisher } from '@/components/lens/ContentPublisher';
import { LensStateProvider } from '@/components/lens/LensStateProvider';
import { useLensIdentity } from '@/hooks/useLensIdentity';
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
 * Universal features that render on every lens page:
 * - SmartContextBar (top): DTU count, insights, trending, "Ask about" button
 * - ExportMenu (top-right): JSON/CSV export, Cmd+E
 * - QuickCapture (floating FAB): Create DTUs fast, Cmd+N
 * - DomainAssistant (floating): AI chat panel, Cmd+/
 * - CrossDomainConnections (floating): Graph-based cross-domain panel, Cmd+J
 * - BrainMonitor (top-left): Three-brain cognitive architecture status
 * - ActivityTimeline (bottom): Collapsible activity log
 */
function UniversalLensFeatures({ children }: { children: React.ReactNode }) {
  const { slug, label } = useLensMeta();

  // Apply per-lens visual identity (CSS variables)
  useLensIdentity(slug);

  if (!slug) return <>{children}</>;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar: SmartContextBar + ExportMenu */}
      <div className="flex items-center">
        <div className="flex-1 min-w-0">
          <SmartContextBar domain={slug} domainLabel={label} />
        </div>
        <div className="flex-shrink-0 pr-2">
          <ExportMenu domain={slug} />
        </div>
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

      {/* Bottom: Activity Timeline */}
      <ActivityTimeline domain={slug} />

      {/* Floating overlays */}
      <QuickCapture domain={slug} />
      <DomainAssistant domain={slug} domainLabel={label} />
      <CrossDomainConnections domain={slug} domainLabel={label} />

      {/* Universal Share — floating button (bottom-right) */}
      <div className="fixed bottom-20 right-4 z-40">
        <ContentPublisher domain={slug} compact />
      </div>

      {/* Brain status monitor (top-left floating) */}
      <div className="fixed top-20 left-4 z-40">
        <BrainMonitor />
      </div>
    </div>
  );
}

/**
 * FE-012 + FE-014: Lens layout with loading isolation, error containment,
 * automatic CoreLensNav for core workspace lenses, and universal features
 * (Smart Context Bar, Quick Capture, Domain AI Assistant, Cross-Domain
 * Connections, Brain Monitor, Activity Timeline, Export Menu, Command
 * Palette with Cmd+K).
 */
export default function LensLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const lensName = pathname.split('/lenses/')[1]?.split('/')[0] || 'unknown';

  return (
    <>
      <CommandPalette />
      <CoreLensNavWrapper />
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
