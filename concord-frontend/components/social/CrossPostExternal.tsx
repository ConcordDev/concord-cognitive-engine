'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Share2,
  Link2,
  Check,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { cn, truncate } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface CrossPostExternalProps {
  postId: string;
  title: string;
  content: string;
  tags?: string[];
  authorName?: string;
  className?: string;
}

interface Platform {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  format: (data: { title: string; content: string; url: string; tags: string[]; authorName?: string }) => string;
  shareUrl?: (data: { text: string; url: string }) => string;
}

// ── Platform SVG icons (inline for minimal deps) ─────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

// ── Platforms ─────────────────────────────────────────────────────────────────

const PLATFORMS: Platform[] = [
  {
    id: 'x',
    name: 'X / Twitter',
    icon: <XIcon className="w-4 h-4" />,
    color: 'hover:bg-white/10 hover:text-white',
    format: ({ title, url, tags, authorName }) => {
      const byLine = authorName ? ` by ${authorName}` : '';
      const hashtags = tags.slice(0, 3).map((t) => `#${t}`).join(' ');
      const text = `${title}${byLine}${hashtags ? `\n\n${hashtags}` : ''}\n\n${url}`;
      return text.length > 280 ? `${truncate(title, 200)}${byLine}\n\n${url}` : text;
    },
    shareUrl: ({ text }) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
  },
  {
    id: 'instagram',
    name: 'Instagram Caption',
    icon: <InstagramIcon className="w-4 h-4" />,
    color: 'hover:bg-pink-500/10 hover:text-pink-400',
    format: ({ title, content, tags, authorName }) => {
      const byLine = authorName ? `\nby ${authorName}` : '';
      const hashtags = tags.map((t) => `#${t}`).join(' ');
      return `${title}${byLine}\n\n${truncate(content, 1500)}\n\n${hashtags}\n\nLink in bio`;
    },
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    icon: <LinkedInIcon className="w-4 h-4" />,
    color: 'hover:bg-blue-500/10 hover:text-blue-400',
    format: ({ title, content, url, tags, authorName }) => {
      const byLine = authorName ? `\nby ${authorName}` : '';
      const hashtags = tags.slice(0, 5).map((t) => `#${t}`).join(' ');
      return `${title}${byLine}\n\n${truncate(content, 1000)}\n\n${hashtags}\n\n${url}`;
    },
    shareUrl: ({ text, url }) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}&summary=${encodeURIComponent(text)}`,
  },
  {
    id: 'link',
    name: 'Copy Link',
    icon: <Link2 className="w-4 h-4" />,
    color: 'hover:bg-neon-cyan/10 hover:text-neon-cyan',
    format: ({ url }) => url,
  },
];

// ── Main Component ───────────────────────────────────────────────────────────

export function CrossPostExternal({
  postId,
  title,
  content,
  tags = [],
  authorName,
  className,
}: CrossPostExternalProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/post/${postId}`;

  const handleShare = async (platform: Platform) => {
    const formatted = platform.format({ title, content, url: shareUrl, tags, authorName });

    if (platform.id === 'link') {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedId('link');
      setTimeout(() => setCopiedId(null), 2000);
      return;
    }

    // Copy formatted content
    try {
      await navigator.clipboard.writeText(formatted);
      setCopiedId(platform.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback: no-op
    }

    // Open share URL if available
    if (platform.shareUrl) {
      const url = platform.shareUrl({ text: formatted, url: shareUrl });
      window.open(url, '_blank', 'noopener,noreferrer,width=600,height=500');
    }
  };

  return (
    <div className={cn('relative', className)}>
      {/* Trigger */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-lattice-deep transition-all"
      >
        <Share2 className="w-3.5 h-3.5" />
        Share
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {expanded && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => setExpanded(false)}
            />

            <motion.div
              initial={{ opacity: 0, y: -5, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -5, scale: 0.95 }}
              className="absolute right-0 top-full mt-2 w-56 bg-lattice-surface border border-lattice-border rounded-xl shadow-xl z-50 overflow-hidden"
            >
              <div className="p-2 border-b border-lattice-border">
                <p className="text-xs text-gray-500 px-2 py-1">Share to...</p>
              </div>

              <div className="p-1">
                {PLATFORMS.map((platform) => (
                  <button
                    key={platform.id}
                    onClick={() => handleShare(platform)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-400 transition-all',
                      platform.color
                    )}
                  >
                    {platform.icon}
                    <span className="flex-1 text-left">{platform.name}</span>
                    {copiedId === platform.id ? (
                      <Check className="w-3.5 h-3.5 text-green-400" />
                    ) : platform.shareUrl ? (
                      <ExternalLink className="w-3 h-3 text-gray-600" />
                    ) : (
                      <Copy className="w-3 h-3 text-gray-600" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export default CrossPostExternal;
