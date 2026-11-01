'use client';

/**
 * WorkspaceBusCopyButton — the one-line "Send to Workspace Bus" action
 * lens authors drop next to a DTU to make it available cross-lens via
 * Cmd/Ctrl+Shift+V. Optional convenience wrapper around
 * `useWorkspaceBus().publish()` — nothing in this file is required to use
 * the bus (any component can call `publish()` directly), it just saves
 * boilerplate at the ~260 call sites that will eventually want it.
 */

import { useState } from 'react';
import { ClipboardCopy, Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { DTU } from '@/lib/api/generated-types';
import { useUIStore } from '@/store/ui';
import { useWorkspaceBus, type WorkspaceBusDTU } from './WorkspaceBusProvider';

export interface WorkspaceBusCopyButtonProps {
  dtu: DTU | WorkspaceBusDTU;
  compact?: boolean;
  className?: string;
  /** Fires after publish (e.g. to close a menu). */
  onCopied?: () => void;
}

export function WorkspaceBusCopyButton({ dtu, compact, className, onCopied }: WorkspaceBusCopyButtonProps) {
  const bus = useWorkspaceBus();
  const activeLens = useUIStore((s) => s.activeLens);
  const [sent, setSent] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        bus.publish(dtu, { sourceLensId: activeLens });
        // Feedback (F9): the publish used to be invisible — confirm it.
        setSent(true);
        window.setTimeout(() => setSent(false), 1600);
        onCopied?.();
      }}
      title="Send to Workspace Bus (Cmd/Ctrl+Shift+V to paste elsewhere)"
      className={cn(
        'inline-flex items-center gap-1 rounded border border-lattice-border/60 bg-lattice-surface/40 text-gray-400',
        'hover:text-white hover:border-neon-cyan/50 transition',
        compact ? 'p-1 text-[9px]' : 'px-1.5 py-0.5 text-[10px]',
        className
      )}
      aria-label="Send to Workspace Bus"
      aria-live="polite"
    >
      {sent ? <Check className={compact ? 'w-2.5 h-2.5 text-emerald-400' : 'w-3 h-3 text-emerald-400'} /> : <ClipboardCopy className={compact ? 'w-2.5 h-2.5' : 'w-3 h-3'} />}
      {!compact && (sent ? 'Sent' : 'To Bus')}
    </button>
  );
}

export default WorkspaceBusCopyButton;
