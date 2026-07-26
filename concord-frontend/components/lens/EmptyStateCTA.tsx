'use client';

/**
 * EmptyStateCTA — drop-in empty state for a lens with no data.
 *
 * Two modes:
 *   • Manifest mode (default): pulls the lens's primary artifact + create macro
 *     from the manifest and fires "Create your first {artifact}" via runDomain.
 *   • Custom-action mode: pass `onAction` to wire the button to the lens's OWN
 *     richer add/import flow (e.g. music's "Add to library" form) instead of a
 *     generic create macro.
 *
 * `accent` keeps each lens looking like its own app — the empty state adopts the
 * lens's accent colour rather than a single shared cyan. Identity preserved.
 *
 * Use:
 *   {items.length === 0 && <EmptyStateCTA />}                              // manifest
 *   <EmptyStateCTA lensId="music" accent="emerald" buttonLabel="Add a track"
 *                  onAction={() => setShowAdd(true)} />                    // custom action
 *
 * Consolidation note (2026-07-23 maturity-audit fix, item #10): the RENDER
 * below now delegates to the canonical `components/ui/EmptyState.tsx`
 * instead of hand-rolled markup — all the business logic above the return
 * (manifest resolution, the `create` macro call, the per-lens accent
 * lookup, the in-flight loading state) is UNCHANGED, because none of it is
 * presentational; it's what makes this component a manifest-aware CTA
 * rather than a plain empty-state box, which is inherent to its purpose and
 * not something a shared primitive should own. Only the final JSX is now a
 * thin wrapper over the shared component.
 *
 * The mapping is lossless: canonical's `action.icon` + `action.className`
 * (added to its API specifically to make this possible — see that file's
 * doc comment) carry the loading spinner and the accent-colored button
 * styling exactly as this component always rendered them. The one
 * remaining, purely cosmetic residual is the description tag (a `<div>` in
 * canonical vs. this file's original `<p>`) and the actions row picking up
 * canonical's shared `mt-1` wrapper spacing — neither is visible in
 * practice and neither changes any prop or behavior a caller depends on.
 */

import { useState } from 'react';
import { Plus, Sparkles, Loader2 } from 'lucide-react';

import { apiHelpers } from '@/lib/api/client';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { EmptyState as CanonicalEmptyState } from '@/components/ui/EmptyState';
import { useLensShell } from './LensShell';

export type EmptyStateAccent = 'cyan' | 'fuchsia' | 'emerald' | 'amber' | 'purple' | 'pink' | 'sky';

// Full literal class strings so Tailwind's JIT keeps them (no interpolation).
const ACCENTS: Record<EmptyStateAccent, { icon: string; btn: string }> = {
  cyan: { icon: 'text-neon-cyan', btn: 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/30 hover:bg-neon-cyan/25 focus:ring-neon-cyan/40' },
  fuchsia: { icon: 'text-fuchsia-300', btn: 'bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30 hover:bg-fuchsia-500/25 focus:ring-fuchsia-500/40' },
  emerald: { icon: 'text-emerald-300', btn: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30 hover:bg-emerald-500/25 focus:ring-emerald-500/40' },
  amber: { icon: 'text-amber-300', btn: 'bg-amber-500/15 text-amber-200 border-amber-500/30 hover:bg-amber-500/25 focus:ring-amber-500/40' },
  purple: { icon: 'text-neon-purple', btn: 'bg-neon-purple/15 text-fuchsia-200 border-neon-purple/30 hover:bg-neon-purple/25 focus:ring-neon-purple/40' },
  pink: { icon: 'text-neon-pink', btn: 'bg-neon-pink/15 text-neon-pink border-neon-pink/30 hover:bg-neon-pink/25 focus:ring-neon-pink/40' },
  sky: { icon: 'text-sky-300', btn: 'bg-sky-500/15 text-sky-200 border-sky-500/30 hover:bg-sky-500/25 focus:ring-sky-500/40' },
};

export interface EmptyStateCTAProps {
  lensId?: string;
  /** Override the headline. Default: "Nothing here yet." */
  headline?: string;
  /** Override the body copy. Default derived from manifest.label. */
  caption?: string;
  /** Override the button label. Default: "Create your first {artifact}". */
  buttonLabel?: string;
  /** Per-lens accent colour so the empty state fits the app. Default 'cyan'. */
  accent?: EmptyStateAccent;
  /** Wire the button to the lens's OWN action instead of the manifest create macro. */
  onAction?: () => void;
  /** Called with the created artifact's macro result (manifest mode only). */
  onCreated?: (result: unknown) => void;
  /** Extra class on the outer wrapper. */
  className?: string;
}

export function EmptyStateCTA({
  lensId: lensIdProp,
  headline,
  caption,
  buttonLabel,
  accent = 'cyan',
  onAction,
  onCreated,
  className,
}: EmptyStateCTAProps) {
  let resolvedLensId = lensIdProp;
  if (!resolvedLensId) {
    try {
      resolvedLensId = useLensShell().lensId; // eslint-disable-line react-hooks/rules-of-hooks
    } catch {
      resolvedLensId = undefined;
    }
  }

  const addToast = useUIStore((s) => s.addToast);
  const [creating, setCreating] = useState(false);
  const a = ACCENTS[accent] ?? ACCENTS.cyan;

  const manifest = resolvedLensId ? getLensManifest(resolvedLensId) : undefined;
  const artifact = manifest?.artifacts?.[0];
  const createMacro = manifest?.macros?.create;
  const lensLabel = manifest?.label ?? resolvedLensId ?? 'this lens';

  const computedCaption =
    caption ?? `Start by adding ${artifact ? `your first ${artifact}` : `something to ${lensLabel}`}.`;
  const computedButtonLabel =
    buttonLabel ?? (artifact ? `Create your first ${artifact}` : 'Get started');

  const handleCreate = async () => {
    if (!manifest || !createMacro) {
      addToast({ type: 'info', message: `${lensLabel}: nothing to create yet.`, duration: 4000 });
      return;
    }
    setCreating(true);
    try {
      const res = await apiHelpers.lens.runDomain(manifest.domain, 'create', {});
      const body = (res as { data?: { ok?: boolean; error?: string; result?: unknown } }).data;
      if (body?.ok === false && body.error) {
        addToast({ type: 'error', message: body.error, duration: 6000 });
      } else {
        onCreated?.(body?.result ?? body);
      }
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'Create failed', duration: 6000 });
    } finally {
      setCreating(false);
    }
  };

  const handleClick = onAction ?? handleCreate;

  return (
    <CanonicalEmptyState
      className={className}
      icon={<Sparkles className={cn('h-5 w-5', a.icon)} aria-hidden="true" />}
      title={headline ?? 'Nothing here yet.'}
      description={computedCaption}
      action={{
        label: computedButtonLabel,
        onClick: handleClick,
        disabled: creating,
        icon: creating ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="h-4 w-4" aria-hidden="true" />
        ),
        className: cn(
          'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium border',
          'focus:outline-none focus:ring-2 disabled:opacity-50',
          a.btn,
        ),
      }}
    />
  );
}

export default EmptyStateCTA;
