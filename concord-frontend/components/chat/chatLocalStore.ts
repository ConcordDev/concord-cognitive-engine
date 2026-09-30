/**
 * Chat lens localStorage persistence helpers.
 * Extracted from app/lenses/chat/page.tsx (lens consolidation playbook).
 */

export interface ChatConversation {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
  messageCount: number;
}

export type ChatMessageLike = {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  [key: string]: unknown;
};

export const ACCEPTED_FILE_TYPES = '.txt,.md,.json,.csv,.pdf,.png,.jpg,.jpeg';
export const MAX_BASE64_SIZE = 512 * 1024; // 512KB — encode files smaller than this

const STORAGE_KEY_CONVERSATIONS = 'concord_chat_conversations';
const STORAGE_KEY_SESSION = 'concord_chat_session';
const STORAGE_KEY_MESSAGES_PREFIX = 'concord_chat_msgs_';

// ──────────────────────────────────────────────
// Helper: UUID generation
// ──────────────────────────────────────────────

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ──────────────────────────────────────────────
// Helper: localStorage-backed conversation registry
// ──────────────────────────────────────────────

export function loadConversations<T extends ChatConversation = ChatConversation>(): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveConversations(convs: ChatConversation[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(convs));
  } catch {
    // Storage full or unavailable
  }
}

export function loadSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY_SESSION);
  } catch {
    return null;
  }
}

export function saveSessionId(id: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEY_SESSION, id);
    } else {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
  } catch {
    // Storage unavailable
  }
}

export function loadMessagesForSession<T = ChatMessageLike>(sessionId: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MESSAGES_PREFIX + sessionId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveMessagesForSession(sessionId: string, messages: ChatMessageLike[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_MESSAGES_PREFIX + sessionId, JSON.stringify(messages));
  } catch {
    // Storage full
  }
}

export function deleteMessagesForSession(sessionId: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_MESSAGES_PREFIX + sessionId);
  } catch {
    // noop
  }
}

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ──────────────────────────────────────────────
// Helper: file to base64
// ──────────────────────────────────────────────

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ──────────────────────────────────────────────
// ConKay macro-execution backport (Unit A5) — see ConKayOverlay.tsx#executeMacro
// for the canonical implementation this mirrors. `newConKayRunId` is the same
// correlation-id shape the overlay stamps onto `lensRun` calls (echoed back on
// the `macro:started`/`macro:completed` socket events so the cockpit's
// telemetry/orchestration-trace panels can bind a step to the REAL backend
// call — never a guessed spinner).
// ──────────────────────────────────────────────

