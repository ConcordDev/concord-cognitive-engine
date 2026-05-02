'use client';

/**
 * ReportButton — Universal report button for any user content.
 *
 * Appears on every piece of user-generated content (DTUs, posts,
 * listings, comments, etc.). Opens a report modal with reason selection.
 *
 * Two-tap compliant: Tap 1 = see button, Tap 2 = submit report.
 */

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Flag, X, Loader2, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or misleading' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'copyright', label: 'Copyright infringement' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'fraud', label: 'Fraud or scam' },
  { value: 'other', label: 'Other' },
] as const;

interface ReportButtonProps {
  contentId: string;
  contentType?: string;
  creatorId?: string;
  compact?: boolean;
  className?: string;
}

function ReportButton({
  contentId,
  contentType = 'content',
  creatorId,
  compact = false,
  className,
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: { contentId: string; reason: string; details?: string }) =>
      api
        .post('/api/moderation/report', {
          contentId: data.contentId,
          contentType,
          creatorId,
          reason: data.reason,
          description: data.details || '',
        })
        .then((r) => r.data),
    onSuccess: () => {
      setSubmitted(true);
      setTimeout(() => {
        setOpen(false);
        setSubmitted(false);
        setReason('');
        setDetails('');
      }, 1500);
    },
  });

  const handleSubmit = useCallback(() => {
    if (!reason) return;
    mutation.mutate({ contentId, reason, details });
  }, [contentId, reason, details, mutation]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 transition-colors min-h-[44px] min-w-[44px] justify-center',
          compact
            ? 'p-2 text-gray-500 hover:text-red-400'
            : 'px-3 py-2 text-sm text-gray-500 hover:text-red-400 rounded-lg hover:bg-red-400/10',
          className
        )}
        aria-label="Report content"
        title="Report"
      >
        <Flag className="w-4 h-4" />
        {!compact && <span>Report</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--bg-surface,#141416)] border border-[var(--border-default,rgba(240,237,232,0.10))] rounded-t-2xl sm:rounded-2xl p-6 w-full max-w-md sm:mx-4"
            >
              {submitted ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-3" />
                  <p className="text-[var(--text-primary,#F0EDE8)] font-medium">Report submitted</p>
                  <p className="text-[var(--text-secondary,#9B978F)] text-sm mt-1">
                    We&apos;ll review this within 24 hours.
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-[var(--text-primary,#F0EDE8)]">
                      Report Content
                    </h3>
                    <button
                      onClick={() => setOpen(false)}
                      className="p-2 text-gray-500 hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-3 mb-4">
                    {REPORT_REASONS.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => setReason(r.value)}
                        className={cn(
                          'w-full text-left px-4 py-3 rounded-xl text-sm transition-colors min-h-[44px]',
                          reason === r.value
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-[var(--bg-raised,#1C1C20)] text-[var(--text-secondary,#9B978F)] hover:text-[var(--text-primary,#F0EDE8)] border border-transparent'
                        )}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>

                  {reason === 'other' && (
                    <textarea
                      value={details}
                      onChange={(e) => setDetails(e.target.value)}
                      placeholder="Describe the issue..."
                      rows={3}
                      className="w-full px-4 py-3 bg-[var(--bg-raised,#1C1C20)] border border-[var(--border-default)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-tertiary,#5C584F)] text-sm resize-none mb-4 focus:outline-none focus:border-red-400"
                    />
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={!reason || mutation.isPending}
                    className="w-full px-4 py-3 bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl font-medium text-sm hover:bg-red-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px] flex items-center justify-center gap-2"
                  >
                    {mutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Flag className="w-4 h-4" />
                    )}
                    Submit Report
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedReportButton = withErrorBoundary(ReportButton);
export { _WrappedReportButton as ReportButton };
