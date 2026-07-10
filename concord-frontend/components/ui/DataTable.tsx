'use client';

/**
 * DataTable — high-density, sortable, keyboard-navigable table primitive.
 *
 * A general-purpose building block for dense tabular/financial lens data
 * (ledgers, order books, position lists, transaction histories, etc.). Pure
 * presentational: it owns sort state only when uncontrolled, and never
 * fetches data — callers pass `rows` + `columns` and read back `onSortChange`
 * / `onRowClick` / `onRowActivate`.
 *
 * Usage:
 *   <DataTable
 *     columns={[
 *       { id: 'ticker', header: 'Ticker', accessor: r => r.ticker, sortable: true, monospace: true },
 *       { id: 'price', header: 'Price', accessor: r => `$${r.price.toFixed(2)}`, sortValue: r => r.price, align: 'right', sortable: true },
 *     ]}
 *     rows={positions}
 *     getRowId={(r) => r.id}
 *     stickyHeader
 *   />
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

export type SortDirection = 'asc' | 'desc';

export interface DataTableSortState {
  columnId: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  /** Stable identifier — used for sort state + React keys. */
  id: string;
  header: React.ReactNode;
  /** Renders the cell content. May return JSX. */
  accessor: (row: T, index: number) => React.ReactNode;
  /**
   * Raw comparable value for sorting. Required if `accessor` returns JSX
   * (non-primitive) and the column is `sortable`. When omitted, the table
   * falls back to comparing `accessor`'s return value directly (works for
   * plain string/number accessors only).
   */
  sortValue?: (row: T) => string | number | Date | null | undefined;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  /** CSS width, e.g. '96px', '8rem', '20%'. Requires `fixedLayout` to be exact. */
  width?: string;
  /** Applies a monospace/tabular-nums treatment — good for numbers/hashes/ids. */
  monospace?: boolean;
  className?: string;
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Stable row key. */
  getRowId: (row: T, index: number) => string;
  /** Controlled sort state. Omit to let the table manage its own sort. */
  sort?: DataTableSortState | null;
  onSortChange?: (next: DataTableSortState | null) => void;
  /** Initial sort when uncontrolled. */
  defaultSort?: DataTableSortState | null;
  onRowClick?: (row: T, index: number) => void;
  /** Fired on Enter/Space when a row has keyboard focus. */
  onRowActivate?: (row: T, index: number) => void;
  selectedRowId?: string | null;
  density?: 'compact' | 'comfortable';
  stickyHeader?: boolean;
  zebra?: boolean;
  fixedLayout?: boolean;
  emptyState?: React.ReactNode;
  caption?: string;
  className?: string;
  /** Enables an internal scroll container capped at this height (e.g. '480px'). */
  maxHeight?: string;
}

const ALIGN_CLASS: Record<NonNullable<DataTableColumn<unknown>['align']>, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

const DENSITY_CELL_PAD: Record<NonNullable<DataTableProps<unknown>['density']>, string> = {
  compact: 'px-2.5 py-1.5',
  comfortable: 'px-3.5 py-2.5',
};

function defaultSortValue<T>(col: DataTableColumn<T>, row: T): string | number | Date | null | undefined {
  if (col.sortValue) return col.sortValue(row);
  const v = col.accessor(row, -1);
  if (typeof v === 'string' || typeof v === 'number') return v;
  return undefined;
}

