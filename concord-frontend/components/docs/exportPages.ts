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

/**
 * Per-page export (FIX-docs-013): the workspace header export is
 * all-or-nothing; a single page can now be exported on its own from
 * the page toolbar. The payload is the full page document so it can
 * be archived or shared without the rest of the workspace.
 */
export function pageExportPayload(page: Page): { kind: string; page: Page } {
  return { kind: 'concord-docs-page', page };
}

export function pageExportFilename(page: Page): string {
  const slug = (page.title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
  return `${slug}.page.json`;
}

export function downloadPageExport(page: Page): void {
  const blob = new Blob([JSON.stringify(pageExportPayload(page), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = pageExportFilename(page);
  a.click();
  URL.revokeObjectURL(url);
}
