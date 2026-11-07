'use client';

/**
 * Turn the selected project into a private DTU, then a Thread draft that
 * cites that DTU. The draft stays a draft until the user posts it.
 *
 * F17: the saved state is read from the project RECORD (project-get,
 * under the chrome saved-dtu cache key) and written back onto it
 * (project-note-dtu-save) after each verified save — never held only in
 * this view's state, which is what used to evaporate on navigation.
 */

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();

  // F17 companion: the saved state is a fact of the RECORD, not of this
  // view. The read rides the chrome cache key (['saved-dtu', domain, id])
  // and project-get, which returns the project record carrying the link
  // project-note-dtu-save wrote. (The shared SavedDtuIndicator cannot be
  // mounted here: its REST read runs lens.get over the lensArtifacts
  // store, which never holds domain-store projects — the gap is named in
  // the slice's premise, office-confirmed.)
  const recordQuery = useQuery({
    queryKey: ['saved-dtu', 'projects', project?.id ?? null],
    queryFn: async () => {
      const r = await lensRun('projects', 'project-get', { id: project?.id });
      const rec = (r.data?.result?.project ?? null) as KeptProject | null;
      return rec?.savedDtuId ? String(rec.savedDtuId) : null;
    },
    enabled: !!project?.id,
    staleTime: 30000,
  });
  const recordDtuId = recordQuery.data ?? null;
  const effectiveDtuId = dtuId || recordDtuId || '';

  // A different project is a different record: never carry one project's
  // local save state over another's. (Render-phase reset — the React
  // pattern for adjusting state when a prop changes.)
  const [prevProjectId, setPrevProjectId] = useState<string | null>(project?.id ?? null);
  if ((project?.id ?? null) !== prevProjectId) {
    setPrevProjectId(project?.id ?? null);
    setDtuId('');
    setDraftId('');
    setNote('');
  }

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
    // Record the save on the project itself (F17): without this write the
    // saved state dies with this view. If the write fails, say so — the
    // receipt must not claim a persistence that did not happen.
    const noted = await lensRun('projects', 'project-note-dtu-save', { id: project?.id, dtuId: id });
    if (noted.data?.ok && noted.data?.result?.savedDtuId === id) {
      setNote(`Saved as private DTU ${id}. Nothing was published.`);
      void queryClient.invalidateQueries({ queryKey: ['saved-dtu', 'projects', project?.id ?? null] });
    } else {
      setNote(`Saved as private DTU ${id}. Nothing was published — but the save could not be recorded on the project, so this menu will not remember it after navigation.`);
    }
  }, [project, queryClient]);

  const draft = useCallback(async () => {
    const call = projectThreadDraftCall(project, effectiveDtuId);
    if (!call) { setNote('Save the project as a DTU first — a draft must cite a real project.'); return; }
    setBusy('draft');
    setNote('');
    const r = await lensRun(call.domain, call.action, call.input);
    const outcome = projectThreadDraftOutcome(r.data, effectiveDtuId);
    if (!outcome) {
      setBusy(null);
      setNote(`Not drafted. ${r.data?.error || 'Thread did not keep a draft citing that project.'}`);
      return;
    }
    setDraftId(outcome.draftId);
    setBusy(null);
    setNote(`Drafted in Thread as ${outcome.draftId}, citing ${outcome.citedDtuId}. Not posted.`);
  }, [project, effectiveDtuId]);

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
          disabled={busy !== null || !effectiveDtuId || Boolean(draftId)}
          title={!effectiveDtuId ? 'Save the project first' : draftId ? 'Already drafted' : undefined}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          <Send className="h-3 w-3" />
          {draftId ? 'Drafted' : busy === 'draft' ? 'Drafting…' : 'Draft in Thread'}
        </button>
      </div>
      {(note || recordDtuId) && (
        <p role="status" className="w-full text-[11px] text-zinc-400">
          {note || `Saved as private DTU ${recordDtuId}. Nothing was published.`}
        </p>
      )}
    </div>
  );
}
