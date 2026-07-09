'use client';

/**
 * ComposePanel — publish a new operator announcement.
 *
 * Surfaces the one macro (`announcements.post`, mirrored 1:1 by
 * `POST /api/announcements`) that had NO frontend caller anywhere in the
 * app before this rebuild — admin-only, so it only renders when
 * `useAuth()` reports `role === 'admin'`. POSTs directly to the REST route
 * (same contract the macro wraps: `{ kind, title, body, expiresAt?,
 * dtuAttachmentId? }`), and surfaces the backend's REAL rejection reasons
 * (`admin_only`, `invalid_kind`, `missing_inputs`, `empty`) instead of a
 * generic "failed" — honest failure, not a fabricated retry-and-it'll-work.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { KIND_META } from './kind-meta';
import { VALID_KINDS, type AnnouncementKind } from './types';

export interface ComposePanelProps {
  onClose: () => void;
  /** Called with the new announcement id once the backend confirms it was published. */
  onPublished: (id: string) => void;
}

const TITLE_MAX = 200;
const BODY_MAX = 8000;

const ERROR_COPY: Record<string, string> = {
  Unauthorized: 'Sign in to publish an announcement.',
  admin_only: "Your account isn't an admin — publishing is admin-only.",
  invalid_kind: 'Pick a valid announcement kind.',
  missing_inputs: 'Title and body are both required.',
  empty: 'Title and body can\'t be blank.',
};

export function ComposePanel({ onClose, onPublished }: ComposePanelProps) {
  const [kind, setKind] = useState<AnnouncementKind>('news');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [expiresIn, setExpiresIn] = useState(''); // datetime-local string, optional
  const [dtuAttachmentId, setDtuAttachmentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        kind,
        title: title.trim().slice(0, TITLE_MAX),
        body: body.trim().slice(0, BODY_MAX),
      };
      if (expiresIn) {
        const ts = Math.floor(new Date(expiresIn).getTime() / 1000);
        if (Number.isFinite(ts)) payload.expiresAt = ts;
      }
      if (dtuAttachmentId.trim()) payload.dtuAttachmentId = dtuAttachmentId.trim();

      const res = await fetch('/api/announcements', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        const reason = data?.error || data?.reason || `HTTP ${res.status}`;
        setError(ERROR_COPY[reason] || reason);
        setSubmitting(false);
        return;
      }
      onPublished(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — the request never reached the server.');
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-announcement-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-10 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-violet-500/30 bg-zinc-950 p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="compose-announcement-title" className="text-sm font-semibold text-slate-100">Publish announcement</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={ds.btnGhost}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Announcement kind">
            {VALID_KINDS.map((k) => {
              const meta = KIND_META[k];
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKind(k)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    active ? `${meta.ring} ${meta.color}` : 'border-white/10 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>

          <div>
            <label htmlFor="ann-title" className={ds.label}>Title</label>
            <input
              id="ann-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              required
              placeholder="What shipped?"
              className={ds.input}
            />
          </div>

          <div>
            <label htmlFor="ann-body" className={ds.label}>Body (markdown)</label>
            <textarea
              id="ann-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={BODY_MAX}
              required
              rows={5}
              placeholder="Details, links, context…"
              className={ds.textarea}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ann-expires" className={ds.label}>Expires (optional)</label>
              <input
                id="ann-expires"
                type="datetime-local"
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value)}
                className={ds.input}
              />
            </div>
            <div>
              <label htmlFor="ann-dtu" className={ds.label}>DTU attachment id (optional)</label>
              <input
                id="ann-dtu"
                value={dtuAttachmentId}
                onChange={(e) => setDtuAttachmentId(e.target.value)}
                placeholder="dtu_…"
                className={ds.input}
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={ds.btnGhost}>Cancel</button>
          <button type="submit" disabled={!canSubmit} className={`${ds.btnPrimary} px-4 py-2 text-sm`}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {submitting ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </form>
    </div>
  );
}
