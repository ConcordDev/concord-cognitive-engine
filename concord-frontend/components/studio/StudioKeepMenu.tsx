'use client';

/**
 * StudioKeepMenu — turn a real Studio project into a private DTU and a
 * Thread draft.
 *
 * The order matters and is enforced here: the project-get macro must have
 * returned a real project, build the report from the real data, create the
 * DTU, read it back and confirm the id, only then draft into Thread.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  indexProjectDrafts,
  type StudioProjectFacts,
  type StudioProject,
} from './studioProjectReport';

interface Props {
  project: StudioProject | null;
  platform?: string;
}

export function StudioKeepMenu({ project, platform = 'x' }: Props) {
  const facts: StudioProjectFacts = useMemo(() => ({ project }), [project]);
  const sentence = useMemo(() => projectSentence(facts), [facts]);
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
      if (live) setSentDrafts(indexProjectDrafts(details.map((r) => r.data)));
    })();
    return () => { live = false; };
  }, [dtuId]);

  const save = useCallback(async () => {
    const projectId = String(facts.project?.id || '').trim();
    if (!projectId) {
      setNote('Nothing to save — no project id.');
      return;
    }
    setBusy('save');
    setNote('');
    try {
      // Durable store first (studioLens). A lens-artifact-only session used to
      // leave Keep spinning while project-get / the DTU path had nothing real.
      const got = await lensRun('studio', 'project-get', { id: projectId });
      const serverProject = (got.data?.ok !== false && got.data?.result && typeof got.data.result === 'object')
        ? (got.data.result as { project?: StudioProject }).project
        : null;
      if (!serverProject?.id || !serverProject.name) {
        setNote(`Not saved. Studio has no durable project for this session (${got.data?.error || 'not found'}). Create/save the project first.`);
        return;
      }
      const reportFacts = { project: serverProject };
      const call = projectDtuCall(reportFacts);
      if (!call) {
        setNote('Nothing to save — the project returned no real figures.');
        return;
      }
      const created = await lensRun(call.domain, call.action, call.input);
      const id = dtuRecordId(created.data);
      if (!id) {
        setNote(`Not saved. ${created.data?.error || 'The record store refused this report.'}`);
        return;
      }
      const back = await lensRun(dtuReadBackCall(id).domain, 'get', dtuReadBackCall(id).input);
      if (!dtuReadBackMatches(id, back.data)) {
        setDtuId('');
        setNote(`Saved as ${id} but the read-back did not return it. Not treating this as saved.`);
        return;
      }
      setDtuId(id);
      setNote(`Saved as private DTU ${id}. Nothing was published.`);
    } catch (err) {
      setNote(`Not saved. ${err instanceof Error ? err.message : 'Save failed.'}`);
    } finally {
      setBusy(null);
    }
  }, [facts]);

  const draft = useCallback(async () => {
    const call = projectThreadDraftCall(facts, dtuId, platform);
    if (!call) { setNote('Save the project as a DTU first — a draft must cite a real project.'); return; }
    setBusy('draft');
    setNote('');
    try {
      const r = await lensRun(call.domain, call.action, call.input);
      const outcome = projectThreadDraftOutcome(r.data, dtuId);
      if (!outcome) {
        setNote(`Not drafted. ${r.data?.error || 'Thread did not keep a draft citing that project.'}`);
        return;
      }
      setDraftId(outcome.draftId);
      setSentDrafts((prev) => ({ ...prev, [dtuId]: outcome.draftId }));
      setNote(`Drafted in Thread as ${outcome.draftId}, citing ${outcome.citedDtuId}. Not posted.`);
    } catch (err) {
      setNote(`Not drafted. ${err instanceof Error ? err.message : 'Draft failed.'}`);
    } finally {
      setBusy(null);
    }
  }, [facts, dtuId, platform]);

  if (!sentence) return null;

  const drafted = (draftId || sentDrafts[dtuId] || '') as string;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-zinc-900/40 p-3">
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
        <h4 className="text-[11px] font-semibold text-zinc-300">Keep this project</h4>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null}
          className="rounded-md bg-emerald-500/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : 'Save project as DTU'}
        </button>
        <button
          type="button"
          onClick={() => void draft()}
          disabled={busy !== null || !dtuId || Boolean(drafted)}
          title={!dtuId ? 'Save the project first' : drafted ? 'Already drafted' : undefined}
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