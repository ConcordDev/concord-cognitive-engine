'use client';

/**
 * EmptyStateCTA — drop-in empty state derived from the lens manifest.
 *
 * When a lens has no data, render this instead of a "No items yet"
 * dead-end. It pulls the lens's primary artifact + create macro from
 * the manifest and gives the user a single, obvious "Create your first
 * X" button. Closes the most common UX hole on shallow lenses with
 * zero per-lens code.
 *
 * Use:
 *   {items.length === 0 && <EmptyStateCTA />}                  // inside <LensShell>
 *   <EmptyStateCTA lensId="chat" />                            // explicit
 *   <EmptyStateCTA caption="Author your first quest" />        // override copy
 *   <EmptyStateCTA onCreated={(item) => …} />                  // post-create hook
 */

import { useState } from 'react';
import { Plus, Sparkles, Loader2 } from 'lucide-react';

import { apiHelpers } from '@/lib/api/client';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import { useLensShell } from './LensShell';

export interface EmptyStateCTAProps {
  lensId?: string;
  /** Override the headline. Default: "Nothing here yet." */
  headline?: string;
  /** Override the body copy. Default derived from manifest.label. */
  caption?: string;
  /** Override the button label. Default: "Create your first {artifact}". */
  buttonLabel?: string;
  /** Called with the created artifact's macro result. */
  onCreated?: (result: unknown) => void;
  /** Extra class on the outer wrapper. */
  className?: string;
}

export function EmptyStateCTA({
  lensId: lensIdProp,
  headline,
  caption,
  buttonLabel,
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
      addToast({
        type: 'info',
        message: `${lensLabel}: nothing to create yet.`,
        duration: 4000,
      });
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
      addToast({
        type: 'error',
        message: e instanceof Error ? e.message : 'Create failed',
        duration: 6000,
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-12 px-6',
        'rounded-lg border border-dashed border-lattice-border/60 bg-lattice-surface/20',
        className,
      )}
      role="region"
      aria-label="Empty state"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-lattice-surface/60 text-neon-cyan">
        <Sparkles className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-white mb-1">
        {headline ?? 'Nothing here yet.'}
      </h3>
      <p className="text-sm text-gray-400 max-w-md mb-4">{computedCaption}</p>
      <button
        type="button"
        onClick={handleCreate}
        disabled={creating}
        className={cn(
          'inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
          'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30',
          'hover:bg-neon-cyan/25 focus:outline-none focus:ring-2 focus:ring-neon-cyan/40',
          'disabled:opacity-50',
        )}
      >
        {creating ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="h-4 w-4" aria-hidden="true" />
        )}
        {computedButtonLabel}
      </button>
    </div>
  );
}

export default EmptyStateCTA;
