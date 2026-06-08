'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { apiHelpers } from '@/lib/api/client';
import type { ChatRequest } from '@/lib/api/generated-types';
import { cn } from '@/lib/utils';
import { Send, X, Bot, User, AlertCircle, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DomainAssistantProps {
  /** Machine-readable domain key passed as the chat mode (e.g. "music", "research"). */
  domain: string;
  /** Human-readable label shown in the header (e.g. "Music Production"). */
  domainLabel: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: Date;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DomainAssistant({ domain, domainLabel }: DomainAssistantProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ---- Keyboard shortcut: Cmd/Ctrl + / to toggle ----
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ---- Auto-focus input when panel opens ----
  useEffect(() => {
    if (open) {
      // Small delay so the slide animation completes before focusing
      const timer = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // ---- Auto-scroll to bottom on new messages or loading state change ----
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ---- Send a message ----
  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    // Build the full prompt with domain-specialist system context.
    // The backend /api/chat accepts { message, mode } — we send the domain as
    // mode so the server can select the right persona / retrieval scope.
    const systemPrefix = `You are a ${domainLabel} specialist. `;
    const fullMessage = systemPrefix + trimmed;

    try {
      // Prefer apiHelpers.chat.ask for one-shot Q&A; falls back to chat.send.
      let reply: string;
      try {
        const res = await apiHelpers.chat.ask(fullMessage, domain as ChatRequest['mode']);
        const data = res.data;
        reply = data?.reply || data?.answer || data?.response || 'No response received.';
      } catch {
        // Fallback: try the streaming-less chat.send endpoint
        const res = await apiHelpers.chat.send(fullMessage, domain as ChatRequest['mode']);
        const data = res.data;
        reply = data?.reply || data?.answer || data?.response || 'No response received.';
      }

      const assistantMsg: Message = {
        id: `asst-${Date.now()}`,
        role: 'assistant',
        content: reply,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const errorText =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        role: 'error',
        content: `Failed to get a response: ${errorText}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, domain, domainLabel]);

  // ---- Keyboard handling for the input field ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Ctrl/Cmd + Enter to send
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  // ---- Time formatter ----
  const formatTime = (date: Date) =>
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // ---- Determine platform modifier key label ----
  const modKey =
    typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
      ? '\u2318'
      : 'Ctrl';

  return (
    <>
      {/* Toggle button (visible when panel is closed) — positioned above QuickCapture FAB */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-[14rem] right-6 z-40 flex items-center gap-2 px-3 py-2.5 bg-lattice-surface border border-lattice-border text-gray-300 font-medium rounded-full shadow-lg hover:bg-lattice-elevated hover:text-white transition-colors"
          aria-label={`Open ${domainLabel} assistant`}
        >
          <Bot className="w-5 h-5" />
          <span className="hidden sm:inline text-sm">{domainLabel} Assistant</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[10px] font-mono bg-black/20 rounded">
            {modKey} /
          </kbd>
        </button>
      )}

      {/* Slide-out panel */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            {/* Panel */}
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md flex flex-col bg-lattice-bg border-l border-lattice-border shadow-2xl"
              role="dialog"
              aria-label={`${domainLabel} assistant`}
            >
              {/* Header */}
              <header className="flex items-center justify-between px-4 py-3 border-b border-lattice-border bg-lattice-surface">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-neon-cyan/20 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-5 h-5 text-neon-cyan" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-white truncate">
                      {domainLabel} Assistant
                    </h2>
                    <p className="text-xs text-gray-400 truncate">
                      Domain: {domain}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="p-2 rounded-lg hover:bg-lattice-bg text-gray-400 hover:text-white transition-colors"
                  aria-label="Close assistant"
                >
                  <X className="w-5 h-5" />
                </button>
              </header>

              {/* Messages */}
              <div
                className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
                role="log"
                aria-label="Conversation"
                aria-live="polite"
              >
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <div className="w-16 h-16 rounded-full bg-neon-cyan/10 flex items-center justify-center mb-4">
                      <Bot className="w-8 h-8 text-neon-cyan" />
                    </div>
                    <p className="text-sm text-gray-300 font-medium mb-1">
                      {domainLabel} Specialist
                    </p>
                    <p className="text-xs text-gray-400 max-w-xs">
                      Ask me anything about {domainLabel.toLowerCase()}. I have
                      domain-specific context to help you. Press{' '}
                      <kbd className="px-1 py-0.5 text-[10px] font-mono bg-lattice-surface border border-lattice-border rounded">
                        {modKey} /
                      </kbd>{' '}
                      to toggle this panel.
                    </p>
                  </div>
                )}

                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      'flex gap-3',
                      msg.role === 'user' ? 'flex-row-reverse' : '',
                    )}
                  >
                    {/* Avatar */}
                    <div
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                        msg.role === 'user'
                          ? 'bg-neon-purple'
                          : msg.role === 'error'
                            ? 'bg-red-500/20'
                            : 'bg-neon-cyan/20',
                      )}
                    >
                      {msg.role === 'user' ? (
                        <User className="w-4 h-4 text-white" />
                      ) : msg.role === 'error' ? (
                        <AlertCircle className="w-4 h-4 text-red-400" />
                      ) : (
                        <Bot className="w-4 h-4 text-neon-cyan" />
                      )}
                    </div>

                    {/* Bubble */}
                    <div
                      className={cn(
                        'max-w-[80%] rounded-2xl px-4 py-3 text-sm',
                        msg.role === 'user'
                          ? 'bg-neon-purple text-white rounded-br-md'
                          : msg.role === 'error'
                            ? 'bg-red-500/10 border border-red-500/30 text-red-300 rounded-bl-md'
                            : 'bg-lattice-surface border border-lattice-border text-gray-200 rounded-bl-md',
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      <span className="block mt-1 text-[10px] opacity-50 text-right">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Thinking indicator */}
                {isLoading && (
                  <div className="flex gap-3" role="status" aria-label="AI is thinking">
                    <div className="w-8 h-8 rounded-lg bg-neon-cyan/20 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-neon-cyan animate-pulse" />
                    </div>
                    <div className="rounded-2xl rounded-bl-md bg-lattice-surface border border-lattice-border px-4 py-3">
                      <div className="flex items-center gap-2 text-sm text-gray-400">
                        <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />
                        Thinking...
                      </div>
                    </div>
                  </div>
                )}

                {/* Scroll anchor */}
                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="px-4 py-3 border-t border-lattice-border bg-lattice-surface">
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={`Ask the ${domainLabel.toLowerCase()} specialist...`}
                    rows={1}
                    className="flex-1 px-3 py-2 bg-lattice-bg border border-lattice-border rounded-xl text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-neon-cyan max-h-28"
                    disabled={isLoading}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim() || isLoading}
                    className="p-2.5 bg-neon-cyan text-black rounded-xl hover:bg-neon-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    aria-label="Send message"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 text-center mt-2">
                  {modKey}+Enter to send &middot; {modKey}+/ to toggle
                </p>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
