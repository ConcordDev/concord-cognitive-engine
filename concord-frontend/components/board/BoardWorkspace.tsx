'use client';

/**
 * BoardWorkspace — the real, macro-backed Trello-shape board.
 * Per-user boards persisted server-side via the board.* macros.
 * Drag-and-drop card movement (with automation rules applied on drop),
 * a calendar view, label filtering, card detail modal, and board
 * settings (labels / automation / sharing / custom fields).
 * No seed/mock data — every card and column is real user input.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Kanban,
  Plus,
  Trash2,
  Settings,
  LayoutGrid,
  CalendarDays,
  Loader2,
  X,
  Tag,
  Filter,
} from 'lucide-react';
import {
  boardMacro,
  useBoardList,
  useBoardDetail,
  WsCard,
  WsCalendar,
  LABEL_COLOR_DOT,
} from './workspace-types';
import { CardDetailModal } from './CardDetailModal';
import { BoardSettingsPanel } from './BoardSettingsPanel';

function isOverdue(due: string | null): boolean {
  if (!due) return false;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export function BoardWorkspace() {
  const { boards, loading: listLoading, error: listError, reload: reloadList } = useBoardList();
  const [activeId, setActiveId] = useState<string | null>(null);
  const { board, loading: boardLoading, error: boardError, reload: reloadBoard } = useBoardDetail(activeId);

  const [view, setView] = useState<'board' | 'calendar'>('board');
  const [newBoardName, setNewBoardName] = useState('');
  const [newColName, setNewColName] = useState('');
  const [quickAdd, setQuickAdd] = useState<Record<string, string>>({});
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [boardOwner, setBoardOwner] = useState<string>('');
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // pick first board automatically once the list resolves
  if (!activeId && boards.length > 0 && !listLoading) {
    setActiveId(boards[0].id);
  }

  const [calendar, setCalendar] = useState<WsCalendar | null>(null);
  const loadCalendar = useCallback(async () => {
    if (!activeId) return;
    const r = await boardMacro<WsCalendar>('card-calendar', { boardId: activeId });
    if (r.ok && r.result) setCalendar(r.result);
  }, [activeId]);

  const switchView = useCallback(
    (v: 'board' | 'calendar') => {
      setView(v);
      if (v === 'calendar') loadCalendar();
    },
    [loadCalendar]
  );

  const openSettings = useCallback(async () => {
    if (activeId) {
      const r = await boardMacro<{ owner: string }>('collaborator-list', {
        boardId: activeId,
      });
      if (r.ok && r.result) setBoardOwner(r.result.owner);
    }
    setShowSettings(true);
  }, [activeId]);

  const createBoard = useCallback(async () => {
    const name = newBoardName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    const r = await boardMacro<{ board: { id: string } }>('board-create', { name });
    setBusy(false);
    if (r.ok && r.result) {
      setNewBoardName('');
      await reloadList();
      setActiveId(r.result.board.id);
    } else {
      setErr(r.error || 'failed to create board');
    }
  }, [newBoardName, reloadList]);

  const deleteBoard = useCallback(async () => {
    if (!activeId) return;
    setBusy(true);
    await boardMacro('board-delete', { id: activeId });
    setBusy(false);
    setActiveId(null);
    setCalendar(null);
    reloadList();
  }, [activeId, reloadList]);

  const addColumn = useCallback(async () => {
    const name = newColName.trim();
    if (!name || !activeId) return;
    setBusy(true);
    await boardMacro('column-add', { boardId: activeId, name });
    setBusy(false);
    setNewColName('');
    reloadBoard();
  }, [newColName, activeId, reloadBoard]);

  const deleteColumn = useCallback(
    async (columnId: string) => {
      if (!activeId) return;
      await boardMacro('column-delete', { boardId: activeId, columnId });
      reloadBoard();
    },
    [activeId, reloadBoard]
  );

  const createCard = useCallback(
    async (columnId: string) => {
      const title = (quickAdd[columnId] || '').trim();
      if (!title || !activeId) return;
      await boardMacro('card-create', { boardId: activeId, columnId, title });
      setQuickAdd((p) => ({ ...p, [columnId]: '' }));
      reloadBoard();
    },
    [quickAdd, activeId, reloadBoard]
  );

  const onDrop = useCallback(
    async (toColumnId: string) => {
      setDragOverCol(null);
      const cardId = dragCardId;
      setDragCardId(null);
      if (!cardId || !activeId || !board) return;
      const card = board.cards.find((c) => c.id === cardId);
      if (!card || card.columnId === toColumnId) return;
      // card-move-auto moves and applies any matching automation rules
      await boardMacro('card-move-auto', { boardId: activeId, cardId, toColumnId });
      reloadBoard();
      if (view === 'calendar') loadCalendar();
    },
    [dragCardId, activeId, board, reloadBoard, view, loadCalendar]
  );

  const onCardChanged = useCallback(() => {
    reloadBoard();
    if (view === 'calendar') loadCalendar();
  }, [reloadBoard, view, loadCalendar]);

  const labelDefs = useMemo(() => board?.labelDefs || [], [board]);
  const filteredCards = useMemo(() => {
    if (!board) return [] as WsCard[];
    if (filterLabel === 'all') return board.cards;
    return board.cards.filter((c) => (c.labels || []).includes(filterLabel));
  }, [board, filterLabel]);

  const cardsIn = useCallback(
    (columnId: string) =>
      filteredCards
        .filter((c) => c.columnId === columnId)
        .sort((a, b) => a.position - b.position),
    [filteredCards]
  );

  const labelColorOf = useCallback(
    (name: string) => {
      const def = labelDefs.find((l) => l.name === name);
      return def ? LABEL_COLOR_DOT[def.color] || 'bg-gray-500' : 'bg-gray-500';
    },
    [labelDefs]
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Kanban className="w-5 h-5 text-purple-400" />
          <h2 className="text-base font-bold text-white">Boards Workspace</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300">
            macro-backed
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <select
            value={activeId || ''}
            onChange={(e) => {
              setActiveId(e.target.value || null);
              setCalendar(null);
              setFilterLabel('all');
            }}
            className="px-2.5 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/40"
          >
            <option value="">Select a board...</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.cardCount})
              </option>
            ))}
          </select>
          {board && (
            <>
              <button
                onClick={openSettings}
                className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-white"
                aria-label="Board settings"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                onClick={deleteBoard}
                className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-400 hover:text-red-400"
                aria-label="Delete board"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Create board row */}
      <div className="flex gap-1.5 mb-4">
        <input
          type="text"
          value={newBoardName}
          onChange={(e) => setNewBoardName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createBoard()}
          placeholder="New board name..."
          className="flex-1 max-w-xs px-2.5 py-1.5 text-xs rounded-lg bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
        />
        <button
          onClick={createBoard}
          disabled={!newBoardName.trim() || busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Create Board
        </button>
      </div>

      {err && <p className="text-xs text-red-400 mb-3">{err}</p>}

      {listLoading && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      )}

      {/* A failed list load must read as an error, not a silent "empty" state. */}
      {!listLoading && listError && boards.length === 0 && (
        <div className="text-center py-12 text-sm text-red-400" role="alert">
          Could not load boards: {listError}
          <button
            onClick={reloadList}
            className="ml-2 underline text-red-300 hover:text-red-200"
          >
            Retry
          </button>
        </div>
      )}

      {!listLoading && !listError && boards.length === 0 && (
        <div className="text-center py-12 text-sm text-gray-400">
          No boards yet. Create your first board above.
        </div>
      )}

      {/* A board-detail load failure surfaces instead of a blank workspace. */}
      {activeId && !boardLoading && boardError && (
        <div className="text-sm text-red-400 py-6" role="alert">
          Could not load this board: {boardError}
          <button
            onClick={reloadBoard}
            className="ml-2 underline text-red-300 hover:text-red-200"
          >
            Retry
          </button>
        </div>
      )}

      {board && (
        <>
          {/* View toggle + filter */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-1 p-1 bg-white/5 rounded-lg border border-white/10">
              {(
                [
                  { v: 'board' as const, icon: LayoutGrid, label: 'Board' },
                  { v: 'calendar' as const, icon: CalendarDays, label: 'Calendar' },
                ] as const
              ).map(({ v, icon: Icon, label }) => (
                <button
                  key={v}
                  onClick={() => switchView(v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    view === v
                      ? 'bg-purple-500/20 text-purple-300'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
            {labelDefs.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-gray-400" />
                <select
                  value={filterLabel}
                  onChange={(e) => setFilterLabel(e.target.value)}
                  className="px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/40"
                >
                  <option value="all">All labels</option>
                  {labelDefs.map((l) => (
                    <option key={l.id} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {boardLoading && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          )}

          {/* BOARD VIEW */}
          {!boardLoading && view === 'board' && (
            <div className="overflow-x-auto pb-2">
              <div className="flex gap-3 min-w-max items-start">
                {board.columns.map((col) => {
                  const colCards = cardsIn(col.id);
                  return (
                    <div
                      key={col.id}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverCol(col.id);
                      }}
                      onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
                      onDrop={() => onDrop(col.id)}
                      className={`w-64 flex-shrink-0 rounded-lg border transition-colors ${
                        dragOverCol === col.id
                          ? 'border-purple-500/50 bg-purple-500/5'
                          : 'border-white/[0.06] bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
                        <span className="text-sm font-semibold text-gray-200">{col.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-400">
                            {colCards.length}
                          </span>
                          <button
                            onClick={() => deleteColumn(col.id)}
                            className="text-gray-600 hover:text-red-400"
                            aria-label="Delete column"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="p-2 space-y-2 min-h-[60px]">
                        {colCards.map((card) => (
                          <div
                            key={card.id}
                            draggable
                            onDragStart={() => setDragCardId(card.id)}
                            onDragEnd={() => setDragCardId(null)}
                            onClick={() => setOpenCardId(card.id)}
                            className="rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-purple-500/40 cursor-pointer overflow-hidden transition-colors" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                            {card.cover &&
                              (card.cover.type === 'color' ? (
                                <div
                                  className={`h-6 ${LABEL_COLOR_DOT[card.cover.value] || 'bg-blue-500'}`}
                                />
                              ) : (
                                <div
                                  className="h-16 bg-cover bg-center"
                                  style={{ backgroundImage: `url(${card.cover.value})` }}
                                />
                              ))}
                            <div className="p-2.5">
                              {(card.labels || []).length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-1.5">
                                  {card.labels.map((l) => (
                                    <span
                                      key={l}
                                      className={`h-1.5 w-7 rounded-full ${labelColorOf(l)}`}
                                      title={l}
                                    />
                                  ))}
                                </div>
                              )}
                              <p className="text-sm text-gray-200">{card.title}</p>
                              <div className="flex items-center gap-2 mt-1.5 text-[10px] text-gray-400">
                                {card.dueDate && (
                                  <span
                                    className={
                                      isOverdue(card.dueDate)
                                        ? 'text-red-400 font-medium'
                                        : ''
                                    }
                                  >
                                    {card.dueDate}
                                  </span>
                                )}
                                {card.assignee && <span>{card.assignee}</span>}
                                {(card.checklist || []).length > 0 && (
                                  <span>
                                    {card.checklist.filter((i) => i.done).length}/
                                    {card.checklist.length}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}

                        {colCards.length === 0 && (
                          <p className="text-[11px] text-gray-400 text-center py-2">
                            No cards yet
                          </p>
                        )}

                        <div className="flex gap-1">
                          <input
                            type="text"
                            value={quickAdd[col.id] || ''}
                            onChange={(e) =>
                              setQuickAdd((p) => ({ ...p, [col.id]: e.target.value }))
                            }
                            onKeyDown={(e) => e.key === 'Enter' && createCard(col.id)}
                            placeholder="Add a card..."
                            className="flex-1 px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                          />
                          <button
                            onClick={() => createCard(col.id)}
                            className="p-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-400"
                            aria-label="Add card"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Add column */}
                <div className="w-56 flex-shrink-0">
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={newColName}
                      onChange={(e) => setNewColName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addColumn()}
                      placeholder="New column..."
                      className="flex-1 px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                    />
                    <button
                      onClick={addColumn}
                      className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-gray-400"
                      aria-label="Add column"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CALENDAR VIEW */}
          {!boardLoading && view === 'calendar' && (
            <div>
              {!calendar && (
                <div className="flex items-center justify-center py-8 text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              )}
              {calendar && (
                <>
                  <div className="flex gap-3 mb-3 text-xs">
                    <span className="text-gray-400">
                      Scheduled: <span className="text-white">{calendar.scheduled}</span>
                    </span>
                    <span className="text-gray-400">
                      Overdue: <span className="text-red-400">{calendar.overdue}</span>
                    </span>
                    <span className="text-gray-400">
                      Unscheduled:{' '}
                      <span className="text-white">{calendar.unscheduled}</span>
                    </span>
                  </div>
                  {calendar.days.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">
                      No cards have due dates yet.
                    </p>
                  ) : (
                    <ol className="relative border-l border-white/10 ml-2 space-y-3">
                      {calendar.days.map((day) => (
                        <li key={day.date} className="ml-4">
                          <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-purple-500/60 border-2 border-gray-950" />
                          <p className="text-xs font-semibold text-gray-300 mb-1.5">
                            {new Date(day.date).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                          <div className="space-y-1.5">
                            {day.cards.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => setOpenCardId(c.id)}
                                className="w-full text-left rounded-md border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] px-2.5 py-1.5 transition-colors"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm text-gray-200 truncate">
                                    {c.title}
                                  </span>
                                  <span
                                    className={`text-[10px] flex-shrink-0 ${
                                      c.overdue ? 'text-red-400' : 'text-gray-400'
                                    }`}
                                  >
                                    {c.columnName}
                                    {c.overdue && ' · overdue'}
                                  </span>
                                </div>
                                {c.labels.length > 0 && (
                                  <div className="flex gap-1 mt-1">
                                    {c.labels.map((l) => (
                                      <span
                                        key={l}
                                        className="text-[9px] flex items-center gap-0.5 text-gray-400"
                                      >
                                        <Tag className="w-2.5 h-2.5" />
                                        {l}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {board && openCardId && (
        <CardDetailModal
          board={board}
          cardId={openCardId}
          onClose={() => setOpenCardId(null)}
          onChanged={onCardChanged}
        />
      )}
      {board && showSettings && (
        <BoardSettingsPanel
          board={board}
          owner={boardOwner || 'owner'}
          onClose={() => setShowSettings(false)}
          onChanged={reloadBoard}
        />
      )}
    </div>
  );
}
