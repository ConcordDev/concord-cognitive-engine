'use client';

// concord-frontend/components/conkay/ConKayCockpit.tsx
//
// F1 — the ConKay JARVIS cockpit grid host (docs/NEXT_ARC_PLAN.md Wave 1, K2:
// spatial FUI cockpit layout). A CSS-grid takeover of the content area BETWEEN
// ConKayOverlay's header and command bar: a left panel lane, the existing
// centered transcript (now narrower, passed in as `children`, unchanged
// behavior), and a right panel lane. It does NOT replace the overlay's
// backdrop/scrim/header/command-bar — those stay exactly as they were.
//
// Panels are resolved LAZILY by dotted id through `lib/panel-registry.ts`
// (the reuse target — NOT the world HUD's PanelHost.tsx, which is a
// single-modal, world-coupled component and the wrong fit here). The lane
// mounts each registered panel via `lazy(entry.load)` + `Suspense`, the same
// pattern already proven by `components/panels/GlobalPanelHost.tsx` and
// `components/panels/CrossMountedPanels.tsx`.
//
// Honest-by-construction: an unregistered/not-yet-built panel id (see the
// F4/F5/F7 comment in panel-registry.ts) renders NOTHING — never a crash,
// never a placeholder. The grid itself is backdrop-agnostic: it is a DOM
// overlay that knows nothing about ConKayBackdrop's choice between the 3D
// scene and the ConKaySurface 2D canvas fallback, so panels render identically
// under either.
//
// No new global state and no setInterval/setTimeout here — panels are pure
// readers of whatever store/backend they already used (e.g. conkayHudStore's
// single writer stays the socket lifecycle effect in ConKayOverlay.tsx).

import { Suspense, lazy, useMemo, type ComponentType, type ReactNode } from 'react';
import { getPanelById, type PanelEntry } from '@/lib/panel-registry';

export interface ConKayCockpitProps {
  /** The existing transcript content — rendered unchanged in the center lane. */
  children: ReactNode;
  /** Dotted panel ids for the left lane. Unregistered ids render nothing. */
  leftPanelIds?: string[];
  /** Dotted panel ids for the right lane. Unregistered ids render nothing. */
  rightPanelIds?: string[];
  className?: string;
}

// Only `conkay.telemetry` exists as of F1. Later units (F4/F5/F7) add
// `conkay.macro-library` / `conkay.provenance` / `conkay.forward-sim` to
// panel-registry.ts — referencing their ids here ahead of time is safe
// because an unregistered id is a documented no-op, not a crash.
const DEFAULT_LEFT_PANEL_IDS: string[] = [];
const DEFAULT_RIGHT_PANEL_IDS: string[] = ['conkay.telemetry'];

/** One lazily-mounted panel slot. Renders nothing for an unregistered id. */
function ConKayPanelSlot({ id }: { id: string }) {
  const entry: PanelEntry | undefined = getPanelById(id);
  const LazyPanel = useMemo<ComponentType<Record<string, unknown>> | null>(
    () => (entry ? (lazy(entry.load) as unknown as ComponentType<Record<string, unknown>>) : null),
    [entry],
  );
  if (!entry || !LazyPanel) return null;
  return (
    <div
      className="ck-cockpit-panel rounded-xl border border-cyan-400/15 bg-black/25 p-2"
      data-testid={`ck-cockpit-panel-${id}`}
    >
      <Suspense fallback={<div className="px-1 py-2 text-[11px] text-cyan-300/40">Loading {entry.label}…</div>}>
        <LazyPanel />
      </Suspense>
    </div>
  );
}

/** A panel lane (left or right). Collapses to nothing if it has no resolvable panels. */
function ConKayPanelLane({ ids, side }: { ids: string[]; side: 'left' | 'right' }) {
  const resolvedIds = ids.filter((id) => getPanelById(id));
  if (resolvedIds.length === 0) return null;
  return (
    <div
      className="hidden min-h-0 flex-col gap-2 overflow-y-auto px-2 py-2 lg:flex"
      data-testid={`ck-cockpit-lane-${side}`}
      aria-label={side === 'left' ? 'ConKay left panel lane' : 'ConKay right panel lane'}
    >
      {resolvedIds.map((id) => <ConKayPanelSlot key={id} id={id} />)}
    </div>
  );
}

export function ConKayCockpit({
  children,
  leftPanelIds = DEFAULT_LEFT_PANEL_IDS,
  rightPanelIds = DEFAULT_RIGHT_PANEL_IDS,
  className,
}: ConKayCockpitProps) {
  // Below `lg` the side lanes hide entirely (Tailwind's `hidden lg:flex`, the
  // codebase's existing responsive convention — see e.g. Sidebar.tsx) so the
  // transcript keeps the full width on phone/tablet instead of squeezing three
  // narrow columns into a viewport that can't fit them.
  return (
    <div
      className={`grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_220px]${className ? ` ${className}` : ''}`}
      data-testid="ck-cockpit-grid"
    >
      <ConKayPanelLane ids={leftPanelIds} side="left" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5" data-testid="ck-cockpit-center">
        {children}
      </div>
      <ConKayPanelLane ids={rightPanelIds} side="right" />
    </div>
  );
}

export default ConKayCockpit;
