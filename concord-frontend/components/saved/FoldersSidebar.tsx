'use client';

/**
 * FoldersSidebar — folders / collections rail for the saved lens.
 *
 * Lists every folder with its live item count, a pseudo-folder for
 * "All" and "Unfiled", and an inline create form. Folder rename +
 * delete are inline. All mutations call real saved.folder* macros via
 * the parent's handlers.
 */

import { useState } from 'react';
import { Folder, FolderPlus, Inbox, Layers, Pencil, Trash2, Check, X } from 'lucide-react';
import type { SavedFolder } from './types';

export interface FoldersSidebarProps {
  folders: SavedFolder[];
  unfiledCount: number;
  totalCount: number;
  activeFolderId: string | null | undefined; // undefined = All, null = Unfiled
  onSelect: (folderId: string | null | undefined) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function FoldersSidebar({
  folders, unfiledCount, totalCount, activeFolderId,
  onSelect, onCreate, onRename, onDelete,
}: FoldersSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
    setCreating(false);
  }

  function submitRename(id: string) {
    const name = editName.trim();
    if (name) onRename(id, name);
    setEditId(null);
  }

  return (
    <aside className="space-y-1">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[11px] uppercase tracking-wide text-zinc-500 flex items-center gap-1">
          <Layers className="w-3.5 h-3.5" /> Collections
        </h2>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          aria-label="New folder"
          className="text-zinc-500 hover:text-amber-300"
        >
          <FolderPlus className="w-4 h-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onSelect(undefined)}
        className={`w-full flex items-center justify-between text-sm px-2 py-1.5 rounded ${
          activeFolderId === undefined
            ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
            : 'text-zinc-300 hover:bg-zinc-900 border border-transparent'
        }`}
      >
        <span className="flex items-center gap-2"><Inbox className="w-4 h-4" /> All saved</span>
        <span className="text-[10px] text-zinc-500">{totalCount}</span>
      </button>

      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`w-full flex items-center justify-between text-sm px-2 py-1.5 rounded ${
          activeFolderId === null
            ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
            : 'text-zinc-300 hover:bg-zinc-900 border border-transparent'
        }`}
      >
        <span className="flex items-center gap-2"><Folder className="w-4 h-4 text-zinc-500" /> Unfiled</span>
        <span className="text-[10px] text-zinc-500">{unfiledCount}</span>
      </button>

      {folders.map((f) => (
        <div key={f.id} className="group">
          {editId === f.id ? (
            <div className="flex items-center gap-1 px-1 py-1">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitRename(f.id); }}
                className="flex-1 text-xs bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-zinc-100"
                autoFocus
              />
              <button type="button" onClick={() => submitRename(f.id)} aria-label="Save name" className="text-emerald-400">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setEditId(null)} aria-label="Cancel" className="text-zinc-500">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              className={`flex items-center justify-between text-sm px-2 py-1.5 rounded ${
                activeFolderId === f.id
                  ? 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                  : 'text-zinc-300 hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(f.id)}
                className="flex items-center gap-2 min-w-0 flex-1 text-left"
              >
                <Folder className="w-4 h-4 text-amber-300 shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
              <span className="text-[10px] text-zinc-500 mr-1">{f.itemCount ?? 0}</span>
              <span className="hidden group-hover:flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { setEditId(f.id); setEditName(f.name); }}
                  aria-label="Rename folder"
                  className="text-zinc-500 hover:text-amber-300"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(f.id)}
                  aria-label="Delete folder"
                  className="text-zinc-500 hover:text-rose-300"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            </div>
          )}
        </div>
      ))}

      {creating && (
        <div className="flex items-center gap-1 px-1 py-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitCreate(); }}
            placeholder="Folder name"
            className="flex-1 text-xs bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-zinc-100"
            autoFocus
          />
          <button type="button" onClick={submitCreate} aria-label="Create folder" className="text-emerald-400">
            <Check className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </aside>
  );
}

export default FoldersSidebar;
