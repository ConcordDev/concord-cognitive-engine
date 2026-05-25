'use client';

/**
 * CountryPicker — choose one or many countries by ISO3 code. Single-select
 * mode backs the time-series and country-profile tools; multi-select backs
 * the comparison tool. The country list mirrors the centroid set the
 * `global.choropleth` macro can map.
 */

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const COUNTRIES: { code: string; name: string }[] = [
  { code: 'USA', name: 'United States' }, { code: 'CHN', name: 'China' },
  { code: 'IND', name: 'India' }, { code: 'BRA', name: 'Brazil' },
  { code: 'RUS', name: 'Russia' }, { code: 'JPN', name: 'Japan' },
  { code: 'DEU', name: 'Germany' }, { code: 'GBR', name: 'United Kingdom' },
  { code: 'FRA', name: 'France' }, { code: 'CAN', name: 'Canada' },
  { code: 'AUS', name: 'Australia' }, { code: 'ITA', name: 'Italy' },
  { code: 'ESP', name: 'Spain' }, { code: 'MEX', name: 'Mexico' },
  { code: 'KOR', name: 'South Korea' }, { code: 'IDN', name: 'Indonesia' },
  { code: 'NGA', name: 'Nigeria' }, { code: 'ZAF', name: 'South Africa' },
  { code: 'EGY', name: 'Egypt' }, { code: 'TUR', name: 'Turkey' },
  { code: 'ARG', name: 'Argentina' }, { code: 'SAU', name: 'Saudi Arabia' },
  { code: 'POL', name: 'Poland' }, { code: 'SWE', name: 'Sweden' },
  { code: 'NOR', name: 'Norway' }, { code: 'CHE', name: 'Switzerland' },
  { code: 'NLD', name: 'Netherlands' }, { code: 'KEN', name: 'Kenya' },
  { code: 'ETH', name: 'Ethiopia' }, { code: 'PAK', name: 'Pakistan' },
  { code: 'BGD', name: 'Bangladesh' }, { code: 'VNM', name: 'Vietnam' },
  { code: 'THA', name: 'Thailand' }, { code: 'PHL', name: 'Philippines' },
  { code: 'COL', name: 'Colombia' }, { code: 'CHL', name: 'Chile' },
  { code: 'PER', name: 'Peru' }, { code: 'NZL', name: 'New Zealand' },
  { code: 'ISR', name: 'Israel' }, { code: 'ARE', name: 'United Arab Emirates' },
  { code: 'SGP', name: 'Singapore' }, { code: 'MYS', name: 'Malaysia' },
  { code: 'IRN', name: 'Iran' }, { code: 'UKR', name: 'Ukraine' },
];

interface SingleProps {
  label: string;
  value: string;
  onChange: (code: string) => void;
  multi?: false;
}
interface MultiProps {
  label: string;
  value: string[];
  multi: true;
  max?: number;
  onChangeMulti: (codes: string[]) => void;
}
type Props = SingleProps | MultiProps;

export function CountryPicker(props: Props) {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(
    () => COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(filter.toLowerCase()) || c.code.toLowerCase().includes(filter.toLowerCase()),
    ),
    [filter],
  );

  if (props.multi) {
    const selected = props.value;
    const max = props.max ?? 6;
    const toggle = (code: string) => {
      if (selected.includes(code)) {
        props.onChangeMulti(selected.filter((c) => c !== code));
      } else if (selected.length < max) {
        props.onChangeMulti([...selected, code]);
      }
    };
    return (
      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wider text-zinc-400">
          {props.label} · {selected.length}/{max}
        </span>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {selected.map((code) => (
              <span key={code} className="flex items-center gap-1 rounded bg-neon-cyan/15 px-1.5 py-0.5 text-[11px] text-neon-cyan">
                {COUNTRIES.find((c) => c.code === code)?.name || code}
                <button type="button" onClick={() => toggle(code)} aria-label={`Remove ${code}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter countries…"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
        />
        <div className="grid max-h-44 grid-cols-2 gap-0.5 overflow-y-auto sm:grid-cols-3">
          {filtered.map((c) => {
            const on = selected.includes(c.code);
            const disabled = !on && selected.length >= max;
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => toggle(c.code)}
                disabled={disabled}
                className={cn(
                  'truncate rounded px-1.5 py-1 text-left text-[11px] transition-colors',
                  on ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-zinc-400 hover:bg-zinc-800',
                  disabled && 'opacity-30',
                )}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-400">{props.label}</span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>{c.name}</option>
        ))}
      </select>
    </label>
  );
}

export default CountryPicker;
