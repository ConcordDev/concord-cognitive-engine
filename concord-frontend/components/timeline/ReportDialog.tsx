'use client';

// ReportDialog — S-TL-9 (F12): report a post or a comment. The dialog
// states what a report actually does before you file, and after filing
// it shows the server's own what-happens-next text — the surface never
// promises an outcome the system doesn't deliver. Cancels cleanly:
// Cancel button, backdrop click, or Escape, with nothing filed.

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Flag, Loader2, Check, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';

const REASONS = ['Spam', 'Harassment', 'Misinformation', 'Violence or threats', 'Sexual content', 'Something else'];

interface ReportResult {
  duplicate: boolean;
  nextSteps: string;
}

export function ReportDialog({
  targetType,
  targetId,
  postId,
  authorName,
  onClose,
}: {
  targetType: 'post' | 'comment';
  targetId: string;
  /** The host post — set when reporting a comment from its thread. */
  postId?: string;
  authorName: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [filed, setFiled] = useState<ReportResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reportMutation = useMutation({
    mutationFn: () =>
      lensRun<ReportResult>('timeline', 'report', {
        targetType,
        targetId,
        ...(postId ? { postId } : {}),
        reason: detail.trim() ? `${reason || 'Report'} — ${detail.trim()}` : reason,
      }),
    onSuccess: (r) => {
      if (r.data.ok && r.data.result) {
        setFiled(r.data.result);
      } else {
        useUIStore.getState().addToast({ type: 'error', message: r.data.error || 'Report failed' });
      }
    },
  });

  const canSubmit = (reason.length > 0 || detail.trim().length > 0) && !reportMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Report this ${targetType}`}
    >
      <div
        className="bg-[#242526] rounded-xl w-full max-w-md p-5 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-white font-semibold inline-flex items-center gap-2">
            <Flag className="w-4 h-4 text-amber-400" /> Report this {targetType}
          </h3>
          <button onClick={onClose} className="p-1 rounded-full text-gray-400 hover:text-white hover:bg-[#3a3b3c]" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {filed ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-200 inline-flex items-start gap-2">
              <Check className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
              {filed.duplicate ? 'You already reported this — it is still in the queue.' : 'Report filed.'}
            </p>
            <p className="text-sm text-gray-400">{filed.nextSteps}</p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-full bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Reports are private — {authorName} won&apos;t know it was you. What&apos;s wrong with this {targetType}?
            </p>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setReason(r)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs',
                    reason === r ? 'bg-blue-600 text-white' : 'bg-[#3a3b3c] text-gray-300 hover:bg-[#4a4b4c]',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              placeholder="Add detail for moderation (optional unless no reason above fits)"
              className="w-full bg-[#3a3b3c] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-full text-sm text-gray-300 hover:bg-[#3a3b3c]"
              >
                Cancel
              </button>
              <button
                onClick={() => reportMutation.mutate()}
                disabled={!canSubmit}
                className="px-4 py-1.5 rounded-full bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                {reportMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                File report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
