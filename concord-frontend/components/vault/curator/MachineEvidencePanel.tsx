'use client';

/**
 * TheVault — machine-assembled evidence, visibly separated from human judgment.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE THING THIS COMPONENT EXISTS TO MAKE UNMISTAKABLE
 * ───────────────────────────────────────────────────────────────────────────
 *   "AI helps organize evidence. Humans preserve culture."
 *
 * The backend already separates the two structurally: migration 396 stores
 * assembled evidence in its own `machine_evidence_json` column, deliberately
 * excluded from `chk_vault_admission_requires_human`, and `admit()` reads the
 * statement ONLY from its own argument — nothing in the evidence is ever
 * promoted into it, and a statement that reproduces the evidence is refused
 * with `curator_statement_is_machine_evidence`.
 *
 * A structural separation nobody can SEE is worth very little at the moment a
 * tired curator is reading a screen. So the separation is carried by three
 * independent channels here, any one of which would be enough on its own:
 *
 *   1. TYPEFACE. The Vault has exactly two faces, and they are not
 *      interchangeable: the serif is what a RECORD is set in. Machine evidence
 *      is set in the sans, always, without exception. Nothing a machine
 *      assembled ever appears in the face the archive reserves for its own
 *      permanent record.
 *
 *   2. PHYSICAL DEPTH. The curator statement sits on a raised, embossed plate
 *      — a label on the wall. Evidence sits in a debossed, recessed well —
 *      material filed in the drawer underneath it. You reach down for evidence
 *      and up for the judgment.
 *
 *   3. ABSENCE OF BRASS. The single accent belongs to the human act. There is
 *      no gold anywhere in this panel, by rule.
 *
 * And one deliberate omission: there is NO affordance here that moves this text
 * anywhere. No "use as statement", no "insert", no copy button. The absence is
 * the point, and it is stated in the panel rather than left to be noticed.
 */

import React from 'react';
import { vault } from '@/lib/vault/tokens';

export interface MachineEvidencePanelProps {
  /**
   * Whatever `curatorQueue()` returned in `machineEvidence` — the parsed
   * contents of the row's own `machine_evidence_json` column, or null.
   * Rendered as-is; this component never fetches, derives, or invents any of
   * it.
   */
  machineEvidence: unknown;
  /** Optional id so a composer can point its warning at this panel. */
  id?: string;
}

/** A leaf value rendered in the sans, never the serif. */
function Scalar({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="font-sans text-sm italic text-vault-gray">not recorded</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="font-sans text-sm text-vault-graphite">{value ? 'yes' : 'no'}</span>;
  }
  return (
    <span className="font-sans text-sm leading-6 text-vault-graphite whitespace-pre-wrap break-words">
      {String(value)}
    </span>
  );
}

/** Recursive, bounded renderer. Depth cap mirrors the backend's own scan. */
function EvidenceNode({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (depth > 6) {
    return <span className="font-sans text-xs text-vault-gray">(nested beyond display depth)</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="font-sans text-sm italic text-vault-gray">empty</span>;
    }
    return (
      <ul className="m-0 list-none space-y-2 p-0">
        {value.map((v, i) => (
          <li key={i} className="border-l border-vault-rule pl-3">
            <EvidenceNode value={v} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="font-sans text-sm italic text-vault-gray">empty</span>;
    }
    return (
      <dl className="m-0 space-y-3">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className={`${vault.label} mb-1`}>{k.replace(/[_-]+/g, ' ')}</dt>
            <dd className="m-0">
              <EvidenceNode value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <Scalar value={value} />;
}

export function MachineEvidencePanel({ machineEvidence, id }: MachineEvidencePanelProps) {
  const present = machineEvidence !== null && machineEvidence !== undefined;

  return (
    <section
      id={id}
      aria-labelledby={`${id || 'vault-machine-evidence'}-heading`}
      data-vault-authorship="machine"
      className="vault-paper vault-paper-sunk vault-deboss rounded-sm border border-vault-rule p-5"
    >
      {/*
        The banner. Persistent, never collapsible, never abbreviated — a
        curator must not be able to scroll past the label and read the contents
        as if they were someone's judgment.
      */}
      <header className="mb-4 border-b border-vault-rule pb-3">
        <h3 id={`${id || 'vault-machine-evidence'}-heading`} className={`${vault.label} mb-2`}>
          Machine-assembled evidence
        </h3>
        <p className="font-sans text-sm leading-6 text-vault-graphite">
          Assembled by machine to organize the record. It is stored in its own column, it is not part
          of the admission check, and it is <strong className="font-semibold">not a judgment</strong>.
        </p>
        <p className="font-sans text-xs leading-5 text-vault-gray mt-2">
          AI helps organize evidence. Humans preserve culture.
        </p>
      </header>

      {present ? (
        <div data-testid="vault-machine-evidence-body" className="font-sans">
          <EvidenceNode value={machineEvidence} />
        </div>
      ) : (
        /*
          Honest empty. No macro in `server/domains/vault.js` assembles evidence
          for a pending submission — the column is written only if a curator
          supplies evidence at the moment of admission — so an empty panel is
          the normal, truthful state and says exactly why.
        */
        <p data-testid="vault-machine-evidence-empty" className="font-sans text-sm leading-6 text-vault-gray">
          No machine-assembled evidence is attached to this submission. Nothing in TheVault assembles
          evidence on its own; the column stays empty unless a curator attaches material at the moment
          of admission.
        </p>
      )}

      {/*
        The absence of a path, stated. There is deliberately no control in this
        panel that writes anywhere — and the backend refuses a statement that
        reproduces this text, so saying so is a description of real behaviour,
        not a promise.
      */}
      <footer className="mt-4 border-t border-vault-rule pt-3">
        <p className="font-sans text-xs leading-5 text-vault-gray">
          There is no path from this panel into the curator statement. A statement that reproduces
          this text is refused by the archive.
        </p>
      </footer>
    </section>
  );
}

export default MachineEvidencePanel;
