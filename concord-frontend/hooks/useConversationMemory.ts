/**
 * NOTE: This hook is not currently imported by any production component.
 * It is intended for chat-related pages that need rolling window compression
 * and server-side memory management. Wire into the chat page or conversation
 * view when the memory compression feature is enabled.
 *
 * useConversationMemory — Rolling Window Compression Hook
 *
 * Monitors the active session's message count and triggers server-side
 * compression when the window threshold is reached. Also exposes
 * memory stats for the UI.
 *
 * The hook sends messages to the server for LLM inference but keeps
 * session organization, message storage, and conversation DTUs in
 * IndexedDB. The server compresses messages into structured DTUs
 * that enter the lattice and get pulled back by the context engine.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionStore } from '@/store/sessions';

// ── Types ───────────────────────────────────────────────────────────────────

interface MemoryStats {
  activeMessages: number;
  totalMessagesProcessed: number;
  compressionCycles: number;
  memoryDtuCount: number;
  megaCount: number;
  topics: string[];
  windowUtilization: string;
}

interface ConversationMemoryState {
  stats: MemoryStats | null;
  isCompressing: boolean;
  error: string | null;
  sendMessage: (content: string, imageBase64?: string) => Promise<string | null>;
  forceCompress: () => Promise<void>;
  refreshStats: () => Promise<void>;
}

// ── Constants ───────────────────────────────────────────────────────────────

const WINDOW_THRESHOLD = 50;
const _ACTIVE_WINDOW = 30;

// ── Hook ────────────────────────────────────────────────────────────────────

export function useConversationMemory(): ConversationMemoryState {
  const { activeSessionId, addMessage, getActiveWindow } = useSessionStore();
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compressionInFlight = useRef(false);

  // Fetch memory stats from server
  const refreshStats = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const res = await fetch(`/api/chat/memory/${activeSessionId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.ok) setStats(data);
      }
    } catch {
      // Stats are best-effort
    }
  }, [activeSessionId]);

  // Refresh stats when session changes
  useEffect(() => {
    refreshStats();
  }, [activeSessionId, refreshStats]);

  // Send a message: stores locally, sends to server for inference, stores response
  const sendMessage = useCallback(async (content: string, imageBase64?: string): Promise<string | null> => {
    if (!activeSessionId) return null;
    setError(null);

    // Store user message locally
    await addMessage({ role: 'user', content, imageBase64 });

    // Build the active window for server context
    const window = getActiveWindow();
    const windowMessages = window.map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      // Send to server — only the active window, not the full history
      const res = await fetch('/api/brain/conscious/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          sessionId: activeSessionId,
          imageBase64,
          // The server uses its own session state for context,
          // but we tell it the client-side window for reference
          clientWindowSize: windowMessages.length,
        }),
      });

      if (!res.ok) {
        setError(`Server error: ${res.status}`);
        return null;
      }

      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Unknown error');
        return null;
      }

      // Store assistant response locally
      const reply = data.reply || data.content || '';
      await addMessage({
        role: 'assistant',
        content: reply,
        meta: {
          source: data.source,
          model: data.model,
          visionUsed: data.visionUsed,
          webAugmented: data.webAugmented,
        },
      });

      // Check if compression is needed (client-side threshold check)
      const currentCount = useSessionStore.getState().activeMessages.length;
      if (currentCount >= WINDOW_THRESHOLD && !compressionInFlight.current) {
        compressionInFlight.current = true;
        // Trigger server-side compression (fire and forget)
        triggerCompression(activeSessionId).finally(() => {
          compressionInFlight.current = false;
          refreshStats();
        });
      }

      return reply;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setError(msg);
      return null;
    }
  }, [activeSessionId, addMessage, getActiveWindow, refreshStats]);

  // Force compression
  const forceCompress = useCallback(async () => {
    if (!activeSessionId || isCompressing) return;
    setIsCompressing(true);
    try {
      await triggerCompression(activeSessionId);
      await refreshStats();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compression failed');
    } finally {
      setIsCompressing(false);
    }
  }, [activeSessionId, isCompressing, refreshStats]);

  return { stats, isCompressing, error, sendMessage, forceCompress, refreshStats };
}

// ── Internal ────────────────────────────────────────────────────────────────

async function triggerCompression(sessionId: string): Promise<void> {
  try {
    const res = await fetch(`/api/chat/memory/${sessionId}/compress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.warn('[ConversationMemory] Compression request failed:', res.status);
    }
  } catch {
    // Non-blocking — compression is best-effort
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

export type { MemoryStats, ConversationMemoryState };
