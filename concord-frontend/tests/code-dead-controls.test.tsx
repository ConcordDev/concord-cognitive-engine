/**
 * S15 (PR #1707): the dead-controls pack (F15) — the pure cores and the
 * Monaco wiring.
 *
 * Peek Definition: no definition provider existed anywhere (Go to
 * Definition rode Monaco's built-in TS worker; Peek found nothing).
 * MonacoWrapper now registers a lexical provider over the current
 * buffer — findDeclaration is its core.
 *
 * Bookmarks: the glyph-margin click reaches the parent's toggle
 * (MouseTargetType.GUTTER_GLYPH_MARGIN === 2).
 *
 * Clipboard: copyTextRobust falls back when the Clipboard API silently
 * no-ops and reports honestly when every route fails.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { extensions: [] } } })),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('@/lib/dsl/concord-dsl-lang', () => ({ registerConcordDsl: () => undefined }));

const captured: {
  definitionProvider: { provideDefinition: (m: unknown, p: unknown) => unknown } | null;
  mouseDown: ((e: unknown) => void) | null;
} = { definitionProvider: null, mouseDown: null };

vi.mock('next/dynamic', () => ({
  default: () => function MockEditor(props: { onMount?: (e: unknown, m: unknown) => void }) {
    const fakeMonaco = {
      editor: { defineTheme: () => undefined, setTheme: () => undefined },
      languages: {
        registerDefinitionProvider: (_lang: string, provider: never) => { captured.definitionProvider = provider; },
        registerHoverProvider: () => undefined,
        registerCompletionItemProvider: () => undefined,
        registerSignatureHelpProvider: () => undefined,
        registerInlineCompletionsProvider: () => undefined,
        CompletionItemKind: { Method: 1, Function: 2, Field: 3, Variable: 4, Constant: 5, Class: 6, Interface: 7, Enum: 8, Keyword: 9, Module: 10 },
      },
    };
    const fakeEditor = {
      focus: () => undefined,
      onDidChangeCursorSelection: () => undefined,
      onMouseDown: (fn: (e: unknown) => void) => { captured.mouseDown = fn; },
      createDecorationsCollection: () => ({ set: () => undefined }),
      getModel: () => null,
      onDidChangeModelContent: () => undefined,
      onDidDispose: () => undefined,
    };
    React.useEffect(() => { props.onMount?.(fakeEditor, fakeMonaco); }, []);
    return <div data-testid="mock-editor" />;
  },
}));

import MonacoWrapper, { findDeclaration, findTodoRanges } from '@/components/code/MonacoWrapper';
import { copyTextRobust } from '@/components/code/CodeEditorWorkspacePanel';

describe('findDeclaration (Peek Definition core)', () => {
  const lines = [
    'function helper(x) { return x + 1; }',
    'const other = 2;',
    'const y = helper(other);',
  ];
  it('finds a function declaration', () => {
    expect(findDeclaration(lines, 'helper', 3)).toMatchObject({ lineNumber: 1 });
  });
  it('finds a const declaration', () => {
    expect(findDeclaration(lines, 'other', 3)).toMatchObject({ lineNumber: 2 });
  });
  it('skips the declaration line itself when asked from it', () => {
    expect(findDeclaration(lines, 'helper', 1)).toBeNull();
  });
  it('finds python defs and classes', () => {
    expect(findDeclaration(['class Foo:', '  pass'], 'Foo', 2)).toMatchObject({ lineNumber: 1 });
    expect(findDeclaration(['def run():', '  run()'], 'run', 2)).toMatchObject({ lineNumber: 1 });
  });
  it('returns null for unknown or tiny words', () => {
    expect(findDeclaration(lines, 'missing', 1)).toBeNull();
    expect(findDeclaration(lines, 'x', 1)).toBeNull();
  });
});

describe('findTodoRanges (TODO Highlight core)', () => {
  it('locates TODO/FIXME/HACK keywords with columns', () => {
    const hits = findTodoRanges(['// TODO: fix this', 'const a = 1; // FIXME and HACK']);
    expect(hits.map((h) => [h.lineNumber, h.startColumn])).toEqual([[1, 4], [2, 17], [2, 27]]);
  });
  it('ignores TODOS without a word boundary', () => {
    expect(findTodoRanges(['const TODOLIST = [];'])).toEqual([]);
  });
});

describe('MonacoWrapper wiring', () => {
  it('registers a definition provider that resolves same-buffer declarations', async () => {
    captured.definitionProvider = null;
    render(<MonacoWrapper value={'function helper() {}\nhelper();'} onChange={() => undefined} language="javascript" />);
    await waitFor(() => expect(captured.definitionProvider).toBeTruthy());
    const model = {
      getWordAtPosition: () => ({ word: 'helper' }),
      getLinesContent: () => ['function helper() {}', 'helper();'],
      uri: 'inmemory://model/1',
    };
    const loc = captured.definitionProvider!.provideDefinition(model, { lineNumber: 2, column: 2 }) as { range: { startLineNumber: number } };
    expect(loc.range.startLineNumber).toBe(1);
  });

  it('forwards glyph-margin clicks to the bookmark gesture', async () => {
    captured.mouseDown = null;
    const onGutterLineClick = vi.fn();
    render(<MonacoWrapper value={'a\nb'} onChange={() => undefined} language="javascript" onGutterLineClick={onGutterLineClick} />);
    await waitFor(() => expect(captured.mouseDown).toBeTruthy());
    captured.mouseDown!({ target: { type: 2, position: { lineNumber: 7 } } });
    expect(onGutterLineClick).toHaveBeenCalledWith(7);
    captured.mouseDown!({ target: { type: 3, position: { lineNumber: 9 } } });
    expect(onGutterLineClick).toHaveBeenCalledTimes(1);
  });
});

describe('copyTextRobust', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  it('uses the Clipboard API when available', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await expect(copyTextRobust('abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });
  it('falls back to execCommand when the API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => true);
    await expect(copyTextRobust('abc')).resolves.toBe(true);
  });
  it('reports false when every route fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn(() => false);
    await expect(copyTextRobust('abc')).resolves.toBe(false);
  });
});
