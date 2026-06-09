'use client';

import { useEffect, useMemo, useState } from 'react';
import { GitBranch, Save, RefreshCw, FileText, Loader2, GitCommit, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const MonacoDiffViewer = dynamic(() => import('./MonacoDiffViewer'), { ssr: false });

interface DirtyTab {
  id: string;
  name: string;
  language: string;
  content: string;
  isDirty: boolean;
}

interface SavedScript {
  id: string;
  title?: string;
  data?: { content?: string; language?: string };
}

interface SourceControlPanelProps {
  tabs: DirtyTab[];
  savedScripts: SavedScript[];
  onJumpToTab: (tabId: string) => void;
  onCommitAll: (message: string) => Promise<void>;
  onRefresh?: () => void;
}

export function SourceControlPanel({ tabs, savedScripts, onJumpToTab, onCommitAll, onRefresh }: SourceControlPanelProps) {
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const [committedAt, setCommittedAt] = useState<string | null>(null);
  const [snapshotCount, setSnapshotCount] = useState<number | null>(null);

  const dirtyTabs = useMemo(() => tabs.filter(t => t.isDirty), [tabs]);
  const newTabs = useMemo(() => tabs.filter(t => !savedScripts.some(s => s.id === t.id)), [tabs, savedScripts]);

  useEffect(() => {
    if (!selectedTabId && dirtyTabs.length > 0) {
      setSelectedTabId(dirtyTabs[0].id);
    }
  }, [dirtyTabs, selectedTabId]);

  useEffect(() => {
    refreshSnapshotCount();
  }, [tabs.length]);

  async function refreshSnapshotCount() {
    try {
      const res = await lensRun({
        domain: 'code',
        action: 'snapshots-list',
        input: { limit: 100 },
      });
      const count = res.data?.result?.snapshots?.length;
      if (typeof count === 'number') setSnapshotCount(count);
    } catch {
      /* best effort */
    }
  }

  const selectedTab = tabs.find(t => t.id === selectedTabId);
  const selectedSaved = savedScripts.find(s => s.id === selectedTabId);
  const originalContent = selectedSaved?.data?.content || '';
  const modifiedContent = selectedTab?.content || '';

  async function handleCommit() {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      await onCommitAll(message.trim());
      setMessage('');
      setCommittedAt(new Date().toLocaleTimeString());
      await refreshSnapshotCount();
    } finally {
      setCommitting(false);
    }
  }

  const changedLines = useMemo(() => {
    if (!selectedTab || !selectedSaved) return { added: 0, removed: 0 };
    const before = (selectedSaved.data?.content || '').split('\n');
    const after = selectedTab.content.split('\n');
    return {
      added: Math.max(0, after.length - before.length),
      removed: Math.max(0, before.length - after.length),
    };
  }, [selectedTab, selectedSaved]);

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Source control</span>
        <span className="ml-auto text-[10px] text-gray-400" title="DTU snapshots in your corpus">
          {snapshotCount !== null ? `${snapshotCount} snapshot${snapshotCount === 1 ? '' : 's'}` : ''}
        </span>
        <button
          onClick={() => { refreshSnapshotCount(); onRefresh?.(); }}
          title="Refresh"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </header>

      <div className="px-3 py-2 border-b border-white/10 space-y-2">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Commit message (creates DTU snapshot bundle)"
          rows={2}
          className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white resize-none"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleCommit}
            disabled={committing || !message.trim() || (dirtyTabs.length === 0 && newTabs.length === 0)}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50"
          >
            {committing ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitCommit className="w-3 h-3" />}
            Commit {dirtyTabs.length + newTabs.length}
          </button>
          {committedAt && (
            <span className="text-[10px] text-green-400">Committed at {committedAt}</span>
          )}
        </div>
        {dirtyTabs.length === 0 && newTabs.length === 0 && (
          <p className="text-[10px] text-gray-400 inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Working tree clean
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 border-b border-white/5">
          Changes ({dirtyTabs.length + newTabs.length})
        </div>
        <ul className="max-h-44 overflow-y-auto">
          {[...newTabs, ...dirtyTabs.filter(t => !newTabs.some(n => n.id === t.id))].map(t => {
            const isNew = newTabs.some(n => n.id === t.id);
            return (
              <li key={t.id}>
                <button
                  onClick={() => { setSelectedTabId(t.id); onJumpToTab(t.id); }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/[0.04]',
                    selectedTabId === t.id && 'bg-cyan-500/10 text-cyan-200'
                  )}
                >
                  <FileText className="w-3.5 h-3.5 text-gray-400" />
                  <span className="truncate flex-1">{t.name}</span>
                  <span className={cn('text-[9px] font-bold', isNew ? 'text-green-400' : 'text-yellow-400')}>
                    {isNew ? 'U' : 'M'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {selectedTab && (
          <div className="flex-1 min-h-0 flex flex-col border-t border-white/10">
            <div className="px-3 py-1 text-[10px] text-gray-400 flex items-center gap-3 border-b border-white/5">
              <span className="truncate">{selectedTab.name}</span>
              <span className="text-green-400">+{changedLines.added}</span>
              <span className="text-red-400">−{changedLines.removed}</span>
              <button aria-label="Save"
                onClick={() => setSelectedTabId(null)}
                className="ml-auto text-gray-400 hover:text-white"
              >
                <Save className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <MonacoDiffViewer
                original={originalContent}
                modified={modifiedContent}
                language={selectedTab.language}
                height="100%"
                renderSideBySide={false}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SourceControlPanel;
