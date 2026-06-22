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
import { Mail, Send, Inbox, Pencil, Coins, Package, RefreshCcw, X, Check, AlertCircle } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

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
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const showFlash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setFlash({ kind, msg });
    setTimeout(() => setFlash(null), 3000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [i, s] = await Promise.all([
        fetch('/api/mail/inbox', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        fetch('/api/mail/sent', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      ]);
      if (i?.ok) setInbox(i.mail || []);
      if (s?.ok) setSent(s.mail || []);
    } catch { /* network blip */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Read-on-select.
  useEffect(() => {
    if (!selected || selected.status !== 'unread') return;
    fetch(`/api/mail/${selected.id}/read`, { method: 'POST', credentials: 'include' })
      .then(() => refresh());
  }, [selected, refresh]);

  // Realtime — new mail arrival.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => refresh();
    window.addEventListener('mail:received', handler);
    return () => window.removeEventListener('mail:received', handler);
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
        showFlash('ok', `Claimed: ${j.payout?.attachmentCc || 0} CC + ${j.attachments?.dtuIds?.length || 0} DTUs.`);
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
        }),
      });
      const j = await r.json();
      if (j.ok) {
        showFlash('ok', 'Mail sent.');
        setComposeTo(''); setComposeSubject(''); setComposeBody(''); setComposeCc(0); setComposeCod(0);
        setTab('sent');
        refresh();
      } else {
        showFlash('err', j.error || 'send failed');
      }
    } finally { setBusy(null); }
  }, [composeTo, composeSubject, composeBody, composeCc, composeCod, refresh, showFlash]);

  const rows = tab === 'sent' ? sent : inbox;
  const unreadCount = useMemo(() => inbox.filter((m) => m.status === 'unread').length, [inbox]);

  return (
    <LensShell lensId="mail" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-fuchsia-950/10 text-slate-100">
        <header className="border-b border-fuchsia-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 p-2">
              <Mail className="h-5 w-5 text-fuchsia-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Mail</h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                Async player-to-player mail with attachments and COD.
              </p>
            </div>
            <button
              onClick={refresh}
              aria-label="Refresh mail"
              className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 p-1.5 text-fuchsia-300 hover:bg-fuchsia-500/20"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mx-auto mt-2 flex max-w-screen-2xl gap-1">
            {(['inbox', 'sent', 'compose'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-1 rounded-md border px-3 py-1 text-[11px] font-medium capitalize ${tab === t ? 'border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100' : 'border-slate-700 bg-slate-800/40 text-slate-300 hover:bg-slate-700/40'}`}
              >
                {t === 'inbox' && <Inbox className="h-3 w-3" />}
                {t === 'sent' && <Send className="h-3 w-3" />}
                {t === 'compose' && <Pencil className="h-3 w-3" />}
                {t}
                {t === 'inbox' && unreadCount > 0 && (
                  <span className="ml-1 rounded-full bg-amber-500/30 px-1.5 text-[10px] text-amber-200">{unreadCount}</span>
                )}
              </button>
            ))}
          </div>
          {flash && (
            <div className={`mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md px-3 py-1.5 text-[11px] ${flash.kind === 'ok' ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
              {flash.kind === 'ok' ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {flash.msg}
            </div>
          )}
        </header>

        <section className="mx-auto grid max-w-screen-2xl gap-3 px-3 py-4 sm:grid-cols-[1fr_2fr] sm:px-6 sm:py-5">
          {tab !== 'compose' ? (
            <>
              {/* Mail list */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-2">
                {rows.length === 0 && (
                  <p className="px-2 py-4 text-center text-[11px] text-slate-500">
                    {tab === 'inbox' ? 'No mail. Friends can send you mail from the friends panel.' : 'Nothing sent yet.'}
                  </p>
                )}
                <ul className="space-y-1">
                  {rows.map((m) => {
                    const other = tab === 'inbox' ? m.fromUser : m.toUser;
                    const hasAttach = (m.attachment_dtu_ids?.length || 0) > 0 || m.attachmentCc > 0 || m.codCc > 0;
                    const isUnread = m.status === 'unread';
                    return (
                      <li key={m.id}>
                        <button
                          onClick={() => setSelected(m)}
                          className={`w-full rounded-md border px-2 py-1.5 text-left transition ${selected?.id === m.id ? 'border-fuchsia-400/60 bg-fuchsia-500/10' : isUnread ? 'border-amber-500/30 bg-amber-500/5' : 'border-slate-700 bg-slate-900/30 hover:bg-slate-800/40'}`}
                        >
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="truncate font-mono text-slate-300">{other?.slice(0, 12) ?? '—'}</span>
                            <span className="text-slate-500">{new Date(m.sentAt * 1000).toLocaleDateString()}</span>
                          </div>
                          <div className={`mt-0.5 truncate text-[12px] ${isUnread ? 'font-semibold text-amber-100' : 'text-slate-100'}`}>
                            {m.subject}
                          </div>
                          {hasAttach && (
                            <div className="mt-1 flex gap-1 text-[10px]">
                              {m.attachmentCc > 0 && <span className="rounded bg-yellow-500/20 px-1 text-yellow-200"><Coins className="inline h-2.5 w-2.5" /> {m.attachmentCc}</span>}
                              {(m.attachment_dtu_ids?.length || 0) > 0 && <span className="rounded bg-cyan-500/20 px-1 text-cyan-200"><Package className="inline h-2.5 w-2.5" /> {m.attachment_dtu_ids.length}</span>}
                              {m.codCc > 0 && <span className="rounded bg-rose-500/20 px-1 text-rose-200">COD {m.codCc}</span>}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* Detail */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                {!selected ? (
                  <p className="text-[11px] text-slate-500">Select a piece of mail.</p>
                ) : (
                  <div>
                    <header className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-slate-100">{selected.subject}</h2>
                        <p className="mt-1 text-[10px] text-slate-400">
                          From <span className="font-mono">{selected.fromUser}</span> to <span className="font-mono">{selected.toUser}</span> · {new Date(selected.sentAt * 1000).toLocaleString()}
                        </p>
                      </div>
                      <button
                        onClick={() => setSelected(null)}
                        aria-label="Close mail"
                        className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </header>
                    <p className="whitespace-pre-wrap text-[12px] text-slate-200">{selected.body}</p>

                    {/* Attachments */}
                    {(selected.attachmentCc > 0 || selected.attachment_dtu_ids?.length > 0 || selected.codCc > 0) && (
                      <div className="mt-4 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/5 p-2 text-[11px]">
                        <h3 className="mb-1 font-semibold text-fuchsia-200">Attachments</h3>
                        {selected.attachmentCc > 0 && <p className="text-yellow-200">{selected.attachmentCc} CC</p>}
                        {selected.attachment_dtu_ids?.length > 0 && (
                          <p className="text-cyan-200">{selected.attachment_dtu_ids.length} DTU(s): {selected.attachment_dtu_ids.slice(0, 3).join(', ')}</p>
                        )}
                        {selected.codCc > 0 && <p className="text-rose-200">COD due on claim: {selected.codCc} CC</p>}
                        {tab === 'inbox' && selected.status !== 'claimed' && selected.status !== 'expired' && (
                          <button
                            onClick={() => handleClaim(selected.id)}
                            disabled={busy === `claim-${selected.id}`}
                            className="mt-2 rounded bg-fuchsia-500/30 px-3 py-1 text-[11px] text-fuchsia-100 hover:bg-fuchsia-500/40 disabled:opacity-40"
                          >
                            Claim {selected.codCc > 0 ? `(pay ${selected.codCc} CC)` : ''}
                          </button>
                        )}
                        {selected.status === 'claimed' && <p className="mt-1 text-[10px] italic text-slate-400">Claimed {selected.claimedAt ? new Date(selected.claimedAt * 1000).toLocaleString() : ''}</p>}
                        {selected.status === 'expired' && <p className="mt-1 text-[10px] italic text-rose-400">Expired — attachments returned to sender.</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Compose tab */
            <form onSubmit={handleSend} className="sm:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-100">Compose mail</h2>
              <label className="mb-2 block">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Recipient user id</span>
                <input
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="user-id"
                  required
                  className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-cyan-500/50 focus:outline-none"
                />
              </label>
              <label className="mb-2 block">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Subject</span>
                <input
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  required
                  maxLength={120}
                  className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-cyan-500/50 focus:outline-none"
                />
              </label>
              <label className="mb-2 block">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">Message</span>
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  rows={6}
                  maxLength={4000}
                  className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-cyan-500/50 focus:outline-none"
                />
              </label>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400">Send CC (gift)</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={composeCc}
                    onChange={(e) => setComposeCc(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-cyan-500/50 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400">COD (recipient pays)</span>
                  <input
                    type="number" min={0} step={0.01}
                    value={composeCod}
                    onChange={(e) => setComposeCod(Math.max(0, Number(e.target.value) || 0))}
                    className="mt-0.5 block w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[12px] text-slate-100 focus:border-cyan-500/50 focus:outline-none"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={!composeTo.trim() || !composeSubject.trim() || busy === 'send'}
                className="flex items-center gap-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/20 px-3 py-1.5 text-[12px] text-fuchsia-100 hover:bg-fuchsia-500/30 disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" />
                Send
              </button>
            </form>
          )}
        </section>
      </main>
    </LensShell>
  );
}
