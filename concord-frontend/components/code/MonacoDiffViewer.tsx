'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef } from 'react';
import type { editor } from 'monaco-editor';

const DiffEditor = dynamic(() => import('@monaco-editor/react').then(m => m.DiffEditor), { ssr: false });

interface MonacoDiffViewerProps {
  original: string;
  modified: string;
  language?: string;
  height?: number | string;
  renderSideBySide?: boolean;
  onAcceptHunk?: (hunkIndex: number, modifiedText: string) => void;
  className?: string;
  /** A lens-owned theme; defaults to Concord Dark. */
  theme?: { name: string; data: editor.IStandaloneThemeData };
  /** Font stack for the diff; defaults to JetBrains Mono. */
  fontFamily?: string;
}

const CONCORD_DARK: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '4a5568', fontStyle: 'italic' },
    { token: 'keyword', foreground: '00e5ff' },
    { token: 'string', foreground: '7dd3fc' },
    { token: 'number', foreground: 'c084fc' },
  ],
  colors: {
    'editor.background': '#0a0e17',
    'editor.foreground': '#e2e8f0',
    'diffEditor.insertedTextBackground': '#10b98125',
    'diffEditor.removedTextBackground': '#ef444425',
    'diffEditor.insertedLineBackground': '#10b98115',
    'diffEditor.removedLineBackground': '#ef444415',
    'diffEditorGutter.insertedLineBackground': '#10b98130',
    'diffEditorGutter.removedLineBackground': '#ef444430',
  },
};

function resolveLanguage(lang?: string): string {
  if (!lang) return 'javascript';
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
    md: 'markdown', yml: 'yaml', yaml: 'yaml',
    sh: 'shell', bash: 'shell', zsh: 'shell',
  };
  return map[lang] || lang;
}

export default function MonacoDiffViewer({
  original,
  modified,
  language = 'javascript',
  height = 320,
  renderSideBySide = true,
  className,
  theme,
  fontFamily,
}: MonacoDiffViewerProps) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  const handleMount = useCallback((ed: editor.IStandaloneDiffEditor, monaco: typeof import('monaco-editor')) => {
    editorRef.current = ed;
    monaco.editor.defineTheme('concord-dark-diff', CONCORD_DARK);
    if (theme) monaco.editor.defineTheme(theme.name, theme.data);
    monaco.editor.setTheme(theme ? theme.name : 'concord-dark-diff');
  }, [theme]);

  // Release the models in the order Monaco requires: detach them from the
  // widget first, then dispose. Letting the wrapper dispose them on unmount
  // throws "TextModel got disposed before DiffEditorWidget model got reset",
  // which also broke the next editor mounted in its place.
  useEffect(() => {
    return () => {
      const ed = editorRef.current;
      editorRef.current = null;
      if (!ed) return;
      try {
        const models = ed.getModel();
        ed.setModel(null);
        models?.original.dispose();
        models?.modified.dispose();
      } catch { /* already gone */ }
    };
  }, []);

  return (
    <div className={className || 'border border-lattice-border rounded overflow-hidden'} style={{ height }}>
      <DiffEditor
        original={original}
        modified={modified}
        language={resolveLanguage(language)}
        onMount={handleMount}
        keepCurrentOriginalModel
        keepCurrentModifiedModel
        theme="vs-dark"
        options={{
          renderSideBySide,
          automaticLayout: true,
          readOnly: true,
          originalEditable: false,
          fontSize: 13,
          fontFamily: fontFamily || "'JetBrains Mono', 'Fira Code', monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          renderOverviewRuler: false,
          renderIndicators: true,
          ignoreTrimWhitespace: false,
          diffWordWrap: 'on',
          enableSplitViewResizing: true,
          lineNumbers: 'on',
        }}
        loading={<div className="flex items-center justify-center h-full text-gray-400 text-xs">Loading diff…</div>}
      />
    </div>
  );
}
