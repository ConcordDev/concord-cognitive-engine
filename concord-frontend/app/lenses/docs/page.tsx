'use client';

/**
 * /lenses/docs — Docs Sprint A + B.
 *
 * Real document editor + page tree + comments + version history +
 * sharing + multi-cursor presence + markdown I/O (Sprint A) + full
 * AI surface: Ctrl-K command menu, voice dictation, Q&A panel,
 * Custom AI Skills manager (Sprint B). Backed by migrations 211 +
 * 212; all persistence is DB-backed.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { callDocsMacro } from '@/lib/api/docs';
import { BlockEditor } from '@/components/editor/BlockEditor';
import { DocPageTree } from '@/components/docs/DocPageTree';
import { DocOutlinePanel } from '@/components/docs/DocOutlinePanel';
import { DocCommentsPanel } from '@/components/docs/DocCommentsPanel';
import { DocVersionsPanel } from '@/components/docs/DocVersionsPanel';
import { DocBacklinksPanel } from '@/components/docs/DocBacklinksPanel';
import { DocSharePanel } from '@/components/docs/DocSharePanel';
import { DocPresenceBar } from '@/components/docs/DocPresenceBar';
import { DocImportModal } from '@/components/docs/DocImportModal';
import { DocAICommandMenu } from '@/components/docs/DocAICommandMenu';
import { DocVoiceDictate } from '@/components/docs/DocVoiceDictate';
import { DocQAPanel } from '@/components/docs/DocQAPanel';
import { DocSkillsManager } from '@/components/docs/DocSkillsManager';
import { DocTemplatePicker } from '@/components/docs/DocTemplatePicker';
import { DocAgentPanel } from '@/components/docs/DocAgentPanel';
import { DocMintModal } from '@/components/docs/DocMintModal';
import {
  Search, Plus, Share2, Clock, MessageSquare, Link2, Download, Upload,
  Loader2, FileText, ListTree, Star, Sparkles, HelpCircle, Bookmark, Bot, Coins,
} from 'lucide-react';

interface Document {
  id: string;
  title: string;
  icon?: string | null;
  kind: string;
  visibility: string;
  parent_id?: string | null;
  word_count: number;
  updated_at: number;
  content_html?: string;
  slug?: string | null;
}

type RightPanel = 'outline' | 'comments' | 'versions' | 'backlinks' | 'share' | 'qa' | 'agents' | null;

const SAVE_DEBOUNCE_MS = 1500;

export default function DocsLensPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [activeDoc, setActiveDoc] = useState<Document | null>(null);
  const [editorContent, setEditorContent] = useState<string>('');
  const [titleDraft, setTitleDraft] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Document[]>([]);
  const [rightPanel, setRightPanel] = useState<RightPanel>('outline');
  const [importOpen, setImportOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [mintOpen, setMintOpen] = useState(false);
  const [selectionText, setSelectionText] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // ─── Ctrl-K / Cmd-K opens AI menu ───────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        // Capture selection at the moment the menu opens
        const sel = typeof window !== 'undefined' ? window.getSelection()?.toString() || '' : '';
        setSelectionText(sel);
        setAiMenuOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ─── Load doc list on mount ─────────────────────────────────────
  const refreshList = useCallback(async () => {
    try {
      const r = await callDocsMacro<{ documents?: Document[] }>('list', { limit: 200 });
      if (r?.documents) setDocs(r.documents);
    } catch (e) {
      console.error('docs.list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  // ─── Load active doc when selection changes ─────────────────────
  useEffect(() => {
    if (!activeDocId) { setActiveDoc(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await callDocsMacro<{ document?: Document }>('get', { id: activeDocId });
        if (cancelled) return;
        if (r?.ok && r.document) {
          setActiveDoc(r.document);
          setEditorContent(r.document.content_html || '');
          setTitleDraft(r.document.title || '');
        }
      } catch (e) { console.error('docs.get failed', e); }
    })();
    return () => { cancelled = true; };
  }, [activeDocId]);

  // ─── Search ─────────────────────────────────────────────────────
  useEffect(() => {
    if (searchQuery.trim().length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await callDocsMacro<{ results?: Document[] }>('search', { query: searchQuery, limit: 20 });
        setSearchResults(r?.results || []);
      } catch (e) { console.error('docs.search failed', e); }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ─── Auto-save with debounce ────────────────────────────────────
  const scheduleSave = useCallback((nextContent?: string, nextTitle?: string) => {
    if (!activeDocId) return;
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        const r = await callDocsMacro<{ row?: Document }>('update', {
          id: activeDocId,
          contentHtml: nextContent ?? editorContent,
          title: nextTitle ?? titleDraft,
        });
        if (r?.ok) {
          setLastSavedAt(Date.now());
          dirtyRef.current = false;
          refreshList();
        }
      } catch (e) { console.error('docs.update failed', e); }
      finally { setSaving(false); }
    }, SAVE_DEBOUNCE_MS);
  }, [activeDocId, editorContent, titleDraft, refreshList]);

  const onContentChange = useCallback((html: string) => {
    setEditorContent(html);
    scheduleSave(html, titleDraft);
  }, [scheduleSave, titleDraft]);

  const onTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTitleDraft(e.target.value);
    scheduleSave(editorContent, e.target.value);
  }, [scheduleSave, editorContent]);

  const createNewDoc = useCallback(async (parentId?: string | null) => {
    try {
      const r = await callDocsMacro<{ id?: string }>('create', {
        title: 'Untitled', parentId: parentId || null,
      });
      if (r?.ok && r.id) {
        await refreshList();
        setActiveDocId(r.id);
        setRightPanel('outline');
      }
    } catch (e) { console.error('docs.create failed', e); }
  }, [refreshList]);

  const exportMd = useCallback(async () => {
    if (!activeDocId) return;
    const r = await callDocsMacro<{ markdown?: string; filename?: string }>('export_md', { id: activeDocId });
    if (!r?.ok || !r.markdown) return;
    const blob = new Blob([r.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = r.filename || 'doc.md';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [activeDocId]);

  const manualSnapshot = useCallback(async () => {
    if (!activeDocId) return;
    await callDocsMacro('snapshot', {
      id: activeDocId,
      label: `Manual save at ${new Date().toLocaleString()}`,
    });
    setRightPanel('versions');
  }, [activeDocId]);

  // Save-status indicator copy
  const saveStatus = useMemo(() => {
    if (saving) return 'Saving…';
    if (dirtyRef.current) return 'Unsaved changes';
    if (lastSavedAt) {
      const secs = Math.floor((Date.now() - lastSavedAt) / 1000);
      if (secs < 5) return 'Saved';
      if (secs < 60) return `Saved ${secs}s ago`;
      return `Saved ${Math.floor(secs / 60)}m ago`;
    }
    return '';
  }, [saving, lastSavedAt]);

  const rootDocs = useMemo(() => docs.filter((d) => !d.parent_id), [docs]);

  // ─── AI menu callbacks ──────────────────────────────────────────
  const insertAtCursor = useCallback((html: string) => {
    // Append to current content; granular cursor-positioned insert
    // ships in Sprint C (Tiptap commands).
    const next = (editorContent || '') + (html || '');
    setEditorContent(next);
    scheduleSave(next, titleDraft);
  }, [editorContent, titleDraft, scheduleSave]);

  const replaceSelection = useCallback((text: string) => {
    // Best-effort string replacement on the HTML. If the selection
    // doesn't appear verbatim (edited since menu opened), append the
    // edit at the end instead of silently dropping it.
    if (!selectionText || !editorContent.includes(selectionText)) {
      insertAtCursor(`<p>${text}</p>`);
      return;
    }
    const next = editorContent.replace(selectionText, text);
    setEditorContent(next);
    scheduleSave(next, titleDraft);
  }, [selectionText, editorContent, titleDraft, scheduleSave, insertAtCursor]);

  const cursorContext = useMemo(() => {
    // Strip HTML and grab the tail as "where the cursor is".
    return (editorContent || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(-1500);
  }, [editorContent]);

  return (
    <LensShell lensId="docs">
      <div className="flex h-[calc(100vh-3.5rem)] bg-black/40">
        {/* ─── Sidebar: tree + search ─────────────────────────────── */}
        <div className="w-72 border-r border-white/10 flex flex-col bg-black/60">
          <div className="p-3 border-b border-white/10 space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white/80 flex-1">Documents</h2>
              <button
                onClick={() => createNewDoc(null)}
                className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
                title="New document"
              >
                <Plus className="w-4 h-4" />
              </button>
              <button
                onClick={() => setTemplatesOpen(true)}
                className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
                title="Template library"
              >
                <Bookmark className="w-4 h-4" />
              </button>
              <button
                onClick={() => setImportOpen(true)}
                className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
                title="Import Markdown"
              >
                <Upload className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 w-3.5 h-3.5 text-white/40" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search docs…"
                className="w-full pl-7 pr-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white placeholder-white/40 focus:outline-none focus:border-cyan-400/40"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-white/40">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : searchQuery.length >= 2 ? (
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-white/40 px-2 py-1">
                  {searchResults.length} results
                </div>
                {searchResults.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setActiveDocId(d.id)}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-white/10 ${
                      activeDocId === d.id ? 'bg-cyan-500/10 text-cyan-200' : 'text-white/80'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-white/40" />
                      <span className="flex-1 truncate">{d.title || 'Untitled'}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <DocPageTree
                docs={docs}
                rootDocs={rootDocs}
                activeId={activeDocId}
                onSelect={setActiveDocId}
                onCreateChild={(parentId) => createNewDoc(parentId)}
              />
            )}
          </div>
        </div>

        {/* ─── Editor pane ────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-black/40">
            {activeDoc && (
              <>
                <input
                  value={titleDraft}
                  onChange={onTitleChange}
                  placeholder="Untitled"
                  className="flex-1 bg-transparent text-lg font-semibold text-white placeholder-white/30 focus:outline-none"
                />
                <DocPresenceBar documentId={activeDocId!} />
                <span className="text-xs text-white/40 mr-2">{saveStatus}</span>
                <DocVoiceDictate documentId={activeDocId} onTranscript={insertAtCursor} />
                <button
                  onClick={() => {
                    const sel = typeof window !== 'undefined' ? window.getSelection()?.toString() || '' : '';
                    setSelectionText(sel);
                    setAiMenuOpen(true);
                  }}
                  className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
                  title="AI actions (⌘K)"
                >
                  <Sparkles className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setSkillsOpen(true)}
                  className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
                  title="AI Skills library"
                >
                  <HelpCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={manualSnapshot}
                  className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
                  title="Take version snapshot"
                >
                  <Star className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setMintOpen(true)}
                  className="p-1.5 rounded hover:bg-white/10 text-amber-300/80 hover:text-amber-300"
                  title="Mint as DTU"
                >
                  <Coins className="w-4 h-4" />
                </button>
                <button
                  onClick={exportMd}
                  className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white"
                  title="Export Markdown"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setRightPanel('share')}
                  className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-xs font-medium flex items-center gap-1"
                >
                  <Share2 className="w-3 h-3" /> Share
                </button>
              </>
            )}
            {!activeDoc && (
              <div className="flex-1 text-white/40 text-sm">No document selected</div>
            )}
          </div>

          {/* Editor body */}
          <div className="flex-1 overflow-y-auto px-12 py-8">
            {activeDoc ? (
              <div className="max-w-3xl mx-auto">
                <BlockEditor
                  key={activeDocId}
                  content={editorContent}
                  onChange={onContentChange}
                  placeholder="Start writing… Press / for commands."
                  autoFocus
                  minHeight="60vh"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-white/40 gap-4">
                <FileText className="w-12 h-12 opacity-30" />
                <div className="text-center">
                  <p className="text-lg mb-2">No document open</p>
                  <p className="text-sm">Pick one from the sidebar, or create a new one.</p>
                </div>
                <button
                  onClick={() => createNewDoc(null)}
                  className="mt-2 px-4 py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> New document
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right panel ────────────────────────────────────────── */}
        {activeDoc && (
          <div className="w-80 border-l border-white/10 flex flex-col bg-black/60">
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 flex-wrap">
              <RightTab icon={<ListTree className="w-3.5 h-3.5" />} label="Outline"   active={rightPanel === 'outline'}   onClick={() => setRightPanel('outline')} />
              <RightTab icon={<HelpCircle className="w-3.5 h-3.5" />} label="Ask"       active={rightPanel === 'qa'}       onClick={() => setRightPanel('qa')} />
              <RightTab icon={<Bot className="w-3.5 h-3.5" />} label="Agents"   active={rightPanel === 'agents'} onClick={() => setRightPanel('agents')} />
              <RightTab icon={<MessageSquare className="w-3.5 h-3.5" />} label="Comments" active={rightPanel === 'comments'} onClick={() => setRightPanel('comments')} />
              <RightTab icon={<Clock className="w-3.5 h-3.5" />} label="History"   active={rightPanel === 'versions'} onClick={() => setRightPanel('versions')} />
              <RightTab icon={<Link2 className="w-3.5 h-3.5" />} label="Links"     active={rightPanel === 'backlinks'} onClick={() => setRightPanel('backlinks')} />
            </div>
            <div className="flex-1 overflow-y-auto">
              {rightPanel === 'outline'   && <DocOutlinePanel documentId={activeDocId!} contentHtml={editorContent} />}
              {rightPanel === 'qa'        && <DocQAPanel documentId={activeDocId!} onJumpToDoc={(id) => setActiveDocId(id)} />}
              {rightPanel === 'agents'    && <DocAgentPanel documentId={activeDocId!} />}
              {rightPanel === 'comments'  && <DocCommentsPanel documentId={activeDocId!} />}
              {rightPanel === 'versions'  && <DocVersionsPanel documentId={activeDocId!} onRestore={() => setActiveDocId(activeDocId)} />}
              {rightPanel === 'backlinks' && <DocBacklinksPanel documentId={activeDocId!} />}
              {rightPanel === 'share'     && <DocSharePanel documentId={activeDocId!} onClose={() => setRightPanel('outline')} />}
            </div>
          </div>
        )}
      </div>

      <DocImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(id) => {
          setImportOpen(false);
          refreshList();
          setActiveDocId(id);
        }}
      />

      <DocAICommandMenu
        open={aiMenuOpen}
        onClose={() => setAiMenuOpen(false)}
        documentId={activeDocId}
        selection={selectionText}
        cursorContext={cursorContext}
        onInsert={insertAtCursor}
        onReplaceSelection={replaceSelection}
      />

      <DocSkillsManager open={skillsOpen} onClose={() => setSkillsOpen(false)} />

      <DocTemplatePicker
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        currentDocId={activeDocId}
        onApplied={(id) => { setTemplatesOpen(false); refreshList(); setActiveDocId(id); }}
      />

      {activeDocId && (
        <DocMintModal
          open={mintOpen}
          onClose={() => setMintOpen(false)}
          documentId={activeDocId}
        />
      )}
    </LensShell>
  );
}

function RightTab({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-white/60 hover:bg-white/5 hover:text-white/80'
      }`}
    >
      {icon}{label}
    </button>
  );
}
