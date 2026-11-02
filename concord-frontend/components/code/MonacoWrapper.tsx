'use client';

import dynamic from 'next/dynamic';
import { useCallback, useRef } from 'react';
import type { OnMount, OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { registerConcordDsl } from '@/lib/dsl/concord-dsl-lang';
import { createInlineCompletionsProvider } from '@/components/code/inlineCompletionsProvider';
import {
  extensionEnabled,
  fetchInstalledExtensions,
  subscribeExtensionsChanged,
} from '@/lib/code-extensions';

// ── S15 (F15): lexical declaration search backing Peek Definition ────
// No server definition service exists; Go to Definition rides Monaco's
// built-in TS worker while Peek found nothing for the lens's lexical
// languages. This provider answers from the current buffer — the
// review's repro was a same-screen definition — and Monaco merges its
// result with any built-in provider's.
const DECL_PATTERNS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+NAME\b/,
  /^\s*(?:export\s+)?class\s+NAME\b/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+NAME\b/,
  /^\s*(?:export\s+)?interface\s+NAME\b/,
  /^\s*(?:export\s+)?type\s+NAME\b/,
  /^\s*def\s+NAME\b/,
  /^\s*(?:async\s+)?NAME\s*\(/,
  /^\s*NAME\s*[:=]\s*(?:async\s*)?\(/,
];
export function findDeclaration(
  lines: string[],
  word: string,
  excludeLine?: number,
): { lineNumber: number; startColumn: number; endColumn: number } | null {
  if (!word || word.length < 2) return null;
  const pats = DECL_PATTERNS.map((re) => new RegExp(re.source.replace('NAME', word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
  for (let i = 0; i < lines.length; i++) {
    if (excludeLine != null && i + 1 === excludeLine) continue;
    for (const re of pats) {
      const m = lines[i].match(re);
      if (m) {
        const at = lines[i].indexOf(word, Math.max(0, (m.index ?? 0)));
        const col = (at >= 0 ? at : 0) + 1;
        return { lineNumber: i + 1, startColumn: col, endColumn: col + word.length };
      }
    }
  }
  return null;
}

// S15: TODO Highlight's actual effect — comment keyword decorations.
const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/g;
export function findTodoRanges(lines: string[]): Array<{ lineNumber: number; startColumn: number; endColumn: number }> {
  const out: Array<{ lineNumber: number; startColumn: number; endColumn: number }> = [];
  lines.forEach((line, i) => {
    TODO_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TODO_RE.exec(line))) {
      out.push({ lineNumber: i + 1, startColumn: m.index + 1, endColumn: m.index + 1 + m[1].length });
    }
  });
  return out;
}

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

// Concord Dark theme matching the lattice palette
const CONCORD_DARK_THEME: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '4a5568', fontStyle: 'italic' },
    { token: 'keyword', foreground: '00e5ff' },
    { token: 'string', foreground: '7dd3fc' },
    { token: 'number', foreground: 'c084fc' },
    { token: 'type', foreground: '34d399' },
    { token: 'function', foreground: '60a5fa' },
    { token: 'variable', foreground: 'e2e8f0' },
    { token: 'operator', foreground: 'f472b6' },
    { token: 'delimiter', foreground: '94a3b8' },
    { token: 'tag', foreground: 'f87171' },
    { token: 'attribute.name', foreground: 'fbbf24' },
    { token: 'attribute.value', foreground: '7dd3fc' },
  ],
  colors: {
    'editor.background': '#0a0e17',
    'editor.foreground': '#e2e8f0',
    'editor.lineHighlightBackground': '#1e293b40',
    'editor.selectionBackground': '#00e5ff30',
    'editor.inactiveSelectionBackground': '#00e5ff15',
    'editorCursor.foreground': '#00e5ff',
    'editorLineNumber.foreground': '#475569',
    'editorLineNumber.activeForeground': '#94a3b8',
    'editor.selectionHighlightBackground': '#00e5ff15',
    'editorIndentGuide.background': '#1e293b',
    'editorIndentGuide.activeBackground': '#334155',
    'editorBracketMatch.background': '#00e5ff20',
    'editorBracketMatch.border': '#00e5ff40',
    'scrollbarSlider.background': '#1e293b80',
    'scrollbarSlider.hoverBackground': '#334155a0',
    'editorWidget.background': '#0f172a',
    'editorWidget.border': '#1e293b',
    'editorSuggestWidget.background': '#0f172a',
    'editorSuggestWidget.border': '#1e293b',
    'editorSuggestWidget.selectedBackground': '#00e5ff20',
    'list.hoverBackground': '#1e293b',
    'minimap.background': '#0a0e17',
  },
};

