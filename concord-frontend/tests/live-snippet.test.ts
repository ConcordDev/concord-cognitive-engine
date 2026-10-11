import { describe, expect, it } from 'vitest';
import { snippetFromFilesRead, tabAfterSnippetRead, LIVE_PROJECT_ID, LIVE_SNIPPET_PATH } from '@/components/code/liveSnippet';

describe('live snippet restore', () => {
  it('restores a saved buffer onto the empty primary tab and leaves a typed buffer alone', () => {
    expect(LIVE_PROJECT_ID).toBe('code-lens-live');
    expect(LIVE_SNIPPET_PATH).toBe('untitled.js');
    expect(snippetFromFilesRead(null)).toBeNull();
    expect(snippetFromFilesRead({ content: '' })).toBeNull();
    expect(snippetFromFilesRead({ content: 'const x = 1;\n' })).toBe('const x = 1;\n');
    const restored = tabAfterSnippetRead(
      [{ id: 'main', content: '' }, { id: 'other', content: '' }],
      'main',
      'const x = 1;\n',
    );
    expect(restored[0].content).toBe('const x = 1;\n');
    expect(restored[1].content).toBe('');
    const typed = tabAfterSnippetRead([{ id: 'main', content: 'draft' }], 'main', 'saved');
    expect(typed[0].content).toBe('draft');
  });
});
