'use client';

/**
 * SubmitWorkPanel — the missing entry point to a real backend capability.
 *
 * `server/domains/vault.js#submit` (macro `vault.submit`) has always been
 * real and complete — it inserts a row into `vault_submissions` with status
 * `'submitted'` for a human curator to later pick up. Nothing on the page
 * ever called it: the page's own copy ("Open submission, closed admission.
 * Anyone may submit their own work...") promised a capability the UI never
 * exposed. This panel is that entry point — deliberately as quiet as the
 * rest of the Vault (`vault.button`, not a garish CTA): a plain label-style
 * toggle, not a banner or a modal.
 *
 * Submission is not admission — this only ever moves a work to `submitted`;
 * whether it is ever admitted is a human curator's call, made elsewhere.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { vault } from '@/lib/vault/tokens';

const WORK_KINDS = ['writing', 'music', 'visual', 'moving_image', 'code', 'performance', 'other'] as const;

function formatWorkKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function SubmitWorkPanel() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [workKind, setWorkKind] = useState<string>('writing');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: true } | { ok: false; reason: string } | null>(null);

  const reset = () => {
    setTitle(''); setDescription(''); setBody(''); setWorkKind('writing'); setResult(null);
  };

  const submit = async () => {
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const r = await lensRun<{ ok: boolean; id?: string; reason?: string }>('vault', 'submit', {
        title: title.trim(),
        workKind,
        description: description.trim(),
        body: body.trim(),
      });
      const res: { ok?: boolean; reason?: string } | null = r.data?.result || null;
      if (r.data?.ok && res?.ok !== false) {
        setResult({ ok: true });
        setTitle(''); setDescription(''); setBody('');
      } else {
        setResult({ ok: false, reason: res?.reason || r.data?.error || 'submit_failed' });
      }
    } catch (e) {
      setResult({ ok: false, reason: e instanceof Error ? e.message : 'network_error' });
    }
    setSubmitting(false);
  };

  return (
    <div className="mt-6" data-testid="vault-submit-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={vault.button}
        aria-expanded={open}
      >
        {open ? 'Close submission form' : 'Submit a work'}
      </button>

      {open && (
        <div className={cn(vault.plate, 'mt-4 max-w-xl')}>
          <p className={cn(vault.caption, 'mb-4')}>
            This records the work for a curator to consider. Submission is not admission — a named human
            curator still has to argue for it in writing before anything is admitted.
          </p>

          {result?.ok ? (
            <p className={cn(vault.body, 'py-2')}>
              Submitted. It now waits for a curator — there is no queue position to check, and admission is
              never guaranteed.
            </p>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className={cn(vault.label, 'mb-1 block')}>Title</span>
                <input
                  className={vault.input}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={300}
                  placeholder="The work's title"
                />
              </label>

              <label className="block">
                <span className={cn(vault.label, 'mb-1 block')}>Kind</span>
                <select
                  className={vault.input}
                  value={workKind}
                  onChange={(e) => setWorkKind(e.target.value)}
                >
                  {WORK_KINDS.map((k) => (
                    <option key={k} value={k}>{formatWorkKind(k)}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={cn(vault.label, 'mb-1 block')}>Description</span>
                <textarea
                  className={cn(vault.input, 'min-h-[80px] resize-y')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={4000}
                  placeholder="What is it, and why does it belong here?"
                />
              </label>

              <label className="block">
                <span className={cn(vault.label, 'mb-1 block')}>The work itself (optional)</span>
                <textarea
                  className={cn(vault.input, 'min-h-[120px] resize-y font-mono text-xs')}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Paste the text, a link, or leave blank if this is better described than pasted"
                />
              </label>

              {result && !result.ok && (
                <p className="text-sm text-red-700" role="alert">
                  Could not submit: {result.reason}
                </p>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={submit}
                  disabled={!title.trim() || submitting}
                  className={vault.buttonAccent}
                >
                  {submitting ? 'Submitting…' : 'Submit for consideration'}
                </button>
                <button type="button" onClick={reset} className={vault.button}>
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SubmitWorkPanel;
