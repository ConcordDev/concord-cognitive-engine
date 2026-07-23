// NPCActionMenu — the NPC contextual action menu (Phase DA1).
//
// DET-C batch 2: covers the new "View bloodline" menu item, which
// dispatches `concordia:open-bloodline-tree` with the real npcId from the
// context-menu payload. BloodlineTreeViewer.tsx has listened for this
// event since it was written (Phase DC13) but nothing anywhere ever
// dispatched it — verified via the runtime dead-event-listener detector,
// not grep — so the 3-generation ancestry viewer was fully built and
// fully unreachable. This test pins the fix: clicking the new action
// dispatches the real event with the NPC's id.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { NPCActionMenu } from '@/components/world/NPCActionMenu';

function openMenu(npcId = 'npc_123', npcName = 'Old Seam', occupation: string | null = null) {
  fireEvent(
    window,
    new CustomEvent('concordia:npc-context-menu', {
      detail: { npcId, npcName, occupation, screenX: 100, screenY: 100 },
    }),
  );
}

describe('NPCActionMenu', () => {
  beforeEach(() => {
    // enrich() fetches mentor/courtship/hire data — stub fetch so it
    // resolves harmlessly and never throws inside the component.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)),
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens on concordia:npc-context-menu and renders the NPC name', () => {
    render(<NPCActionMenu />);
    openMenu('npc_1', 'Kel');
    expect(screen.getByText('Kel')).toBeInTheDocument();
  });

  it('renders a "View bloodline" action alongside the existing "Inspect traits" action', () => {
    render(<NPCActionMenu />);
    openMenu();
    expect(screen.getByText('View bloodline')).toBeInTheDocument();
    expect(screen.getByText('Inspect traits')).toBeInTheDocument();
  });

  it('clicking "View bloodline" dispatches concordia:open-bloodline-tree with the real npcId and closes the menu', () => {
    render(<NPCActionMenu />);
    openMenu('npc_ancestral_42', 'Brackish');

    const handler = vi.fn();
    window.addEventListener('concordia:open-bloodline-tree', handler);

    fireEvent.click(screen.getByText('View bloodline'));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent<{ npcId: string }>;
    expect(event.detail).toEqual({ npcId: 'npc_ancestral_42' });
    // Menu closes after the action fires.
    expect(screen.queryByText('View bloodline')).not.toBeInTheDocument();

    window.removeEventListener('concordia:open-bloodline-tree', handler);
  });

  it('still dispatches concordia:inspect-npc-traits from "Inspect traits" unchanged', () => {
    render(<NPCActionMenu />);
    openMenu('npc_9', 'Orin');

    const handler = vi.fn();
    window.addEventListener('concordia:inspect-npc-traits', handler);

    fireEvent.click(screen.getByText('Inspect traits'));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent<{ npcId: string; npcName: string }>;
    expect(event.detail).toEqual({ npcId: 'npc_9', npcName: 'Orin' });

    window.removeEventListener('concordia:inspect-npc-traits', handler);
  });
});
