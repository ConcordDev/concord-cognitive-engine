// Shared types for the code-quality analysis surface.
// These mirror the envelopes returned by the server/domains/code-quality.js
// macros (analyze, annotate, trend, debt, hotspots, gate*, decoratePR,
// issue workflow). Kept in one file so every component reads the same shape.

export type CQSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CQFinding {
  rule: string;
  severity: CQSeverity;
  line: number;
  column: number;
  source: string;
  message: string;
  fixHint: string;
  effortMin: number;
  file?: string;
}

export interface CQMetrics {
  totalLines: number;
  codeLines: number;
  commentLines: number;
  blankLines: number;
  functionCount: number;
  avgComplexity: number;
  maxComplexity: number;
  duplicationPct: number;
  duplicateBlocks: number;
  commentDensity: number;
  maintainability: number;
  debtMinutes: number;
  debtHours: number;
  findingCount?: number;
}

export interface CQFunctionInfo {
  name: string;
  startLine: number;
  endLine: number;
  lineCount: number;
  complexity: number;
  maxNesting: number;
  paramCount: number;
}

export interface CQFileReport {
  file: string;
  language: string;
  findings: CQFinding[];
  metrics: CQMetrics;
  functions: CQFunctionInfo[];
}

export interface CQTotals {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface CQScan {
  scanId: string;
  createdAt: string;
  fileCount: number;
  totals: CQTotals;
  metrics: CQMetrics;
  grade: string;
  files: CQFileReport[];
}

export interface CQAnnotation {
  line: number;
  issues: Array<{
    rule: string;
    severity: CQSeverity;
    message: string;
    fixHint: string;
    column: number;
  }>;
  context: string;
  worstSeverity: CQSeverity;
}

export interface CQAnnotatedFile {
  file: string;
  language: string;
  totalLines: number;
  annotationCount: number;
  annotations: CQAnnotation[];
}

export interface CQTrendPoint {
  scanId: string;
  at: string;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  debtHours: number;
  maintainability: number;
  duplicationPct: number;
  grade: string;
}

export interface CQDebt {
  scanId: string;
  totalMinutes: number;
  totalHours: number;
  workdays: number;
  debtRatioPct: number;
  rating: string;
  byRule: Array<{ rule: string; minutes: number; hours: number; count: number }>;
  bySeverity: Array<{ severity: CQSeverity; minutes: number; hours: number }>;
}

export interface CQHotspots {
  scanId: string;
  duplicateBlocks: Array<{ file: string; line: number; message: string; severity: CQSeverity }>;
  duplicationPct: number;
  functionHotspots: Array<{
    file: string;
    function: string;
    startLine: number;
    lineCount: number;
    complexity: number;
    maxNesting: number;
    riskScore: number;
  }>;
  fileHotspots: Array<{
    file: string;
    findings: number;
    duplicationPct: number;
    maxComplexity: number;
    maintainability: number;
    score: number;
  }>;
}

export interface CQGate {
  maxCritical: number;
  maxHigh: number;
  maxBlockerDebtHours: number;
  minMaintainability: number;
  maxDuplicationPct: number;
  blockOnNewCritical: boolean;
}

export interface CQGateVerdict {
  scanId: string;
  gate: CQGate;
  passed: boolean;
  status: 'PASS' | 'FAIL';
  checks: Array<{ name: string; pass: boolean; detail: string }>;
  failedCount: number;
  newCriticalCount: number | null;
}

export interface CQIssue {
  id: string;
  rule: string;
  severity: CQSeverity;
  message: string;
  file: string | null;
  line: number | null;
  scanId: string | null;
  status: string;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  history: Array<{ at: string; action: string }>;
}

export interface CQPRResult {
  summary: {
    newIssues: number;
    fixedIssues: number;
    unchangedIssues: number;
    netChange: number;
    newBySeverity: CQTotals;
  };
  verdict: 'BLOCK' | 'WARN' | 'COMMENT' | 'APPROVE';
  verdictReason: string;
  files: Array<{
    file: string;
    isNew: boolean;
    newIssues: CQFinding[];
    fixedIssues: number;
    unchangedIssues: number;
    maintainabilityDelta: number;
  }>;
}

export const CQ_SEVERITY_STYLE: Record<CQSeverity, string> = {
  critical: 'text-red-500 bg-red-500/10 border-red-500/30',
  high: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  medium: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  low: 'text-blue-300 bg-blue-300/10 border-blue-300/30',
  info: 'text-gray-400 bg-gray-400/10 border-gray-400/20',
};

export const CQ_SEVERITIES: CQSeverity[] = ['critical', 'high', 'medium', 'low', 'info'];
