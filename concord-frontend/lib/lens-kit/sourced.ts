/**
 * Sourced numbers — no number on screen without where it came from and how sure it is.
 *
 * ConKay's rule ("nothing faked: every number comes from a solver run") for every lens.
 * A displayed number is built with `sourced()`, which refuses unless it is given:
 *   - a finite value,
 *   - a SOURCE: what produced it — a solver run, a measurement, a citation, the
 *     ledger, the person, a computation from other sourced numbers, or a live feed;
 *   - an UNCERTAINTY: exact (and why: counted, ledger, defined), an interval, a
 *     standard deviation, a relative tolerance, or — said plainly — unknown, with why.
 * `<SourcedNumber>` renders only what `sourced()` built (a branded, frozen value);
 * anything else renders as a visible refusal, never as the number.
 *
 * Lens files that use the kit may not format numbers any other way
 * (tests/lens-kit-number-rule.test.ts): no `.toFixed`, `.toLocaleString` or
 * `Intl.NumberFormat` outside this module.
 */

export type Source =
  | { kind: 'solver'; id: string; version?: string; run?: string }
  | { kind: 'measured'; by: string; at?: string; instrument?: string }
  | { kind: 'cited'; ref: string; locator?: string }
  | { kind: 'ledger'; id: string }
  | { kind: 'user'; note?: string }
  | { kind: 'computed'; from: string }
  | { kind: 'feed'; name: string; at: string };

export type Uncertainty =
  | { kind: 'exact'; why: string }
  | { kind: 'interval'; low: number; high: number; level?: number }
  | { kind: 'sd'; sd: number; n?: number }
  | { kind: 'relative'; rel: number }
  | { kind: 'unknown'; reason: string };

export type NumberStyle = 'number' | 'money' | 'cc' | 'percent' | 'integer';

export interface SourcedInput {
  value: number;
  unit?: string;
  label?: string;
  source: Source;
  uncertainty: Uncertainty;
  style?: NumberStyle;
  /** ISO 4217 code for style "money" (default USD). */
  currency?: string;
  /** Significant digits for style "number" (default 4). */
  digits?: number;
}

const BRAND: unique symbol = Symbol.for('concord.lens-kit.sourced');
export interface SourcedNumber extends Readonly<Required<Pick<SourcedInput, 'value' | 'source' | 'uncertainty'>>> {
  readonly unit: string;
  readonly label: string | null;
  readonly style: NumberStyle;
  readonly currency: string;
  readonly digits: number;
  readonly [BRAND]: true;
}

export type SourcedResult = { ok: true; n: SourcedNumber } | { ok: false; reason: string };

const nonEmpty = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function checkSource(s: Source | undefined): string | null {
  if (!s || typeof s !== 'object') return 'no source: say where the number came from';
  switch (s.kind) {
    case 'solver': return nonEmpty(s.id) ? null : 'solver source needs the solver id';
    case 'measured': return nonEmpty(s.by) ? null : 'measured source needs who or what measured it';
    case 'cited': return nonEmpty(s.ref) ? null : 'cited source needs the reference';
    case 'ledger': return nonEmpty(s.id) ? null : 'ledger source needs the ledger entry id';
    case 'user': return null;
    case 'computed': return nonEmpty(s.from) ? null : 'computed source needs what it was computed from';
    case 'feed': return nonEmpty(s.name) && nonEmpty(s.at) ? null : 'feed source needs the feed name and when it was read';
    default: return `unknown source kind "${(s as { kind?: string }).kind}"`;
  }
}

function checkUncertainty(u: Uncertainty | undefined, value: number): string | null {
  if (!u || typeof u !== 'object') return 'no uncertainty: say how sure the number is (exact and why, a range, or unknown and why)';
  switch (u.kind) {
    case 'exact': return nonEmpty(u.why) ? null : 'exact needs why (counted, ledger, defined…)';
    case 'interval':
      if (!finite(u.low) || !finite(u.high) || u.low > u.high) return 'interval needs a finite low ≤ high';
      if (value < u.low || value > u.high) return 'the value lies outside its own interval';
      if (u.level !== undefined && !(u.level > 0 && u.level < 1)) return 'interval level is a fraction between 0 and 1';
      return null;
    case 'sd': return finite(u.sd) && u.sd >= 0 ? null : 'standard deviation must be finite and not negative';
    case 'relative': return finite(u.rel) && u.rel >= 0 ? null : 'relative tolerance must be finite and not negative';
    case 'unknown': return nonEmpty(u.reason) ? null : 'unknown uncertainty needs the reason it is unknown';
    default: return `unknown uncertainty kind "${(u as { kind?: string }).kind}"`;
  }
}

/** Build a displayable number, or the reason it may not be displayed. */
export function sourced(input: SourcedInput): SourcedResult {
  if (!input || typeof input !== 'object') return { ok: false, reason: 'not a number description' };
  if (!finite(input.value)) return { ok: false, reason: `not a finite number (${String(input.value)})` };
  const se = checkSource(input.source); if (se) return { ok: false, reason: se };
  const ue = checkUncertainty(input.uncertainty, input.value); if (ue) return { ok: false, reason: ue };
  const style = input.style ?? 'number';
  if (!['number', 'money', 'cc', 'percent', 'integer'].includes(style)) return { ok: false, reason: `unknown style "${style}"` };
  if (style === 'integer' && !Number.isInteger(input.value)) return { ok: false, reason: 'an integer style needs a whole number' };
  const n = {
    value: input.value, unit: input.unit ?? '', label: input.label ?? null,
    source: Object.freeze({ ...input.source }), uncertainty: Object.freeze({ ...input.uncertainty }),
    style, currency: (input.currency ?? 'USD').toUpperCase(), digits: input.digits ?? 4,
  };
  Object.defineProperty(n, BRAND, { value: true, enumerable: false });
  return { ok: true, n: Object.freeze(n) as SourcedNumber };
}

