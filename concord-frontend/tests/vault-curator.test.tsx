/**
 * TheVault — curator surface contract.
 *
 * Pins the three claims this unit exists to make true, so a later edit that
 * quietly breaks one turns a named test red instead of just reading fine:
 *
 *   1. MACHINE EVIDENCE IS VISIBLY SEPARATED FROM HUMAN JUDGMENT. Not "stored
 *      in a different column" (the backend already guarantees that) — actually
 *      distinguishable in the rendered output, by authorship marker, by
 *      typeface, and by the absence of any control that moves evidence into
 *      the statement.
 *
 *   2. NO DECLINE DATA LEAKS INTO A PUBLIC-FACING SHAPE. A decline is visible
 *      only in the curator-scoped drawer, labelled as private. It must never
 *      appear on the admitted record or in the induction moment — the two
 *      surfaces that read as the archive's public face — even when the row
 *      handed to the component carries decline columns.
 *
 *   3. THE STATEMENT IS THE GATE. The admit control cannot fire below the
 *      backend's own floor, and cannot fire on prose that reproduces the
 *      machine evidence.
 *
 * Every fixture below lives INSIDE this file. Nothing in the shipped
 * components fabricates a submission, a curator, a statement, or a count.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

/* ── transport mock: the exact channel runVaultMacro posts through ───────── */

const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => post(...args) },
}));

import { CuratorQueue } from '@/components/vault/curator/CuratorQueue';
import { MachineEvidencePanel } from '@/components/vault/curator/MachineEvidencePanel';
import { InductionMoment } from '@/components/vault/curator/InductionMoment';
import type {
  VaultAdmission,
  VaultQueueSubmission,
} from '@/components/vault/curator/vault-curator-client';

/* ── fixtures (test-only, by rule) ──────────────────────────────────────── */

const MACHINE_FINDING =
  'Two independent archival catalogues list this pressing between 1971 and 1984.';

function submission(over: Partial<VaultQueueSubmission> = {}): VaultQueueSubmission {
  return {
    id: 'vsub_test0001',
    title: 'Test Work',
    workKind: 'music',
    description: 'An account written by the submitter.',
    submitterId: 'user_submitter',
    status: 'under_review',
    submittedAt: 1_770_000_000,
    reviewOpenedBy: 'curator_founding',
    lineage: [],
    curatorStatement: null,
    admittedBy: null,
    admittedByRole: null,
    machineEvidence: null,
    declinedBy: null,
    declineReason: null,
    declinedAt: null,
    recordDtuId: null,
    protectionFlags: null,
    ...over,
  };
}

const ADMISSION: VaultAdmission = {
  ok: true,
  id: 'vsub_test0001',
  status: 'admitted',
  recordDtuId: 'dtu_vault_abc123',
  admittedBy: 'curator_founding',
  admittedByRole: 'founding_curator',
  curatorDisplayName: 'A Named Human',
  curatorStatement: 'It belongs because it changed how a small circle of players phrased a line.',
  machineEvidenceStored: false,
  citations: [],
  protection: { applied: false, reason: 'no_handler_registered' },
};

/** Route the mocked POST by macro action. Returns the route's real envelope. */
function routeMacros(handlers: Record<string, unknown>) {
  post.mockImplementation((_url: string, body: { action: string }) => {
    const payload = handlers[body.action];
    if (payload === undefined) {
      return Promise.resolve({ data: { ok: true, result: { ok: false, reason: 'not_found' } } });
    }
    return Promise.resolve({ data: { ok: true, result: payload } });
  });
}

const calledActions = () => post.mock.calls.map((c) => (c[1] as { action: string }).action);

beforeEach(() => {
  post.mockReset();
  try { window.localStorage.clear(); } catch { /* jsdom always has one */ }
});

/* ═══════════════════════════════════════════════════════════════════════
   1 — MACHINE EVIDENCE IS VISIBLY SEPARATED FROM HUMAN JUDGMENT
   ═══════════════════════════════════════════════════════════════════════ */

