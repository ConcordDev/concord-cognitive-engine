'use client';

/**
 * Turn the selected project into a private DTU, then a Thread draft that
 * cites that DTU. The draft stays a draft until the user posts it.
 */

import { useCallback, useState } from 'react';
import { Send, ShieldCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import {
  projectDtuCall,
  projectSentence,
  projectThreadDraftCall,
  projectThreadDraftOutcome,
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type KeptProject,
} from './projectKeep';

export function ProjectsKeepMenu({ project }: { project: KeptProject | null }) {
  const sentence = projectSentence(project);
  const [dtuId, setDtuId] = useState('');
  const [draftId, setDraftId] = useState('');
  const [busy, setBusy] = useState<'save' | 'draft' | null>(null);
  const [note, setNote] = useState('');

  const save = useCallback(async () => {
    const call = projectDtuCall(project);
    if (!call) { setNote('Nothing to save — this project has no id.'); return; }
    setBusy('save');
    setNote('');
    const created = await lensRun(call.domain, call.action, call.input);
    const id = dtuRecordId(created.data);
    if (!id) {
      setBusy(null);
      setNote(`Not saved. ${created.data?.error || 'The record store refused this project.'}`);
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
  }, [project]);

  const draft = useCallback(async () => {
    const call = projectThreadDraftCall(project, dtuId);
    if (!call) { setNote('Save the project as a DTU first — a draft must cite a real project.'); return; }
    setBusy('draft');
    setNote('');
    const r = await lensRun(call.domain, call.action, call.input);
    const outcome = projectThreadDraftOutcome(r.data, dtuId);
    if (!outcome) {
      setBusy(null);
      setNote(`Not drafted. ${r.data?.error || 'Thread did not keep a draft citing that project.'}`);
      return;
    }
    setDraftId(outcome.draftId);
    setBusy(null);
    setNote(`Drafted in Thread as ${outcome.draftId}, citing ${outcome.citedDtuId}. Not posted.`);
  }, [project, dtuId]);

  if (!sentence) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-teal-400" />
        <h4 className="text-[11px] font-semibold text-zinc-300">Keep this project</h4>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null}
          className="rounded-md bg-teal-500/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-500 disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : 'Save project as DTU'}
        </button>
        <button
          type="button"
          onClick={() => void draft()}
          disabled={busy !== null || !dtuId || Boolean(draftId)}
          title={!dtuId ? 'Save the project first' : draftId ? 'Already drafted' : undefined}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          <Send className="h-3 w-3" />
          {draftId ? 'Drafted' : busy === 'draft' ? 'Drafting…' : 'Draft in Thread'}
        </button>
      </div>
      {note && <p role="status" className="w-full text-[11px] text-zinc-400">{note}</p>}
    </div>
  );
}
