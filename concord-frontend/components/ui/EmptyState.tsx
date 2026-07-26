'use client';

/**
 * EmptyState — the canonical "nothing to show" primitive for the whole app.
 *
 * This is the CONSOLIDATION target for what used to be three near-duplicate
 * implementations (2026-07-23 maturity-audit fix, item #10):
 *   - `components/common/EmptyState.tsx` (motion-animated, `variant` enum,
 *     plus a dozen preset wrappers like `EmptyDTUs`/`EmptyInbox`/`ErrorState`)
 *   - `components/lens/EmptyStateCTA.tsx` (manifest-aware — resolves the
 *     active lens's primary artifact + `create` macro and fires it itself)
 *   - this file, which was already the general-purpose, dependency-free
 *     primitive with no manifest lookup, no store access, no API calls.
 *
 * `ui/EmptyState` was picked as the canonical base (not `common/EmptyState`)
 * because it is the ONE variant with zero framework dependencies beyond
 * React itself (no framer-motion, no store, no manifest lookup) — the
 * correct shape for a shared primitive that a rich, business-logic-bearing
 * component like `EmptyStateCTA` should be able to render *through* without
 * inheriting animation timing or lens-store coupling it doesn't want.
 * `common/EmptyState.tsx` and `components/lens/EmptyStateCTA.tsx` are now
 * thin shims over this component — see each file's own doc comment for its
 * prop-mapping and the (documented) residuals that couldn't be losslessly
 * preserved. No existing importer of either shim needed to change.
 *
 * The `action`/`secondaryAction` shape below is a deliberate SUPERSET of
 * what `common/EmptyState.tsx` needed (`{ label, onClick }`) — `icon` and
 * `className` were added specifically so `EmptyStateCTA` (which needs a
 * loading spinner inside the button + a per-lens accent color so lenses
 * keep their own visual identity, not a single shared cyan — see
 * `docs/UI_QUALITY_RUBRIC.md` §3) can delegate its ENTIRE render to this
 * component instead of hand-rolling its own button markup.
 *
 * Honest-by-construction: this is the sanctioned "nothing to show, here's
 * why / here's what to do" surface. Never fill it with sample/fabricated
 * content that could be mistaken for real data — if there's nothing real,
 * render this instead of inventing something.
 */

import React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /**
   * Optional leading icon rendered before the label inside the button (e.g.
   * a spinner while an async action is in flight). Rendered as a direct
   * sibling of the label text node — NOT wrapped in an intermediate span —
   * so `getByText(label)` from callers/tests still resolves to exactly one
   * element (the button itself).
   */
  icon?: React.ReactNode;
  /**
   * Full className override for the button. When present, this REPLACES the
   * default `ds.btnSecondary` styling entirely — use it when a caller needs
   * its own identity/accent styling instead of the shared default look
   * (this is how `EmptyStateCTA`'s per-lens accent colors are preserved).
   */
  className?: string;
}

export interface EmptyStateProps {
  /** Custom icon node. Defaults to a generic inbox glyph. Pass `null` to omit the icon slot entirely. */
  icon?: React.ReactNode | null;
  /** Headline. Default: "Nothing here yet." */
  title?: string;
  /** Supporting copy — ideally explains *why* it's empty or what would fill it (an honest reason, not filler). */
  description?: React.ReactNode;
  /** Primary call-to-action (e.g. "Create your first X", "Clear filters"). */
  action?: EmptyStateAction;
  /** Optional lower-emphasis second action (e.g. "Learn more", "Import instead"). */
  secondaryAction?: EmptyStateAction;
  /** Compact reduces vertical padding — for inline/nested contexts (a tab panel, a small card, a sidebar section). */
  compact?: boolean;
  className?: string;
  /** Accessible label for the containing region. Default "Empty state". */
  ariaLabel?: string;
}

export function EmptyState({
  icon,
  title = 'Nothing here yet.',
  description,
  action,
  secondaryAction,
  compact = false,
  className,
  ariaLabel = 'Empty state',
}: EmptyStateProps) {
  const resolvedIcon = icon === null ? null : (icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />);

  return (
    <div
      role="region"
      aria-label={ariaLabel}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-6 px-4' : 'py-12 px-6',
        'rounded-lg border border-dashed border-lattice-border/60 bg-lattice-surface/20',
        className,
      )}
    >
      {resolvedIcon && (
        <div
          className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-lattice-surface/60 text-gray-400"
          aria-hidden="true"
        >
          {resolvedIcon}
        </div>
      )}
      <h3 className="text-base font-semibold text-white mb-1">{title}</h3>
      {description && <div className="text-sm text-gray-400 max-w-md mb-4">{description}</div>}
      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-1">
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={action.className ?? cn(ds.btnSecondary, 'px-4 py-2 text-sm')}
            >
              {action.icon}
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              disabled={secondaryAction.disabled}
              className={secondaryAction.className ?? ds.btnGhost}
            >
              {secondaryAction.icon}
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
