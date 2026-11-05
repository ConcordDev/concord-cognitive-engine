'use client';

/**
 * LimitationNotice — the shared limitation-copy component.
 *
 * One honest-labelling layer, applied at render: a surface shaped like
 * an operational system states, at the operational claim itself, what
 * it is NOT and where the real thing lives. The copy is worded once,
 * here, per register — never re-invented per lens. Defense's interior
 * panels are the family's working model of the form ("Platform events
 * only; this is not authenticated military telemetry."): short,
 * factual, placed where the user decides what the surface is.
 *
 * Registers (the fleet's limitation-copy family):
 *   emergency    — Emergency Services (S1, the family's first exhibit):
 *                  a dispatch-shaped board with no not-an-emergency
 *                  text anywhere was the product's most consequential
 *                  absence in the F-G sweep. Shipped in this component
 *                  and mounted at the lens's door and on its Call board.
 *   enforcement  — Law Enforcement's exhibit (its F5); lands with that
 *                  lens's build, in this same record.
 *   intelligence — the intelligence surfaces' exhibit; same rule.
 *
 * A register with no copy in the record renders nothing — the
 * component never invents wording for a register whose exhibit has
 * not been built. Register wording is security copy and rides founder
 * approval, per the compilation of record.
 */

import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type LimitationRegister = 'emergency' | 'enforcement' | 'intelligence';

const LIMITATION_COPY: Partial<Record<LimitationRegister, { title: string; body: string }>> = {
  emergency: {
    title: 'Not an emergency service.',
    body: 'This board is a planning and training tool inside Concord — nothing here contacts or dispatches real emergency services. If this is an emergency, call 911 now, or your local emergency number.',
  },
};

export function LimitationNotice({
  register,
  className,
}: {
  register: LimitationRegister;
  className?: string;
}) {
  const copy = LIMITATION_COPY[register];
  if (!copy) return null;
  return (
    <div
      role="note"
      data-limitation-register={register}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.07] px-3.5 py-3',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
      <p className="text-sm leading-6 text-rose-100">
        <strong className="font-semibold">{copy.title}</strong>{' '}
        <span className="text-rose-200/90">{copy.body}</span>
      </p>
    </div>
  );
}
