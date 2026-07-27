/**
 * TheVault — the shapes the backend genuinely returns.
 *
 * Every field below was read off `server/domains/vault.js`, not guessed:
 *   · `VaultRecordShape` mirrors `publicShape()` (the row shape returned by
 *     BOTH `vault.browse` → `records[]` and `vault.record` → `record`).
 *   · `VaultCuratorShape` mirrors the column list `listCurators()` selects
 *     (snake_case, because that read returns raw SQLite rows unmapped).
 *
 * NOTHING IS ADDED. The founding spec (`docs/THEVAULT_SPEC.md` §4.1) names
 * nine record fields; the backend surfaces a subset of them today, and the
 * absent ones are absent here too rather than typed-as-optional-and-hoped-for:
 *
 *   spec field           | backend today
 *   ---------------------|---------------------------------------------------
 *   creator              | NOT PRESENT as a structured identity. The public
 *                        | read carries `submitterId` only — a platform user
 *                        | id for whoever lodged the submission, which the
 *                        | spec's own three entry paths (self-submission,
 *                        | third-party nomination, curator discovery) mean is
 *                        | NOT reliably the creator. Rendered as "Submitted
 *                        | by", never relabeled "Creator".
 *   work                 | `title` + `workKind`
 *   acceptanceDate       | `admittedAt` (unix seconds)
 *   curatorStatement     | `curatorStatement` (+ `curatorId` / `curatorRole`)
 *   supportingEvidence   | NOT PRESENT — no evidence array on any read path.
 *   timeline             | NOT PRESENT.
 *   relationships        | `lineage` (declared parent DTU ids) — the one real
 *                        | edge set, rendered as exactly that and no more.
 *   media                | NOT PRESENT on the public read.
 *   preservationStatus   | NOT PRESENT on the public read. (`protectionFlags`
 *                        | exists, but only on the curator-scoped queue, and
 *                        | the admission seam reports `applied:false /
 *                        | no_handler_registered` until the permanence unit
 *                        | lands.) A record therefore makes NO custody claim.
 *
 * A field with no substrate renders nothing at all — it does not render an
 * empty section, a dash, or a "—" that reads like a measured absence.
 */

/** The public record. Mirrors `publicShape()` in `server/domains/vault.js`. */
export interface VaultRecordShape {
  /** The submission id (`vsub_…`) — the record's addressable identity. */
  id: string;
  title: string;
  /** One of the backend's `WORK_KINDS`. Free string: an unknown value is displayed verbatim, never dropped. */
  workKind: string;
  description: string;
  submitterId: string;
  /** Unix SECONDS (the backend stores `unixepoch()`), not milliseconds. */
  admittedAt: number | null;
  curatorId: string | null;
  /** `founding_curator` | `guest_curator`. */
  curatorRole: string | null;
  curatorStatement: string | null;
  /** The minted `vault_record` DTU id — the record's permanent accession. */
  recordDtuId: string | null;
  /** Declared parent DTU ids. Empty is honest (spec §4.1). */
  lineage: string[];
  /** Always `'admitted'` — `browse()`/`publicRecord()` hard-code it. */
  status: string;
}

/** A curator row, exactly as `listCurators()` selects it (raw snake_case). */
export interface VaultCuratorShape {
  curator_id: string;
  display_name: string;
  role: string;
  invited_by: string | null;
  invited_at: number | null;
  /** SQLite integer boolean. */
  active: number;
  retired_at: number | null;
}

/** How far along a real macro round-trip a surface is. */
export type VaultLoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * One drawer in the cabinet. `record` is null only while a deep-linked id is
 * still being fetched (or failed) — a drawer never invents a body.
 */
export interface VaultCabinetEntry {
  /** Submission id. Stable key + the value written to the address bar. */
  id: string;
  record: VaultRecordShape | null;
  state: VaultLoadState;
  error: string | null;
}
