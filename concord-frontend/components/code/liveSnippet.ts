/**
 * The code lens mirrors the open buffer to code.files-write. On refresh the
 * editor used to mount empty and then write that empty string over the saved
 * file. Read first. Write only after that read has settled, and only adopt
 * the saved text when the buffer is still the untouched empty tab.
 */

export const LIVE_PROJECT_ID = 'code-lens-live';
export const LIVE_SNIPPET_PATH = 'untitled.js';

export function snippetFromFilesRead(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const content = (result as { content?: unknown }).content;
  if (typeof content !== 'string' || content.length === 0) return null;
  return content;
}

/**
 * Newest saved script whose title is this tab, when the live file read
 * came back empty. lens.list is newest-first, so the first match is the
 * last Save. Without this, a reload before the debounced workspace write
 * shows a blank scratch pad even though Save stored the source.
 */
export function scratchContentFromScripts(
  scripts: Array<{ title?: string; data?: { content?: unknown } | null }> | null | undefined,
  tabName: string,
): string | null {
  if (!tabName || !Array.isArray(scripts)) return null;
  for (const script of scripts) {
    if (!script || script.title !== tabName) continue;
    const content = script.data && typeof script.data === 'object' ? script.data.content : undefined;
    if (typeof content === 'string' && content.length > 0) return content;
  }
  return null;
}

/** Apply a read-back only onto the still-empty primary tab. */
export function tabAfterSnippetRead<T extends { id: string; content: string }>(
  tabs: T[],
  primaryId: string,
  saved: string | null,
): T[] {
  if (!saved) return tabs;
  return tabs.map((tab) => (
    tab.id === primaryId && tab.content === ''
      ? { ...tab, content: saved }
      : tab
  ));
}