/** Throws with the reason instead of returning it — for numbers that must exist (tests, adapters). */
export function mustSource(input: SourcedInput): SourcedNumber {
  const r = sourced(input);
  if (!r.ok) throw new Error(`refused to show a number: ${r.reason}`);
  return r.n;
}

export function isSourced(x: unknown): x is SourcedNumber {
  return !!x && typeof x === 'object' && (x as Record<symbol, unknown>)[BRAND] === true;
}

// ── formatting (the only place in a kit lens that formats a number) ──

function sig(x: number, digits: number): string {
  if (x === 0) return '0';
  const r = Number(x.toPrecision(digits));
  return Math.abs(r) >= 1e15 || (Math.abs(r) < 1e-4) ? r.toExponential(Math.max(0, digits - 1)) : String(r);
}

export function formatValue(n: SourcedNumber): string {
  switch (n.style) {
    case 'money': return new Intl.NumberFormat('en-US', { style: 'currency', currency: n.currency }).format(n.value);
    case 'cc': return `${Number.isInteger(n.value) ? n.value : Number(n.value.toFixed(2))} CC`;
    case 'percent': return `${sig(n.value * 100, n.digits)} %`;
    case 'integer': return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n.value);
    default: return `${sig(n.value, n.digits)}${n.unit ? ` ${n.unit}` : ''}`;
  }
}

/** The uncertainty in words a person reads beside the number. */
export function formatUncertainty(n: SourcedNumber): string {
  const u = n.uncertainty;
  const v = (x: number) => (n.style === 'percent' ? `${sig(x * 100, n.digits)} %` : sig(x, n.digits));
  switch (u.kind) {
    case 'exact': return `exact (${u.why})`;
    case 'interval': return `${v(u.low)}–${v(u.high)}${n.style !== 'percent' && n.unit ? ` ${n.unit}` : ''}${u.level ? `, ${Math.round(u.level * 100)} % range` : ''}`;
    case 'sd': return `± ${v(u.sd)}${n.style !== 'percent' && n.unit ? ` ${n.unit}` : ''} (1 s.d.${u.n ? `, n = ${u.n}` : ''})`;
    case 'relative': return `± ${sig(u.rel * 100, 3)} %`;
    case 'unknown': return `uncertainty unknown: ${u.reason}`;
  }
}

/** Where the number came from, in words. */
export function formatSource(n: SourcedNumber): string {
  const s = n.source;
  switch (s.kind) {
    case 'solver': return `solver ${s.id}${s.version ? ` v${s.version}` : ''}${s.run ? ` (run ${s.run})` : ''}`;
    case 'measured': return `measured by ${s.by}${s.instrument ? ` with ${s.instrument}` : ''}${s.at ? `, ${s.at}` : ''}`;
    case 'cited': return `${s.ref}${s.locator ? `, ${s.locator}` : ''}`;
    case 'ledger': return `ledger entry ${s.id}`;
    case 'user': return s.note ? `you entered it (${s.note})` : 'you entered it';
    case 'computed': return `computed from ${s.from}`;
    case 'feed': return `${s.name}, read ${s.at}`;
  }
}

// ── adapters for the shapes the server already returns ──

/** A ConKay / solver margin `{ check, demand, capacity, unit, basis }` → demand, capacity and utilization. */
export function fromMargin(m: { check?: string; demand: number; capacity: number; unit?: string; basis?: string }, solver: { id: string; version?: string }): { demand: SourcedResult; capacity: SourcedResult; utilization: SourcedResult } {
  const src: Source = { kind: 'solver', id: solver.id, version: solver.version };
  const demand = sourced({ value: m.demand, unit: m.unit, label: 'demand', source: src, uncertainty: { kind: 'unknown', reason: 'a single solver run; run the uncertainty check for its spread' } });
  const capacity = sourced({ value: m.capacity, unit: m.unit, label: 'capacity', source: m.basis ? { kind: 'cited', ref: m.basis } : src, uncertainty: { kind: 'unknown', reason: 'material scatter not sampled in this run' } });
  const utilization = m.capacity > 0
    ? sourced({ value: m.demand / m.capacity, label: 'utilization', style: 'percent', digits: 3, source: { kind: 'computed', from: `demand / capacity of "${m.check || 'the check'}"` }, uncertainty: { kind: 'unknown', reason: 'a single solver run' } })
    : { ok: false as const, reason: 'capacity is not positive' };
  return { demand, capacity, utilization };
}

/** A probability from the uncertainty Monte Carlo `{ p, low, high, zeroFailures? }`. */
export function fromProbability(pr: { p: number; low: number; high: number }, samples: number, solverId = 'build.uncertainty'): SourcedResult {
  return sourced({ value: pr.p, style: 'percent', digits: 3, label: 'probability not met', source: { kind: 'solver', id: solverId, run: `${samples} samples` }, uncertainty: { kind: 'interval', low: pr.low, high: pr.high, level: 0.95 } });
}

/** An amount on the ledger: exact, by the entry that holds it. */
export function ledgerAmount(amount: number, ledgerId: string, style: 'cc' | 'money' = 'cc', currency?: string): SourcedResult {
  return sourced({ value: amount, style, currency, source: { kind: 'ledger', id: ledgerId }, uncertainty: { kind: 'exact', why: 'ledger' } });
}

/** A count of real records (items, sales, people): exact, counted from what the server returned. */
export function counted(count: number, what: string): SourcedResult {
  return sourced({ value: count, style: 'integer', label: what, source: { kind: 'computed', from: `the ${what} the server returned` }, uncertainty: { kind: 'exact', why: 'counted' } });
}
