'use client';

import { type GraphNode, type GraphEdge } from '@/components/atlas/GraphView';

export interface Provenance {
  sourceId: string; dtuId: string; title: string; author?: string;
  license?: string; gutenbergId?: string; url?: string;
}
export interface Hit {
  chunkId: string; dtuId: string; title: string; author?: string; era?: string;
  chapter?: number | null; kind?: string; heading?: string | null;
  snippet: string; score: number; provenance: Provenance;
}
export interface SearchPayload { ok: boolean; results: Hit[]; count: number; semantic: boolean }
export interface GraphPayload { ok: boolean; nodes: GraphNode[]; edges: GraphEdge[]; semantic: boolean }
export interface Stats { ok: boolean; sources: number; chunks: number; embedded: number }
export interface ResonanceEdge { dtuId: string; domain?: string; title?: string; score: number; kind?: string }
export interface ResonancePayload { ok: boolean; dtuId: string; edges: ResonanceEdge[] }
export interface AnnotationData { chunkId: string; note: string; title?: string; author?: string; citedDtuId?: string }
export interface ChunkNeighbor { chunkId: string; ord: number; heading?: string | null; preview: string }
export interface ChunkDetail {
  ok: boolean; reason?: string;
  chunk?: { chunkId: string; sourceId: string; dtuId: string; ord: number; heading?: string | null; content: string };
  neighbors?: ChunkNeighbor[];
}
export interface Crystal {
  chunkId: string; dtuId: string; heading?: string | null; title: string; author?: string;
  edgeCount: number; avgScore: number; salience: number;
}
export interface CrystallizePayload { ok: boolean; crystals: Crystal[] }

// ── Resonance-graph export (GraphML / CSV / JSON) — built from the live graph,
// never fabricated. GraphML is the standard force-graph interchange (Gephi/yEd).
// @env-config-ok — the graphml.graphdrawing.org/xmlns string below is an XML
// namespace URI (GraphML spec boilerplate), never fetched over the network.
export function graphToGraphML(nodes: GraphNode[], edges: GraphEdge[]): string {
  const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
  const n = nodes.map((x) => `    <node id="${esc(x.id)}"><data key="label">${esc(x.label)}</data><data key="group">${esc(x.group)}</data></node>`).join('\n');
  const e = edges.map((x, i) => `    <edge id="e${i}" source="${esc(x.source)}" target="${esc(x.target)}"><data key="kind">${esc((x as { kind?: string }).kind || 'edge')}</data></edge>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="label" for="node" attr.name="label" attr.type="string"/>
  <key id="group" for="node" attr.name="group" attr.type="string"/>
  <key id="kind" for="edge" attr.name="kind" attr.type="string"/>
  <graph edgedefault="undirected">
${n}
${e}
  </graph>
</graphml>`;
}

export function graphToCSV(edges: GraphEdge[]): string {
  const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = edges.map((x) => [esc(x.source), esc(x.target), esc((x as { kind?: string }).kind || 'edge')].join(','));
  return ['source,target,kind', ...rows].join('\n');
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}


export type { GraphNode, GraphEdge };
