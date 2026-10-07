/**
 * TheVault pieces that stay beside the cabinet page.
 *
 * The page itself is pinned by tests/thevault-lens-states.test.tsx.
 * These tests keep the formatters and the curator-statement component
 * honest: no fabricated date, role, or empty quotation frame.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import {
  accessionOrdinal,
  formatAdmissionDate,
  formatCuratorRole,
  formatDiscipline,
} from '@/components/vault/format';
import { CuratorStatement } from '@/components/vault/CuratorStatement';

const STATEMENT =
  'It rebuilt an entire regional scene around a recording nobody was supposed to hear, and the practice it started is still audible in the people who learned it secondhand.';

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
    expect(formatDiscipline('sculpture')).toBe('Sculpture');
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

describe('CuratorStatement', () => {
  it('sets the statement in the Vault serif at reading measure, attributed to the human who signed it', () => {
    render(
      <CuratorStatement statement={STATEMENT} curatorId="curator_hallam" curatorRole="guest_curator" />,
    );
    const quote = screen.getByText(STATEMENT);
    expect(quote.className).toContain('font-vault');
    expect(quote.className).toContain('max-w-[62ch]');
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
    expect(screen.queryByRole('button')).toBeNull();

    const onSelectCurator = vi.fn();
    rerender(
      <CuratorStatement statement={STATEMENT} curatorId="curator_hallam" onSelectCurator={onSelectCurator} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /show this curator/i }));
    expect(onSelectCurator).toHaveBeenCalledWith('curator_hallam');
  });
});
