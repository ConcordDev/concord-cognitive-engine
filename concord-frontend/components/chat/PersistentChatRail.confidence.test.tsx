/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * INC-152 — the PersistentChatRail must show the backup-model low-confidence
 * label when the server's socket chat:complete payload carries
 * answerConfidence: 'low', and must not show it otherwise. The server decides
 * (server/lib/answer-confidence.js); the rail only maps and renders.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('@/hooks/useSocket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  return {
    useSocket: () => ({
      on: (event: string, cb: (data: unknown) => void) => {
        (listeners[event] ||= []).push(cb);
      },
      off: (event: string, cb: (data: unknown) => void) => {
        listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
      },
      emit: vi.fn(),
      isConnected: true,
    }),
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

vi.mock('@/hooks/useSessionId', () => ({
  useSessionId: () => 'test-session',
  resetSessionId: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(() => Promise.resolve({ data: {} })), get: vi.fn(() => Promise.resolve({ data: {} })) },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: { getState: () => ({ addToast: vi.fn() }) },
}));

vi.mock('@/hooks/useConversationMemory', () => ({
  useConversationMemory: () => ({
    stats: null,
    isCompressing: false,
    forceCompress: vi.fn(),
    refreshStats: vi.fn(),
  }),
}));

vi.mock('./useCrossLensMemory', () => ({
  useCrossLensMemory: () => ({
    recordMessage: vi.fn(),
    clearTrail: vi.fn(),
    trail: [],
    totalLensCount: 0,
    memoryPreserved: false,
    toggleMemoryPreserved: vi.fn(),
  }),
}));

vi.mock('./useChatProactive', () => ({
  useChatProactive: () => ({
    addDTUNotification: vi.fn(),
    resetIdleTimer: vi.fn(),
    dismissAll: vi.fn(),
    dismissProactive: vi.fn(),
    proactiveMessages: [],
  }),
}));

vi.mock('@/components/sovereignty/SovereigntyPrompt', () => ({ SovereigntyPrompt: () => null }));
vi.mock('@/components/common/Skeleton', () => ({ SkeletonChat: () => null }));
vi.mock('@/components/pipeline/PipelineProgress', () => ({ PipelineProgress: () => null }));
vi.mock('./ContextOverlay', () => ({ ContextOverlay: () => null }));
vi.mock('./InitiativeChip', () => ({ InitiativeList: () => null }));
vi.mock('./ChatRouteOverlay', () => ({ default: () => null }));
vi.mock('./ForgeCard', () => ({ default: () => null }));
vi.mock('./ChatModePanels', () => ({
  WelcomePanel: () => null,
  AssistPanel: () => null,
  ExplorePanel: () => null,
  ConnectPanel: () => null,
  ChatPanel: () => null,
  ModeSelector: () => null,
  ResponseActions: () => null,
  CrossLensMemoryBar: () => null,
  ProactiveChip: () => null,
}));

import { PersistentChatRail } from '@/components/chat/PersistentChatRail';
import * as socketMock from '@/hooks/useSocket';

const emitSocket = (event: string, data?: unknown) =>
  (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(event, data);

const REASON = 'GPU brain offline — answered by small local model';

describe('PersistentChatRail — low-confidence label (INC-152)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the label when chat:complete carries answerConfidence low', () => {
    render(<PersistentChatRail currentLens="chat" />);
    act(() => {
      emitSocket('chat:complete', {
        sessionId: 'test-session',
        response: 'A short backup-model reply.',
        answerConfidence: 'low',
        answerConfidenceReason: REASON,
      });
    });
    expect(screen.getByText('Low confidence, backup model')).toBeInTheDocument();
    expect(screen.getByText('A short backup-model reply.')).toBeInTheDocument();
  });

  it('shows no label when chat:complete carries no tag', () => {
    render(<PersistentChatRail currentLens="chat" />);
    act(() => {
      emitSocket('chat:complete', {
        sessionId: 'test-session',
        response: 'A normal pod reply.',
      });
    });
    expect(screen.getByText('A normal pod reply.')).toBeInTheDocument();
    expect(screen.queryByText('Low confidence, backup model')).not.toBeInTheDocument();
  });
});
