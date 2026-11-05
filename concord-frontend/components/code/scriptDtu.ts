/**
 * The DTU a Scratch save promises (F8, narrowed on R3's re-review).
 *
 * The Save control's own title reads "Save script (persists to your
 * library as a DTU)". The artifact half of that promise has always been
 * kept — lens.create stores the script in the lens, indexed and listed.
 * The DTU half was not: the only DTU a save produced was the generic
 * lens-exhaust shadow ("Lens:code create script", an envelope describing
 * the create ACTION), which is the platform's audit record, not the
 * member's script. No content-bearing DTU for the script ever existed.
 *
 * This module composes the canonical dtu.create / dtu.update calls for
 * the script itself — the same macro path CodeRunMenu already uses for
 * its run-report DTU (codeRunReport.ts), with the same read-back-confirm
 * discipline (walletReceipt's helpers) before the surface may claim the
 * DTU exists. The script's full source is the DTU's content: "listed and
 * intact" is the done-state, so nothing here truncates it.
 */
import type { ReceiptCall } from '@/components/wallet/walletReceipt';

export interface ScriptDtuFacts {
  name: string;
  language: string;
  scriptType: string;
  /** The script's full source. */
  content: string;
  /** The lens artifact this save just created, when known. */
  artifactId?: string;
}

export function scriptDtuSummary(facts: ScriptDtuFacts): string {
  const lang = String(facts.language || '').trim() || 'plain text';
  return `${facts.name} — a ${lang} script saved from the Code lens.`;
}

export function scriptDtuTags(facts: ScriptDtuFacts): string[] {
  const tags = ['code', 'script', String(facts.scriptType || '').toLowerCase(), String(facts.language || '').toLowerCase()]
    .map((t) => t.trim())
    .filter(Boolean);
  return [...new Set(tags)];
}

/** The create call for the script's own DTU. Null when there is no name to title it. */
export function scriptDtuCreateCall(facts: ScriptDtuFacts): ReceiptCall | null {
  const name = String(facts.name || '').trim();
  if (!name) return null;
  const summary = scriptDtuSummary(facts);
  const lines = String(facts.content || '').split('\n').length;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: name,
      tags: scriptDtuTags(facts),
      source: 'code-lens:scratch-save',
      content: String(facts.content || ''),
      human: { summary },
      core: {
        definitions: [summary],
        claims: [`${name} is a ${String(facts.language || 'plain text')} script (${lines} line${lines === 1 ? '' : 's'}) saved from the Code lens Scratch workspace.`],
      },
      machine: {
        kind: 'code_script',
        name,
        language: String(facts.language || ''),
        scriptType: String(facts.scriptType || ''),
        artifactId: facts.artifactId || null,
      },
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'code',
        code: {
          name,
          language: String(facts.language || ''),
          scriptType: String(facts.scriptType || ''),
        },
      },
    },
  };
}

/** The update call for a re-save: same DTU, new source. Null without a DTU id or a name. */
export function scriptDtuUpdateCall(facts: ScriptDtuFacts & { dtuId: string }): ReceiptCall | null {
  const name = String(facts.name || '').trim();
  const id = String(facts.dtuId || '').trim();
  if (!name || !id) return null;
  return {
    domain: 'dtu',
    action: 'update',
    input: {
      id,
      title: name,
      content: String(facts.content || ''),
      summary: scriptDtuSummary(facts),
      tags: scriptDtuTags(facts),
    },
  };
}

/** The created artifact's id out of a lens create response, however it is enveloped. */
export function savedArtifactId(res: unknown): string {
  const r = res as { artifact?: { id?: unknown }; data?: { artifact?: { id?: unknown } }; id?: unknown } | null;
  const id = r?.artifact?.id ?? r?.data?.artifact?.id ?? r?.id ?? '';
  return typeof id === 'string' ? id : String(id || '');
}

/** True when a lensRun envelope reports refusal at either envelope level. */
export function dtuRunRefused(res: unknown): boolean {
  const r = res as { ok?: unknown; data?: { ok?: unknown } } | null;
  return r?.ok === false || r?.data?.ok === false;
}
