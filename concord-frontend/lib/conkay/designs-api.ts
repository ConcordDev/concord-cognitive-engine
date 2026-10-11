/**
 * Client for the ConKay results page (server/lib/conkay/showcase, served by
 * the no-login GET routes in server/routes/conkay-demo.js). The snapshots are
 * precomputed by the real pipelines; the page only reads them. Types mirror
 * the snapshot JSON; nothing here invents or rounds a value.
 */

import { demoFailure, getDemoJson, type OnDemoRetry } from '@/lib/conkay/demo-api';

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'NOT_COMPUTED' | 'ERROR';
export type ValueStatus = 'sourced' | 'measured' | 'computed' | 'estimated' | 'design' | 'unknown';
export type CheckCounts = Record<CheckStatus, number>;

export interface DesignMargin {
  check: string | null;
  demand: number | null;
  capacity: number | null;
  unit: string | null;
  utilization: number | null;
  marginPct: number | null;
}

export interface DesignCheck {
  runId: string;
  solver: string;
  target: string | null;
  status: CheckStatus;
  method: string | null;
  reason: string | null;
  margins: DesignMargin[];
  failures: string[];
  warnings: string[];
}

export interface DesignSource {
  title: string | null;
  url: string | null;
  locator?: string | null;
  quote?: string | null;
  retrieved?: string | null;
}

export interface DesignValue {
  id: string;
  group: string;
  name: string;
  subject?: string | null;
  statement?: string | null;
  value: number | null;
  unit: string | null;
  range: { low: number; high: number } | null;
  status: ValueStatus;
  statusLabel: string;
  support?: string | null;
  source: DesignSource | null;
  sourceRole: string | null;
  method: string | null;
  note: string | null;
}

export interface DesignFile {
  label: string;
  name: string;
  kind: 'svg' | 'pdf';
  bytes: number;
  sha256: string;
}

export interface DesignDrawing {
  title: string;
  revision: string | null;
  modelHash: string | null;
  method: string | null;
  files: DesignFile[];
}

export interface DesignMass {
  totalKg: number;
  bandKg: [number, number] | null;
  byState: Record<ValueStatus, number>;
  unknownCount: number;
  notIncluded: string[];
  note: string | null;
  limit: { label: string; kg: number; marginKg: number } | null;
}

export interface DesignModel3d {
  name: string;
  format: 'stl';
  bytes: number;
  sha256: string;
  triangles: number | null;
  units: string;
  upAxis: 'z';
  source: string;
}

export interface DesignSnapshot {
  showcaseVersion: string;
  id: string;
  title: string;
  kind: string;
  pipeline: string;
  brief: string;
  headline: Record<string, unknown> & { verdict: string; status: CheckStatus };
  disclaimers: string[];
  caveats: string[];
  failures: string[];
  repairs?: { variable: string; before: string; after: string; result: string | null; failingRun: string }[];
  checks: DesignCheck[];
  checkCounts: CheckCounts;
  perPartRuns?: CheckCounts;
  values: DesignValue[];
  mass: DesignMass | null;
  drawings: DesignDrawing[];
  model3d: DesignModel3d | null;
  physicalTests: string[];
  reviewQueue?: { id: string; kind: string; subject: string | null; decision: string; reason: string | null }[];
  statuses: ValueStatus[];
  statusMeaning: Record<ValueStatus, string>;
  files: { name: string; bytes: number; sha256: string }[];
  snapshotSha256: string;
}

export interface DesignSummary {
  id: string;
  title: string;
  kind: string;
  available: boolean;
  brief?: string;
  headline?: DesignSnapshot['headline'];
  checkCounts?: CheckCounts;
  hasDrawings?: boolean;
  hasModel3d?: boolean;
  snapshotSha256?: string;
}

export const VALUE_STATUSES: ValueStatus[] = ['sourced', 'measured', 'computed', 'estimated', 'design', 'unknown'];
export const CHECK_STATUSES: CheckStatus[] = ['PASS', 'WARN', 'FAIL', 'NOT_COMPUTED', 'ERROR'];

export function designFileUrl(id: string, name: string): string {
  return `/api/conkay/demo/designs/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`;
}

export async function fetchDesigns(onRetry?: OnDemoRetry): Promise<DesignSummary[] | { error: string }> {
  const { status, body } = await getDemoJson('/api/conkay/demo/designs', onRetry);
  if (status !== 200 || !body?.ok || !Array.isArray(body.designs)) return demoFailure(status, body, 'Could not load the designs.');
  return body.designs as DesignSummary[];
}

export async function fetchDesign(id: string, onRetry?: OnDemoRetry): Promise<DesignSnapshot | { error: string }> {
  const { status, body } = await getDemoJson(`/api/conkay/demo/designs/${encodeURIComponent(id)}`, onRetry);
  if (status === 404) return { error: 'No such design.' };
  const d = body?.design as DesignSnapshot | undefined;
  if (status !== 200 || !body?.ok || !d || !Array.isArray(d.checks)) return demoFailure(status, body, 'Could not load this design.');
  return d;
}

/** "1.23 MB" / "45 KB". */
export function formatBytes(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** A number as the snapshot stored it, with up to `sig` significant digits; null stays an em dash. */
export function formatValue(v: number | null | undefined, sig = 4): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) return v.toExponential(sig - 1);
  return Number(v.toPrecision(sig)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function countByStatus(values: DesignValue[]): Record<ValueStatus, number> {
  const out = Object.fromEntries(VALUE_STATUSES.map((s) => [s, 0])) as Record<ValueStatus, number>;
  for (const v of values) out[v.status] = (out[v.status] || 0) + 1;
  return out;
}
