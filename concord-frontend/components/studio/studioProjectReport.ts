/**
 * A studio project report exists because the Studio domain's
 * `project-create` + `track-add` + `project-get` macros returned a real
 * project with a real name, bpm, time signature, and tracks. This module
 * turns exactly that result into a sentence, saves it as a private DTU,
 * reads that DTU back, and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend
 * did not return is reported as missing, never invented. Nothing here
 * publishes anything: a Thread draft is a draft until the user posts it.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface StudioTrack {
  id?: string;
  name?: string;
  kind?: string;
  volume?: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
}

export interface StudioProject {
  id?: string;
  name?: string;
  bpm?: number;
  timeSignature?: string;
  masterVolume?: number;
  tracks?: StudioTrack[];
  createdAt?: string;
  updatedAt?: string;
}

export interface StudioProjectFacts {
  project: StudioProject | null;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The project report sentence, built only from the real detail. Null when
 * there is no project, no id/name, or no bpm.
 */
export function projectSentence(facts: StudioProjectFacts): string | null {
  const p = facts.project;
  if (!p || !p.id || !p.name) return null;
  const bpm = num(p.bpm);
  if (bpm <= 0) return null;
  const tracks = Array.isArray(p.tracks) ? p.tracks.length : 0;
  const sig = str(p.timeSignature, 10) || '4/4';
  return `${str(p.name, 60)}: ${bpm} bpm, ${sig}, ${tracks} track${tracks === 1 ? '' : 's'}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function projectBody(facts: StudioProjectFacts): string {
  const sentence = projectSentence(facts);
  const p = facts.project;
  if (!sentence || !p) return '';
  const lines = [sentence, ''];
  lines.push(`Project ID: ${p.id || '-'}`);
  lines.push(`Name: ${p.name || '-'}`);
  lines.push(`BPM: ${num(p.bpm)}`);
  if (p.timeSignature) lines.push(`Time signature: ${str(p.timeSignature, 10)}`);
  if (p.masterVolume != null) lines.push(`Master volume: ${num(p.masterVolume)}`);
  if (p.createdAt) lines.push(`Created: ${str(p.createdAt, 30)}`);
  if (p.updatedAt) lines.push(`Updated: ${str(p.updatedAt, 30)}`);
  if (Array.isArray(p.tracks) && p.tracks.length > 0) {
    lines.push('');
    lines.push(`Tracks (${p.tracks.length}):`);
    for (const t of p.tracks.slice(0, 50)) {
      const kind = str(t.kind, 12) || 'audio';
      const name = str(t.name, 60) || 'Untitled';
      const vol = num(t.volume).toFixed(2);
      const mute = t.muted ? ' [muted]' : '';
      lines.push(`  - ${kind}: ${name} (vol ${vol}${mute})`);
    }
  }
  lines.push('');
  lines.push('Every figure here came from the Studio domain project-get macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same project the macro returned, structured. */
export function projectMachine(facts: StudioProjectFacts): Record<string, unknown> | null {
  const p = facts.project;
  if (!projectSentence(facts) || !p) return null;
  return {
    kind: 'studio_lens_project_report',
    projectId: p.id || null,
    name: p.name || null,
    bpm: num(p.bpm),
    timeSignature: p.timeSignature || null,
    masterVolume: num(p.masterVolume),
    trackCount: Array.isArray(p.tracks) ? p.tracks.length : 0,
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null,
  };
}

/** The private DTU that records this project. Null when nothing can be saved. */
export function projectDtuCall(facts: StudioProjectFacts): ReceiptCall | null {
  const body = projectBody(facts);
  const sentence = projectSentence(facts);
  const machine = projectMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['studio', 'daw', 'music', 'project'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'studio-lens:project-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'studio',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that project report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function projectThreadDraftCall(
  facts: StudioProjectFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = projectSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const p = facts.project!;
  const name = str(p.name, 40) || 'project';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Studio project — ${name}`.slice(0, 120),
      content: projectBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface ProjectDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function projectThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): ProjectDraftResult | null {
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
export function indexProjectDrafts(details: unknown): Record<string, string> {
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