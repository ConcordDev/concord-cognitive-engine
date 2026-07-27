/**
 * TheVault — curator-side transport, types, and the admission rubric.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS CALLS `api.post('/api/lens/run')` RATHER THAN `lensRun()`
 * ───────────────────────────────────────────────────────────────────────────
 * Measured, not assumed. `lensRun()` in `lib/api/client.ts` unwraps the route
 * envelope and then hits its terminal branch:
 *
 *     if (node && typeof node === 'object' && node.ok === false) {
 *       return { data: { ok:false, result:null, error: String(node.error || err || 'lens error') } };
 *     }
 *
 * Every refusal `server/domains/vault.js` returns is shaped
 * `{ ok:false, reason:'…' }` — it carries a `reason`, never an `error`. So the
 * whole honest-refusal vocabulary the Vault backend was deliberately built
 * around collapses into the single literal string `'lens error'` on the way
 * through that helper:
 *
 *     not_a_curator · curator_retired · curator_statement_required
 *     curator_statement_too_short · curator_statement_is_machine_evidence
 *     decline_reason_required · wrong_state · admitted_records_are_permanent
 *
 * A curator whose statement was refused for reproducing machine evidence and a
 * visitor who simply is not a curator would receive identical, meaningless
 * copy. That is the opposite of honest-by-construction, and it would silently
 * hide the single invariant this surface exists to make visible.
 *
 * `api` is the exact axios instance `lensRun` itself posts through, and the
 * route (`server/server.js#app.post('/api/lens/run')`) always answers
 * `res.json({ ok:true, result })` with the handler's own object at `result` —
 * so reading `res.data.result` preserves the reason verbatim. Nothing else
 * about the transport differs.
 */

import { api } from '@/lib/api/client';

/* ═══════════════════════════════════════════════════════════════════════
   TRANSPORT
   ═══════════════════════════════════════════════════════════════════════ */

export interface VaultRunResult<T> {
  /** True only when the macro itself reported success. */
  ok: boolean;
  /** The macro's own payload, or null on any refusal / transport failure. */
  result: T | null;
  /**
   * The backend's own refusal code, verbatim — or a transport code prefixed
   * `transport_` so the two can never be confused for one another.
   */
  reason: string | null;
  /** Free-text detail the backend attached (`detail` on several refusals). */
  detail: string | null;
}

/** Every macro name registered by `registerVaultActions` that this unit calls. */
export type VaultCuratorAction =
  | 'queue'
  | 'open_review'
  | 'admit'
  | 'decline'
  | 'curators'
  | 'record';

interface RawEnvelope {
  ok?: boolean;
  reason?: unknown;
  detail?: unknown;
}

/**
 * Call one `vault.*` macro. Never throws: a transport failure is returned as a
 * refusal with a `transport_*` reason so callers have exactly one shape to
 * render.
 */
