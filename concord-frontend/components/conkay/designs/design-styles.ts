import type { CheckStatus, ValueStatus } from '@/lib/conkay/designs-api';

/** Status chips: one hue per status, same chrome as the rest of ConKay. */
export const CHECK_STYLE: Record<CheckStatus, string> = {
  PASS: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  WARN: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  FAIL: 'border-rose-400/35 bg-rose-400/10 text-rose-200',
  NOT_COMPUTED: 'border-slate-400/25 bg-slate-400/10 text-slate-300',
  ERROR: 'border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200',
};

export const CHECK_LABEL: Record<CheckStatus, string> = {
  PASS: 'Pass', WARN: 'Warn', FAIL: 'Fail', NOT_COMPUTED: 'Not computed', ERROR: 'Error',
};

export const VALUE_STYLE: Record<ValueStatus, { chip: string; bar: string }> = {
  sourced: { chip: 'border-sky-400/30 bg-sky-400/10 text-sky-200', bar: 'bg-sky-400/80' },
  measured: { chip: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100', bar: 'bg-cyan-300/80' },
  computed: { chip: 'border-violet-400/30 bg-violet-400/10 text-violet-200', bar: 'bg-violet-400/80' },
  estimated: { chip: 'border-amber-400/30 bg-amber-400/10 text-amber-200', bar: 'bg-amber-400/80' },
  design: { chip: 'border-slate-300/25 bg-slate-300/10 text-slate-200', bar: 'bg-slate-300/70' },
  unknown: { chip: 'border-rose-400/35 bg-rose-400/10 text-rose-200', bar: 'bg-rose-400/70' },
};

export const PANEL = 'rounded-2xl border border-white/10 bg-white/[0.02] p-4';
