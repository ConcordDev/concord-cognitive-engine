// Audit fix sweep (PR #2356) — FIX-courtship-001: there was no way to
// start a courtship from the lens (the empty state sent users out to
// an NPC's context menu in the world). The panel now carries a start
// form: pick a player or name an NPC, Begin performs the first
// interaction; a blank partner is refused in the open.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/icons/Icon', () => ({
  Icon: () => null,
}));
vi.mock('@/components/message/RecipientSearchInput', () => ({
  RecipientSearchInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
    React.createElement('input', {
      'aria-label': 'Recipient',
      value,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    }),
}));

import { CourtshipsPanel } from '@/components/courtship/CourtshipsPanel';

function fakeDesk(startCourtship: (kind: string, id: string) => Promise<void>) {
  return {
    courtships: [],
    pending: false,
    engageThreshold: 0.7,
    marryThreshold: 0.9,
    engagePct: 70,
    interact: vi.fn(),
    propose: vi.fn(),
    wed: vi.fn(),
    startCourtship,
  } as unknown as Parameters<typeof CourtshipsPanel>[0]['desk'];
}

describe('courtship start form', () => {
  it('refuses a blank partner in the open and begins with a named NPC', async () => {
    const startCourtship = vi.fn(() => Promise.resolve());
    const view = render(<CourtshipsPanel desk={fakeDesk(startCourtship)} />);

    fireEvent.click(view.getByRole('button', { name: 'Start a courtship' }));
    fireEvent.click(view.getByRole('button', { name: 'Begin courtship' }));
    expect(view.getByRole('alert').textContent).toContain('Pick a player first');
    expect(startCourtship).not.toHaveBeenCalled();

    fireEvent.click(view.getByRole('button', { name: 'An NPC' }));
    fireEvent.change(view.getByLabelText('NPC id'), { target: { value: 'bob' } });
    fireEvent.click(view.getByRole('button', { name: 'Begin courtship' }));
    await waitFor(() => expect(startCourtship).toHaveBeenCalledWith('npc', 'bob'));
  });
});