export async function runVaultMacro<T = Record<string, unknown>>(
  action: VaultCuratorAction,
  input: Record<string, unknown> = {},
): Promise<VaultRunResult<T>> {
  try {
    const res = await api.post('/api/lens/run', { domain: 'vault', action, input });
    const payload = (res?.data as { result?: unknown } | undefined)?.result;
    if (!payload || typeof payload !== 'object') {
      return { ok: false, result: null, reason: 'transport_unexpected_shape', detail: null };
    }
    const env = payload as RawEnvelope;
    if (env.ok === false) {
      return {
        ok: false,
        result: null,
        reason: typeof env.reason === 'string' ? env.reason : 'transport_unexpected_shape',
        detail: typeof env.detail === 'string' ? env.detail : null,
      };
    }
    return { ok: true, result: payload as T, reason: null, detail: null };
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 401) return { ok: false, result: null, reason: 'transport_auth_required', detail: null };
    if (status === 403) return { ok: false, result: null, reason: 'transport_forbidden', detail: null };
    return {
      ok: false,
      result: null,
      reason: 'transport_unreachable',
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   SHAPES — transcribed from `server/domains/vault.js`, not guessed
   ═══════════════════════════════════════════════════════════════════════ */

/** One row of `curatorQueue()`'s `submissions` array. Field-for-field. */
export interface VaultQueueSubmission {
  id: string;
  title: string;
  workKind: string;
  description: string;
  submitterId: string;
  status: 'submitted' | 'under_review' | 'admitted' | 'declined' | 'withdrawn';
  submittedAt: number | null;
  reviewOpenedBy: string | null;
  lineage: string[];
  curatorStatement: string | null;
  admittedBy: string | null;
  admittedByRole: string | null;
  /** Own column, never part of the admission CHECK. See MachineEvidencePanel. */
  machineEvidence: unknown;
  declinedBy: string | null;
  declineReason: string | null;
  declinedAt: number | null;
  recordDtuId: string | null;
  protectionFlags: unknown;
}

export interface VaultQueueResult {
  ok: true;
  count: number;
  submissions: VaultQueueSubmission[];
}

/** `listCurators()` rows — raw SQL column names, as the macro returns them. */
export interface VaultCuratorRow {
  curator_id: string;
  display_name: string;
  role: 'founding_curator' | 'guest_curator';
  invited_by: string | null;
  invited_at: number | null;
  active: number;
  retired_at: number | null;
}

export interface VaultCuratorsResult { ok: true; curators: VaultCuratorRow[] }

/** One entry of `admit()`'s `citations` array (from `citeLineage`). */
export interface VaultCitation {
  ok: boolean;
  parentId: string;
  lineageId?: string;
  error?: string;
}

/** `applyAdmissionProtection()`'s return. `applied:false` is the honest default. */
export interface VaultProtection {
  applied: boolean;
  reason?: string;
  detail?: string;
  flags?: unknown;
}

/** `admit()`'s success payload. */
export interface VaultAdmission {
  ok: true;
  id: string;
  status: 'admitted';
  recordDtuId: string;
  admittedBy: string;
  admittedByRole: 'founding_curator' | 'guest_curator';
  curatorDisplayName: string;
  curatorStatement: string;
  machineEvidenceStored: boolean;
  citations: VaultCitation[];
  protection: VaultProtection;
}

/** `publicRecord()`'s `record` — the only read that carries `admittedAt`. */
export interface VaultPublicRecord {
  id: string;
  title: string;
  workKind: string;
  description: string;
  submitterId: string;
  admittedAt: number | null;
  curatorId: string;
  curatorRole: string;
  curatorStatement: string;
  recordDtuId: string;
  lineage: string[];
  status: 'admitted';
}

/* ═══════════════════════════════════════════════════════════════════════
   THE STATEMENT RULES — mirrored from the backend, which stays the authority
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Mirror of `MIN_CURATOR_STATEMENT_CHARS` in `server/domains/vault.js`.
 * The backend is the enforcer; this exists only so the composer can show a
 * curator the floor while they write instead of after they submit.
 */
export const MIN_CURATOR_STATEMENT_CHARS = 20;

/** Mirror of `normalizeForCompare` in `server/domains/vault.js`. */
const normalizeForCompare = (s: unknown) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Mirror of `collectStrings` in `server/domains/vault.js` (same bounds). */
function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 2000) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { for (const v of value) collectStrings(v, out, depth + 1); return out; }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out, depth + 1);
  }
  return out;
}

/**
 * Client mirror of `statementIsMachineEvidence` in `server/domains/vault.js`,
 * algorithm-for-algorithm (case/whitespace-insensitive, substring in EITHER
 * direction, ignoring shared fragments under 12 chars as coincidence).
 *
 * It is a COURTESY, not a gate. The backend refuses the admission regardless;
 * this only lets the composer say so while the curator is still writing,
 * rather than making them discover it by being rejected. If the two ever
 * disagree, the backend is right by definition.
 */
