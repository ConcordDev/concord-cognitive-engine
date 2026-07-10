'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Save, Wand2, MessageSquareText, FlaskConical, History, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { EditorTabs } from './CodeWorkbenchShell';

const MonacoWrapper = dynamic(() => import('./MonacoWrapper'), { ssr: false });

// Phase 1 — semantic IntelliSense macro runner (returns the macro `result`).
async function runCodeMacro(action: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const r = await lensRun({ domain: 'code', action, input });
    return (r?.data?.result as Record<string, unknown>) ?? null;
  } catch { return null; }
}

interface OpenFile { path: string; content: string; original: string; language: string; modified: boolean }

export function EditorPane({
  projectId,
  openPath,
  openLine,
  onOpenChange,
  onContentSaved,
  renameSignal,
}: {
  projectId: string | null;
  openPath: string | null;
  openLine?: number | null;
  onOpenChange: (path: string | null) => void;
  onContentSaved?: () => void;
  /** Set by the caller after a successful files-rename so an already-open tab is
   *  relabeled in place instead of being treated as a new file (which would leave
   *  a stale tab pointed at the now-deleted old path). */
  renameSignal?: { from: string; to: string; nonce: number } | null;
}) {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [showInlineEdit, setShowInlineEdit] = useState(false);
  const [inlineInstruction, setInlineInstruction] = useState('');
  const [inlineLoading, setInlineLoading] = useState(false);
  const [selection, setSelection] = useState<string>('');
  const editorRef = useRef<{ revealLineInCenter?: (n: number) => void; setPosition?: (p: { lineNumber: number; column: number }) => void; focus?: () => void } | null>(null);

  // code.explain — a deterministic/brain-backed one-click explanation of the
  // current selection (or whole file when nothing is selected), distinct from
  // the free-form AI Pair chat: no prompt typing, a direct macro round-trip.
  const [explainOpen, setExplainOpen] = useState(false);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainText, setExplainText] = useState<string | null>(null);

  // code.test-generate — generates a real test file for the active file's
  // content; offered as "save as <suggested path>" rather than silently
  // overwriting anything.
  const [testGenOpen, setTestGenOpen] = useState(false);
  const [testGenLoading, setTestGenLoading] = useState(false);
  const [testGenResult, setTestGenResult] = useState<{ tests: string; framework: string; suggestedPath: string } | null>(null);

  // code.git-blame — per-line commit attribution for the active file.
  const [blameOpen, setBlameOpen] = useState(false);
  const [blameLoading, setBlameLoading] = useState(false);
  const [blameRows, setBlameRows] = useState<Array<{ lineNo: number; text: string; commitId: string | null; message: string; author: string; committedAt: string | null }> | null>(null);

  // Reveal a requested line once the editor + the target file are ready.
  useEffect(() => {
    if (!openLine || !openPath) return;
    const ed = editorRef.current;
    if (!ed?.revealLineInCenter) return;
    const t = setTimeout(() => {
      ed.revealLineInCenter?.(openLine);
      ed.setPosition?.({ lineNumber: openLine, column: 1 });
      ed.focus?.();
    }, 60);
    return () => clearTimeout(t);
  }, [openLine, openPath, loadingFile]);

  // Open a file when openPath changes
  useEffect(() => {
    if (!projectId || !openPath) return;
    const existing = files.find(f => f.path === openPath);
    if (existing) return;
    setLoadingFile(true);
    lensRun({ domain: 'code', action: 'files-read', input: { projectId, path: openPath } })
      .then(r => {
        if (r.data?.ok === false) { alert(r.data?.error); return; }
        const { content, language } = r.data?.result || { content: '', language: 'plaintext' };
        setFiles(prev => [...prev, { path: openPath, content, original: content, language, modified: false }]);
      })
      .catch(e => console.error('[Editor] open', e))
      .finally(() => setLoadingFile(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-fetches only on openPath/projectId change
  }, [openPath, projectId]);

  // Relabel an open tab in place after a rename — avoids a redundant re-fetch
  // and, more importantly, avoids leaving a stale tab pointed at the deleted
  // old path (which would otherwise silently recreate it on next Save).
  useEffect(() => {
    if (!renameSignal) return;
    setFiles(prev => prev.map(f => f.path === renameSignal.from ? { ...f, path: renameSignal.to } : f));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per nonce, not per renameSignal identity
  }, [renameSignal?.nonce]);

  const active = files.find(f => f.path === openPath);

  // Phase 1 — debounced mirror of the live (unsaved) buffer into the backend
  // workspace so hover/completions/diagnostics reflect what's on screen, not the
  // last saved revision (LSP didChange semantics).
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePath = active?.path;
  const activeContent = active?.content;
  useEffect(() => {
    if (!activePath || !projectId) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      void runCodeMacro('files-write', { projectId, path: activePath, content: activeContent });
    }, 350);
    return () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current); };
  }, [activePath, activeContent, projectId]);

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
      await lensRun({ domain: 'code', action: 'files-write', input: { projectId, path: active.path, content: active.content } });
      setFiles(prev => prev.map(f => f.path === active.path ? { ...f, original: f.content, modified: false } : f));
      onContentSaved?.();
    } catch (e) { console.error('[Editor] save', e); }
  }

  async function runInlineEdit() {
    if (!active || !selection.trim() || !inlineInstruction.trim()) return;
    setInlineLoading(true);
    try {
      const r = await lensRun({ domain: 'code', action: 'inline-edit', input: { code: selection, instruction: inlineInstruction, language: active.language } });
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
      const r = await lensRun({ domain: 'code', action: 'format-code', input: { code: active.content, language: active.language } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      const formatted = String(r.data?.result?.formatted || '');
      updateContent(active.path, formatted);
    } catch (e) { console.error('[Editor] format', e); }
  }

  async function explain() {
    if (!active) return;
    const code = selection.trim() || active.content;
    if (!code.trim()) return;
    setExplainOpen(true);
    setExplainLoading(true);
    setExplainText(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'explain', input: { code, path: active.path } });
      if (r.data?.ok === false) { setExplainText(`Could not explain: ${r.data?.error || 'unknown error'}`); return; }
      setExplainText(String(r.data?.result?.explanation || 'No explanation generated.'));
    } catch (e) {
      setExplainText(`Could not explain: ${e instanceof Error ? e.message : 'request failed'}`);
    } finally { setExplainLoading(false); }
  }

  function suggestedTestPath(path: string): string {
    const dot = path.lastIndexOf('.');
    if (dot < 0) return `${path}.test`;
    const base = path.slice(0, dot);
    const ext = path.slice(dot); // includes leading '.'
    if (/\.test\.|\.spec\./.test(path)) return path; // already a test file — same-name overwrite is an explicit choice below
    return `${base}.test${ext}`;
  }

  async function generateTests() {
    if (!active) return;
    setTestGenOpen(true);
    setTestGenLoading(true);
    setTestGenResult(null);
    try {
      const framework = /\.py$/.test(active.path) ? 'pytest' : /\.(ts|tsx|js|jsx)$/.test(active.path) ? 'node:test' : 'the project convention';
      const r = await lensRun({ domain: 'code', action: 'test-generate', input: { code: active.content, framework } });
      if (r.data?.ok === false) { alert(r.data?.error || 'Test generation failed.'); setTestGenOpen(false); return; }
      const tests = String(r.data?.result?.tests || '');
      if (!tests.trim()) { alert('No tests were generated.'); setTestGenOpen(false); return; }
      setTestGenResult({ tests, framework: String(r.data?.result?.framework || framework), suggestedPath: suggestedTestPath(active.path) });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Test generation failed.');
      setTestGenOpen(false);
    } finally { setTestGenLoading(false); }
  }

  async function saveGeneratedTests() {
    if (!testGenResult || !projectId) return;
    try {
      await lensRun({ domain: 'code', action: 'files-write', input: { projectId, path: testGenResult.suggestedPath, content: testGenResult.tests } });
      setTestGenOpen(false);
      onOpenChange(testGenResult.suggestedPath);
      onContentSaved?.();
    } catch (e) { console.error('[Editor] save generated tests', e); }
  }

  async function showBlame() {
    if (!active || !projectId) return;
    setBlameOpen(true);
    setBlameLoading(true);
    setBlameRows(null);
    try {
      const r = await lensRun({ domain: 'code', action: 'git-blame', input: { projectId, path: active.path } });
      if (r.data?.ok === false) { setBlameRows([]); return; }
      setBlameRows((r.data?.result?.blame as typeof blameRows) || []);
    } catch (e) { console.error('[Editor] blame', e); setBlameRows([]); }
    finally { setBlameLoading(false); }
  }

  // cmd-S to save
  //
  // Duplicate-handler-race fix (verification-audit campaign): Cmd/Ctrl+K is
  // ALSO bound globally by CommandPalette.tsx (document-level, bubble
  // phase, mounted app-wide via AppShell) — pressing Cmd/Ctrl+K here used
  // to open both the inline-edit modal AND the command palette at once.
  // CommandPalette's binding is sacred (CLAUDE.md) and stays untouched;
  // instead this listener is registered on `window` in the CAPTURE phase
  // (fires before any document-level bubble-phase listener, regardless of
  // DOM order) so it can claim the combo with stopPropagation() only when
  // it actually consumes it (a selection is active) and otherwise let the
  // event fall through to the command palette unchanged.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // detector-allow: duplicate-handler — resolved via capture-phase registration + conditional stopPropagation() below, not removal; see tests/editor-pane-ctrlk-race.test.tsx for the behavioral proof.
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k' && selection.trim()) {
        e.preventDefault();
        e.stopPropagation();
        setShowInlineEdit(true);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
            <span className="font-mono text-gray-400 truncate flex-1">{active.path}</span>
            {selection.trim() && (
              <button onClick={() => setShowInlineEdit(v => !v)} className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 hover:bg-blue-500/25 inline-flex items-center gap-1" title="Inline edit selection (⌘K)">
                <Wand2 className="w-3 h-3" /> ⌘K
              </button>
            )}
            <button onClick={explain} className="px-1.5 py-0.5 rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1" title={selection.trim() ? 'Explain selection' : 'Explain this file'}>
              <MessageSquareText className="w-3 h-3" />Explain
            </button>
            <button onClick={generateTests} className="px-1.5 py-0.5 rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1" title="Generate a test file for this code">
              <FlaskConical className="w-3 h-3" />Tests
            </button>
            {projectId && (
              <button onClick={showBlame} className="px-1.5 py-0.5 rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1" title="Blame — per-line commit attribution">
                <History className="w-3 h-3" />Blame
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
          {explainOpen && (
            <div className="px-3 py-2 border-b border-white/10 bg-violet-500/[0.06] text-xs">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquareText className="w-3 h-3 text-violet-300 shrink-0" />
                <span className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold flex-1">
                  {selection.trim() ? 'Explaining selection' : 'Explaining file'}
                </span>
                <button aria-label="Close" onClick={() => setExplainOpen(false)} className="text-gray-400 hover:text-white"><X className="w-3 h-3" /></button>
              </div>
              {explainLoading ? (
                <div className="text-gray-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Thinking…</div>
              ) : (
                <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">{explainText}</p>
              )}
            </div>
          )}
          {testGenOpen && (
            <div className="px-3 py-2 border-b border-white/10 bg-emerald-500/[0.06] text-xs">
              <div className="flex items-center gap-2 mb-1">
                <FlaskConical className="w-3 h-3 text-emerald-300 shrink-0" />
                <span className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold flex-1">Generated tests</span>
                <button aria-label="Close" onClick={() => setTestGenOpen(false)} className="text-gray-400 hover:text-white"><X className="w-3 h-3" /></button>
              </div>
              {testGenLoading ? (
                <div className="text-gray-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Writing tests…</div>
              ) : testGenResult ? (
                <>
                  <pre className="max-h-48 overflow-auto p-2 rounded bg-black/40 font-mono text-[11px] text-emerald-200 whitespace-pre-wrap">{testGenResult.tests}</pre>
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={saveGeneratedTests} disabled={!projectId} className="px-2 py-1 rounded bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-40">
                      Save as {testGenResult.suggestedPath}
                    </button>
                    <button onClick={() => navigator.clipboard?.writeText(testGenResult.tests)} className="px-2 py-1 rounded border border-white/15 text-gray-300 hover:bg-white/[0.05]">Copy</button>
                  </div>
                </>
              ) : null}
            </div>
          )}
          {blameOpen && (
            <div className="border-b border-white/10 bg-[#0a0c10]">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
                <History className="w-3 h-3 text-blue-300 shrink-0" />
                <span className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold flex-1">Blame — {active.path}</span>
                <button aria-label="Close" onClick={() => setBlameOpen(false)} className="text-gray-400 hover:text-white"><X className="w-3 h-3" /></button>
              </div>
              <div className="max-h-64 overflow-auto font-mono text-[11px]">
                {blameLoading ? (
                  <div className="p-3 text-gray-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Loading blame…</div>
                ) : !blameRows || blameRows.length === 0 ? (
                  <div className="p-3 text-gray-400 italic">No blame data.</div>
                ) : blameRows.map(row => (
                  <div key={row.lineNo} className="flex items-start gap-2 px-3 py-0.5 hover:bg-white/[0.03]" title={row.committedAt ? `${row.message} · ${new Date(row.committedAt).toLocaleString()}` : row.message}>
                    <span className="w-8 shrink-0 text-right text-gray-600">{row.lineNo}</span>
                    <span className={`w-16 shrink-0 ${row.commitId ? 'text-blue-300' : 'text-amber-400 italic'}`}>{row.commitId ? row.commitId.slice(0, 7) : 'uncommit'}</span>
                    <span className="w-24 shrink-0 truncate text-gray-400">{row.author?.slice(0, 12) || '—'}</span>
                    <span className="flex-1 truncate text-gray-200 whitespace-pre">{row.text || ' '}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {loadingFile ? (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
          ) : (
            <div className="flex-1 overflow-hidden">
              <MonacoWrapper
                value={active.content}
                onChange={(value) => updateContent(active.path, value || '')}
                language={active.language}
                semantic={projectId ? { projectId, path: active.path, run: runCodeMacro } : undefined}
                onEditorReady={(ed) => { editorRef.current = ed as typeof editorRef.current; }}
                onSelectionChange={(sel: { text: string } | string | null) => {
                  const text = typeof sel === 'string' ? sel : (sel?.text || '');
                  setSelection(text);
                }}
              />
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
          {projectId ? 'Open a file from the Explorer to start editing.' : 'Pick or create a project to begin.'}
        </div>
      )}
    </>
  );
}

export default EditorPane;
