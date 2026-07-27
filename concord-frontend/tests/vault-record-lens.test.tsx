/**
 * TheVault — the archive surface and its core object, the Vault Record.
 *
 * What this pins, and why each one is worth a test:
 *
 *   · THE EMPTY STATE IS THE DAY-ONE SCREEN. The archive opens with zero
 *     admitted records by design, so the empty surface is what everyone sees
 *     first and for as long as the first admission takes. It must be the
 *     founding placard (the standard admission is judged on), not "No items" —
 *     and it must contain no fabricated record, creator, count or statement.
 *   · THE RECORD IS A DRAWER, NOT A CARD. Its body is hidden behind a face
 *     until pulled, only one is open at a time, and the face announces its
 *     state through `aria-expanded` / `aria-controls`.
 *   · THE CURATOR STATEMENT IS THE SACRED ARTIFACT. It is set in the Vault
 *     serif, attributed to the named human who signed it, and it renders
 *     nothing at all when absent rather than an empty quotation frame.
 *   · ONLY REAL FIELDS RENDER. The public read carries no evidence array, no
 *     timeline, no media and no preservation status; the record must not
 *     invent, imply, or reserve space for any of them.
 *   · NO VANITY METRICS ANYWHERE. Asserted against the rendered text of a
 *     fully-open record, not just against the source.
 *   · REAL LOADING / EMPTY / ERROR STATES, and real macro dispatch behind
 *     every interaction that claims to be one.
 *
 * Fixtures live INSIDE this file only — they are never rendered by the product.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';

import {
  accessionOrdinal,
  formatAdmissionDate,
  formatCuratorRole,
  formatDiscipline,
} from '@/components/vault/format';
import { CuratorStatement } from '@/components/vault/CuratorStatement';
import type { VaultRecordShape } from '@/components/vault/types';

// ── real macro channel, mocked at the transport ─────────────────────────────
type LensCall = { domain: string; action: string; input: Record<string, unknown> };
const calls: LensCall[] = [];
let browseReply: { ok: boolean; result: unknown; error: string | null } = {
  ok: true,
  result: { records: [], count: 0 },
  error: null,
};
let recordReply: { ok: boolean; result: unknown; error: string | null } = {
  ok: false,
  result: null,
  error: 'not_found',
};
let curatorsReply: { ok: boolean; result: unknown; error: string | null } = {
  ok: true,
  result: { curators: [] },
  error: null,
};

vi.mock('@/lib/api/client', () => ({
  lensRun: (domain: string, action: string, input: Record<string, unknown> = {}) => {
    calls.push({ domain, action, input });
    if (action === 'browse') return Promise.resolve({ data: browseReply });
    if (action === 'record') return Promise.resolve({ data: recordReply });
    if (action === 'curators') return Promise.resolve({ data: curatorsReply });
    return Promise.resolve({ data: { ok: false, result: null, error: 'unknown action' } });
  },
}));

// ── scoped keyboard commands: capture registrations to assert real handlers ──
const registeredCommands: Array<{ id: string; keys: string; description: string; action: () => void }> = [];
vi.mock('@/hooks/useLensCommand', () => ({
  useLensCommand: (commands: Array<{ id: string; keys: string; description: string; action: () => void }>) => {
    registeredCommands.length = 0;
    registeredCommands.push(...commands);
  },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));

let deepLinkedId: string | null = null;
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'record' ? deepLinkedId : null) }),
}));

import VaultLensPage from '@/app/lenses/vault/page';

// ── fixtures (test-only; the product renders none of this) ──────────────────
const STATEMENT =
  'It rebuilt an entire regional scene around a recording nobody was supposed to hear, and the practice it started is still audible in the people who learned it secondhand.';

function makeRecord(over: Partial<VaultRecordShape> = {}): VaultRecordShape {
  return {
    id: 'vsub_aaaa0000',
    title: 'Nightwatch Sessions',
    workKind: 'music',
    description: 'A single-take room recording circulated on tape.',
    submitterId: 'user_7781',
    admittedAt: 1773532800, // 15 March 2026 UTC
    curatorId: 'curator_hallam',
    curatorRole: 'founding_curator',
    curatorStatement: STATEMENT,
    recordDtuId: 'dtu_vault_9f21ab',
    lineage: [],
    status: 'admitted',
    ...over,
  };
}

async function renderLens() {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<VaultLensPage />);
  });
  return utils;
}

beforeEach(() => {
  calls.length = 0;
  registeredCommands.length = 0;
  deepLinkedId = null;
  browseReply = { ok: true, result: { records: [], count: 0 }, error: null };
  recordReply = { ok: false, result: null, error: 'not_found' };
  curatorsReply = { ok: true, result: { curators: [] }, error: null };
  window.history.replaceState(null, '', '/lenses/vault');
});

/* ══════════════════════════════════════════════════════════════════════════
   Formatting — the "no substrate, no pixels" contract
   ══════════════════════════════════════════════════════════════════════════ */

