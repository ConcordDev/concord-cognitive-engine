'use client';

/**
 * LensShell — substrate provider for a lens.
 *
 * INTENTIONALLY HEADLESS / VISUALLY MINIMAL: a lens is "an app on the
 * Concord substrate" — no two lenses should look the same, so this
 * wrapper provides plumbing only and never imposes chrome (no header,
 * no sidebar, no fixed feature panel placement). Lenses author their
 * own layout and render whatever shared primitives they want
 * (LensFeaturePanel, LensActionBar, etc.) wherever they want.
 *
 * What LensShell DOES provide:
 *   - LensContext (lensId, manifest, accessibility settings, command registrar)
 *   - applies a11y document attributes (data-reduced-motion, data-text-scale,
 *     data-colorblind, data-high-contrast) to a wrapping <div> so descendant
 *     CSS can react without prop drilling
 *   - active-lens registration with the UI store (so command palette,
 *     keyboard scope, and realtime gating know which lens is in focus)
 *   - a default <main role="main"> landmark + skip-to-content target
 *   - print/screen-reader sensible defaults (preserved by being a no-op
 *     wrapper — children control everything visible)
 *
 * What LensShell does NOT provide:
 *   - any visible header, footer, sidebar, action bar, or feature panel
 *   - any min-height, padding, background, or grid template
 *   - any modal / dialog / overlay
 *
 * Use the standalone components (LensFeaturePanel, LensActionBar,
 * CommandPalette) inside the lens body when wanted.
 */

import React, { createContext, useContext, useEffect, useMemo } from 'react';

import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';
import { useAccessibilitySettings } from '@/hooks/useAccessibilitySettings';
import type { EffectiveAccessibility } from '@/hooks/useAccessibilitySettings';

export interface LensShellContextValue {
  lensId: string;
  accessibility: EffectiveAccessibility;
}

const LensShellContext = createContext<LensShellContextValue | null>(null);

export interface LensShellProps {
  /** Required: must match the lens directory name under app/lenses/<lensId>/. */
  lensId: string;
  children: React.ReactNode;
  /** Element to render as the wrapper. Defaults to <div>. */
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
  /** Render children inside a <main> landmark. Default true. */
  asMain?: boolean;
  /** Skip-link target id, default `${lensId}-content`. */
  contentId?: string;
}

export function LensShell({
  lensId,
  children,
  as = 'div',
  className,
  asMain = true,
  contentId,
}: LensShellProps) {
  const accessibility = useAccessibilitySettings();
  const setActiveLens = useUIStore((s) => s.setActiveLens);

  // Register active lens with the UI store while mounted.
  useEffect(() => {
    setActiveLens(lensId);
  }, [lensId, setActiveLens]);

  const ctx = useMemo<LensShellContextValue>(
    () => ({ lensId, accessibility }),
    [lensId, accessibility]
  );

  const targetId = contentId ?? `${lensId}-content`;

  // a11y data attributes propagate effective settings to descendant CSS.
  const dataAttrs: Record<string, string | undefined> = {
    'data-lens-id': lensId,
    'data-reduced-motion': accessibility.effectiveReducedMotion ? 'true' : undefined,
    'data-high-contrast': accessibility.highContrast ? 'true' : undefined,
    'data-text-scale': accessibility.textScale !== 1 ? String(accessibility.textScale) : undefined,
    'data-colorblind': accessibility.colorblindMode !== 'none' ? accessibility.colorblindMode : undefined,
    'data-screen-reader': accessibility.screenReader ? 'true' : undefined,
    'data-one-handed': accessibility.oneHandedMode !== 'off' ? accessibility.oneHandedMode : undefined,
  };

  const Wrapper = as as React.ElementType;
  const inner = asMain ? (
    <main id={targetId} role="main" className="contents">
      {children}
    </main>
  ) : (
    <div id={targetId} className="contents">
      {children}
    </div>
  );

  return (
    <LensShellContext.Provider value={ctx}>
      <Wrapper className={cn('contents', className)} {...dataAttrs}>
        {inner}
      </Wrapper>
    </LensShellContext.Provider>
  );
}

export function useLensShell(): LensShellContextValue {
  const ctx = useContext(LensShellContext);
  if (!ctx) {
    throw new Error('useLensShell must be called inside <LensShell>.');
  }
  return ctx;
}

/**
 * useLensId — common shorthand for lens code that only needs the id.
 * Throws (in dev) if called outside a LensShell so wiring bugs surface.
 */
export function useLensId(): string {
  return useLensShell().lensId;
}

export default LensShell;
