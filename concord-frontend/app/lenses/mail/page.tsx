'use client';

/**
 * Mail — one WoW-style inbox app.
 *
 * Single active union (inbox | sent | compose). REST mail routes preserved
 * in folder + compose panels (list/send/read/claim).
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Mail, Send, Inbox, Pencil } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { MailFolderPanel } from '@/components/mail/MailFolderPanel';
import { ComposeMailPanel } from '@/components/mail/ComposeMailPanel';
import type { MailTab } from '@/components/mail/types';

const VIEWS: { id: MailTab; label: string; keys: string; icon: typeof Inbox }[] = [
  { id: 'inbox', label: 'inbox', keys: '1', icon: Inbox },
  { id: 'sent', label: 'sent', keys: '2', icon: Send },
  { id: 'compose', label: 'compose', keys: '3', icon: Pencil },
];

export default function MailLensPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<MailTab>('inbox');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const to = new URLSearchParams(window.location.search).get('to');
    if (to) setActive('compose');
  }, []);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `mail-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'mail' },
  );

  return (
    <LensShell lensId="mail" asMain={false}>
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
          </div>
          <div className="mx-auto mt-2 flex max-w-screen-2xl gap-1" role="tablist" aria-label="Mail folders">
            {VIEWS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active === t.id}
                  onClick={() => setActive(t.id)}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-3 py-1 text-[11px] font-medium capitalize transition-colors',
                    active === t.id
                      ? 'border-neon-blue/50 bg-neon-blue/15 text-neon-blue'
                      : 'border-lattice-border bg-lattice-elevated/60 text-gray-400 hover:bg-lattice-elevated hover:text-gray-200',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            {active === 'compose' ? (
              <ComposeMailPanel onSent={() => setActive('sent')} />
            ) : (
              <MailFolderPanel folder={active} onCompose={() => setActive('compose')} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </LensShell>
  );
}