describe('vault formatting refuses to fabricate', () => {
  it('formats an admission date in UTC long form', () => {
    expect(formatAdmissionDate(1773532800)).toBe('15 March 2026');
  });

  it('returns null (never a dash or a stand-in) for an absent or unusable date', () => {
    expect(formatAdmissionDate(null)).toBeNull();
    expect(formatAdmissionDate(undefined)).toBeNull();
    expect(formatAdmissionDate(0)).toBeNull();
    expect(formatAdmissionDate(-5)).toBeNull();
    expect(formatAdmissionDate(Number.NaN)).toBeNull();
  });

  it('names the backend disciplines and passes an unknown one through verbatim', () => {
    expect(formatDiscipline('moving_image')).toBe('Moving image');
    expect(formatDiscipline('music')).toBe('Music');
    expect(formatDiscipline('sculpture')).toBe('Sculpture'); // not swallowed, not remapped to "Other"
    expect(formatDiscipline('')).toBeNull();
  });

  it('names only the two real curator roles', () => {
    expect(formatCuratorRole('founding_curator')).toBe('Founding curator');
    expect(formatCuratorRole('guest_curator')).toBe('Guest curator');
    expect(formatCuratorRole('machine')).toBeNull();
    expect(formatCuratorRole(null)).toBeNull();
  });

  it('renders a drawer position, not a metric', () => {
    expect(accessionOrdinal(1)).toBe('No. 001');
    expect(accessionOrdinal(42)).toBe('No. 042');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The curator statement — the sacred artifact
   ══════════════════════════════════════════════════════════════════════════ */

describe('CuratorStatement', () => {
  it('sets the statement in the Vault serif at reading measure, attributed to the human who signed it', () => {
    render(
      <CuratorStatement statement={STATEMENT} curatorId="curator_hallam" curatorRole="guest_curator" />,
    );
    const quote = screen.getByText(STATEMENT);
    expect(quote.className).toContain('font-vault'); // the serif, not the metadata sans
    expect(quote.className).toContain('max-w-[62ch]'); // museum-label measure
    expect(screen.getByTestId('vault-statement-attribution').textContent).toBe(
      'Written and signed by curator_hallam, Guest curator',
    );
  });

  it('renders nothing at all when there is no statement', () => {
    const { container } = render(<CuratorStatement statement="   " curatorId="curator_hallam" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the curator filter as a real control only when a real handler is supplied', () => {
    const { rerender } = render(<CuratorStatement statement={STATEMENT} curatorId="curator_hallam" />);
    expect(screen.queryByRole('button')).toBeNull(); // never a dead control

    const onSelectCurator = vi.fn();
    rerender(
      <CuratorStatement statement={STATEMENT} curatorId="curator_hallam" onSelectCurator={onSelectCurator} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /show this curator/i }));
    expect(onSelectCurator).toHaveBeenCalledWith('curator_hallam');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Day one — the empty archive
   ══════════════════════════════════════════════════════════════════════════ */

describe('the day-one screen', () => {
  it('states the standard rather than reporting an absence', async () => {
    await renderLens();

    const empty = screen.getByTestId('vault-empty-archive');
    expect(within(empty).getByText('The archive is empty.')).toBeInTheDocument();

    // The six axes — the honest answer to "what would be in here".
    for (const axis of [
      'Originality',
      'Craft',
      'Influence',
      'Cultural relevance',
      'Longevity potential',
      'Documentation',
    ]) {
      expect(within(empty).getByText(axis)).toBeInTheDocument();
    }
    expect(within(empty).getByText(/if we can.t explain it, it shouldn.t be admitted/i)).toBeInTheDocument();

    // Not a gray box: no "No items"-class copy anywhere on the surface.
    expect(empty.textContent).not.toMatch(/no items|nothing to show|no results|coming soon/i);
  });

  it('fabricates no record, creator, statement or count', async () => {
    await renderLens();
    expect(screen.queryAllByTestId('vault-record')).toHaveLength(0);
    expect(screen.queryByTestId('vault-cabinet')).toBeNull();
    expect(screen.queryByTestId('vault-curator-statement')).toBeNull();
    // No roster is invented when the backend has no curators.
    expect(screen.queryByTestId('vault-curator-roster')).toBeNull();
    // No "0 records" style counter dressed as a stat.
    expect(screen.getByTestId('vault-wall').textContent).not.toMatch(/\b0\s+(records?|works?|entries)\b/i);
  });

  it('does not offer narrowing controls for an archive with nothing in it', async () => {
    await renderLens();
    expect(screen.queryByRole('button', { name: 'Music' })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Loading and error — real states, not sentinels
   ══════════════════════════════════════════════════════════════════════════ */

describe('cabinet states', () => {
  it('shows a real pending state while vault.browse is in flight', async () => {
    // Render WITHOUT flushing the promise so the in-flight state is observable.
    render(<VaultLensPage />);
    const loading = screen.getByTestId('vault-cabinet-loading');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    expect(loading.textContent).toMatch(/reading the register/i);
    // Settle the real round trip so the resolution isn't an unwrapped update.
    await act(async () => {});
    expect(screen.queryByTestId('vault-cabinet-loading')).toBeNull();
  });

  it('surfaces the real macro error and retries with a real re-dispatch', async () => {
    browseReply = { ok: false, result: null, error: 'browse_failed' };
    await renderLens();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('browse_failed');

    const browsesBefore = calls.filter((c) => c.action === 'browse').length;
    browseReply = { ok: true, result: { records: [makeRecord()], count: 1 }, error: null };
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    });
    expect(calls.filter((c) => c.action === 'browse').length).toBe(browsesBefore + 1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByTestId('vault-record')).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The Vault Record — a drawer, not a card
   ══════════════════════════════════════════════════════════════════════════ */

describe('the Vault Record reads as a drawer', () => {
  beforeEach(() => {
    browseReply = {
      ok: true,
      result: {
        records: [
          makeRecord(),
          makeRecord({
            id: 'vsub_bbbb1111',
            title: 'Field Notes, Vol. II',
            workKind: 'writing',
            curatorId: 'curator_okonjo',
            curatorRole: 'guest_curator',
            curatorStatement: 'A decade of unglamorous documentation that every later account quietly depends on.',
            recordDtuId: 'dtu_vault_1177cd',
          }),
        ],
        count: 2,
      },
      error: null,
    };
  });

  it('shows an indexed face and keeps the body shut until the drawer is pulled', async () => {
    await renderLens();
    const [first] = screen.getAllByTestId('vault-record');

    expect(within(first).getByText('No. 001')).toBeInTheDocument();
    expect(within(first).getByText('Nightwatch Sessions')).toBeInTheDocument();
    expect(within(first).getByText(/Music · Accepted 15 March 2026/)).toBeInTheDocument();

    const face = within(first).getByRole('button', { name: /Nightwatch Sessions/ });
    expect(face).toHaveAttribute('aria-expanded', 'false');
    expect(within(first).queryByTestId('vault-record-interior')).toBeNull();
    // The statement lives inside the drawer — it is not on the face.
    expect(first.textContent).not.toContain(STATEMENT);
  });

  it('opens one drawer at a time — pulling the second shuts the first', async () => {
    await renderLens();
    const rows = () => screen.getAllByTestId('vault-record');

    await act(async () => {
      fireEvent.click(within(rows()[0]).getByRole('button', { name: /Nightwatch Sessions/ }));
    });
    expect(within(rows()[0]).getByTestId('vault-record-interior')).toBeInTheDocument();
    expect(within(rows()[0]).getByRole('button', { name: /Nightwatch Sessions/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await act(async () => {
      fireEvent.click(within(rows()[1]).getByRole('button', { name: /Field Notes/ }));
    });
    expect(within(rows()[0]).queryByTestId('vault-record-interior')).toBeNull();
    expect(within(rows()[1]).getByTestId('vault-record-interior')).toBeInTheDocument();
  });

  it('the open drawer is a wall label: statement above the supporting material, and only real fields', async () => {
    await renderLens();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Nightwatch Sessions/ }));
    });

    const interior = screen.getByTestId('vault-record-interior');

    // The sacred artifact, present and attributed.
    const statement = within(interior).getByTestId('vault-curator-statement');
    expect(within(statement).getByText(STATEMENT)).toBeInTheDocument();
    expect(within(statement).getByText(/Written and signed by curator_hallam, Founding curator/)).toBeInTheDocument();

    // Reading order: the statement sits ABOVE the description (§4.4).
    const text = interior.textContent || '';
    expect(text.indexOf(STATEMENT)).toBeGreaterThan(-1);
    expect(text.indexOf(STATEMENT)).toBeLessThan(text.indexOf('A single-take room recording'));

    // Real fields only.
    expect(within(interior).getByText('Submitted by')).toBeInTheDocument();
    expect(within(interior).getByText('user_7781')).toBeInTheDocument();
    expect(within(interior).getByText('dtu_vault_9f21ab')).toBeInTheDocument();

    // Fields with no substrate on the public read are absent entirely — not
    // rendered as an empty section or an em-dash that reads like a measurement.
    expect(text).not.toMatch(/preservation/i);
    expect(text).not.toMatch(/timeline/i);
    expect(text).not.toMatch(/supporting evidence/i);
    // `submitterId` is never relabelled as a creator identity we do not have.
    expect(within(interior).queryByText(/^Creator$/)).toBeNull();
  });

  it('omits the lineage section entirely when a record declares none, and lists it when it does', async () => {
    await renderLens();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Nightwatch Sessions/ }));
    });
    expect(screen.getByTestId('vault-record-interior').textContent).not.toMatch(/cited lineage/i);

    browseReply = {
      ok: true,
      result: { records: [makeRecord({ lineage: ['dtu_parent_01', 'dtu_parent_02'] })], count: 1 },
      error: null,
    };
    await renderLens();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Nightwatch Sessions/ })[1]);
    });
    const interiors = screen.getAllByTestId('vault-record-interior');
    const latest = interiors[interiors.length - 1];
    expect(within(latest).getByText('Cited lineage')).toBeInTheDocument();
    expect(within(latest).getByText('dtu_parent_01')).toBeInTheDocument();
  });

  it('renders no vanity metric anywhere on a fully-open record', async () => {
    await renderLens();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Nightwatch Sessions/ }));
    });
    const surface = screen.getByTestId('vault-wall').textContent || '';
    expect(surface).not.toMatch(/\b(views?|likes?|plays?|followers?|trending|popular|most[- ]viewed|ranking|score)\b/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Interactions — each tied to a real macro call
   ══════════════════════════════════════════════════════════════════════════ */

describe('interactions dispatch real macros', () => {
  beforeEach(() => {
    browseReply = { ok: true, result: { records: [makeRecord()], count: 1 }, error: null };
  });

  it('narrowing by discipline re-runs vault.browse with the real workKind', async () => {
    await renderLens();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Writing' }));
    });
    const last = calls.filter((c) => c.action === 'browse').pop();
    expect(last?.input).toEqual({ workKind: 'writing' });
    expect(screen.getByRole('button', { name: 'Writing' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('narrowing to a curator from inside an open record re-runs vault.browse with their id', async () => {
    await renderLens();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Nightwatch Sessions/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /show this curator/i }));
    });
    expect(calls.filter((c) => c.action === 'browse').pop()?.input).toEqual({ curatorId: 'curator_hallam' });
  });

  it('reads a permanently-linked record through vault.record when it is outside the index', async () => {
    deepLinkedId = 'vsub_linked999';
    recordReply = {
      ok: true,
      result: { record: makeRecord({ id: 'vsub_linked999', title: 'The Salt Tapes' }) },
      error: null,
    };
    await renderLens();

    expect(calls.filter((c) => c.action === 'record').pop()?.input).toEqual({ submissionId: 'vsub_linked999' });
    expect(screen.getAllByTestId('vault-record')).toHaveLength(2);

    // The linked drawer is prepended AND opened — arriving by permanent link
    // lands you at the record itself, not at the top of the cabinet.
    const linked = screen.getAllByTestId('vault-record')[0];
    expect(linked).toHaveAttribute('data-record-id', 'vsub_linked999');
    expect(linked).toHaveAttribute('data-open', 'true');
    expect(within(linked).getByTestId('vault-record-interior')).toBeInTheDocument();
    // Its title reads on the drawer face and again on the wall label inside.
    expect(within(linked).getAllByText('The Salt Tapes').length).toBe(2);
  });

  it('reports an unreadable linked record honestly, with a retry that re-dispatches', async () => {
    deepLinkedId = 'vsub_missing000';
    recordReply = { ok: false, result: null, error: 'not_found' };
    await renderLens();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/could not be read/i);
    expect(alert.textContent).toContain('not_found');

    const before = calls.filter((c) => c.action === 'record').length;
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    });
    expect(calls.filter((c) => c.action === 'record').length).toBe(before + 1);
  });

  it('writes the open record to the address bar so a permanent record has a permanent link', async () => {
    await renderLens();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Nightwatch Sessions/ }));
    });
    expect(window.location.search).toContain('record=vsub_aaaa0000');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Nightwatch Sessions/ }));
    });
    expect(window.location.search).not.toContain('record=');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Keyboard — scoped, real, and discoverable
   ══════════════════════════════════════════════════════════════════════════ */

