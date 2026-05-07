/**
 * Session Store — Multi-Session Conversation Workspace
 *
 * All session data lives on-device in IndexedDB. The server never sees
 * session lists, titles, or organization — only individual messages
 * sent for LLM inference.
 *
 * Sessions feed the lattice. The lattice feeds every session.
 * Cross-session intelligence without cross-session contamination.
 */

import { create } from 'zustand';
import { getDB } from '@/lib/offline/db';
import type { ChatSession, SessionMessage } from '@/lib/offline/db';

// ── Types ───────────────────────────────────────────────────────────────────

interface SessionState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  activeMessages: SessionMessage[];
  loading: boolean;
  searchQuery: string;

  // Actions
  init: () => Promise<void>;
  createSession: (title?: string) => Promise<string>;
  switchSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  pinSession: (sessionId: string, pinned: boolean) => Promise<void>;
  archiveSession: (sessionId: string) => Promise<void>;
  unarchiveSession: (sessionId: string) => Promise<void>;
  setFolder: (sessionId: string, folder: string | undefined) => Promise<void>;
  setSearchQuery: (query: string) => void;
  addMessage: (message: Omit<SessionMessage, 'id' | 'sessionId' | 'timestamp'>) => Promise<SessionMessage>;
  getActiveWindow: () => SessionMessage[];
  getSessionMessages: (sessionId: string) => Promise<SessionMessage[]>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  activeMessages: [],
  loading: true,
  searchQuery: '',

  init: async () => {
    try {
      const sessions = await getDB().chatSessions
        .orderBy('updatedAt')
        .reverse()
        .toArray();

      // If no sessions exist, create a default one
      if (sessions.length === 0) {
        const id = generateId('sess');
        const session: ChatSession = {
          id,
          title: 'New Conversation',
          createdAt: nowISO(),
          updatedAt: nowISO(),
          pinned: false,
          archived: false,
          messageCount: 0,
          compressionCount: 0,
        };
        await getDB().chatSessions.put(session);
        const messages = await getDB().sessionMessages
          .where('sessionId')
          .equals(id)
          .sortBy('timestamp');
        set({ sessions: [session], activeSessionId: id, activeMessages: messages, loading: false });
        return;
      }

      // Restore last active session (first non-archived, pinned first)
      const sorted = [...sessions].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
      const active = sorted.find(s => !s.archived) || sorted[0];
      const messages = await getDB().sessionMessages
        .where('sessionId')
        .equals(active.id)
        .sortBy('timestamp');

      set({ sessions, activeSessionId: active.id, activeMessages: messages, loading: false });
    } catch (e) {
      console.error('[Sessions] Init failed:', e);
      set({ loading: false });
    }
  },

  createSession: async (title?: string) => {
    const id = generateId('sess');
    const session: ChatSession = {
      id,
      title: title || 'New Conversation',
      createdAt: nowISO(),
      updatedAt: nowISO(),
      pinned: false,
      archived: false,
      messageCount: 0,
      compressionCount: 0,
    };
    await getDB().chatSessions.put(session);
    set(state => ({
      sessions: [session, ...state.sessions],
      activeSessionId: id,
      activeMessages: [],
    }));
    return id;
  },

  switchSession: async (sessionId: string) => {
    const messages = await getDB().sessionMessages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp');
    set({ activeSessionId: sessionId, activeMessages: messages });
  },

  deleteSession: async (sessionId: string) => {
    await getDB().chatSessions.delete(sessionId);
    await getDB().sessionMessages.where('sessionId').equals(sessionId).delete();
    const state = get();
    const remaining = state.sessions.filter(s => s.id !== sessionId);

    if (state.activeSessionId === sessionId) {
      if (remaining.length === 0) {
        // Create a new default session
        const _newId = await get().createSession();
        set({ sessions: get().sessions });
        return;
      }
      await get().switchSession(remaining[0].id);
    }
    set({ sessions: remaining });
  },

  renameSession: async (sessionId: string, title: string) => {
    await getDB().chatSessions.update(sessionId, { title, updatedAt: nowISO() });
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, title, updatedAt: nowISO() } : s
      ),
    }));
  },

  pinSession: async (sessionId: string, pinned: boolean) => {
    await getDB().chatSessions.update(sessionId, { pinned });
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, pinned } : s
      ),
    }));
  },

  archiveSession: async (sessionId: string) => {
    await getDB().chatSessions.update(sessionId, { archived: true });
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, archived: true } : s
      ),
    }));
    // If archived the active session, switch to another
    if (get().activeSessionId === sessionId) {
      const next = get().sessions.find(s => !s.archived && s.id !== sessionId);
      if (next) await get().switchSession(next.id);
      else await get().createSession();
    }
  },

  unarchiveSession: async (sessionId: string) => {
    await getDB().chatSessions.update(sessionId, { archived: false, updatedAt: nowISO() });
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, archived: false, updatedAt: nowISO() } : s
      ),
    }));
  },

  setFolder: async (sessionId: string, folder: string | undefined) => {
    await getDB().chatSessions.update(sessionId, { folder });
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, folder } : s
      ),
    }));
  },

  setSearchQuery: (query: string) => set({ searchQuery: query }),

  addMessage: async (msg) => {
    const state = get();
    if (!state.activeSessionId) throw new Error('No active session');

    const message: SessionMessage = {
      id: generateId('msg'),
      sessionId: state.activeSessionId,
      timestamp: nowISO(),
      ...msg,
    };

    await getDB().sessionMessages.put(message);

    // Update session metadata
    const preview = msg.content.slice(0, 80);
    const session = state.sessions.find(s => s.id === state.activeSessionId);
    const newCount = (session?.messageCount || 0) + 1;

    await getDB().chatSessions.update(state.activeSessionId, {
      updatedAt: nowISO(),
      messageCount: newCount,
      lastMessagePreview: preview,
    });

    // Auto-title from first user message
    if (msg.role === 'user' && session && session.title === 'New Conversation' && newCount <= 2) {
      const autoTitle = msg.content.slice(0, 60).trim() || 'New Conversation';
      await getDB().chatSessions.update(state.activeSessionId, { title: autoTitle });
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === state.activeSessionId ? { ...s, title: autoTitle, messageCount: newCount, lastMessagePreview: preview, updatedAt: nowISO() } : s
        ),
      }));
    } else {
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === state.activeSessionId ? { ...s, messageCount: newCount, lastMessagePreview: preview, updatedAt: nowISO() } : s
        ),
      }));
    }

    set(state => ({
      activeMessages: [...state.activeMessages, message],
    }));

    return message;
  },

  getActiveWindow: () => {
    const WINDOW_SIZE = 30;
    const messages = get().activeMessages;
    return messages.slice(-WINDOW_SIZE);
  },

  getSessionMessages: async (sessionId: string) => {
    return getDB().sessionMessages
      .where('sessionId')
      .equals(sessionId)
      .sortBy('timestamp');
  },
}));
