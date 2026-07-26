/**
 * Period-over-period date range math for the accounting dashboard's
 * KPIStrip. Pure functions, no I/O — the caller (`AccountingDashboard`)
 * feeds the resulting `{start,end}` into the real `pl-compute` macro for
 * both the current period and a genuinely comparable prior period, so
 * the strip's delta arrows are computed from two real server responses,
 * never fabricated.
 */
import {
  startOfMonth, endOfMonth, subMonths,
  startOfQuarter, endOfQuarter, subQuarters,
  startOfYear, endOfYear, subYears,
  format,
} from 'date-fns';
import type { Period } from './KPIStrip';

export interface PeriodRange {
  /** Current period, inclusive. */
  start: string;
  end: string;
  /** The prior comparable period, same length, immediately before. */
  priorStart: string;
  priorEnd: string;
  /** Human label for the current period. */
  label: string;
  /** Human label for the prior period (drives the KPI caption). */
  priorLabel: string;
}

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

export function computePeriodRange(period: Period, today: Date = new Date()): PeriodRange {
  switch (period) {
    case 'mtd': {
      const priorAnchor = subMonths(today, 1);
      return {
        start: iso(startOfMonth(today)), end: iso(today),
        priorStart: iso(startOfMonth(priorAnchor)), priorEnd: iso(priorAnchor),
        label: 'This month', priorLabel: 'vs last month',
      };
    }
    case 'qtd': {
      const priorAnchor = subQuarters(today, 1);
      return {
        start: iso(startOfQuarter(today)), end: iso(today),
        priorStart: iso(startOfQuarter(priorAnchor)), priorEnd: iso(priorAnchor),
        label: 'This quarter', priorLabel: 'vs last quarter',
      };
    }
    case 'ytd': {
      const priorAnchor = subYears(today, 1);
      return {
        start: iso(startOfYear(today)), end: iso(today),
        priorStart: iso(startOfYear(priorAnchor)), priorEnd: iso(priorAnchor),
        label: 'YTD', priorLabel: 'vs last year',
      };
    }
    case 'last_month': {
      const anchor = subMonths(today, 1);
      const priorAnchor = subMonths(today, 2);
      return {
        start: iso(startOfMonth(anchor)), end: iso(endOfMonth(anchor)),
        priorStart: iso(startOfMonth(priorAnchor)), priorEnd: iso(endOfMonth(priorAnchor)),
        label: 'Last month', priorLabel: 'vs month before',
      };
    }
    case 'last_quarter': {
      const anchor = subQuarters(today, 1);
      const priorAnchor = subQuarters(today, 2);
      return {
        start: iso(startOfQuarter(anchor)), end: iso(endOfQuarter(anchor)),
        priorStart: iso(startOfQuarter(priorAnchor)), priorEnd: iso(endOfQuarter(priorAnchor)),
        label: 'Last quarter', priorLabel: 'vs quarter before',
      };
    }
    case 'last_year': {
      const anchor = subYears(today, 1);
      const priorAnchor = subYears(today, 2);
      return {
        start: iso(startOfYear(anchor)), end: iso(endOfYear(anchor)),
        priorStart: iso(startOfYear(priorAnchor)), priorEnd: iso(endOfYear(priorAnchor)),
        label: 'Last year', priorLabel: 'vs year before',
      };
    }
    default:
      return computePeriodRange('mtd', today);
  }
}

/** Real delta between two actually-fetched totals — never fabricated. */
export function deltaPct(current: number, prior: number): number | undefined {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return undefined;
  if (prior === 0) return current === 0 ? 0 : undefined; // no honest baseline to compare against
  return ((current - prior) / Math.abs(prior)) * 100;
}