describe('keyboard navigation', () => {
  beforeEach(() => {
    browseReply = {
      ok: true,
      result: {
        records: [makeRecord(), makeRecord({ id: 'vsub_bbbb1111', title: 'Field Notes, Vol. II' })],
        count: 2,
      },
      error: null,
    };
  });

  it('registers scoped commands that drive real drawer state', async () => {
    await renderLens();
    expect(registeredCommands.map((c) => c.keys)).toEqual(['j', 'k', 'o', 'escape']);

    const cmd = (id: string) => registeredCommands.find((c) => c.id === id)!;

    await act(async () => {
      cmd('next-drawer').action();
    });
    expect(screen.getByTestId('vault-cabinet-position').textContent).toBe('Drawer 1 of 2');

    await act(async () => {
      cmd('next-drawer').action();
    });
    expect(screen.getByTestId('vault-cabinet-position').textContent).toBe('Drawer 2 of 2');

    await act(async () => {
      cmd('toggle-drawer').action();
    });
    expect(screen.getAllByTestId('vault-record')[1]).toHaveAttribute('data-open', 'true');

    await act(async () => {
      cmd('close-drawer').action();
    });
    expect(screen.queryByTestId('vault-record-interior')).toBeNull();
  });

  it('shows the shortcuts rather than hiding them', async () => {
    await renderLens();
    const cabinet = screen.getByTestId('vault-cabinet');
    for (const key of ['J', 'K', 'O', 'Esc']) {
      expect(within(cabinet).getByText(key)).toBeInTheDocument();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   The roster — real curators only
   ══════════════════════════════════════════════════════════════════════════ */

describe('curator roster', () => {
  it('names the real curators and flags a retired one instead of dropping them', async () => {
    curatorsReply = {
      ok: true,
      result: {
        curators: [
          {
            curator_id: 'curator_hallam',
            display_name: 'R. Hallam',
            role: 'founding_curator',
            invited_by: null,
            invited_at: 1773532800,
            active: 1,
            retired_at: null,
          },
          {
            curator_id: 'curator_okonjo',
            display_name: 'A. Okonjo',
            role: 'guest_curator',
            invited_by: 'curator_hallam',
            invited_at: 1773532800,
            active: 0,
            retired_at: 1773619200,
          },
        ],
      },
      error: null,
    };
    await renderLens();

    const roster = screen.getByTestId('vault-curator-roster');
    expect(within(roster).getByText('R. Hallam')).toBeInTheDocument();
    expect(within(roster).getByText('Founding curator')).toBeInTheDocument();
    expect(within(roster).getByText('A. Okonjo')).toBeInTheDocument();
    expect(within(roster).getByText('retired')).toBeInTheDocument();
  });
});
