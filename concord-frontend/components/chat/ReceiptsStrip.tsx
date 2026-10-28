'use client';

// ReceiptsStrip — the receipts moment under an assistant reply (Product
// Chat review 2026-10-28, F2/S2; delight rule 8: this strip is a DESIGNED
// moment, not a footnote).
//
// Spec (F2, verbatim shape): (a) sources used, clickable, or an explicit
// "No external sources — model answer" label; (b) a verdict label in
// ConKay's vocabulary — sourced / computed / estimated / not computed;
// (c) confidence shown as a designed element tied to the verdict, not a
// plain-text apology; (d) tapping the strip opens the detail (sources,
// solver check, confidence reason).
//
// Verdict derivation (all from fields the server already puts on the
// message — nothing invented):
//   computed     — message.computed carries solver capabilities
//   sourced      — message.sources / dtuRefs / webAugmented
//   estimated    — the server flagged the answer confidence:'low' (the
//                  backup-model path: an estimate, said out loud)
//   not computed — a plain model answer; the strip says so, always.
// Silence is the one state not allowed: every assistant reply renders
// this strip.

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Calculator, ChevronDown, Globe, MessageSquare, RefreshCw, ShieldCheck } from 'lucide-react';

// One-click re-verify result, as returned by the chat.reverify-receipts
// macro (server/lib/chat/reverify-receipts.js). Each leg reports what it
// actually re-checked against the stored record.
export interface ReverifyLeg {
  leg: 'solver' | 'sources' | 'dtus';
  status: string;
  detail: string;
}
export interface ReverifyResult {
  found: boolean;
  reason?: string;
  verifiedAt?: string;
  legs: ReverifyLeg[];
  summary: string;
}

export interface ReceiptMessage {
  computed?: {
    capabilities?: Array<{ key: string; score?: number; description?: string }>;
    engineCount?: number;
  } | null;
  sources?: Array<{ title?: string; url: string; source?: string }> | null;
  dtuRefs?: Array<{ id: string; title?: string | null }> | null;
  webAugmented?: boolean;
  confidence?: string | null;
  confidenceReason?: string | null;
}

export type ReceiptVerdict = 'computed' | 'sourced' | 'estimated' | 'not-computed';

export function receiptVerdict(m: ReceiptMessage): ReceiptVerdict {
  if (m.computed && Array.isArray(m.computed.capabilities) && m.computed.capabilities.length > 0) {
    return 'computed';
  }
  if ((m.sources && m.sources.length > 0) || (m.dtuRefs && m.dtuRefs.length > 0) || m.webAugmented) {
    return 'sourced';
  }
  if (m.confidence === 'low') return 'estimated';
  return 'not-computed';
}

const VERDICT_STYLE: Record<ReceiptVerdict, string> = {
  computed: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
  sourced: 'border-cyan-400/25 bg-cyan-500/10 text-cyan-300',
  estimated: 'border-amber-400/25 bg-amber-500/10 text-amber-300',
  'not-computed': 'border-zinc-600/50 bg-zinc-500/10 text-zinc-400',
};