export function DataTable<T,>({
  columns,
  rows,
  getRowId,
  sort,
  onSortChange,
  defaultSort = null,
  onRowClick,
  onRowActivate,
  selectedRowId = null,
  density = 'compact',
  stickyHeader = true,
  zebra = true,
  fixedLayout = false,
  emptyState,
  caption,
  className,
  maxHeight,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<DataTableSortState | null>(defaultSort);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  const isControlledSort = sort !== undefined;
  const activeSort = isControlledSort ? sort : internalSort;

  const applySort = useCallback(
    (next: DataTableSortState | null) => {
      onSortChange?.(next);
      if (!isControlledSort) setInternalSort(next);
    },
    [isControlledSort, onSortChange]
  );

  const handleHeaderActivate = useCallback(
    (col: DataTableColumn<T>) => {
      if (!col.sortable) return;
      if (activeSort?.columnId === col.id) {
        if (activeSort.direction === 'asc') applySort({ columnId: col.id, direction: 'desc' });
        else applySort(null); // third click: clear sort, revert to input order
      } else {
        applySort({ columnId: col.id, direction: 'asc' });
      }
    },
    [activeSort, applySort]
  );

  const sortedRows = useMemo(() => {
    if (!activeSort) return rows;
    const col = columns.find((c) => c.id === activeSort.columnId);
    if (!col) return rows;
    const dir = activeSort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = defaultSortValue(col, a);
      const vb = defaultSortValue(col, b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [rows, activeSort, columns]);

  useEffect(() => {
    if (focusedRowIndex < 0) return;
    const el = rowRefs.current.get(focusedRowIndex);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedRowIndex]);

  // Reset keyboard focus if the row set shrinks below the focused index.
  useEffect(() => {
    if (focusedRowIndex >= sortedRows.length) setFocusedRowIndex(sortedRows.length - 1);
  }, [sortedRows.length, focusedRowIndex]);

  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (sortedRows.length === 0) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedRowIndex((i) => Math.min(sortedRows.length - 1, i < 0 ? 0 : i + 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedRowIndex((i) => Math.max(0, i - 1));
          break;
        case 'Home':
          e.preventDefault();
          setFocusedRowIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setFocusedRowIndex(sortedRows.length - 1);
          break;
        case 'Enter':
        case ' ':
          if (focusedRowIndex >= 0 && focusedRowIndex < sortedRows.length) {
            e.preventDefault();
            const row = sortedRows[focusedRowIndex];
            onRowActivate?.(row, focusedRowIndex);
            onRowClick?.(row, focusedRowIndex);
          }
          break;
        default:
          break;
      }
    },
    [sortedRows, focusedRowIndex, onRowActivate, onRowClick]
  );

  const cellPad = DENSITY_CELL_PAD[density];
  const hasWidths = fixedLayout && columns.some((c) => c.width);

  return (
    <div
      className={cn(
        'rounded-lg border border-lattice-border bg-lattice-surface overflow-hidden',
        className
      )}
    >
      <div
        role="grid"
        aria-rowcount={sortedRows.length}
        aria-colcount={columns.length}
        aria-label={caption}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        className={cn('overflow-auto', ds.focusRing)}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className={cn('w-full border-collapse text-sm', fixedLayout && 'table-fixed')}>
          {caption && <caption className="sr-only">{caption}</caption>}
          {hasWidths && (
            <colgroup>
              {columns.map((col) => (
                <col key={col.id} style={col.width ? { width: col.width } : undefined} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              {columns.map((col) => {
                const isSorted = activeSort?.columnId === col.id;
                const SortIcon = isSorted
                  ? activeSort!.direction === 'asc'
                    ? ChevronUp
                    : ChevronDown
                  : ChevronsUpDown;
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={
                      isSorted ? (activeSort!.direction === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined
                    }
                    className={cn(
                      stickyHeader && 'sticky top-0 z-10',
                      'bg-lattice-elevated border-b border-lattice-border',
                      cellPad,
                      ALIGN_CLASS[col.align ?? 'left'],
                      'text-[11px] uppercase tracking-wider text-gray-400 font-medium select-none',
                      col.headerClassName
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleHeaderActivate(col)}
                        className={cn(
                          'inline-flex items-center gap-1 hover:text-white transition-colors',
                          col.align === 'right' && 'flex-row-reverse',
                          ds.focusRing
                        )}
                      >
                        <span>{col.header}</span>
                        <SortIcon className={cn('w-3 h-3 shrink-0', isSorted ? 'text-neon-blue' : 'text-gray-600')} aria-hidden="true" />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={cn(cellPad, 'text-center text-gray-500 py-8')}>
                  {emptyState ?? 'No data'}
                </td>
              </tr>
            ) : (
              sortedRows.map((row, i) => {
                const rowId = getRowId(row, i);
                const isFocused = focusedRowIndex === i;
                const isSelected = selectedRowId !== null && selectedRowId === rowId;
                return (
                  <tr
                    key={rowId}
                    ref={(el) => {
                      if (el) rowRefs.current.set(i, el);
                      else rowRefs.current.delete(i);
                    }}
                    role="row"
                    aria-rowindex={i + 1}
                    aria-selected={isSelected || isFocused}
                    tabIndex={-1}
                    onClick={() => {
                      setFocusedRowIndex(i);
                      onRowClick?.(row, i);
                    }}
                    className={cn(
                      'border-b border-lattice-border/50 last:border-0 transition-colors',
                      onRowClick && 'cursor-pointer',
                      zebra && i % 2 === 1 && 'bg-white/[0.015]',
                      isSelected && 'bg-neon-blue/10',
                      isFocused && 'ring-1 ring-inset ring-neon-blue/50 bg-white/[0.04]',
                      !isSelected && !isFocused && 'hover:bg-white/[0.03]'
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={cn(
                          cellPad,
                          ALIGN_CLASS[col.align ?? 'left'],
                          'text-gray-200',
                          col.monospace && 'font-mono tabular-nums text-[13px]',
                          col.className
                        )}
                      >
                        {col.accessor(row, i)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
