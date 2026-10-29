'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, Save, Wand2, MessageSquareText, FlaskConical, History, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { validateGeneratedTests } from './testGenContract';
import { runGeneratedTests } from './localExec';
import type { TestSummary } from './testHarness';
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
  replaceSignal,
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
  /** Set after a successful project-wide replace: open tabs for these
   *  paths are re-read from the server store (the replace already
   *  saved there) so the editor shows the change instead of a stale
   *  buffer that would overwrite it on the next sync. Tabs with
   *  unsaved user edits are left alone — the user's buffer wins until
   *  they save or discard. */
  replaceSignal?: { paths: string[]; nonce: number } | null;
}) {
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [loadingFile, setLoadingFile] = useState(false);
  const [showInlineEdit, setShowInlineEdit] = useState(false);
  const [inlineInstruction, setInlineInstruction] = useState('');
  const [inlineLoading, setInlineLoading] = useState(false);
  const [selection, setSelection] = useState<string>('');
  const editorRef = useRef<{ revealLineInCenter?: (n: number) => void; setPosition?: (p: { lineNumber: number; column: number }) => void; focus?: () => void; getAction?: (id: string) => { run: () => Promise<void> } | null } | null>(null);

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
  // S4: contract rejections render in the panel (never an alert, never
  // a fake result), and run results live in their own block — produced
  // only by actually executing the tests in the browser harness.
  const [testGenError, setTestGenError] = useState<string | null>(null);
  const [testRun, setTestRun] = useState<{ running: boolean; summary: TestSummary | null; note: string | null } | null>(null);

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
        // S17 (F17): never two tabs for one path — a rename retargets
        // openPath AND relabels the tab; whichever lands second must
        // find the path already present instead of appending a twin.
        setFiles(prev => (prev.some(f => f.path === openPath) ? prev : [...prev, { path: openPath, content, original: content, language, modified: false }]));
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
    setFiles(prev => {
      // S17 (F17): if the new path already has a tab (the open effect
      // won the race), drop the old tab instead of mapping it into a
      // duplicate; otherwise relabel in place.
      if (prev.some(f => f.path === renameSignal.to)) return prev.filter(f => f.path !== renameSignal.from);
      return prev.map(f => f.path === renameSignal.from ? { ...f, path: renameSignal.to } : f);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per nonce, not per renameSignal identity
  }, [renameSignal?.nonce]);

  // Reconcile open tabs after a project-wide replace (S6).
  useEffect(() => {
    if (!replaceSignal || !projectId) return;
    const targets = files.filter(f => replaceSignal.paths.includes(f.path) && !f.modified);
    if (targets.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const t of targets) {
        try {
          const r = await lensRun({ domain: 'code', action: 'files-read', input: { projectId, path: t.path } });
          if (cancelled || r.data?.ok === false) continue;
          const content = String(r.data?.result?.content ?? '');
          setFiles(prev => prev.map(f => f.path === t.path && !f.modified ? { ...f, content, original: content, modified: false } : f));
        } catch { /* a tab that fails to reconcile keeps its buffer; the store still holds the replace */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per replace nonce
  }, [replaceSignal?.nonce]);

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

  // S11 (F11): an inline edit is a PROPOSAL until the user accepts it.
  // The old flow applied the model's output to the buffer the moment
  // it arrived — no diff, no checkpoint, on the one AI edit path that
  // worked. Now: the proposal renders as a diff with Accept/Reject;
  // Reject leaves the buffer byte-identical; Accept applies it as one
  // edit (one undo step) with the instruction kept as its receipt.
  const [inlineProposal, setInlineProposal] = useState<{ original: string; edited: string; instruction: string } | null>(null);
  const [inlineError, setInlineError] = useState('');

  async function runInlineEdit() {
    if (!active || !selection.trim() || !inlineInstruction.trim()) return;
    setInlineLoading(true);
    setInlineError('');
    try {
      const r = await lensRun({ domain: 'code', action: 'inline-edit', input: { code: selection, instruction: inlineInstruction, language: active.language } });
      if (r.data?.ok === false) { setInlineError(r.data?.error || 'Inline edit failed.'); return; }
      const edited = String(r.data?.result?.edited || '');
      if (!edited || edited === selection) { setInlineError('The model proposed no change for that instruction.'); return; }
      setInlineProposal({ original: selection, edited, instruction: inlineInstruction.trim() });
    } catch (e) {
      console.error('[Editor] inline-edit', e);
      setInlineError('Inline edit failed: the request did not complete.');
    }
    finally { setInlineLoading(false); }
  }

  function acceptInlineEdit() {
    if (!active || !inlineProposal) return;
    if (!active.content.includes(inlineProposal.original)) {
      setInlineError('The text changed since this proposal was made — reject it and run ⌘K again.');
      return;
    }
    updateContent(active.path, active.content.replace(inlineProposal.original, inlineProposal.edited));
    setInlineProposal(null);
    setInlineInstruction('');
    setShowInlineEdit(false);
  }

  function rejectInlineEdit() {
    // The buffer was never touched — rejecting is just closing.
    setInlineProposal(null);
    setInlineError('');
  }

  async function format() {
    if (!active) return;
    // S15 (F15): the toolbar button runs the editor's OWN Format
    // Document — the same formatter as the context menu, which actually
    // reindents. The format-code macro only normalizes whitespace and
    // left badly-indented files byte-identical; it stays as the
    // fallback for when no editor instance is mounted.
    const action = editorRef.current?.getAction?.('editor.action.formatDocument');
    if (action) { await action.run(); return; }
    try {
      const r = await lensRun({ domain: 'code', action: 'format-code', input: { code: active.content, language: active.language } });
      if (r.data?.ok === false) { setInlineError(r.data?.error || 'Format failed.'); return; }
      const formatted = String(r.data?.result?.formatted || '');
      if (formatted) updateContent(active.path, formatted);
    } catch (e) { console.error('[Editor] format', e); }
  }

  /** S15 (F15): glyph-margin click toggles a bookmark on that line —
   *  the gesture the Bookmarks panel has always named. The macros
   *  (bookmark-add/list/delete) were real; only the gesture was missing. */
  async function toggleBookmarkAtLine(lineNumber: number) {
    if (!active || !projectId) return;
    try {
      const list = await lensRun({ domain: 'code', action: 'bookmark-list', input: { projectId } });
      const existing = ((list.data?.result?.bookmarks as Array<{ id: string; path: string; line: number }> | undefined) || [])
        .find((b) => b.path === active.path && b.line === lineNumber);
      if (existing) {
        await lensRun({ domain: 'code', action: 'bookmark-delete', input: { projectId, id: existing.id } });
      } else {
        const lineText = (active.content.split('\n')[lineNumber - 1] || '').trim().slice(0, 60);
        await lensRun({ domain: 'code', action: 'bookmark-add', input: { projectId, path: active.path, line: lineNumber, label: lineText } });
      }
    } catch { /* the panel re-reads on open; a failed toggle stays silent rather than fake */ }
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
    setTestGenError(null);
    setTestRun(null);
    try {
      const framework = /\.py$/.test(active.path) ? 'pytest' : /\.(ts|tsx|js|jsx)$/.test(active.path) ? 'node:test' : 'the project convention';
      const r = await lensRun({ domain: 'code', action: 'test-generate', input: { code: active.content, framework } });
      if (r.data?.ok === false) { setTestGenError(r.data?.error || 'Test generation failed.'); return; }
      // The contract gate: run-shaped or non-test output is rejected
      // here and NEVER rendered as tests or results (the A8 shape).
      const verdict = validateGeneratedTests(r.data?.result, framework);
      if (!verdict.ok) { setTestGenError(verdict.reason); return; }
      setTestGenResult({ tests: verdict.tests, framework: verdict.framework, suggestedPath: suggestedTestPath(active.path) });
    } catch (e) {
      setTestGenError(e instanceof Error ? e.message : 'Test generation failed.');
    } finally { setTestGenLoading(false); }
  }

  async function runGenerated() {
    if (!active || !testGenResult) return;
    setTestRun({ running: true, summary: null, note: null });
    try {
      const { outcome, summary } = await runGeneratedTests({
        sourceCode: active.content,
        testCode: testGenResult.tests,
        language: /\.py$/.test(active.path) ? 'python' : 'javascript',
        onStatus: (phase) => {
          if (phase === 'loading-runtime') {
            setTestRun({ running: true, summary: null, note: 'Loading the Python runtime — first Python run only; this can take several seconds…' });
          }
        },
      });
      if (summary) {
        setTestRun({ running: false, summary, note: outcome.timedOut ? 'The run was stopped for taking too long — counts above are partial.' : null });
      } else {
        const why = outcome.result.stderr?.trim() || (outcome.timedOut ? 'The tests did not finish in time.' : 'The tests could not run.');
        setTestRun({ running: false, summary: null, note: why });
      }
    } catch (e) {
      setTestRun({ running: false, summary: null, note: e instanceof Error ? e.message : 'The tests could not run.' });
    }
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
            <div className="px-3 py-2 border-b border-white/10 bg-blue-500/[0.06]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3 h-3 text-blue-400" />
                <input
                  value={inlineInstruction}
                  onChange={e => setInlineInstruction(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && runInlineEdit()}
                  placeholder="Inline edit: e.g. rename foo to bar"
                  autoFocus
                  className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-blue-500/30 rounded text-white"
                />
                <span className="text-[10px] text-gray-400 shrink-0">{selection.length} chars selected</span>
                <button onClick={runInlineEdit} disabled={inlineLoading || !inlineInstruction.trim()} className="px-2 py-1 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center gap-1">
                  {inlineLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}Propose edit
                </button>
                <button onClick={() => { setShowInlineEdit(false); setInlineProposal(null); setInlineError(''); }} className="text-gray-400 hover:text-white text-[10px]">esc</button>
              </div>
              {inlineError && <div role="alert" className="mt-1.5 text-[11px] text-rose-300">{inlineError}</div>}
              {inlineProposal && (
                <div className="mt-2 rounded border border-white/10 overflow-hidden">
                  <div className="px-2 py-1 text-[10px] text-gray-300 bg-white/[0.03] border-b border-white/10">
                    Proposed change for “{inlineProposal.instruction}” — nothing is applied until you accept.
                  </div>
                  <pre className="px-2 py-1.5 text-[11px] font-mono whitespace-pre-wrap bg-rose-500/[0.07] text-rose-200 line-through decoration-rose-400/50">{inlineProposal.original}</pre>
                  <pre className="px-2 py-1.5 text-[11px] font-mono whitespace-pre-wrap bg-emerald-500/[0.07] text-emerald-200">{inlineProposal.edited}</pre>
                  <div className="px-2 py-1.5 flex items-center gap-1.5 bg-white/[0.02] border-t border-white/10">
                    <button onClick={acceptInlineEdit} className="px-2 py-0.5 text-[11px] rounded bg-emerald-500/80 text-white font-semibold hover:bg-emerald-400">Accept</button>
                    <button onClick={rejectInlineEdit} className="px-2 py-0.5 text-[11px] rounded bg-white/10 text-gray-200 hover:bg-white/15">Reject</button>
                    <span className="text-[10px] text-gray-500">Reject leaves the file exactly as it is.</span>
                  </div>
                </div>
              )}
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
              ) : testGenError ? (
                <p className="text-amber-300 leading-relaxed">{testGenError}</p>
              ) : testGenResult ? (
                <>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold tracking-wider">GENERATED</span>
                    <span className="text-gray-400">Written by the model for {active.path}. It has not been run{testRun?.summary ? ' — results below' : ''}.</span>
                  </div>
                  <pre className="max-h-48 overflow-auto p-2 rounded bg-black/40 font-mono text-[11px] text-emerald-200 whitespace-pre-wrap">{testGenResult.tests}</pre>
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={saveGeneratedTests} disabled={!projectId} className="px-2 py-1 rounded bg-emerald-600 text-white font-bold hover:bg-emerald-500 disabled:opacity-40">
                      Save as {testGenResult.suggestedPath}
                    </button>
                    <button onClick={runGenerated} disabled={testRun?.running} className="px-2 py-1 rounded bg-blue-600 text-white font-bold hover:bg-blue-500 disabled:opacity-40 inline-flex items-center gap-1">
                      {testRun?.running ? <Loader2 className="w-3 h-3 animate-spin" /> : null}Run tests
                    </button>
                    <button onClick={() => navigator.clipboard?.writeText(testGenResult.tests)} className="px-2 py-1 rounded border border-white/15 text-gray-300 hover:bg-white/[0.05]">Copy</button>
                  </div>
                  {testRun && (
                    <div className="mt-2 p-2 rounded bg-blue-500/[0.07] border border-blue-500/20">
                      <div className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold mb-1">Run results — executed in your browser just now</div>
                      {testRun.running ? (
                        <div className="text-gray-300">{testRun.note || 'Running…'}</div>
                      ) : testRun.summary ? (
                        <>
                          <div className="text-gray-100">{testRun.summary.passed} passed · {testRun.summary.failed} failed · {testRun.summary.total} total</div>
                          {testRun.summary.failures.map((f) => (
                            <div key={f.name} className="mt-1 text-red-300 font-mono text-[11px]">✗ {f.name} — {f.error}</div>
                          ))}
                          {testRun.note && <div className="mt-1 text-amber-300">{testRun.note}</div>}
                        </>
                      ) : (
                        <div className="text-amber-300 whitespace-pre-wrap">{testRun.note}</div>
                      )}
                    </div>
                  )}
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
                onGutterLineClick={(line) => { void toggleBookmarkAtLine(line); }}
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
