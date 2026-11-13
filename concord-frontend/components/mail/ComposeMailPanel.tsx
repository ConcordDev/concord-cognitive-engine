'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Send, Paperclip, X } from 'lucide-react';
import { DTUPickerModal } from '@/components/dtu/DTUPickerModal';
import { RecipientSearchInput } from '@/components/message/RecipientSearchInput';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { playerMail, sendFailureText } from './playerMail';
import { MAX_ATTACHMENTS, type ComposeSeed, type DTU } from './types';

// FIX-mail-017: the server refuses amounts outside 0..1,000,000 CC
// (badNumericField in server/domains/mail.js). The fields hold the
// typed text and parse only at send, so keystrokes are never silently
// rewritten ('-1' used to become '01', letters became 0).
const MAX_CC = 1_000_000;
function parseAmount(text: string): number | null {
  const t = text.trim();
  if (t === '') return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > MAX_CC) return null;
  return Math.round(n * 100) / 100;
}

export function ComposeMailPanel({ onSent, seed }: { onSent: () => void; seed?: ComposeSeed | null }) {
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeCcText, setComposeCcText] = useState('');
  const [composeCodText, setComposeCodText] = useState('');
  const [amountError, setAmountError] = useState<string | null>(null);
  // FIX-mail-010: the server refuses self-mail ('cannot mail self'),
  // but the composer only found out from a red banner AFTER Send.
  // Learn the signed-in id up front so the refusal is explained at
  // the recipient field, before Send is ever pressed.
  const [myId, setMyId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.get('/api/auth/me')
      .then((res) => {
        const id = (res.data as { user?: { id?: string } } | undefined)?.user?.id;
        if (!cancelled && id) setMyId(String(id));
      })
      .catch(() => { /* fail-soft: the server refusal stays the backstop */ });
    return () => { cancelled = true; };
  }, []);
  const isSelfRecipient = !!myId && composeTo.trim() === myId;
  const [composeAttachments, setComposeAttachments] = useState<DTU[]>([]);
  const [showDtuPicker, setShowDtuPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  // FIX-mail-016: when this compose is a reply, the id of the mail it
  // answers — the send carries it and the mail threads under the original.
  const [parentId, setParentId] = useState<string | null>(null);

  // FIX-mail-002: compose autosaves as a draft (Gmail-style) — a reload
  // restores the in-progress mail instead of emptying the form.
  const draftHydrated = useRef(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const to = new URLSearchParams(window.location.search).get('to');
    if (to) setComposeTo(to);
  }, []);

  // FIX-mail-016: a reply/forward seed (handed over by the folder panel)
  // wins over the autosaved draft for this mount — the draft stays saved
  // for a later plain compose.
  useEffect(() => {
    if (!seed) return;
    if (seed.toUserId) setComposeTo(seed.toUserId);
    setComposeSubject(seed.subject);
    setComposeBody(seed.body);
    setParentId(seed.parentId ?? null);
  }, [seed]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const j = await playerMail('draft-get');
      if (cancelled || seed) { draftHydrated.current = true; return; }
      const d = j.ok ? j.draft : null;
      if (d) {
        const urlTo = typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('to') : null;
        // Draft restore must never clobber typing already in progress
        // (FIX-mail-007): the get resolves async, and a stale draft
        // landing mid-keystroke scrambles the field. Only fill fields
        // that are still empty when it arrives.
        if (!urlTo && d.toUserId) setComposeTo((prev) => prev || d.toUserId);
        if (d.subject) setComposeSubject((prev) => prev || d.subject);
        if (d.body) setComposeBody((prev) => prev || d.body);
        if (d.attachmentCc) setComposeCcText((prev) => prev || String(d.attachmentCc));
        if (d.codCc) setComposeCodText((prev) => prev || String(d.codCc));
        if (d.parentId) setParentId((prev) => prev || d.parentId);
        if (d.attachmentDtuIds?.length) {
          setComposeAttachments(d.attachmentDtuIds.map((id) => ({
            id, title: d.attachmentTitles?.[id] || id,
          }) as unknown as DTU));
        }
        setFlash({ kind: 'ok', msg: 'Draft restored — autosave is on.' });
      }
      draftHydrated.current = true;
    })();
    return () => { cancelled = true; };
  }, [seed]);

  useEffect(() => {
    if (!draftHydrated.current) return;
    const t = setTimeout(async () => {
      const j = await playerMail('draft-save', {
        toUserId: composeTo,
        subject: composeSubject,
        body: composeBody,
        attachmentCc: parseAmount(composeCcText) ?? 0,
        codCc: parseAmount(composeCodText) ?? 0,
        attachmentDtuIds: composeAttachments.map((d) => d.id),
        attachmentTitles: Object.fromEntries(composeAttachments.map((d) => [d.id, d.title || d.id])),
        parentId: parentId || '',
      });
      if (j.ok) setDraftSavedAt(Date.now());
    }, 800);
    return () => clearTimeout(t);
  }, [composeTo, composeSubject, composeBody, composeCcText, composeCodText, composeAttachments, parentId]);

  const handleAttachDtu = useCallback((dtu: DTU) => {
    setComposeAttachments((prev) => {
      if (prev.some((d) => d.id === dtu.id) || prev.length >= MAX_ATTACHMENTS) return prev;
      return [...prev, dtu];
    });
  }, []);

  const handleRemoveAttachment = useCallback((dtuId: string) => {
    setComposeAttachments((prev) => prev.filter((d) => d.id !== dtuId));
  }, []);

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('send');
    try {
      const recipient = composeTo.trim();
      if (!recipient || /[\s,]/.test(recipient) || (recipient.includes('@') && !/^[^\s@]+@[^\s@]+$/.test(recipient))) {
        setRecipientError('Pick a recipient who has a Concord account. A typed address is not sent until it matches one.');
        setBusy(null);
        return;
      }
      const gift = parseAmount(composeCcText);
      if (gift === null) {
        setAmountError('Gift amount must be a number from 0 to 1,000,000 CC.');
        setBusy(null);
        return;
      }
      const cod = parseAmount(composeCodText);
      if (cod === null) {
        setAmountError('COD amount must be a number from 0 to 1,000,000 CC.');
        setBusy(null);
        return;
      }
      setAmountError(null);
      setRecipientError(null);
      const j = await playerMail('send', {
        toUserId: composeTo.trim(),
        subject: composeSubject.trim(),
        body: composeBody,
        attachmentCc: gift,
        codCc: cod,
        attachmentDtuIds: composeAttachments.map((d) => d.id),
        ...(parentId ? { parentId } : {}),
      });
      if (j.ok && j.id) {
        setFlash({ kind: 'ok', msg: `Mail sent. ${j.id}` });
        setComposeTo(''); setComposeSubject(''); setComposeBody(''); setComposeCcText(''); setComposeCodText('');
        setComposeAttachments([]);
        setParentId(null);
        onSent();
      } else {
        const msg = sendFailureText(j.ok ? undefined : j.error);
        setRecipientError(msg);
        setFlash({ kind: 'err', msg });
      }
    } finally { setBusy(null); }
  }, [composeTo, composeSubject, composeBody, composeCcText, composeCodText, composeAttachments, parentId, onSent]);

  return (
    <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
      {flash && (
        <div className={cn('mb-3 rounded-md border px-3 py-1.5 text-[11px]', flash.kind === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200')}>
          {flash.msg}
        </div>
      )}
      <form onSubmit={handleSend} className={cn(ds.panelBare, 'p-4')}>
        <h2 className="mb-3 text-sm font-semibold text-white">Compose mail</h2>
        {parentId && (
          <p className="mb-2 text-[11px] text-gray-400" role="status">
            This is a reply — it will thread under the original mail in both inboxes.
          </p>
        )}
        <label className="mb-2 block">
          <span className={ds.overline}>Recipient</span>
          <div className="mt-1">
            <RecipientSearchInput
              value={composeTo}
              onChange={setComposeTo}
              inputId="mail-compose-recipient"
            />
            {recipientError && <p className="mt-1 text-[11px] text-rose-300" role="alert">{recipientError}</p>}
            {isSelfRecipient && (
              <p className="mt-1 text-[11px] text-amber-300" role="note">
                That&rsquo;s you — player mail can&rsquo;t be sent to yourself, so Send stays off until you pick someone else.
              </p>
            )}
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
          <span className="mt-0.5 block text-right text-[10px] text-gray-500">{composeSubject.length}/120</span>
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
              type="text" inputMode="decimal" placeholder="0"
              value={composeCcText}
              onChange={(e) => setComposeCcText(e.target.value)}
              className="mt-1 block w-full rounded-md border border-lattice-border bg-lattice-void/60 px-2 py-1 text-[12px] tabular-nums text-gray-100 outline-none transition-colors focus:border-neon-blue"
            />
          </label>
          <label className="block">
            <span className={ds.overline}>COD (recipient pays)</span>
            <input
              type="text" inputMode="decimal" placeholder="0"
              value={composeCodText}
              onChange={(e) => setComposeCodText(e.target.value)}
              className="mt-1 block w-full rounded-md border border-lattice-border bg-lattice-void/60 px-2 py-1 text-[12px] tabular-nums text-gray-100 outline-none transition-colors focus:border-neon-blue"
            />
          </label>
          <p className="col-span-2 text-[10px] text-gray-500">Amounts are CC from 0 to 1,000,000 — the server refuses more.</p>
          {amountError && <p className="col-span-2 text-[11px] text-rose-300" role="alert">{amountError}</p>}
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
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!composeTo.trim() || !composeSubject.trim() || busy === 'send' || isSelfRecipient}
            className={cn(ds.btnPrimary, 'px-3 py-1.5 text-[12px]')}
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </button>
          <span className="text-[10px] text-gray-500" role="status">
            {draftSavedAt
              ? `Draft saved ${new Date(draftSavedAt).toLocaleTimeString()} — it survives a reload.`
              : 'Drafts autosave as you type.'}
          </span>
        </div>
      </form>

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
    </section>
  );
}
