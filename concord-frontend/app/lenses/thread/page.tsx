'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useUIStore } from '@/store/ui';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { UniversalActions } from '@/components/lens/UniversalActions';
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
  Bot,
  MoreHorizontal,
  Trash2,
  Copy,
  Pin,
  ArrowUp,
  ArrowDown,
  Maximize2,
  Link2,
  Zap,
  X
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

interface ThreadNode {
  id: string;
  parentId: string | null;
  content: string;
  author: 'user' | 'ai';
  timestamp: Date;
  children: ThreadNode[];
  depth: number;
  branchName?: string;
  isPinned?: boolean;
  isArchived?: boolean;
}

interface Thread {
  id: string;
  name: string;
  rootNode: ThreadNode;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  branchCount: number;
}

type ViewMode = 'tree' | 'timeline' | 'linear';

export default function ThreadLensPage() {
  useLensNav('thread');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('thread');

  // --- Lens Bridge ---
  const bridge = useLensBridge('thread', 'conversation');
  const { create: createThread, items: threadItems } = useLensData<Record<string, unknown>>('thread', 'conversation');
  const runThreadAction = useRunArtifact('thread');
  const [threadActionResult, setThreadActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [threadActiveAction, setThreadActiveAction] = useState<string | null>(null);

  const handleThreadAction = useCallback(async (action: string) => {
    const id = threadItems[0]?.id;
    if (!id) return;
    setThreadActiveAction(action);
    try {
      const res = await runThreadAction.mutateAsync({ id, action });
      if (res.ok) setThreadActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setThreadActiveAction(null);
    }
  }, [threadItems, runThreadAction]);
  const queryClient = useQueryClient();

  const [selectedNode, setSelectedNode] = useState<ThreadNode | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['msg-1', 'msg-2']));
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [searchQuery, setSearchQuery] = useState('');
  const { data: sessions, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => apiHelpers.cognitive.status().then((r) => r.data),
  });

  // Build threads from chat conversations API, fall back to seed data
  const { data: conversationsData } = useQuery({
    queryKey: ['thread-conversations'],
    queryFn: async () => {
      try {
        const res = await apiHelpers.eventsLog.list({ type: 'chat', limit: 20 });
        return res.data?.conversations || [];
      } catch {
        return [];
      }
    },
  });

  const threads: Thread[] = useMemo(() => {
    const convs = conversationsData || [];
    if (convs.length === 0) return [];
    return convs.map((c: Record<string, unknown>, i: number) => ({
      id: String(c.id || `thread-${i}`),
      name: String(c.title || c.summary || `Thread ${i + 1}`),
      createdAt: new Date(c.createdAt as string || Date.now()),
      updatedAt: new Date(c.updatedAt as string || Date.now()),
      messageCount: Number(c.messageCount || 0),
      branchCount: 1,
      rootNode: {
        id: `root-${c.id}`,
        parentId: null,
        content: String(c.lastMessage || c.summary || ''),
        author: 'user',
        timestamp: new Date(c.createdAt as string || Date.now()),
        depth: 0,
        children: [],
      },
    }));
  }, [conversationsData]);

  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);

  // Bridge threads into lens artifacts
  useEffect(() => {
    bridge.syncList(threads, (t) => {
      const thread = t as Thread;
      return { title: thread.name, data: t as Record<string, unknown>, meta: { messageCount: String(thread.messageCount) } };
    });
  }, [threads, bridge]);

  // Auto-select first thread when data loads
  useEffect(() => {
    if (threads.length > 0 && !selectedThread) {
      setSelectedThread(threads[0]);
    }
  }, [threads, selectedThread]);

  const isError2 = isError; const error2 = error; const refetch2 = refetch;

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const flattenThread = useCallback((node: ThreadNode): ThreadNode[] => {
    const flatten = (n: ThreadNode): ThreadNode[] => {
      const result: ThreadNode[] = [n];
      n.children.forEach((child) => {
        result.push(...flatten(child));
      });
      return result;
    };
    return flatten(node);
  }, []);

  const allNodes = useMemo(() => {
    if (!selectedThread) return [];
    return flattenThread(selectedThread.rootNode);
  }, [selectedThread, flattenThread]);

  const filteredNodes = useMemo(() => {
    if (!searchQuery) return allNodes;
    return allNodes.filter((node) =>
      node.content.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allNodes, searchQuery]);

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  const renderThreadNode = (node: ThreadNode, _isLast: boolean = false) => {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedNode?.id === node.id;

    return (
      <div key={node.id} className="relative">
        {/* Connection lines */}
        {node.depth > 0 && (
          <div
            className="absolute left-0 top-0 bottom-0 border-l-2 border-lattice-border"
            style={{ left: `${(node.depth - 1) * 24 + 12}px` }}
          />
        )}

        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className={`relative flex items-start gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all ${
            isSelected
              ? 'bg-neon-purple/20 border border-neon-purple/50'
              : 'hover:bg-lattice-elevated'
          }`}
          style={{ marginLeft: `${node.depth * 24}px` }}
          onClick={() => setSelectedNode(node)}
        >
          {/* Expand/Collapse button */}
          {hasChildren && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(node.id);
              }}
              className="p-1 rounded hover:bg-lattice-border/50 text-gray-400"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-6" />}

          {/* Author icon */}
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
              node.author === 'user'
                ? 'bg-neon-blue/20 text-neon-blue'
                : 'bg-neon-purple/20 text-neon-purple'
            }`}
          >
            {node.author === 'user' ? (
              <User className="w-4 h-4" />
            ) : (
              <Bot className="w-4 h-4" />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">
                {node.author === 'user' ? 'You' : 'Concord'}
              </span>
              <span className="text-xs text-gray-500">{formatTime(node.timestamp)}</span>
              {node.branchName && (
                <span className="text-xs bg-neon-purple/20 text-neon-purple px-2 py-0.5 rounded-full flex items-center gap-1">
                  <GitBranch className="w-3 h-3" />
                  {node.branchName}
                </span>
              )}
              {node.isPinned && <Pin className="w-3 h-3 text-neon-yellow" />}
            </div>
            <p className="text-sm text-gray-300 line-clamp-2">{node.content}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => {
              createThread({ title: `Fork: ${node.content.slice(0, 30)}...`, data: { messages: [{ content: node.content, author: node.author }], forkedFrom: node.id }, meta: {} });
              useUIStore.getState().addToast({ type: 'success', message: 'Thread forked' });
            }} className="p-1 rounded hover:bg-lattice-border/50 text-gray-400 hover:text-white">
              <GitFork className="w-4 h-4" />
            </button>
            <button onClick={() => setSelectedNode(node)} className="p-1 rounded hover:bg-lattice-border/50 text-gray-400 hover:text-white">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </motion.div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="relative">
            {node.children.map((child, idx) =>
              renderThreadNode(child, idx === node.children.length - 1)
            )}
          </div>
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

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
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

      {/* Real-time Enhancement Toolbar */}
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
          <UniversalActions domain="thread" artifactId={bridge.selectedId} compact />
          {/* View mode toggle */}
          <div className="flex items-center gap-1 bg-lattice-surface rounded-lg p-1">
            {(['tree', 'timeline', 'linear'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  viewMode === mode
                    ? 'bg-neon-purple text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          <button onClick={() => {
            createThread({ title: `Thread ${threads.length + 1}`, data: { messages: [], branchCount: 1 }, meta: { messageCount: '0' } });
            queryClient.invalidateQueries({ queryKey: ['thread-conversations'] });
          }} className="btn-neon flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Thread
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Thread List Sidebar */}
        <aside className="w-72 border-r border-lattice-border flex flex-col bg-lattice-surface/50">
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search threads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-lattice-deep border border-lattice-border rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-neon-purple/50"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Recent Threads
              </p>
              <div className="space-y-1">
                {threads.length === 0 && (
                  <p className="text-center py-4 text-gray-500 text-sm">No conversation threads yet</p>
                )}
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    onClick={() => {
                      setSelectedThread(thread);
                      setSelectedNode(null);
                    }}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedThread?.id === thread.id
                        ? 'bg-neon-purple/20 border border-neon-purple/30'
                        : 'hover:bg-lattice-elevated'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <span className="font-medium text-sm truncate">{thread.name}</span>
                      <span className="text-xs text-gray-500">{formatTime(thread.updatedAt)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        {thread.messageCount}
                      </span>
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-3 h-3" />
                        {thread.branchCount}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-3 border-t border-lattice-border">
            <div className="text-xs text-gray-500 space-y-1">
              <p>Session: {sessions?.sessionId || 'default'}</p>
              <p>Total Threads: {threads.length}</p>
            </div>
          </div>
        </aside>

        {/* Thread Tree View */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {selectedThread ? (
            <>
              {/* Thread header */}
              <div className="p-4 border-b border-lattice-border bg-lattice-surface/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <GitBranch className="w-5 h-5 text-neon-purple" />
                    <div>
                      <h2 className="font-semibold">{selectedThread.name}</h2>
                      <p className="text-xs text-gray-500">
                        {selectedThread.messageCount} messages · {selectedThread.branchCount} branches
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Merge branches' })} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white">
                      <GitMerge className="w-4 h-4" />
                    </button>
                    <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Fork thread' })} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white">
                      <GitFork className="w-4 h-4" />
                    </button>
                    <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Fullscreen view' })} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white">
                      <Maximize2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Thread content */}
              <div className="flex-1 overflow-y-auto p-4">
                {viewMode === 'tree' && renderThreadNode(selectedThread.rootNode)}

                {viewMode === 'timeline' && (
                  <div className="relative pl-8">
                    <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-lattice-border" />
                    {filteredNodes
                      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                      .map((node) => (
                        <div key={node.id} className="relative mb-4">
                          <div
                            className={`absolute left-0 w-3 h-3 rounded-full -translate-x-1/2 ${
                              node.author === 'user' ? 'bg-neon-blue' : 'bg-neon-purple'
                            }`}
                            style={{ left: '16px', top: '6px' }}
                          />
                          <div className="ml-6 panel p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="font-medium text-sm">
                                {node.author === 'user' ? 'You' : 'Concord'}
                              </span>
                              <span className="text-xs text-gray-500">
                                {node.timestamp.toLocaleString()}
                              </span>
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
                      <div
                        key={node.id}
                        className={`flex gap-3 ${
                          node.author === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <div
                          className={`max-w-[70%] p-3 rounded-lg ${
                            node.author === 'user'
                              ? 'bg-neon-blue/20 border border-neon-blue/30'
                              : 'bg-lattice-elevated border border-lattice-border'
                          }`}
                        >
                          <p className="text-sm">{node.content}</p>
                          <p className="text-xs text-gray-500 mt-1">{formatTime(node.timestamp)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500">
              <div className="text-center">
                <MessageSquare className="w-16 h-16 mx-auto mb-4 text-neon-purple/30" />
                <p className="text-lg font-medium mb-2">No thread selected</p>
                <p className="text-sm">Select a thread from the sidebar or create a new one</p>
              </div>
            </div>
          )}
        </main>

        {/* Node Details Sidebar */}
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
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="p-1 rounded hover:bg-lattice-elevated text-gray-400"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Author</p>
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          selectedNode.author === 'user'
                            ? 'bg-neon-blue/20 text-neon-blue'
                            : 'bg-neon-purple/20 text-neon-purple'
                        }`}
                      >
                        {selectedNode.author === 'user' ? (
                          <User className="w-4 h-4" />
                        ) : (
                          <Bot className="w-4 h-4" />
                        )}
                      </div>
                      <span className="font-medium">
                        {selectedNode.author === 'user' ? 'You' : 'Concord AI'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Timestamp</p>
                    <p className="text-sm flex items-center gap-2">
                      <Clock className="w-4 h-4 text-gray-400" />
                      {selectedNode.timestamp.toLocaleString()}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Content</p>
                    <div className="panel p-3">
                      <p className="text-sm text-gray-300">{selectedNode.content}</p>
                    </div>
                  </div>

                  {selectedNode.branchName && (
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Branch</p>
                      <span className="inline-flex items-center gap-1 text-sm bg-neon-purple/20 text-neon-purple px-3 py-1 rounded-full">
                        <GitBranch className="w-4 h-4" />
                        {selectedNode.branchName}
                      </span>
                    </div>
                  )}

                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Lineage</p>
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

                <div className="p-4 border-t border-lattice-border">
                  <div className="grid grid-cols-4 gap-2">
                    <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Forking node...' })} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white flex flex-col items-center gap-1">
                      <GitFork className="w-4 h-4" />
                      <span className="text-xs">Fork</span>
                    </button>
                    <button onClick={() => { if (selectedNode) navigator.clipboard.writeText(selectedNode.content); useUIStore.getState().addToast({ type: 'success', message: 'Copied' }); }} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white flex flex-col items-center gap-1">
                      <Copy className="w-4 h-4" />
                      <span className="text-xs">Copy</span>
                    </button>
                    <button onClick={() => { if (selectedNode) navigator.clipboard.writeText(`${window.location.href}?node=${selectedNode.id}`); useUIStore.getState().addToast({ type: 'success', message: 'Link copied' }); }} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white flex flex-col items-center gap-1">
                      <Link2 className="w-4 h-4" />
                      <span className="text-xs">Link</span>
                    </button>
                    <button onClick={() => { setSelectedNode(null); useUIStore.getState().addToast({ type: 'info', message: 'Node removed' }); }} className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-red-500 flex flex-col items-center gap-1">
                      <Trash2 className="w-4 h-4" />
                      <span className="text-xs">Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="thread"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Thread Actions Panel */}
      <div className="p-4 border-t border-lattice-border bg-lattice-surface/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-purple" />
            Thread Actions
          </h3>
          {threadActionResult && (
            <button onClick={() => setThreadActionResult(null)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['threadAnalyze', 'sentimentMap', 'participantStats', 'topicExtract'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleThreadAction(action)}
              disabled={!threadItems[0]?.id || threadActiveAction !== null}
              className="px-3 py-1.5 text-sm rounded-lg bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {threadActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-purple border-t-transparent rounded-full animate-spin" />
              ) : null}
              {action === 'threadAnalyze' ? 'Thread Analyze' : action === 'sentimentMap' ? 'Sentiment Map' : action === 'participantStats' ? 'Participant Stats' : 'Topic Extract'}
            </button>
          ))}
        </div>

        {threadActionResult && (
          <div className="panel p-3 space-y-2 text-sm">
            {threadActionResult.action === 'threadAnalyze' && (() => {
              const r = threadActionResult.result;
              return (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span className="text-gray-400">Messages: <span className="text-white font-medium">{String(r.messageCount ?? 0)}</span></span>
                    <span className="text-gray-400">Participants: <span className="text-white font-medium">{String(r.participants ?? 0)}</span></span>
                    <span className="text-gray-400">Avg Length: <span className="text-white font-medium">{String(r.avgMessageLength ?? 0)} chars</span></span>
                    <span className="text-gray-400">Avg Response: <span className="text-white font-medium">{String(r.avgResponseMinutes ?? 0)} min</span></span>
                    <span className="text-gray-400">Peak Hour: <span className="text-white font-medium">{String(r.peakActivityHour ?? '-')}:00</span></span>
                    <span className="text-gray-400">Duration: <span className="text-white font-medium">{String(r.threadDuration ?? '-')}</span></span>
                  </div>
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
                        <span className="text-gray-300">{String(p.name ?? p.id ?? `P${i + 1}`)}</span>
                        <div className="flex gap-3">
                          <span className="text-gray-400">msgs: <span className="text-white">{String(p.messageCount ?? 0)}</span></span>
                          <span className="text-neon-cyan">{String(p.share ?? p.percentage ?? 0)}%</span>
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
              const bigrams = Array.isArray(r.topBigrams) ? r.topBigrams as string[] : [];
              return (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Dominant Topic: <span className="text-neon-purple font-medium">{String(r.dominantTopic ?? '-')}</span> · Diversity: <span className="text-white">{String(r.topicDiversity ?? 0)}</span></div>
                  <div className="flex flex-wrap gap-1">
                    {topics.slice(0, 6).map((t, i) => (
                      <span key={i} className="text-xs bg-neon-purple/20 text-neon-purple px-2 py-0.5 rounded-full">
                        {String(t.name ?? t.topic ?? t)} ({String(t.mentions ?? t.count ?? 0)})
                      </span>
                    ))}
                  </div>
                  {bigrams.length > 0 && (
                    <div className="text-xs text-gray-400">Top phrases: {bigrams.slice(0, 4).map((b, i) => <span key={i} className="text-gray-300 ml-1">"{b}"</span>)}</div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
