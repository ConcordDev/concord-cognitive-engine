export type Category = 'economy' | 'liveness' | 'arc';
export type Disposition = 'healed' | 'escalated' | 'noted';
export type Priority = 'high' | 'normal';
export type FilterTab = 'all' | Disposition;

export interface HealthEntry {
  id: string;
  pathology: string;
  category: Category;
  disposition: Disposition;
  subject_id: string;
  checked_at: number;
  detail: Record<string, unknown>;
}

export interface Escalation {
  id: string;
  message: string;
  priority: Priority;
  status: string;
  created_at: string;
}

export interface RepairPattern {
  pattern: string;
  fix?: unknown;
  occurrences: number;
  successes: number;
  failures: number;
  successRate: number;
  firstSeen: string;
  lastSeen: string;
  deprecated: boolean;
  securityRelated?: boolean;
  cveId?: string | null;
}

export interface MemStats {
  totalPatterns: number;
  totalRepairs: number;
  avgSuccessRate: number;
  deprecatedFixes: number;
  topPatterns: RepairPattern[];
}

export type LoadState = 'loading' | 'error' | 'ready';

export const FILTER_TABS: { id: FilterTab; label: string; key: string }[] = [
  { id: 'all', label: 'All', key: '1' },
  { id: 'healed', label: 'Healed', key: '2' },
  { id: 'escalated', label: 'Escalated', key: '3' },
  { id: 'noted', label: 'Noted', key: '4' },
];

export const CATEGORY_STYLE: Record<Category, string> = {
  economy: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
  liveness: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
  arc: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200',
};

export const AUTO_REFRESH_MS = 30_000;
export const AUTO_REFRESH_KEY = 'concord:repair-telemetry:auto-refresh';

export function formatDetail(pathology: string, detail: Record<string, unknown> | undefined): string {
  const d = detail || {};
  if (pathology === 'negative_balance' && typeof d.balance === 'number') return `balance ${d.balance.toFixed(2)} CC`;
  if (pathology === 'dupe_citation' && typeof d.count === 'number') return `${d.count}× duplicate royalty edges`;
  if (pathology === 'stuck_scheduler' && typeof d.overdue_s === 'number') return `${humanizeDuration(d.overdue_s as number)} overdue`;
  const keys = Object.keys(d);
  if (!keys.length) return '—';
  return keys.slice(0, 2).map((k) => `${k}: ${JSON.stringify(d[k])}`).join(', ');
}

function humanizeDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(seconds / 60))}m`;
}
