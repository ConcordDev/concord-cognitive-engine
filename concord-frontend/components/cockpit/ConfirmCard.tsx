'use client';
import { useState } from 'react';
import type { ConfirmCardData } from '@/lib/cockpit/run-client';

interface Props {
  card: ConfirmCardData;
  busy: boolean;
  onApprove: (edited?: Record<string, unknown>, dontAskAgain?: boolean) => void;
  onReject: () => void;
  onAnswer: (text: string) => void;
  onMaybeDone?: (happened: boolean) => void;
}

export function ConfirmCard({ card, busy, onApprove, onReject, onAnswer, onMaybeDone }: Props) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(card.args.map((a) => [a.name, a.value])));
  const [dontAsk, setDontAsk] = useState(false);
  const [text, setText] = useState('');

  const approve = () => {
    if (!editing) { onApprove(undefined, dontAsk); return; }
    const edited: Record<string, unknown> = {};
    for (const a of card.args) if (values[a.name] !== a.value) edited[a.name] = values[a.name];
    onApprove(Object.keys(edited).length ? edited : undefined, dontAsk);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (busy) return;
    if (e.key === 'Escape') setEditing(false);
    if (e.key === 'Enter' && !e.shiftKey && card.kind === 'confirm' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); approve(); }
  };

  if (card.kind === 'question' || card.kind === 'help') {
    const send = () => { if (text.trim()) onAnswer(text.trim()); };
    return (
      <div role="group" aria-label={card.label} className="mt-2 rounded border border-lattice-border p-2 text-sm">
        <p className="font-medium">{card.label}</p>
        {card.goal && <p className="text-xs opacity-70">{card.goal}</p>}
        <div className="mt-2 flex gap-2">
          <input
            aria-label="Your answer" value={text} disabled={busy} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
            className="flex-1 rounded border border-lattice-border bg-transparent px-2 py-1"
          />
          <button type="button" disabled={busy || !text.trim()} onClick={send} className="rounded bg-neon-blue/20 px-3 py-1 disabled:opacity-50">Send</button>
        </div>
      </div>
    );
  }

  if (card.kind === 'maybe_done') {
    return (
      <div role="group" aria-label={card.label} className="mt-2 rounded border border-lattice-border p-2 text-sm">
        <p className="font-medium">{card.label}</p>
        <p className="text-xs opacity-70">This step may already have happened. Check, then choose.</p>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} onClick={() => onMaybeDone?.(true)} className="rounded bg-neon-blue/20 px-3 py-1 disabled:opacity-50">It already happened</button>
          <button type="button" disabled={busy} onClick={() => onMaybeDone?.(false)} className="rounded border border-lattice-border px-3 py-1 disabled:opacity-50">Run it again</button>
        </div>
      </div>
    );
  }

  return (
    <div role="group" aria-label={card.label} onKeyDown={onKey} className="mt-2 rounded border border-lattice-border p-2 text-sm">
      <p className="font-medium">{card.label}</p>
      {card.goal && <p className="text-xs opacity-70">{card.goal}</p>}
      {card.changes.map((c) => <p key={c} className="mt-1 text-xs">{c}</p>)}
      <dl className="mt-2 space-y-1">
        {card.args.map((a) => (
          <div key={a.name} className="flex items-center gap-2">
            <dt className="w-28 shrink-0 text-xs opacity-70">{a.name}</dt>
            <dd className="flex-1">
              {editing ? (
                <input
                  aria-label={a.name} value={values[a.name] ?? ''} disabled={busy}
                  onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
                  className="w-full rounded border border-lattice-border bg-transparent px-2 py-0.5"
                />
              ) : <span className="break-words">{a.value}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {card.risk === 'write' && (
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input type="checkbox" checked={dontAsk} disabled={busy} onChange={(e) => setDontAsk(e.target.checked)} />
          Don&apos;t ask again for this task
        </label>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={approve} className="rounded bg-neon-blue/20 px-3 py-1 disabled:opacity-50">Approve</button>
        <button type="button" disabled={busy} onClick={onReject} className="rounded border border-lattice-border px-3 py-1 disabled:opacity-50">Don&apos;t run this</button>
        <button type="button" disabled={busy} onClick={() => setEditing((x) => !x)} aria-pressed={editing} className="rounded border border-lattice-border px-3 py-1 disabled:opacity-50">Edit</button>
      </div>
    </div>
  );
}
