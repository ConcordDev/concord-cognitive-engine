'use client';

import { lensRun } from '@/lib/api/client';
import type { Page, PageMeta } from './types';

/**
 * Full page documents for a docs export. Fails if the list or any page
 * cannot be read, so the file never claims a partial workspace is complete.
 */
export async function loadDocsExportPayload(live: unknown): Promise<{ pages: Page[]; live: unknown }> {
  const list = await lensRun<{ pages?: PageMeta[] }>('docs', 'page-list', {});
  if (!list.data.ok) {
    throw new Error(list.data.error || 'Could not load pages to export.');
  }
  const metas = list.data.result?.pages ?? [];
  const pages: Page[] = [];
  for (const meta of metas) {
    const detail = await lensRun<{ page?: Page }>('docs', 'page-detail', { id: meta.id });
    const page = detail.data.result?.page;
    if (!detail.data.ok || !page) {
      throw new Error(detail.data.error || `Could not load page ${meta.id}.`);
    }
    pages.push(page);
  }
  return { pages, live: live ?? null };
}