export function statementEchoesMachineEvidence(machineEvidence: unknown, statement: string): boolean {
  const s = normalizeForCompare(statement);
  if (!s) return false;
  for (const raw of collectStrings(machineEvidence)) {
    const e = normalizeForCompare(raw);
    if (e.length < 12) continue;
    if (e.includes(s) || s.includes(e)) return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════
   REFUSAL COPY — one line per real backend reason code
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Every key below is a literal string `server/domains/vault.js` can return
 * (plus the four `transport_*` codes this file introduces). Nothing is
 * invented: an unmapped code falls through to the raw code itself so a new
 * backend refusal surfaces honestly rather than silently as "something went
 * wrong".
 */
export const VAULT_REFUSAL_COPY: Record<string, string> = {
  not_a_curator: 'You are not a curator of TheVault. The review queue is curator-scoped by construction — there is no public view of work under consideration.',
  curator_retired: 'This curator account has been retired. Past admissions keep their attribution permanently; new ones cannot be made.',
  curator_required: 'No acting curator could be resolved for this request.',
  curator_statement_required: 'An admission needs a written statement. TheVault does not record a yes it cannot explain.',
  curator_statement_too_short: `The statement is shorter than the ${MIN_CURATOR_STATEMENT_CHARS}-character floor. The floor is deliberately low — it rejects a placeholder, not a terse curator.`,
  curator_statement_is_machine_evidence: 'This statement reproduces text from the machine-assembled evidence. The archive refuses it: assembled evidence can inform a judgment, it can never be one.',
  decline_reason_required: 'A decline is recorded with a reason or not at all.',
  wrong_state: 'This submission is no longer awaiting judgment.',
  not_found: 'This submission no longer exists.',
  admitted_records_are_permanent: 'Admitted records are permanent. That is the whole promise of the archive.',
  record_mint_failed: 'The record could not be written, so the admission was rolled back whole. Nothing was admitted.',
  no_db: 'The archive store is unavailable.',
  no_actor: 'You are signed out.',
  invalid_status_filter: 'That is not a status the queue recognises.',
  queue_failed: 'The queue could not be read.',
  handler_error: 'The archive refused the request.',
  transport_auth_required: 'You are signed out. Sign in as a curator to open the review queue.',
  transport_forbidden: 'This account may not reach the curator queue.',
  transport_unreachable: 'The archive could not be reached.',
  transport_unexpected_shape: 'The archive answered in a shape this surface does not recognise.',
};

/** Human copy for a refusal code, falling back to the code itself. */
export function refusalCopy(reason: string | null | undefined): string {
  if (!reason) return 'The archive refused the request.';
  return VAULT_REFUSAL_COPY[reason] ?? reason;
}

/* ═══════════════════════════════════════════════════════════════════════
   THE SIX-AXIS RUBRIC — verbatim from docs/THEVAULT_SPEC.md §5
   ═══════════════════════════════════════════════════════════════════════ */

export interface AdmissionAxis {
  id: string;
  name: string;
  /** The question, as written in the brief. */
  question: string;
  /** Documentation alone may veto. It is a gate, not a score. */
  gate?: true;
  /** The brief's own caveat, where it has one. */
  caveat?: string;
}

export const ADMISSION_AXES: readonly AdmissionAxis[] = [
  { id: 'originality', name: 'Originality', question: 'Did this contribute something new?' },
  { id: 'craft', name: 'Craft', question: 'Is there clear evidence of skill?' },
  {
    id: 'influence',
    name: 'Influence',
    question: 'Has this impacted people — even a small community?',
    caveat: 'Not popularity. A work that changed the practice of forty people stands higher here than one with large passive reach and no traceable effect.',
  },
  { id: 'cultural_relevance', name: 'Cultural relevance', question: 'Does it document an important story?' },
  { id: 'longevity', name: 'Longevity potential', question: 'Will this still matter in years?' },
  {
    id: 'documentation',
    name: 'Documentation',
    question: 'Can we explain why it belongs?',
    gate: true,
    caveat: 'A gate, not a score. If we cannot explain it, it is not admitted — however well it reads on the other five.',
  },
] as const;

/* ═══════════════════════════════════════════════════════════════════════
   SMALL FORMATTERS
   ═══════════════════════════════════════════════════════════════════════ */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Unix seconds → "12 March 2026", built from UTC parts rather than
 * `toLocaleDateString` so it renders identically in every environment.
 * Returns null for a missing/invalid timestamp — callers render nothing.
 */
export function formatVaultDate(unixSeconds: number | null | undefined): string | null {
  if (typeof unixSeconds !== 'number' || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return null;
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `work_kind` enum → the label a wall text would use. */
export const WORK_KIND_LABEL: Record<string, string> = {
  writing: 'Writing',
  music: 'Music',
  visual: 'Visual',
  moving_image: 'Moving image',
  code: 'Code',
  performance: 'Performance',
  other: 'Other',
};

/** `admitted_by_role` / curator `role` → the label the record carries. */
export const CURATOR_ROLE_LABEL: Record<string, string> = {
  founding_curator: 'Founding curator',
  guest_curator: 'Guest curator',
};
