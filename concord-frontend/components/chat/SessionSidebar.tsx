'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSessionStore } from '@/store/sessions';

// ── Types ───────────────────────────────────────────────────────────────────

interface SessionSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function SessionSidebar({ isOpen, onClose }: SessionSidebarProps) {
  const {
    sessions, activeSessionId, loading, searchQuery,
    init, createSession, switchSession, deleteSession,
    renameSession, pinSession, archiveSession, unarchiveSession,
    setSearchQuery,
  } = useSessionStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { init(); }, [init]);
  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let list = sessions.filter(s => showArchived ? s.archived : !s.archived);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.lastMessagePreview?.toLowerCase().includes(q)
      );
    }
    // Pinned first, then by updatedAt
    return list.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [sessions, searchQuery, showArchived]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: Record<string, typeof filteredSessions> = {};
    const now = new Date();
    for (const s of filteredSessions) {
      const d = new Date(s.updatedAt);
      const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
      let label: string;
      if (s.pinned) label = 'Pinned';
      else if (diffDays === 0) label = 'Today';
      else if (diffDays === 1) label = 'Yesterday';
      else if (diffDays < 7) label = 'This Week';
      else if (diffDays < 30) label = 'This Month';
      else label = 'Older';
      if (!groups[label]) groups[label] = [];
      groups[label].push(s);
    }
    return groups;
  }, [filteredSessions]);

  const handleNew = useCallback(async () => {
    await createSession();
    onClose();
  }, [createSession, onClose]);

  const handleSwitch = useCallback(async (id: string) => {
    await switchSession(id);
    onClose();
  }, [switchSession, onClose]);

  const handleRename = useCallback(async (id: string) => {
    if (editTitle.trim()) {
      await renameSession(id, editTitle.trim());
    }
    setEditingId(null);
  }, [editTitle, renameSession]);

  const handleContextAction = useCallback(async (action: string, id: string) => {
    setContextMenu(null);
    switch (action) {
      case 'rename': {
        const s = sessions.find(s => s.id === id);
        setEditTitle(s?.title || '');
        setEditingId(id);
        break;
      }
      case 'pin':
        await pinSession(id, true);
        break;
      case 'unpin':
        await pinSession(id, false);
        break;
      case 'archive':
        await archiveSession(id);
        break;
      case 'unarchive':
        await unarchiveSession(id);
        break;
      case 'delete':
        if (sessions.length > 1) await deleteSession(id);
        break;
    }
  }, [sessions, pinSession, archiveSession, unarchiveSession, deleteSession]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex lg:relative lg:inset-auto lg:z-auto">
      {/* Backdrop (mobile) */}
      <div
        className="absolute inset-0 bg-black/50 lg:hidden"
        onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />

      {/* Sidebar panel */}
      <div className="relative z-10 flex flex-col w-72 max-w-[85vw] h-full bg-lattice-void border-r border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h2 className="text-sm font-semibold text-white/80">Sessions</h2>
          <div className="flex gap-1">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`p-1.5 rounded text-xs ${showArchived ? 'bg-neon-blue/20 text-neon-blue' : 'text-white/40 hover:text-white/70'}`}
              title={showArchived ? 'Show active' : 'Show archived'}
            >
              {showArchived ? 'Active' : 'Archived'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-white/40 hover:text-white/70 lg:hidden"
            >
              &times;
            </button>
          </div>
        </div>

        {/* New Session Button */}
        <button
          onClick={handleNew}
          className="m-2 px-3 py-2 rounded-lg bg-neon-blue/20 text-neon-blue text-sm font-medium hover:bg-neon-blue/30 transition-colors flex items-center gap-2"
        >
          <span className="text-lg leading-none">+</span>
          New Session
        </button>

        {/* Search */}
        <div className="px-2 pb-2">
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 bg-white/5 rounded border border-white/10 text-sm text-white/80 placeholder:text-white/30 focus:outline-none focus:border-neon-blue/50"
          />
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-white/30 text-sm">Loading...</div>
          ) : filteredSessions.length === 0 ? (
            <div className="p-4 text-center text-white/30 text-sm">
              {searchQuery ? 'No matching sessions' : 'No sessions yet'}
            </div>
          ) : (
            Object.entries(grouped).map(([label, items]) => (
              <div key={label}>
                <div className="px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-wider">
                  {label}
                </div>
                {items.map(session => (
                  <div
                    key={session.id}
                    className={`group relative mx-1 rounded-lg cursor-pointer transition-colors ${
                      session.id === activeSessionId
                        ? 'bg-neon-blue/15 border border-neon-blue/30'
                        : 'hover:bg-white/5 border border-transparent'
                    }`}
                    onClick={() => handleSwitch(session.id)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setContextMenu({ id: session.id, x: e.clientX, y: e.clientY });
                    }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="px-3 py-2">
                      {editingId === session.id ? (
                        <input
                          ref={editInputRef}
                          value={editTitle}
                          onChange={e => setEditTitle(e.target.value)}
                          onBlur={() => handleRename(session.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRename(session.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="w-full bg-transparent text-sm text-white border-b border-neon-blue/50 outline-none"
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {session.pinned && <span className="text-[10px] text-amber-400">*</span>}
                          <span className="text-sm text-white/80 truncate flex-1">
                            {session.title}
                          </span>
                          <span className="text-[10px] text-white/20">
                            {session.messageCount}
                          </span>
                        </div>
                      )}
                      {session.lastMessagePreview && (
                        <p className="text-[11px] text-white/30 truncate mt-0.5">
                          {session.lastMessagePreview}
                        </p>
                      )}
                    </div>

                    {/* Inline actions (visible on hover) */}
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-0.5">
                      <button
                        onClick={e => { e.stopPropagation(); handleContextAction('rename', session.id); }}
                        className="p-1 text-white/30 hover:text-white/70 text-[10px]"
                        title="Rename"
                      >
                        Edit
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setContextMenu({ id: session.id, x: e.clientX, y: e.clientY });
                        }}
                        className="p-1 text-white/30 hover:text-white/70 text-[10px]"
                        title="More"
                      >
                        ...
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Footer stats */}
        <div className="p-2 border-t border-white/10 text-[10px] text-white/20 text-center">
          {sessions.filter(s => !s.archived).length} sessions
          {sessions.some(s => s.archived) && ` / ${sessions.filter(s => s.archived).length} archived`}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] bg-zinc-900 border border-white/20 rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          {(() => {
            const s = sessions.find(s => s.id === contextMenu.id);
            if (!s) return null;
            return (
              <>
                <CtxItem label="Rename" onClick={() => handleContextAction('rename', s.id)} />
                {s.pinned
                  ? <CtxItem label="Unpin" onClick={() => handleContextAction('unpin', s.id)} />
                  : <CtxItem label="Pin to top" onClick={() => handleContextAction('pin', s.id)} />
                }
                {s.archived
                  ? <CtxItem label="Unarchive" onClick={() => handleContextAction('unarchive', s.id)} />
                  : <CtxItem label="Archive" onClick={() => handleContextAction('archive', s.id)} />
                }
                <div className="h-px bg-white/10 my-1" />
                <CtxItem label="Delete" onClick={() => handleContextAction('delete', s.id)} danger />
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function CtxItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 ${danger ? 'text-red-400' : 'text-white/70'}`}
    >
      {label}
    </button>
  );
}