// Map common extensions to Monaco language IDs
function resolveLanguage(lang: string): string {
  const map: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    md: 'markdown',
    yml: 'yaml',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
  };
  return map[lang] || lang;
}

interface MonacoWrapperProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  className?: string;
  onEditorReady?: (editor: editor.IStandaloneCodeEditor) => void;
  onSelectionChange?: (selection: { text: string; startLine: number; endLine: number }) => void;
  /** S15: glyph-margin click (the bookmark gesture the panel names). */
  onGutterLineClick?: (lineNumber: number) => void;
  /**
   * Optional editor overrides. When provided, merged on top of the
   * Concord defaults — so the lens settings (fontSize, wordWrap, etc.)
   * can be reflected per-keystroke without re-mounting the editor.
   */
  options?: Partial<editor.IStandaloneEditorConstructionOptions>;
  /**
   * Optional inline completion provider (Cursor Tab-style ghost text).
   * When set, registers an InlineCompletionsProvider against the resolved
   * language. Returning an empty array effectively disables the provider
   * for that call.
   */
  inlineCompletion?: (ctx: { textBeforeCursor: string; textAfterCursor: string; language: string }) => Promise<string>;
  /**
   * Phase 1 — real semantic IntelliSense. When provided, registers hover /
   * completion / signature-help providers that call the `code.lsp-*` macros
   * (TS LanguageService-backed) with the cursor position. `run(action, input)`
   * should resolve to the macro `result`. `projectId`/`path` are read fresh on
   * every request (via an internal ref) so switching tabs Just Works.
   */
  semantic?: {
    projectId: string;
    path: string;
    run: (action: string, input: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  };
}

type SemPosAlias = { lineNumber: number; column: number };

