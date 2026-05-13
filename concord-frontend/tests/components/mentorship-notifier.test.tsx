/**
 * Tier-2 frontend test for MentorshipNotifier.
 *
 * Pins:
 *   - Renders nothing until a mentorship:npc-adopted event fires
 *   - Renders the toast with the npcId + newName + revisionNum
 *   - Dismiss button removes the toast
 *   - Multiple events stack (up to 5)
 *
 * Note: we mock socket.io-client to expose the registered handler so
 * we can fire payloads directly without a real socket.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { MentorshipNotifier } from '@/components/world/concordia-hud/MentorshipNotifier';

let lastHandler: ((p: Record<string, unknown>) => void) | null = null;

vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, handler: (p: Record<string, unknown>) => void) => {
      if (event === 'mentorship:npc-adopted') lastHandler = handler;
    },
    disconnect: () => {},
  }),
}));

beforeEach(() => {
  lastHandler = null;
});

describe('MentorshipNotifier', () => {
  it('renders nothing initially', async () => {
    const { container } = render(<MentorshipNotifier />);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="mentorship-notifier"]')).toBeNull();
  });

  it('shows a toast when mentorship:npc-adopted fires', async () => {
    const { container } = render(<MentorshipNotifier />);
    await act(async () => { await Promise.resolve(); });
    expect(lastHandler).not.toBeNull();
    await act(async () => {
      lastHandler!({
        npcId: 'hild',
        recipeDtuId: 'dtu_recipe_42',
        witnessedFromDtuId: 'dtu_player_lineage_7',
        newName: 'striking_river_rev3',
        revisionNum: 3,
        ts: Date.now(),
      });
    });
    const wrap = container.querySelector('[data-testid="mentorship-notifier"]');
    expect(wrap).not.toBeNull();
    expect(container.textContent).toMatch(/hild adopted a pattern/i);
    expect(container.textContent).toMatch(/striking_river_rev3/);
    expect(container.textContent).toMatch(/rev 3/);
  });

  it('dismiss button removes the toast', async () => {
    const { container } = render(<MentorshipNotifier />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      lastHandler!({ npcId: 'aldra', recipeDtuId: 'r', witnessedFromDtuId: 'w', ts: Date.now() });
    });
    const dismiss = container.querySelector('button[aria-label="Dismiss"]') as HTMLButtonElement;
    expect(dismiss).not.toBeNull();
    fireEvent.click(dismiss);
    expect(container.querySelector('[data-adoption-id]')).toBeNull();
  });

  it('stacks multiple adoption events', async () => {
    const { container } = render(<MentorshipNotifier />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      lastHandler!({ npcId: 'a', recipeDtuId: 'r1', witnessedFromDtuId: 'w', ts: Date.now() });
      lastHandler!({ npcId: 'b', recipeDtuId: 'r2', witnessedFromDtuId: 'w', ts: Date.now() });
      lastHandler!({ npcId: 'c', recipeDtuId: 'r3', witnessedFromDtuId: 'w', ts: Date.now() });
    });
    const items = container.querySelectorAll('[data-adoption-id]');
    expect(items.length).toBe(3);
  });
});
