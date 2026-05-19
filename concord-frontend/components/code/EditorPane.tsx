'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Save, Wand2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';
import { EditorTabs } from './CodeWorkbenchShell';

const MonacoWrapper = dynamic(() => import('./MonacoWrapper'), { ssr: false });

interface OpenFile { path: string; content: string; original: string; language: string; modified: boolean }

export function EditorPane({
  projectId,
  openPath,
  onOpenChange,
  onContentSaved,
}: {
  projectId: string | null;
  openPath: string | null;
  onOpenChange: (path: string | null) => void;
  onContentSaved?: () => void;
}) {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [showInlineEdit, setShowInlineEdit] = useState(false);
  const [inlineInstruction, setInlineInstruction] = useState('');
  const [inlineLoading, setInlineLoading] = useState(false);
  const [selection, setSelection] = useState<string>('');
  const editorRef = useRef<unknown>(null);

  // Open a file when openPath changes
  useEffect(() => {
    if (!projectId || !openPath) return;
    const existing = files.find(f => f.path === openPath);
    if (existing) return;
    setLoadingFile(true);
    api.post('/api/lens/run', { domain: 'code', action: 'files-read', input: { projectId, path: openPath } })
      .then(r => {
        if (r.data?.ok === false) { alert(r.data?.error); return; }
        const { content, language } = r.data?.result || { content: '', language: 'plaintext' };
        setFiles(prev => [...prev, { path: openPath, content, original: content, language, modified: false }]);
      })
      .catch(e => console.error('[Editor] open', e))
      .finally(() => setLoadingFile(false));
  }, [openPath, projectId]);

  const active = files.find(f => f.path === openPath);

  function updateContent(path: string, content: string) {
    setFiles(prev => prev.map(f => f.path === path ? { ...f, content, modified: content !== f.original } : f));
  }

  function close(path: string) {
    const f = files.find(x => x.path === path);
    if (f?.modified && !confirm(`Discard unsaved changes to ${path}?`)) return;
    setFiles(prev => prev.filter(x => x.path !== path));
    if (openPath === path) {
      const remaining = files.filter(x => x.path !== path);
      onOpenChange(remaining[remaining.length - 1]?.path || null);
    }
  }

  async function save() {
    if (!active || !projectId) return;
    try {
      await api.post('/api/lens/run', { domain: 'code', action: 'files-write', input: { projectId, path: active.path, content: active.content } });
      setFiles(prev => prev.map(f => f.path === active.path ? { ...f, original: f.content, modified: false } : f));
      onContentSaved?.();
    } catch (e) { console.error('[Editor] save', e); }
  }

  async function runInlineEdit() {
    if (!active || !selection.trim() || !inlineInstruction.trim()) return;
    setInlineLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'code', action: 'inline-edit', input: { code: selection, instruction: inlineInstruction, language: active.language } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      const edited = String(r.data?.result?.edited || '');
      const updated = active.content.replace(selection, edited);
      updateContent(active.path, updated);
      setShowInlineEdit(false);
      setInlineInstruction('');
    } catch (e) { console.error('[Editor] inline-edit', e); }
    finally { setInlineLoading(false); }
  }

  async function format() {
    if (!active) return;
    try {
      const r = await api.post('/api/lens/run', { domain: 'code', action: 'format-code', input: { code: active.content, language: active.language } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      const formatted = String(r.data?.result?.formatted || '');
      updateContent(active.path, formatted);
    } catch (e) { console.error('[Editor] format', e); }
  }

  // cmd-S to save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (selection.trim()) setShowInlineEdit(true); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, selection]);

  return (
    <>
      <EditorTabs
        tabs={files.map(f => ({ path: f.path, modified: f.modified }))}
        activePath={openPath}
        onSelect={onOpenChange}
        onClose={close}
      />
      {active ? (
        <>
          <div className="px-3 py-1 border-b border-white/10 flex items-center gap-2 bg-[#0a0c10] text-[11px]">
            <span className="font-mono text-gray-500 truncate flex-1">{active.path}</span>
            {selection.trim() && (
              <button onClick={() => setShowInlineEdit(v => !v)} className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 inline-flex items-center gap-1" title="Inline edit selection (⌘K)">
                <Wand2 className="w-3 h-3" /> ⌘K
              </button>
            )}
            <button onClick={format} className="px-1.5 py-0.5 rounded border border-white/15 text-gray-300 hover:bg-white/[0.05]" title="Format file">format</button>
            <button onClick={save} disabled={!active.modified} className="px-1.5 py-0.5 rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center gap-1" title="Save (⌘S)">
              <Save className="w-3 h-3" />Save
            </button>
          </div>
          {showInlineEdit && (
            <div className="px-3 py-2 border-b border-white/10 bg-blue-500/[0.06] flex items-center gap-2">
              <Sparkles className="w-3 h-3 text-blue-400" />
              <input
                value={inlineInstruction}
                onChange={e => setInlineInstruction(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runInlineEdit()}
                placeholder={`Inline edit ${selection.length} chars: e.g. rename foo to bar`}
                autoFocus
                className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-blue-500/30 rounded text-white"
              />
              <button onClick={runInlineEdit} disabled={inlineLoading || !inlineInstruction.trim()} className="px-2 py-1 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center gap-1">
                {inlineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}Edit
              </button>
              <button onClick={() => setShowInlineEdit(false)} className="text-gray-400 hover:text-white text-[10px]">esc</button>
            </div>
          )}
          {loadingFile ? (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <MonacoWrapper
                value={active.content}
                onChange={(value) => updateContent(active.path, value || '')}
                language={active.language}
                onEditorReady={(ed) => { editorRef.current = ed; }}
                onSelectionChange={(sel: { text: string } | string | null) => {
                  const text = typeof sel === 'string' ? sel : (sel?.text || '');
                  setSelection(text);
                }}
              />
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
          {projectId ? 'Open a file from the Explorer to start editing.' : 'Pick or create a project to begin.'}
        </div>
      )}
    </>
  );
}

export default EditorPane;
