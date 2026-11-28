/**
 * The report a ConKay build returns (server/lib/conkay/build/report.js):
 * what a solver checked, what it only computed, and what nothing checked —
 * every value already in the person's own units.
 */
export interface BuildCheck {
  solver: string; target: string; targetName: string; status: string;
  check: string; pass: boolean; demand: string; capacity: string;
  utilization: number | null; basis: string | null; method?: string | null;
  /** The part (node id) this check is about, when it is about one part. */
  part?: string;
}
/** A value the person can change on a build, as written (their units). */
export interface BuildParameter {
  id: string; node: string; nodeName: string; label: string; value: string;
  dim: 'length' | 'force' | 'force_per_length' | 'ratio' | 'material' | string;
  options?: string[];
}
export type PartStatus = 'pass' | 'warn' | 'fail' | 'unchecked';
export interface BuildGap { target: string; targetName: string; solver?: string; domain?: string; reason: string; needs?: string | null }
export interface BuildComputed { solver: string; target: string; targetName: string; outputs?: Array<{ name: string; value: string }>; note?: string }
export interface BuildPart { id: string; name: string; kind: string; material?: string; shape?: string; children: BuildPart[] }
export interface BuildReport {
  verdict: 'fails' | 'passes_checked' | 'unchecked';
  headline: string;
  units: Record<string, string>;
  parts: BuildPart[];
  masses: Array<{ id: string; name: string; mass: string | null }>;
  checked: BuildCheck[];
  partStatus?: Record<string, PartStatus>;
  parameters?: BuildParameter[];
  computed: BuildComputed[];
  gaps: BuildGap[];
  questions: Array<{ ask: string; blocking: boolean; default?: string }>;
  assumptions: string[];
  sources: Array<{ for: string; book: string; section: string; url?: string }>;
}

export function isBuildReport(v: unknown): v is BuildReport {
  const r = v as BuildReport | null;
  return Boolean(r && typeof r === 'object' && Array.isArray(r.checked) && Array.isArray(r.gaps) && Array.isArray(r.parts));
}

/** What the solvers did when asked to size a build (server/lib/conkay/build/size.js). */
export interface BuildSizing {
  feasible: boolean;
  evaluations: number;
  before: { mass: number; feasible: boolean };
  after?: { mass: number; worstUtilization: number };
  changes?: Array<{ id: string; label: string; from: string; to: string; atBound: string | null }>;
  binding?: Array<{ check: string; target: string; utilization: number }>;
  failingAtLimits?: Array<{ check: string; target: string; utilization: number }>;
  message?: string;
  method?: string;
}
