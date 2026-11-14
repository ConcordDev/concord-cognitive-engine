'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useLensTool } from '@/lib/lens-dock';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { Plus, X, Send, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { shouldIgnoreLensHotkey } from '@/lib/a11y/editable-target';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';

interface QuickCaptureProps {
  domain: string;
}

function QuickCapture({ domain }: QuickCaptureProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();
  const addToast = useUIStore((state) => state.addToast);
  // Opened from the lens header toolbar (no floating trigger of its own).
  useLensTool('capture', useCallback(() => setIsOpen((o) => !o), []));

  // Focus the textarea when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Keyboard shortcut: Cmd/Ctrl + N to toggle capture modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        // A field keeps Ctrl/Cmd+N while the user is typing (FIX-commonsense-004).
        if (shouldIgnoreLensHotkey(e)) return;
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const data = {
        type: 'capture',
        title: title.trim() || content.slice(0, 80),
        data: {
          content,
          source: 'user.capture',
          tags: [domain],
          capturedAt: new Date().toISOString(),
        },
      };
      return apiHelpers.lens.create(domain, data);
    },
    onSuccess: () => {
      setContent('');
      setTitle('');
      setIsOpen(false);
      addToast({ type: 'success', message: 'Captured successfully.' });
      queryClient.invalidateQueries({ queryKey: ['domain-context', domain] });
      queryClient.invalidateQueries({ queryKey: ['lens-data', domain] });
      queryClient.invalidateQueries({ queryKey: ['lens', domain, 'list'] });
    },
    onError: () => {
      addToast({ type: 'error', message: 'Failed to capture. Please try again.' });
    },
  });

  // Captures already in this lens — listed so a capture can be reviewed and
  // removed where it was made. Deleting goes through the canonical verb
  // (lens.delete via useLensData.remove): the artifact and its vault exhaust
  // DTU are removed together, so no orphan is left behind in the lens export
  // or My Vault (FIX-ux-suite-015 family: FIX-commonsense-003 · FIX-docs-006 ·
  // FIX-strategic-adds-004 · FIX-ux-suite-007).
  const { items: captures, remove: removeCapture } = useLensData<{ content?: string }>(domain, 'capture', {
    noSeed: true,
    enabled: isOpen,
    limit: 20,
  });

  const handleDeleteCapture = async (id: string) => {
    try {
      await removeCapture(id);
      addToast({ type: 'success', message: 'Capture deleted.' });
    } catch {
      addToast({ type: 'error', message: 'Could not delete that capture. Please try again.' });
    }
  };

  const handleSubmit = () => {
    if (content.trim()) {
      createMutation.mutate();
    }
  };

  return (
    <>
      {/* Capture Modal */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-end justify-end p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsOpen(false);
            }}
          >
            <motion.div
              initial={{ y: 20, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="w-96 bg-lattice-bg border border-lattice-border rounded-xl shadow-2xl overflow-hidden"
              role="dialog"
              aria-modal="true"
              aria-label={`Quick Capture for ${domain}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between p-3 border-b border-lattice-border">
                <span className="text-sm font-medium text-gray-300">
                  Quick Capture &mdash; {domain}
                </span>
                <button
                  type="button"
                  data-overlay-close=""
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                  aria-label="Close capture"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body */}
              <div className="p-3 space-y-2">
                <input
                  type="text"
                  placeholder="Title (optional)"
                  // FIX-wallet-008: cap the title at the platform's title
                  // limit (INPUT_LIMITS.title = 200) — it accepted 600
                  // chars that the record layer then had to swallow.
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-lattice-surface border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                  disabled={createMutation.isPending}
                />
                <textarea
                  ref={inputRef}
                  placeholder="Capture your thought..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && content.trim()) {
                      e.preventDefault();
                      handleSubmit();
                    }
                  }}
                  className="w-full bg-lattice-surface border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 h-24 resize-none focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                  disabled={createMutation.isPending}
                />

                {/* Footer */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Ctrl+Enter to save</span>
                  <button
                    onClick={handleSubmit}
                    disabled={!content.trim() || createMutation.isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neon-cyan text-white text-sm font-medium hover:bg-neon-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    Capture
                  </button>
                  {!content.trim() && <span role="note" className="text-xs text-gray-400 self-center">Write something to capture.</span>}
                </div>
              </div>

              {/* Captures in this lens — review + delete where they were made */}
              <div className="border-t border-lattice-border p-3">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1.5">Captures in this lens</p>
                {captures.length === 0 ? (
                  <p className="text-xs text-gray-500">No captures yet in this lens.</p>
                ) : (
                  <ul className="max-h-44 overflow-y-auto space-y-1">
                    {captures.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-2 rounded-lg bg-lattice-surface px-2 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-gray-200">{c.title}</p>
                          {typeof c.data?.content === 'string' && c.data.content && (
                            <p className="truncate text-[11px] text-gray-500">{c.data.content}</p>
                          )}
                        </div>
                        <StickyDeleteConfirm
                          onConfirm={() => { void handleDeleteCapture(c.id); }}
                          armLabel="Delete"
                          confirmLabel="Confirm delete?"
                          armAriaLabel={`Delete capture ${c.title}`}
                          className="shrink-0 text-[11px] text-rose-300/80 hover:text-rose-300"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedQuickCapture = withErrorBoundary(QuickCapture);
export { _WrappedQuickCapture as QuickCapture };
