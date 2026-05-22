import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Capture the props the wrapped <Editor> receives so we can drive its
// onMount / onChange callbacks and exercise the wrapper's branches.
let lastEditorProps: Record<string, unknown> = {};

vi.mock('@monaco-editor/react', () => {
  return {
    default: (props: Record<string, unknown>) => {
      lastEditorProps = props;
      return React.createElement('div', { 'data-testid': 'monaco-editor' }, 'editor');
    },
  };
});

import MonacoWrapper from '@/components/code/MonacoWrapper';

function makeMonaco() {
  const inlineProviders: Array<{ lang: string; provider: Record<string, unknown> }> = [];
  return {
    monaco: {
      editor: { defineTheme: vi.fn(), setTheme: vi.fn() },
      languages: {
        registerInlineCompletionsProvider: (lang: string, provider: Record<string, unknown>) => {
          inlineProviders.push({ lang, provider });
        },
      },
    },
    inlineProviders,
  };
}

function makeEditor(selectionText = 'sel') {
  let cursorCb: (() => void) | null = null;
  const model = {
    getValueInRange: vi.fn().mockReturnValue(selectionText),
    getLineCount: () => 50,
    getLineMaxColumn: () => 80,
  };
  return {
    editor: {
      focus: vi.fn(),
      onDidChangeCursorSelection: (cb: () => void) => {
        cursorCb = cb;
      },
      getSelection: () => ({ startLineNumber: 2, endLineNumber: 4 }),
      getModel: () => model,
    },
    fireCursor: () => cursorCb?.(),
    model,
  };
}

describe('MonacoWrapper', () => {
  beforeEach(() => {
    lastEditorProps = {};
  });

  it('renders the editor and applies the default options', async () => {
    render(<MonacoWrapper value="code" onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('monaco-editor')).toBeInTheDocument());
    expect(lastEditorProps.language).toBe('javascript');
  });

  it('resolves a known extension alias to a monaco language id', async () => {
    render(<MonacoWrapper value="x" onChange={vi.fn()} language="tsx" />);
    await waitFor(() => expect(lastEditorProps.language).toBe('typescript'));
  });

  it('passes an unknown language through unchanged', async () => {
    render(<MonacoWrapper value="x" onChange={vi.fn()} language="cobol" />);
    await waitFor(() => expect(lastEditorProps.language).toBe('cobol'));
  });

  it('onMount defines the theme and reports the editor ready', async () => {
    const onEditorReady = vi.fn();
    render(<MonacoWrapper value="x" onChange={vi.fn()} onEditorReady={onEditorReady} />);
    await waitFor(() => expect(lastEditorProps.onMount).toBeTypeOf('function'));
    const { monaco } = makeMonaco();
    const { editor } = makeEditor();
    (lastEditorProps.onMount as (e: unknown, m: unknown) => void)(editor, monaco);
    expect(monaco.editor.defineTheme).toHaveBeenCalled();
    expect(onEditorReady).toHaveBeenCalledWith(editor);
  });

  it('wires onSelectionChange and forwards selection text', async () => {
    const onSelectionChange = vi.fn();
    render(
      <MonacoWrapper value="x" onChange={vi.fn()} onSelectionChange={onSelectionChange} />
    );
    await waitFor(() => expect(lastEditorProps.onMount).toBeTypeOf('function'));
    const { monaco } = makeMonaco();
    const e = makeEditor('selected text');
    (lastEditorProps.onMount as (a: unknown, b: unknown) => void)(e.editor, monaco);
    e.fireCursor();
    expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'selected text', startLine: 2, endLine: 4 })
    );
  });

  it('registers an inline-completion provider that returns items', async () => {
    const inlineCompletion = vi.fn().mockResolvedValue('completion');
    render(
      <MonacoWrapper value="x" onChange={vi.fn()} inlineCompletion={inlineCompletion} />
    );
    await waitFor(() => expect(lastEditorProps.onMount).toBeTypeOf('function'));
    const { monaco, inlineProviders } = makeMonaco();
    const e = makeEditor();
    (lastEditorProps.onMount as (a: unknown, b: unknown) => void)(e.editor, monaco);
    expect(inlineProviders.length).toBe(1);
    const provider = inlineProviders[0].provider as {
      provideInlineCompletions: (m: unknown, p: unknown) => Promise<{ items: unknown[] }>;
      freeInlineCompletions: () => void;
    };
    const out = await provider.provideInlineCompletions(e.model, { lineNumber: 10, column: 3 });
    expect(out.items.length).toBe(1);
    expect(inlineCompletion).toHaveBeenCalled();
    provider.freeInlineCompletions();
  });

  it('inline-completion provider returns empty when completion is blank', async () => {
    const inlineCompletion = vi.fn().mockResolvedValue('');
    render(
      <MonacoWrapper value="x" onChange={vi.fn()} inlineCompletion={inlineCompletion} />
    );
    await waitFor(() => expect(lastEditorProps.onMount).toBeTypeOf('function'));
    const { monaco, inlineProviders } = makeMonaco();
    const e = makeEditor();
    (lastEditorProps.onMount as (a: unknown, b: unknown) => void)(e.editor, monaco);
    const provider = inlineProviders[0].provider as {
      provideInlineCompletions: (m: unknown, p: unknown) => Promise<{ items: unknown[] }>;
    };
    const out = await provider.provideInlineCompletions(e.model, { lineNumber: 5, column: 1 });
    expect(out.items.length).toBe(0);
  });

  it('inline-completion provider returns empty when completion throws', async () => {
    const inlineCompletion = vi.fn().mockRejectedValue(new Error('boom'));
    render(
      <MonacoWrapper value="x" onChange={vi.fn()} inlineCompletion={inlineCompletion} />
    );
    await waitFor(() => expect(lastEditorProps.onMount).toBeTypeOf('function'));
    const { monaco, inlineProviders } = makeMonaco();
    const e = makeEditor();
    (lastEditorProps.onMount as (a: unknown, b: unknown) => void)(e.editor, monaco);
    const provider = inlineProviders[0].provider as {
      provideInlineCompletions: (m: unknown, p: unknown) => Promise<{ items: unknown[] }>;
    };
    const out = await provider.provideInlineCompletions(e.model, { lineNumber: 5, column: 1 });
    expect(out.items.length).toBe(0);
  });

  it('forwards onChange and coalesces undefined to empty string', async () => {
    const onChange = vi.fn();
    render(<MonacoWrapper value="x" onChange={onChange} />);
    await waitFor(() => expect(lastEditorProps.onChange).toBeTypeOf('function'));
    (lastEditorProps.onChange as (v: string | undefined) => void)('new value');
    expect(onChange).toHaveBeenCalledWith('new value');
    (lastEditorProps.onChange as (v: string | undefined) => void)(undefined);
    expect(onChange).toHaveBeenCalledWith('');
  });
});
