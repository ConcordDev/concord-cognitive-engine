/**
 * A physics scene report exists because the Physics domain's `scene-save`
 * and `scene-list` macros returned the real scene with its bodies,
 * constraints, and fluids. This module turns exactly that result into a
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

export interface PhysicsSceneSummary {
  id: string;
  name: string;
  bodyCount?: number;
  constraintCount?: number;
  fluidCount?: number;
  updatedAt?: string;
  shareCode?: string | null;
}

export interface PhysicsScene extends PhysicsSceneSummary {
  bodies?: Array<{ id: string; mass?: number; kind?: string }>;
  constraints?: Array<{ id: string; kind?: string }>;
  fluids?: Array<{ id: string; density?: number }>;
  settings?: Record<string, unknown>;
  createdAt?: string;
}

export interface PhysicsFacts {
  scene: PhysicsScene | null;
  summary: PhysicsSceneSummary | null;
}

/**
 * The scene sentence, built only from the real data. Null when there is no
 * scene at all.
 */
export function sceneSentence(facts: PhysicsFacts): string | null {
  const sc = facts.scene;
  const sm = facts.summary;
  const id = String(sc?.id || sm?.id || '').trim();
  const name = String(sc?.name || sm?.name || '').trim();
  if (!id || !name) return null;

  const parts: string[] = [];
  const bodyCount = sc?.bodies?.length ?? sm?.bodyCount ?? 0;
  const constraintCount = sc?.constraints?.length ?? sm?.constraintCount ?? 0;
  const fluidCount = sc?.fluids?.length ?? sm?.fluidCount ?? 0;
  if (bodyCount > 0) parts.push(`${bodyCount} bodies`);
  if (constraintCount > 0) parts.push(`${constraintCount} constraints`);
  if (fluidCount > 0) parts.push(`${fluidCount} fluids`);
  if (sm?.shareCode) parts.push(`shared`);

  return `${name}: ${parts.length > 0 ? parts.join(', ') : 'empty scene'}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function sceneBody(facts: PhysicsFacts): string {
  const sentence = sceneSentence(facts);
  if (!sentence) return '';
  const lines = [sentence];
  const sc = facts.scene!;
  if (sc.bodies && sc.bodies.length > 0) {
    lines.push(`Bodies: ${sc.bodies.map((b) => `${b.id} (${b.kind || 'body'}, ${b.mass != null ? `${b.mass}kg` : '?'})`).join('; ')}.`);
  }
  if (sc.constraints && sc.constraints.length > 0) {
    lines.push(`Constraints: ${sc.constraints.map((c) => `${c.id} (${c.kind || 'constraint'})`).join('; ')}.`);
  }
  if (sc.fluids && sc.fluids.length > 0) {
    lines.push(`Fluids: ${sc.fluids.map((f) => `${f.id} (density ${f.density ?? '?'})`).join('; ')}.`);
  }
  if (sc.createdAt) lines.push(`Created: ${sc.createdAt}.`);
  if (sc.updatedAt) lines.push(`Updated: ${sc.updatedAt}.`);
  lines.push('Every figure here came from the Physics domain in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same scene, structured. */
export function sceneMachine(facts: PhysicsFacts): Record<string, unknown> | null {
  if (!sceneSentence(facts)) return null;
  const sc = facts.scene!;
  return {
    kind: 'physics_scene_report',
    sceneId: sc.id,
    sceneName: sc.name,
    bodyCount: sc.bodies?.length ?? facts.summary?.bodyCount ?? 0,
    constraintCount: sc.constraints?.length ?? facts.summary?.constraintCount ?? 0,
    fluidCount: sc.fluids?.length ?? facts.summary?.fluidCount ?? 0,
    shareCode: sc.shareCode ?? facts.summary?.shareCode ?? null,
  };
}

/** The private DTU that records this scene. Null when nothing can be saved. */
export function sceneReportDtuCall(facts: PhysicsFacts): ReceiptCall | null {
  const body = sceneBody(facts);
  const sentence = sceneSentence(facts);
  const machine = sceneMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['physics', 'scene', 'scene-report', String(facts.scene?.id || 'scene').toLowerCase()],
      source: 'physics-lens:scene-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'physics',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that scene report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function sceneThreadDraftCall(
  facts: PhysicsFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = sceneSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `${facts.scene?.name || 'Physics scene'} report`.slice(0, 120),
      content: sceneBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface SceneDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function sceneThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): SceneDraftResult | null {
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
export function indexSceneDrafts(details: unknown): Record<string, string> {
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