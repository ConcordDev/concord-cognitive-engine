'use client';

/**
 * StructuredArrayEditor — schema-driven rows-of-fields editor for arrays of
 * objects. Replaces the JSON textarea pattern in lens action panels.
 *
 * Usage:
 *   <StructuredArrayEditor
 *     value={messages}
 *     onChange={setMessages}
 *     template={{ author: '', content: '' }}
 *     columns={[
 *       { key: 'author',  label: 'Author',  type: 'text',     width: '7rem' },
 *       { key: 'content', label: 'Content', type: 'textarea', flex: 1 },
 *     ]}
 *   />
 *
 * A `mode` toggle ("rows" | "json") is provided so power users can still drop
 * to raw JSON for bulk paste. JSON-mode parse errors are surfaced inline and
 * gate the onChange so you can never corrupt the upstream state with a typo.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, X, Code2, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FieldType = 'text' | 'textarea' | 'number' | 'select';

export interface ColumnSpec<T> {
  key: keyof T & string;
  label: string;
  type: FieldType;
  /** Width for text/number/select. Use flex for textareas. */
  width?: string;
  flex?: number;
  /** Options for type: 'select'. */
  options?: { value: string; label?: string }[];
  /** Default value used when adding a row (falls back to template[key]). */
  defaultValue?: string | number;
  placeholder?: string;
  step?: number;
  min?: number;
  max?: number;
}

interface Props<T extends object> {
  value: T[];
  onChange: (next: T[]) => void;
  template: T;
  columns: ColumnSpec<T>[];
  /** Accent color (Tailwind color name root, e.g. "blue", "amber"). */
  accent?: string;
  /** Optional label shown above the editor. */
  label?: string;
  /** Max rows. Defaults to 50 to keep the surface scannable. */
  maxRows?: number;
  /** Initial mode. */
  initialMode?: 'rows' | 'json';
  /** Disabled / read-only. */
  disabled?: boolean;
  /** When true, the editor will not render the JSON-mode toggle. */
  rowsOnly?: boolean;
  /** Optional: validate a row, return error string to mark invalid. */
  validate?: (row: T, index: number) => string | null;
}

