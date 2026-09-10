'use client';

import { CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export interface TableInfo {
  name: string;
  schema: string;
  rowCount: number;
  sizeBytes: number;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimary: boolean;
  isForeign: boolean;
  references?: { table: string; column: string };
}

export interface IndexInfo {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  type: string;
  sizeBytes: number;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  duration: number;
  error?: string;
}

export interface QueryHistoryEntry {
  id: number;
  sql: string;
  timestamp: number;
  duration: number;
  rowCount: number;
  success: boolean;
}

export interface PerfSnapshot {
  timestamp: number;
  heapUsed: number;
  queryRate: number;
  cacheHitRate: number;
  activeConns: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

export function formatUptime(seconds?: number): string {
  if (!seconds) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function exportCSV(columns: string[], rows: Record<string, unknown>[]) {
  const header = columns.join(',');
  const body = rows.map(r => columns.map(c => {
    const val = r[c];
    const s = val === null || val === undefined ? '' : String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'query_result.csv'; a.click();
  URL.revokeObjectURL(url);
}

export function exportJSON(rows: Record<string, unknown>[]) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'query_result.json'; a.click();
  URL.revokeObjectURL(url);
}

export function StatusCard({ title, value, icon, status, detail }: {
  title: string;
  value: string;
  icon: ReactNode;
  status: 'success' | 'warning' | 'error' | 'neutral';
  detail?: string;
}) {
  const colors = { success: 'text-green-400', warning: 'text-yellow-400', error: 'text-red-400', neutral: 'text-gray-400' };
  const badges = {
    success: <CheckCircle className="w-5 h-5 text-green-400" />,
    warning: <AlertCircle className="w-5 h-5 text-yellow-400" />,
    error: <XCircle className="w-5 h-5 text-red-400" />,
    neutral: null,
  };
  return (
    <div className="lens-card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-400">{icon}</span>
        {badges[status]}
      </div>
      <p className="text-sm text-gray-400">{title}</p>
      <p className={`text-lg font-bold ${colors[status]}`}>{value}</p>
      {detail && <p className="text-xs text-gray-400 mt-1">{detail}</p>}
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-lattice-surface rounded p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

export function MiniBarChart({ data, label, color }: { data: number[]; label: string; color: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="bg-lattice-surface rounded p-3">
      <p className="text-xs text-gray-400 mb-2">{label}</p>
      <div className="flex items-end gap-[2px] h-16">
        {data.map((v, i) => (
          <div
            key={i}
            className={`flex-1 rounded-t ${color} opacity-80 hover:opacity-100 transition-opacity`}
            style={{ height: `${(v / max) * 100}%`, minHeight: '2px' }}
            title={`${v.toFixed(1)}`}
          />
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-1 text-right">{data[data.length - 1]?.toFixed(1)}</p>
    </div>
  );
}