describe('machine evidence is visibly separated from human judgment', () => {
  it('labels the panel, marks its authorship, and offers no path out of it', () => {
    const { container } = render(
      <MachineEvidencePanel machineEvidence={{ finding: MACHINE_FINDING }} id="evp" />,
    );

    const panel = container.querySelector('[data-vault-authorship="machine"]') as HTMLElement;
    expect(panel).toBeTruthy();

    // The banner is present and says the load-bearing thing.
    expect(within(panel).getByText(/machine-assembled evidence/i)).toBeInTheDocument();
    expect(within(panel).getByText(/not a judgment/i)).toBeInTheDocument();
    expect(
      within(panel).getByText(/AI helps organize evidence\. Humans preserve culture\./i),
    ).toBeInTheDocument();

    // The evidence itself renders — real content, from the prop only.
    expect(within(panel).getByText(MACHINE_FINDING)).toBeInTheDocument();

    // No control in the panel writes anywhere. The absence IS the guarantee.
    expect(within(panel).queryAllByRole('button')).toHaveLength(0);
    expect(within(panel).queryAllByRole('textbox')).toHaveLength(0);

    // And the panel says so, matching the backend's real refusal.
    expect(
      within(panel).getByText(/no path from this panel into the curator statement/i),
    ).toBeInTheDocument();
  });

  it('renders an honest empty rather than implying evidence was gathered', () => {
    render(<MachineEvidencePanel machineEvidence={null} />);
    expect(screen.getByTestId('vault-machine-evidence-empty')).toHaveTextContent(
      /no machine-assembled evidence is attached/i,
    );
    expect(screen.queryByTestId('vault-machine-evidence-body')).not.toBeInTheDocument();
  });

  it('puts evidence and judgment in different containers, in different typefaces', async () => {
    routeMacros({
      queue: { ok: true, count: 1, submissions: [submission({ machineEvidence: { finding: MACHINE_FINDING } })] },
      curators: { ok: true, curators: [] },
    });

    const { container } = render(<CuratorQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /Test Work/ }));

    const machine = container.querySelector('[data-vault-authorship="machine"]') as HTMLElement;
    const human = container.querySelector('[data-vault-authorship="human"]') as HTMLElement;
    expect(machine).toBeTruthy();
    expect(human).toBeTruthy();

    // Disjoint subtrees — neither contains the other.
    expect(machine.contains(human)).toBe(false);
    expect(human.contains(machine)).toBe(false);

    // The evidence lives only in the machine subtree.
    expect(within(machine).getByText(MACHINE_FINDING)).toBeInTheDocument();
    expect(within(human).queryByText(MACHINE_FINDING)).not.toBeInTheDocument();

    // Typeface separation: the serif is what a RECORD is set in. The statement
    // field is serif; the evidence body is sans, never serif.
    const field = within(human).getByLabelText(/curator statement/i);
    expect(field.className).toContain('font-vault');
    const evidenceBody = within(machine).getByTestId('vault-machine-evidence-body');
    expect(evidenceBody.className).toContain('font-sans');
    expect(evidenceBody.className).not.toContain('font-vault');
    expect(machine.querySelectorAll('.font-vault')).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   2 — NO DECLINE DATA IN ANY PUBLIC-FACING SHAPE
   ═══════════════════════════════════════════════════════════════════════ */

describe('declines stay private', () => {
  const STALE_DECLINE = 'An earlier pass turned this away for thin documentation.';

  it('never renders decline data on the admitted record, even when the row carries it', async () => {
    routeMacros({
      queue: {
        ok: true,
        count: 1,
        submissions: [
          submission({
            status: 'admitted',
            curatorStatement: 'It belongs because it documents a scene nobody else wrote down.',
            admittedBy: 'curator_founding',
            admittedByRole: 'founding_curator',
            recordDtuId: 'dtu_vault_abc123',
            // Adversarial: the curator-scoped row still carries decline columns.
            declinedBy: 'curator_founding',
            declineReason: STALE_DECLINE,
            declinedAt: 1_769_000_000,
          }),
        ],
      },
      curators: { ok: true, curators: [] },
    });

    render(<CuratorQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /Admitted$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Test Work/ }));

    expect(await screen.findByText(/Accepted into TheVault because…/)).toBeInTheDocument();
    expect(screen.queryByText(STALE_DECLINE)).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(STALE_DECLINE.slice(0, 24), 'i'))).not.toBeInTheDocument();
  });

  it('never renders decline data in the induction moment', () => {
    render(
      <InductionMoment
        admission={ADMISSION}
        title="Test Work"
        workKind="music"
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('vault-induction-moment')).toBeInTheDocument();
    expect(screen.queryByText(/declin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reject/i)).not.toBeInTheDocument();
  });

  it('shows a decline only in the curator-scoped drawer, labelled private', async () => {
    routeMacros({
      queue: {
        ok: true,
        count: 1,
        submissions: [
          submission({ status: 'declined', declinedBy: 'curator_founding', declineReason: STALE_DECLINE, declinedAt: 1_769_000_000 }),
        ],
      },
      curators: { ok: true, curators: [] },
    });

    render(<CuratorQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /^Declined$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Test Work/ }));

    expect(await screen.findByText(STALE_DECLINE)).toBeInTheDocument();
    expect(screen.getAllByText(/never published, counted, or aggregated/i).length).toBeGreaterThan(0);
  });

  it('reaches no public read path — browse is never called', async () => {
    routeMacros({
      queue: { ok: true, count: 0, submissions: [] },
      curators: { ok: true, curators: [] },
    });
    render(<CuratorQueue />);
    await screen.findByTestId('vault-queue-empty');
    expect(calledActions()).not.toContain('browse');
    for (const call of post.mock.calls) {
      const body = call[1] as { domain: string; input: { status?: string[] } };
      expect(body.domain).toBe('vault');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   3 — THE STATEMENT IS THE GATE
   ═══════════════════════════════════════════════════════════════════════ */

describe('the curator statement gates admission', () => {
  async function openComposer(machineEvidence: unknown = null) {
    routeMacros({
      queue: { ok: true, count: 1, submissions: [submission({ machineEvidence })] },
      curators: { ok: true, curators: [] },
      admit: ADMISSION,
      record: { ok: true, record: { admittedAt: 1_771_000_000 } },
    });
    render(<CuratorQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /Test Work/ }));
    return {
      field: screen.getByLabelText(/curator statement/i),
      button: screen.getByTestId('vault-admit-button'),
    };
  }

  it('refuses to fire below the backend floor and clears once it is met', async () => {
    const { field, button } = await openComposer();
    expect(button).toBeDisabled();

    fireEvent.change(field, { target: { value: 'too short' } });
    expect(button).toBeDisabled();
    expect(screen.getByText(/9 written · 20 minimum/)).toBeInTheDocument();

    fireEvent.change(field, {
      target: { value: 'It belongs because it changed how a small circle phrased a line.' },
    });
    expect(button).toBeEnabled();
    expect(calledActions()).not.toContain('admit');
  });

  it('warns and blocks when the statement reproduces the machine evidence', async () => {
    const { field, button } = await openComposer({ finding: MACHINE_FINDING });

    fireEvent.change(field, { target: { value: MACHINE_FINDING } });
    expect(screen.getByTestId('vault-echo-warning')).toBeInTheDocument();
    expect(button).toBeDisabled();

    fireEvent.change(field, {
      target: { value: 'It belongs because it is the only surviving account of that room.' },
    });
    expect(screen.queryByTestId('vault-echo-warning')).not.toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it('surfaces the backend refusal code verbatim rather than a generic error', async () => {
    routeMacros({
      queue: { ok: true, count: 1, submissions: [submission()] },
      curators: { ok: true, curators: [] },
      admit: { ok: false, reason: 'curator_statement_is_machine_evidence' },
    });
    render(<CuratorQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /Test Work/ }));
    fireEvent.change(screen.getByLabelText(/curator statement/i), {
      target: { value: 'A statement long enough to clear the floor for this test.' },
    });
    fireEvent.click(screen.getByTestId('vault-admit-button'));

    const refusal = await screen.findByTestId('vault-admit-refusal');
    expect(refusal).toHaveTextContent(/assembled evidence can inform a judgment/i);
    expect(screen.queryByTestId('vault-induction-moment')).not.toBeInTheDocument();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   4 — THE INDUCTION MOMENT
   ═══════════════════════════════════════════════════════════════════════ */

describe('the induction moment', () => {
  it('fires only on a server-confirmed admission, in ceremonial black', async () => {
    routeMacros({
      queue: { ok: true, count: 1, submissions: [submission()] },
      curators: { ok: true, curators: [] },
      admit: ADMISSION,
      record: { ok: true, record: { admittedAt: 1_771_000_000 } },
    });
    render(<CuratorQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /Test Work/ }));
    fireEvent.change(screen.getByLabelText(/curator statement/i), {
      target: { value: ADMISSION.curatorStatement },
    });
    fireEvent.click(screen.getByTestId('vault-admit-button'));

    const room = await screen.findByTestId('vault-induction-moment');
    // Ceremonial black — the one place the Vault inverts off paper.
    expect(room).toHaveStyle({ backgroundColor: '#12100E' });
    expect(room).toHaveAttribute('aria-modal', 'true');

    // The words on the wall are the server's confirmed statement.
    expect(within(room).getByTestId('vault-induction-statement')).toHaveTextContent(
      ADMISSION.curatorStatement,
    );
    expect(within(room).getByText(/A Named Human/)).toBeInTheDocument();
    expect(within(room).getByText(/Founding curator/)).toBeInTheDocument();
  });

  it('states the real permanence status rather than dressing it up', () => {
    render(<InductionMoment admission={ADMISSION} title="Test Work" workKind="music" onClose={() => {}} />);
    expect(screen.getByTestId('vault-induction-preservation')).toHaveTextContent(
      /not applied \(no_handler_registered\)/,
    );
  });

  it('renders the acceptance date only once the server supplies one', async () => {
    routeMacros({ record: { ok: true, record: { admittedAt: 1_771_000_000 } } });
    render(<InductionMoment admission={ADMISSION} title="Test Work" workKind="music" onClose={() => {}} />);
    expect(screen.queryByText(/Accepted$/)).not.toBeInTheDocument();
    expect(await screen.findByText(/13 February 2026/)).toBeInTheDocument();
  });

  it('omits the acceptance date entirely when the record read fails', async () => {
    routeMacros({ record: { ok: false, reason: 'not_found' } });
    render(<InductionMoment admission={ADMISSION} title="Test Work" workKind="music" onClose={() => {}} />);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(screen.queryByText(/February/)).not.toBeInTheDocument();
    // and nothing is invented in its place
    expect(screen.queryByText(/Accepted/)).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    routeMacros({ record: { ok: false, reason: 'not_found' } });
    const onClose = vi.fn();
    render(<InductionMoment admission={ADMISSION} title="Test Work" workKind="music" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   5 — HONEST STATES, AND THE GATE ITSELF
   ═══════════════════════════════════════════════════════════════════════ */

describe('honest states', () => {
  it('opens empty and says so — no fabricated queue', async () => {
    routeMacros({ queue: { ok: true, count: 0, submissions: [] }, curators: { ok: true, curators: [] } });
    render(<CuratorQueue />);
    expect(screen.getByTestId('vault-queue-loading')).toBeInTheDocument();
    expect(await screen.findByTestId('vault-queue-empty')).toHaveTextContent(/TheVault opens empty/);
    expect(screen.getByText(/TheVault has no curators yet\./)).toBeInTheDocument();
  });

  it('renders the closed-room surface for a non-curator, with the real reason', async () => {
    routeMacros({ queue: { ok: false, reason: 'not_a_curator' }, curators: { ok: true, curators: [] } });
    render(<CuratorQueue />);
    expect(await screen.findByText(/This room is closed\./)).toBeInTheDocument();
    expect(screen.getByText(/You are not a curator of TheVault/)).toBeInTheDocument();
    expect(screen.queryByTestId('vault-queue-list')).not.toBeInTheDocument();
  });

  it('renders a retryable error state on a transport failure', async () => {
    post.mockRejectedValue(new Error('network down'));
    render(<CuratorQueue />);
    const err = await screen.findByTestId('vault-queue-error');
    expect(err).toHaveTextContent(/could not be reached/i);
    expect(within(err).getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('moves through the drawer with the arrow keys', async () => {
    routeMacros({
      queue: {
        ok: true,
        count: 2,
        submissions: [submission(), submission({ id: 'vsub_test0002', title: 'Second Work' })],
      },
      curators: { ok: true, curators: [] },
    });
    render(<CuratorQueue />);
    const list = await screen.findByTestId('vault-queue-list');

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /Test Work/ })).toHaveAttribute('aria-current', 'true');

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: /Second Work/ })).toHaveAttribute('aria-current', 'true');

    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(screen.getByRole('button', { name: /Test Work/ })).toHaveAttribute('aria-current', 'true');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   6 — DECLINE, WITH DIGNITY
   ═══════════════════════════════════════════════════════════════════════ */

describe('declining', () => {
  it('requires a reason and records it privately', async () => {
    routeMacros({
      queue: { ok: true, count: 1, submissions: [submission()] },
      curators: { ok: true, curators: [] },
      decline: { ok: true, id: 'vsub_test0001', status: 'declined' },
    });
    render(<CuratorQueue />);
    fireEvent.click(await screen.findByRole('button', { name: /Test Work/ }));
    fireEvent.click(screen.getByRole('button', { name: /decline privately/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/never published, never counted, and never listed/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/not a bar/i)).toBeInTheDocument();

    const confirm = within(dialog).getByTestId('vault-decline-confirm');
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/reason, addressed to the submitter/i), {
      target: { value: 'The documentation does not yet carry the claim.' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    const notice = await screen.findByTestId('vault-notice');
    expect(notice).toHaveTextContent(/Declined privately/);
    expect(notice).toHaveTextContent(/goes nowhere else/);

    const declineCall = post.mock.calls.find((c) => (c[1] as { action: string }).action === 'decline');
    expect(declineCall).toBeTruthy();
    expect((declineCall![1] as { input: { reason: string } }).input.reason).toBe(
      'The documentation does not yet carry the claim.',
    );
  });
});
