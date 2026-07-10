'use client';

/**
 * EmptyState — generic, dependency-free "no data yet" primitive.
 *
 * Distinct from `components/lens/EmptyStateCTA.tsx`: EmptyStateCTA is a
 * *composed*, lens-aware component — it resolves the active lens's manifest
 * (via `useLensShell`), reads its primary artifact + `create` macro, and
 * fires `apiHelpers.lens.runDomain(...)` itself. `EmptyState` is the
 * general-purpose primitive underneath: no manifest lookup, no store access,
 * no API calls, no assumption that "empty" means "go create one via a
 * macro." It just renders whatever honest copy + actions the caller passes.
 * Use `EmptyState` for: search-returned-nothing, filtered-list-is-empty,
 * a panel with no manifest-registered artifact, or any place a raw "empty"
 * state is needed without lens plumbing. `EmptyStateCTA` could in principle
 * be rebuilt to render through this component (its manifest-driven bits stay
 * as-is; only the markup moves) — left as a follow-up so this change doesn't
 * touch a file another workstream may be editing concurrently.
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
              className={cn(ds.btnSecondary, 'px-4 py-2 text-sm')}
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button type="button" onClick={secondaryAction.onClick} disabled={secondaryAction.disabled} className={ds.btnGhost}>
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
