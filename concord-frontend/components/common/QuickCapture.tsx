'use client';

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { Plus, X, Send, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
    },
    onError: () => {
      addToast({ type: 'error', message: 'Failed to capture. Please try again.' });
    },
  });

  const handleSubmit = () => {
    if (content.trim()) {
      createMutation.mutate();
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-neon-cyan text-white shadow-lg shadow-neon-cyan/30 flex items-center justify-center hover:bg-neon-cyan/90 transition-colors"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            title="Quick Capture (Ctrl+N)"
            aria-label="Quick Capture"
          >
            <Plus className="w-6 h-6" />
          </motion.button>
        )}
      </AnimatePresence>

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
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
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
                  <span className="text-xs text-gray-500">Ctrl+Enter to save</span>
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
                </div>
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
