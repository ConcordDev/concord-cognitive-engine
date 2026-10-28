'use client';

// ReceiptsStrip — the always-on receipts line under an assistant reply
// (Product Chat review 2026-10-28, F2/A6: FAIL — a reply arrived with no
// citations, no verify, no receipts).
//
// The data already rides on the message (computed / sources / dtuRefs /
// webAugmented), but the surfaces below only render when it is present —
// so a plain model answer showed NOTHING, and the user could not tell an
// unchecked answer from a checked one. This strip always renders a
// verdict for an assistant message:
//
//   computed — a deterministic solver ran (ComputeBadge below has detail)
//   sourced  — external sources / cited DTUs (panels below carry links)
//   model    — neither: the strip says so out loud, in ConKay's
//              vocabulary: "No external sources — model answer" and
//              "Not computed". Silence is the one state not allowed.

import { Calculator, Globe, MessageSquare } from 'lucide-react';

export interface ReceiptMessage {
  computed?: {
    capabilities?: Array<{ key: string; score?: number; description?: string }>;
    engineCount?: number;
  } | null;
  sources?: Array<{ url: string }> | null;
  dtuRefs?: Array<{ id: string }> | null;
  webAugmented?: boolean;
}

export type ReceiptVerdict = 'computed' | 'sourced' | 'model';

export function receiptVerdict(m: ReceiptMessage): ReceiptVerdict {
  if (m.computed && Array.isArray(m.computed.capabilities) && m.computed.capabilities.length > 0) {
    return 'computed';
  }
  if ((m.sources && m.sources.length > 0) || (m.dtuRefs && m.dtuRefs.length > 0) || m.webAugmented) {
    return 'sourced';
  }
  return 'model';
}

export default function ReceiptsStrip({ message }: { message: ReceiptMessage }) {
  const verdict = receiptVerdict(message);
  const sourceCount = (message.sources?.length || 0) + (message.dtuRefs?.length || 0);
  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]"
      data-testid="receipts-strip"
      data-verdict={verdict}
      role="group"
      aria-label="Answer receipts"
    >
      {verdict === 'computed' && (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
          <Calculator className="w-3 h-3" />
          Computed — checked by Concord&apos;s solvers
        </span>
      )}
      {verdict === 'sourced' && (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-cyan-300">
          <Globe className="w-3 h-3" />
          Sourced{sourceCount > 0 ? ` — ${sourceCount} source${sourceCount !== 1 ? 's' : ''} below` : ''}
        </span>
      )}
      {verdict === 'model' && (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-600/50 bg-zinc-500/10 px-2 py-0.5 text-zinc-400">
            <MessageSquare className="w-3 h-3" />
            No external sources — model answer
          </span>
          <span className="inline-flex items-center rounded-md border border-zinc-700/60 px-2 py-0.5 text-zinc-500">
            Not computed
          </span>
        </>
      )}
    </div>
  );
}
