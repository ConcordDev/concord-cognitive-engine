'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ThreadFeed } from '@/components/thread/ThreadFeed';
import { ThreadComposer } from '@/components/thread/ThreadComposer';
import { ThreadStudio } from '@/components/thread/ThreadStudio';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from "@/hooks/useLensCommand";
import { useAuth } from '@/hooks/useAuth';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useUIStore } from '@/store/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  GitBranch,
  GitMerge,
  GitFork,
  ChevronRight,
  ChevronDown,
  Plus,
  Search,
  Clock,
  User,
  MoreHorizontal,
  Trash2,
  Copy,
  Pin,
  ArrowUp,
  ArrowDown,
  Link2,
  Zap,
  Scale,
  ListChecks,
  X,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ThreadNodeActions } from '@/components/thread/ThreadNodeActions';

// ── Real backend node shape ────────────────────────────────────────────
// `thread.branch` / `thread.merge` / `thread.summarize` /
// `thread.detect_consensus` / `thread.extract_decisions` / `thread.delete_node`
// (server/server.js, `// === Thread ===`) all read/write this exact shape on
// a lens artifact's `data.nodes` array. This page used to synthesize a fake,
// permanently-childless tree from chat-conversation history instead of using
// these macros — Fork/Merge/Delete were toast-only no-ops. Everything below
// now round-trips through the real macros.
interface RawThreadNode {
  id: string;
  threadId?: string;
  parentNodeId: string | null;
  content: string;
  authorId: string;
  createdAt: string;
  type?: string;
  mergedFrom?: string[];
}
interface ThreadArtifactData {
  nodes?: RawThreadNode[];
}
interface ThreadSummary {
  nodeCount: number;
  authorCount: number;
  totalWords: number;
  branchCount: number;
  mergeCount: number;
  decisionCount: number;
  avgNodeLength: number;
  timeline: { first: string; last: string } | null;
}

interface TreeNode {
  id: string;
  parentId: string | null;
  content: string;
  authorId: string;
  timestamp: Date;
  depth: number;
  children: TreeNode[];
  isMerge: boolean;
}

type ViewMode = 'tree' | 'timeline' | 'linear';

