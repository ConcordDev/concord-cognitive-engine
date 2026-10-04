'use client';

/**
 * LegalMatterMenu — turn a real `matters-detail` result into a private DTU
 * and a Thread draft.
 *
 * The order matters and is enforced here: open the matter (matters-detail),
 * build the report from the real result, create the DTU, read it back and
 * confirm the id, only then draft into Thread. The screen claims a save only
 * when the read-back matches, and claims a draft only when Thread stored
 * that exact cite and left it unpublished. Any refusal is repeated as a
 * refusal. Saving this publishes nothing. No court was filed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, ShieldCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  matterReportDtuCall,
  matterSentence,
  matterThreadDraftCall,
  matterThreadDraftOutcome,
  indexMatterDrafts,
  type MatterFacts,
} from './legalMatterReport';

interface Props {
  facts: MatterFacts;
  platform?: string;
}

export function LegalMatterMenu({ facts, platform = 'x' }: Props) {
  const sentence = useMemo(() => matterSentence(facts), [facts]);
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
      if (live) setSentDrafts(indexMatterDrafts(details.map((r) => r.data)));
    })();
    return () => { live = false; };
  }, [dtuId]);

  const save = useCallback(async () => {
    const call = matterReportDtuCall(facts);
    if (!call) { setNote('Nothing to save — the matter has no reported detail.'); return; }
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
    setNote(`Saved as private DTU ${id}. No court was filed. Nothing was published.`);
  }, [facts]);

  const draft = useCallback(async () => {
    const call = matterThreadDraftCall(facts, dtuId, platform);
    if (!call) { setNote('Save the report as a DTU first — a draft must cite a real report.'); return; }
    setBusy('draft');
    setNote('');
    const r = await lensRun(call.domain, call.action, call.input);
    const outcome = matterThreadDraftOutcome(r.data, dtuId);
    if (!outcome) {
      setBusy(null);
      setNote(`Not drafted. ${r.data?.error || 'Thread did not keep a draft citing that report.'}`);
      return;
    }
    setDraftId(outcome.draftId);
    setSentDrafts((prev) => ({ ...prev, [dtuId]: outcome.draftId }));
    setBusy(null);
    setNote(`Drafted in Thread as ${outcome.draftId}, citing ${outcome.citedDtuId}. Not posted.`);
  }, [facts, dtuId, platform]);

  if (!sentence) {
    return (
      <p className="text-[11px] text-gray-400 italic">Open a matter to build a report from its real detail.</p>
    );
  }

  const drafted = (draftId || sentDrafts[dtuId] || '') as string;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-lattice-surface/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-200">
          <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
          Matter report
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== null}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50"
          >
            {busy === 'save' ? 'Saving…' : 'Save matter as DTU'}
          </button>
          <button
            type="button"
            onClick={() => void draft()}
            disabled={busy !== null || !dtuId || Boolean(drafted)}
            title={!dtuId ? 'Save the report first' : drafted ? 'Already drafted' : undefined}
            className="inline-flex items-center gap-1 rounded-lg bg-lattice-elevated px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-lattice-border disabled:opacity-50"
          >
            <Send className="h-3 w-3" />
            {drafted ? 'Drafted' : busy === 'draft' ? 'Drafting…' : 'Draft in Thread'}
          </button>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">{sentence}</p>

      {note && (
        <p role="status" className="mt-2 text-[11px] text-gray-300">
          {note}
        </p>
      )}
      {drafted && !note.startsWith('Drafted') && (
        <p role="status" className="mt-2 text-[11px] text-gray-300">
          Drafted in Thread as {drafted}. Not posted.
        </p>
      )}
    </div>
  );
}