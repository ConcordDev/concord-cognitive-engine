'use client';

/**
 * DraftedInput — drop-in <input type="text"> that auto-saves to the
 * lens draft substrate every keystroke (debounced).
 *
 * Same contract as DraftedTextarea, for single-line inputs.
 */

import { InputHTMLAttributes, useEffect } from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { useLensDraft } from '@/hooks/useLensDraft';
import { cn } from '@/lib/utils';

export interface DraftedInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'defaultValue' | 'type'> {
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
  /** Input type. Defaults to 'text'. Pass 'search' / 'url' / etc. as needed. */
  type?: 'text' | 'search' | 'url' | 'email' | 'tel';
  /** Optional wrapper classname. */
  wrapperClassName?: string;
}

export function DraftedInput({
  lensId,
  draftKey,
  initial = '',
  debounceMs,
  schemaVersion,
  onValueChange,
  hideStatus = false,
  wrapperClassName,
  className,
  type = 'text',
  ...inputProps
}: DraftedInputProps) {
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

  useEffect(() => {
    onValueChange?.(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className={cn('relative inline-block w-full', wrapperClassName)}>
      <input
        {...inputProps}
        type={type}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={cn(className, !hideStatus ? 'pr-16' : '')}
        aria-describedby={!hideStatus ? `${lensId}-${draftKey}-status` : undefined}
      />
      {!hideStatus && (
        <div
          id={`${lensId}-${draftKey}-status`}
          className="absolute top-1/2 -translate-y-1/2 right-2 flex items-center gap-1 text-[10px] font-mono select-none pointer-events-none"
          aria-live="polite"
        >
          {status === 'saving' && <Loader2 className="w-2.5 h-2.5 animate-spin text-zinc-400" aria-hidden="true" />}
          {status === 'saved' && lastSavedAt && <Check className="w-2.5 h-2.5 text-emerald-400" aria-hidden="true" />}
          {status === 'error' && <AlertCircle className="w-2.5 h-2.5 text-amber-400" aria-hidden="true" />}
          {status === 'dirty' && <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}

export default DraftedInput;
