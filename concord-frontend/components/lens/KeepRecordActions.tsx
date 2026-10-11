'use client';

/**
 * Keep as DTU, then Draft in Thread.
 *
 * One primary action. The draft stays disabled until dtu.get reads the new
 * private DTU back. No heading, no icon row, no second data layer.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  dtuReadBackCall,
  dtuReadBackMatches,
  dtuRecordId,
  recordDtuCall,
  recordThreadDraftCall,
  recordThreadDraftOutcome,
  type KeptRecord,
} from './recordKeep';

export function KeepRecordActions({
  record,
  saveLabel = 'Keep as DTU',
}: {
  record: KeptRecord | null;
  /** Primary button. Saved and Paper item actions say "Save as DTU". */
  saveLabel?: string;
}) {
  const [dtuId, setDtuId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [busy, setBusy] = useState<'save' | 'draft' | null>(null);
  const [note, setNote] = useState('');

  const save = useCallback(async () => {
    const call = recordDtuCall(record);
    if (!call) {
      setNote('Nothing to keep.');
      return;
    }
    setBusy('save');
    setNote('');
    const created = await lensRun(call.domain, call.action, call.input);
    const id = dtuRecordId(created.data);
    if (!id) {
      setBusy(null);
      setDtuId('');
      setNote(`Not saved. ${created.data?.error || 'The record store refused this.'}`);
      return;
    }
    const back = dtuReadBackCall(id);
    const read = await lensRun(back.domain, back.action, back.input);
    if (!dtuReadBackMatches(id, read.data)) {
      setBusy(null);
      setDtuId('');
      setNote(`Saved as ${id} but the read-back did not return it. Not treating this as saved.`);
      return;
    }
    setDtuId(id);
    setBusy(null);
    setNote(`Saved as private DTU ${id}. Nothing was published.`);
  }, [record]);

  const draft = useCallback(async () => {
    const call = recordThreadDraftCall(record, dtuId);
    if (!call) {
      setNote('Keep this as a DTU first.');
      return;
    }
    setBusy('draft');
    setNote('');
    const r = await lensRun(call.domain, call.action, call.input);
    const outcome = recordThreadDraftOutcome(r.data, dtuId);
    if (!outcome) {
      setBusy(null);
      setNote(`Not drafted. ${r.data?.error || 'Thread did not keep a draft citing that DTU.'}`);
      return;
    }
    setDraftId(outcome.draftId);
    setBusy(null);
    setNote(`Drafted in Thread as ${outcome.draftId}, citing ${outcome.citedDtuId}. Not posted.`);
  }, [record, dtuId]);

  if (!record) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <button
        type="button"
        onClick={() => { void save(); }}
        disabled={busy !== null}
        className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-medium text-black hover:bg-zinc-200 disabled:opacity-50"
      >
        {busy === 'save' ? (saveLabel.startsWith('Save') ? 'Saving…' : 'Keeping…') : saveLabel}
      </button>
      <button
        type="button"
        onClick={() => { void draft(); }}
        disabled={busy !== null || !dtuId || Boolean(draftId)}
        title={!dtuId ? `${saveLabel} first` : draftId ? 'Already drafted' : undefined}
        className="text-[13px] text-zinc-300 underline-offset-2 hover:underline disabled:text-zinc-600 disabled:no-underline"
      >
        {draftId ? 'Drafted' : busy === 'draft' ? 'Drafting…' : 'Draft in Thread'}
      </button>
      {note ? (
        <p role="status" className="basis-full text-[13px] text-zinc-400">{note}</p>
      ) : null}
    </div>
  );
}
