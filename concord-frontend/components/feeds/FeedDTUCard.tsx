'use client';

import { ExternalLink, Rss } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FeedDTUCardProps {
  title: string;
  summary?: string;
  sourceName: string;
  sourceUrl?: string;
  domain: string;
  tags?: string[];
  publishedAt?: string;
  feedId?: string;
  className?: string;
}

/**
 * FeedDTUCard — Displays a DTU ingested from a feed with source attribution.
 * Shows "via [source name]" badge and links to original content.
 */
export function FeedDTUCard({
  title,
  summary,
  sourceName,
  sourceUrl,
  domain,
  tags = [],
  publishedAt,
  className,
}: FeedDTUCardProps) {
  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const mins = Math.floor(diffMs / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return d.toLocaleDateString();
    } catch { return ''; }
  };

  return (
    <div className={cn(
      'bg-gray-800/40 rounded-lg border border-gray-700/50 p-3 hover:border-cyan-800/50 transition group',
      className
    )}>
      <div className="flex items-start gap-2">
        <Rss className="w-4 h-4 text-cyan-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-white leading-tight line-clamp-2">{title}</h4>
          {summary && (
            <p className="text-xs text-gray-400 mt-1 line-clamp-2">{summary}</p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-300 border border-cyan-800/30">
              via {sourceName}
            </span>
            <span className="text-[10px] text-gray-400 capitalize">{domain}</span>
            {publishedAt && (
              <span className="text-[10px] text-gray-400">{formatTime(publishedAt)}</span>
            )}
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition"
              >
                <ExternalLink className="w-3 h-3" />
                Original
              </a>
            )}
          </div>
          {tags.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {tags.slice(0, 5).map(tag => (
                <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-gray-700/50 text-gray-400">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
