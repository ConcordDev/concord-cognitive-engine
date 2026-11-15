'use client';

// Signed / unsigned verdict rendered inline with a chem answer. The server's
// declarations hook (POST /api/lens/run) merges the signing fields INSIDE
// `result` (signed, saved, signingReason, receiptId, receiptUrl) — the HTTP
// shaper drops siblings of `result`. signingInfoFrom reads either nesting. Unsigned
// is deliberately the louder state: a number without a verified reference and
// validity envelope must not be relied on for sign-off.

export interface SigningInfo {
  signed?: boolean;
  reason?: string;
  saveError?: string;
  receiptId?: string;
  receiptUrl?: string;
}

const REASON_TEXT: Record<string, string> = {
  missing_reference: 'no verified reference for this calculation',
  missing_envelope: 'no declared validity envelope',
  malformed_reference: 'reference check could not be evaluated',
  missing_declaration: 'no cited reference case is declared for this calculation',
  llm_backed_action: 'AI-generated answer, never signed',
  incomplete_declaration: 'its reference/envelope declaration is incomplete',
  out_of_envelope: 'inputs are outside the validated range',
  not_computed: 'the solver did not compute a result',
  reference_mismatch: 'the result disagrees with its own reference check',
  no_signing_key: 'this server has no signing key',
};

export function describeUnsignedReason(reason?: string): string {
  if (!reason) return 'no reason given by the server';
  const head = reason.split(':')[0];
  const detail = reason.includes(':') ? reason.slice(reason.indexOf(':') + 1) : '';
  const base = REASON_TEXT[head] ?? head.replace(/_/g, ' ');
  return detail ? `${base} (${detail.replace(/_/g, ' ')})` : base;
}

export function SigningStatus({ info, className = '' }: { info?: SigningInfo | null; className?: string }) {
  if (!info) return null;
  if (info.signed === true) {
    return (
      <div role="status" data-testid="signing-status-signed"
        className={`rounded border border-emerald-400/50 bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-200 ${className}`}>
        ✓ Signed — checked against a verified reference
        {info.receiptId ? <span className="ml-1 font-mono font-normal text-emerald-300/80">{info.receiptId}</span> : null}
        {info.saveError ? <span className="ml-1 font-normal text-amber-300">(receipt not stored: {info.saveError})</span> : null}
      </div>
    );
  }
  const why = describeUnsignedReason(info.reason ?? info.saveError);
  return (
    <div role="alert" data-testid="signing-status-unsigned"
      className={`rounded border-2 border-amber-400 bg-amber-500/25 px-2 py-1.5 text-xs font-bold text-amber-100 ${className}`}>
      ⚠ Unsigned — no verified reference; don&apos;t rely on this for sign-off
      <div className="mt-0.5 text-[11px] font-normal text-amber-200">Reason: {why}</div>
    </div>
  );
}

/** Pull the signing fields off a lens/run response (fields live inside `result`; top level is also read). */
export function signingInfoFrom(env: unknown): SigningInfo {
  const top = (env && typeof env === 'object' ? env : {}) as Record<string, unknown>;
  const inner = top.result && typeof top.result === 'object' ? (top.result as Record<string, unknown>) : null;
  const e = inner && ('signed' in inner || 'signingReason' in inner) ? inner : top;
  return {
    signed: e.signed === true,
    reason: typeof e.signingReason === 'string' ? e.signingReason : typeof e.reason === 'string' ? e.reason : undefined,
    saveError: typeof e.saveError === 'string' ? e.saveError : undefined,
    receiptId: typeof e.receiptId === 'string' ? e.receiptId : undefined,
    receiptUrl: typeof e.receiptUrl === 'string' ? e.receiptUrl : undefined,
  };
}
