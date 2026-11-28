'use client';

/**
 * ReceiptCard — what a check proved, in one shape for every lens.
 *
 * A receipt says: this result, these numbers (each sourced), this method, this
 * reference, this verdict — and, when the server signed it, the receipt id anyone
 * can verify. An unsigned result says why it is not signed; it is never dressed up
 * as a signed one. `receiptFromServer()` reads the signing fields the lens dispatch
 * returns (`signed`, `signingReason`, `receiptId`, `receiptUrl`, `calcReceipt`).
 */

import { cn } from '@/lib/utils';
import { SourcedNumber } from './SourcedNumber';
import type { SourcedNumber as SN, SourcedResult } from '@/lib/lens-kit/sourced';
import { describeUnsignedReason } from '@/components/chem/SigningStatus';

export type ReceiptVerdict = 'pass' | 'fail' | 'warn' | 'not_checked';

export interface Receipt {
  title: string;
  verdict: ReceiptVerdict;
  /** The numbers the verdict rests on, each from `sourced()`. */
  lines: Array<{ label: string; n: SN | SourcedResult; note?: string }>;
  method?: string;
  reference?: string;
  /** Present only when the server signed it. */
  signed: boolean;
  receiptId?: string;
  receiptUrl?: string;
  /** Why it is not signed, in words (from the server's reason). */
  unsignedReason?: string;
  at?: string;
}

const VERDICT: Record<ReceiptVerdict, { text: string; cls: string }> = {
  pass: { text: 'Passes', cls: 'text-[color:var(--lk-ok,#067647)]' },
  fail: { text: 'Fails', cls: 'text-[color:var(--lk-danger,#b42318)]' },
  warn: { text: 'Passes, with warnings', cls: 'text-[color:var(--lk-warn,#93370d)]' },
  not_checked: { text: 'Not checked', cls: 'text-[color:var(--lk-text-muted,#525252)]' },
};

/** Why it is not signed, from the server's own reason codes (one wording for the whole app). */
export const describeUnsigned = (reason?: string): string => describeUnsignedReason(reason);

/** Read the signing fields a lens action returns (either nesting). */
export function receiptFromServer(raw: unknown, base: Omit<Receipt, 'signed' | 'receiptId' | 'receiptUrl' | 'unsignedReason'>): Receipt {
  const r = (raw && typeof raw === 'object' ? ((raw as { result?: unknown }).result ?? raw) : {}) as Record<string, unknown>;
  const signed = r.signed === true && typeof r.receiptId === 'string';
  return {
    ...base,
    signed,
    receiptId: signed ? String(r.receiptId) : undefined,
    receiptUrl: signed && typeof r.receiptUrl === 'string' ? r.receiptUrl : undefined,
    unsignedReason: signed ? undefined : describeUnsigned(typeof r.signingReason === 'string' ? r.signingReason : typeof r.reason === 'string' ? r.reason : undefined),
  };
}

export function ReceiptCard({ receipt, className }: { receipt: Receipt; className?: string }) {
  const v = VERDICT[receipt.verdict];
  return (
    <section aria-label={`Receipt: ${receipt.title}`} data-testid="receipt-card"
      className={cn('min-w-0 rounded-lg border border-[color:var(--lk-line,#d4d4d4)] bg-[color:var(--lk-surface-raised,#fff)] p-3 text-[color:var(--lk-text,#171717)]', className)}>
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 break-words text-sm font-semibold">{receipt.title}</h3>
        <span className={cn('text-sm font-semibold', v.cls)} data-testid="receipt-verdict">{v.text}</span>
      </header>
      {receipt.lines.length ? (
        <dl className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
          {receipt.lines.map((l, i) => (
            <div key={`${l.label}-${i}`} className="contents">
              <dt className="min-w-0 break-words text-[color:var(--lk-text-muted,#525252)]">{l.label}{l.note ? <span className="block text-[11px]">{l.note}</span> : null}</dt>
              <dd className="text-right"><SourcedNumber n={l.n} showUncertainty /></dd>
            </div>
          ))}
        </dl>
      ) : null}
      {receipt.method || receipt.reference ? (
        <p className="mt-2 break-words text-[12px] text-[color:var(--lk-text-muted,#525252)]">
          {receipt.method ? <>Method: {receipt.method}. </> : null}
          {receipt.reference ? <>Reference: {receipt.reference}.</> : null}
        </p>
      ) : null}
      <footer className="mt-2 border-t border-[color:var(--lk-line,#d4d4d4)] pt-2 text-[12px]" data-testid="receipt-signature">
        {receipt.signed ? (
          <span>Signed receipt <span className="font-mono">{receipt.receiptId}</span>{receipt.receiptUrl ? <> · <a className="underline" href={receipt.receiptUrl}>verify it</a></> : null}</span>
        ) : (
          <span className="text-[color:var(--lk-warn,#93370d)]">Unsigned: {receipt.unsignedReason || describeUnsigned()}. Don&apos;t rely on it for sign-off.</span>
        )}
        {receipt.at ? <span className="ml-2 text-[color:var(--lk-text-muted,#525252)]">{receipt.at}</span> : null}
      </footer>
    </section>
  );
}
