'use client';

import dynamic from 'next/dynamic';
import { useCallback, useRef } from 'react';
import type { OnMount, OnChange } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

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
}

export default function MonacoWrapper({
  value,
  onChange,
  language = 'javascript',
  readOnly = false,
  className,
  onEditorReady,
  onSelectionChange,
}: MonacoWrapperProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monaco.editor.defineTheme('concord-dark', CONCORD_DARK_THEME);
    monaco.editor.setTheme('concord-dark');
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
  }, [onEditorReady, onSelectionChange]);

  const handleChange: OnChange = useCallback(
    (val) => {
      onChange(val ?? '');
    },
    [onChange],
  );

  return (
    <div className={className || 'h-full w-full'}>
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
          readOnly,
        }}
        loading={
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Loading editor…
          </div>
        }
      />
    </div>
  );
}
