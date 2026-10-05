/**
 * A world share-link report exists because the World domain's
 * `share-link-create` macro returned a real deep link to a Concordia
 * world position — worldId, coordinates, note, and a real URL. This
 * module turns exactly that result into a sentence, saves it as a private
 * DTU, reads that DTU back, and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface WorldShareLink {
  id?: string;
  worldId?: string;
  x?: number | null;
  y?: number | null;
  z?: number | null;
  note?: string;
  url?: string;
  createdBy?: string;
  createdAt?: string;
}

export interface WorldShareFacts {
  link: WorldShareLink | null;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function coord(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}

/**
 * The share-link report sentence, built only from the real detail. Null
 * when there is no link, no id, or no worldId.
 */
export function shareSentence(facts: WorldShareFacts): string | null {
  const l = facts.link;
  if (!l || !l.id || !l.worldId) return null;
  const pos = (l.x != null || l.y != null || l.z != null)
    ? ` @ (${coord(l.x)}, ${coord(l.y)}, ${coord(l.z)})`
    : '';
  return `Concordia share link for ${str(l.worldId, 40)}${pos}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function shareBody(facts: WorldShareFacts): string {
  const sentence = shareSentence(facts);
  const l = facts.link;
  if (!sentence || !l) return '';
  const lines = [sentence, ''];
  lines.push(`Link ID: ${l.id || '-'}`);
  lines.push(`World: ${str(l.worldId, 60)}`);
  if (l.x != null) lines.push(`X: ${coord(l.x)}`);
  if (l.y != null) lines.push(`Y: ${coord(l.y)}`);
  if (l.z != null) lines.push(`Z: ${coord(l.z)}`);
  if (l.note) lines.push(`Note: ${str(l.note, 200)}`);
  if (l.url) lines.push(`URL: ${str(l.url, 300)}`);
  if (l.createdBy) lines.push(`Created by: ${str(l.createdBy, 40)}`);
  if (l.createdAt) lines.push(`Created: ${str(l.createdAt, 30)}`);
  lines.push('');
  lines.push('Every figure here came from the World domain share-link-create macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same link the macro returned, structured. */
export function shareMachine(facts: WorldShareFacts): Record<string, unknown> | null {
  const l = facts.link;
  if (!shareSentence(facts) || !l) return null;
  return {
    kind: 'world_lens_share_link_report',
    linkId: l.id || null,
    worldId: l.worldId || null,
    x: l.x ?? null,
    y: l.y ?? null,
    z: l.z ?? null,
    note: l.note || null,
    url: l.url || null,
    createdAt: l.createdAt || null,
  };
}

/** The private DTU that records this link. Null when nothing can be saved. */
export function shareDtuCall(facts: WorldShareFacts): ReceiptCall | null {
  const body = shareBody(facts);
  const sentence = shareSentence(facts);
  const machine = shareMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['world', 'concordia', 'share-link'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'world-lens:share-link-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'world',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that share-link report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function shareThreadDraftCall(
  facts: WorldShareFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = shareSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const l = facts.link!;
  const world = str(l.worldId, 30) || 'world';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Concordia share — ${world}`.slice(0, 120),
      content: shareBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface ShareDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function shareThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): ShareDraftResult | null {
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
export function indexShareDrafts(details: unknown): Record<string, string> {
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

// Silence unused-import lint for num (kept for future numeric fields).
void num;