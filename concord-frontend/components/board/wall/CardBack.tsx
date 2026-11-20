'use client';

/**
 * The back of an index card: everything about one card. Title, notes,
 * washi-tape labels, due date, who it's for, checklist, comments, links
 * and its history. A viewer reads and comments; an editor changes it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Archive, CheckSquare, Copy, Link2, MessageSquare, Trash2, X } from 'lucide-react';
import { ago, avatarColour, bx, canEdit, dueState, initials, tapeOf, type Board, type Card, type Member, type Role } from './wx';

export function CardBack({ board, cardId, role, members, me, onClose, onChanged, onToast }: {
  board: Board; cardId: string; role: Role; members: Member[]; me: string;
  onClose: () => void; onChanged: () => void; onToast: (s: string) => void;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [item, setItem] = useState('');
  const [comment, setComment] = useState('');
  const [link, setLink] = useState('');
  const [confirm, setConfirm] = useState<null | 'delete'>(null);
  const edit = canEdit(role);
  const name = (uid: string | null | undefined) => members.find((m) => m.userId === uid)?.name || uid || '';

  const load = useCallback(async () => {
    const r = await bx<{ card: Card }>('card-detail', { boardId: board.id, cardId });
    if (!r.ok) { setErr(r.error); return; }
    setCard(r.result!.card); setTitle(r.result!.card.title); setDesc(r.result!.card.description || ''); setErr(null);
  }, [board.id, cardId]);
  useEffect(() => { void load(); }, [load, board]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const act = async (action: string, input: Record<string, unknown>, ok?: string) => {
    const r = await bx(action, { boardId: board.id, cardId, ...input });
    if (!r.ok) { onToast(r.error || 'That did not save.'); return false; }
    if (ok) onToast(ok);
    await load(); onChanged();
    return true;
  };

  const col = card ? board.columns.find((c) => c.id === card.columnId) : null;
  const done = card ? card.checklist.filter((i) => i.done).length : 0;
  const ds = card ? dueState(card.dueDate) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:p-10" role="dialog" aria-modal aria-label={card ? card.title : 'Card'}>
      <button type="button" className="fixed inset-0 cursor-default bg-[rgba(30,18,6,0.55)]" aria-label="Close the card" tabIndex={-1} onClick={onClose} />
      <article className="cw-card cw-pinned-in relative w-full max-w-2xl p-5 pt-8 sm:p-7 sm:pt-9" data-testid="cw-cardback">
        <span className="cw-pin" aria-hidden />
        <button type="button" className="cw-btn cw-btn-ghost absolute right-2 top-2 h-8 px-2" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        {err && <p className="cw-error" role="alert">{err}</p>}
        {!card && !err && <div className="h-40 rounded bg-[var(--cw-card-2)]" role="status" aria-label="Opening the card" />}
        {card && (
          <div className="space-y-4">
            <div>
              {edit ? (
                <input className="w-full bg-transparent text-[22px] font-bold leading-tight outline-none focus:bg-white/70" value={title} maxLength={240} aria-label="Card title"
                  onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== card.title) void act('card-update', { title: title.trim() }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
              ) : <h2 className="text-[22px] font-bold leading-tight">{card.title}</h2>}
              <p className="mt-1 text-[12.5px] text-[var(--cw-muted)]">in <b>{col?.name || '—'}</b> on {board.name}{card.createdBy ? ` · pinned by ${name(card.createdBy)}` : ''}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {card.labels.map((l) => (
                <span key={l} className="cw-washi-text" style={{ background: tapeOf(l, board.labelDefs) }}>
                  {l}{edit && <button type="button" className="ml-1 opacity-60 hover:opacity-100" aria-label={`Remove label ${l}`} onClick={() => void act('card-update', { labels: card.labels.filter((x) => x !== l) })}>×</button>}
                </span>
              ))}
              {edit && (board.labelDefs || []).filter((d) => !card.labels.includes(d.name)).length > 0 && (
                <select className="cw-input h-7 w-auto text-[12px]" value="" aria-label="Add a label" onChange={(e) => { if (e.target.value) void act('card-update', { labels: [...card.labels, e.target.value] }); }}>
                  <option value="">+ label</option>
                  {(board.labelDefs || []).filter((d) => !card.labels.includes(d.name)).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-[12px] font-semibold text-[var(--cw-ink-2)]">Due
                {edit ? (
                  <input type="date" className="cw-input mt-1" value={card.dueDate ? card.dueDate.slice(0, 10) : ''} onChange={(e) => void act('card-update', { dueDate: e.target.value || null })} aria-label="Due date" />
                ) : <p className="mt-1 text-[14px]">{card.dueDate ? card.dueDate.slice(0, 10) : 'No date'}</p>}
                {ds && <span className={`mt-1 inline-block text-[11.5px] font-bold ${ds === 'overdue' ? 'text-[var(--cw-bad)]' : ds === 'today' ? 'text-[var(--cw-warn)]' : 'text-[var(--cw-muted)]'}`}>{ds === 'overdue' ? 'Overdue' : ds === 'today' ? 'Due today' : ds === 'soon' ? 'Due soon' : ''}</span>}
              </label>
              <label className="block text-[12px] font-semibold text-[var(--cw-ink-2)]">For
                {edit ? (
                  <select className="cw-input mt-1" value={card.assignee || ''} onChange={(e) => void act('card-update', { assignee: e.target.value || null })} aria-label="Assignee">
                    <option value="">No one</option>
                    {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.userId === me ? ' (you)' : ''}</option>)}
                  </select>
                ) : <p className="mt-1 text-[14px]">{card.assignee ? name(card.assignee) : 'No one'}</p>}
              </label>
            </div>

            <div>
              <h3 className="mb-1 text-[12px] font-bold uppercase tracking-wide text-[var(--cw-ink-2)]">Notes</h3>
              {edit ? (
                <textarea className="cw-input min-h-[90px]" value={desc} maxLength={4000} onChange={(e) => setDesc(e.target.value)} onBlur={() => { if (desc !== (card.description || '')) void act('card-update', { description: desc }); }} placeholder="Add more detail…" aria-label="Notes" />
              ) : <p className="whitespace-pre-wrap text-[14px]">{card.description || <span className="text-[var(--cw-muted)]">No notes.</span>}</p>}
            </div>

            <div>
              <h3 className="mb-1 flex items-center gap-1 text-[12px] font-bold uppercase tracking-wide text-[var(--cw-ink-2)]"><CheckSquare className="h-3.5 w-3.5" /> Checklist {card.checklist.length > 0 && <span className="cw-mono ml-1 normal-case">{done}/{card.checklist.length}</span>}</h3>
              {card.checklist.length > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded bg-[var(--cw-card-2)]"><div className="h-full bg-[var(--cw-good)] transition-[width]" style={{ width: `${(done / card.checklist.length) * 100}%` }} /></div>}
              <ul className="space-y-1" data-testid="cw-checklist">
                {card.checklist.map((i) => (
                  <li key={i.id}><label className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={i.done} disabled={!edit} onChange={async () => {
                      const r = await bx<{ automationsApplied: string[]; checklistComplete: boolean }>('card-checklist-toggle', { boardId: board.id, cardId, itemId: i.id });
                      if (!r.ok) { onToast(r.error || 'Not saved.'); return; }
                      if (r.result!.automationsApplied.length) onToast('Checklist done: the board\'s automation ran.');
                      await load(); onChanged();
                    }} />
                    <span className={i.done ? 'text-[var(--cw-muted)] line-through' : ''}>{i.text}</span>
                  </label></li>
                ))}
              </ul>
              {edit && (
                <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!item.trim()) return; if (await act('card-update', { addChecklistItem: item.trim() })) setItem(''); }}>
                  <input className="cw-input" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add an item" maxLength={200} aria-label="New checklist item" />
                  <button type="submit" className="cw-btn" disabled={!item.trim()} aria-label="Add checklist item">Add</button>
                </form>
              )}
            </div>

            <div>
              <h3 className="mb-1 flex items-center gap-1 text-[12px] font-bold uppercase tracking-wide text-[var(--cw-ink-2)]"><Link2 className="h-3.5 w-3.5" /> Links</h3>
              <ul className="space-y-1 text-[13.5px]">
                {(card.attachments || []).map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="truncate text-[#2c6aa0] underline">{a.name || a.url}</a>
                    {edit && <button type="button" className="text-[var(--cw-muted)] hover:text-[var(--cw-bad)]" aria-label="Remove link" onClick={() => void act('card-attachment-delete', { attachmentId: a.id })}>×</button>}
                  </li>
                ))}
              </ul>
              {edit && (
                <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const u = link.trim(); if (!/^https?:\/\//i.test(u)) { onToast('A link starts with http:// or https://'); return; } if (await act('card-attachment-add', { url: u, name: u.replace(/^https?:\/\//, '').slice(0, 80) })) setLink(''); }}>
                  <input className="cw-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" aria-label="Add a link" />
                  <button type="submit" className="cw-btn" disabled={!link.trim()}>Attach</button>
                </form>
              )}
            </div>

            <div>
              <h3 className="mb-1 flex items-center gap-1 text-[12px] font-bold uppercase tracking-wide text-[var(--cw-ink-2)]"><MessageSquare className="h-3.5 w-3.5" /> Comments</h3>
              <form className="mb-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!comment.trim()) return; if (await act('card-comment-add', { text: comment.trim() })) setComment(''); }}>
                <input className="cw-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write a comment" maxLength={2000} aria-label="Write a comment" data-testid="cw-comment-input" />
                <button type="submit" className="cw-btn cw-btn-pin" disabled={!comment.trim()} aria-label="Post comment">Post</button>
              </form>
              <ul className="space-y-2" data-testid="cw-comments">
                {(card.comments || []).map((c) => (
                  <li key={c.id} className="flex gap-2 text-[13.5px]">
                    <span className="cw-avatar shrink-0" style={{ background: avatarColour(c.author) }} aria-hidden>{initials(c.authorName || name(c.author) || '?')}</span>
                    <div><p><b>{c.authorName || name(c.author)}</b> <span className="text-[11.5px] text-[var(--cw-muted)]">{ago(c.at)}</span></p><p className="whitespace-pre-wrap">{c.text}</p></div>
                  </li>
                ))}
              </ul>
            </div>

            <details>
              <summary className="cursor-pointer text-[12px] font-bold uppercase tracking-wide text-[var(--cw-ink-2)]">History</summary>
              <ol className="mt-1 space-y-0.5 text-[12.5px] text-[var(--cw-ink-2)]">
                {(card.activity || []).map((a) => <li key={a.id}>{a.byName ? <b>{a.byName}</b> : null} {a.action} <span className="text-[var(--cw-muted)]">{ago(a.at)}</span></li>)}
              </ol>
            </details>

            {edit && (
              <div className="flex flex-wrap gap-2 border-t border-dashed border-[var(--cw-line)] pt-3">
                <button type="button" className="cw-btn" onClick={async () => {
                  const r = await bx('card-template-create', { boardId: board.id, cardId, name: card.title });
                  onToast(r.ok ? 'Saved as a template: "+ Add a card" can start from it.' : r.error || 'Not saved.');
                  if (r.ok) onChanged();
                }}><Copy className="h-3.5 w-3.5" /> Save as template</button>
                <button type="button" className="cw-btn" onClick={async () => { if (await act('card-archive', {}, 'Archived.')) onClose(); }}><Archive className="h-3.5 w-3.5" /> Archive</button>
                {confirm !== 'delete' ? (
                  <button type="button" className="cw-btn ml-auto" onClick={() => setConfirm('delete')}><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                ) : (
                  <span className="ml-auto flex items-center gap-2 text-[13px]">Delete for everyone?
                    <button type="button" className="cw-btn cw-btn-pin" onClick={async () => { if (await act('card-delete', {}, 'Deleted.')) onClose(); }}>Delete</button>
                    <button type="button" className="cw-btn" onClick={() => setConfirm(null)}>Keep</button>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </article>
    </div>
  );
}
