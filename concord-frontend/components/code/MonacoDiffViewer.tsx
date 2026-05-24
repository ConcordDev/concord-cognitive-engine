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
}: MonacoDiffViewerProps) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  const handleMount = useCallback((ed: editor.IStandaloneDiffEditor, monaco: typeof import('monaco-editor')) => {
    editorRef.current = ed;
    monaco.editor.defineTheme('concord-dark-diff', CONCORD_DARK);
    monaco.editor.setTheme('concord-dark-diff');
  }, []);

  useEffect(() => {
    return () => { editorRef.current = null; };
  }, []);

  return (
    <div className={className || 'border border-lattice-border rounded overflow-hidden'} style={{ height }}>
      <DiffEditor
        original={original}
        modified={modified}
        language={resolveLanguage(language)}
        onMount={handleMount}
        theme="vs-dark"
        options={{
          renderSideBySide,
          readOnly: true,
          originalEditable: false,
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
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
