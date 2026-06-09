'use client';

/**
 * CardDetailModal — full Trello-shape card detail.
 * Comments, link attachments, activity feed, cover image/color,
 * rich-text (multiline) description, label assignment, custom fields.
 * Every mutation calls a real board.* macro; nothing is local-only.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  X,
  MessageSquare,
  Paperclip,
  Activity,
  Image as ImageIcon,
  Calendar,
  User,
  Trash2,
  Plus,
  CheckSquare,
  Square,
  Loader2,
  Tag,
  Sliders,
} from 'lucide-react';
import {
  boardMacro,
  WsBoard,
  WsCard,
  WsComment,
  WsAttachment,
  WsActivity,
  LABEL_COLOR_DOT,
  LABEL_COLOR_CLASS,
  LABEL_COLORS,
} from './workspace-types';

function fmt(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function CardDetailModal({
  board,
  cardId,
  onClose,
  onChanged,
}: {
  board: WsBoard;
  cardId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [card, setCard] = useState<WsCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'details' | 'activity'>('details');

  const [descDraft, setDescDraft] = useState('');
  const [newComment, setNewComment] = useState('');
  const [attUrl, setAttUrl] = useState('');
  const [attName, setAttName] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await boardMacro<{ card: WsCard }>('card-detail', { boardId: board.id, cardId });
    if (r.ok && r.result) {
      setCard(r.result.card);
      setDescDraft(r.result.card.description || '');
    } else {
      setErr(r.error || 'card not found');
    }
    setLoading(false);
  }, [board.id, cardId]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    await load();
    onChanged();
  }, [load, onChanged]);

  const saveDescription = useCallback(async () => {
    if (!card || descDraft === card.description) return;
    setBusy('desc');
    await boardMacro('card-update', { boardId: board.id, cardId, description: descDraft });
    setBusy(null);
    refresh();
  }, [board.id, cardId, card, descDraft, refresh]);

  const addComment = useCallback(async () => {
    const text = newComment.trim();
    if (!text) return;
    setBusy('comment');
    const r = await boardMacro('card-comment-add', { boardId: board.id, cardId, text });
    setBusy(null);
    if (r.ok) {
      setNewComment('');
      refresh();
    } else {
      setErr(r.error || 'failed to add comment');
    }
  }, [board.id, cardId, newComment, refresh]);

  const deleteComment = useCallback(
    async (commentId: string) => {
      setBusy(`cmt-${commentId}`);
      await boardMacro('card-comment-delete', { boardId: board.id, cardId, commentId });
      setBusy(null);
      refresh();
    },
    [board.id, cardId, refresh]
  );

  const addAttachment = useCallback(async () => {
    const url = attUrl.trim();
    if (!url) return;
    setBusy('attach');
    const r = await boardMacro('card-attachment-add', {
      boardId: board.id,
      cardId,
      url,
      name: attName.trim() || undefined,
    });
    setBusy(null);
    if (r.ok) {
      setAttUrl('');
      setAttName('');
      refresh();
    } else {
      setErr(r.error || 'failed to add attachment');
    }
  }, [board.id, cardId, attUrl, attName, refresh]);

  const deleteAttachment = useCallback(
    async (attachmentId: string) => {
      setBusy(`att-${attachmentId}`);
      await boardMacro('card-attachment-delete', { boardId: board.id, cardId, attachmentId });
      setBusy(null);
      refresh();
    },
    [board.id, cardId, refresh]
  );

  const setCover = useCallback(
    async (cover: { type: string; value: string } | null) => {
      setBusy('cover');
      await boardMacro('card-set-cover', { boardId: board.id, cardId, cover });
      setBusy(null);
      refresh();
    },
    [board.id, cardId, refresh]
  );

  const toggleLabel = useCallback(
    async (labelName: string) => {
      if (!card) return;
      const has = (card.labels || []).includes(labelName);
      const next = has
        ? card.labels.filter((l) => l !== labelName)
        : [...(card.labels || []), labelName];
      setBusy(`lbl-${labelName}`);
      await boardMacro('card-update', { boardId: board.id, cardId, labels: next });
      setBusy(null);
      refresh();
    },
    [board.id, cardId, card, refresh]
  );

  const toggleChecklist = useCallback(
    async (itemId: string) => {
      setBusy(`chk-${itemId}`);
      await boardMacro('card-checklist-toggle', { boardId: board.id, cardId, itemId });
      setBusy(null);
      refresh();
    },
    [board.id, cardId, refresh]
  );

  const setCustomField = useCallback(
    async (fieldId: string, value: string | boolean) => {
      setBusy(`fld-${fieldId}`);
      await boardMacro('card-set-field', { boardId: board.id, cardId, fieldId, value });
      setBusy(null);
      refresh();
    },
    [board.id, cardId, refresh]
  );

  const labelDefs = board.labelDefs || [];
  const customFields = board.customFields || [];
  const comments: WsComment[] = card?.comments || [];
  const attachments: WsAttachment[] = card?.attachments || [];
  const activity: WsActivity[] = card?.activity || [];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="w-full max-w-2xl rounded-xl border border-white/10 bg-gray-950 shadow-2xl my-8"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        {/* Cover */}
        {card?.cover &&
          (card.cover.type === 'color' ? (
            <div
              className={`h-24 rounded-t-xl ${LABEL_COLOR_DOT[card.cover.value] || 'bg-blue-500'}`}
            />
          ) : (
            <div
              className="h-32 rounded-t-xl bg-cover bg-center"
              style={{ backgroundImage: `url(${card.cover.value})` }}
            />
          ))}

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-2 gap-3">
          <h2 className="text-lg font-bold text-white break-words flex-1">
            {card?.title || 'Card'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}
        {err && !loading && (
          <p className="px-5 pb-4 text-sm text-red-400">{err}</p>
        )}

        {card && !loading && (
          <div className="px-5 pb-5 space-y-5">
            {/* Tabs */}
            <div className="flex border-b border-white/10">
              {(['details', 'activity'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-2 text-xs font-medium capitalize border-b-2 -mb-px transition-colors ${
                    tab === t
                      ? 'border-purple-500 text-purple-300'
                      : 'border-transparent text-gray-400 hover:text-gray-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === 'details' && (
              <>
                {/* Meta line */}
                <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                  {card.assignee && (
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> {card.assignee}
                    </span>
                  )}
                  {card.dueDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" /> {card.dueDate}
                    </span>
                  )}
                </div>

                {/* Labels */}
                {labelDefs.length > 0 && (
                  <div>
                    <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
                      <Tag className="w-3 h-3" /> Labels
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {labelDefs.map((ld) => {
                        const active = (card.labels || []).includes(ld.name);
                        return (
                          <button
                            key={ld.id}
                            onClick={() => toggleLabel(ld.name)}
                            disabled={busy === `lbl-${ld.name}`}
                            className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                              active
                                ? LABEL_COLOR_CLASS[ld.color] || LABEL_COLOR_CLASS.gray
                                : 'border-white/10 text-gray-400 hover:text-gray-300'
                            }`}
                          >
                            <span
                              className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
                                LABEL_COLOR_DOT[ld.color] || 'bg-gray-500'
                              }`}
                            />
                            {ld.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Rich description */}
                <div>
                  <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
                    Description
                  </h3>
                  <textarea
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    onBlur={saveDescription}
                    rows={4}
                    placeholder="Add a more detailed description..."
                    className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-white/10 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 resize-y"
                  />
                  {busy === 'desc' && (
                    <span className="text-[10px] text-gray-400">Saving...</span>
                  )}
                </div>

                {/* Cover controls */}
                <div>
                  <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" /> Cover
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {LABEL_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setCover({ type: 'color', value: c })}
                        className={`w-7 h-7 rounded-md ${LABEL_COLOR_DOT[c]} ${
                          card.cover?.type === 'color' && card.cover.value === c
                            ? 'ring-2 ring-white'
                            : 'opacity-70 hover:opacity-100'
                        }`}
                        aria-label={`${c} cover`}
                      />
                    ))}
                    {card.cover && (
                      <button
                        onClick={() => setCover(null)}
                        className="text-xs px-2 py-1 rounded-md bg-white/5 text-gray-400 hover:text-white"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="url"
                      value={coverUrl}
                      onChange={(e) => setCoverUrl(e.target.value)}
                      placeholder="Cover image URL..."
                      className="flex-1 px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                    />
                    <button
                      onClick={() => {
                        if (coverUrl.trim()) {
                          setCover({ type: 'image', value: coverUrl.trim() });
                          setCoverUrl('');
                        }
                      }}
                      disabled={!coverUrl.trim() || busy === 'cover'}
                      className="px-2.5 py-1.5 text-xs rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                    >
                      Set
                    </button>
                  </div>
                </div>

                {/* Checklist */}
                {(card.checklist || []).length > 0 && (
                  <div>
                    <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5">
                      Checklist ({card.checklist.filter((i) => i.done).length}/
                      {card.checklist.length})
                    </h3>
                    <div className="space-y-1">
                      {card.checklist.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => toggleChecklist(item.id)}
                          disabled={busy === `chk-${item.id}`}
                          className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors"
                        >
                          {item.done ? (
                            <CheckSquare className="w-4 h-4 text-green-400 flex-shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-gray-600 flex-shrink-0" />
                          )}
                          <span
                            className={`text-sm ${
                              item.done ? 'text-gray-400 line-through' : 'text-gray-300'
                            }`}
                          >
                            {item.text}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom fields */}
                {customFields.length > 0 && (
                  <div>
                    <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
                      <Sliders className="w-3 h-3" /> Custom Fields
                    </h3>
                    <div className="space-y-2">
                      {customFields.map((f) => {
                        const val = card.customFields?.[f.id];
                        return (
                          <div key={f.id} className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-28 truncate">{f.name}</span>
                            {f.type === 'checkbox' ? (
                              <input
                                type="checkbox"
                                checked={val === true}
                                onChange={(e) => setCustomField(f.id, e.target.checked)}
                                className="accent-purple-500"
                              />
                            ) : f.type === 'select' ? (
                              <select
                                value={typeof val === 'string' ? val : ''}
                                onChange={(e) => setCustomField(f.id, e.target.value)}
                                className="flex-1 px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/40"
                              >
                                <option value="">—</option>
                                {f.options.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={
                                  f.type === 'number'
                                    ? 'number'
                                    : f.type === 'date'
                                      ? 'date'
                                      : 'text'
                                }
                                defaultValue={val != null ? String(val) : ''}
                                onBlur={(e) => setCustomField(f.id, e.target.value)}
                                className="flex-1 px-2 py-1 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/40"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Attachments */}
                <div>
                  <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
                    <Paperclip className="w-3 h-3" /> Attachments ({attachments.length})
                  </h3>
                  <div className="space-y-1.5 mb-2">
                    {attachments.length === 0 && (
                      <p className="text-xs text-gray-400">No attachments yet.</p>
                    )}
                    {attachments.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-300 hover:underline truncate flex-1"
                        >
                          {a.name}
                        </a>
                        <button
                          onClick={() => deleteAttachment(a.id)}
                          disabled={busy === `att-${a.id}`}
                          className="text-gray-600 hover:text-red-400"
                          aria-label="Delete attachment"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={attName}
                      onChange={(e) => setAttName(e.target.value)}
                      placeholder="Name"
                      className="w-28 px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                    />
                    <input
                      type="url"
                      value={attUrl}
                      onChange={(e) => setAttUrl(e.target.value)}
                      placeholder="https://..."
                      className="flex-1 px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                    />
                    <button aria-label="Add attachment"
                      onClick={addAttachment}
                      disabled={!attUrl.trim() || busy === 'attach'}
                      className="px-2.5 py-1.5 text-xs rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Comments */}
                <div>
                  <h3 className="text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> Comments ({comments.length})
                  </h3>
                  <div className="space-y-2 mb-2">
                    {comments.length === 0 && (
                      <p className="text-xs text-gray-400">No comments yet.</p>
                    )}
                    {comments.map((c) => (
                      <div
                        key={c.id}
                        className="px-2.5 py-2 rounded-md bg-white/[0.03] border border-white/[0.06]"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-gray-300">{c.author}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400">{fmt(c.at)}</span>
                            <button
                              onClick={() => deleteComment(c.id)}
                              disabled={busy === `cmt-${c.id}`}
                              className="text-gray-600 hover:text-red-400"
                              aria-label="Delete comment"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 whitespace-pre-wrap">{c.text}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addComment()}
                      placeholder="Write a comment..."
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                    />
                    <button
                      onClick={addComment}
                      disabled={!newComment.trim() || busy === 'comment'}
                      className="px-2.5 py-1.5 text-xs rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'activity' && (
              <div className="space-y-2">
                {activity.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-6">No activity yet.</p>
                )}
                {activity.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 text-xs">
                    <Activity className="w-3.5 h-3.5 text-gray-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-gray-300">{a.action}</p>
                      <p className="text-[10px] text-gray-400">{fmt(a.at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
