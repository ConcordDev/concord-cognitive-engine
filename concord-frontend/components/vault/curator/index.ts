/**
 * TheVault — curator surface barrel.
 *
 * MOUNT SURFACE: `CuratorQueue` (default export of this directory). It takes no
 * required props and fetches everything it needs itself; `onChange` is the only
 * prop and is optional.
 *
 *   import CuratorQueue from '@/components/vault/curator';
 *   // or
 *   import { CuratorQueue } from '@/components/vault/curator';
 *
 * The remaining exports are the pieces `CuratorQueue` composes. They are
 * exported for testing and for reuse by a host page that wants one part on its
 * own — none of them is the mount surface.
 */

export { CuratorQueue, default } from './CuratorQueue';
export type { CuratorQueueProps } from './CuratorQueue';

export { CuratorStatementComposer, clearStatementDraft } from './CuratorStatementComposer';
export type { CuratorStatementComposerProps } from './CuratorStatementComposer';

export { MachineEvidencePanel } from './MachineEvidencePanel';
export type { MachineEvidencePanelProps } from './MachineEvidencePanel';

export { DeclineDialog } from './DeclineDialog';
export type { DeclineDialogProps } from './DeclineDialog';

export { InductionMoment } from './InductionMoment';
export type { InductionMomentProps } from './InductionMoment';

export {
  ADMISSION_AXES,
  CURATOR_ROLE_LABEL,
  MIN_CURATOR_STATEMENT_CHARS,
  VAULT_REFUSAL_COPY,
  WORK_KIND_LABEL,
  formatVaultDate,
  refusalCopy,
  runVaultMacro,
  statementEchoesMachineEvidence,
} from './vault-curator-client';
export type {
  AdmissionAxis,
  VaultAdmission,
  VaultCitation,
  VaultCuratorAction,
  VaultCuratorRow,
  VaultCuratorsResult,
  VaultProtection,
  VaultPublicRecord,
  VaultQueueResult,
  VaultQueueSubmission,
  VaultRunResult,
} from './vault-curator-client';
