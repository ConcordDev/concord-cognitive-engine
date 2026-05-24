'use client';

/**
 * DocsWorkspace — Notion/Confluence-shape collaborative docs surface.
 * Wires the full docs domain: nested page tree, rich block editor
 * (tables, callouts, toggles, embeds, syntax-highlighted code),
 * templates gallery, version history + restore, inline comments &
 * suggestions, live multi-cursor presence, backlinks/mentions graph,
 * database (table) views and per-page share/permission controls.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText, Plus, Trash2, Loader2, Search,
  History, MessageSquare, Share2, Table2, Sparkles, Link2, Users,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { BlockEditorRow } from './BlockEditorRow';
import { TemplatePicker } from './TemplatePicker';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { CommentsPanel } from './CommentsPanel';
import { BacklinksPanel } from './BacklinksPanel';
import { SharePanel } from './SharePanel';
import { DatabaseViews } from './DatabaseViews';
import { usePagePresence } from './usePagePresence';
import type { Block, Page, PageMeta } from './types';

const BLOCK_TYPES: { id: string; label: string }[] = [
  { id: 'paragraph', label: 'Text' },
  { id: 'heading1', label: 'Heading 1' },
  { id: 'heading2', label: 'Heading 2' },
  { id: 'heading3', label: 'Heading 3' },
  { id: 'bulleted_list', label: 'Bulleted list' },
  { id: 'numbered_list', label: 'Numbered list' },
  { id: 'todo', label: 'To-do' },
  { id: 'code', label: 'Code' },
  { id: 'quote', label: 'Quote' },
  { id: 'callout', label: 'Callout' },
  { id: 'toggle', label: 'Toggle' },
  { id: 'table', label: 'Table' },
  { id: 'embed', label: 'Embed' },
  { id: 'divider', label: 'Divider' },
];

type Tab = 'editor' | 'database';
type SidePanel = 'none' | 'versions' | 'comments' | 'backlinks' | 'share';

export function DocsWorkspace() {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [active, setActive] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; title: string; icon: string; snippet?: string }[] | null>(null);
  const [tab, setTab] = useState<Tab>('editor');
  const [side, setSide] = useState<SidePanel>('none');
  const [showTemplates, setShowTemplates] = useState(false);
  const [openCommentCount, setOpenCommentCount] = useState(0);

  const refreshTree = useCallback(async () => {
    const r = await lensRun('docs', 'page-list', {});
    setPages((r.data?.result?.pages as PageMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refreshTree(); }, [refreshTree]);

  const openPage = useCallback(async (id: string) => {
    const r = await lensRun('docs', 'page-detail', { id });
    if (r.data?.ok) setActive(r.data.result?.page as Page);
  }, []);
  const reloadActive = useCallback(async () => {
    if (active) {
      const r = await lensRun('docs', 'page-detail', { id: active.id });
      if (r.data?.ok) setActive(r.data.result?.page as Page);
    }
  }, [active]);

  // ── Live presence (multi-cursor) ──────────────────────────────────────
  const presence = usePagePresence(active?.id ?? null);

  // ── Open-comment badge ────────────────────────────────────────────────
  useEffect(() => {
    if (!active) { setOpenCommentCount(0); return; }
    let alive = true;
    void lensRun('docs', 'comment-list', { pageId: active.id, openOnly: true })
      .then((r) => { if (alive) setOpenCommentCount(Number(r.data?.result?.count ?? 0)); });
    return () => { alive = false; };
  }, [active]);

  async function createPage(parentId: string | null) {
    const r = await lensRun('docs', 'page-create', parentId ? { parentId } : {});
    await refreshTree();
    if (r.data?.ok) await openPage(r.data.result?.page.id as string);
  }
  async function deletePage(id: string) {
    await lensRun('docs', 'page-delete', { id });
    if (active?.id === id) setActive(null);
    await refreshTree();
  }
  async function renamePage(title: string) {
    if (!active) return;
    setActive({ ...active, title });
    await lensRun('docs', 'page-update', { id: active.id, title });
    await refreshTree();
  }
  async function setIcon(icon: string) {
    if (!active || !icon.trim()) return;
    await lensRun('docs', 'page-update', { id: active.id, icon: icon.trim() });
    setActive({ ...active, icon: icon.trim() });
    await refreshTree();
  }
  async function movePage(id: string, parentId: string | null) {
    await lensRun('docs', 'page-move', { id, parentId });
    await refreshTree();
  }

  async function addBlock(type: string, afterId?: string) {
    if (!active) return;
    await lensRun('docs', 'block-add', { pageId: active.id, type, text: '', afterId });
    await reloadActive();
  }
  async function updateBlock(blockId: string, patch: Partial<Block>) {
    if (!active) return;
    await lensRun('docs', 'block-update', { pageId: active.id, blockId, ...patch });
    await reloadActive();
  }
  async function deleteBlock(blockId: string) {
    if (!active) return;
    await lensRun('docs', 'block-delete', { pageId: active.id, blockId });
    await reloadActive();
  }
  async function reorderBlock(blockId: string, direction: 'up' | 'down') {
    if (!active) return;
    await lensRun('docs', 'block-reorder', { pageId: active.id, blockId, direction });
    await reloadActive();
  }

  async function runSearch() {
    if (!search.trim()) { setResults(null); return; }
    const r = await lensRun('docs', 'docs-search', { query: search.trim() });
    setResults((r.data?.result?.results as { id: string; title: string; icon: string; snippet?: string }[]) || []);
  }

  async function snapshotNow() {
    if (!active) return;
    await lensRun('docs', 'version-snapshot', { pageId: active.id });
    setSide('versions');
  }

  const topLevel = useMemo(() => pages.filter(p => !p.parentId), [pages]);
  const childrenOf = useCallback((id: string) => pages.filter(p => p.parentId === id), [pages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-zinc-300" />
        <h3 className="text-sm font-bold text-zinc-100">Docs Workspace</h3>
        <span className="text-[11px] text-zinc-400">Notion / Confluence shape</span>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-zinc-800 p-0.5">
          <button onClick={() => setTab('editor')}
            className={cn('px-2 py-0.5 rounded text-[11px]', tab === 'editor' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400')}>
            Pages
          </button>
          <button onClick={() => setTab('database')}
            className={cn('px-2 py-0.5 rounded text-[11px] flex items-center gap-1', tab === 'database' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400')}>
            <Table2 className="w-3 h-3" /> Databases
          </button>
        </div>
      </div>

      {tab === 'database' ? (
        <DatabaseViews />
      ) : (
        <div className="grid lg:grid-cols-[230px_1fr_300px] sm:grid-cols-[230px_1fr] gap-3">
          {/* Page tree */}
          <div>
            <div className="flex gap-1 mb-2">
              <div className="relative flex-1">
                <Search className="w-3 h-3 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }}
                  placeholder="Search" className="w-full bg-zinc-950 border border-zinc-800 rounded pl-6 pr-2 py-1 text-xs text-zinc-200" />
              </div>
              <button onClick={() => createPage(null)} title="New page"
                className="px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"><Plus className="w-3.5 h-3.5" /></button>
              <button onClick={() => setShowTemplates(true)} title="New from template"
                className="px-1.5 py-1 rounded bg-indigo-900/50 hover:bg-indigo-800/60 text-indigo-200"><Sparkles className="w-3.5 h-3.5" /></button>
            </div>
            {results ? (
              <div>
                <p className="text-[10px] text-zinc-400 mb-1">
                  {results.length} results{' '}
                  <button onClick={() => { setResults(null); setSearch(''); }} className="text-zinc-400 underline">clear</button>
                </p>
                {results.map(r => (
                  <button key={r.id} onClick={() => { void openPage(r.id); setResults(null); }}
                    className="block w-full text-left px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 rounded">
                    <span className="truncate block">{r.icon} {r.title}</span>
                    {r.snippet && <span className="block text-[10px] text-zinc-400 truncate">{r.snippet}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {topLevel.length === 0 && <li className="text-[11px] text-zinc-400 italic">No pages — create one.</li>}
                {topLevel.map(p => (
                  <PageTreeNode key={p.id} page={p} depth={0} activeId={active?.id} childrenOf={childrenOf}
                    onOpen={openPage} onAddChild={(id) => createPage(id)} onDelete={deletePage}
                    onMoveToRoot={(id) => movePage(id, null)} />
                ))}
              </ul>
            )}
          </div>

          {/* Editor */}
          {active ? (
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <input value={active.icon} onChange={e => setIcon(e.target.value)} maxLength={4}
                  className="w-9 text-center text-xl bg-transparent" />
                <input value={active.title} onChange={e => renamePage(e.target.value)}
                  className="flex-1 bg-transparent text-lg font-bold text-zinc-100 focus:outline-none border-b border-transparent focus:border-zinc-700" />
                <button onClick={() => deletePage(active.id)} title="Delete page"
                  className="p-1 text-rose-400 hover:bg-rose-500/10 rounded"><Trash2 className="w-4 h-4" /></button>
              </div>

              {/* page toolbar */}
              <div className="flex flex-wrap items-center gap-1 mb-3 pb-2 border-b border-zinc-800">
                <button onClick={snapshotNow}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600">
                  Save version
                </button>
                <PanelTab icon={<History className="w-3 h-3" />} label="History" active={side === 'versions'}
                  onClick={() => setSide(side === 'versions' ? 'none' : 'versions')} />
                <PanelTab icon={<MessageSquare className="w-3 h-3" />} label="Comments" active={side === 'comments'}
                  badge={openCommentCount} onClick={() => setSide(side === 'comments' ? 'none' : 'comments')} />
                <PanelTab icon={<Link2 className="w-3 h-3" />} label="Backlinks" active={side === 'backlinks'}
                  onClick={() => setSide(side === 'backlinks' ? 'none' : 'backlinks')} />
                <PanelTab icon={<Share2 className="w-3 h-3" />} label="Share" active={side === 'share'}
                  onClick={() => setSide(side === 'share' ? 'none' : 'share')} />
                {presence.cursors.length > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-400">
                    <Users className="w-3 h-3" />
                    {presence.cursors.map(c => (
                      <span key={c.sessionId} title={c.name}
                        className="w-2 h-2 rounded-full inline-block" style={{ background: c.color }} />
                    ))}
                    {presence.cursors.length} editing
                  </span>
                )}
              </div>

              <div className="space-y-1">
                {active.blocks.map(b => (
                  <BlockEditorRow key={b.id} block={b}
                    cursors={presence.cursors.filter(c => c.blockId === b.id)}
                    onChange={(patch) => updateBlock(b.id, patch)}
                    onDelete={() => deleteBlock(b.id)}
                    onUp={() => reorderBlock(b.id, 'up')}
                    onDown={() => reorderBlock(b.id, 'down')}
                    onFocus={() => presence.ping(b.id)} />
                ))}
                {active.blocks.length === 0 && (
                  <p className="text-[11px] text-zinc-400 italic py-2">Empty page — add a block below.</p>
                )}
              </div>

              <div className="mt-3 flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-zinc-400">Add block:</span>
                {BLOCK_TYPES.map(t => (
                  <button key={t.id} onClick={() => addBlock(t.id)}
                    className="px-1.5 py-0.5 text-[10px] rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600">
                    {t.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-zinc-400">
                Tip: write <code className="text-zinc-400">[[Page title]]</code> in any block to link pages — they appear in Backlinks.
              </p>
            </div>
          ) : (
            <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[160px]">
              Select or create a page.
            </div>
          )}

          {/* Side panel */}
          {active && side !== 'none' && (
            <div className="bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 lg:block">
              {side === 'versions' && (
                <VersionHistoryPanel pageId={active.id} onRestored={reloadActive} />
              )}
              {side === 'comments' && (
                <CommentsPanel page={active} onChanged={() => {
                  void reloadActive();
                  void lensRun('docs', 'comment-list', { pageId: active.id, openOnly: true })
                    .then((r) => setOpenCommentCount(Number(r.data?.result?.count ?? 0)));
                }} />
              )}
              {side === 'backlinks' && (
                <BacklinksPanel pageId={active.id} onOpenPage={openPage} />
              )}
              {side === 'share' && (
                <SharePanel pageId={active.id} />
              )}
            </div>
          )}
        </div>
      )}

      {showTemplates && (
        <TemplatePicker
          onClose={() => setShowTemplates(false)}
          onApplied={async (pageId) => {
            setShowTemplates(false);
            await refreshTree();
            await openPage(pageId);
          }} />
      )}
    </div>
  );
}

function PanelTab({ icon, label, active, badge, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; badge?: number; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={cn('px-1.5 py-0.5 text-[10px] rounded border flex items-center gap-1',
        active ? 'border-indigo-600 bg-indigo-900/40 text-indigo-200' : 'border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600')}>
      {icon} {label}
      {badge ? <span className="bg-rose-600 text-white rounded-full px-1 text-[9px]">{badge}</span> : null}
    </button>
  );
}

function PageTreeNode({ page, depth, activeId, childrenOf, onOpen, onAddChild, onDelete, onMoveToRoot }: {
  page: PageMeta; depth: number; activeId?: string;
  childrenOf: (id: string) => PageMeta[];
  onOpen: (id: string) => void; onAddChild: (id: string) => void;
  onDelete: (id: string) => void; onMoveToRoot: (id: string) => void;
}) {
  const kids = childrenOf(page.id);
  const dragRef = useRef(false);
  return (
    <li>
      <div
        draggable
        onDragStart={() => { dragRef.current = true; }}
        onDragEnd={() => { dragRef.current = false; }}
        className={cn('group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-zinc-800', activeId === page.id && 'bg-zinc-800')}
        style={{ paddingLeft: `${6 + depth * 12}px` }}>
        <button onClick={() => onOpen(page.id)} className="flex-1 text-left text-xs text-zinc-300 truncate">
          {page.icon} {page.title}
        </button>
        {page.parentId && (
          <button onClick={() => onMoveToRoot(page.id)} title="Move to top level"
            className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-200 text-[9px]">↑root</button>
        )}
        <button onClick={() => onAddChild(page.id)} title="Add sub-page"
          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-200"><Plus className="w-3 h-3" /></button>
        <button onClick={() => onDelete(page.id)} title="Delete"
          className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map(k => (
            <PageTreeNode key={k.id} page={k} depth={depth + 1} activeId={activeId} childrenOf={childrenOf}
              onOpen={onOpen} onAddChild={onAddChild} onDelete={onDelete} onMoveToRoot={onMoveToRoot} />
          ))}
        </ul>
      )}
    </li>
  );
}
