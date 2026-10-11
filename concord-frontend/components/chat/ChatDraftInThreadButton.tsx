'use client';

/**
 * Draft in Thread — the same Keep order Board and Accounting use:
 * a real DTU id, a read-back that returns that id, then thread-draft
 * citing it. Disabled until the read-back matches. A refusal stays a refusal.
 */

import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { dtuReadBackMatches } from './chatHandoff';
import { chatThreadDraftCall, chatThreadDraftOutcome } from './chatDraftInThread';

interface Props {
  dtuId: string;
  title: string;
  content: string;
  className?: string;
}

export function ChatDraftInThreadButton({ dtuId, title, content, className }: Props) {
  const id = dtuId.trim();
  const [check, setCheck] = useState<{ id: string; ok: boolean; note: string } | null>(null);
  const [drafted, setDrafted] = useState<{ dtuId: string; draftId: string } | null>(null);
  const [actionNote, setActionNote] = useState<{ dtuId: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return undefined;
    let live = true;
    void (async () => {
      const back = await lensRun('dtu', 'get', { id });
      if (!live) return;
      if (!dtuReadBackMatches(id, back.data)) {
        setCheck({
          id,
          ok: false,
          note: `Forged as ${id} but the read-back did not return it. Not drafting.`,
        });
        return;
      }
      setCheck({ id, ok: true, note: '' });
    })();
    return () => { live = false; };
  }, [id]);

  const verified = Boolean(id) && check?.id === id && check.ok;
  const draftId = drafted?.dtuId === id ? drafted.draftId : '';
  const note = (actionNote?.dtuId === id && actionNote.text)
    || (check?.id === id ? check.note : '');

  async function draft() {
    const call = chatThreadDraftCall({ dtuId: id, title, content });
    if (!call || !verified) {
      setActionNote({ dtuId: id, text: 'Forge a DTU first — a Thread draft has to cite one that reads back.' });
      return;
    }
    setBusy(true);
    setActionNote({ dtuId: id, text: '' });
    const r = await lensRun(call.domain, call.action, call.input);
    const outcome = chatThreadDraftOutcome(r.data, id);
    setBusy(false);
    if (!outcome) {
      setActionNote({
        dtuId: id,
        text: `Not drafted. ${r.data?.error || 'Thread did not keep a draft citing that DTU.'}`,
      });
      return;
    }
    setDrafted({ dtuId: id, draftId: outcome.draftId });
    setActionNote({
      dtuId: id,
      text: `Drafted in Thread as ${outcome.draftId}, citing ${outcome.citedDtuId}. Not posted.`,
    });
  }

  const label = draftId ? 'Drafted' : busy ? 'Drafting…' : 'Draft in Thread';

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => void draft()}
        disabled={!verified || busy || Boolean(draftId)}
        className={cn(
          'hover:text-neon-cyan transition-colors flex items-center gap-1 disabled:opacity-50',
          className,
        )}
        title={verified ? 'Cite this DTU in a Thread draft' : 'Forge a DTU first'}
        aria-label="Draft in Thread"
      >
        <Send className="w-3 h-3" />
        <span className="hidden sm:inline">{label}</span>
      </button>
      {note && (
        <span role="status" className="text-[10px] text-zinc-400">
          {note}
        </span>
      )}
    </span>
  );
}
