'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Send, Paperclip, X } from 'lucide-react';
import { DTUPickerModal } from '@/components/dtu/DTUPickerModal';
import { RecipientSearchInput } from '@/components/message/RecipientSearchInput';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { MAX_ATTACHMENTS, type DTU } from './types';

export function ComposeMailPanel({ onSent }: { onSent: () => void }) {
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeCc, setComposeCc] = useState(0);
  const [composeCod, setComposeCod] = useState(0);
  const [composeAttachments, setComposeAttachments] = useState<DTU[]>([]);
  const [showDtuPicker, setShowDtuPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const to = new URLSearchParams(window.location.search).get('to');
    if (to) setComposeTo(to);
  }, []);

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
        setFlash({ kind: 'ok', msg: 'Mail sent.' });
        setComposeTo(''); setComposeSubject(''); setComposeBody(''); setComposeCc(0); setComposeCod(0);
        setComposeAttachments([]);
        onSent();
      } else {
        setFlash({ kind: 'err', msg: j.error || 'send failed' });
      }
    } finally { setBusy(null); }
  }, [composeTo, composeSubject, composeBody, composeCc, composeCod, composeAttachments, onSent]);

  return (
    <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
      {flash && (
        <div className={cn('mb-3 rounded-md border px-3 py-1.5 text-[11px]', flash.kind === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200')}>
          {flash.msg}
        </div>
      )}
      <form onSubmit={handleSend} className={cn(ds.panelBare, 'p-4')}>
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
