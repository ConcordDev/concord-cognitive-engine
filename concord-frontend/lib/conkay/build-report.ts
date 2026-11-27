/**
 * The report a ConKay build returns (server/lib/conkay/build/report.js):
 * what a solver checked, what it only computed, and what nothing checked —
 * every value already in the person's own units.
 */
export interface BuildCheck {
  solver: string; target: string; targetName: string; status: string;
  check: string; pass: boolean; demand: string; capacity: string;
  utilization: number | null; basis: string | null; method?: string | null;
}
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
