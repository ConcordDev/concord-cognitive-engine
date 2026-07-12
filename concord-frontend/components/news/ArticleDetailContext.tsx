'use client';

/**
 * ArticleDetailContext — lets any article row in the personalized-reader
 * system (`NewsArticleCard`, channel/topic drill-downs, search results)
 * open the shared `ArticleDetailModal` without prop-drilling through
 * `NewsReaderSection` → `NewsTodayPanel`/`NewsForYouPanel`/`NewsSavedPanel`.
 *
 * `MyReaderDesk` is the sole provider; it also renders the modal itself.
 * The hook is safe to call outside a provider (no-op) so `NewsArticleCard`
 * doesn't have to know whether it's mounted inside the reader shell.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface ArticleDetailContextValue {
  openArticleId: string | null;
  openArticle: (id: string) => void;
  closeArticle: () => void;
}

const ArticleDetailContext = createContext<ArticleDetailContextValue>({
  openArticleId: null,
  openArticle: () => {},
  closeArticle: () => {},
});

export function ArticleDetailProvider({ children }: { children: ReactNode }) {
  const [openArticleId, setOpenArticleId] = useState<string | null>(null);
  const value = useMemo<ArticleDetailContextValue>(
    () => ({
      openArticleId,
      openArticle: (id: string) => setOpenArticleId(id),
      closeArticle: () => setOpenArticleId(null),
    }),
    [openArticleId],
  );
  return <ArticleDetailContext.Provider value={value}>{children}</ArticleDetailContext.Provider>;
}

export function useArticleDetail() {
  return useContext(ArticleDetailContext);
}
