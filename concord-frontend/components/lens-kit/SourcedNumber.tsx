'use client';

/**
 * SourcedNumber — the only way a kit lens shows a number.
 *
 * Renders the value, and a small badge that says where it came from and how sure
 * it is (hover, focus or tap to read it). Given anything `sourced()` did not build,
 * it shows a visible refusal in place of the number — "no source" — never the
 * number itself, so a fabricated or unsourced figure cannot slip onto a page.
 */

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatSource, formatUncertainty, formatValue, isSourced, type SourcedNumber as SN, type SourcedResult } from '@/lib/lens-kit/sourced';

const SOURCE_MARK: Record<SN['source']['kind'], string> = {
  solver: 'computed by a solver', measured: 'measured', cited: 'from a cited source', ledger: 'from the ledger',
  user: 'entered by you', computed: 'computed', feed: 'from a live feed',
};

export interface SourcedNumberProps {
  /** A value from `sourced()` / `mustSource()` / an adapter. A `SourcedResult` is accepted and its refusal shown. */
  n: SN | SourcedResult | unknown;
  /** Show the uncertainty inline after the value (default: only in the badge). */
  showUncertainty?: boolean;
  className?: string;
}

export function SourcedNumber({ n, showUncertainty = false, className }: SourcedNumberProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const value = isSourced(n) ? n : n && typeof n === 'object' && (n as SourcedResult).ok === true && isSourced((n as { n: unknown }).n) ? (n as { n: SN }).n : null;
  if (!value) {
    const reason = n && typeof n === 'object' && (n as SourcedResult).ok === false ? (n as { reason: string }).reason : 'this number was not built with sourced()';
    if (process.env.NODE_ENV !== 'production') console.error(`[lens-kit] refused to show a number: ${reason}`);
    return (
      <span role="note" data-testid="sourced-refused" className={cn('inline-flex items-center gap-1 rounded border border-dashed px-1 text-[0.85em] text-[color:var(--lk-danger,#b42318)]', className)} title={reason}>
        <span aria-hidden>—</span><span>no source: {reason}</span>
      </span>
    );
  }
  const where = formatSource(value), sure = formatUncertainty(value);
  return (
    <span className={cn('inline-flex items-baseline gap-1', className)} data-testid="sourced-number" data-source-kind={value.source.kind}>
      <span className="tabular-nums">{formatValue(value)}</span>
      {showUncertainty && value.uncertainty.kind !== 'exact' ? <span className="text-[0.85em] text-[color:var(--lk-text-muted,#525252)]">({sure})</span> : null}
      <button type="button" aria-describedby={open ? id : undefined} aria-expanded={open} aria-label={`${value.label ?? 'number'}: ${SOURCE_MARK[value.source.kind]}. Where it came from`}
        onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        className="relative inline-flex h-[1.1em] min-w-[1.1em] items-center justify-center self-center rounded-full border border-current px-[0.2em] text-[0.62em] leading-none text-[color:var(--lk-text-muted,#525252)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1">
        <span aria-hidden>{value.uncertainty.kind === 'unknown' ? '?' : 'i'}</span>
        {open ? (
          <span role="tooltip" id={id} data-testid="sourced-detail"
            className="absolute bottom-full left-1/2 z-50 mb-1 w-max max-w-[min(18rem,80vw)] -translate-x-1/2 rounded-md border bg-[color:var(--lk-surface-raised,#fff)] p-2 text-left text-[12px] font-normal leading-snug text-[color:var(--lk-text,#171717)] shadow-lg">
            <span className="block"><span className="font-semibold">From:</span> {where}</span>
            <span className="block"><span className="font-semibold">How sure:</span> {sure}</span>
          </span>
        ) : null}
      </button>
    </span>
  );
}
