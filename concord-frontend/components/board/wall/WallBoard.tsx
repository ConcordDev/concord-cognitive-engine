'use client';

/**
 * The wall: columns under masking tape, index cards pinned in them. Drag a
 * card to move it (a pushpin-red bar shows where it will land); or focus a
 * card and press [ or ] to move it a column left or right. The move shows at
 * once and is rolled back, visibly, if the server refuses it.
 */
import { useMemo, useState } from 'react';
import { Archive, CheckSquare, MessageSquare, MoreHorizontal, Plus } from 'lucide-react';
import { avatarColour, bx, canEdit, dueState, initials, shortDate, tapeOf, type Board, type Card, type Member, type Role, type Template } from './wx';

export interface Filter { text: string; label: string; who: string; due: '' | 'overdue' | 'week' | 'none' }

export function WallBoard({ board, role, members, filter, onOpen, onMoved, onChanged, onToast }: {
  board: Board; role: Role; members: Member[]; filter: Filter;
  onOpen: (cardId: string) => void; onMoved: (b: Board) => void; onChanged: () => void; onToast: (s: string) => void;
}) {
  const edit = canEdit(role);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ col: string; index: number } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newCol, setNewCol] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const cols = board.columns.filter((c) => !c.archived);
  const name = (uid: string | null) => members.find((m) => m.userId === uid)?.name || uid || '';

  const visible = (c: Card) => {
    if (c.archived) return false;
    if (filter.text && !`${c.title} ${c.description}`.toLowerCase().includes(filter.text.toLowerCase())) return false;
    if (filter.label && !c.labels.includes(filter.label)) return false;
    if (filter.who && c.assignee !== filter.who) return false;
    if (filter.due) {
      const s = dueState(c.dueDate);
      if (filter.due === 'none' && c.dueDate) return false;
      if (filter.due === 'overdue' && s !== 'overdue') return false;
      if (filter.due === 'week' && !(c.dueDate && (Date.parse(c.dueDate) - Date.now()) / 86400000 < 7)) return false;
    }
    return true;
  };
  const byCol = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of cols) m.set(c.id, []);
    for (const card of board.cards) if (m.has(card.columnId) && !card.archived) m.get(card.columnId)!.push(card);
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position);
    return m;
  }, [board, cols]);

  /** Optimistic move: show it now, then let the server settle (or refuse) it. */
  const move = async (cardId: string, toColumnId: string, position: number) => {
    const card = board.cards.find((c) => c.id === cardId); if (!card) return;
    const optimistic: Board = { ...board, cards: board.cards.map((c) => (c.id === cardId ? { ...c, columnId: toColumnId, position: position - 0.5 } : c)) };
    onMoved(optimistic);
    const r = await bx<{ automationsApplied: string[] }>('card-move', { boardId: board.id, cardId, toColumnId, position });
    if (!r.ok) { onMoved(board); onToast(`Moved back: ${r.error}`); return; }
    if (r.result!.automationsApplied.length) onToast(`Moved "${card.title}" — ${r.result!.automationsApplied.length} automation${r.result!.automationsApplied.length === 1 ? '' : 's'} ran.`);
    onChanged();
  };

  const addCard = async (columnId: string, templateId?: string) => {
    const t = newTitle.trim();
    if (!t && !templateId) return;
    const r = templateId
      ? await bx('card-create-from-template', { boardId: board.id, columnId, templateId, ...(t ? { title: t } : {}) })
      : await bx('card-create', { boardId: board.id, columnId, title: t });
    if (!r.ok) { onToast(r.error || 'The card was not added.'); return; }
    setNewTitle('');
    onChanged();
  };

  return (
    <div className="cw-scroll flex h-full items-start gap-4 overflow-x-auto p-4 pb-8" data-testid="cw-wall">
      {cols.map((col, ci) => {
        const all = byCol.get(col.id) || [];
        const cards = all.filter(visible);
        return (
          <section key={col.id} className="cw-column flex w-[280px] shrink-0 flex-col p-2" aria-label={`${col.name}, ${all.length} cards`}
            data-over={over?.col === col.id} data-testid="cw-column"
            onDragOver={(e) => { if (!drag || !edit) return; e.preventDefault(); const cardsEls = [...e.currentTarget.querySelectorAll('[data-card]')] as HTMLElement[]; let idx = cardsEls.length; for (let i = 0; i < cardsEls.length; i++) { const r = cardsEls[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { idx = i; break; } } setOver({ col: col.id, index: idx }); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); if (drag && over) { const ids = cards.map((c) => c.id); const without = ids.filter((id) => id !== drag); const before = without.slice(0, Math.min(over.index, without.length)); void move(drag, col.id, before.length); } setDrag(null); setOver(null); }}>
            <header className="mb-3 flex items-center gap-1">
              {renaming === col.id ? (
                <form className="flex-1" onSubmit={async (e) => { e.preventDefault(); setRenaming(null); if (rename.trim() && rename.trim() !== col.name) { const r = await bx('column-update', { boardId: board.id, columnId: col.id, name: rename.trim() }); if (!r.ok) onToast(r.error || 'Not renamed.'); onChanged(); } }}>
                  <input autoFocus className="cw-input h-8" value={rename} onChange={(e) => setRename(e.target.value)} onBlur={() => setRenaming(null)} maxLength={80} aria-label={`Rename ${col.name}`} />
                </form>
              ) : (
                <h2 className="cw-tape cw-marker flex-1 px-3 py-0.5 text-[24px] leading-tight" onDoubleClick={() => { if (edit) { setRenaming(col.id); setRename(col.name); } }}>
                  {col.name} <span className="cw-mono text-[12px] text-[#6d5d43]">{cards.length !== all.length ? `${cards.length}/${all.length}` : all.length}</span>
                </h2>
              )}
              {edit && (
                <div className="relative">
                  <button type="button" className="cw-btn cw-btn-ghost h-7 px-1.5 cw-on-cork" aria-label={`${col.name} options`} aria-expanded={menu === col.id} onClick={() => setMenu(menu === col.id ? null : col.id)}><MoreHorizontal className="h-4 w-4" /></button>
                  {menu === col.id && (
                    <div className="cw-panel absolute right-0 z-20 mt-1 w-48 p-1 text-[13px]" role="menu">
                      <button type="button" role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--cw-card-2)]" onClick={() => { setMenu(null); setRenaming(col.id); setRename(col.name); }}>Rename</button>
                      {ci > 0 && <button type="button" role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--cw-card-2)]" onClick={async () => { setMenu(null); await bx('column-update', { boardId: board.id, columnId: col.id, toIndex: board.columns.indexOf(col) - 1 }); onChanged(); }}>Move left</button>}
                      {ci < cols.length - 1 && <button type="button" role="menuitem" className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--cw-card-2)]" onClick={async () => { setMenu(null); await bx('column-update', { boardId: board.id, columnId: col.id, toIndex: board.columns.indexOf(col) + 1 }); onChanged(); }}>Move right</button>}
                      <button type="button" role="menuitem" className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left hover:bg-[var(--cw-card-2)]" onClick={async () => { setMenu(null); const r = await bx('column-archive', { boardId: board.id, columnId: col.id }); onToast(r.ok ? `Archived "${col.name}" and its cards.` : r.error || 'Not archived.'); onChanged(); }}><Archive className="h-3.5 w-3.5" /> Archive column</button>
                    </div>
                  )}
                </div>
              )}
            </header>
            <ol className="flex min-h-[40px] flex-col gap-3">
              {cards.map((card, i) => {
                const done = card.checklist.filter((x) => x.done).length;
                const ds = dueState(card.dueDate);
                return (
                  <li key={card.id}>
                    {over?.col === col.id && over.index === i && drag && drag !== card.id && <div className="cw-drop mb-2" aria-hidden />}
                    <div
                      role="button" tabIndex={0} data-card className="cw-card cursor-grab px-3 pb-2 pt-4 active:cursor-grabbing" draggable={edit}
                      data-tilt={i % 3 === 0 ? 'a' : i % 3 === 2 ? 'b' : undefined} data-dragging={drag === card.id}
                      aria-label={`${card.title}${card.dueDate ? `, due ${shortDate(card.dueDate)}` : ''}${card.assignee ? `, for ${name(card.assignee)}` : ''}. Enter opens, [ and ] move between columns.`}
                      onClick={() => onOpen(card.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(card.id); }
                        if (!edit) return;
                        if (e.key === '[' && ci > 0) { e.preventDefault(); void move(card.id, cols[ci - 1].id, (byCol.get(cols[ci - 1].id) || []).length); }
                        if (e.key === ']' && ci < cols.length - 1) { e.preventDefault(); void move(card.id, cols[ci + 1].id, (byCol.get(cols[ci + 1].id) || []).length); }
                      }}
                      onDragStart={(e) => { setDrag(card.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.id); }}
                      onDragEnd={() => { setDrag(null); setOver(null); }}
                      data-testid="cw-card"
                    >
                      <span className="cw-pin" aria-hidden />
                      {card.labels.length > 0 && <div className="mb-1.5 flex flex-wrap gap-1">{card.labels.map((l) => <span key={l} className="cw-washi" style={{ background: tapeOf(l, board.labelDefs) }} title={l} aria-label={`label ${l}`} />)}</div>}
                      <p className="text-[14.5px] font-semibold leading-snug">{card.title}</p>
                      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--cw-ink-2)]">
                        {card.dueDate && <span className={`cw-mono rounded px-1 ${ds === 'overdue' ? 'bg-[#f6d2cd] text-[var(--cw-bad)]' : ds === 'today' || ds === 'soon' ? 'bg-[#f7e6c1] text-[#7a4d06]' : ''}`}>{shortDate(card.dueDate)}</span>}
                        {card.checklist.length > 0 && <span className={`cw-mono flex items-center gap-0.5 ${done === card.checklist.length ? 'text-[var(--cw-good)]' : ''}`}><CheckSquare className="h-3 w-3" />{done}/{card.checklist.length}</span>}
                        {(card.comments?.length || 0) > 0 && <span className="cw-mono flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{card.comments!.length}</span>}
                        {card.assignee && <span className="cw-avatar ml-auto" style={{ background: avatarColour(card.assignee) }} title={name(card.assignee)}>{initials(name(card.assignee))}</span>}
                      </div>
                    </div>
                  </li>
                );
              })}
              {over?.col === col.id && over.index >= cards.length && drag && <li aria-hidden><div className="cw-drop" /></li>}
              {!cards.length && !drag && <li className="cw-on-cork px-1 text-[12.5px] opacity-80">{all.length ? 'Nothing here matches the filter.' : 'Empty.'}</li>}
            </ol>
            {edit && (adding === col.id ? (
              <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); void addCard(col.id); }}>
                <textarea autoFocus className="cw-input min-h-[64px]" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="What needs doing?" maxLength={240} aria-label={`New card in ${col.name}`}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void addCard(col.id); } if (e.key === 'Escape') setAdding(null); }} data-testid="cw-new-card" />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="cw-btn cw-btn-pin" disabled={!newTitle.trim()}>Pin it</button>
                  {(board.templates || []).length > 0 && (
                    <select className="cw-input h-8 w-auto text-[12.5px]" value="" aria-label="Start from a template" onChange={(e) => { if (e.target.value) void addCard(col.id, e.target.value); }}>
                      <option value="">From template…</option>
                      {(board.templates as Template[]).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  )}
                  <button type="button" className="cw-btn cw-btn-ghost" onClick={() => { setAdding(null); setNewTitle(''); }}>Cancel</button>
                </div>
              </form>
            ) : (
              <button type="button" className="cw-btn cw-btn-ghost cw-on-cork mt-3 justify-start" onClick={() => { setAdding(col.id); setNewTitle(''); }} data-testid="cw-add-card"><Plus className="h-4 w-4" /> Add a card</button>
            ))}
          </section>
        );
      })}
      {edit && (
        <form className="w-[260px] shrink-0" onSubmit={async (e) => { e.preventDefault(); if (!newCol.trim()) return; const r = await bx('column-add', { boardId: board.id, name: newCol.trim() }); if (!r.ok) { onToast(r.error || 'Not added.'); return; } setNewCol(''); onChanged(); }}>
          <input className="cw-input bg-[rgba(255,250,235,0.85)]" value={newCol} onChange={(e) => setNewCol(e.target.value)} placeholder="+ Add a column" maxLength={80} aria-label="New column name" />
        </form>
      )}
    </div>
  );
}
