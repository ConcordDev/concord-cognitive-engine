'use client';
import { useState } from 'react';

interface ReceiptShape {
  issuedAt?: string; argsHash?: string; resultHash?: string;
  signature?: { signature?: string | null; reason?: string | null } | null;
}

export function ReceiptLink({ runId, stepId }: { runId: string; stepId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'none' } | { kind: 'ok'; r: ReceiptShape }>({ kind: 'idle' });

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`/api/cockpit/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/receipt`, { credentials: 'include' });
      if (!res.ok) { setState({ kind: 'none' }); return; }
      const body = (await res.json()) as { receipt?: ReceiptShape };
      setState(body.receipt ? { kind: 'ok', r: body.receipt } : { kind: 'none' });
    } catch {
      setState({ kind: 'none' });
    }
  };

  return (
    <span className="relative inline-block">
      <button type="button" onClick={toggle} aria-expanded={open} className="text-xs text-neon-blue underline-offset-2 hover:underline">
        Receipt
      </button>
      {open && (
        <span role="dialog" aria-label="Step receipt" className="absolute left-0 top-5 z-20 w-72 rounded border border-lattice-border bg-lattice-surface p-2 text-xs shadow-lg">
          {state.kind === 'loading' && 'Loading…'}
          {state.kind === 'none' && 'No receipt for this step.'}
          {state.kind === 'ok' && (
            <span className="block space-y-1">
              <span className="block">Issued: {state.r.issuedAt ?? 'unknown'}</span>
              <span className="block">{state.r.signature?.signature ? 'Signed' : `Not signed${state.r.signature?.reason ? ` (${state.r.signature.reason})` : ''}`}</span>
              <span className="block break-all">Input: {state.r.argsHash}</span>
              <span className="block break-all">Result: {state.r.resultHash}</span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
