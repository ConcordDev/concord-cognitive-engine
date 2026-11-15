// Audit fix sweep (PR #2356) — FIX-courtship-003 (FE half): the
// panels render the partner's name, never a raw id and never a bare
// "player:" — a player partner whose id was stripped server-side and
// who carries a resolved name shows the name; without one, a neutral
// label.
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/icons/Icon', () => ({ Icon: () => null }));
vi.mock('@/components/message/RecipientSearchInput', () => ({
  RecipientSearchInput: () => null,
}));

import { CourtshipsPanel } from '@/components/courtship/CourtshipsPanel';
import { PastMarriagesPanel } from '@/components/courtship/PastMarriagesPanel';
import { partnerLabel } from '@/components/courtship/courtship-types';

function deskWith(courtships: unknown[], pastMarriages: unknown[]) {
  return {
    courtships, pastMarriages, marriages: [], pregnancies: [], children: [],
    pending: false, engageThreshold: 0.7, marryThreshold: 0.85, engagePct: 70,
    interact: vi.fn(), propose: vi.fn(), wed: vi.fn(), startCourtship: vi.fn(),
    conceive: vi.fn(), birth: vi.fn(), setDissolveTarget: vi.fn(),
  } as unknown as Parameters<typeof CourtshipsPanel>[0]['desk'];
}

describe('courtship partner labels', () => {
  it('partnerLabel: name wins, NPC id is its name, unresolved player is neutral', () => {
    expect(partnerLabel({ partner_kind: 'player', partner_id: 'u-1', partner_name: 'Bob Rivers' })).toBe('Bob Rivers');
    expect(partnerLabel({ partner_kind: 'npc', partner_id: 'innkeeper-mara' })).toBe('innkeeper-mara');
    expect(partnerLabel({ partner_kind: 'player', partner_id: undefined })).toBe('A Concord member');
    expect(partnerLabel({ partner_kind: 'player', partner_name: null, partner_handle: null })).toBe('A Concord member');
  });

  it('panels show names — no raw ids, no bare player:', () => {
    const desk = deskWith(
      [{ partner_kind: 'player', partner_id: 'u-bob-1234567890', partner_name: 'Bob Rivers', affinity: 0.5, status: 'acquainted' }],
      [{ id: 'm1', partner_kind: 'player', partner_name: 'Cid', married_at: 1700000000, dissolved_at: 1710000000, dissolved_reason: 'drifted apart' }],
    );
    const a = render(<CourtshipsPanel desk={desk} />);
    expect(a.container.textContent).toContain('Bob Rivers');
    expect(a.container.textContent).not.toContain('u-bob');
    const b = render(<PastMarriagesPanel desk={desk} />);
    expect(b.container.textContent).toContain('Cid');
    expect(b.container.textContent).not.toContain('player:');
  });
});