function buildForest(nodes: RawThreadNode[]): TreeNode[] {
  const byParent = new Map<string, RawThreadNode[]>();
  for (const n of nodes) {
    const key = n.parentNodeId || '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  const byTime = (a: RawThreadNode, b: RawThreadNode) => a.createdAt.localeCompare(b.createdAt);
  const toTree = (n: RawThreadNode, depth: number): TreeNode => ({
    id: n.id,
    parentId: n.parentNodeId,
    content: n.content,
    authorId: n.authorId,
    timestamp: new Date(n.createdAt),
    depth,
    isMerge: n.type === 'merge',
    children: (byParent.get(n.id) || []).slice().sort(byTime).map((c) => toTree(c, depth + 1)),
  });
  return (byParent.get('__root__') || []).slice().sort(byTime).map((r) => toTree(r, 0));
}

function flattenForest(forest: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => { out.push(n); n.children.forEach(walk); };
  forest.forEach(walk);
  return out;
}

function macroSucceeded(res: { ok?: boolean; result?: unknown } | undefined): boolean {
  // /api/lens/:domain/:id/run always wraps as { ok: true, result: <handler's
  // own return> } regardless of whether the handler itself failed — the
  // "fabricated-success envelope" the handler's OWN `ok` field is the real
  // signal (see CLAUDE.md's persona-envelope.ts pattern). A handler with no
  // `ok:false` path (e.g. threadAnalyze) never sets it, so `undefined` reads
  // as success too.
  if (!res || res.ok !== true) return false;
  const inner = res.result as { ok?: boolean } | undefined;
  return inner?.ok !== false;
}

function InlineComposer({
  label, placeholder, busy, onSubmit, onCancel,
}: {
  label: string;
  placeholder: string;
  busy: boolean;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState('');
  return (
    <div className="rounded-lg border border-neon-purple/30 bg-lattice-elevated/40 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">{label}</p>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full bg-lattice-deep border border-lattice-border rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:border-neon-purple/50"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) {
            e.preventDefault();
            onSubmit(text.trim());
            setText('');
          }
          if (e.key === 'Escape') onCancel?.();
        }}
      />
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-gray-500">⌘/Ctrl + Enter to post</span>
        <div className="flex gap-1.5">
          {onCancel && (
            <button onClick={onCancel} className="px-2 py-1 text-xs rounded bg-lattice-elevated text-gray-400 hover:text-white">
              Cancel
            </button>
          )}
          <button
            disabled={busy || !text.trim()}
            onClick={() => { onSubmit(text.trim()); setText(''); }}
            className="px-2.5 py-1 text-xs rounded bg-neon-purple text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ThreadLensPage() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const newThreadInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const [showThreadComposer, setShowThreadComposer] = useState(false);
  const [showThreadStudio, setShowThreadStudio] = useState(false);
  const [showThreadFeed, setShowThreadFeed] = useState(false);

  useLensNav('thread');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('thread');

  const {
    items: threadItems,
    isLoading, isError, error, refetch,
    create: createThread,
    remove: removeThread,
  } = useLensData<ThreadArtifactData>('thread', 'conversation');
  const runThreadAction = useRunArtifact('thread');

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [threadSearch, setThreadSearch] = useState('');
  const [nodeSearch, setNodeSearch] = useState('');

  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [creatingThread, setCreatingThread] = useState(false);

  const [replyTarget, setReplyTarget] = useState<string | null>(null); // null = reply-to-root
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBusy, setReplyBusy] = useState(false);

  const [mergeSelection, setMergeSelection] = useState<Set<string>>(new Set());
  const [mergeBusy, setMergeBusy] = useState(false);

  const [summary, setSummary] = useState<ThreadSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [threadActionResult, setThreadActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [threadActiveAction, setThreadActiveAction] = useState<string | null>(null);

  // Deep-link: `?node=<id>` selects the thread + node that owns it. Real —
  // the "Link" action below only ever copies a link this effect can resolve.
  const pendingDeepLinkNode = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nodeId = new URLSearchParams(window.location.search).get('node');
    if (nodeId) pendingDeepLinkNode.current = nodeId;
  }, []);

  const selectedThread = useMemo(
    () => threadItems.find((t) => t.id === selectedThreadId) || null,
    [threadItems, selectedThreadId]
  );
  const nodes = useMemo(() => selectedThread?.data?.nodes || [], [selectedThread]);
  const forest = useMemo(() => buildForest(nodes), [nodes]);
  const allNodes = useMemo(() => flattenForest(forest), [forest]);
  const filteredNodes = useMemo(() => {
    if (!nodeSearch.trim()) return allNodes;
    const q = nodeSearch.toLowerCase();
    return allNodes.filter((n) => n.content.toLowerCase().includes(q));
  }, [allNodes, nodeSearch]);
  const selectedNode = useMemo(
    () => (selectedNodeId ? allNodes.find((n) => n.id === selectedNodeId) || null : null),
    [allNodes, selectedNodeId]
  );

  const filteredThreads = useMemo(() => {
    if (!threadSearch.trim()) return threadItems;
    const q = threadSearch.toLowerCase();
    return threadItems.filter((t) => t.title.toLowerCase().includes(q));
  }, [threadItems, threadSearch]);

  // Auto-select first thread on load, or resolve a pending deep link.
  useEffect(() => {
    if (selectedThreadId || threadItems.length === 0) return;
    if (pendingDeepLinkNode.current) {
      const owner = threadItems.find((t) => (t.data?.nodes || []).some((n) => n.id === pendingDeepLinkNode.current));
      if (owner) {
        setSelectedThreadId(owner.id);
        setSelectedNodeId(pendingDeepLinkNode.current);
        pendingDeepLinkNode.current = null;
        return;
      }
    }
    setSelectedThreadId(threadItems[0].id);
  }, [threadItems, selectedThreadId]);

  // Auto-expand the current thread's nodes so newly-loaded/created threads
  // don't render collapsed-to-nothing (there's no meaningful default beyond
  // "show everything" — this is a real tree, not fixture ids to guess at).
  useEffect(() => {
    setExpandedNodes(new Set(allNodes.map((n) => n.id)));
  }, [allNodes]);

  const loadSummary = useCallback(async (threadId: string) => {
    setSummaryLoading(true);
    try {
      const res = await runThreadAction.mutateAsync({ id: threadId, action: 'summarize' });
      if (macroSucceeded(res)) {
        const s = (res.result as { summary?: ThreadSummary })?.summary;
        if (s) { setSummary(s); return; }
      }
      setSummary(null);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [runThreadAction]);

  useEffect(() => {
    if (selectedThreadId) void loadSummary(selectedThreadId);
    else setSummary(null);
    setMergeSelection(new Set());
    setReplyOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThreadId]);

  useLensCommand(
    [
      { id: "focus-search", keys: "/", description: "Focus thread search", category: "navigation", action: () => searchInputRef.current?.focus() },
      { id: "new-thread", keys: "n", description: "New thread", category: "actions", action: () => { setNewThreadOpen(true); setTimeout(() => newThreadInputRef.current?.focus(), 0); } },
      { id: "reply", keys: "r", description: "Reply to selected message (or start a new root message)", category: "actions", action: () => { setReplyTarget(selectedNodeId); setReplyOpen(true); } },
      { id: "escape", keys: "escape", description: "Close reply / message details", category: "navigation", action: () => { setReplyOpen(false); setSelectedNodeId(null); } },
    ],
    { lensId: "thread" }
  );

  async function handleCreateThread() {
    const title = newThreadTitle.trim() || `Thread ${threadItems.length + 1}`;
    setCreatingThread(true);
    try {
      const res = await createThread({ title, data: { nodes: [] } }) as { ok?: boolean; artifact?: { id: string } };
      setNewThreadTitle('');
      setNewThreadOpen(false);
      if (res?.artifact?.id) {
        setSelectedThreadId(res.artifact.id);
        setSelectedNodeId(null);
      }
      useUIStore.getState().addToast({ type: 'success', message: 'Thread created' });
    } catch {
      useUIStore.getState().addToast({ type: 'error', message: 'Could not create thread' });
    } finally {
      setCreatingThread(false);
    }
  }

  async function handleDeleteThread(id: string) {
    if (!window.confirm('Delete this entire thread? This cannot be undone.')) return;
    try {
      await removeThread(id);
      if (selectedThreadId === id) { setSelectedThreadId(null); setSelectedNodeId(null); }
      useUIStore.getState().addToast({ type: 'success', message: 'Thread deleted' });
    } catch {
      useUIStore.getState().addToast({ type: 'error', message: 'Could not delete thread' });
    }
  }

  async function submitReply(content: string) {
    if (!selectedThreadId) return;
    setReplyBusy(true);
    try {
      const res = await runThreadAction.mutateAsync({
        id: selectedThreadId, action: 'branch',
        params: { parentNodeId: replyTarget, content },
      });
      if (macroSucceeded(res)) {
        await refetch();
        await loadSummary(selectedThreadId);
        setReplyOpen(false);
        useUIStore.getState().addToast({ type: 'success', message: replyTarget ? 'Reply posted' : 'Message posted' });
      } else {
        useUIStore.getState().addToast({ type: 'error', message: (res.result as { error?: string })?.error || 'Post failed' });
      }
    } finally {
      setReplyBusy(false);
    }
  }

  function toggleMergeSelect(nodeId: string) {
    setMergeSelection((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  }

  async function submitMerge() {
    if (!selectedThreadId || mergeSelection.size < 2) return;
    setMergeBusy(true);
    try {
      const branchIds = [...mergeSelection];
      const res = await runThreadAction.mutateAsync({ id: selectedThreadId, action: 'merge', params: { branchIds } });
      if (macroSucceeded(res)) {
        setMergeSelection(new Set());
        await refetch();
        await loadSummary(selectedThreadId);
        useUIStore.getState().addToast({ type: 'success', message: `Merged ${branchIds.length} branches` });
      } else {
        useUIStore.getState().addToast({ type: 'error', message: (res.result as { error?: string })?.error || 'Merge failed' });
      }
    } finally {
      setMergeBusy(false);
    }
  }

  async function deleteNode(nodeId: string) {
    if (!selectedThreadId) return;
    const res = await runThreadAction.mutateAsync({ id: selectedThreadId, action: 'delete_node', params: { nodeId } });
    if (macroSucceeded(res)) {
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      setMergeSelection((prev) => { const next = new Set(prev); next.delete(nodeId); return next; });
      await refetch();
      await loadSummary(selectedThreadId);
      useUIStore.getState().addToast({ type: 'success', message: 'Message deleted' });
    } else {
      useUIStore.getState().addToast({ type: 'error', message: (res.result as { error?: string })?.error || 'Delete failed' });
    }
  }

  const handleThreadAction = useCallback(async (action: string) => {
    if (!selectedThreadId) return;
    setThreadActiveAction(action);
    try {
      const res = await runThreadAction.mutateAsync({ id: selectedThreadId, action });
      if (macroSucceeded(res)) setThreadActionResult({ action, result: res.result as Record<string, unknown> });
      else useUIStore.getState().addToast({ type: 'error', message: (res.result as { error?: string })?.error || `${action} failed` });
    } finally {
      setThreadActiveAction(null);
    }
  }, [selectedThreadId, runThreadAction]);

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
      return next;
    });
  };

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const authorLabel = (authorId: string, isMerge: boolean) => {
    if (isMerge) return 'Merge';
    if (authorId === 'system') return 'System';
    if (user && authorId === user.id) return 'You';
    return authorId === 'anon' ? 'Anonymous' : authorId;
  };

  const renderThreadNode = (node: TreeNode) => {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedNodeId === node.id;
    const isMergeSelected = mergeSelection.has(node.id);

    return (
      <div key={node.id} className="relative">
        {node.depth > 0 && (
          <div
            className="absolute left-0 top-0 bottom-0 border-l-2 border-lattice-border"
            style={{ left: `${(node.depth - 1) * 24 + 12}px` }}
          />
        )}

        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className={`group relative flex items-start gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all ${
            isSelected ? 'bg-neon-purple/20 border border-neon-purple/50' : 'hover:bg-lattice-elevated'
          }`}
          style={{ marginLeft: `${node.depth * 24}px` }}
          onClick={() => setSelectedNodeId(node.id)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleNode(node.id); }}
              className="p-1 rounded hover:bg-lattice-border/50 text-gray-400"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <div className="w-6" />
          )}

          <input
            type="checkbox"
            checked={isMergeSelected}
            onChange={(e) => { e.stopPropagation(); toggleMergeSelect(node.id); }}
            onClick={(e) => e.stopPropagation()}
            className="mt-2.5 accent-neon-purple"
            aria-label="Select for merge"
            title="Select for merge"
          />

          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              node.isMerge ? 'bg-emerald-500/20 text-emerald-400' : 'bg-neon-blue/20 text-neon-blue'
            }`}
          >
            {node.isMerge ? <GitMerge className="w-4 h-4" /> : <User className="w-4 h-4" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">{authorLabel(node.authorId, node.isMerge)}</span>
              <span className="text-xs text-gray-400">{formatTime(node.timestamp)}</span>
              {node.isMerge && (
                <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <GitMerge className="w-3 h-3" />merged
                </span>
              )}
            </div>
            <p className="text-sm text-gray-300 line-clamp-2">{node.content}</p>
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); setReplyTarget(node.id); setReplyOpen(true); }}
              className="p-1 rounded hover:bg-lattice-border/50 text-gray-400 hover:text-white"
              aria-label="Reply / fork from this message"
              title="Reply / fork"
            >
              <GitFork className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedNodeId(node.id); }}
              className="p-1 rounded hover:bg-lattice-border/50 text-gray-400 hover:text-white"
              aria-label="More options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </motion.div>

        {hasChildren && isExpanded && (
          <div className="relative">{node.children.map((child) => renderThreadNode(child))}</div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={() => refetch()} />
      </div>
    );
  }

  return (
    <LensShell lensId="thread" asMain={false}>
      <FirstRunTour lensId="thread" />
      <ManifestActionBar />
      <DepthBadge lensId="thread" size="sm" className="ml-2" />
    <div data-lens-theme="thread" className="h-[calc(100vh-4rem)] flex flex-col">
      <header className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🧵</span>
          <div>
            <h1 className="text-xl font-bold">Thread Lens</h1>
            <p className="text-sm text-gray-400">
              Branching conversation threads with lineage tracking
            </p>
          </div>

      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="thread" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-lattice-surface rounded-lg p-1">
            {(['tree', 'timeline', 'linear'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === mode ? 'bg-neon-purple text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          <button onClick={() => { setNewThreadOpen((v) => !v); setTimeout(() => newThreadInputRef.current?.focus(), 0); }} className="btn-neon flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Thread <kbd className="text-[9px] opacity-60 ml-1">N</kbd>
          </button>
        </div>
      </header>

      {newThreadOpen && (
        <div className="p-3 border-b border-lattice-border bg-lattice-surface/40 flex items-center gap-2">
          <input
            ref={newThreadInputRef}
            value={newThreadTitle}
            onChange={(e) => setNewThreadTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !creatingThread) void handleCreateThread(); if (e.key === 'Escape') setNewThreadOpen(false); }}
            placeholder="Thread title…"
            className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-neon-purple/50"
          />
          <button disabled={creatingThread} onClick={handleCreateThread} className="btn-neon px-3 py-1.5 text-sm disabled:opacity-40">
            {creatingThread ? 'Creating…' : 'Create'}
          </button>
          <button onClick={() => setNewThreadOpen(false)} className="p-1.5 rounded hover:bg-lattice-elevated text-gray-400" aria-label="Cancel">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-72 border-r border-lattice-border flex flex-col bg-lattice-surface/50">
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search threads…"
                value={threadSearch}
                onChange={(e) => setThreadSearch(e.target.value)}
                className="w-full bg-lattice-deep border border-lattice-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-neon-purple/50"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Recent Threads
              </p>
              <div className="space-y-1">
                {filteredThreads.length === 0 && (
                  <p className="text-center py-4 text-gray-400 text-sm">
                    {threadItems.length === 0 ? 'No threads yet — press N to create one' : 'No threads match your search'}
                  </p>
                )}
                {filteredThreads.map((thread) => {
                  const nodeCount = (thread.data?.nodes || []).length;
                  return (
                    <div key={thread.id} className="group relative">
                      <button
                        onClick={() => { setSelectedThreadId(thread.id); setSelectedNodeId(null); }}
                        className={`w-full text-left p-3 rounded-lg transition-colors ${
                          selectedThreadId === thread.id ? 'bg-neon-purple/20 border border-neon-purple/30' : 'hover:bg-lattice-elevated'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-sm truncate">{thread.title}</span>
                          <span className="text-xs text-gray-400 flex-shrink-0">{formatTime(new Date(thread.updatedAt))}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" />{nodeCount}
                          </span>
                        </div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); void handleDeleteThread(thread.id); }}
                        className="absolute right-2 top-2 p-1 rounded opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400"
                        aria-label="Delete thread"
                        title="Delete thread"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col overflow-hidden">
          {selectedThread ? (
            <>
              <div className="p-4 border-b border-lattice-border bg-lattice-surface/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <GitBranch className="w-5 h-5 text-neon-purple" />
                    <div>
                      <h2 className="font-semibold">{selectedThread.title}</h2>
                      <p className="text-xs text-gray-400">
                        {summaryLoading ? 'Loading stats…' : summary
                          ? `${summary.nodeCount} messages · ${summary.branchCount} branches · ${summary.mergeCount} merges · ${summary.authorCount} participants`
                          : `${nodes.length} message${nodes.length === 1 ? '' : 's'}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {mergeSelection.size >= 2 && (
                      <button
                        onClick={submitMerge}
                        disabled={mergeBusy}
                        className="px-2.5 py-1.5 text-xs rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-600/40 hover:bg-emerald-600/30 disabled:opacity-40 flex items-center gap-1.5"
                      >
                        <GitMerge className="w-3.5 h-3.5" />
                        {mergeBusy ? 'Merging…' : `Merge ${mergeSelection.size} selected`}
                      </button>
                    )}
                    <button
                      onClick={() => { setReplyTarget(null); setReplyOpen(true); }}
                      className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white"
                      aria-label="Add message"
                      title="Add message (R)"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {replyOpen && (
                  <InlineComposer
                    label={replyTarget ? `Replying to ${authorLabel(allNodes.find(n => n.id === replyTarget)?.authorId || '', false)}'s message` : 'New root message'}
                    placeholder={replyTarget ? 'Write your reply…' : 'Write the first message in this thread…'}
                    busy={replyBusy}
                    onSubmit={submitReply}
                    onCancel={() => setReplyOpen(false)}
                  />
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {nodes.length === 0 && !replyOpen && (
                  <div className="text-center py-10 text-gray-400">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3 text-neon-purple/30" />
                    <p className="text-sm mb-3">This thread has no messages yet.</p>
                    <button onClick={() => { setReplyTarget(null); setReplyOpen(true); }} className="btn-neon text-sm px-3 py-1.5">
                      Add the first message
                    </button>
                  </div>
                )}

                {viewMode !== 'tree' && nodes.length > 0 && (
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input
                      value={nodeSearch}
                      onChange={(e) => setNodeSearch(e.target.value)}
                      placeholder="Filter messages in this view…"
                      className="w-full bg-lattice-deep border border-lattice-border rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-neon-purple/50"
                    />
                  </div>
                )}

                {viewMode === 'tree' && forest.map((root) => renderThreadNode(root))}

                {viewMode === 'timeline' && (
                  <div className="relative pl-8">
                    <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-lattice-border" />
                    {filteredNodes
                      .slice()
                      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                      .map((node) => (
                        <div key={node.id} className="relative mb-4">
                          <div
                            className={`absolute w-3 h-3 rounded-full -translate-x-1/2 ${node.isMerge ? 'bg-emerald-400' : 'bg-neon-blue'}`}
                            style={{ left: '16px', top: '6px' }}
                          />
                          <div className="ml-6 panel p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-medium text-sm">{authorLabel(node.authorId, node.isMerge)}</span>
                              <span className="text-xs text-gray-400">{node.timestamp.toLocaleString()}</span>
                            </div>
                            <p className="text-sm text-gray-300">{node.content}</p>
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {viewMode === 'linear' && (
                  <div className="space-y-3">
                    {filteredNodes.map((node) => (
                      <div key={node.id} className={`flex gap-3 ${node.authorId === user?.id ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[70%] p-3 rounded-lg ${
                            node.authorId === user?.id ? 'bg-neon-blue/20 border border-neon-blue/30' : 'bg-lattice-elevated border border-lattice-border'
                          }`}
                        >
                          <p className="text-xs text-gray-400 mb-1">{authorLabel(node.authorId, node.isMerge)}</p>
                          <p className="text-sm">{node.content}</p>
                          <p className="text-xs text-gray-400 mt-1">{formatTime(node.timestamp)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <MessageSquare className="w-16 h-16 mx-auto mb-4 text-neon-purple/30" />
                <p className="text-lg font-medium mb-2">No thread selected</p>
                <p className="text-sm">Select a thread from the sidebar or press N to create one</p>
              </div>
            </div>
          )}
        </main>

        <AnimatePresence>
          {selectedNode && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-l border-lattice-border bg-lattice-surface/50 overflow-hidden"
            >
              <div className="w-80 h-full flex flex-col">
                <div className="p-4 border-b border-lattice-border flex items-center justify-between">
                  <h3 className="font-semibold">Message Details</h3>
                  <button onClick={() => setSelectedNodeId(null)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400" aria-label="Close">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Author</p>
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${selectedNode.isMerge ? 'bg-emerald-500/20 text-emerald-400' : 'bg-neon-blue/20 text-neon-blue'}`}>
                        {selectedNode.isMerge ? <GitMerge className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <span className="font-medium">{authorLabel(selectedNode.authorId, selectedNode.isMerge)}</span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Timestamp</p>
                    <p className="text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4 text-gray-400" />
                      {selectedNode.timestamp.toLocaleString()}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Content</p>
                    <div className="panel p-3">
                      <p className="text-sm text-gray-300 whitespace-pre-wrap">{selectedNode.content}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Lineage</p>
                    <div className="text-sm space-y-1">
                      <p className="flex items-center gap-2">
                        <ArrowUp className="w-4 h-4 text-gray-400" />
                        Parent: {selectedNode.parentId || 'Root'}
                      </p>
                      <p className="flex items-center gap-2">
                        <ArrowDown className="w-4 h-4 text-gray-400" />
                        Children: {selectedNode.children.length}
                      </p>
                      <p className="flex items-center gap-2">
                        <GitBranch className="w-4 h-4 text-gray-400" />
                        Depth: {selectedNode.depth}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-lattice-border space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => { setReplyTarget(selectedNode.id); setReplyOpen(true); }}
                      className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white flex flex-col items-center gap-1"
                    >
                      <GitFork className="w-4 h-4" />
                      <span className="text-xs">Reply</span>
                    </button>
                    <button
                      onClick={() => { navigator.clipboard.writeText(selectedNode.content); useUIStore.getState().addToast({ type: 'success', message: 'Copied' }); }}
                      className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white flex flex-col items-center gap-1"
                    >
                      <Copy className="w-4 h-4" />
                      <span className="text-xs">Copy</span>
                    </button>
                    <button
                      onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?node=${selectedNode.id}`); useUIStore.getState().addToast({ type: 'success', message: 'Link copied — opens straight to this message' }); }}
                      className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white flex flex-col items-center gap-1"
                    >
                      <Link2 className="w-4 h-4" />
                      <span className="text-xs">Link</span>
                    </button>
                  </div>
                  <button
                    onClick={() => void deleteNode(selectedNode.id)}
                    className="w-full p-2 rounded-lg border border-red-500/20 hover:bg-red-500/10 text-red-400 flex items-center justify-center gap-1.5 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete message{selectedNode.children.length > 0 ? ` (and ${selectedNode.children.length} repl${selectedNode.children.length === 1 ? 'y' : 'ies'})` : ''}
                  </button>

                  {selectedThread && (
                    <ThreadNodeActions
                      node={{
                        id: selectedNode.id,
                        parentId: selectedNode.parentId,
                        content: selectedNode.content,
                        author: selectedNode.authorId === user?.id ? 'user' : 'ai',
                        depth: selectedNode.depth,
                      }}
                      threadName={selectedThread.title}
                      threadId={selectedThread.id}
                      threadFullContent={allNodes.map((n) => ({ id: n.id, author: (n.authorId === user?.id ? 'user' : 'ai') as 'user' | 'ai', content: n.content }))}
                    />
                  )}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

      {realtimeData && (
        <RealtimeDataPanel domain="thread" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />
      )}

      <div className="p-4 border-t border-lattice-border bg-lattice-surface/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-purple" />
            Thread Analysis
          </h3>
          {threadActionResult && (
            <button onClick={() => setThreadActionResult(null)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['threadAnalyze', 'sentimentMap', 'participantStats', 'topicExtract', 'detect_consensus', 'extract_decisions'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleThreadAction(action)}
              disabled={!selectedThreadId || nodes.length === 0 || threadActiveAction !== null}
              className="px-3 py-1.5 text-sm rounded-lg bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {threadActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-purple border-t-transparent rounded-full animate-spin" />
              ) : action === 'detect_consensus' ? <Scale className="w-3.5 h-3.5" /> : action === 'extract_decisions' ? <ListChecks className="w-3.5 h-3.5" /> : null}
              {action === 'threadAnalyze' ? 'Thread Analyze'
                : action === 'sentimentMap' ? 'Sentiment Map'
                : action === 'participantStats' ? 'Participant Stats'
                : action === 'topicExtract' ? 'Topic Extract'
                : action === 'detect_consensus' ? 'Detect Consensus'
                : 'Extract Decisions'}
            </button>
          ))}
        </div>

        {threadActionResult && (
          <div className="panel p-3 space-y-2 text-sm">
            {threadActionResult.action === 'threadAnalyze' && (() => {
              const r = threadActionResult.result;
              return (
                <div className="flex flex-wrap gap-4 text-xs">
                  <span className="text-gray-400">Messages: <span className="text-white font-medium">{String(r.messageCount ?? 0)}</span></span>
                  <span className="text-gray-400">Participants: <span className="text-white font-medium">{String(r.participants ?? 0)}</span></span>
                  <span className="text-gray-400">Avg Length: <span className="text-white font-medium">{String(r.avgMessageLength ?? 0)} chars</span></span>
                  <span className="text-gray-400">Avg Response: <span className="text-white font-medium">{String(r.avgResponseMinutes ?? 0)} min</span></span>
                  <span className="text-gray-400">Peak Hour: <span className="text-white font-medium">{String(r.peakActivityHour ?? '-')}:00</span></span>
                  <span className="text-gray-400">Duration: <span className="text-white font-medium">{String(r.threadDuration ?? '-')}</span></span>
                </div>
              );
            })()}
            {threadActionResult.action === 'sentimentMap' && (() => {
              const r = threadActionResult.result;
              const tone = String(r.overallTone ?? 'neutral');
              const toneColor = tone === 'positive' ? 'text-neon-green' : tone === 'negative' ? 'text-red-400' : 'text-gray-300';
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">Overall Tone:</span>
                    <span className={`text-xs font-semibold uppercase ${toneColor}`}>{tone}</span>
                    <span className="text-gray-400 text-xs ml-2">Avg Sentiment: <span className="text-white">{String(r.avgSentiment ?? 0)}</span></span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-neon-green">Positive: {String(r.positiveMessages ?? 0)}</span>
                    <span className="text-red-400">Negative: {String(r.negativeMessages ?? 0)}</span>
                    <span className="text-gray-400">Neutral: {String(r.neutralMessages ?? 0)}</span>
                  </div>
                </div>
              );
            })()}
            {threadActionResult.action === 'participantStats' && (() => {
              const r = threadActionResult.result;
              const participants = Array.isArray(r.participants) ? r.participants as Array<Record<string, unknown>> : [];
              return (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Total Participants: <span className="text-white font-medium">{String(r.totalParticipants ?? 0)}</span> · Total Messages: <span className="text-white font-medium">{String(r.totalMessages ?? 0)}</span></div>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {participants.slice(0, 5).map((p, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-lattice-elevated px-2 py-1 rounded">
                        <span className="text-gray-300">{String(p.name ?? `P${i + 1}`)}</span>
                        <div className="flex gap-3">
                          <span className="text-gray-400">msgs: <span className="text-white">{String(p.messageCount ?? 0)}</span></span>
                          <span className="text-neon-cyan">{String(p.sharePercent ?? 0)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {!!r.mostActive && <div className="text-xs text-gray-400">Most Active: <span className="text-neon-cyan">{String(r.mostActive)}</span></div>}
                </div>
              );
            })()}
            {threadActionResult.action === 'topicExtract' && (() => {
              const r = threadActionResult.result;
              const topics = Array.isArray(r.topics) ? r.topics as Array<Record<string, unknown>> : [];
              const bigrams = Array.isArray(r.topBigrams) ? r.topBigrams as Array<{ phrase: string }> : [];
              return (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Dominant Topic: <span className="text-neon-purple font-medium">{String(r.dominantTopic ?? '-')}</span> · Diversity: <span className="text-white">{String(r.topicDiversity ?? 0)}</span></div>
                  <div className="flex flex-wrap gap-1">
                    {topics.slice(0, 6).map((t, i) => (
                      <span key={i} className="text-xs bg-neon-purple/20 text-neon-purple px-2 py-0.5 rounded-full">
                        {String(t.topic ?? '')} ({String(t.mentions ?? 0)})
                      </span>
                    ))}
                  </div>
                  {bigrams.length > 0 && (
                    <div className="text-xs text-gray-400">Top phrases: {bigrams.slice(0, 4).map((b, i) => <span key={i} className="text-gray-300 ml-1">&quot;{b.phrase}&quot;</span>)}</div>
                  )}
                </div>
              );
            })()}
            {threadActionResult.action === 'detect_consensus' && (() => {
              const r = threadActionResult.result;
              const consensus = (r.consensus || {}) as Record<string, unknown>;
              return (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className={consensus.detected ? 'text-neon-green font-semibold' : 'text-gray-400'}>
                    {consensus.detected ? 'Consensus detected' : 'No consensus detected'}
                  </span>
                  <span className="text-gray-400">Confidence: <span className="text-white">{String(consensus.confidence ?? 0)}</span></span>
                  <span className="text-neon-green">Agree: {String(consensus.agreeSignals ?? 0)}</span>
                  <span className="text-red-400">Disagree: {String(consensus.disagreeSignals ?? 0)}</span>
                  {!!consensus.dominantStance && <span className="text-gray-400">Stance: <span className="text-white">{String(consensus.dominantStance)}</span></span>}
                </div>
              );
            })()}
            {threadActionResult.action === 'extract_decisions' && (() => {
              const r = threadActionResult.result;
              const decisions = Array.isArray(r.decisions) ? r.decisions as Array<{ nodeId: string; text: string }> : [];
              return decisions.length === 0 ? (
                <p className="text-xs text-gray-400">No messages phrased as decisions were found (looks for a &quot;decided&quot; marker).</p>
              ) : (
                <ul className="space-y-1 text-xs">
                  {decisions.map((d) => (
                    <li key={d.nodeId} className="flex items-start gap-1.5 text-gray-300">
                      <Pin className="w-3 h-3 text-neon-purple mt-0.5 flex-shrink-0" />
                      {d.text}
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>
        )}
      </div>
      </div>
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowThreadComposer(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          {showThreadComposer ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Composer (Typefully-shape)
        </button>
        {showThreadComposer && (
          <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <ThreadComposer />
          </section>
        )}
      </div>
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowThreadStudio(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          {showThreadStudio ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Publishing Studio (accounts / media / calendar / AI / style / analytics)
        </button>
        {showThreadStudio && (
          <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <ThreadStudio />
          </section>
        )}
      </div>
      <div className="mt-6">
        <button
          type="button"
          onClick={() => setShowThreadFeed(v => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          {showThreadFeed ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Discussion (external reference)
        </button>
        {showThreadFeed && (
          <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <ThreadFeed />
          </section>
        )}
      </div>
    </div>
          <RecentMineCard domain="thread" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="thread" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="thread" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
