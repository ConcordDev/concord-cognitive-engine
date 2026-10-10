/**
 * MassPanel — the design's mass by state (one stacked bar, kg per state), the
 * uncertainty band, the limit it is judged against, and what the total does
 * not include. Every number is the snapshot's own.
 */

import { VALUE_STATUSES, formatValue, type DesignMass, type ValueStatus } from '@/lib/conkay/designs-api';
import { PANEL, VALUE_STYLE } from './design-styles';

export function MassPanel({ mass, meaning }: { mass: DesignMass; meaning: Record<ValueStatus, string> }) {
  const states = VALUE_STATUSES.filter((s) => mass.byState[s] > 0);
  const sum = states.reduce((a, s) => a + mass.byState[s], 0) || 1;
  return (
    <section className={PANEL} aria-label="Mass breakdown">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Mass by state</h2>
        <p className="tabular-nums text-sm text-slate-100">
          {formatValue(mass.totalKg, 5)} kg
          {mass.bandKg && <span className="ml-2 text-xs text-slate-400">band {formatValue(mass.bandKg[0], 5)}–{formatValue(mass.bandKg[1], 5)} kg</span>}
        </p>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-white/5" role="img" aria-label={states.map((s) => `${s} ${formatValue(mass.byState[s])} kg`).join(', ')}>
        {states.map((s) => <div key={s} className={VALUE_STYLE[s].bar} style={{ width: `${(mass.byState[s] / sum) * 100}%` }} title={`${s}: ${formatValue(mass.byState[s])} kg`} />)}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        {states.map((s) => (
          <div key={s} className="flex items-center justify-between gap-2" title={meaning[s]}>
            <dt className="flex items-center gap-1.5 text-slate-400"><span className={`h-2 w-2 rounded-full ${VALUE_STYLE[s].bar}`} />{s}</dt>
            <dd className="tabular-nums text-slate-200">{formatValue(mass.byState[s])} kg <span className="text-slate-500">({Math.round((mass.byState[s] / sum) * 100)}%)</span></dd>
          </div>
        ))}
      </dl>
      {mass.unknownCount > 0 && <p className="mt-2 text-xs text-rose-300">{mass.unknownCount} item(s) with no mass at all are not in the total.</p>}
      {mass.limit && (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
          Against {mass.limit.label}: {formatValue(mass.limit.kg, 5)} kg, margin{' '}
          <span className={mass.limit.marginKg < 0 ? 'text-rose-300' : 'text-emerald-200'}>{formatValue(mass.limit.marginKg, 4)} kg</span>
        </p>
      )}
      {mass.note && <p className="mt-2 text-[11px] text-slate-500">{mass.note}</p>}
      {mass.notIncluded.length > 0 && (
        <details className="mt-2 text-[11px] text-slate-400">
          <summary className="cursor-pointer select-none text-slate-300">Not included in the total ({mass.notIncluded.length})</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">{mass.notIncluded.map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
    </section>
  );
}
