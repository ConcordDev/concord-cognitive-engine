/**
 * Theme 4 (game-feel pass): QuestTracker breadcrumb mode tests.
 *
 * Pins:
 *   - Default mode is breadcrumb (single-line summary)
 *   - Press J → expands to list mode; preference persists in localStorage
 *   - Press J again → returns to breadcrumb
 *   - "ready to claim" quests (all objectives done) surface in breadcrumb
 *     with the Claim button visible
 *   - Typing 'j' in an input does NOT toggle (focus-aware)
 *   - Empty quest list → renders nothing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { QuestTracker } from '@/components/world/QuestTracker';

const STORAGE_KEY = 'concordia:questTracker:mode';

// Sample quest fixture: 1 incomplete objective + 1 complete + 1 ready-to-claim
const MOCK_QUESTS = [
  {
    id: 'q1',
    title: 'Defeat the Ember Sprites',
    status: 'active',
    progress: [
      {
        id: 'o1', type: 'kill', target: 'ember_sprite', required_count: 3,
        description: 'Defeat 3 Ember Sprites', current_count: 1,
      },
    ],
    rewards: [],
  },
];
const READY_QUEST = [
  {
    id: 'q2', title: 'Cook Your First Meal', status: 'active',
    progress: [
      { id: 'o2', type: 'gather', target: 'herb', required_count: 1, description: 'Done', current_count: 1, obj_completed_at: 1234567890 },
    ],
    rewards: [],
  },
];

function mockFetchQuests(quests: unknown[]) {
  vi.spyOn(global, 'fetch').mockImplementation((async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes('/quests/active')) {
      return new Response(JSON.stringify({ quests }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch);
}

// The vitest setup file mocks localStorage as vi.fn() stubs (no internal
// store). For these tests we install a real Map-backed shim so getItem
// reflects setItem within the test.
function installLocalStorageShim(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const getItem = vi.fn((k: string) => (store.has(k) ? store.get(k)! : null));
  const setItem = vi.fn((k: string, v: string) => { store.set(k, String(v)); });
  const removeItem = vi.fn((k: string) => { store.delete(k); });
  const clear = vi.fn(() => { store.clear(); });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: { getItem, setItem, removeItem, clear, length: store.size, key: () => null },
  });
  return { getItem, setItem, removeItem, clear, store };
}

describe('QuestTracker — breadcrumb mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when there are no quests', async () => {
    installLocalStorageShim();
    mockFetchQuests([]);
    const { container } = render(<QuestTracker worldId="concordia-hub" onClaimReward={() => {}} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(container.querySelector('[data-testid="quest-breadcrumb"]')).toBeNull();
    expect(container.querySelector('[data-testid="quest-list"]')).toBeNull();
  });

  it('default mode is breadcrumb (single-line summary)', async () => {
    installLocalStorageShim();
    mockFetchQuests(MOCK_QUESTS);
    render(<QuestTracker worldId="concordia-hub" onClaimReward={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByTestId('quest-breadcrumb')).not.toBeNull();
    });
    expect(screen.queryByTestId('quest-list')).toBeNull();
    // Renders the objective description
    expect(screen.getByText(/Defeat 3 Ember Sprites/)).not.toBeNull();
    // Counter
    expect(screen.getByText('1/3')).not.toBeNull();
  });

  it('press J toggles to list mode and persists in localStorage', async () => {
    const ls = installLocalStorageShim();
    mockFetchQuests(MOCK_QUESTS);
    render(<QuestTracker worldId="concordia-hub" onClaimReward={() => {}} />);
    await waitFor(() => screen.getByTestId('quest-breadcrumb'));

    // Press J
    await act(async () => {
      fireEvent.keyDown(window, { key: 'j' });
    });

    // Now in list mode
    await waitFor(() => {
      expect(screen.queryByTestId('quest-list')).not.toBeNull();
    });
    expect(screen.queryByTestId('quest-breadcrumb')).toBeNull();
    expect(ls.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'list');
    expect(ls.store.get(STORAGE_KEY)).toBe('list');

    // Press J again → back to breadcrumb
    await act(async () => {
      fireEvent.keyDown(window, { key: 'J' });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('quest-breadcrumb')).not.toBeNull();
    });
    expect(ls.store.get(STORAGE_KEY)).toBe('breadcrumb');
  });

  it('hydrates from localStorage on mount', async () => {
    installLocalStorageShim({ [STORAGE_KEY]: 'list' });
    mockFetchQuests(MOCK_QUESTS);
    render(<QuestTracker worldId="concordia-hub" onClaimReward={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByTestId('quest-list')).not.toBeNull();
    });
  });

  it('forceMode prop overrides localStorage and prevents toggling', async () => {
    installLocalStorageShim({ [STORAGE_KEY]: 'list' });
    mockFetchQuests(MOCK_QUESTS);
    render(<QuestTracker worldId="concordia-hub" onClaimReward={() => {}} forceMode="breadcrumb" />);
    await waitFor(() => {
      expect(screen.queryByTestId('quest-breadcrumb')).not.toBeNull();
    });
    // J press should NOT toggle when forceMode is set
    await act(async () => {
      fireEvent.keyDown(window, { key: 'j' });
    });
    expect(screen.queryByTestId('quest-breadcrumb')).not.toBeNull();
    expect(screen.queryByTestId('quest-list')).toBeNull();
  });

  it('typing j in an input does NOT toggle modes', async () => {
    installLocalStorageShim();
    mockFetchQuests(MOCK_QUESTS);
    render(<QuestTracker worldId="concordia-hub" onClaimReward={() => {}} />);
    await waitFor(() => screen.getByTestId('quest-breadcrumb'));

    // Create + focus an input element, then dispatch the key from it
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await act(async () => {
      fireEvent.keyDown(input, { key: 'j' });
    });

    // Still in breadcrumb mode
    expect(screen.queryByTestId('quest-breadcrumb')).not.toBeNull();
    expect(screen.queryByTestId('quest-list')).toBeNull();
    document.body.removeChild(input);
  });

  it('ready-to-claim quest surfaces with Claim button in breadcrumb', async () => {
    installLocalStorageShim();
    mockFetchQuests(READY_QUEST);
    render(<QuestTracker worldId="concordia-hub" onClaimReward={() => {}} />);
    await waitFor(() => {
      expect(screen.queryByText(/Reward ready/)).not.toBeNull();
    });
    expect(screen.queryByText(/Claim/)).not.toBeNull();
  });
});
