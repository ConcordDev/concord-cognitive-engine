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
import { getPanelById, allPanels, type PanelEntry } from '@/lib/panel-registry';

export interface ConKayCockpitProps {
  /** The existing transcript content — rendered unchanged in the center lane. */
  children: ReactNode;
  /** Dotted panel ids for the left lane. Unregistered ids render nothing. */
  leftPanelIds?: string[];
  /** Dotted panel ids for the right lane. Unregistered ids render nothing. */
  rightPanelIds?: string[];
  className?: string;
}

// SELF-HEALING DEFAULTS — a real bug this fixes: the ORIGINAL F1 defaults
// were hardcoded to only `['conkay.telemetry']` (right lane), because that
// was the only panel registered at the time. F4/F5/F7 each registered a new
// `conkay.*` panel in panel-registry.ts as planned, but nothing ever came
// back to update these two constants OR pass explicit ids at ConKayOverlay's
// mount site — so conkay.macro-library / conkay.provenance / conkay.forward-
// sim were fully built, tested, and registered, yet NEVER actually rendered
// in the live cockpit (every unit's own test explicitly passed panel ids,
// which is why each unit's tests passed while the real UI stayed stuck on
// one panel). Deriving the defaults from the registry itself — instead of a
// second hand-maintained list — makes this class of bug structurally
// impossible: any future `conkay.*` panel registration is picked up
// automatically, with no second site to remember to update.
const CONKAY_PANEL_PREFIX = 'conkay.';
// Preferred left-lane ids, in display order — panels about the LIVE run
// (what just happened / what's computing). Any registered `conkay.*` id not
// listed here (present or future) falls through to the right lane instead
// of being silently dropped.
const PREFERRED_LEFT_IDS = ['conkay.provenance', 'conkay.forward-sim', 'conkay.feature-tree', 'conkay.erp-bom'];

function conkayPanelIds(): string[] {
  return allPanels()
    .map((p) => p.id)
    .filter((id) => id.startsWith(CONKAY_PANEL_PREFIX));
}

function defaultLeftPanelIds(): string[] {
  const all = new Set(conkayPanelIds());
  return PREFERRED_LEFT_IDS.filter((id) => all.has(id));
}

function defaultRightPanelIds(): string[] {
  const left = new Set(defaultLeftPanelIds());
  return conkayPanelIds().filter((id) => !left.has(id));
}

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
  leftPanelIds,
  rightPanelIds,
  className,
}: ConKayCockpitProps) {
  // Computed per-render (not module-scope constants) so a panel registered
  // after this module first loaded is still picked up — see the self-healing
  // comment above. allPanels()/conkayPanelIds() are cheap object-key scans,
  // not I/O, so this is not a perf concern at cockpit-mount frequency.
  const resolvedLeft = leftPanelIds ?? defaultLeftPanelIds();
  const resolvedRight = rightPanelIds ?? defaultRightPanelIds();
  // Below `lg` the side lanes hide entirely (Tailwind's `hidden lg:flex`, the
  // codebase's existing responsive convention — see e.g. Sidebar.tsx) so the
  // transcript keeps the full width on phone/tablet instead of squeezing three
  // narrow columns into a viewport that can't fit them.
  return (
    <div
      className={`grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_220px]${className ? ` ${className}` : ''}`}
      data-testid="ck-cockpit-grid"
    >
      <ConKayPanelLane ids={resolvedLeft} side="left" />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5" data-testid="ck-cockpit-center">
        {children}
      </div>
      <ConKayPanelLane ids={resolvedRight} side="right" />
    </div>
  );
}

export default ConKayCockpit;
