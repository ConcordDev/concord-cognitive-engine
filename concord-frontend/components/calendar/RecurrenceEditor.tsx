'use client';

/**
 * RecurrenceEditor — Google Calendar's repeat picker: daily / weekly on
 * chosen weekdays / monthly on a date or on the nth (or last) weekday /
 * yearly, every N, ending never, on a date, or after N times. The value maps
 * 1:1 onto calendar.events-create/-update's recurrence object.
 */

import { Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface UiRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  endDate?: Date;
  count?: number;
  byDay?: string[];
  monthlyMode?: 'dayOfMonth' | 'nthWeekday';
  lastWeek?: boolean;
}

const DAYS = [['SU', 'S'], ['MO', 'M'], ['TU', 'T'], ['WE', 'W'], ['TH', 'T'], ['FR', 'F'], ['SA', 'S']] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORD = ['first', 'second', 'third', 'fourth', 'fifth'];
const input = 'bg-lattice-deep rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan';

export function describeRecurrence(r: UiRecurrence, start?: Date): string {
  const every = r.interval > 1 ? `Every ${r.interval} ${{ daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }[r.frequency]}` : { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Annually' }[r.frequency];
  let on = '';
  if (r.frequency === 'weekly' && r.byDay?.length) on = ` on ${r.byDay.map((d) => DAY_NAMES[DAYS.findIndex(([k]) => k === d)]).join(', ')}`;
  if (r.frequency === 'monthly' && start) {
    on = r.monthlyMode === 'nthWeekday'
      ? ` on the ${r.lastWeek ? 'last' : ORD[Math.ceil(start.getDate() / 7) - 1]} ${DAY_NAMES[start.getDay()]}`
      : ` on day ${start.getDate()}`;
  }
  const ends = r.count ? `, ${r.count} times` : r.endDate ? `, until ${r.endDate.toLocaleDateString()}` : '';
  return `${every}${on}${ends}`;
}

export function RecurrenceEditor({ value, start, onChange }: {
  value: UiRecurrence | undefined;
  start: Date;
  onChange: (next: UiRecurrence | undefined) => void;
}) {
  const nth = Math.ceil(start.getDate() / 7);
  const isLastWeek = start.getDate() + 7 > new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const ends: 'never' | 'on' | 'after' = value?.count ? 'after' : value?.endDate ? 'on' : 'never';
  const set = (patch: Partial<UiRecurrence>) => value && onChange({ ...value, ...patch });

  return (
    <div>
      <label className="text-xs text-gray-400 mb-2 block flex items-center gap-1.5">
        <Repeat className="w-3.5 h-3.5" /> Repeat
      </label>
      <div className="flex items-center gap-2 flex-wrap">
        <select aria-label="Repeat" value={value?.frequency || 'none'} className={input}
          onChange={(e) => {
            const f = e.target.value;
            if (f === 'none') { onChange(undefined); return; }
            const freq = f as UiRecurrence['frequency'];
            onChange({
              frequency: freq,
              interval: value?.interval || 1,
              endDate: value?.endDate,
              count: value?.count,
              byDay: freq === 'weekly' ? (value?.byDay?.length ? value.byDay : [DAYS[start.getDay()][0]]) : undefined,
              monthlyMode: freq === 'monthly' ? (value?.monthlyMode || 'dayOfMonth') : undefined,
            });
          }}>
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        {value && (
          <>
            <span className="text-xs text-gray-400">every</span>
            <input aria-label="Repeat interval" type="number" min={1} max={99} value={value.interval}
              onChange={(e) => set({ interval: Math.max(1, parseInt(e.target.value, 10) || 1) })} className={cn(input, 'w-16 text-center px-2')} />
            <span className="text-xs text-gray-400">{{ daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[value.frequency]}</span>
          </>
        )}
      </div>

      {value?.frequency === 'weekly' && (
        <div className="mt-2 flex gap-1.5" role="group" aria-label="Repeat on">
          {DAYS.map(([key, letter], i) => {
            const on = value.byDay?.includes(key);
            return (
              <button key={key} type="button" aria-pressed={!!on} aria-label={DAY_NAMES[i]} title={DAY_NAMES[i]}
                onClick={() => {
                  const next = on ? (value.byDay || []).filter((d) => d !== key) : [...(value.byDay || []), key];
                  set({ byDay: next.length ? next : [key] });
                }}
                className={cn('h-8 w-8 rounded-full text-xs font-medium transition-colors', on ? 'bg-neon-cyan text-black' : 'bg-lattice-deep text-gray-400 hover:text-white')}>
                {letter}
              </button>
            );
          })}
        </div>
      )}

      {value?.frequency === 'monthly' && (
        <select aria-label="Monthly on" className={cn(input, 'mt-2 w-full')}
          value={value.monthlyMode === 'nthWeekday' ? (value.lastWeek ? 'last' : 'nth') : 'day'}
          onChange={(e) => set(e.target.value === 'day' ? { monthlyMode: 'dayOfMonth', lastWeek: false } : { monthlyMode: 'nthWeekday', lastWeek: e.target.value === 'last' })}>
          <option value="day">Monthly on day {start.getDate()}{start.getDate() > 28 ? ' (skips shorter months)' : ''}</option>
          {nth <= 4 && <option value="nth">Monthly on the {ORD[nth - 1]} {DAY_NAMES[start.getDay()]}</option>}
          {isLastWeek && <option value="last">Monthly on the last {DAY_NAMES[start.getDay()]}</option>}
        </select>
      )}

      {value && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-400">Ends</label>
          <select aria-label="Repeat ends" value={ends} className={input}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'never') set({ endDate: undefined, count: undefined });
              if (v === 'on') { const d = new Date(start); d.setMonth(d.getMonth() + 3); set({ endDate: d, count: undefined }); }
              if (v === 'after') set({ count: 10, endDate: undefined });
            }}>
            <option value="never">Never</option>
            <option value="on">On date</option>
            <option value="after">After</option>
          </select>
          {ends === 'on' && (
            <input aria-label="Repeat end date" type="date" className={input}
              value={value.endDate ? value.endDate.toISOString().slice(0, 10) : ''}
              onChange={(e) => set({ endDate: e.target.value ? new Date(e.target.value) : undefined })} />
          )}
          {ends === 'after' && (
            <>
              <input aria-label="Occurrences" type="number" min={1} max={999} value={value.count || 1}
                onChange={(e) => set({ count: Math.max(1, parseInt(e.target.value, 10) || 1) })} className={cn(input, 'w-20 text-center px-2')} />
              <span className="text-xs text-gray-400">times</span>
            </>
          )}
        </div>
      )}
      {value && <p className="mt-2 text-[11px] text-gray-500">{describeRecurrence(value, start)}</p>}
    </div>
  );
}

export type RecurrenceScope = 'this' | 'following' | 'all';

/** Google Calendar's "Edit / Delete recurring event" chooser. */
export function RecurrenceScopeDialog({ action, onChoose, onCancel }: {
  action: 'save' | 'delete';
  onChoose: (scope: RecurrenceScope) => void;
  onCancel: () => void;
}) {
  const options: Array<[RecurrenceScope, string]> = [['this', 'This event'], ['following', 'This and following events'], ['all', 'All events']];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="presentation"
      onClick={onCancel} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-label={action === 'save' ? 'Edit recurring event' : 'Delete recurring event'}
        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        className="w-full max-w-xs rounded-2xl border border-white/10 bg-lattice-surface p-5 shadow-2xl">
        <h3 className="mb-3 text-sm font-semibold text-white">{action === 'save' ? 'Edit recurring event' : 'Delete recurring event'}</h3>
        <div className="space-y-1">
          {options.map(([scope, label]) => (
            <button key={scope} type="button" onClick={() => onChoose(scope)}
              className={cn('w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/5', action === 'delete' && scope === 'all' ? 'text-rose-300' : 'text-gray-200')}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onCancel} className="mt-3 w-full rounded-lg px-3 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
      </div>
    </div>
  );
}
