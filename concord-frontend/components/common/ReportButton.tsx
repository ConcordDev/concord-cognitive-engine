'use client';

/**
 * ReportButton — Universal abuse/content reporting for any DTU, post, or artifact.
 *
 * Submits to POST /api/moderation/report with category + reason.
 * Available on every piece of user-generated content.
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flag, X, Loader2, Check, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ReportButtonProps {
  /** ID of the content being reported */
  contentId: string;
  /** Type of content: 'dtu', 'post', 'artifact', 'message', 'comment' */
  contentType: 'dtu' | 'post' | 'artifact' | 'message' | 'comment';
  /** Compact mode (icon only) */
  compact?: boolean;
  className?: string;
}

const REPORT_CATEGORIES = [
  { id: 'spam', label: 'Spam', desc: 'Unwanted or repetitive content' },
  { id: 'harassment', label: 'Harassment', desc: 'Targeting or bullying a person' },
  { id: 'hate_speech', label: 'Hate Speech', desc: 'Attacks based on identity' },
  { id: 'violence', label: 'Violence', desc: 'Threats or promotion of violence' },
  { id: 'sexual_content', label: 'Sexual Content', desc: 'Explicit or inappropriate material' },
  { id: 'misinformation', label: 'Misinformation', desc: 'False or misleading claims' },
  { id: 'copyright', label: 'Copyright', desc: 'Unauthorized use of copyrighted material' },
  { id: 'impersonation', label: 'Impersonation', desc: 'Pretending to be someone else' },
  { id: 'self_harm', label: 'Self-Harm', desc: 'Content promoting self-harm' },
  { id: 'other', label: 'Other', desc: 'Something else not listed' },
];

export function ReportButton({
  contentId,
  contentType,
  compact = false,
  className,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!selectedCategory) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/api/moderation/report', {
        contentId,
        contentType,
        category: selectedCategory,
        reason: reason.trim() || undefined,
      });
      setSubmitted(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to submit report';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [contentId, contentType, selectedCategory, reason]);

  const handleClose = useCallback(() => {
    setOpen(false);
    // Reset after animation
    setTimeout(() => {
      setSelectedCategory(null);
      setReason('');
      setSubmitted(false);
      setError(null);
    }, 200);
  }, []);

  return (
    <>
      {/* Trigger */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'text-gray-600 hover:text-red-400 transition-colors',
          compact ? 'p-1' : 'flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-red-500/10',
          className,
        )}
        title="Report content"
      >
        <Flag className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        {!compact && <span>Report</span>}
      </button>

      {/* Modal */}
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-50 bg-black/50" onClick={handleClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-x-4 top-[20%] mx-auto max-w-md z-50 bg-lattice-surface border border-lattice-border rounded-2xl shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-lattice-border">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <h3 className="text-sm font-semibold">Report Content</h3>
                </div>
                <button onClick={handleClose} className="text-gray-500 hover:text-white p-1" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {submitted ? (
                /* Success */
                <div className="p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6" />
                  </div>
                  <p className="text-sm text-gray-300">Report submitted. Our moderation team will review it.</p>
                  <button onClick={handleClose} className="text-xs text-neon-cyan hover:underline">
                    Close
                  </button>
                </div>
              ) : (
                /* Form */
                <div className="p-4 space-y-3">
                  <p className="text-xs text-gray-500">Select a reason for reporting:</p>

                  <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                    {REPORT_CATEGORIES.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={cn(
                          'text-left px-3 py-2 rounded-lg text-xs transition-colors border',
                          selectedCategory === cat.id
                            ? 'border-red-400/40 bg-red-500/10 text-red-300'
                            : 'border-transparent bg-lattice-deep text-gray-400 hover:bg-lattice-elevated hover:text-gray-300'
                        )}
                      >
                        <p className="font-medium">{cat.label}</p>
                        <p className="text-[10px] text-gray-600 mt-0.5">{cat.desc}</p>
                      </button>
                    ))}
                  </div>

                  {selectedCategory && (
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Additional details (optional)..."
                      rows={2}
                      className="w-full bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-xs text-white placeholder:text-gray-600 resize-none focus:outline-none focus:border-red-400/40"
                    />
                  )}

                  {error && (
                    <p className="text-xs text-red-400">{error}</p>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={!selectedCategory || submitting}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-4 h-4" />}
                    Submit Report
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

export default ReportButton;
