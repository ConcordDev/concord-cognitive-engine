'use client';

/**
 * CollabBoardSection — full collaborative whiteboard workbench.
 *
 * Boards rail (left) + interactive WhiteboardCanvas (center) +
 * AI sidebar (right, collapsible). Persists every shape change through
 * the whiteboard.board-save macro and surfaces 2026 AI features:
 * cluster sticky notes, summarize → action items, generate from prompt.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, Trash2, Loader2, Save, Sparkles, MessageSquare, Download, ChevronRight, ChevronDown, Plus, Copy, Timer, Square } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { WhiteboardCanvas, Shape } from './WhiteboardCanvas';
import { WhiteboardCollabPanel } from './WhiteboardCollabPanel';
import { useWhiteboardCollab } from '@/hooks/useWhiteboardCollab';
import { cn } from '@/lib/utils';

interface BoardMeta { id: string; title: string; createdAt: string; updatedAt: string; elementCount: number }
interface Cluster { theme: string; memberIds: string[]; size: number }
interface SummaryResult { summary: string; actionItems: Array<{ text: string; owner: string | null }>; source: string }
interface Comment { id: string; elementId: string; authorName: string; body: string; createdAt: string; resolved: boolean }

const TEMPLATE_KINDS = [
  { id: 'brainstorm',   label: 'Brainstorm' },
  { id: 'retro',        label: 'Retrospective' },
  { id: 'okr',          label: 'OKR' },
  { id: 'user_journey', label: 'User journey' },
  { id: 'flowchart',    label: 'Flowchart' },
  { id: 'swot',         label: 'SWOT' },
] as const;

export function CollabBoardSection() {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeShapes, setActiveShapes] = useState<Shape[]>([]);
  const [activeTitle, setActiveTitle] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [aiTab, setAITab] = useState<'cluster' | 'summarize' | 'generate' | 'comments' | 'export' | 'collab'>('cluster');
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [clustering, setClustering] = useState(false);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [genPrompt, setGenPrompt] = useState('');
  const [genKind, setGenKind] = useState<typeof TEMPLATE_KINDS[number]['id']>('brainstorm');
  const [generating, setGenerating] = useState(false);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [showAI, setShowAI] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Realtime collaboration (Batch G E1/E3/E4): join the board's room, mirror remote
  // scene-updates onto the canvas, broadcast local edits + cursor, surface peers + votes.
  const collab = useWhiteboardCollab({ boardId: activeId });
  const [syncSignal, setSyncSignal] = useState(0);
  const [syncShapes, setSyncShapes] = useState<Shape[]>([]);
  const appliedUpdateRef = useRef(0);

  useEffect(() => {
    if (collab.remoteSceneUpdateCount > appliedUpdateRef.current && collab.remoteScene) {
      appliedUpdateRef.current = collab.remoteSceneUpdateCount;
      const els = (collab.remoteScene as { elements?: Shape[] })?.elements;
      if (Array.isArray(els)) {
        setSyncShapes(els);
        setSyncSignal((s) => s + 1); // tells the canvas to replace its scene
        setActiveShapes(els);        // keep CollabBoardSection's copy in sync (no dirty → no save echo)
      }
    }
  }, [collab.remoteSceneUpdateCount, collab.remoteScene]);

  const peerCursorList = useMemo(
    () => Object.values(collab.peerCursors).map((c) => ({ userId: c.userId, x: c.x, y: c.y })),
    [collab.peerCursors],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshBoards(); }, []);

  // Autosave on shape changes (1.5s debounce).
  useEffect(() => {
    if (!activeId || !dirty) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { save(); }, 1500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeShapes, dirty]);

  async function refreshBoards() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'board-list', input: {} });
      const list = (r.data?.result?.boards || []) as BoardMeta[];
      setBoards(list);
      if (!activeId && list.length > 0) openBoard(list[0].id);
    } catch (e) { console.error('[Board] boards', e); }
    finally { setLoading(false); }
  }

  async function openBoard(id: string) {
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'board-load', input: { id } });
      const b = r.data?.result?.board;
      if (!b) { alert('board not found'); return; }
      setActiveId(id);
      setActiveTitle(b.title || 'Untitled');
      setActiveShapes(Array.isArray(b.scene?.elements) ? b.scene.elements as Shape[] : []);
      setDirty(false);
      setClusters(null);
      setSummary(null);
      await refreshComments(id);
    } catch (e) { console.error('[Board] load', e); }
  }

  async function createBoard() {
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'board-save', input: {
        title: 'New board',
        scene: { elements: [], appState: {} },
      } });
      const id = r.data?.result?.board?.id;
      if (id) { await refreshBoards(); openBoard(id); }
    } catch (e) { console.error('[Board] create', e); }
  }

  async function deleteBoard(id: string) {
    if (!confirm('Delete this board?')) return;
    try {
      await lensRun({ domain: 'whiteboard', action: 'board-delete', input: { id } });
      if (activeId === id) { setActiveId(null); setActiveShapes([]); setActiveTitle(''); }
      await refreshBoards();
    } catch (e) { console.error('[Board] delete', e); }
  }

  async function duplicateBoard() {
    if (!activeId) return;
    if (dirty) await save();
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'board-duplicate', input: { id: activeId } });
      const newId = r.data?.result?.board?.id;
      if (newId) { await refreshBoards(); openBoard(newId); }
    } catch (e) { console.error('[Board] duplicate', e); }
  }

  async function save() {
    if (!activeId) return;
    setSaving(true);
    try {
      await lensRun({ domain: 'whiteboard', action: 'board-save', input: {
        id: activeId,
        title: activeTitle || 'Untitled',
        scene: { elements: activeShapes, appState: {} },
      } });
      setDirty(false);
    } catch (e) { console.error('[Board] save', e); }
    finally { setSaving(false); }
  }

  async function renameBoard(title: string) {
    setActiveTitle(title);
    setDirty(true);
  }

  function onCanvasChange(shapes: Shape[]) {
    setActiveShapes(shapes);
    setDirty(true);
    // Push to peers (no-ops server-side for a private/un-shared board).
    collab.broadcastScene({ elements: shapes, appState: {} });
  }

  // ── AI actions ─────────────────────────────────────────────────

  async function runCluster() {
    if (!activeId) return;
    if (dirty) await save();
    setClustering(true);
    setClusters(null);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'ai-cluster-stickies', input: { boardId: activeId } });
      setClusters((r.data?.result?.clusters || []) as Cluster[]);
    } catch (e) { console.error('[Board] cluster', e); }
    finally { setClustering(false); }
  }

  async function runSummarize() {
    if (!activeId) return;
    if (dirty) await save();
    setSummarizing(true);
    setSummary(null);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'ai-summarize-board', input: { boardId: activeId } });
      setSummary(r.data?.result as SummaryResult);
    } catch (e) { console.error('[Board] summarize', e); }
    finally { setSummarizing(false); }
  }

  async function runGenerate() {
    if (!genPrompt.trim()) return;
    setGenerating(true);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'ai-generate-board', input: { prompt: genPrompt.trim(), kind: genKind } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      const scene = r.data?.result?.scene;
      const elements = (scene?.elements || []) as Shape[];
      // Create a new board with the generated scene.
      const save = await lensRun({ domain: 'whiteboard', action: 'board-save', input: {
        title: `Generated: ${genPrompt.slice(0, 60)}`,
        scene: { elements, appState: scene?.appState || {} },
      } });
      const newId = save.data?.result?.board?.id;
      setGenPrompt('');
      await refreshBoards();
      if (newId) openBoard(newId);
    } catch (e) { console.error('[Board] generate', e); }
    finally { setGenerating(false); }
  }

  async function exportBoard() {
    if (!activeId) return;
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'board-export-json', input: { boardId: activeId } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      const blob = new Blob([JSON.stringify(r.data?.result?.export, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(activeTitle || 'board').replace(/\s+/g, '-')}.concord-whiteboard.json`;
      a.click();
    } catch (e) { console.error('[Board] export', e); }
  }

  // ── Comments ──────────────────────────────────────────────────

  async function refreshComments(id: string) {
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'comments-list', input: { boardId: id } });
      setComments((r.data?.result?.comments as Record<string, Comment[]>) || {});
    } catch (e) { console.error('[Board] comments', e); }
  }

  async function addComment(elementId: string, body: string) {
    if (!activeId || !body.trim()) return;
    try {
      await lensRun({ domain: 'whiteboard', action: 'comments-add', input: { boardId: activeId, elementId, body: body.trim() } });
      await refreshComments(activeId);
    } catch (e) { console.error('[Board] add comment', e); }
  }

  async function resolveComment(id: string) {
    if (!activeId) return;
    try {
      await lensRun({ domain: 'whiteboard', action: 'comments-resolve', input: { boardId: activeId, id } });
      await refreshComments(activeId);
    } catch (e) { console.error('[Board] resolve', e); }
  }

  const totalOpenComments = useMemo(() => Object.values(comments).reduce((s, arr) => s + arr.filter(c => !c.resolved).length, 0), [comments]);

  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[640px] bg-[#0d1117] border border-pink-500/20 rounded-lg overflow-hidden">
      {/* Boards rail */}
      <aside className="w-56 bg-[#0a0c10] border-r border-white/5 flex flex-col flex-shrink-0">
        <header className="px-3 py-2.5 border-b border-white/5 flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-200 flex-1">Boards</span>
          <button onClick={createBoard} className="p-1 text-pink-300 hover:text-pink-200" title="New board"><FolderPlus className="w-3.5 h-3.5" /></button>
        </header>
        <ul className="flex-1 overflow-y-auto">
          {loading ? (
            <li className="px-3 py-2 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading…</li>
          ) : boards.length === 0 ? (
            <li className="px-3 py-6 text-xs text-gray-400 text-center italic">No boards yet. <button onClick={createBoard} className="text-pink-300 underline">Create one</button></li>
          ) : boards.map(b => (
            <li key={b.id} className={cn('group px-3 py-1.5 flex items-center gap-2 cursor-pointer text-xs hover:bg-white/[0.04]', activeId === b.id && 'bg-pink-500/10 text-pink-200 border-l-2 border-pink-400')} onClick={() => openBoard(b.id)}>
              <div className="flex-1 min-w-0">
                <div className="truncate text-white">{b.title}</div>
                <div className="text-[10px] text-gray-400">{b.elementCount} elements · {b.updatedAt.slice(0, 10)}</div>
              </div>
              <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); deleteBoard(b.id); }} className="opacity-0 group-hover:opacity-100 p-0.5 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Center: canvas + chrome */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {activeId ? (
          <>
            <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
              <input
                value={activeTitle}
                onChange={e => renameBoard(e.target.value)}
                className="bg-transparent text-sm font-semibold text-white outline-none border-b border-transparent focus:border-pink-500/40 flex-1 max-w-[400px]"
              />
              <span className="text-[10px] text-gray-400">{activeShapes.length} elements</span>
              {dirty && <span className="text-[10px] text-amber-300">● unsaved</span>}
              <BoardTimer boardId={activeId} />
              <button onClick={save} disabled={saving || !dirty} className="px-2 py-1 text-[11px] rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] disabled:opacity-40 inline-flex items-center gap-1">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}Save
              </button>
              <button onClick={duplicateBoard} className="px-2 py-1 text-[11px] rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1" title="Duplicate board">
                <Copy className="w-3 h-3" />Duplicate
              </button>
              <button onClick={() => setShowAI(v => !v)} className={cn('px-2 py-1 text-[11px] rounded inline-flex items-center gap-1', showAI ? 'bg-pink-500/15 text-pink-200 border border-pink-500/30' : 'border border-white/15 text-gray-300 hover:bg-white/[0.05]')}>
                <Sparkles className="w-3 h-3" />AI {showAI ? '▾' : '▸'}
              </button>
            </header>
            <div className="flex-1 overflow-hidden">
              {/* key=activeId forces a remount when switching boards so initialShapes seeds correctly */}
              <WhiteboardCanvas
                key={activeId}
                initialShapes={activeShapes}
                onChange={onCanvasChange}
                syncShapes={syncShapes}
                syncSignal={syncSignal}
                peerCursors={peerCursorList}
                voteCounts={collab.voteCounts}
                onCursorMove={collab.broadcastCursor}
                className="h-full"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-xs text-gray-400 gap-3">
            <div>No board open.</div>
            <button onClick={createBoard} className="px-3 py-1.5 text-xs rounded bg-pink-500 text-white font-bold hover:bg-pink-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />New board</button>
          </div>
        )}
      </main>

      {/* AI sidebar */}
      {showAI && (
        <aside className="w-80 bg-[#0a0c10] border-l border-white/5 overflow-hidden flex flex-col flex-shrink-0">
          <nav className="flex items-center gap-1 px-2 py-2 border-b border-white/10 overflow-x-auto">
            {([
              { id: 'cluster',   label: 'Cluster' },
              { id: 'summarize', label: 'Summarize' },
              { id: 'generate',  label: 'Generate' },
              { id: 'comments',  label: `Comments${totalOpenComments > 0 ? ` (${totalOpenComments})` : ''}` },
              { id: 'export',    label: 'Export' },
              { id: 'collab',    label: 'Collab' },
            ] as const).map(t => (
              <button key={t.id} onClick={() => setAITab(t.id)} className={cn(
                'px-2 py-1 text-[11px] rounded whitespace-nowrap',
                aiTab === t.id ? 'bg-pink-500/15 text-pink-200 border border-pink-500/30' : 'text-gray-400 hover:text-white border border-transparent',
              )}>{t.label}</button>
            ))}
          </nav>

          {aiTab === 'collab' ? (
            <div className="flex-1 overflow-hidden">
              <WhiteboardCollabPanel boardId={activeId} shapes={activeShapes} />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-3 text-xs">
              {aiTab === 'cluster' && (
                <ClusterTab clusters={clusters} loading={clustering} onRun={runCluster} active={!!activeId} stickyCount={activeShapes.filter(s => s.kind === 'sticky').length} />
              )}
              {aiTab === 'summarize' && (
                <SummarizeTab summary={summary} loading={summarizing} onRun={runSummarize} active={!!activeId} />
              )}
              {aiTab === 'generate' && (
                <GenerateTab prompt={genPrompt} setPrompt={setGenPrompt} kind={genKind} setKind={setGenKind} loading={generating} onRun={runGenerate} />
              )}
              {aiTab === 'comments' && (
                <CommentsTab activeId={activeId} shapes={activeShapes} comments={comments} onAdd={addComment} onResolve={resolveComment} />
              )}
              {aiTab === 'export' && (
                <div className="space-y-2">
                  <p className="text-gray-400">Download a portable <span className="font-mono text-pink-300">concord-whiteboard/v1</span> JSON envelope including the board, all elements, and all comments. Import is round-trippable.</p>
                  <button onClick={exportBoard} disabled={!activeId} className="px-3 py-1.5 text-xs rounded bg-pink-500 text-white font-bold hover:bg-pink-400 disabled:opacity-40 inline-flex items-center gap-1">
                    <Download className="w-3 h-3" />Download JSON
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

function BoardTimer({ boardId }: { boardId: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [label, setLabel] = useState('Meeting timer');
  const [menuOpen, setMenuOpen] = useState(false);

  const sync = React.useCallback(async () => {
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'timer-get', input: { boardId } });
      const res = r.data?.result;
      if (res?.active) { setRemaining(res.remainingSec ?? 0); setLabel(res.label || 'Meeting timer'); }
      else setRemaining(null);
    } catch { /* keep last state */ }
  }, [boardId]);

  // Server sync on board change + every 15s; local 1s countdown in between.
  useEffect(() => { void sync(); setMenuOpen(false); }, [boardId, sync]);
  useEffect(() => {
    const poll = setInterval(() => { void sync(); }, 15000);
    return () => clearInterval(poll);
  }, [sync]);
  const countingDown = remaining != null;
  useEffect(() => {
    if (!countingDown) return;
    const tick = setInterval(() => {
      setRemaining(v => (v == null ? v : Math.max(0, v - 1)));
    }, 1000);
    return () => clearInterval(tick);
  }, [countingDown]);

  async function start(minutes: number) {
    setMenuOpen(false);
    await lensRun({ domain: 'whiteboard', action: 'timer-start', input: { boardId, minutes } });
    await sync();
  }
  async function stop() {
    await lensRun({ domain: 'whiteboard', action: 'timer-stop', input: { boardId } });
    setRemaining(null);
  }

  if (remaining != null) {
    const mm = Math.floor(remaining / 60);
    const ss = String(remaining % 60).padStart(2, '0');
    const low = remaining <= 30;
    return (
      <button onClick={stop} title={`${label} — click to stop`}
        className={cn('px-2 py-1 text-[11px] rounded inline-flex items-center gap-1 font-mono',
          low ? 'bg-rose-500/20 text-rose-200 border border-rose-500/40' : 'bg-pink-500/15 text-pink-200 border border-pink-500/30')}>
        <Timer className="w-3 h-3" />{mm}:{ss}<Square className="w-2.5 h-2.5 ml-0.5" />
      </button>
    );
  }
  return (
    <div className="relative">
      <button onClick={() => setMenuOpen(v => !v)} className="px-2 py-1 text-[11px] rounded border border-white/15 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1" title="Start a meeting timer">
        <Timer className="w-3 h-3" />Timer
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-[#0a0c10] border border-white/10 rounded shadow-lg p-1">
          {[1, 3, 5, 10, 15, 30].map(m => (
            <button key={m} onClick={() => start(m)} className="block w-full text-left px-3 py-1 text-[11px] text-gray-300 hover:bg-pink-500/15 hover:text-pink-200 rounded whitespace-nowrap">
              {m} min
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClusterTab({ clusters, loading, onRun, active, stickyCount }: { clusters: Cluster[] | null; loading: boolean; onRun: () => void; active: boolean; stickyCount: number }) {
  return (
    <div className="space-y-2">
      <p className="text-gray-400">Group sticky notes by theme using token overlap (brain enhancement labels the themes if available).</p>
      <button onClick={onRun} disabled={!active || loading || stickyCount < 2} className="w-full px-3 py-1.5 text-xs rounded bg-pink-500 text-white font-bold hover:bg-pink-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Cluster {stickyCount} sticky note{stickyCount === 1 ? '' : 's'}
      </button>
      {clusters && clusters.length === 0 && (
        <div className="text-gray-400 italic">No themes found (need at least 2 sticky notes with overlapping words).</div>
      )}
      {clusters && clusters.length > 0 && (
        <ul className="space-y-2">
          {clusters.map((c, i) => (
            <li key={i} className="rounded border border-pink-500/30 bg-pink-500/[0.04] p-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-200 font-mono text-[9px]">{c.size}</span>
                <span className="font-semibold text-pink-100">{c.theme}</span>
              </div>
              <div className="text-[10px] text-pink-200/70 font-mono">{c.memberIds.length} members</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummarizeTab({ summary, loading, onRun, active }: { summary: SummaryResult | null; loading: boolean; onRun: () => void; active: boolean }) {
  return (
    <div className="space-y-2">
      <p className="text-gray-400">Reads sticky notes and produces a 2-3 sentence summary + action items.</p>
      <button onClick={onRun} disabled={!active || loading} className="w-full px-3 py-1.5 text-xs rounded bg-pink-500 text-white font-bold hover:bg-pink-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Summarize board
      </button>
      {summary && (
        <div className="space-y-2">
          <div className="rounded border border-pink-500/30 bg-pink-500/[0.04] p-2">
            <div className="text-[10px] uppercase tracking-wider text-pink-300 mb-1">Summary</div>
            <div className="text-pink-100">{summary.summary}</div>
          </div>
          {summary.actionItems.length > 0 && (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/[0.04] p-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1">Action items · {summary.actionItems.length}</div>
              <ul className="space-y-1">
                {summary.actionItems.map((a, i) => (
                  <li key={i} className="text-emerald-100">
                    · {a.text}
                    {a.owner && <span className="text-emerald-300 ml-1">@{a.owner}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[10px] text-gray-400 italic">source: {summary.source}</div>
        </div>
      )}
    </div>
  );
}

function GenerateTab({ prompt, setPrompt, kind, setKind, loading, onRun }: { prompt: string; setPrompt: (s: string) => void; kind: typeof TEMPLATE_KINDS[number]['id']; setKind: (k: typeof TEMPLATE_KINDS[number]['id']) => void; loading: boolean; onRun: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-gray-400">Generate a starter board from a prompt. Creates a new board — won't overwrite the current one.</p>
      <select value={kind} onChange={e => setKind(e.target.value as typeof kind)} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
        {TEMPLATE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select>
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="What's the topic? (e.g. 'Q4 product launch retro')"
        rows={4}
        className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
      />
      <button onClick={onRun} disabled={loading || !prompt.trim()} className="w-full px-3 py-1.5 text-xs rounded bg-pink-500 text-white font-bold hover:bg-pink-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Generate board
      </button>
    </div>
  );
}

function CommentsTab({ activeId, shapes, comments, onAdd, onResolve }: { activeId: string | null; shapes: Shape[]; comments: Record<string, Comment[]>; onAdd: (elementId: string, body: string) => void; onResolve: (id: string) => void }) {
  const [expandedEl, setExpandedEl] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  if (!activeId) return <div className="text-gray-400 italic">No board open.</div>;
  const elementsWithText = shapes.filter(s => s.kind === 'sticky' || (s.kind === 'rect' && s.text));
  if (elementsWithText.length === 0) return <div className="text-gray-400 italic">No sticky notes or labelled shapes to comment on.</div>;
  return (
    <div className="space-y-2">
      <p className="text-gray-400">Add notes to any sticky or labelled rectangle on the board.</p>
      <ul className="space-y-1">
        {elementsWithText.map(el => {
          const list = comments[el.id] || [];
          const isOpen = expandedEl === el.id;
          const openCount = list.filter(c => !c.resolved).length;
          return (
            <li key={el.id} className="rounded border border-white/10 bg-black/30">
              <button onClick={() => setExpandedEl(isOpen ? null : el.id)} className="w-full px-2 py-1.5 flex items-center gap-2 hover:bg-white/[0.04] text-left">
                {isOpen ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                <MessageSquare className="w-3 h-3 text-pink-300" />
                <span className="text-white truncate flex-1">{el.text || '(no text)'}</span>
                {openCount > 0 && <span className="text-[9px] px-1 rounded bg-pink-500/20 text-pink-200 font-mono">{openCount}</span>}
              </button>
              {isOpen && (
                <div className="px-3 pb-2 space-y-1.5">
                  {list.map(c => (
                    <div key={c.id} className={cn('rounded p-1.5 text-[11px]', c.resolved ? 'bg-white/5 text-gray-400 line-through' : 'bg-pink-500/[0.06] text-pink-100')}>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{c.authorName}</span>
                        <span className="text-[9px] text-gray-400 font-mono">{c.createdAt.slice(0, 16).replace('T', ' ')}</span>
                        {!c.resolved && <button onClick={() => onResolve(c.id)} className="ml-auto text-[10px] text-emerald-300 hover:text-emerald-200">resolve</button>}
                      </div>
                      <div>{c.body}</div>
                    </div>
                  ))}
                  <div className="flex items-center gap-1">
                    <input
                      value={draftBody}
                      onChange={e => setDraftBody(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { onAdd(el.id, draftBody); setDraftBody(''); } }}
                      placeholder="Add a comment…"
                      className="flex-1 px-1.5 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white"
                    />
                    <button onClick={() => { onAdd(el.id, draftBody); setDraftBody(''); }} disabled={!draftBody.trim()} className="px-1.5 py-1 text-[10px] rounded bg-pink-500 text-white font-bold hover:bg-pink-400 disabled:opacity-40">post</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default CollabBoardSection;