export function StructuredArrayEditor<T extends object>({
  value, onChange, template, columns, accent = 'blue', label, maxRows = 50,
  initialMode = 'rows', disabled, rowsOnly, validate,
}: Props<T>) {
  const [mode, setMode] = useState<'rows' | 'json'>(initialMode);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Re-seed JSON text when the upstream value changes from outside (e.g. PipeImporter).
  useEffect(() => {
    if (mode === 'json') return; // don't fight an in-progress edit
    setJsonText(JSON.stringify(value, null, 2));
  }, [value, mode]);

  const accentBorder = `border-${accent}-500/30`;
  const accentBg = `bg-${accent}-500/5`;
  const accentText = `text-${accent}-300`;

  function addRow() {
    if (value.length >= maxRows) return;
    const seed = { ...(template as object) } as Record<string, unknown>;
    for (const c of columns) {
      if (c.defaultValue !== undefined) seed[c.key] = c.defaultValue;
    }
    onChange([...value, seed as T]);
  }
  function removeRow(i: number) {
    const next = value.slice();
    next.splice(i, 1);
    onChange(next);
  }
  function updateCell(i: number, key: string, raw: string) {
    const col = columns.find((c) => c.key === key);
    const next = value.slice();
    const row = { ...next[i] } as Record<string, unknown>;
    if (col?.type === 'number') {
      row[key] = raw === '' ? '' : Number(raw);
    } else {
      row[key] = raw;
    }
    next[i] = row as T;
    onChange(next);
  }
  function commitJson() {
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) { setJsonError('Expected an array.'); return; }
      setJsonError(null);
      onChange(parsed as T[]);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  const errors = useMemo(() => {
    if (!validate) return new Map<number, string>();
    const m = new Map<number, string>();
    value.forEach((row, i) => { const err = validate(row, i); if (err) m.set(i, err); });
    return m;
  }, [value, validate]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        {label && (
          <label className={cn('text-[10px] uppercase tracking-wider font-semibold', accentText)}>{label}</label>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[9px] text-zinc-400 font-mono">{value.length}/{maxRows}</span>
          {!rowsOnly && (
            <button
              type="button"
              onClick={() => { if (mode === 'json') commitJson(); setMode(mode === 'rows' ? 'json' : 'rows'); }}
              className="text-[10px] text-zinc-400 hover:text-zinc-200 px-1.5 py-0.5 rounded border border-zinc-800 flex items-center gap-1"
              title={mode === 'rows' ? 'Edit as JSON' : 'Edit as rows'}
              disabled={disabled}
            >
              {mode === 'rows' ? <Code2 className="w-3 h-3" /> : <Rows3 className="w-3 h-3" />}
              {mode === 'rows' ? 'JSON' : 'Rows'}
            </button>
          )}
        </div>
      </div>

      {mode === 'json' ? (
        <div>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            onBlur={commitJson}
            rows={6}
            disabled={disabled}
            className={cn(
              'w-full bg-zinc-900 border rounded px-3 py-1 text-[10px] text-white font-mono',
              jsonError ? 'border-red-500/60' : accentBorder,
            )}
          />
          {jsonError && <div className="text-[10px] text-red-300 mt-0.5">{jsonError}</div>}
        </div>
      ) : (
        <div className={cn('rounded border', accentBorder, accentBg, 'p-1.5 space-y-1')}>
          {value.length === 0 && (
            <div className="text-[10px] text-zinc-400 italic py-1 text-center">No rows. Click + to add.</div>
          )}
          {value.map((row, i) => {
            const rowError = errors.get(i);
            return (
              <div key={i} className={cn('flex items-stretch gap-1', rowError && 'ring-1 ring-red-500/40 rounded')}>
                <div className="flex-1 flex flex-wrap gap-1 items-start">
                  {columns.map((col) => {
                    const raw = (row as Record<string, unknown>)[col.key];
                    const style: React.CSSProperties = {};
                    if (col.width) style.width = col.width;
                    if (col.flex) { style.flex = col.flex; style.minWidth = '6rem'; }
                    if (col.type === 'textarea') {
                      return (
                        <textarea
                          key={col.key}
                          value={String(raw ?? '')}
                          onChange={(e) => updateCell(i, col.key, e.target.value)}
                          placeholder={col.placeholder ?? col.label}
                          disabled={disabled}
                          rows={1}
                          style={style}
                          className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] text-white font-mono resize-y min-h-[1.5rem]"
                        />
                      );
                    }
                    if (col.type === 'select' && col.options) {
                      return (
                        <select
                          key={col.key}
                          value={String(raw ?? '')}
                          onChange={(e) => updateCell(i, col.key, e.target.value)}
                          disabled={disabled}
                          style={style}
                          className="bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[10px] text-white font-mono"
                        >
                          {col.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
                          ))}
                        </select>
                      );
                    }
                    return (
                      <input
                        key={col.key}
                        type={col.type === 'number' ? 'number' : 'text'}
                        value={String(raw ?? '')}
                        onChange={(e) => updateCell(i, col.key, e.target.value)}
                        placeholder={col.placeholder ?? col.label}
                        disabled={disabled}
                        step={col.step}
                        min={col.min}
                        max={col.max}
                        style={style}
                        className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-[10px] text-white font-mono"
                      />
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={disabled}
                  className="text-zinc-400 hover:text-red-300 px-1 self-center"
                  title="Remove row"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          {rowError(errors, value.length) /* renders nothing — placeholder for type safety */}
          <button
            type="button"
            onClick={addRow}
            disabled={disabled || value.length >= maxRows}
            className={cn(
              'w-full flex items-center justify-center gap-1 text-[10px] py-1 rounded border border-dashed',
              'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500',
              'disabled:opacity-30 disabled:cursor-not-allowed',
            )}
          >
            <Plus className="w-3 h-3" /> Add row
          </button>
          {Array.from(errors.entries()).slice(0, 3).map(([i, msg]) => (
            <div key={i} className="text-[10px] text-red-300">row {i + 1}: {msg}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// no-op helper kept for forward extension; Tailwind JIT also needs these literal
// class fragments to survive the purge pass:
// border-blue-500/30 bg-blue-500/5 text-blue-300
// border-amber-500/30 bg-amber-500/5 text-amber-300
// border-green-500/30 bg-green-500/5 text-green-300
// border-purple-500/30 bg-purple-500/5 text-purple-300
// border-cyan-500/30 bg-cyan-500/5 text-cyan-300
// border-pink-500/30 bg-pink-500/5 text-pink-300
// border-emerald-500/30 bg-emerald-500/5 text-emerald-300
function rowError(_m: Map<number, string>, _len: number) { return null; }
