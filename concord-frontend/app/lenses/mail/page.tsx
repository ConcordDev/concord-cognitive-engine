'use client';

/**
 * /lenses/mail — WoW-style async mail.
 *
 * Inbox / Sent / Compose tabs. Each inbox row shows sender + subject +
 * attachment chips (CC / DTU / COD). Claim button reveals attachments.
 * Compose targets a user-id; the friends panel deep-links here with a
 * pre-filled recipient.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Mail, Send, Inbox, Pencil, Coins, Package, RefreshCcw, X, Check, AlertCircle, Paperclip, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { subscribe } from '@/lib/realtime/socket';
import { DTUPickerModal } from '@/components/dtu/DTUPickerModal';
import { RecipientSearchInput } from '@/components/message/RecipientSearchInput';
import { Skeleton, EmptyState, ErrorState } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import type { DTU } from '@/lib/api/generated-types';

// Mirrors server/lib/player-mail.js MAX_ATTACHMENTS — client-side cap is a
// UX guard only; the server slices to the same limit and is the real gate.
const MAX_ATTACHMENTS = 12;

const STATUS_FILTERS = ['all', 'unread', 'read', 'claimed', 'expired'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

interface MailRow {
  id: string;
  fromUser?: string;
  toUser?: string;
  worldId?: string | null;
  subject: string;
  body: string;
  status: 'unread' | 'read' | 'claimed' | 'expired';
  sentAt: number;
  readAt?: number;
  claimedAt?: number;
  expiresAt: number;
  attachment_dtu_ids: string[];
  attachmentCc: number;
  codCc: number;
}

type Tab = 'inbox' | 'sent' | 'compose';

export default function MailLensPage() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [inbox, setInbox] = useState<MailRow[]>([]);
  const [sent, setSent] = useState<MailRow[]>([]);
  const [selected, setSelected] = useState<MailRow | null>(null);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeCc, setComposeCc] = useState(0);
  const [composeCod, setComposeCod] = useState(0);
  const [composeAttachments, setComposeAttachments] = useState<DTU[]>([]);
  const [showDtuPicker, setShowDtuPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');

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

  // Read-on-select.
  useEffect(() => {
    if (!selected || selected.status !== 'unread') return;
    fetch(`/api/mail/${selected.id}/read`, { method: 'POST', credentials: 'include' })
      .then(() => refresh());
  }, [selected, refresh]);

  // Realtime — new mail arrival.
  useEffect(() => {
    const off = subscribe('mail:received', () => refresh());
    return () => off?.();
  }, [refresh]);

  // Auto-prefill compose from query param.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const to = params.get('to');
    if (to) {
      setComposeTo(to);
      setTab('compose');
    }
  }, []);

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

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('send');
    try {
      const r = await fetch('/api/mail/send', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          toUserId: composeTo.trim(),
          subject: composeSubject.trim(),
          body: composeBody,
          attachmentCc: composeCc,
          codCc: composeCod,
          attachmentDtuIds: composeAttachments.map((d) => d.id),
        }),
      });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', 'Mail sent.');
        setComposeTo(''); setComposeSubject(''); setComposeBody(''); setComposeCc(0); setComposeCod(0);
        setComposeAttachments([]);
        setTab('sent');
        refresh();
      } else {
        showFlash('err', j.error || 'send failed');
      }
    } finally { setBusy(null); }
  }, [composeTo, composeSubject, composeBody, composeCc, composeCod, composeAttachments, refresh, showFlash]);

  const handleAttachDtu = useCallback((dtu: DTU) => {
    setComposeAttachments((prev) => {
      if (prev.some((d) => d.id === dtu.id) || prev.length >= MAX_ATTACHMENTS) return prev;
      return [...prev, dtu];
    });
  }, []);

  const handleRemoveAttachment = useCallback((dtuId: string) => {
    setComposeAttachments((prev) => prev.filter((d) => d.id !== dtuId));
  }, []);

  const folderRows = tab === 'sent' ? sent : inbox;
  const rows = useMemo(() => {
    let base = folderRows;
    if (tab === 'inbox' && statusFilter !== 'all') {
      base = base.filter((m) => m.status === statusFilter);
    }
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((m) => {
      const other = tab === 'inbox' ? m.fromUser : m.toUser;
      return (
        m.subject?.toLowerCase().includes(q) ||
        m.body?.toLowerCase().includes(q) ||
        other?.toLowerCase().includes(q)
      );
    });
  }, [folderRows, tab, statusFilter, query]);
  const unreadCount = useMemo(() => inbox.filter((m) => m.status === 'unread').length, [inbox]);

  return (
    <LensShell lensId="mail" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-lattice-void text-gray-100">
        <header className="border-b border-lattice-border bg-lattice-surface/70 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-neon-blue/30 bg-neon-blue/10 p-2">
              <Mail className="h-5 w-5 text-neon-blue" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight text-white sm:text-lg">Mail</h1>
              <p className="mt-0.5 hidden truncate text-xs text-gray-400 sm:block">
                Async player-to-player mail with attachments and COD.
              </p>
            </div>
            <button
              onClick={refresh}
              aria-label="Refresh mail"
              className={cn(
                'rounded-full border border-lattice-border bg-lattice-elevated p-1.5 text-gray-300 transition-colors hover:border-neon-blue/40 hover:text-neon-blue',
                ds.focusRing,
              )}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mx-auto mt-2 flex max-w-screen-2xl gap-1" role="tablist" aria-label="Mail folders">
            {(['inbox', 'sent', 'compose'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex items-center gap-1 rounded-md border px-3 py-1 text-[11px] font-medium capitalize transition-colors',
                  tab === t
                    ? 'border-neon-blue/50 bg-neon-blue/15 text-neon-blue'
                    : 'border-lattice-border bg-lattice-elevated/60 text-gray-400 hover:bg-lattice-elevated hover:text-gray-200',
                )}
              >
                {t === 'inbox' && <Inbox className="h-3 w-3" />}
                {t === 'sent' && <Send className="h-3 w-3" />}
                {t === 'compose' && <Pencil className="h-3 w-3" />}
                {t}
                {t === 'inbox' && unreadCount > 0 && (
                  <span className="ml-1 rounded-full bg-neon-blue/20 px-1.5 text-[10px] tabular-nums text-neon-blue">{unreadCount}</span>
                )}
              </button>
            ))}
          </div>
          {flash && (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                'mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md border px-3 py-1.5 text-[11px]',
                flash.kind === 'ok'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-red-500/30 bg-red-500/10 text-red-200',
              )}
            >
              {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {flash.msg}
            </div>
          )}
        </header>

        <section className="mx-auto grid max-w-screen-2xl gap-3 px-3 py-4 sm:grid-cols-[1fr_2fr] sm:px-6 sm:py-5">
          {tab !== 'compose' ? (
            <>
              {/* Mail list */}
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
                  {tab === 'inbox' && (
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
                    title={folderRows.length > 0 ? 'No matches' : tab === 'inbox' ? 'No mail yet' : 'Nothing sent yet'}
                    description={
                      folderRows.length > 0
                        ? 'No mail matches this filter or search.'
                        : tab === 'inbox'
                          ? 'Friends can send you mail from the friends panel.'
                          : 'Mail you send will appear here.'
                    }
                    action={
                      folderRows.length > 0
                        ? { label: 'Clear filters', onClick: () => { setQuery(''); setStatusFilter('all'); } }
                        : tab === 'inbox'
                          ? undefined
                          : { label: 'Compose mail', onClick: () => setTab('compose') }
                    }
                    className="m-1"
                  />
                )}
                {!loading && !loadError && rows.length > 0 && (
                  <ul className="space-y-0.5">
                    {rows.map((m) => {
                      const other = tab === 'inbox' ? m.fromUser : m.toUser;
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

              {/* Detail */}
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

                    {/* Attachments */}
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
                        {tab === 'inbox' && selected.status !== 'claimed' && selected.status !== 'expired' && (
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
            </>
          ) : (
            /* Compose tab */
            <form onSubmit={handleSend} className={cn(ds.panelBare, 'sm:col-span-2 p-4')}>
              <h2 className="mb-3 text-sm font-semibold text-white">Compose mail</h2>
              <label className="mb-2 block">
                <span className={ds.overline}>Recipient</span>
                <div className="mt-1">
                  <RecipientSearchInput
                    value={composeTo}
                    onChange={setComposeTo}
                    inputId="mail-compose-recipient"
                  />
                </div>
              </label>
              <label className="mb-2 block">
                <span className={ds.overline}>Subject</span>
                <input
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  required
                  maxLength={120}
                  className="mt-1 block w-full rounded-md border border-lattice-border bg-lattice-void/60 px-2 py-1 text-[12px] text-gray-100 outline-none transition-colors focus:border-neon-blue"
                />
              </label>
              <label className="mb-2 block">
                <span className={ds.overline}>Message</span>
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  rows={6}
                  maxLength={4000}
                  className="mt-1 block w-full resize-none rounded-md border border-lattice-border bg-lattice-void/60 px-2 py-1 text-[12px] text-gray-100 outline-none transition-colors focus:border-neon-blue"
                />
              </label>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className={ds.overline}>Send CC (gift)</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={composeCc}
                    onChange={(e) => setComposeCc(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 block w-full rounded-md border border-lattice-border bg-lattice-void/60 px-2 py-1 text-[12px] tabular-nums text-gray-100 outline-none transition-colors focus:border-neon-blue"
                  />
                </label>
                <label className="block">
                  <span className={ds.overline}>COD (recipient pays)</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={composeCod}
                    onChange={(e) => setComposeCod(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-1 block w-full rounded-md border border-lattice-border bg-lattice-void/60 px-2 py-1 text-[12px] tabular-nums text-gray-100 outline-none transition-colors focus:border-neon-blue"
                  />
                </label>
              </div>
              <div className="mb-3">
                <div className="flex items-center justify-between">
                  <span className={ds.overline}>DTU attachments</span>
                  <button
                    type="button"
                    onClick={() => setShowDtuPicker(true)}
                    disabled={composeAttachments.length >= MAX_ATTACHMENTS}
                    className="flex items-center gap-1 rounded-md border border-neon-blue/40 bg-neon-blue/10 px-2 py-0.5 text-[10px] text-neon-blue transition-colors hover:bg-neon-blue/20 disabled:opacity-40"
                  >
                    <Paperclip className="h-3 w-3" /> Attach from my DTUs
                  </button>
                </div>
                {composeAttachments.length === 0 ? (
                  <p className="mt-1 text-[10px] text-gray-500">No DTUs attached. Only DTUs you own can be attached — ownership transfers to the recipient on claim.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {composeAttachments.map((d) => (
                      <li key={d.id} className="flex items-center justify-between rounded-md border border-lattice-border bg-lattice-void/50 px-2 py-1 text-[11px]">
                        <span className="truncate text-neon-cyan">{d.title || d.id}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(d.id)}
                          aria-label={`Remove attachment ${d.title || d.id}`}
                          className="ml-2 shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-lattice-elevated hover:text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {composeAttachments.length >= MAX_ATTACHMENTS && (
                  <p className="mt-1 text-[10px] text-amber-400">Max <span className="tabular-nums">{MAX_ATTACHMENTS}</span> attachments reached.</p>
                )}
              </div>
              <button
                type="submit"
                disabled={!composeTo.trim() || !composeSubject.trim() || busy === 'send'}
                className={cn(ds.btnPrimary, 'px-3 py-1.5 text-[12px]')}
              >
                <Send className="h-3.5 w-3.5" />
                Send
              </button>
            </form>
          )}
        </section>

        <AnimatePresence>
          {showDtuPicker && (
            <DTUPickerModal
              lens="mail"
              title="Attach a DTU (transfers ownership on claim)"
              filter="user"
              onClose={() => setShowDtuPicker(false)}
              onSelect={handleAttachDtu}
            />
          )}
        </AnimatePresence>
      </main>
    </LensShell>
  );
}
