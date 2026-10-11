import type { Block } from './types';

/** Plain text of a page, in block order. Empty blocks are omitted. */
export function pageBody(blocks: Pick<Block, 'type' | 'text' | 'data'>[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'divider') continue;
    if (block.type === 'table') {
      const rows = block.data?.rows ?? [];
      const text = rows
        .map((row) => row.map((cell) => cell.trim()).filter(Boolean).join(' | '))
        .filter(Boolean)
        .join('\n');
      if (text) parts.push(text);
      continue;
    }
    const text = block.text ?? '';
    if (text.trim()) parts.push(text);
  }
  return parts.join('\n\n');
}

export function publishableFromPage(
  page: { title?: string; blocks: Pick<Block, 'type' | 'text' | 'data'>[] } | null,
): { title: string; content: string } | null {
  if (!page) return null;
  const content = pageBody(page.blocks);
  if (!content.trim()) return null;
  const title = (page.title || '').trim() || 'Untitled';
  return { title, content };
}
