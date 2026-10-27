'use client';

import { useQuery } from '@tanstack/react-query';
import { lensRun } from '@/lib/api/client';

/** One arXiv paper in the shape the arXiv lens components render. */
export interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  link: string;
  category?: string;
}

/** How `query` is matched: whole record, abstract, title, or not at all (category listing). */
export type ArxivField = 'all' | 'abs' | 'ti' | 'cat-only';

export interface UseArxivFeedOptions {
  /** arXiv category (e.g. "cs.AI"). Omit to use the server's default for the `ai` domain. */
  category?: string;
  /** Free-text search, matched according to `field`. */
  query?: string;
  field?: ArxivField;
  /** Search without a cat: filter; `query` is then required. */
  anyCategory?: boolean;
  /** Max papers (server caps at 30). Default 20. */
  limit?: number;
  enabled?: boolean;
}

interface ServerPaper {
  arxivId: string | null;
  title: string | null;
  summary: string | null;
  published: string | null;
  authors?: string[];
  abstractUrl: string | null;
  pdfUrl?: string | null;
  category?: string | null;
}

interface ServerReply {
  papers?: ServerPaper[];
}

function toPaper(p: ServerPaper): ArxivPaper {
  const link = p.abstractUrl || (p.arxivId ? `https://arxiv.org/abs/${p.arxivId}` : '');
  return {
    id: p.abstractUrl || p.arxivId || '',
    title: p.title || '',
    summary: p.summary || '',
    authors: p.authors || [],
    published: p.published || '',
    link,
    category: p.category || '',
  };
}

/**
 * Live arXiv papers via the server (`ai.live_arxiv`), so the browser never
 * calls export.arxiv.org directly (CORS). A server-side failure surfaces as
 * `isError` with the server's reason in `error.message`.
 */
export function useArxivFeed({
  category,
  query,
  field,
  anyCategory,
  limit = 20,
  enabled = true,
}: UseArxivFeedOptions = {}) {
  return useQuery({
    queryKey: ['arxiv-feed', category ?? null, query ?? null, field ?? null, anyCategory ?? false, limit],
    queryFn: async (): Promise<ArxivPaper[]> => {
      const input: Record<string, unknown> = { limit };
      if (category) input.category = category;
      if (query) input.query = query;
      if (field) input.field = field;
      if (anyCategory) input.anyCategory = true;
      const r = await lensRun<ServerReply>('ai', 'live_arxiv', input);
      if (!r.data.ok) throw new Error(r.data.error || r.data.reason || 'arxiv_unreachable');
      return (r.data.result?.papers || []).map(toPaper);
    },
    enabled,
    staleTime: 30 * 60 * 1000,
  });
}
