'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, Inbox, Coins, Package, X, Paperclip, Search, Trash2 } from 'lucide-react';
import { Skeleton, EmptyState, ErrorState } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { MailKeepMenu } from './MailKeepMenu';
import { mailRecordSentence } from './mailKeep';
import { claimResultText, declineResultText, deleteResultText, mailPartyLabel, playerMail } from './playerMail';
import { STATUS_FILTERS, type ComposeSeed, type MailRow, type StatusFilter } from './types';

// FIX-mail-016: order a folder's rows as threads — a reply renders
// directly under the mail it answers (oldest reply first), however new
// the reply itself is. A reply whose parent is not in this list (it
// lives in the other folder, or a filter hid it) stands as its own root.
function threadOrdered(rows: MailRow[]): { mail: MailRow; depth: number }[] {
  const byId = new Map(rows.map((m) => [m.id, m]));
  const children = new Map<string, MailRow[]>();
  const roots: MailRow[] = [];
  for (const m of rows) {
    if (m.parentId && m.parentId !== m.id && byId.has(m.parentId)) {
      const sibs = children.get(m.parentId) || [];
      sibs.push(m);
      children.set(m.parentId, sibs);
    } else {
      roots.push(m);
    }
  }
  for (const sibs of children.values()) sibs.sort((a, b) => a.sentAt - b.sentAt);
  const out: { mail: MailRow; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (m: MailRow, depth: number) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    out.push({ mail: m, depth });
    for (const c of children.get(m.id) || []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out;
}

export function MailFolderPanel({
  folder,
  onCompose,
}: {
  folder: 'inbox' | 'sent';
  onCompose: (seed?: ComposeSeed) => void;
}) {
  const [inbox, setInbox] = useState<MailRow[]>([]);
  const [sent, setSent] = useState<MailRow[]>([]);
  const [selected, setSelected] = useState<MailRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [claimNote, setClaimNote] = useState<{ mailId: string; msg: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [declineArmId, setDeclineArmId] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [i, s] = await Promise.all([
        playerMail('list'),
        playerMail('sent'),
      ]);
      if (!i.ok || !s.ok) {
        throw new Error('Could not reach your mail just now. Try again in a moment.');
      }
      const nextInbox = i.mail || [];
      const nextSent = s.mail || [];
      setInbox(nextInbox);
      setSent(nextSent);
      setSelected((prev) => {
        if (!prev) return prev;
        return [...nextInbox, ...nextSent].find((row) => row.id === prev.id) || prev;
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not reach the mail service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  useEffect(() => {
    if (!selected || selected.status !== 'unread' || folder !== 'inbox') return;
    // Opening is list-local: the row already carries the full message.
    // The one open-time verb is mail.read, recipient-side — it flips
    // this copy unread → read exactly once. Its failure is ONE inline
    // notice in product words, never a raw authorization string (F4).
    let cancelled = false;
    playerMail('read', { id: selected.id }).then((j) => {
      if (cancelled) return;
      if (j.ok) { void refresh(); return; }
      setOpenNote('This copy could not be marked as read. The message itself is open and unchanged.');
    });
    return () => { cancelled = true; };
  }, [selected, refresh, folder]);

  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      try {
        const { subscribe } = await import('@/lib/realtime/socket');
        off = subscribe('mail:received', () => refresh());
      } catch { /* optional */ }
    })();
    return () => off?.();
  }, [refresh]);

  const handleDeleteSent = useCallback(async (mailId: string) => {
    setBusy(`delete-${mailId}`);
    try {
      const j = await playerMail('delete', { id: mailId });
      const note = deleteResultText(j);
      showFlash(note.kind, note.msg);
      if (j.ok) {
        setSelected(null);
        setConfirmDelete(false);
        void refresh();
      }
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  const handleClaim = useCallback(async (mailId: string) => {
    setBusy(`claim-${mailId}`);
    try {
      const j = await playerMail('claim', { id: mailId });
      const note = claimResultText(j);
      setClaimNote({ mailId, msg: note.msg });
      showFlash(note.kind, note.msg);
      if (j.ok) refresh();
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  // FIX-mail-014: Decline is the recipient's other answer to a COD /
  // attachment mail — the escrowed gift and DTUs return to the sender and
  // no COD is charged. Two-step, like the remove-from-Sent confirm.
  const handleDecline = useCallback(async (mailId: string) => {
    setBusy(`decline-${mailId}`);
    try {
      const j = await playerMail('decline', { id: mailId });
      const note = declineResultText(j);
      setClaimNote({ mailId, msg: note.msg });
      showFlash(note.kind, note.msg);
      if (j.ok) {
        setDeclineArmId(null);
        refresh();
      }
    } finally { setBusy(null); }
  }, [refresh, showFlash]);

  const folderRows = folder === 'sent' ? sent : inbox;
  const rows = useMemo(() => {
    let base = folderRows;
    if (folder === 'inbox' && statusFilter !== 'all') {
      base = base.filter((m) => m.status === statusFilter);
    }
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((m) => {
      const otherName = folder === 'inbox'
        ? mailPartyLabel(m.fromName, m.fromHandle)
        : mailPartyLabel(m.toName, m.toHandle);
      return (
        m.subject?.toLowerCase().includes(q) ||
        m.body?.toLowerCase().includes(q) ||
        otherName.toLowerCase().includes(q)
      );
    });
  }, [folderRows, folder, statusFilter, query]);

  // FIX-mail-019: the detail pane must never show a mail the visible list no
  // longer contains — a filter or folder change that excludes the open mail
  // closes it instead of leaving a stale detail on screen.
  useEffect(() => {
    if (selected && !rows.some((r) => r.id === selected.id)) setSelected(null);
  }, [rows, selected]);

  // FIX-mail-016: the list renders in thread order; the detail pane's
  // thread block assembles over BOTH folders (the panel always loads
  // inbox + sent), so a reply I sent still shows under the original I
  // received, and vice versa.
  const threadedRows = useMemo(() => threadOrdered(rows), [rows]);
  const allRows = useMemo(() => {
    const map = new Map<string, MailRow>();
    for (const m of [...inbox, ...sent]) if (!map.has(m.id)) map.set(m.id, m);
    return [...map.values()];
  }, [inbox, sent]);
  const threadParent = useMemo(
    () => (selected?.parentId ? allRows.find((m) => m.id === selected.parentId) || null : null),
    [allRows, selected],
  );
  const threadReplies = useMemo(() => {
    if (!selected) return [] as MailRow[];
    const kids = new Map<string, MailRow[]>();
    for (const m of allRows) {
      if (!m.parentId) continue;
      const a = kids.get(m.parentId) || [];
      a.push(m);
      kids.set(m.parentId, a);
    }
    const out: MailRow[] = [];
    const seen = new Set<string>([selected.id]);
    const walk = (id: string) => {
      for (const c of (kids.get(id) || []).slice().sort((a, b) => a.sentAt - b.sentAt)) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
        walk(c.id);
      }
    };
    walk(selected.id);
    return out;
  }, [allRows, selected]);

  const replySeed = useCallback((m: MailRow): ComposeSeed => {
    const toUserId = folder === 'inbox' ? m.fromUser : m.toUser;
    const otherLabel = folder === 'inbox'
      ? mailPartyLabel(m.fromName, m.fromHandle)
      : mailPartyLabel(m.toName, m.toHandle);
    const quoted = (m.body || '').split('\n').map((l) => `> ${l}`).join('\n');
    return {
      ...(toUserId ? { toUserId } : {}),
      subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
      body: `\n\n— On ${new Date(m.sentAt * 1000).toLocaleString()}, ${otherLabel} wrote:\n${quoted}`,
      parentId: m.id,
    };
  }, [folder]);

  const forwardSeed = useCallback((m: MailRow): ComposeSeed => {
    const quoted = (m.body || '').split('\n').map((l) => `> ${l}`).join('\n');
    return {
      subject: /^fwd:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`,
      body: `\n\n— Forwarded mail from ${mailPartyLabel(m.fromName, m.fromHandle)}, ${new Date(m.sentAt * 1000).toLocaleString()}:\n${quoted}`,
    };
  }, []);

  return (
    <section className="mx-auto grid max-w-screen-2xl gap-3 px-3 py-4 sm:grid-cols-[1fr_2fr] sm:px-6 sm:py-5">
      {flash && (
        <div className={cn('sm:col-span-2 rounded-md border px-3 py-1.5 text-[11px]', flash.kind === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200')}>
          {flash.msg}
        </div>
      )}
      <div className={cn(ds.panelBare, 'p-2')} aria-busy={loading}>
        <div className="mb-2 space-y-1.5 px-0.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subject, body, sender…"
              aria-label="Search mail"
              className="w-full rounded-md border border-lattice-border bg-lattice-void/60 py-1 pl-6 pr-2 text-[11px] text-gray-100 placeholder:text-gray-500 outline-none transition-colors focus:border-neon-blue"
            />
          </div>
          {folder === 'inbox' && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  aria-pressed={statusFilter === f}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] capitalize transition-colors',
                    statusFilter === f
                      ? 'border-neon-blue/50 bg-neon-blue/15 text-neon-blue'
                      : 'border-lattice-border bg-lattice-elevated/50 text-gray-400 hover:bg-lattice-elevated hover:text-gray-200',
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
        {loading && (
          <div className="space-y-1 px-0.5 py-1">
            {[0, 1, 2, 3, 4].map((k) => (
              <div key={k} className="rounded-md border border-lattice-border bg-lattice-void/40 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton variant="line" width="35%" height="0.55rem" />
                  <Skeleton variant="line" width="18%" height="0.55rem" />
                </div>
                <Skeleton variant="line" width="70%" height="0.8rem" className="mt-1.5" />
              </div>
            ))}
          </div>
        )}
        {!loading && loadError && (
          <ErrorState
            variant="inline"
            message={loadError}
            onRetry={() => { setLoading(true); refresh(); }}
            className="m-1"
          />
        )}
        {!loading && !loadError && rows.length === 0 && (
          <EmptyState
            compact
            icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
            title={folderRows.length > 0 ? 'No matches' : folder === 'inbox' ? 'No mail yet' : 'Nothing sent yet'}
            description={
              folderRows.length > 0
                ? 'No mail matches this filter or search.'
                : folder === 'inbox'
                  ? 'Friends can send you mail from the friends panel.'
                  : 'Mail you send will appear here.'
            }
            action={
              folderRows.length > 0
                ? { label: 'Clear filters', onClick: () => { setQuery(''); setStatusFilter('all'); } }
                : folder === 'inbox'
                  ? undefined
                  : { label: 'Compose mail', onClick: onCompose }
            }
            className="m-1"
          />
        )}
        {!loading && !loadError && rows.length > 0 && (
          <ul className="space-y-0.5">
            {threadedRows.map(({ mail: m, depth }) => {
              const otherLabel = folder === 'inbox'
                ? mailPartyLabel(m.fromName, m.fromHandle)
                : mailPartyLabel(m.toName, m.toHandle);
              const hasAttach = (m.attachment_dtu_ids?.length || 0) > 0 || m.attachmentCc > 0 || m.codCc > 0;
              const isUnread = m.status === 'unread';
              const isSelected = selected?.id === m.id;
              return (
                <li key={m.id}>
                  <button
                    onClick={() => { setConfirmDelete(false); setOpenNote(null); setSelected(m); }}
                    style={depth > 0 ? { marginLeft: depth * 14 } : undefined}
                    aria-current={isSelected ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-md border-l-2 px-2.5 py-1.5 text-left transition-colors',
                      isSelected
                        ? 'border-l-neon-blue bg-neon-blue/10'
                        : isUnread
                          ? 'border-l-neon-blue/70 bg-lattice-elevated/40 hover:bg-lattice-elevated'
                          : 'border-l-transparent hover:bg-lattice-elevated/60',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neon-blue" aria-hidden="true" />}
                        <span className={cn('truncate', isUnread ? 'text-gray-100' : 'text-gray-400')}>
                          {otherLabel}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-500">
                        {new Date(m.sentAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <div className={cn('mt-0.5 truncate text-[12px]', isUnread ? 'font-semibold text-white' : 'text-gray-300')}>
                      {depth > 0 && <span className="mr-1 text-gray-500" title="Reply in a thread">↳</span>}
                      {m.subject}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-emerald-200/90">{mailRecordSentence(m, folder)}</div>
                    {hasAttach && (
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                        {m.attachmentCc > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-lattice-void px-1 tabular-nums text-amber-300">
                            <Coins className="h-2.5 w-2.5" /> {m.attachmentCc}
                          </span>
                        )}
                        {(m.attachment_dtu_ids?.length || 0) > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-lattice-void px-1 tabular-nums text-neon-cyan">
                            <Package className="h-2.5 w-2.5" /> {m.attachment_dtu_ids.length}
                          </span>
                        )}
                        {m.codCc > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-lattice-void px-1 tabular-nums text-red-300">
                            COD {m.codCc}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={cn(ds.panelBare, 'p-3')}>
        {!selected ? (
          <EmptyState
            compact
            icon={<Mail className="h-5 w-5" aria-hidden="true" />}
            title="No mail selected"
            description="Select a message from the list to read it."
          />
        ) : (
          <div>
            <header className="mb-3 flex items-start justify-between gap-3 border-b border-lattice-border pb-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-white">{selected.subject}</h2>
                <p className="mt-1 text-[10px] text-gray-400">
                  From <span className="text-gray-200">{mailPartyLabel(selected.fromName, selected.fromHandle)}</span> to <span className="text-gray-200">{mailPartyLabel(selected.toName, selected.toHandle)}</span>
                  {' · '}
                  <span className="tabular-nums">{new Date(selected.sentAt * 1000).toLocaleString()}</span>
                </p>
              </div>
              <button
                onClick={() => setSelected(null)}
                aria-label="Close mail"
                className={cn('shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-lattice-elevated hover:text-white', ds.focusRing)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </header>
            <p className="text-[11px] text-emerald-200" role="status">{mailRecordSentence(selected, folder)}</p>
            {openNote && <p className="mt-1 text-[11px] text-amber-200" role="status">{openNote}</p>}
            <p className="mt-2 whitespace-pre-wrap text-[12px] leading-relaxed text-gray-200">{selected.body}</p>
            <MailKeepMenu key={selected.id} mail={selected} />
            {(threadParent || threadReplies.length > 0) && (
              <div className="mt-3 rounded-md border border-lattice-border bg-lattice-void/50 p-2.5 text-[11px]">
                <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Thread</h3>
                {threadParent && (
                  <p className="text-gray-300">
                    In reply to{' '}
                    <button type="button" onClick={() => setSelected(threadParent)} className="text-neon-blue underline decoration-dotted hover:text-white">
                      {threadParent.subject}
                    </button>
                  </p>
                )}
                {threadReplies.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {threadReplies.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => setSelected(r)} className="text-left text-gray-300 hover:text-white">
                          <span className="mr-1 text-gray-500">↳</span>{r.subject}
                          <span className="ml-2 text-[10px] text-gray-500">
                            {mailPartyLabel(r.fromName, r.fromHandle)} · {new Date(r.sentAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              {(folder === 'inbox' ? selected.fromUser : selected.toUser) && (
                <button
                  type="button"
                  onClick={() => onCompose(replySeed(selected))}
                  className={cn('inline-flex items-center gap-1 rounded-md border border-lattice-border px-2.5 py-1 text-[11px] text-gray-200 transition-colors hover:border-neon-blue/50 hover:text-white', ds.focusRing)}
                >
                  Reply
                </button>
              )}
              <button
                type="button"
                onClick={() => onCompose(forwardSeed(selected))}
                className={cn('inline-flex items-center gap-1 rounded-md border border-lattice-border px-2.5 py-1 text-[11px] text-gray-200 transition-colors hover:border-neon-blue/50 hover:text-white', ds.focusRing)}
              >
                Forward
              </button>
            </div>
            {folder === 'sent' && (
              <div className="mt-3">
                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className={cn('inline-flex items-center gap-1 rounded-md border border-lattice-border px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-red-500/40 hover:text-red-200', ds.focusRing)}
                  >
                    <Trash2 className="h-3 w-3" /> Remove from Sent
                  </button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="text-gray-300">
                      {selected.attachmentCc > 0 && selected.status !== 'claimed'
                        ? `Remove this from Sent and return the unclaimed ${selected.attachmentCc} CC gift to you? The recipient keeps the message.`
                        : 'Remove this copy from your Sent list? The recipient keeps theirs.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleDeleteSent(selected.id)}
                      disabled={busy === `delete-${selected.id}`}
                      className={cn('rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-red-200 transition-colors hover:bg-red-500/20', ds.focusRing)}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className={cn('rounded-md border border-lattice-border px-2.5 py-1 text-gray-300 transition-colors hover:bg-lattice-elevated', ds.focusRing)}
                    >
                      Keep it
                    </button>
                  </div>
                )}
              </div>
            )}

            {(selected.attachmentCc > 0 || selected.attachment_dtu_ids?.length > 0 || selected.codCc > 0) && (
              <div className="mt-4 rounded-md border border-lattice-border bg-lattice-void/50 p-2.5 text-[11px]">
                <h3 className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                  <Paperclip className="h-3 w-3" /> Attachments
                </h3>
                {selected.attachmentCc > 0 && (
                  <p className="flex items-center gap-1 text-amber-300">
                    <Coins className="h-3 w-3" /> <span className="tabular-nums">{selected.attachmentCc}</span> CC
                  </p>
                )}
                {selected.attachment_dtu_ids?.length > 0 && (
                  <p className="flex items-center gap-1 text-neon-cyan">
                    <Package className="h-3 w-3" /> <span className="tabular-nums">{selected.attachment_dtu_ids.length}</span> DTU(s): <span className="truncate font-mono text-[10px]">{selected.attachment_dtu_ids.slice(0, 3).join(', ')}</span>
                  </p>
                )}
                {selected.codCc > 0 && (
                  <p className="text-red-300">COD due on claim: <span className="tabular-nums">{selected.codCc}</span> CC</p>
                )}
                {folder === 'inbox' && selected.status !== 'claimed' && selected.status !== 'expired' && selected.status !== 'declined' && (
                  <button
                    onClick={() => handleClaim(selected.id)}
                    disabled={busy === `claim-${selected.id}`}
                    className={cn(ds.btnPrimary, 'mt-2 px-3 py-1 text-[11px]')}
                  >
                    Claim {selected.codCc > 0 ? `(pay ${selected.codCc} CC)` : ''}
                  </button>
                )}
                {folder === 'inbox' && (selected.status === 'unread' || selected.status === 'read') && (
                  declineArmId === selected.id ? (
                    <span className="ml-2 inline-flex items-center gap-2">
                      <span className="text-gray-300">Decline this mail? The gift CC and DTUs go back to the sender and you pay nothing.</span>
                      <button
                        onClick={() => handleDecline(selected.id)}
                        disabled={busy === `decline-${selected.id}`}
                        className="px-1 text-[11px] font-medium text-rose-300 hover:text-rose-200"
                      >
                        Decline and return
                      </button>
                      <button
                        onClick={() => setDeclineArmId(null)}
                        className="px-1 text-[11px] text-gray-300 hover:text-white"
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setDeclineArmId(selected.id)}
                      aria-label={`Decline mail ${selected.subject}`}
                      className="ml-2 mt-2 px-3 py-1 text-[11px] text-gray-300 underline decoration-dotted hover:text-white"
                    >
                      Decline
                    </button>
                  )
                )}
                {claimNote && claimNote.mailId === selected.id && <p className="mt-2 text-[11px] text-gray-200" role="status">{claimNote.msg}</p>}
                {selected.status === 'claimed' && (
                  <p className="mt-1 text-[10px] italic text-gray-400">
                    Claimed <span className="tabular-nums">{selected.claimedAt ? new Date(selected.claimedAt * 1000).toLocaleString() : ''}</span>
                  </p>
                )}
                {selected.status === 'expired' && <p className="mt-1 text-[10px] italic text-red-400">Expired — attachments returned to sender.</p>}
                {selected.status === 'declined' && (
                  <p className="mt-1 text-[10px] italic text-gray-400">
                    Declined{selected.declinedAt ? <> <span className="tabular-nums">{new Date(selected.declinedAt * 1000).toLocaleString()}</span></> : ''} — attachments returned to the sender; nothing was charged.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
