'use client';

/**
 * DraftedTextarea — drop-in <textarea> that auto-saves to the lens
 * draft substrate every keystroke (debounced).
 *
 * Phase 3 of the 10-dimension UX completeness sprint. Authors swap:
 *
 *   <textarea
 *     value={notes}
 *     onChange={(e) => setNotes(e.target.value)}
 *     ...
 *   />
 *
 * for:
 *
 *   <DraftedTextarea
 *     lensId="pharmacy"
 *     draftKey="rxNote"
 *     placeholder="Notes..."
 *     ...other textarea props...
 *   />
 *
 * The component owns its own state, debounces to the server via
 * useLensDraft, mirrors to localStorage for offline durability, and
 * shows a tiny status indicator (saving · saved · error).
 *
 * If the caller needs visibility into the value (e.g. to submit a
 * form), pass `onValueChange={(v) => setExternalRef(v)}`. The
 * draft IS the source of truth; the caller mirror is informational.
 *
 * Call `useLensDraftClear(lensId, draftKey)` from your mint handler
 * to wipe the draft after a successful submit.
 */

import { TextareaHTMLAttributes, useEffect } from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { useLensDraft } from '@/hooks/useLensDraft';
import { cn } from '@/lib/utils';

export interface DraftedTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'defaultValue'> {
  lensId: string;
  draftKey: string;
  /** Initial value before the server-side draft hydrates. Default ''. */
  initial?: string;
  /** Debounce window in ms. Default 1500. */
  debounceMs?: number;
  /** Manifest schema version for the payload shape. Default 1. */
  schemaVersion?: number;
  /** Mirror updates back to the caller (informational; draft is canonical). */
  onValueChange?: (next: string) => void;
  /** Hide the saving / saved indicator. Default false. */
  hideStatus?: boolean;
  /** Optional wrapper classname. */
  wrapperClassName?: string;
}

export function DraftedTextarea({
  lensId,
  draftKey,
  initial = '',
  debounceMs,
  schemaVersion,
  onValueChange,
  hideStatus = false,
  wrapperClassName,
  className,
  ...textareaProps
}: DraftedTextareaProps) {
  const { value, setValue, status, lastSavedAt } = useLensDraft<string>(
    lensId,
    draftKey,
    {
      initial,
      debounceMs,
      schemaVersion,
      onSaved: onValueChange ? (v) => onValueChange(v) : undefined,
      onHydrated: onValueChange ? (v) => onValueChange(v) : undefined,
    },
  );

  // Mirror to caller on every keystroke so optimistic submit handlers see the live value.
  useEffect(() => {
    onValueChange?.(value);
    // We deliberately do NOT depend on onValueChange — only the value changes
    // should fire the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={cn('relative', wrapperClassName)}>
      <textarea
        {...textareaProps}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={className}
        aria-describedby={!hideStatus ? `${lensId}-${draftKey}-status` : undefined}
      />
      {!hideStatus && (
        <div
          id={`${lensId}-${draftKey}-status`}
          className="absolute bottom-1.5 right-2 flex items-center gap-1 text-[10px] font-mono select-none pointer-events-none"
          aria-live="polite"
        >
          {status === 'saving' && (
            <>
              <Loader2 className="w-2.5 h-2.5 animate-spin text-zinc-400" aria-hidden="true" />
              <span className="text-zinc-400">saving</span>
            </>
          )}
          {status === 'saved' && lastSavedAt && (
            <>
              <Check className="w-2.5 h-2.5 text-emerald-400" aria-hidden="true" />
              <span className="text-zinc-500">saved</span>
            </>
          )}
          {status === 'error' && (
            <>
              <AlertCircle className="w-2.5 h-2.5 text-amber-400" aria-hidden="true" />
              <span className="text-amber-400">offline</span>
            </>
          )}
          {status === 'dirty' && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70" aria-hidden="true" />
              <span className="text-amber-300/70">unsaved</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default DraftedTextarea;
