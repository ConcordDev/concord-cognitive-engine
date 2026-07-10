'use client';

/**
 * PgImmunizationsPanel — wires `parenting.immunizationTracker` (a real CDC
 * "Recommended Child and Adolescent Immunization Schedule" checker) which
 * had zero UI callers anywhere in the app before this rebuild. The macro is
 * stateless (artifact.data: { childAge, vaccinations }) rather than
 * persisted per-child like the other Huckleberry-parity tabs — this panel
 * derives `childAge` from the real selected child's birth date so the
 * caller never has to re-type it, and lets them check off which of the 10
 * CDC vaccine categories the child has already received.
 */

import { useState } from 'react';
import { Loader2, Syringe, AlertTriangle, Check } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Child { id: string; name: string; ageMonths: number }

const CDC_VACCINES = [
  'Hepatitis B', 'DTaP', 'IPV (Polio)', 'Hib', 'PCV13 (Pneumococcal)',
  'RV (Rotavirus)', 'MMR', 'Varicella', 'Hepatitis A', 'Influenza',
] as const;

interface Immunization { vaccine: string; required: boolean; received: boolean; status: 'completed' | 'overdue' | 'upcoming'; note: string | null }
interface TrackerResult {
  childAge: string; ageMonths: number; immunizations: Immunization[];
  summary: { total: number; completed: number; overdue: number; complianceRate: number };
  action: string;
}

const STATUS_STYLE: Record<Immunization['status'], string> = {
  completed: 'border-emerald-900/50 bg-emerald-950/20 text-emerald-300',
  overdue: 'border-rose-900/50 bg-rose-950/20 text-rose-300',
  upcoming: 'border-zinc-800 bg-zinc-900/70 text-zinc-400',
};

function ageMonthsToChildAgeStr(ageMonths: number) {
  const years = Math.floor(ageMonths / 12);
  const months = Math.round(ageMonths % 12);
  return months > 0 ? `${years}y ${months}m` : `${years}y`;
}

export function PgImmunizationsPanel({ child }: { child: Child }) {
  const [received, setReceived] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<TrackerResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (vaccine: string) => {
    setReceived((prev) => {
      const next = new Set(prev);
      if (next.has(vaccine)) next.delete(vaccine); else next.add(vaccine);
      return next;
    });
  };

  const check = async () => {
    setLoading(true); setError(null);
    try {
      const r = await apiHelpers.lens.runDomain('parenting', 'immunizationTracker', {
        input: { childAge: ageMonthsToChildAgeStr(child.ageMonths), vaccinations: Array.from(received).join(', ') },
      });
      const envelope = (r as { data?: { ok: boolean; result?: TrackerResult; error?: string } }).data;
      if (!envelope?.ok || !envelope.result) { setError(envelope?.error || 'Immunization check failed.'); setResult(null); return; }
      setResult(envelope.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Immunization check failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[10px] text-zinc-400">
        CDC recommended childhood immunization schedule for {child.name}, age {ageMonthsToChildAgeStr(child.ageMonths)}. Check off vaccines already received, then run the check. Not medical advice — confirm with your pediatrician.
      </p>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <Syringe className="w-3.5 h-3.5 text-rose-400" /> Vaccines received
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {CDC_VACCINES.map((v) => {
            const checked = received.has(v);
            return (
              <button key={v} type="button" onClick={() => toggle(v)} aria-pressed={checked}
                className={cn('flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11px] focus:outline-none focus:ring-2 focus:ring-rose-500',
                  checked ? 'border-rose-700 bg-rose-950/40 text-rose-200' : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700')}>
                <span className={cn('w-3.5 h-3.5 rounded flex items-center justify-center shrink-0', checked ? 'bg-rose-600' : 'border border-zinc-600')}>
                  {checked && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
                {v}
              </button>
            );
          })}
        </div>
        <button type="button" onClick={check} disabled={loading}
          className="w-full flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg py-1.5">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Syringe className="w-3.5 h-3.5" />}
          Check schedule
        </button>
      </section>

      {result && (
        <section className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Completed" value={`${result.summary.completed}/${result.summary.total}`} />
            <Stat label="Compliance" value={`${result.summary.complianceRate}%`} />
            <Stat label="Overdue" value={result.summary.overdue} tone={result.summary.overdue > 0 ? 'warn' : undefined} />
          </div>
          <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px]',
            result.summary.overdue > 0 ? 'border-amber-900/50 bg-amber-950/20 text-amber-300' : 'border-emerald-900/40 bg-emerald-950/10 text-emerald-300')}>
            {result.summary.overdue > 0 ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
            <span>{result.action}</span>
          </div>
          <ul className="space-y-1">
            {result.immunizations.map((im) => (
              <li key={im.vaccine} className={cn('flex items-center justify-between rounded-lg border px-3 py-1.5 text-[11px]', STATUS_STYLE[im.status])}>
                <span>{im.vaccine}{im.note ? ` · ${im.note}` : ''}</span>
                <span className="capitalize font-mono text-[10px]">{im.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 text-center">
      <p className={cn('text-base font-bold', tone === 'warn' ? 'text-amber-300' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
