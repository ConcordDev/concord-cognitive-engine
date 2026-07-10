'use client';

/**
 * EvidenceBoard — the collected-evidence corkboard for one crime case.
 *
 * Renders `detective.get`'s `evidence[]` (server/lib/detective.js
 * `listEvidenceForCrime`, columns: id, evidence_type, description,
 * links_to_id, links_to_type, confidence_boost, collected_at, decay_at).
 * Pure presentational + a client-side ticking clock for the decay
 * countdown (recomputed from the REAL `decay_at` epoch each tick — never
 * a fabricated progress bar).
 *
 * Micro-interaction: evidence whose `links_to_id` names a suspect/NPC
 * renders a "Name as suspect" chip — clicking it calls `onNameSuspect`
 * so the deduction form one tab over fills in real data the player
 * already found, instead of asking them to retype an opaque id.
 */

import React, { useEffect, useState } from 'react';
import {
  Fingerprint, Lock, Droplet, Sparkles, Package, MessageSquare, HelpCircle,
  UserCheck, Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui';

export interface DetectiveEvidence {
  id: string;
  evidence_type: string;
  description: string;
  links_to_id: string | null;
  links_to_type?: string | null;
  confidence_boost?: number | null;
  collected_at?: number | null;
  decay_at?: number | null;
}

const EVIDENCE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  footprint: Fingerprint,
  broken_lock: Lock,
  blood: Droplet,
  magical_residue: Sparkles,
  stolen_item_trace: Package,
  item_left_behind: Package,
  witness_account: MessageSquare,
};

function evidenceIcon(kind: string): React.ComponentType<{ className?: string }> {
  return EVIDENCE_ICON[kind] || HelpCircle;
}

function formatEvidenceType(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Real countdown to a real `decay_at` epoch-seconds field — recomputed against `nowMs`, not a fake timer. */
function decayLabel(decayAt: number | null | undefined, nowMs: number): { text: string; urgent: boolean } | null {
  if (!decayAt) return null;
  const remainingMs = decayAt * 1000 - nowMs;
  if (remainingMs <= 0) return { text: 'Faded', urgent: true };
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  const text = mins > 0 ? `Fades in ${mins}m` : `Fades in ${secs}s`;
  return { text, urgent: remainingMs < 60_000 };
}

export interface EvidenceBoardProps {
  evidence: DetectiveEvidence[];
  onNameSuspect: (suspectId: string) => void;
  activeSuspectId?: string;
}

export function EvidenceBoard({ evidence, onNameSuspect, activeSuspectId }: EvidenceBoardProps) {
  // Ticks once a second only while at least one item has a live decay
  // window — a real clock read, not a synthetic progress animation.
  const hasDecay = evidence.some((e) => e.decay_at);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasDecay) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasDecay]);

  if (evidence.length === 0) {
    return (
      <EmptyState
        icon={<Fingerprint className="h-8 w-8" />}
        title="No evidence collected yet."
        description="Nothing has been logged at the scene for this case. Check back once witnesses or NPC investigators surface something."
        compact
      />
    );
  }

  return (
    <ul data-testid="evidence-list" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {evidence.map((e) => {
        const Icon = evidenceIcon(e.evidence_type);
        const decay = decayLabel(e.decay_at, nowMs);
        const isNamed = !!e.links_to_id && e.links_to_id === activeSuspectId;
        return (
          <li
            key={e.id}
            className={cn(
              'rounded-lg border bg-amber-500/5 p-2.5 transition-colors',
              isNamed ? 'border-amber-400/70 bg-amber-500/10' : 'border-amber-500/15',
              decay?.urgent && 'border-rose-500/40',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {formatEvidenceType(e.evidence_type)}
              </div>
              {typeof e.confidence_boost === 'number' && e.confidence_boost > 0 && (
                <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] tabular-nums text-amber-300/80">
                  +{Math.round(e.confidence_boost * 100)}%
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] leading-snug text-slate-200">{e.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {e.links_to_id && (
                <button
                  type="button"
                  onClick={() => onNameSuspect(e.links_to_id as string)}
                  aria-pressed={isNamed}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors',
                    isNamed
                      ? 'bg-amber-400/30 text-amber-100'
                      : 'bg-slate-800/70 text-slate-300 hover:bg-amber-500/20 hover:text-amber-100',
                  )}
                >
                  <UserCheck className="h-3 w-3" aria-hidden="true" />
                  {isNamed ? 'Suspect named' : `Name ${e.links_to_id}`}
                </button>
              )}
              {decay && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-[10px] tabular-nums',
                    decay.urgent ? 'text-rose-300' : 'text-slate-500',
                  )}
                >
                  <Timer className="h-3 w-3" aria-hidden="true" />
                  {decay.text}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default EvidenceBoard;
