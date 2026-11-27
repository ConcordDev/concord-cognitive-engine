'use client';

/**
 * KayLog — the running conversation with Kay, as a glass pane beside the
 * table. Everything a message carries is real: the tools that actually ran
 * (and whether they failed), the cockpit run card, artifacts the agent's
 * tools returned, a sweep's solved rows, the low-confidence tag when only
 * the backup model answered, and follow-up chips.
 */

import { X } from 'lucide-react';
import { RunCard } from '@/components/cockpit/RunCard';
import LowConfidenceTag from '@/components/chat/LowConfidenceTag';
import { ChatArtifacts } from '@/components/chat/ChatArtifacts';
import MessageRenderer from '@/components/chat/MessageRenderer';
import { ConKayMessage } from '@/components/conkay/ConKayViz';
import { DIM_LABELS, type BeamDims } from '@/lib/conkay/workspace-commands';
import { utilizationColor } from '@/lib/conkay/beam-view';
import type { SweepResult } from '../workspace/useConKayWorkspace';
import type { WorkshopController } from './useWorkshopController';

const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

export function SweepTable({ sweep }: { sweep: SweepResult }) {
  const label = sweep.param === 'loadN' ? 'P (kN)' : `${DIM_LABELS[sweep.param as keyof BeamDims]?.symbol ?? sweep.param} (mm)`;
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-[color:var(--ws-line)]">
      <table className="ws-num w-full text-left text-[11px]">
        <thead className="text-[color:var(--ws-muted)]">
          <tr><th className="px-2 py-1 font-normal">{label}</th><th className="px-2 py-1 font-normal">σ MPa</th><th className="px-2 py-1 font-normal">δ mm</th><th className="px-2 py-1 font-normal">util.</th><th className="px-2 py-1" /></tr>
        </thead>
        <tbody>
          {sweep.rows.map((r) => (
            <tr key={r.value} className={r.value === sweep.lightestPassing ? 'bg-[color:var(--ws-go-soft)]' : ''}>
              <td className="px-2 py-1 text-[color:var(--ws-text)]">{sweep.param === 'loadN' ? r.value / 1000 : r.value}</td>
              {r.ok ? (
                <>
                  <td className="px-2 py-1 text-[color:var(--ws-text)]">{r.maxStressMPa!.toFixed(1)}</td>
                  <td className="px-2 py-1 text-[color:var(--ws-text)]">{r.maxDeflectionMm!.toFixed(3)}</td>
                  <td className="px-2 py-1" style={{ color: utilizationColor(r.utilization!) }}>{(r.utilization! * 100).toFixed(1)}%</td>
                  <td className={`px-2 py-1 ${r.pass ? 'text-[color:var(--ws-go)]' : 'text-[color:var(--ws-red)]'}`}>{r.pass ? 'pass' : 'fail'}</td>
                </>
              ) : (
                <td colSpan={4} className="px-2 py-1 text-[color:var(--ws-red)]">{r.error}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KayLog({ c, onClose, variant = 'side', empty }: {
  c: WorkshopController;
  onClose?: () => void;
  /** 'home': the conversation is the whole screen (larger type, no glass header). */
  variant?: 'side' | 'home';
  /** What an empty conversation shows instead of the study hints. */
  empty?: React.ReactNode;
}) {
  const home = variant === 'home';
  const { messages, busy, clearArmed, setClearArmed, clearConversation, listRef, onChip, guest } = c;
  return (
    <section aria-label="ConKay conversation" className={home ? 'flex h-full min-h-0 flex-col' : 'ws-glass ws-corners flex h-full min-h-0 flex-col rounded-xl'}>
      <header className={`flex items-center justify-between gap-2 ${home ? (messages.length ? 'px-1 pb-1' : 'hidden') : 'border-b border-[color:var(--ws-line)] px-4 py-2.5'}`}>
        <div>
          <h2 className="text-[15px] font-semibold tracking-wide text-[color:var(--ws-text)]">{home ? 'Your conversation' : 'Kay'}</h2>
          {!home && <p className="ws-label">{guest ? 'Demo · solving only' : 'Ask anything · build here'}</p>}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            clearArmed ? (
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => void clearConversation()} disabled={busy} className="rounded px-2 py-1 text-[11px] text-[color:var(--ws-red)] hover:bg-[color:var(--ws-red-soft)] disabled:opacity-50">
                  Confirm clear?
                </button>
                <button type="button" onClick={() => setClearArmed(false)} className="rounded px-2 py-1 text-[11px] text-[color:var(--ws-muted)] hover:bg-[color:var(--ws-arc-soft)]">
                  Keep
                </button>
              </span>
            ) : (
              !guest && (
                <button type="button" onClick={() => setClearArmed(true)} disabled={busy} className="rounded px-2 py-1 text-[11px] text-[color:var(--ws-muted)] hover:bg-[color:var(--ws-arc-soft)] disabled:opacity-50">
                  Clear
                </button>
              )
            )
          )}
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Hide Kay's log" className="rounded p-1 text-[color:var(--ws-muted)] hover:bg-[color:var(--ws-arc-soft)] hover:text-[color:var(--ws-text)]"><X className="h-4 w-4" aria-hidden /></button>
          )}
        </div>
      </header>
      <div ref={listRef} className={`min-h-0 flex-1 overflow-y-auto ${home ? 'space-y-3 px-1 py-2' : 'space-y-2.5 px-3 py-3'}`} aria-live="polite">
        {messages.length === 0 && empty}
        {messages.length === 0 && !empty && c.build && (
          <div className="rounded-md border border-[color:var(--ws-line)] p-3 text-xs leading-relaxed text-[color:var(--ws-muted)]" data-testid="kaylog-build-hint">
            <p className="text-[color:var(--ws-text)]">Pick a part in the model to see its checks and change its sizes or material in any unit; loads and the safety factor are under Loads and settings. Every change re-runs the checks.</p>
          </div>
        )}
        {messages.length === 0 && !empty && !c.build && (
          <div className="rounded-md border border-[color:var(--ws-line)] p-3 text-xs leading-relaxed text-[color:var(--ws-muted)]">
            <p className="mb-2 text-[color:var(--ws-text)]">Ask Kay anything, or talk to the study: edits re-run the solver.</p>
            <ul className="ws-num space-y-1 text-[11px] text-[color:var(--ws-arc)]">
              <li>t_w = 8 mm and re-run</li>
              <li>cantilever, 50 kN, A36</li>
              <li>make it lighter</li>
              <li>save model · keep as DTU</li>
            </ul>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`ws-rise rounded-md border px-3 py-2 ${home ? 'text-[15px]' : 'text-sm'} ${m.role === 'user' ? `${home ? 'ml-auto max-w-[85%]' : 'ml-8'} border-[color:var(--ws-line-strong)] bg-[color:var(--ws-arc-soft)]` : 'border-[color:var(--ws-line)]'}`}>
            <div className="mb-1 flex items-center justify-between">
              <span className="ws-label">{m.role === 'user' ? 'You' : 'Kay'}</span>
              <span className="ws-num text-[10px] text-[color:var(--ws-faint)]">{clock(m.at)}</span>
            </div>
            {m.cockpitRunId && <RunCard runId={m.cockpitRunId} />}
            {m.tools && m.tools.length > 0 && (
              <ul className="mb-1.5 flex flex-wrap gap-1">
                {m.tools.map((t, i) => (
                  <li key={`${t.name}-${i}`} className={`ws-num rounded-sm px-1.5 py-0.5 text-[10px] ${t.ok ? 'bg-[color:var(--ws-arc-soft)] text-[color:var(--ws-arc)]' : 'bg-[color:var(--ws-red-soft)] text-[color:var(--ws-red)]'}`}>
                    ran {t.name}{t.ok ? '' : ' (failed)'}
                  </li>
                ))}
              </ul>
            )}
            {m.role === 'assistant' && !m.error && m.text ? (
              <div className="leading-relaxed text-[color:var(--ws-text)]"><ConKayMessage fields={{ content: m.text, ...(m.tools && m.tools.length > 0 ? { toolCalls: m.tools } : {}) }} renderProse={(t) => <MessageRenderer content={t} streaming={m.pending} />} /></div>
            ) : (
              <p className={`whitespace-pre-wrap leading-relaxed ${m.error ? 'text-[color:var(--ws-red)]' : 'text-[color:var(--ws-text)]'}`}>
                {m.text || (m.pending ? 'Thinking…' : '')}
              </p>
            )}
            {m.role === 'assistant' && <ChatArtifacts artifacts={m.artifacts} />}
            {m.role === 'assistant' && <LowConfidenceTag confidence={m.confidence} reason={m.confidenceReason} />}
            {m.pending && (
              <div className="mt-2 h-0.5 overflow-hidden rounded bg-[color:var(--ws-line)]" role="progressbar" aria-label="Working">
                <div className="h-full w-1/3 animate-conkay-indeterminate rounded bg-[color:var(--ws-arc)] motion-reduce:animate-none" />
              </div>
            )}
            {m.sweep && <SweepTable sweep={m.sweep} />}
            {m.chips && m.chips.length > 0 && !m.pending && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.chips.map((ch) => (
                  <button key={ch.label} type="button" onClick={() => void onChip(ch)} disabled={busy}
                    className="rounded-sm border border-[color:var(--ws-line-strong)] px-2 py-1 text-[11px] text-[color:var(--ws-text)] transition-colors hover:bg-[color:var(--ws-arc-soft)] disabled:opacity-50">
                    {ch.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default KayLog;
