'use client';

import { useState, useMemo } from 'react';
import {
  Table,
  Plus,
  SortAsc,
  SortDesc,
  Trash2,
  Search,
  Grid3X3,
  LayoutList,
  Calendar,
  Kanban
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Column {
  id: string;
  name: string;
  type: 'text' | 'number' | 'select' | 'multiselect' | 'date' | 'checkbox' | 'url';
  options?: string[];
  required?: boolean;
}

interface Row {
  id: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface DatabaseTableProps {
  name: string;
  schema: Column[];
  rows: Row[];
  onAddRow?: (data: Record<string, unknown>) => void;
  onUpdateRow?: (rowId: string, data: Record<string, unknown>) => void;
  onDeleteRow?: (rowId: string) => void;
  onAddColumn?: (column: Partial<Column>) => void;
  className?: string;
}

type ViewType = 'table' | 'gallery' | 'list' | 'calendar' | 'kanban';

export function DatabaseTable({
  name,
  schema,
  rows,
  onAddRow,
  onUpdateRow,
  onDeleteRow,
  onAddColumn,
  className
}: DatabaseTableProps) {
  const [viewType, setViewType] = useState<ViewType>('table');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterText, setFilterText] = useState('');
  const [editingCell, setEditingCell] = useState<{ rowId: string; colId: string } | null>(null);
  const [newRowData, setNewRowData] = useState<Record<string, unknown>>({});
  const [showNewRow, setShowNewRow] = useState(false);
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState<Column['type']>('text');

  const handleAddColumn = () => {
    if (newColumnName.trim() && onAddColumn) {
      onAddColumn({
        name: newColumnName.trim(),
        type: newColumnType,
      });
      setNewColumnName('');
      setNewColumnType('text');
      setShowAddColumn(false);
    }
  };

  const filteredAndSortedRows = useMemo(() => {
    let result = [...rows];

    // Filter
    if (filterText) {
      const lower = filterText.toLowerCase();
      result = result.filter(row =>
        Object.values(row.data).some(val =>
          String(val || '').toLowerCase().includes(lower)
        )
      );
    }

    // Sort
    if (sortColumn) {
      result.sort((a, b) => {
        const aVal = a.data[sortColumn] || '';
        const bVal = b.data[sortColumn] || '';
        const cmp = String(aVal).localeCompare(String(bVal));
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [rows, filterText, sortColumn, sortDirection]);

  const handleSort = (colId: string) => {
    if (sortColumn === colId) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(colId);
      setSortDirection('asc');
    }
  };

  const handleCellChange = (rowId: string, colId: string, value: unknown) => {
    if (onUpdateRow) {
      const row = rows.find(r => r.id === rowId);
      if (row) {
        onUpdateRow(rowId, { ...row.data, [colId]: value });
      }
    }
    setEditingCell(null);
  };

  const handleAddRow = () => {
    if (onAddRow) {
      onAddRow(newRowData);
      setNewRowData({});
      setShowNewRow(false);
    }
  };

  const renderCellValue = (column: Column, value: unknown, rowId: string) => {
    const isEditing = editingCell?.rowId === rowId && editingCell?.colId === column.id;

    if (isEditing) {
      return (
        <input
          type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
          value={(value as string) || ''}
          onChange={(e) => handleCellChange(rowId, column.id, e.target.value)}
          onBlur={() => setEditingCell(null)}
          onKeyDown={(e) => e.key === 'Enter' && setEditingCell(null)}
          className="w-full bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-neon-cyan rounded px-1"
          autoFocus
        />
      );
    }

    switch (column.type) {
      case 'checkbox':
        return (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleCellChange(rowId, column.id, e.target.checked)}
            className="rounded border-gray-600"
          />
        );
      case 'url':
        return value ? (
          <a href={value as string} target="_blank" rel="noopener noreferrer" className="text-neon-cyan hover:underline truncate">
            {value as string}
          </a>
        ) : null;
      case 'select':
        return (
          <span className="px-2 py-0.5 bg-lattice-surface rounded text-sm">
            {(value as string) || '-'}
          </span>
        );
      case 'multiselect':
        return Array.isArray(value) ? (
          <div className="flex flex-wrap gap-1">
            {value.map((v: string) => (
              <span key={v} className="px-2 py-0.5 bg-neon-cyan/20 text-neon-cyan rounded text-xs">
                {v}
              </span>
            ))}
          </div>
        ) : null;
      default:
        return <span className="truncate">{(value as string) || '-'}</span>;
    }
  };

  const viewIcons: Record<ViewType, React.ReactNode> = {
    table: <Table className="w-4 h-4" />,
    gallery: <Grid3X3 className="w-4 h-4" />,
    list: <LayoutList className="w-4 h-4" />,
    calendar: <Calendar className="w-4 h-4" />,
    kanban: <Kanban className="w-4 h-4" />
  };

  return (
    <div className={cn('flex flex-col h-full bg-lattice-bg', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Table className="w-5 h-5 text-neon-cyan" />
            <h2 className="font-semibold text-white">{name}</h2>
            <span className="text-sm text-gray-400">({rows.length} rows)</span>
          </div>

          <div className="flex items-center gap-2">
            {/* View switcher */}
            <div className="flex items-center bg-lattice-surface rounded-lg p-1">
              {(Object.keys(viewIcons) as ViewType[]).map(type => (
                <button
                  key={type}
                  onClick={() => setViewType(type)}
                  className={cn(
                    'p-1.5 rounded transition-colors',
                    viewType === type
                      ? 'bg-neon-cyan/20 text-neon-cyan'
                      : 'text-gray-400 hover:text-white'
                  )}
                  title={type.charAt(0).toUpperCase() + type.slice(1)}
                >
                  {viewIcons[type]}
                </button>
              ))}
            </div>

            {/* Add row */}
            <button
              onClick={() => setShowNewRow(true)}
              className="flex items-center gap-1 px-3 py-1.5 bg-neon-cyan text-black text-sm font-medium rounded-lg hover:bg-neon-cyan/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New
            </button>
          </div>
        </div>

        {/* Search/Filter */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter..."
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Table View */}
      {viewType === 'table' && (
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-lattice-surface z-10">
              <tr>
                {schema.map(col => (
                  <th
                    key={col.id}
                    onClick={() => handleSort(col.id)}
                    className="px-4 py-2 text-left text-sm font-medium text-gray-400 border-b border-lattice-border cursor-pointer hover:bg-lattice-bg transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {col.name}
                      {col.required && <span className="text-red-400">*</span>}
                      {sortColumn === col.id && (
                        sortDirection === 'asc'
                          ? <SortAsc className="w-3 h-3" />
                          : <SortDesc className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                ))}
                <th className="w-10"></th>
                {onAddColumn && (
                  <th className="px-2 py-2 border-b border-lattice-border">
                    {showAddColumn ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={newColumnName}
                          onChange={(e) => setNewColumnName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddColumn();
                            if (e.key === 'Escape') setShowAddColumn(false);
                          }}
                          placeholder="Name"
                          className="w-20 px-1 py-0.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white focus:outline-none focus:border-neon-cyan"
                          autoFocus
                        />
                        <select
                          value={newColumnType}
                          onChange={(e) => setNewColumnType(e.target.value as Column['type'])}
                          className="px-1 py-0.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white"
                        >
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="date">Date</option>
                          <option value="checkbox">Checkbox</option>
                          <option value="url">URL</option>
                          <option value="select">Select</option>
                        </select>
                        <button onClick={handleAddColumn} className="text-neon-cyan text-xs">Add</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowAddColumn(true)}
                        className="p-1 text-gray-400 hover:text-neon-cyan transition-colors"
                        title="Add column"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredAndSortedRows.map(row => (
                <tr
                  key={row.id}
                  className="border-b border-lattice-border hover:bg-lattice-surface/50 transition-colors"
                >
                  {schema.map(col => (
                    <td
                      key={col.id}
                      onClick={() => setEditingCell({ rowId: row.id, colId: col.id })}
                      className="px-4 py-2 text-sm text-gray-300 cursor-text"
                    >
                      {renderCellValue(col, row.data[col.id], row.id)}
                    </td>
                  ))}
                  <td className="px-2">
                    <button
                      onClick={() => onDeleteRow?.(row.id)}
                      className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                    aria-label="Delete">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}

              {/* New row input */}
              {showNewRow && (
                <tr className="border-b border-neon-cyan/30 bg-neon-cyan/5">
                  {schema.map(col => (
                    <td key={col.id} className="px-4 py-2">
                      <input
                        type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                        value={(newRowData[col.name] as string) || ''}
                        onChange={(e) => setNewRowData(prev => ({ ...prev, [col.name]: e.target.value }))}
                        placeholder={col.name}
                        className="w-full px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
                      />
                    </td>
                  ))}
                  <td className="px-2">
                    <button
                      onClick={handleAddRow}
                      className="p-1 text-neon-cyan hover:text-neon-cyan/80 transition-colors"
                    aria-label="Add">
                      <Plus className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {filteredAndSortedRows.length === 0 && !showNewRow && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Table className="w-10 h-10 text-gray-600 mb-3" />
              <p className="text-gray-400">No rows yet</p>
              <button
                onClick={() => setShowNewRow(true)}
                className="mt-2 text-sm text-neon-cyan hover:underline"
              >
                Add your first row
              </button>
            </div>
          )}
        </div>
      )}

      {/* Gallery view */}
      {viewType === 'gallery' && (
        <div className="flex-1 overflow-auto p-4">
          {filteredAndSortedRows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">No items yet</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredAndSortedRows.map(row => (
                <div key={row.id} className="bg-lattice-surface border border-lattice-border rounded-lg p-3 hover:border-neon-cyan/30 transition-colors">
                  {schema.slice(0, 3).map(col => (
                    <div key={col.id} className="mb-1">
                      <span className="text-xs text-gray-400">{col.name}</span>
                      <p className="text-sm text-white truncate">{String(row.data[col.id] ?? '—')}</p>
                    </div>
                  ))}
                  <p className="text-xs text-gray-400 mt-2">{new Date(row.updatedAt).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* List view */}
      {viewType === 'list' && (
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {filteredAndSortedRows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">No items yet</div>
          ) : (
            filteredAndSortedRows.map(row => (
              <div key={row.id} className="flex items-center gap-4 bg-lattice-surface border border-lattice-border rounded-lg px-4 py-2 hover:border-neon-cyan/30 transition-colors">
                {schema.map(col => (
                  <div key={col.id} className="flex-1 min-w-0">
                    <span className="text-xs text-gray-400">{col.name}: </span>
                    <span className="text-sm text-white">{String(row.data[col.id] ?? '—')}</span>
                  </div>
                ))}
                {onDeleteRow && (
                  <button onClick={() => onDeleteRow(row.id)} className="text-red-400 hover:text-red-300 shrink-0" aria-label="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Calendar view */}
      {viewType === 'calendar' && (
        <div className="flex-1 overflow-auto p-4">
          {filteredAndSortedRows.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">No items yet</div>
          ) : (
            <div className="space-y-2">
              {filteredAndSortedRows
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map(row => {
                  const dateCol = schema.find(c => c.type === 'date');
                  const dateVal = dateCol ? String(row.data[dateCol.id] ?? '') : row.createdAt;
                  return (
                    <div key={row.id} className="flex items-start gap-3 bg-lattice-surface border border-lattice-border rounded-lg px-4 py-2">
                      <div className="shrink-0 text-center bg-lattice-bg rounded-lg px-2 py-1 min-w-[60px]">
                        <Calendar className="w-3 h-3 mx-auto text-neon-cyan mb-0.5" />
                        <p className="text-xs text-gray-400">{dateVal ? new Date(dateVal).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        {schema.filter(c => c.type !== 'date').slice(0, 2).map(col => (
                          <p key={col.id} className="text-sm text-white truncate">{String(row.data[col.id] ?? '—')}</p>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Kanban view */}
      {viewType === 'kanban' && (() => {
        const selectCol = schema.find(c => c.type === 'select');
        if (!selectCol || !selectCol.options) {
          return (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              Requires a select column to group by
            </div>
          );
        }
        const groups: Record<string, Row[]> = {};
        for (const opt of selectCol.options) groups[opt] = [];
        groups['Unset'] = [];
        for (const row of filteredAndSortedRows) {
          const val = String(row.data[selectCol.id] ?? '');
          if (val && groups[val]) groups[val].push(row);
          else groups['Unset'].push(row);
        }
        return (
          <div className="flex-1 overflow-x-auto p-4">
            <div className="flex gap-4 min-w-max">
              {Object.entries(groups).map(([group, groupRows]) => (
                <div key={group} className="w-64 shrink-0 bg-lattice-surface border border-lattice-border rounded-lg p-3">
                  <h4 className="text-sm font-semibold text-white mb-3">{group} <span className="text-gray-400">({groupRows.length})</span></h4>
                  <div className="space-y-2">
                    {groupRows.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No items</p>
                    ) : (
                      groupRows.map(row => (
                        <div key={row.id} className="bg-lattice-bg border border-lattice-border rounded-lg p-2">
                          {schema.filter(c => c.id !== selectCol.id).slice(0, 2).map(col => (
                            <p key={col.id} className="text-xs text-white truncate">{String(row.data[col.id] ?? '—')}</p>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
