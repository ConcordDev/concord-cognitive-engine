/**
 * Workbench v0 client (conversational-loop item 5): a design's knobs, locks, follow-ups and receipts. Every value
 * shown comes from the server's view of the live design; a knob move and a chat follow-up take the same edit path.
 */

import { api } from '@/lib/api/client';

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
  diff?: { changed: { field: string; before: unknown; after: unknown; source: string }[]; flipped: { runId: string; from: string | null; to: string | null }[]; rerun: string[] | string };
  outcome?: { kind: string; binding?: { variable: string | null; why: string }[] };
  matches?: boolean;
}

export interface WorkbenchClient {
  knob(id: string, variable: string, value: string | number): Promise<{ reply: WorkbenchReply; view: WorkbenchView }>;
  lock(id: string, variable: string, locked: boolean): Promise<{ view: WorkbenchView }>;
  ask(id: string, text: string): Promise<{ reply: WorkbenchReply; view: WorkbenchView }>;
  undo(id: string): Promise<{ reply: WorkbenchReply; view: WorkbenchView }>;
  get(id: string): Promise<{ view: WorkbenchView }>;
}

const base = (id: string) => `/api/conkay/workbench/${encodeURIComponent(id)}`;

export const workbenchClient: WorkbenchClient = {
  knob: async (id, variable, value) => (await api.post(`${base(id)}/knob`, { variable, value })).data,
  lock: async (id, variable, locked) => (await api.post(`${base(id)}/lock`, { variable, locked })).data,
  ask: async (id, text) => (await api.post(`${base(id)}/ask`, { text })).data,
  undo: async (id) => (await api.post(`${base(id)}/undo`, {})).data,
  get: async (id) => (await api.get(base(id))).data,
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
