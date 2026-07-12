'use client';

/**
 * BookmarkFolderPicker — organizes a bookmarked post into a `feed` bookmark
 * folder (folder-list / folder-create / folder-add-item macros in
 * server/domains/feed.js). This is deliberately a *separate* concern from
 * the quick like-style bookmark toggle (`/api/social/bookmark`): folders are
 * a `feed`-domain substrate keyed by (userId -> folderId -> items[postId]),
 * so "is this post bookmarked" and "which folders contain this post" are two
 * different real, independently-queryable facts. No fabricated state here —
 * folder membership always reflects what `folder-list`/`folder-add-item`
 * actually returned.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderPlus, Folder, Check, Plus, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface BookmarkFolder {
  id: string;
  name: string;
  items: string[];
  itemCount: number;
  createdAt: string;
}

export function BookmarkFolderPicker({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [folders, setFolders] = useState<BookmarkFolder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ folders: BookmarkFolder[] }>('feed', 'folder-list', {});
    setFolders(r.data?.ok ? r.data.result?.folders || [] : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open && folders === null) void load();
  }, [open, folders, load]);

  // Close on outside click / Escape — mirrors the rest of the feed lens's
  // no-backdrop popover pattern but adds dismissal since this one has a
  // text input inside it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggleFolder = async (folder: BookmarkFolder) => {
    setToggling(folder.id);
    const inFolder = folder.items.includes(postId);
    const r = await lensRun<{ folder: BookmarkFolder }>('feed', 'folder-add-item', {
      folderId: folder.id,
      postId,
      op: inFolder ? 'remove' : 'add',
    });
    if (r.data?.ok && r.data.result?.folder) {
      const updated = r.data.result.folder;
      setFolders((prev) => (prev || []).map((f) => (f.id === updated.id ? updated : f)));
    }
    setToggling(null);
  };

  const createFolderAndAdd = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreating(true);
    const created = await lensRun<{ folder: BookmarkFolder }>('feed', 'folder-create', { name });
    if (created.data?.ok && created.data.result?.folder) {
      const folder = created.data.result.folder;
      const added = await lensRun<{ folder: BookmarkFolder }>('feed', 'folder-add-item', {
        folderId: folder.id,
        postId,
        op: 'add',
      });
      const finalFolder = added.data?.ok && added.data.result?.folder ? added.data.result.folder : folder;
      setFolders((prev) => [finalFolder, ...(prev || [])]);
      setNewFolderName('');
    }
    setCreating(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'p-1.5 rounded-full hover:bg-neon-purple/15 hover:text-neon-purple hover:scale-110 transition-all duration-200',
          open && 'bg-neon-purple/15 text-neon-purple'
        )}
        aria-label="Save to folder"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Save to folder"
      >
        <FolderPlus className="w-3.5 h-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            role="menu"
            className="absolute right-0 top-8 z-30 w-60 bg-lattice-surface border border-lattice-border rounded-xl shadow-lg overflow-hidden p-2.5"
          >
            <p className="px-1 pb-2 text-xs font-bold text-white">Save to folder</p>
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-neon-purple" />
              </div>
            ) : (folders?.length ?? 0) === 0 ? (
              <p className="px-1 pb-2 text-[11px] text-gray-400">
                No folders yet — create one below to start organizing bookmarks.
              </p>
            ) : (
              <ul className="max-h-48 overflow-y-auto space-y-0.5 mb-2">
                {folders!.map((f) => {
                  const inFolder = f.items.includes(postId);
                  return (
                    <li key={f.id}>
                      <button
                        role="menuitemcheckbox"
                        aria-checked={inFolder}
                        onClick={() => toggleFolder(f)}
                        disabled={toggling === f.id}
                        className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-sm text-gray-200 hover:bg-lattice-deep transition-colors disabled:opacity-50"
                      >
                        <Folder className="w-3.5 h-3.5 text-neon-cyan flex-shrink-0" />
                        <span className="flex-1 text-left truncate">{f.name}</span>
                        <span className="text-[10px] text-gray-500">{f.itemCount}</span>
                        {toggling === f.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                        ) : inFolder ? (
                          <Check className="w-3.5 h-3.5 text-neon-purple" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex items-center gap-1.5 pt-2 border-t border-lattice-border">
              <input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createFolderAndAdd();
                }}
                placeholder="New folder"
                className="flex-1 min-w-0 rounded border border-lattice-border bg-lattice-deep px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-neon-purple"
              />
              <button
                onClick={createFolderAndAdd}
                disabled={!newFolderName.trim() || creating}
                aria-label="Create folder and save"
                className="rounded-full bg-neon-purple px-2 py-1 text-black hover:bg-neon-purple/90 disabled:opacity-40 flex-shrink-0"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
