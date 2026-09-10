'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, Inbox, Coins, Package, X, Paperclip, Search } from 'lucide-react';
import { Skeleton, EmptyState, ErrorState } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { STATUS_FILTERS, type MailRow, type StatusFilter } from './types';

export function MailFolderPanel({
  folder,
  onCompose,
}: {
  folder: 'inbox' | 'sent';
  onCompose: () => void;
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

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [i, s] = await Promise.all([
        fetch('/api/mail/inbox', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/mail/sent', { credentials: 'include' }).then((r) => r.json()),
      ]);
      if (!i?.ok || !s?.ok) {
        throw new Error(i?.error || s?.error || 'Mail service returned an error.');
      }
      setInbox(i.mail || []);
      setSent(s.mail || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not reach the mail service.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); refresh(); }, [refresh]);

  useEffect(() => {
    if (!selected || selected.status !== 'unread') return;
    fetch(`/api/mail/${selected.id}/read`, { method: 'POST', credentials: 'include' })
      .then(() => refresh());
  }, [selected, refresh]);

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

  const handleClaim = useCallback(async (mailId: string) => {
    setBusy(`claim-${mailId}`);
    try {
      const r = await fetch(`/api/mail/${mailId}/claim`, { method: 'POST', credentials: 'include' });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', `Claimed: ${j?.payout?.attachmentCc || 0} CC + ${j?.attachments?.dtuIds?.length || 0} DTUs.`);
        refresh();
      } else {
        showFlash('err', j.error || 'claim failed');
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
      const other = folder === 'inbox' ? m.fromUser : m.toUser;
      return (
        m.subject?.toLowerCase().includes(q) ||
        m.body?.toLowerCase().includes(q) ||
        other?.toLowerCase().includes(q)
      );
    });
  }, [folderRows, folder, statusFilter, query]);

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
            {rows.map((m) => {
              const other = folder === 'inbox' ? m.fromUser : m.toUser;
              const hasAttach = (m.attachment_dtu_ids?.length || 0) > 0 || m.attachmentCc > 0 || m.codCc > 0;
              const isUnread = m.status === 'unread';
              const isSelected = selected?.id === m.id;
              return (
                <li key={m.id}>
                  <button
                    onClick={() => setSelected(m)}
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
                        <span className={cn('truncate font-mono', isUnread ? 'text-gray-100' : 'text-gray-400')}>
                          {other?.slice(0, 16) ?? '—'}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-gray-500">
                        {new Date(m.sentAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <div className={cn('mt-0.5 truncate text-[12px]', isUnread ? 'font-semibold text-white' : 'text-gray-300')}>
                      {m.subject}
                    </div>
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
                  From <span className="font-mono text-gray-300">{selected.fromUser}</span> to <span className="font-mono text-gray-300">{selected.toUser}</span>
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
            <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-200">{selected.body}</p>

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
                {folder === 'inbox' && selected.status !== 'claimed' && selected.status !== 'expired' && (
                  <button
                    onClick={() => handleClaim(selected.id)}
                    disabled={busy === `claim-${selected.id}`}
                    className={cn(ds.btnPrimary, 'mt-2 px-3 py-1 text-[11px]')}
                  >
                    Claim {selected.codCc > 0 ? `(pay ${selected.codCc} CC)` : ''}
                  </button>
                )}
                {selected.status === 'claimed' && (
                  <p className="mt-1 text-[10px] italic text-gray-400">
                    Claimed <span className="tabular-nums">{selected.claimedAt ? new Date(selected.claimedAt * 1000).toLocaleString() : ''}</span>
                  </p>
                )}
                {selected.status === 'expired' && <p className="mt-1 text-[10px] italic text-red-400">Expired — attachments returned to sender.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
