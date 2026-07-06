/**
 * Dead-event-listener fix (verification-audit campaign): WhiteboardCollabPanel's
 * "Live" tab merges pushed presence/reaction updates (threaded down from
 * useWhiteboardCollab via CollabBoardSection) on top of its existing 10s poll,
 * so participants who never poll-refreshed still see live data, and peer
 * reactions are attributed to the sender instead of only ever reading "Sent X".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: { participants: [], selfId: 'me' } } })),
}));

import { WhiteboardCollabPanel } from '@/components/whiteboard/WhiteboardCollabPanel';

describe('WhiteboardCollabPanel — Live tab receives pushed presence + reactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a peer surfaced only via livePresence (not yet in a poll response)', async () => {
    const { getByText, getAllByText, container } = render(
      <WhiteboardCollabPanel
        boardId="board-1"
        shapes={[]}
        livePresence={{ 'user-2': { userId: 'user-2', name: 'Riko', color: '#ff0000', x: 12, y: 34, updatedAt: Date.now() } }}
        lastPeerReaction={null}
      />,
    );

    // Switch to the Live tab.
    const liveTabButton = getAllByText('Live')[0];
    fireEvent.click(liveTabButton);

    await waitFor(() => {
      expect(getByText('Riko')).toBeTruthy();
      expect(container.textContent).toContain('12, 34');
    });
  });

  it('attributes a peer reaction to its sender, not the local "Sent" phrasing', async () => {
    const { getByText, getAllByText } = render(
      <WhiteboardCollabPanel
        boardId="board-1"
        shapes={[]}
        livePresence={{}}
        lastPeerReaction={{ id: 'rxn-1', emoji: '🎉', x: 0, y: 0, authorId: 'user-2', authorName: 'Riko', ts: Date.now() }}
      />,
    );

    const liveTabButton = getAllByText('Live')[0];
    fireEvent.click(liveTabButton);

    await waitFor(() => {
      expect(getByText('Riko sent 🎉')).toBeTruthy();
    });
  });
});
