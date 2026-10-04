/**
 * A code run report exists because the Code domain's `code.exec` macro
 * actually executed the script and returned its stdout/stderr/exitCode
 * (or an honest "supported:false" refusal for languages the sandbox does
 * not run). This module turns exactly that result into a sentence, saves
 * it as a private DTU, reads that DTU back, and hands it to Thread as a
 * draft.
 *
 * Every figure below comes from a macro response. A figure the backend
 * did not return is reported as missing, never invented. Nothing here
 * publishes anything: a Thread draft is a draft until the user posts it
 * themselves.
 *
 * No fake fallback. When `code.exec` returns `supported:false` the
 * sentence says the sandbox does not run that language, and there is no
 * DTU to save — the screen then refuses instead of inventing an output.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

/** The shape `code.exec` returns. */
export interface CodeExecResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  supported?: boolean;
  returnValue?: unknown;
  images?: unknown[];
}

export interface RunFacts {
  /** The file name the run came from. */
  name: string;
  /** The language the script was run as. */
  language: string;
  /** The script type (snippet / project / pipeline / notebook / algorithm / library). */
  scriptType: string;
  /** The source code that was executed. */
  code: string;
  /** The real `code.exec` result. Null when the macro refused or errored. */
  result: CodeExecResult | null;
  /** Wall-clock ms the run took, if the caller measured it. */
  elapsedMs?: number;
}

/**
 * The run sentence, built only from the real result. Null when there is
 * no result at all — the screen then refuses instead of inventing output.
 *
 * `supported:false` is reported as a refusal, not a success: the sandbox
 * does not run that language, so there is no output to claim.
 */
export function runSentence(facts: RunFacts): string | null {
  const name = String(facts.name || '').trim();
  if (!name) return null;
  const result = facts.result;
  if (!result) return null;

  if (result.supported === false) {
    const lang = String(facts.language || 'this language').trim();
    const reason = String(result.stderr || '').trim();
    return `${name}: the sandbox does not run ${lang}.${reason ? ` ${reason}` : ''}`;
  }

  const exit = Number.isFinite(result.exitCode) ? Number(result.exitCode) : null;
  const status = exit === 0 ? 'Ran' : exit != null ? `Exited ${exit}` : 'Ran';
  const lang = String(facts.language || '').trim();
  const langPart = lang ? ` (${lang})` : '';
  const elapsed = Number(facts.elapsedMs);
  const elapsedPart = Number.isFinite(elapsed) && elapsed > 0 ? ` in ${Math.round(elapsed)}ms` : '';
  const outLen = String(result.stdout || '').length;
  const errLen = String(result.stderr || '').length;
  const parts: string[] = [];
  if (outLen > 0) parts.push(`${outLen} byte${outLen === 1 ? '' : 's'} of output`);
  if (errLen > 0) parts.push(`${errLen} byte${errLen === 1 ? '' : 's'} of stderr`);
  const detail = parts.length > 0 ? ` — ${parts.join(', ')}` : ' — no output';
  return `${name}: ${status}${langPart}${elapsedPart}${detail}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function runBody(facts: RunFacts): string {
  const sentence = runSentence(facts);
  if (!sentence) return '';
  const lines = [sentence];
  const result = facts.result;
  if (!result) return '';
  if (result.supported === false) {
    lines.push(`The sandbox does not run ${facts.language}. No code was executed.`);
    lines.push('Nothing was published by saving this.');
    return lines.join('\n');
  }
  const stdout = String(result.stdout || '').trim();
  const stderr = String(result.stderr || '').trim();
  if (stdout) {
    const capped = stdout.length > 4000 ? `${stdout.slice(0, 4000)}…[truncated]` : stdout;
    lines.push(`stdout:\n${capped}`);
  }
  if (stderr) {
    const capped = stderr.length > 2000 ? `${stderr.slice(0, 2000)}…[truncated]` : stderr;
    lines.push(`stderr:\n${capped}`);
  }
  if (Number.isFinite(result.exitCode)) {
    lines.push(`exit code: ${Number(result.exitCode)}`);
  }
  lines.push('Every figure here came from the Code sandbox in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same run result, structured. */
export function runMachine(facts: RunFacts): Record<string, unknown> | null {
  const sentence = runSentence(facts);
  if (!sentence) return null;
  const result = facts.result;
  if (!result) return null;
  return {
    kind: 'code_run_report',
    name: String(facts.name || ''),
    language: String(facts.language || ''),
    scriptType: String(facts.scriptType || ''),
    supported: result.supported !== false,
    exitCode: Number.isFinite(result.exitCode) ? Number(result.exitCode) : null,
    stdoutBytes: String(result.stdout || '').length,
    stderrBytes: String(result.stderr || '').length,
    // Truncate code + stdout in the machine payload too — a DTU is a
    // record, not a backup. 8KB each keeps the run reproducible without
    // bloating the store.
    code: String(facts.code || '').slice(0, 8000),
    stdout: String(result.stdout || '').slice(0, 8000),
    stderr: String(result.stderr || '').slice(0, 2000),
    elapsedMs: Number.isFinite(facts.elapsedMs) ? Number(facts.elapsedMs) : null,
  };
}

/** The private DTU that records this run. Null when nothing can be saved. */
export function runReportDtuCall(facts: RunFacts): ReceiptCall | null {
  const body = runBody(facts);
  const sentence = runSentence(facts);
  const machine = runMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['code', 'run-report', String(facts.scriptType || 'script').toLowerCase(), String(facts.language || '').toLowerCase()].filter(Boolean),
      source: 'code-lens:run-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'code',
        code: {
          name: String(facts.name || ''),
          language: String(facts.language || ''),
          scriptType: String(facts.scriptType || ''),
          supported: facts.result?.supported !== false,
          exitCode: Number.isFinite(facts.result?.exitCode) ? Number(facts.result?.exitCode) : null,
        },
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that run report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function runThreadDraftCall(
  facts: RunFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = runSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: String(facts.name || 'Code run').slice(0, 120),
      content: runBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface RunDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function runThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): RunDraftResult | null {
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
 * shows the same "Drafted in Thread" the send reported. `details` is what
 * `draft-detail` returned for each draft — the list endpoint omits the
 * cite, so it has to be read back per draft.
 */
export function indexRunDrafts(details: unknown): Record<string, string> {
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