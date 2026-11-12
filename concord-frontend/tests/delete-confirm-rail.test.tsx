/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * FIX-projects-007 — the persistent Ask rail (mounted on every lens via
 * the shell) clears the current chat when "New conversation" is pressed.
 * With messages on screen that is a delete: the button now arms a sticky
 * confirm first and clears nothing until Confirm. An empty chat keeps the
 * one-click start (nothing to lose). Harness mirrors
 * PersistentChatRail.confidence.test.tsx.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/hooks/useSocket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  return {
    useSocket: () => ({
      on: (event: string, cb: (data: unknown) => void) => { (listeners[event] ||= []).push(cb); },
      off: (event: string, cb: (data: unknown) => void) => { listeners[event] = (listeners[event] || []).filter((f) => f !== cb); },
      emit: vi.fn(),
      isConnected: true,
    }),
    __emit: (event: string, data?: unknown) => { (listeners[event] || []).forEach((cb) => cb(data)); },
  };
});
vi.mock('@/hooks/useSessionId', () => ({ useSessionId: () => 'test-session', resetSessionId: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: {} })), get: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast: vi.fn() }) } }));
vi.mock('@/hooks/useConversationMemory', () => ({
  useConversationMemory: () => ({ stats: null, isCompressing: false, forceCompress: vi.fn(), refreshStats: vi.fn() }),
}));
vi.mock('@/components/chat/useCrossLensMemory', () => ({
  useCrossLensMemory: () => ({ recordMessage: vi.fn(), clearTrail: vi.fn(), trail: [], totalLensCount: 0, memoryPreserved: false, toggleMemoryPreserved: vi.fn() }),
}));
vi.mock('@/components/chat/useChatProactive', () => ({
  useChatProactive: () => ({ addDTUNotification: vi.fn(), resetIdleTimer: vi.fn(), dismissAll: vi.fn(), dismissProactive: vi.fn(), proactiveMessages: [] }),
}));
vi.mock('@/components/sovereignty/SovereigntyPrompt', () => ({ SovereigntyPrompt: () => null }));
vi.mock('@/components/common/Skeleton', () => ({ SkeletonChat: () => null }));
vi.mock('@/components/pipeline/PipelineProgress', () => ({ PipelineProgress: () => null }));
vi.mock('@/components/chat/ContextOverlay', () => ({ ContextOverlay: () => null }));
vi.mock('@/components/chat/InitiativeChip', () => ({ InitiativeList: () => null }));
vi.mock('@/components/chat/ChatRouteOverlay', () => ({ default: () => null }));
vi.mock('@/components/chat/ForgeCard', () => ({ default: () => null }));
vi.mock('@/components/chat/ChatModePanels', () => ({
  WelcomePanel: () => null, AssistPanel: () => null, ExplorePanel: () => null, ConnectPanel: () => null,
  ChatPanel: () => null, ModeSelector: () => null, ResponseActions: () => null, CrossLensMemoryBar: () => null, ProactiveChip: () => null,
}));

import { PersistentChatRail } from '@/components/chat/PersistentChatRail';
import * as socketMock from '@/hooks/useSocket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

describe('FIX-projects-007 — rail New conversation confirms before clearing a live chat', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('arm keeps the chat; Confirm clears it', async () => {
    render(<PersistentChatRail currentLens="projects" />);
    act(() => { emitSocket('chat:complete', { sessionId: 'test-session', response: 'An answer worth keeping.' }); });
    expect(await screen.findByText('An answer worth keeping.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    // Armed: confirm is showing, the chat is untouched.
    expect(await screen.findByRole('button', { name: 'Confirm new conversation' })).toBeInTheDocument();
    expect(screen.getByText('An answer worth keeping.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm new conversation' }));
    await waitFor(() => expect(screen.queryByText('An answer worth keeping.')).not.toBeInTheDocument());
  });

  it('an empty chat starts a new conversation in one click (no confirm)', async () => {
    render(<PersistentChatRail currentLens="projects" />);
    const btn = await screen.findByRole('button', { name: 'New conversation' });
    fireEvent.click(btn);
    expect(screen.queryByRole('button', { name: 'Confirm new conversation' })).not.toBeInTheDocument();
  });
});