export default function MonacoWrapper({
  value,
  onChange,
  language = 'javascript',
  readOnly = false,
  className,
  onEditorReady,
  onSelectionChange,
  onGutterLineClick,
  options,
  inlineCompletion,
  semantic,
}: MonacoWrapperProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  // Read fresh on every provider call (handleMount captures only the first value).
  const semanticRef = useRef(semantic);
  semanticRef.current = semantic;

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monaco.editor.defineTheme('concord-dark', CONCORD_DARK_THEME);
    monaco.editor.setTheme('concord-dark');
    // Register the Concord DSL language (highlighting + keyword/macro completions).
    try { registerConcordDsl(monaco as unknown as Parameters<typeof registerConcordDsl>[0]); } catch { /* non-fatal */ }
    editor.focus();
    onEditorReady?.(editor);
    if (onSelectionChange) {
      editor.onDidChangeCursorSelection(() => {
        const sel = editor.getSelection();
        const model = editor.getModel();
        if (!sel || !model) return;
        const text = model.getValueInRange(sel);
        onSelectionChange({ text, startLine: sel.startLineNumber, endLine: sel.endLineNumber });
      });
    }
    // S15: Peek Definition provider (lexical, current buffer) — once
    // per language per page, like the semantic providers below.
    {
      const lang = resolveLanguage(language);
      const dflags = monaco.languages as unknown as Record<string, boolean>;
      const dflag = `__concordDef_${lang}`;
      if (!dflags[dflag]) {
        dflags[dflag] = true;
        monaco.languages.registerDefinitionProvider(lang, {
          provideDefinition(model: { getWordAtPosition: (p: SemPosAlias) => { word: string } | null; getLinesContent: () => string[]; uri: unknown }, position: SemPosAlias) {
            const w = model.getWordAtPosition(position);
            if (!w) return null;
            const hit = findDeclaration(model.getLinesContent(), w.word, position.lineNumber);
            if (!hit) return null;
            return {
              uri: model.uri as never,
              range: {
                startLineNumber: hit.lineNumber, startColumn: hit.startColumn,
                endLineNumber: hit.lineNumber, endColumn: hit.endColumn,
              },
            };
          },
        });
      }
    }
    // S15: glyph-margin clicks → the parent's bookmark toggle.
    if (onGutterLineClick) {
      editor.onMouseDown((e) => {
        const t = e.target as unknown as { type: number; position?: { lineNumber: number } };
        // monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN === 2
        if (t && t.type === 2 && t.position) onGutterLineClick(t.position.lineNumber);
      });
    }
    // S15: TODO Highlight decorations, applied while the extension is
    // enabled; re-applied on content change and on install toggles.
    {
      const collection = editor.createDecorationsCollection([]);
      const applyTodos = () => {
        const model = editor.getModel();
        if (!model || !extensionEnabled('todo-highlight')) { collection.set([]); return; }
        const ranges = findTodoRanges(model.getLinesContent()).map((r) => ({
          range: {
            startLineNumber: r.lineNumber, startColumn: r.startColumn,
            endLineNumber: r.lineNumber, endColumn: r.endColumn,
          },
          options: {
            inlineClassName: 'concord-todo-highlight',
            hoverMessage: { value: 'TODO Highlight (extension)' },
          },
        }));
        collection.set(ranges as never);
      };
      void fetchInstalledExtensions().then(applyTodos);
      const unsub = subscribeExtensionsChanged(() => { void fetchInstalledExtensions().then(applyTodos); });
      editor.onDidChangeModelContent(() => applyTodos());
      editor.onDidDispose(() => unsub());
    }
    if (inlineCompletion) {
      const lang = resolveLanguage(language);
      const provider = createInlineCompletionsProvider(lang, inlineCompletion);
      monaco.languages.registerInlineCompletionsProvider(
        lang,
        provider as Parameters<typeof monaco.languages.registerInlineCompletionsProvider>[1],
      );
    }

    // ── Phase 1: real semantic providers (hover / completions / signature) ──
    if (semanticRef.current) {
      const lang = resolveLanguage(language);
      // One registration per (monaco, lang) — handleMount can re-fire on
      // remount/HMR and double-registration would double every suggestion.
      const flags = monaco.languages as unknown as Record<string, boolean>;
      const flag = `__concordSem_${lang}`;
      if (!flags[flag]) {
        flags[flag] = true;

        type SemModel = NonNullable<ReturnType<editor.IStandaloneCodeEditor['getModel']>>;
        type SemPos = { lineNumber: number; column: number };

        const KIND: Record<string, number> = {
          method: monaco.languages.CompletionItemKind.Method,
          function: monaco.languages.CompletionItemKind.Function,
          property: monaco.languages.CompletionItemKind.Field,
          var: monaco.languages.CompletionItemKind.Variable,
          const: monaco.languages.CompletionItemKind.Constant,
          let: monaco.languages.CompletionItemKind.Variable,
          class: monaco.languages.CompletionItemKind.Class,
          interface: monaco.languages.CompletionItemKind.Interface,
          enum: monaco.languages.CompletionItemKind.Enum,
          keyword: monaco.languages.CompletionItemKind.Keyword,
          module: monaco.languages.CompletionItemKind.Module,
          parameter: monaco.languages.CompletionItemKind.Variable,
        };

        monaco.languages.registerHoverProvider(lang, {
          async provideHover(_model: SemModel, position: SemPos) {
            const ctx = semanticRef.current; if (!ctx) return null;
            try {
              const r = await ctx.run('lsp-hover', { projectId: ctx.projectId, path: ctx.path, position: { line: position.lineNumber, column: position.column } });
              const hover = r && (r as { found?: boolean; hover?: string }).found ? String((r as { hover?: string }).hover || '') : '';
              if (!hover) return null;
              const doc = (r as { doc?: string | null }).doc;
              const contents = [{ value: '```typescript\n' + hover + '\n```' }];
              if (doc) contents.push({ value: String(doc) });
              return { contents };
            } catch { return null; }
          },
        });

        monaco.languages.registerCompletionItemProvider(lang, {
          triggerCharacters: ['.', '(', '[', '"', "'", '`', '/', '@', '<', '#', ' '],
          async provideCompletionItems(model: SemModel, position: SemPos) {
            const ctx = semanticRef.current; if (!ctx) return { suggestions: [] };
            try {
              const word = model.getWordUntilPosition(position);
              const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
              const r = await ctx.run('lsp-completions', { projectId: ctx.projectId, path: ctx.path, position: { line: position.lineNumber, column: position.column }, prefix: word.word });
              const entries = (r && (r as { completions?: Array<{ label: string; kind?: string; detail?: string }> }).completions) || [];
              return {
                suggestions: entries.slice(0, 200).map((c) => ({
                  label: c.label,
                  kind: KIND[String(c.kind)] ?? monaco.languages.CompletionItemKind.Variable,
                  detail: c.detail || '',
                  insertText: c.label,
                  range,
                })),
              };
            } catch { return { suggestions: [] }; }
          },
        });

        monaco.languages.registerSignatureHelpProvider(lang, {
          signatureHelpTriggerCharacters: ['(', ','],
          async provideSignatureHelp(_model: SemModel, position: SemPos) {
            const ctx = semanticRef.current; if (!ctx) return null;
            try {
              const r = await ctx.run('lsp-signature', { projectId: ctx.projectId, path: ctx.path, position: { line: position.lineNumber, column: position.column } });
              if (!r || !(r as { found?: boolean }).found) return null;
              const res = r as { label: string; parameters?: Array<{ label: string; documentation?: string | null }>; activeParameter?: number };
              return {
                value: {
                  signatures: [{ label: res.label, parameters: (res.parameters || []).map((p) => ({ label: p.label, documentation: p.documentation || '' })) }],
                  activeSignature: 0,
                  activeParameter: res.activeParameter || 0,
                },
                dispose() { /* noop */ },
              };
            } catch { return null; }
          },
        });
      }
    }
  }, [onEditorReady, onSelectionChange, onGutterLineClick, inlineCompletion, language]);

  const handleChange: OnChange = useCallback(
    (val) => {
      onChange(val ?? '');
    },
    [onChange],
  );

  return (
    <div className={className || 'h-full w-full'}>
      <style>{`.concord-todo-highlight { background: rgba(245, 158, 11, 0.25); border-bottom: 1px wavy #f59e0b; border-radius: 2px; }`}</style>
      <Editor
        height="100%"
        language={resolveLanguage(language)}
        value={value}
        onChange={handleChange}
        onMount={handleMount}
        theme="vs-dark"
        options={{
          fontSize: 14,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontLigatures: true,
          minimap: { enabled: true, scale: 1 },
          scrollBeyondLastLine: false,
          padding: { top: 16, bottom: 16 },
          lineNumbers: 'on',
          glyphMargin: true,
          renderLineHighlight: 'line',
          bracketPairColorization: { enabled: true },
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          formatOnPaste: true,
          tabSize: 2,
          wordWrap: 'on',
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          inlineSuggest: { enabled: true },
          readOnly,
          ...(options || {}),
        }}
        loading={
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Loading editor…
          </div>
        }
      />
    </div>
  );
}
