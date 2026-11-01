/**
 * Workbench v0 client (conversational-loop item 5): a design's knobs, locks, follow-ups and receipts. Every value
 * shown comes from the server's view of the live design; a knob move and a chat follow-up take the same edit path.
 */

import { api } from '@/lib/api/client';
import type { DesignSnapshot } from './designs-api';

export interface WorkbenchKnob {
  variable: string; label: string; value: string | number; unit?: string;
  bounds?: [number, number]; step?: number; options?: string[]; locked: boolean; source: string;
}

export interface WorkbenchNode { id: string; kind: 'knob' | 'run'; label: string; depth: number; status?: string; solver?: string | null; locked?: boolean }
export interface WorkbenchEdge { from: string; to: string; kind: 'result' | 'reads' }

export interface WorkbenchCheck {
  runId: string; status: string;
  solver: { id: string | null; version: string | null; fidelity: string | null; method: string | null; reference: string | null; regime: string | null; units: unknown; tolerance: unknown; screening: boolean | null };
  inputHash: string | null;
  inputs: Record<string, { value: unknown; unit?: string | null; source?: unknown }>;
  margins: { check: string; demand: number; capacity: number; unit: string | null; utilization: number | null }[];
  warnings: string[]; failures: string[]; assumptions: string[]; sources: string[]; explanation: string;
}

/**
 * One load case of the design's own structure.frame run, in the exact shape
 * the engineering.runFEA artifact path consumes (server chat/workbench.js
 * feaFrameOf): the model the solve used (nodes, members with their real
 * sections' A/I and material E/allowable, the case's resolved nodal loads,
 * its supports) and the solve's own result (per-node displacements, per-member
 * von Mises + utilization). Absent when the design has no frame run.
 */
export interface WorkbenchFeaFrame {
  runId: string;
  case: string;
  model: {
    nodes: { id: string; x: number; y: number; z: number }[];
    members: { id: string; nodeI: string; nodeJ: string; area: number; momentI: number; depthIn?: number; elasticModulus: number; allowableStress: number }[];
    loads: { nodeId: string; Fx?: number; Fy?: number; Fz?: number; Mx?: number; My?: number; Mz?: number }[];
    supports: { nodeId: string; fixedDOF: string[] | 'fixed' }[];
  };
  result: {
    displacements: { nodeId: string; dx: number; dy: number; dz: number }[];
    utilization: { id: string; utilization: number | null }[];
    stresses: { id: string; combinedStress: number }[];
    summary: Record<string, unknown>;
  };
  note?: string;
}

export interface WorkbenchView {
  version: string; revision: number; receipt: string; state: Record<string, unknown>;
  knobs: WorkbenchKnob[]; locked: string[];
  graph: { nodes: WorkbenchNode[]; edges: WorkbenchEdge[] };
  checks: WorkbenchCheck[];
  feaFrame?: WorkbenchFeaFrame | null;
}

export interface WorkbenchReply {
  kind: string; ok?: boolean; note?: string; error?: string; question?: string;
  /** Structured refusals (HANDOFF-3 A1): error 'invalid_input' with the field and reason named. */
  field?: string; reason?: string; message?: string;
  diff?: { changed: { field: string; before: unknown; after: unknown; unit?: string; source: string }[]; flipped: { runId: string; from: string | null; to: string | null }[]; rerun: string[] | string };
  outcome?: { kind: string; binding?: { variable: string | null; why: string }[] };
  matches?: boolean;
}

/** One assembly fit check whose status flipped across a knob edit (HANDOFF-3 A1). */
export interface FitCheckFlip { id: string; from: string | null; to: string | null }

/** POST /workbench/:id/knob: the reply, the updated view, and what the edit did to the solved assembly. */
export interface KnobResponse {
  reply: WorkbenchReply;
  view: WorkbenchView;
  fitCheckDiff: FitCheckFlip[];
  rerun: string[];
  /** The new assembly, hydrated for the viewer (null when the session has no assembly run). */
  assembly: DesignSnapshot['assembly'];
}

/**
 * One solver analysis linked to a component (HANDOFF-3 A4, server/lib/conkay/assembly/build.js
 * partAnalyses): the run that evaluated the part, its key outputs and its receipt — or an honest
 * not_run with the reason. Numbers are the envelope's own, verbatim.
 */
export interface PartAnalysis {
  solver: string;
  version?: string;
  status: 'pass' | 'warn' | 'fail' | 'not_computed' | 'not_run' | 'error';
  keyOutputs: { id: string; value: number | string; unit?: string }[];
  /** Worst margin utilization across the run's checks (structure.frame colours by this). */
  utilization?: number;
  receipt: { runId: string; solver: string; version: string | null; inputHash: string | null } | null;
  ranAt: string | null;
  /** aero.cfd only: when the recorded OpenFOAM run was imported (the result itself is older). */
  recordedAt?: string;
  reason?: string;
}

/** POST /workbench/:id/rerun: the refreshed assembly (analyses re-joined) and view. */
export interface RerunResponse {
  reply: WorkbenchReply;
  view: WorkbenchView;
  rerun: string[];
  assembly: DesignSnapshot['assembly'];
}

export interface WorkbenchClient {
  knob(id: string, variable: string, value: string | number): Promise<KnobResponse>;
  lock(id: string, variable: string, locked: boolean): Promise<{ view: WorkbenchView }>;
  ask(id: string, text: string): Promise<{ reply: WorkbenchReply; view: WorkbenchView }>;
  undo(id: string): Promise<{ reply: WorkbenchReply; view: WorkbenchView }>;
  get(id: string): Promise<{ view: WorkbenchView }>;
  /** The session's current assembly with per-part analyses joined (HANDOFF-3 A4). */
  assembly(id: string): Promise<{ assembly: DesignSnapshot['assembly']; view: WorkbenchView }>;
  /** Re-run one in-process solver and refresh the assembly (HANDOFF-3 A4). */
  rerun(id: string, solver: string): Promise<RerunResponse>;
}

const base = (id: string) => `/api/conkay/workbench/${encodeURIComponent(id)}`;

export const workbenchClient: WorkbenchClient = {
  knob: async (id, variable, value) => (await api.post(`${base(id)}/knob`, { variable, value })).data,
  lock: async (id, variable, locked) => (await api.post(`${base(id)}/lock`, { variable, locked })).data,
  ask: async (id, text) => (await api.post(`${base(id)}/ask`, { text })).data,
  undo: async (id) => (await api.post(`${base(id)}/undo`, {})).data,
  get: async (id) => (await api.get(base(id))).data,
  assembly: async (id) => (await api.get(`${base(id)}/assembly`)).data,
  rerun: async (id, solver) => (await api.post(`${base(id)}/rerun`, { solver })).data,
};

/** Runs upstream and downstream of a node (for highlighting what a knob or a check touches). */
export function neighbourhood(edges: WorkbenchEdge[], id: string): { up: Set<string>; down: Set<string> } {
  const up = new Set<string>(), down = new Set<string>();
  const walk = (start: string, dir: 'up' | 'down', seen: Set<string>) => {
    const stack = [start];
    while (stack.length) {
      const n = stack.pop() as string;
      for (const e of edges) {
        const next = dir === 'down' ? (e.from === n ? e.to : null) : (e.to === n ? e.from : null);
        if (next && !seen.has(next)) { seen.add(next); stack.push(next); }
      }
    }
  };
  walk(id, 'up', up);
  walk(id, 'down', down);
  return { up, down };
}
