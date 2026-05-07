'use client';

/**
 * ShareButton — Universal share/copy-link button for any content.
 *
 * Copies a link to the content to the clipboard. Also integrates
 * with the Web Share API on mobile for native sharing.
 */

import { useState, useCallback } from 'react';
import { Share2, Link2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ShareButtonProps {
  contentId: string;
  contentType?: string;
  title?: string;
  compact?: boolean;
  className?: string;
}

export function ShareButton({
  contentId,
  contentType = 'content',
  title,
  compact = false,
  className,
}: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/content/${contentId}`
    : `/content/${contentId}`;

  const handleShare = useCallback(async () => {
    // Try native share API first (mobile)
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: title || 'Shared from Concord',
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or not supported — fall through to clipboard
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort — select and copy
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl, title]);

  const Icon = copied ? Check : Share2;
  const label = copied ? 'Copied!' : 'Share';

  return (
    <button
      onClick={handleShare}
      className={cn(
        'inline-flex items-center gap-1.5 transition-colors min-h-[44px] min-w-[44px] justify-center',
        compact
          ? 'p-2 text-[var(--text-tertiary,#5C584F)] hover:text-[var(--accent-cool,#5B8DEF)]'
          : 'px-3 py-2 text-sm text-[var(--text-tertiary,#5C584F)] hover:text-[var(--accent-cool,#5B8DEF)] rounded-lg hover:bg-[var(--accent-cool,#5B8DEF)]/10',
        copied && 'text-[var(--status-success,#3ECFA0)]',
        className,
      )}
      aria-label={label}
      title={label}
    >
      <Icon className="w-4 h-4" />
      {!compact && <span>{label}</span>}
    </button>
  );
}
