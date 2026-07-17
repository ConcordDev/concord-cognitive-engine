'use client';

// concord-frontend/components/conkay/ConKayActionConfirm.tsx
//
// Unit A2 — the pre-execution confirmation card for a CLIENT-INITIATED
// state-mutating macro call. Rendered by ConKayOverlay in the transcript
// (same lane as ConKayWorkStatus) whenever `executeMacro` is about to run a
// macro `isMutatingMacro()` flags as a write, BEFORE `lensRun` is ever
// called. Nothing here is a guess: `domain`/`macro`/`input` are the exact
// object ConKayOverlay is about to send to `/api/lens/run` — this is a
// preview of the real call, not a paraphrase of it.
//
// Honesty note: this card can ONLY gate the client-initiated path
// (`executeMacro`/`resolveAndOperate` in ConKayOverlay.tsx, which call
// `/api/lens/run` themselves). It is NOT rendered on the server-side
// agent-loop path (`chatWithBrain` → `/api/chat-agent/stream`), because that
// loop's tools already ran server-side before the client ever sees the
// `tool_call` SSE event — see the comment at that call site for why a
// pre-confirm there would be fake.

import { Check, X, AlertTriangle } from 'lucide-react';

export interface ConKayActionConfirmProps {
  domain: string;
  macro: string;
  input: Record<string, unknown>;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConKayActionConfirm({ domain, macro, input, onConfirm, onCancel }: ConKayActionConfirmProps) {
  let inputPreview = '{}';
  try {
    const raw = JSON.stringify(input ?? {}, null, 2);
    inputPreview = raw.length > 800 ? `${raw.slice(0, 800)}\n…` : raw;
  } catch {
    inputPreview = '(unserializable input)';
  }
  const hasInput = input && Object.keys(input).length > 0;

  return (
    <div
      data-testid="conkay-action-confirm"
      role="alertdialog"
      aria-label={`Confirm running ${domain}.${macro}`}
      className="ck-reveal mx-auto my-2 max-w-2xl rounded-2xl border border-amber-400/30 bg-black/50 px-4 py-3 backdrop-blur"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-amber-100">
            This will run <code className="rounded bg-amber-400/10 px-1 py-0.5 text-amber-200">{domain}.{macro}</code> and change data. Run it?
          </p>
          {hasInput && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-amber-400/15 bg-black/40 p-2 text-[11px] leading-snug text-amber-100/70">
              {inputPreview}
            </pre>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              aria-label={`Confirm and run ${domain}.${macro}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-400/20"
            >
              <Check className="h-3.5 w-3.5" /> Run it
            </button>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel — do not run this action"
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/20 bg-black/30 px-3 py-1.5 text-xs font-medium text-cyan-200/80 hover:bg-cyan-400/10"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConKayActionConfirm;
