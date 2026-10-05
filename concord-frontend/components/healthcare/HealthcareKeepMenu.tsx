'use client';

/**
 * HealthcareKeepMenu — turn a real patient chart summary into a private DTU
 * and a Thread draft.
 *
 * The order matters and is enforced here: the patients-detail macro must
 * have returned a real patient, build the report from the real data,
 * create the DTU, read it back and confirm the id, only then draft into
 * Thread.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, ShieldCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import {
  patientDtuCall,
  patientSentence,
  patientThreadDraftCall,
  patientThreadDraftOutcome,
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  indexPatientDrafts,
  type HealthcareChartFacts,
} from './healthcarePatientReport';

interface Props {
  facts: HealthcareChartFacts;
  platform?: string;
}

export function HealthcareKeepMenu({ facts, platform = 'x' }: Props) {
  const sentence = useMemo(() => patientSentence(facts), [facts]);
  const [dtuId, setDtuId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [busy, setBusy] = useState<'save' | 'draft' | null>(null);
  const [note, setNote] = useState('');
  const [sentDrafts, setSentDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await lensRun('thread', 'draft-list', {});
      if (!live || list.data?.ok === false) return;
      const drafts = Array.isArray(list.data?.result?.drafts) ? list.data.result.drafts : [];
      if (drafts.length === 0) return;
      const details = await Promise.all(
        drafts.map((d: { id?: string }) => lensRun('thread', 'draft-detail', { id: d.id })),
      );
      if (live) setSentDrafts(indexPatientDrafts(details.map((r) => r.data)));
    })();
    return () => { live = false; };
  }, [dtuId]);

  const save = useCallback(async () => {
    const call = patientDtuCall(facts);
    if (!call) { setNote('Nothing to save — the patient detail returned no real figures.'); return; }
    setBusy('save');
    setNote('');
    const created = await lensRun(call.domain, call.action, call.input);
    const id = dtuRecordId(created.data);
    if (!id) {
      setBusy(null);
      setNote(`Not saved. ${created.data?.error || 'The record store refused this report.'}`);
      return;
    }
    const back = await lensRun(dtuReadBackCall(id).domain, 'get', dtuReadBackCall(id).input);
    if (!dtuReadBackMatches(id, back.data)) {
      setBusy(null);
      setDtuId('');
      setNote(`Saved as ${id} but the read-back did not return it. Not treating this as saved.`);
      return;
    }
    setDtuId(id);
    setBusy(null);
    setNote(`Saved as private DTU ${id}. Nothing was published.`);
  }, [facts]);

  const draft = useCallback(async () => {
    const call = patientThreadDraftCall(facts, dtuId, platform);
    if (!call) { setNote('Save the patient summary as a DTU first — a draft must cite a real patient.'); return; }
    setBusy('draft');
    setNote('');
    const r = await lensRun(call.domain, call.action, call.input);
    const outcome = patientThreadDraftOutcome(r.data, dtuId);
    if (!outcome) {
      setBusy(null);
      setNote(`Not drafted. ${r.data?.error || 'Thread did not keep a draft citing that patient.'}`);
      return;
    }
    setDraftId(outcome.draftId);
    setSentDrafts((prev) => ({ ...prev, [dtuId]: outcome.draftId }));
    setBusy(null);
    setNote(`Drafted in Thread as ${outcome.draftId}, citing ${outcome.citedDtuId}. Not posted.`);
  }, [facts, dtuId, platform]);

  if (!sentence) return null;

  const drafted = (draftId || sentDrafts[dtuId] || '') as string;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-500/20 bg-zinc-900/40 p-3">
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
        <h4 className="text-[11px] font-semibold text-zinc-300">Keep this patient summary</h4>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null}
          className="rounded-md bg-cyan-500/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : 'Save summary as DTU'}
        </button>
        <button
          type="button"
          onClick={() => void draft()}
          disabled={busy !== null || !dtuId || Boolean(drafted)}
          title={!dtuId ? 'Save the summary first' : drafted ? 'Already drafted' : undefined}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          <Send className="h-3 w-3" />
          {drafted ? 'Drafted' : busy === 'draft' ? 'Drafting…' : 'Draft in Thread'}
        </button>
      </div>
      {note && (
        <p role="status" className="w-full text-[11px] text-zinc-400">
          {note}
        </p>
      )}
      {drafted && !note.startsWith('Drafted') && (
        <p role="status" className="w-full text-[11px] text-zinc-400">
          Drafted in Thread as {drafted}. Not posted.
        </p>
      )}
    </div>
  );
}