export default function ReceiptsStrip({
  message,
  onReverify,
}: {
  message: ReceiptMessage;
  onReverify?: () => Promise<ReverifyResult | null>;
}) {
  const [open, setOpen] = useState(false);
  const [reverifyState, setReverifyState] = useState<
    | { phase: 'idle' }
    | { phase: 'pending' }
    | { phase: 'done'; result: ReverifyResult }
    | { phase: 'error'; message: string }
  >({ phase: 'idle' });
  const verdict = receiptVerdict(message);

  const runReverify = async () => {
    if (!onReverify || reverifyState.phase === 'pending') return;
    setReverifyState({ phase: 'pending' });
    try {
      const result = await onReverify();
      if (result) setReverifyState({ phase: 'done', result });
      else setReverifyState({ phase: 'error', message: 'Re-verify came back empty — the stored record could not be read.' });
    } catch {
      setReverifyState({ phase: 'error', message: 'Re-verify failed — the stored record could not be reached.' });
    }
  };
  const sources = message.sources ?? [];
  const dtuRefs = message.dtuRefs ?? [];
  const capabilities = message.computed?.capabilities ?? [];
  const lowConfidence = message.confidence === 'low';

  const verdictLabel =
    verdict === 'computed'
      ? 'Computed — checked by Concord\u2019s solvers'
      : verdict === 'sourced'
        ? `Sourced — ${sources.length + dtuRefs.length} source${sources.length + dtuRefs.length !== 1 ? 's' : ''}`
        : verdict === 'estimated'
          ? 'Estimated — not checked'
          : 'Not computed';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="mt-2 text-[11px]"
      data-testid="receipts-strip"
      data-verdict={verdict}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Answer receipts: ${verdictLabel}. ${open ? 'Hide' : 'Show'} detail.`}
        className="flex flex-wrap items-center gap-1.5 text-left"
      >
        <span
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 ${VERDICT_STYLE[verdict]}`}
        >
          {verdict === 'computed' ? (
            <ShieldCheck className="w-3 h-3" />
          ) : verdict === 'sourced' ? (
            <Globe className="w-3 h-3" />
          ) : verdict === 'estimated' ? (
            <Calculator className="w-3 h-3" />
          ) : (
            <MessageSquare className="w-3 h-3" />
          )}
          {verdictLabel}
        </span>
        {verdict === 'not-computed' && (
          <span className="inline-flex items-center rounded-md border border-zinc-700/60 px-2 py-0.5 text-zinc-500">
            No external sources — model answer
          </span>
        )}
        {/* Designed confidence element (spec c): a meter tied to the
            verdict, never a plain-text apology. Only the server's 'low'
            signal exists today, so the meter shows one of three dots. */}
        {lowConfidence && (
          <span
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/25 bg-amber-500/5 px-2 py-0.5 text-amber-200/90"
            title={message.confidenceReason || 'Low confidence, backup model'}
            data-testid="receipts-confidence"
          >
            <span className="flex items-end gap-[2px]" aria-hidden="true">
              <span className="block w-1 h-1 rounded-sm bg-amber-300" />
              <span className="block w-1 h-1.5 rounded-sm bg-zinc-600" />
              <span className="block w-1 h-2 rounded-sm bg-zinc-600" />
            </span>
            Low confidence
          </span>
        )}
        <ChevronDown
          className={`w-3 h-3 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className="mt-1.5 rounded-md border border-zinc-700/50 bg-zinc-900/40 px-2.5 py-2 text-zinc-400"
          data-testid="receipts-detail"
        >
          {verdict === 'computed' && capabilities.length > 0 && (
            <p className="mb-1">
              Solver check: {capabilities.map((c) => c.description || c.key).join('; ')}
              {message.computed?.engineCount
                ? ` (${message.computed.engineCount} engine${message.computed.engineCount !== 1 ? 's' : ''})`
                : ''}
            </p>
          )}
          {sources.length > 0 && (
            <ul className="space-y-0.5">
              {sources.map((s, i) => (
                <li key={`${s.url}-${i}`}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-300 underline decoration-cyan-300/40 underline-offset-2 hover:decoration-cyan-300"
                  >
                    {s.title || s.url}
                  </a>
                  {s.source ? <span className="text-zinc-500"> — {s.source}</span> : null}
                </li>
              ))}
            </ul>
          )}
          {dtuRefs.length > 0 && (
            <p className={sources.length > 0 ? 'mt-1' : ''}>
              Cited DTUs: {dtuRefs.map((d) => d.title || d.id).join(', ')}
            </p>
          )}
          {lowConfidence && message.confidenceReason && (
            <p className={sources.length > 0 || dtuRefs.length > 0 ? 'mt-1' : ''}>
              {message.confidenceReason}
            </p>
          )}
          {verdict === 'not-computed' && !lowConfidence && sources.length === 0 && dtuRefs.length === 0 && (
            <p>
              Nothing was checked for this answer — no solver ran and no sources were cited.
              Ask a question a solver can check, or use a mode that cites sources, and this
              strip will show the receipts.
            </p>
          )}
          {verdict === 'estimated' && (
            <p>
              This answer came from the backup model while the main brain was unavailable —
              treat it as an estimate, not a checked result.
            </p>
          )}
          {onReverify && (
            <div className="mt-2 border-t border-zinc-700/40 pt-2">
              <button
                type="button"
                onClick={() => void runReverify()}
                disabled={reverifyState.phase === 'pending'}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-600/60 px-2 py-1 text-[11px] text-zinc-200 transition-colors hover:border-zinc-400 disabled:opacity-50"
                data-testid="receipts-reverify"
              >
                <RefreshCw className={`w-3 h-3 ${reverifyState.phase === 'pending' ? 'animate-spin' : ''}`} />
                {reverifyState.phase === 'pending' ? 'Re-verifying…' : 'Re-verify this answer'}
              </button>
              {reverifyState.phase === 'done' && (
                <div className="mt-1.5" data-testid="receipts-reverify-result">
                  <p>{reverifyState.result.summary}</p>
                  {reverifyState.result.legs.map((l) => (
                    <p key={l.leg} className="mt-0.5">
                      <span className="text-zinc-300">{l.leg}:</span> {l.detail}
                    </p>
                  ))}
                  {reverifyState.result.verifiedAt && (
                    <p className="mt-0.5 text-zinc-500">
                      Checked {new Date(reverifyState.result.verifiedAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              )}
              {reverifyState.phase === 'error' && (
                <p className="mt-1.5 text-amber-300/90" data-testid="receipts-reverify-error">
                  {reverifyState.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
