import { describe, expect, it } from 'vitest';
import { scratchContentFromScripts, snippetFromFilesRead, tabAfterSnippetRead, LIVE_PROJECT_ID, LIVE_SNIPPET_PATH } from '@/components/code/liveSnippet';

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

  it('restores the newest saved script when the live file read is empty', () => {
    const scripts = [
      { title: 'untitled.js', data: { content: 'const latest = 1;\n' } },
      { title: 'untitled.js', data: { content: 'const older = 1;\n' } },
      { title: 'script_1.js', data: { content: 'const other = 1;\n' } },
    ];
    expect(scratchContentFromScripts(scripts, 'untitled.js')).toBe('const latest = 1;\n');
    expect(scratchContentFromScripts(scripts, 'script_1.js')).toBe('const other = 1;\n');
    expect(scratchContentFromScripts(scripts, 'missing.js')).toBeNull();
    expect(scratchContentFromScripts([{ title: 'untitled.js', data: { content: '' } }], 'untitled.js')).toBeNull();
  });
});
