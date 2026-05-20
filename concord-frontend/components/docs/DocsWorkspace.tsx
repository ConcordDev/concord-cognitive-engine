'use client';

/**
 * DocsWorkspace — Notion 2026-shape page/block editor: a nested page
 * tree plus an inline block editor (headings, lists, todos, code,
 * quote, callout, divider). Wires the docs.page-* and docs.block-*
 * macros.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  FileText, Plus, Trash2, Loader2, ChevronUp, ChevronDown, Search,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PageMeta { id: string; title: string; icon: string; parentId: string | null; blockCount: number }
interface Block { id: string; type: string; text: string; checked: boolean }
interface Page { id: string; title: string; icon: string; blocks: Block[] }

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
  { id: 'divider', label: 'Divider' },
];

export function DocsWorkspace() {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [active, setActive] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<{ id: string; title: string; icon: string }[] | null>(null);

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
  async function reloadActive() {
    if (active) await openPage(active.id);
  }

  async function createPage(parentId: string | null) {
    const r = await lensRun('docs', 'page-create', parentId ? { parentId } : {});
    await refreshTree();
    if (r.data?.ok) await openPage(r.data.result?.page.id);
  }
  async function deletePage(id: string) {
    if (!confirm('Delete this page and its sub-pages?')) return;
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
    setResults((r.data?.result?.results as { id: string; title: string; icon: string }[]) || []);
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  const topLevel = pages.filter(p => !p.parentId);
  const childrenOf = (id: string) => pages.filter(p => p.parentId === id);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-zinc-300" />
        <h3 className="text-sm font-bold text-zinc-100">Docs Workspace</h3>
        <span className="text-[11px] text-zinc-500">Notion shape</span>
      </div>

      <div className="grid sm:grid-cols-[220px_1fr] gap-3">
        {/* Page tree */}
        <div>
          <div className="flex gap-1 mb-2">
            <div className="relative flex-1">
              <Search className="w-3 h-3 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void runSearch(); }}
                placeholder="Search" className="w-full bg-zinc-950 border border-zinc-800 rounded pl-6 pr-2 py-1 text-xs text-zinc-200" />
            </div>
            <button onClick={() => createPage(null)} className="px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          {results ? (
            <div>
              <p className="text-[10px] text-zinc-500 mb-1">{results.length} results <button onClick={() => { setResults(null); setSearch(''); }} className="text-zinc-400 underline">clear</button></p>
              {results.map(r => (
                <button key={r.id} onClick={() => { openPage(r.id); setResults(null); }} className="block w-full text-left px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 rounded truncate">
                  {r.icon} {r.title}
                </button>
              ))}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {topLevel.length === 0 && <li className="text-[11px] text-zinc-600 italic">No pages — create one.</li>}
              {topLevel.map(p => (
                <PageTreeNode key={p.id} page={p} depth={0} activeId={active?.id} childrenOf={childrenOf}
                  onOpen={openPage} onAddChild={(id) => createPage(id)} onDelete={deletePage} />
              ))}
            </ul>
          )}
        </div>

        {/* Editor */}
        {active ? (
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-3">
              <input value={active.icon} onChange={e => setIcon(e.target.value)} maxLength={4}
                className="w-9 text-center text-xl bg-transparent" />
              <input value={active.title} onChange={e => renamePage(e.target.value)}
                className="flex-1 bg-transparent text-lg font-bold text-zinc-100 focus:outline-none border-b border-transparent focus:border-zinc-700" />
              <button onClick={() => deletePage(active.id)} className="p-1 text-rose-400 hover:bg-rose-500/10 rounded"><Trash2 className="w-4 h-4" /></button>
            </div>

            <div className="space-y-1">
              {active.blocks.map(b => (
                <BlockEditorRow key={b.id} block={b}
                  onChange={(patch) => updateBlock(b.id, patch)}
                  onDelete={() => deleteBlock(b.id)}
                  onUp={() => reorderBlock(b.id, 'up')}
                  onDown={() => reorderBlock(b.id, 'down')} />
              ))}
            </div>

            <div className="mt-3 flex items-center gap-1 flex-wrap">
              <span className="text-[10px] text-zinc-500">Add block:</span>
              {BLOCK_TYPES.map(t => (
                <button key={t.id} onClick={() => addBlock(t.id)}
                  className="px-1.5 py-0.5 text-[10px] rounded border border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600">
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-500 min-h-[160px]">
            Select or create a page.
          </div>
        )}
      </div>
    </div>
  );
}

function PageTreeNode({ page, depth, activeId, childrenOf, onOpen, onAddChild, onDelete }: {
  page: PageMeta; depth: number; activeId?: string;
  childrenOf: (id: string) => PageMeta[];
  onOpen: (id: string) => void; onAddChild: (id: string) => void; onDelete: (id: string) => void;
}) {
  const kids = childrenOf(page.id);
  return (
    <li>
      <div className={cn('group flex items-center gap-1 rounded px-1.5 py-1 hover:bg-zinc-800', activeId === page.id && 'bg-zinc-800')}
        style={{ paddingLeft: `${6 + depth * 12}px` }}>
        <button onClick={() => onOpen(page.id)} className="flex-1 text-left text-xs text-zinc-300 truncate">
          {page.icon} {page.title}
        </button>
        <button onClick={() => onAddChild(page.id)} className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200"><Plus className="w-3 h-3" /></button>
        <button onClick={() => onDelete(page.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
      </div>
      {kids.length > 0 && (
        <ul>
          {kids.map(k => (
            <PageTreeNode key={k.id} page={k} depth={depth + 1} activeId={activeId} childrenOf={childrenOf}
              onOpen={onOpen} onAddChild={onAddChild} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </li>
  );
}

function BlockEditorRow({ block, onChange, onDelete, onUp, onDown }: {
  block: Block; onChange: (patch: Partial<Block>) => void;
  onDelete: () => void; onUp: () => void; onDown: () => void;
}) {
  const [text, setText] = useState(block.text);
  useEffect(() => { setText(block.text); }, [block.text]);

  const commit = () => { if (text !== block.text) onChange({ text }); };

  if (block.type === 'divider') {
    return (
      <div className="group flex items-center gap-1">
        <hr className="flex-1 border-zinc-700" />
        <RowControls onDelete={onDelete} onUp={onUp} onDown={onDown} />
      </div>
    );
  }

  const cls: Record<string, string> = {
    heading1: 'text-lg font-bold text-zinc-100',
    heading2: 'text-base font-bold text-zinc-100',
    heading3: 'text-sm font-semibold text-zinc-200',
    code: 'font-mono text-xs bg-zinc-950 text-emerald-300 rounded px-1.5 py-1',
    quote: 'border-l-2 border-zinc-600 pl-2 italic text-zinc-400',
    callout: 'bg-amber-900/20 border border-amber-900/40 rounded px-2 py-1 text-amber-100',
    paragraph: 'text-sm text-zinc-200',
    bulleted_list: 'text-sm text-zinc-200',
    numbered_list: 'text-sm text-zinc-200',
    todo: 'text-sm text-zinc-200',
  };

  return (
    <div className="group flex items-start gap-1">
      {block.type === 'todo' && (
        <input type="checkbox" checked={block.checked} onChange={e => onChange({ checked: e.target.checked })}
          className="mt-1.5 accent-emerald-500" />
      )}
      {block.type === 'bulleted_list' && <span className="text-zinc-500 mt-1">•</span>}
      {block.type === 'numbered_list' && <span className="text-zinc-500 mt-1 text-xs">#</span>}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        rows={1}
        placeholder={`Type ${block.type.replace('_', ' ')}…`}
        className={cn('flex-1 bg-transparent resize-none focus:outline-none focus:bg-zinc-800/40 rounded px-1',
          cls[block.type] || cls.paragraph, block.type === 'todo' && block.checked && 'line-through text-zinc-500')}
      />
      <RowControls onDelete={onDelete} onUp={onUp} onDown={onDown} />
    </div>
  );
}

function RowControls({ onDelete, onUp, onDown }: { onDelete: () => void; onUp: () => void; onDown: () => void }) {
  return (
    <div className="opacity-0 group-hover:opacity-100 flex items-center">
      <button onClick={onUp} className="text-zinc-600 hover:text-zinc-300"><ChevronUp className="w-3 h-3" /></button>
      <button onClick={onDown} className="text-zinc-600 hover:text-zinc-300"><ChevronDown className="w-3 h-3" /></button>
      <button onClick={onDelete} className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
    </div>
  );
}
