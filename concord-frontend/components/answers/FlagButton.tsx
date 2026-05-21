'use client';

/**
 * FlagButton — lets a user (25+ rep) raise a quality flag on a question
 * or answer with a reason and optional note. Wires answers.flag.
 */

import { useState } from 'react';
import { Flag, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const REASONS = ['spam', 'rude or abusive', 'low quality', 'not an answer', 'needs improvement'];

interface FlagButtonProps {
  questionId: string;
  answerId?: string;
  onFlagged?: () => void;
}

export function FlagButton({ questionId, answerId, onFlagged }: FlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit() {
    setBusy(true);
    setMsg('');
    const r = await lensRun('answers', 'flag', { questionId, answerId, reason, note });
    setBusy(false);
    if (r.data?.ok) {
      setMsg('Flag raised — sent to the moderation queue.');
      setNote('');
      onFlagged?.();
      setTimeout(() => { setOpen(false); setMsg(''); }, 1400);
    } else {
      setMsg(r.data?.error || 'Could not raise flag.');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[10px] text-zinc-600 hover:text-rose-400 inline-flex items-center gap-0.5"
      >
        <Flag className="w-2.5 h-2.5" />Flag
      </button>
    );
  }

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60 p-2 mt-1 space-y-1.5 w-full max-w-xs">
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200"
      >
        {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note for moderators"
        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200"
      />
      {msg && <p className="text-[10px] text-zinc-400">{msg}</p>}
      <div className="flex gap-1">
        <button
          onClick={submit}
          disabled={busy}
          className="px-2 py-1 text-[10px] rounded bg-rose-700 hover:bg-rose-600 text-white inline-flex items-center gap-1 disabled:opacity-40"
        >
          {busy && <Loader2 className="w-2.5 h-2.5 animate-spin" />}Submit flag
        </button>
        <button
          onClick={() => { setOpen(false); setMsg(''); }}
          className="px-2 py-1 text-[10px] rounded text-zinc-400 hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
