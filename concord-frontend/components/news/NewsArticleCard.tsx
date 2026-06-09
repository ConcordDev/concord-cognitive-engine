'use client';

/**
 * NewsArticleCard — shared article row for the news reader panels.
 * Surfaces read / save / more-less actions, all via lensRun().
 */

import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Bookmark, BookOpen, ThumbsUp, ThumbsDown, ExternalLink } from 'lucide-react';

export interface NewsArticle {
  id: string;
  title: string;
  source: string;
  topic: string;
  summary: string | null;
  url: string | null;
  publishedAt: string;
  read: boolean;
  saved: boolean;
}

export function NewsArticleCard({ article, onChange }: { article: NewsArticle; onChange: () => void }) {
  const markRead = async () => {
    await lensRun('news', 'article-mark-read', { id: article.id, unread: article.read });
    onChange();
  };
  const save = async () => {
    await lensRun('news', 'article-save', { id: article.id });
    onChange();
  };
  const react = async (kind: 'more' | 'less') => {
    await lensRun('news', 'article-react', { id: article.id, kind });
    onChange();
  };

  return (
    <li className={cn('bg-zinc-900/70 border rounded-xl p-3', article.read ? 'border-zinc-800/60' : 'border-zinc-800')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('text-sm font-semibold', article.read ? 'text-zinc-400' : 'text-zinc-100')}>{article.title}</p>
          <p className="text-[10px] text-zinc-400">
            {article.source} · <span className="capitalize">{article.topic}</span> · {String(article.publishedAt).slice(0, 10)}
          </p>
        </div>
        <button aria-label="Save" type="button" onClick={save}
          className={cn('p-1 rounded shrink-0', article.saved ? 'text-rose-400' : 'text-zinc-600 hover:text-zinc-300')}>
          <Bookmark className={cn('w-3.5 h-3.5', article.saved && 'fill-current')} />
        </button>
      </div>
      {article.summary && <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2">{article.summary}</p>}
      <div className="flex items-center gap-1.5 mt-2">
        <button type="button" onClick={markRead}
          className={cn('flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg',
            article.read ? 'bg-zinc-800 text-zinc-400' : 'bg-rose-600 hover:bg-rose-500 text-white')}>
          <BookOpen className="w-3 h-3" /> {article.read ? 'Read' : 'Mark read'}
        </button>
        <button type="button" onClick={() => react('more')}
          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">
          <ThumbsUp className="w-3 h-3" /> More
        </button>
        <button type="button" onClick={() => react('less')}
          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">
          <ThumbsDown className="w-3 h-3" /> Less
        </button>
        {article.url && (
          <a href={article.url} target="_blank" rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-300">
            <ExternalLink className="w-3 h-3" /> Open
          </a>
        )}
      </div>
    </li>
  );
}
