// Authored branching dialogue walk (2026-06-26). 23 hand-authored trees load at
// boot but the dialogue route only ever surfaced the flat greeting — the
// branching conversation (nodes + playerOptions) never reached players. The
// /dialogue response now ships the tree and NPCDialogue walks it client-side.
// This drives the walk: opening line → branch → terminal → Leave.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NPCDialogue } from '@/components/world/NPCDialogue';

const TREE = {
  greeting: 'He stands at a cold forge, hammer against his knee.',
  nodes: [
    {
      id: 'node_open',
      npcText: 'State your business.',
      playerOptions: [
        { text: 'Tell me about the truce.', leadsTo: 'node_truce' },
        { text: 'Nothing. Walking through.', leadsTo: 'node_close' },
      ],
    },
    {
      id: 'node_truce',
      npcText: 'She claimed the ground. He agreed. That mattered.',
      playerOptions: [{ text: 'Goodbye.', leadsTo: 'node_close' }],
    },
    { id: 'node_close', npcText: 'Mind the embers.', playerOptions: [] },
  ],
};

function mockDialogueResponse(tree: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      ok: true, npcId: 'coalition_enforcer', npcName: 'The Enforcer',
      greeting: TREE.greeting, mood: 'neutral',
      options: [{ label: 'Leave', key: 'goodbye' }],
      dialogueTree: tree,
    }),
  })) as unknown as typeof fetch);
}

const NPC = { id: 'coalition_enforcer', name: 'The Enforcer', archetype: 'blacksmith' };

describe('NPCDialogue — authored branching tree walk', () => {
  beforeEach(() => {
    // Mute TTS so speak() short-circuits (no Piper/VAD dynamic-import noise).
    sessionStorage.setItem('npc-tts-muted', 'true');
  });
  afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

  it('renders the opening node line + its branch options (not the flat option)', async () => {
    mockDialogueResponse(TREE);
    render(<NPCDialogue npc={NPC} worldId="concordia-hub" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('State your business.')).toBeTruthy());
    // Branch options come from the node, not the flat {label:'Leave'} fallback.
    expect(screen.getByText('Tell me about the truce.')).toBeTruthy();
    expect(screen.getByText('Nothing. Walking through.')).toBeTruthy();
    // The authored greeting shows as italic scene-setting context.
    expect(screen.getByText(TREE.greeting)).toBeTruthy();
  });

  it('navigates to the linked node when a branch is chosen (no server round-trip)', async () => {
    mockDialogueResponse(TREE);
    const fetchSpy = global.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<NPCDialogue npc={NPC} worldId="concordia-hub" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('State your business.')).toBeTruthy());
    const callsBefore = fetchSpy.mock.calls.length;

    fireEvent.click(screen.getByText('Tell me about the truce.'));
    await waitFor(() => expect(screen.getByText(/She claimed the ground/)).toBeTruthy());
    // The walk is purely client-side — no extra fetch for the branch.
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);
  });

  it('a terminal node offers only Leave, which closes the dialogue', async () => {
    mockDialogueResponse(TREE);
    const onClose = vi.fn();
    render(<NPCDialogue npc={NPC} worldId="concordia-hub" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('State your business.')).toBeTruthy());

    fireEvent.click(screen.getByText('Nothing. Walking through.'));
    await waitFor(() => expect(screen.getByText('Mind the embers.')).toBeTruthy());
    // Terminal node → only Leave.
    const leave = screen.getByText('Leave');
    expect(leave).toBeTruthy();
    fireEvent.click(leave);
    expect(onClose).toHaveBeenCalled();
  });

  it('falls back to flat options when the NPC has no authored tree', async () => {
    mockDialogueResponse(undefined);
    render(<NPCDialogue npc={NPC} worldId="concordia-hub" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Leave')).toBeTruthy());
    // No tree → the node line never appears.
    expect(screen.queryByText('State your business.')).toBeNull();
  });
});
