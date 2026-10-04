/**
 * A graph map report exists because the Graph domain's `map-detail` and
 * `map-metrics` macros returned the real map with its nodes, edges, and
 * computed degree metrics. This module turns exactly that result into a
 * sentence, saves it as a private DTU, reads that DTU back, and hands it
 * to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend did
 * not return is reported as missing, never invented. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it themselves.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface GraphNode {
  id: string;
  label: string;
  notes?: string;
  central?: boolean;
  parentId?: string;
  dtuId?: string;
  tags?: string[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface GraphMap {
  id: string;
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  createdAt?: string;
}

export interface GraphMetrics {
  nodeCount: number;
  edgeCount: number;
  avgDegree: number;
  mostConnected: { label: string; degree: number } | null;
  isolatedNodes: number;
}

export interface GraphFacts {
  map: GraphMap | null;
  metrics: GraphMetrics | null;
}

/**
 * The map sentence, built only from the real detail + metrics. Null when
 * there is no map at all — the screen refuses instead of inventing.
 */
export function mapSentence(facts: GraphFacts): string | null {
  const m = facts.map;
  const id = String(m?.id || '').trim();
  const title = String(m?.title || '').trim();
  if (!id || !title) return null;

  const parts: string[] = [];
  const met = facts.metrics;
  if (met) {
    parts.push(`${met.nodeCount} nodes`);
    parts.push(`${met.edgeCount} edges`);
    if (Number.isFinite(met.avgDegree) && met.avgDegree > 0) {
      parts.push(`avg degree ${Math.round(met.avgDegree * 10) / 10}`);
    }
    if (met.mostConnected) {
      parts.push(`hub: ${met.mostConnected.label} (${met.mostConnected.degree})`);
    }
    if (met.isolatedNodes > 0) {
      parts.push(`${met.isolatedNodes} isolated`);
    }
  } else {
    parts.push(`${m?.nodes.length ?? 0} nodes`);
    parts.push(`${m?.edges.length ?? 0} edges`);
  }

  return `${title}: ${parts.join(', ')}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function mapBody(facts: GraphFacts): string {
  const sentence = mapSentence(facts);
  if (!sentence) return '';
  const lines = [sentence];
  const m = facts.map;
  if (m) {
    if (m.createdAt) lines.push(`Created: ${m.createdAt}.`);
    if (m.nodes.length > 0) {
      lines.push(`Nodes: ${m.nodes.map((n) => `${n.label}${n.central ? ' (central)' : ''}`).join('; ')}.`);
    }
    if (m.edges.length > 0) {
      lines.push(`Edges: ${m.edges.map((e) => {
        const from = m.nodes.find((n) => n.id === e.from)?.label || e.from;
        const to = m.nodes.find((n) => n.id === e.to)?.label || e.to;
        return `${from} → ${to}${e.label ? ` (${e.label})` : ''}`;
      }).join('; ')}.`);
    }
  }
  const met = facts.metrics;
  if (met && met.mostConnected) {
    lines.push(`Most connected: ${met.mostConnected.label} at degree ${met.mostConnected.degree}.`);
  }
  if (met && met.isolatedNodes > 0) {
    lines.push(`Isolated nodes: ${met.isolatedNodes}.`);
  }
  lines.push('Every figure here came from the Graph domain in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same map, structured. */
export function mapMachine(facts: GraphFacts): Record<string, unknown> | null {
  if (!mapSentence(facts)) return null;
  const m = facts.map;
  const met = facts.metrics;
  return {
    kind: 'graph_map_report',
    mapId: String(m?.id || ''),
    mapTitle: String(m?.title || ''),
    nodeCount: met?.nodeCount ?? m?.nodes.length ?? 0,
    edgeCount: met?.edgeCount ?? m?.edges.length ?? 0,
    avgDegree: Number.isFinite(met?.avgDegree) ? Number(met?.avgDegree) : 0,
    mostConnected: met?.mostConnected ?? null,
    isolatedNodes: met?.isolatedNodes ?? 0,
  };
}

/** The private DTU that records this map. Null when nothing can be saved. */
export function mapReportDtuCall(facts: GraphFacts): ReceiptCall | null {
  const body = mapBody(facts);
  const sentence = mapSentence(facts);
  const machine = mapMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['graph', 'map-report', String(facts.map?.id || 'map').toLowerCase()],
      source: 'graph-lens:map-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'graph',
        graph: {
          mapId: String(facts.map?.id || ''),
          mapTitle: String(facts.map?.title || ''),
        },
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that map report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function mapThreadDraftCall(
  facts: GraphFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = mapSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: String(facts.map?.title || 'Graph map').slice(0, 120),
      content: mapBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface MapDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function mapThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): MapDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

/**
 * Index the drafts Thread already holds by the DTU they cite, so a reload
 * shows the same "Drafted in Thread" the send reported.
 */
export function indexMapDrafts(details: unknown): Record<string, string> {
  const list = Array.isArray(details) ? details : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const envelope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!envelope || envelope.ok === false) continue;
    const result = envelope.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : envelope;
    const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
    if (!draft) continue;
    const draftId = String(draft.id || '').trim();
    const cited = String(draft.citedDtuId || '').trim();
    if (!draftId || !cited || out[cited]) continue;
    out[cited] = draftId;
  }
  return out;
}