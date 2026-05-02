'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Users, GitBranch, GitMerge, GitFork, Lock,
  Eye, CheckCircle, AlertTriangle, ChevronDown,
  ChevronUp, Undo2, History, Circle, ArrowRight,
  Loader2, Shield, Diff,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type ValidationStatus = 'valid' | 'warning' | 'error' | 'checking';
type ConflictResolution = 'mine' | 'theirs' | 'manual';

interface Participant {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  cursorPosition?: string;       // member ID they're focused on
  isEditing?: boolean;
  isOnline: boolean;
  lastSeen?: string;
}

interface EditEntry {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  description: string;
  memberId?: string;
  timestamp: string;
  undoable?: boolean;
}

interface Conflict {
  id: string;
  memberId: string;
  memberLabel: string;
  parameterName: string;
  valueA: { authorId: string; authorName: string; value: string };
  valueB: { authorId: string; authorName: string; value: string };
  resolved: boolean;
}

interface VersionEntry {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  timestamp: string;
  summary: string;
  changeCount: number;
}

interface CollabSession {
  id: string;
  dtuId: string;
  dtuName: string;
  branch: string;
  isDraft: boolean;
  validationStatus: ValidationStatus;
  validationMessages: string[];
}

interface LiveCollaborationProps {
  session: CollabSession;
  participants: Participant[];
  editHistory: EditEntry[];
  conflicts: Conflict[];
  onEdit?: (memberId: string, field: string, value: string) => void;
  onResolve?: (conflictId: string, resolution: ConflictResolution, value?: string) => void;
  onFork?: (versionId: string) => void;
  onMerge?: () => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const STATUS_STYLES: Record<ValidationStatus, { color: string; label: string; icon: React.ReactNode }> = {
  valid:    { color: 'text-green-400',  label: 'Valid',      icon: <CheckCircle className="w-3.5 h-3.5" /> },
  warning:  { color: 'text-yellow-400', label: 'Warnings',   icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  error:    { color: 'text-red-400',    label: 'Errors',     icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  checking: { color: 'text-cyan-400',   label: 'Validating', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
};

/* ── Participant Avatars ──────────────────────────────────────── */

function AvatarRow({ participants }: { participants: Participant[] }) {
  const online = participants.filter(p => p.isOnline);
  const editing = online.filter(p => p.isEditing);

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {online.slice(0, 6).map(p => (
          <div
            key={p.id}
            className="relative w-7 h-7 rounded-full border-2 border-black/80 flex items-center justify-center text-[10px] font-bold text-white"
            style={{ backgroundColor: p.color + '40', borderColor: p.color }}
            title={`${p.name}${p.isEditing ? ' (editing)' : ''}`}
          >
            {p.avatar ? (
              <span>{p.avatar}</span>
            ) : (
              <span>{p.name.charAt(0).toUpperCase()}</span>
            )}
            {/* Online dot */}
            <div
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-black/80"
              style={{ backgroundColor: p.isEditing ? p.color : '#22c55e' }}
            />
          </div>
        ))}
        {online.length > 6 && (
          <div className="w-7 h-7 rounded-full border-2 border-white/10 bg-white/10 flex items-center justify-center text-[10px] text-white/60">
            +{online.length - 6}
          </div>
        )}
      </div>
      <span className="text-[10px] text-white/40">
        {editing.length > 0
          ? `${editing.length} editing`
          : `${online.length} online`}
      </span>
    </div>
  );
}

/* ── Presence Indicators ──────────────────────────────────────── */

function PresenceList({ participants }: { participants: Participant[] }) {
  const withCursor = participants.filter(p => p.isOnline && p.cursorPosition);
  if (withCursor.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="text-[10px] text-white/30 uppercase tracking-wider px-1">Viewing</p>
      {withCursor.map(p => (
        <div key={p.id} className="flex items-center gap-2 px-2 py-1 rounded bg-white/5 text-[10px]">
          <Eye className="w-3 h-3" style={{ color: p.color }} />
          <span className="text-white/60">{p.name}</span>
          <ArrowRight className="w-2.5 h-2.5 text-white/20" />
          <span className="text-white/40 font-mono">{p.cursorPosition}</span>
          {p.isEditing && <Lock className="w-2.5 h-2.5 text-yellow-400 ml-auto" />}
        </div>
      ))}
    </div>
  );
}

/* ── Conflict Card ────────────────────────────────────────────── */

function ConflictCard({
  conflict,
  onResolve,
}: {
  conflict: Conflict;
  onResolve?: (id: string, resolution: ConflictResolution, value?: string) => void;
}) {
  if (conflict.resolved) return null;

  return (
    <div className="p-2.5 bg-red-500/5 border border-red-500/20 rounded-lg space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-red-300 font-medium">{conflict.memberLabel}</p>
          <p className="text-[10px] text-white/40">{conflict.parameterName}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onResolve?.(conflict.id, 'mine', conflict.valueA.value)}
          className="flex flex-col items-start gap-0.5 px-2 py-1.5 bg-white/5 border border-white/10 rounded hover:border-blue-400/50 transition-colors group"
        >
          <span className="text-[10px] text-white/40 group-hover:text-blue-400">
            {conflict.valueA.authorName}
          </span>
          <span className="text-xs text-white/80 font-mono">{conflict.valueA.value}</span>
        </button>
        <button
          onClick={() => onResolve?.(conflict.id, 'theirs', conflict.valueB.value)}
          className="flex flex-col items-start gap-0.5 px-2 py-1.5 bg-white/5 border border-white/10 rounded hover:border-purple-400/50 transition-colors group"
        >
          <span className="text-[10px] text-white/40 group-hover:text-purple-400">
            {conflict.valueB.authorName}
          </span>
          <span className="text-xs text-white/80 font-mono">{conflict.valueB.value}</span>
        </button>
      </div>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────── */

export default function LiveCollaboration({
  session,
  participants,
  editHistory,
  conflicts,
  onEdit: _onEdit,
  onResolve,
  onFork,
  onMerge,
}: LiveCollaborationProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [showEditFeed, setShowEditFeed] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);

  const activeConflicts = useMemo(
    () => conflicts.filter(c => !c.resolved),
    [conflicts],
  );

  const onlineCount = useMemo(
    () => participants.filter(p => p.isOnline).length,
    [participants],
  );

  const editingCount = useMemo(
    () => participants.filter(p => p.isOnline && p.isEditing).length,
    [participants],
  );

  /* Build version timeline from edit history */
  const versionTimeline: VersionEntry[] = useMemo(() => {
    const versions: VersionEntry[] = [];
    let batch: EditEntry[] = [];
    let lastAuthor = '';

    for (const entry of [...editHistory].reverse()) {
      if (entry.authorId !== lastAuthor && batch.length > 0) {
        const first = batch[0];
        versions.push({
          id: first.id,
          authorId: first.authorId,
          authorName: first.authorName,
          authorColor: first.authorColor,
          timestamp: first.timestamp,
          summary: batch.length === 1
            ? first.description
            : `${batch.length} changes`,
          changeCount: batch.length,
        });
        batch = [];
      }
      batch.push(entry);
      lastAuthor = entry.authorId;
    }

    if (batch.length > 0) {
      const first = batch[0];
      versions.push({
        id: first.id,
        authorId: first.authorId,
        authorName: first.authorName,
        authorColor: first.authorColor,
        timestamp: first.timestamp,
        summary: batch.length === 1
          ? first.description
          : `${batch.length} changes`,
        changeCount: batch.length,
      });
    }

    return versions.reverse();
  }, [editHistory]);

  const statusMeta = STATUS_STYLES[session.validationStatus];

  const handleUndo = useCallback(
    (entryId: string) => {
      /* In real implementation, this would call an undo handler */
      void entryId;
    },
    [],
  );

  return (
    <div className={`${panel} w-80 flex flex-col max-h-[80vh]`}>
      {/* Header with avatars */}
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-medium text-white">{session.dtuName}</span>
          </div>
          <span className="text-[10px] text-white/30 font-mono">{session.dtuId}</span>
        </div>

        {/* Participant avatars */}
        <AvatarRow participants={participants} />

        {/* Branch / draft indicator */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded text-[10px]">
            <GitBranch className="w-3 h-3 text-purple-400" />
            <span className="text-white/60 font-mono">{session.branch}</span>
          </div>
          {session.isDraft && (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/10 border border-yellow-500/20 rounded text-[10px]">
              <Circle className="w-2 h-2 text-yellow-400 fill-yellow-400" />
              <span className="text-yellow-400">Draft</span>
            </div>
          )}
          {session.isDraft && onMerge && (
            <button
              onClick={onMerge}
              className="flex items-center gap-1 px-2 py-1 bg-green-500/10 border border-green-500/20 rounded text-[10px] text-green-400 hover:bg-green-500/20 transition-colors ml-auto"
            >
              <GitMerge className="w-3 h-3" />
              Merge
            </button>
          )}
        </div>

        {/* Validation status */}
        <div className="flex items-center gap-2 px-2 py-1.5 bg-white/5 rounded">
          <span className={statusMeta.color}>{statusMeta.icon}</span>
          <span className={`text-[10px] ${statusMeta.color}`}>{statusMeta.label}</span>
          {session.validationMessages.length > 0 && (
            <span className="text-[10px] text-white/30 ml-auto">
              {session.validationMessages.length} issue{session.validationMessages.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {session.validationMessages.length > 0 && (
          <div className="space-y-0.5 pl-1">
            {session.validationMessages.slice(0, 3).map((msg, i) => (
              <p key={i} className="text-[10px] text-white/35 flex items-start gap-1.5">
                <span className="text-white/20 mt-0.5">-</span>
                {msg}
              </p>
            ))}
            {session.validationMessages.length > 3 && (
              <p className="text-[10px] text-white/25">
                +{session.validationMessages.length - 3} more
              </p>
            )}
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Conflicts */}
        {activeConflicts.length > 0 && (
          <div className="p-3 border-b border-white/10 space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span className="text-xs text-red-400 font-medium">
                {activeConflicts.length} Conflict{activeConflicts.length !== 1 ? 's' : ''}
              </span>
            </div>
            {activeConflicts.map(c => (
              <ConflictCard key={c.id} conflict={c} onResolve={onResolve} />
            ))}
          </div>
        )}

        {/* Presence */}
        <div className="p-3 border-b border-white/10">
          <PresenceList participants={participants} />
        </div>

        {/* Live edit feed */}
        <div className="p-3 border-b border-white/10 space-y-2">
          <button
            onClick={() => setShowEditFeed(s => !s)}
            className="flex items-center justify-between w-full text-[10px] text-white/40 hover:text-white/60 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Diff className="w-3 h-3" />
              Live Edit Feed
            </span>
            {showEditFeed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showEditFeed && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {editHistory.length === 0 ? (
                <p className="text-[10px] text-white/25 text-center py-3">No edits yet</p>
              ) : (
                editHistory.slice(0, 20).map(entry => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 px-2 py-1.5 bg-white/5 rounded text-[10px] group"
                  >
                    <div
                      className="w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                      style={{ backgroundColor: entry.authorColor }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-white/60">
                        <span className="font-medium" style={{ color: entry.authorColor }}>
                          @{entry.authorName}
                        </span>{' '}
                        {entry.description}
                      </p>
                      <p className="text-white/25">
                        {new Date(entry.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </p>
                    </div>
                    {entry.undoable && (
                      <button
                        onClick={() => handleUndo(entry.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 transition-all shrink-0"
                        title="Undo this change"
                      >
                        <Undo2 className="w-3 h-3 text-white/40" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Version history sidebar */}
        <div className="p-3 space-y-2">
          <button
            onClick={() => setShowHistory(h => !h)}
            className="flex items-center justify-between w-full text-[10px] text-white/40 hover:text-white/60 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <History className="w-3 h-3" />
              Version History ({versionTimeline.length})
            </span>
            {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showHistory && (
            <div className="space-y-0.5 max-h-60 overflow-y-auto">
              {versionTimeline.length === 0 ? (
                <p className="text-[10px] text-white/25 text-center py-3">No versions yet</p>
              ) : (
                versionTimeline.map((v, i) => (
                  <div
                    key={v.id}
                    className={`relative pl-5 py-1.5 pr-2 rounded text-[10px] transition-colors cursor-pointer ${
                      selectedVersion === v.id ? 'bg-white/10' : 'hover:bg-white/5'
                    }`}
                    onClick={() => setSelectedVersion(selectedVersion === v.id ? null : v.id)}
                  >
                    {/* Timeline line */}
                    {i < versionTimeline.length - 1 && (
                      <div className="absolute left-[9px] top-5 bottom-0 w-px bg-white/10" />
                    )}
                    {/* Timeline dot */}
                    <div
                      className="absolute left-1.5 top-2.5 w-2 h-2 rounded-full border border-black/50"
                      style={{ backgroundColor: v.authorColor }}
                    />

                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-white/60">
                          <span style={{ color: v.authorColor }} className="font-medium">
                            {v.authorName}
                          </span>
                        </p>
                        <p className="text-white/40 truncate">{v.summary}</p>
                      </div>
                      <span className="text-white/20 shrink-0">
                        {new Date(v.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    {/* Fork button (shown on hover/select) */}
                    {selectedVersion === v.id && onFork && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onFork(v.id);
                        }}
                        className="flex items-center gap-1 mt-1.5 px-2 py-1 bg-purple-500/10 border border-purple-500/20 rounded text-purple-400 hover:bg-purple-500/20 transition-colors"
                      >
                        <GitFork className="w-3 h-3" />
                        Fork from this point
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer: editing count */}
      <div className="px-3 py-2 border-t border-white/10 flex items-center justify-between text-[10px] text-white/25">
        <span>{onlineCount} online, {editingCount} editing</span>
        <span className="flex items-center gap-1">
          <Shield className="w-3 h-3" />
          Your changes are auto-saved
        </span>
      </div>
    </div>
  );
}
