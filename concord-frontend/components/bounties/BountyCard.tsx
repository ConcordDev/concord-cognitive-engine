'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Coins, Tag, ChevronDown, ChevronUp, Send, CheckCircle2, XCircle,
  Gavel, Milestone as MilestoneIcon, Loader2, ExternalLink, Clock,
  Pencil, Ban, Trash2,
} from 'lucide-react';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import type { PlatformBounty, Submission } from './types';
import { STATUS_STYLE, DIFFICULTY_STYLE } from './types';

const CATEGORIES = ['security', 'feature', 'bug', 'design', 'docs', 'research', 'infra', 'other'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'expert'];

interface Props {
  bounty: PlatformBounty;
  currentUserId: string;
  onChanged: (b: PlatformBounty) => void;
  onRemoved?: (id: string) => void;
}

export function BountyCard({ bounty, currentUserId, onChanged, onRemoved }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // owner edit draft (FIX-bounties-001)
  const [showEdit, setShowEdit] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('other');
  const [editDifficulty, setEditDifficulty] = useState('intermediate');
  const [editTags, setEditTags] = useState('');
  const [editDeadline, setEditDeadline] = useState('');

  // submission draft
  const [showSubmit, setShowSubmit] = useState(false);
  const [subSummary, setSubSummary] = useState('');
  const [subLink, setSubLink] = useState('');
  const [subNotes, setSubNotes] = useState('');
  const [subMilestone, setSubMilestone] = useState('');

  // dispute draft
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  const isOwner = bounty.ownerId === currentUserId;
  const hasSubmitted = bounty.submissions.some((s) => s.claimantId === currentUserId);
  const involved = isOwner || hasSubmitted;

  const submitWork = async () => {
    setBusy(true); setErr(null);
    const r = await lensRun<{ bounty: PlatformBounty }>('bounties', 'submit', {
      bountyId: bounty.id,
      summary: subSummary,
      link: subLink,
      notes: subNotes,
      milestoneId: subMilestone || undefined,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      onChanged(r.data.result.bounty);
      setShowSubmit(false);
      setSubSummary(''); setSubLink(''); setSubNotes(''); setSubMilestone('');
    } else {
      setErr(r.data?.error || 'Submission failed');
    }
  };

  const review = async (sub: Submission, decision: 'accept' | 'reject') => {
    setBusy(true); setErr(null);
    const r = await lensRun<{ bounty: PlatformBounty }>('bounties', 'review', {
      bountyId: bounty.id, submissionId: sub.id, decision,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) onChanged(r.data.result.bounty);
    else setErr(r.data?.error || 'Review failed');
  };

  const releaseMilestone = async (milestoneId: string, claimantId: string) => {
    setBusy(true); setErr(null);
    const r = await lensRun<{ bounty: PlatformBounty }>('bounties', 'release-milestone', {
      bountyId: bounty.id, milestoneId, claimantId,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) onChanged(r.data.result.bounty);
    else setErr(r.data?.error || 'Milestone release failed');
  };

  const openDispute = async () => {
    setBusy(true); setErr(null);
    const r = await lensRun<{ bounty: PlatformBounty }>('bounties', 'dispute-open', {
      bountyId: bounty.id, reason: disputeReason,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      onChanged(r.data.result.bounty);
      setShowDispute(false); setDisputeReason('');
    } else {
      setErr(r.data?.error || 'Could not open dispute');
    }
  };

  // ── Owner lifecycle (FIX-bounties-001) ─────────────────────────────
  const startEdit = () => {
    setEditTitle(bounty.title);
    setEditDescription(bounty.description);
    setEditCategory(bounty.category);
    setEditDifficulty(bounty.difficulty);
    setEditTags(bounty.tags.join(', '));
    setEditDeadline(bounty.deadline || '');
    setShowEdit(true);
  };

  const saveEdit = async () => {
    setBusy(true); setErr(null);
    const r = await lensRun<{ bounty: PlatformBounty }>('bounties', 'update', {
      bountyId: bounty.id,
      title: editTitle,
      description: editDescription,
      category: editCategory,
      difficulty: editDifficulty,
      tags: editTags,
      deadline: editDeadline,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      onChanged(r.data.result.bounty);
      setShowEdit(false);
    } else {
      setErr(r.data?.error || 'Edit failed');
    }
  };

  const cancelBounty = async () => {
    setBusy(true); setErr(null);
    const r = await lensRun<{ bounty: PlatformBounty }>('bounties', 'cancel', { bountyId: bounty.id });
    setBusy(false);
    if (r.data?.ok && r.data.result) onChanged(r.data.result.bounty);
    else setErr(r.data?.error || 'Cancel failed');
  };

  const deleteBounty = async () => {
    setBusy(true); setErr(null);
    const r = await lensRun<{ deleted: boolean }>('bounties', 'delete', { bountyId: bounty.id });
    setBusy(false);
    if (r.data?.ok) onRemoved?.(bounty.id);
    else setErr(r.data?.error || 'Delete failed');
  };

  const resolveDispute = async (ruling: 'uphold' | 'overturn' | 'split') => {
    setBusy(true); setErr(null);
    const r = await lensRun<{ bounty: PlatformBounty }>('bounties', 'dispute-resolve', {
      bountyId: bounty.id, ruling, rulingNote: `Arbiter ruling: ${ruling}`,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) onChanged(r.data.result.bounty);
    else setErr(r.data?.error || 'Could not resolve dispute');
  };

  const milestonesPaid = bounty.milestones.filter((m) => m.status === 'paid').length;

  return (
    <li className="rounded-xl border border-zinc-700/50 bg-zinc-900/80 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-zinc-100 truncate">{bounty.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${STATUS_STYLE[bounty.status] || STATUS_STYLE.open}`}>
                {bounty.status}
              </span>
              <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">{bounty.category}</span>
              <span className={`text-[10px] font-medium ${DIFFICULTY_STYLE[bounty.difficulty] || 'text-zinc-400'}`}>
                {bounty.difficulty}
              </span>
              {bounty.deadline && (
                <span className="text-[10px] text-zinc-400 flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" /> {bounty.deadline}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-amber-300 font-bold flex items-center gap-1 justify-end">
              <Coins className="w-3.5 h-3.5" /> {bounty.poolCc} CC
            </div>
            {bounty.paidCc > 0 && (
              <div className="text-[10px] text-emerald-400">{bounty.paidCc} CC paid</div>
            )}
          </div>
        </div>

        {bounty.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {bounty.tags.map((t) => (
              <span key={t} className="text-[10px] text-cyan-300 flex items-center gap-0.5">
                <Tag className="w-2.5 h-2.5" />{t}
              </span>
            ))}
          </div>
        )}

        {bounty.milestones.length > 0 && (
          <div className="mt-2 text-[10px] text-zinc-400 flex items-center gap-1">
            <MilestoneIcon className="w-3 h-3 text-amber-400" />
            {milestonesPaid}/{bounty.milestones.length} milestones paid
          </div>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-amber-500 rounded"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? 'Hide details' : `Details · ${bounty.submissionCount} submission${bounty.submissionCount === 1 ? '' : 's'}`}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
          <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed min-w-0 break-words [overflow-wrap:anywhere]">{bounty.description}</p>

          {/* Milestones */}
          {bounty.milestones.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-[11px] font-semibold text-amber-300 uppercase tracking-wide">Milestones</h4>
              {bounty.milestones.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1.5">
                  <span className="text-xs text-zinc-200 truncate">{m.title}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-amber-300">{m.rewardCc} CC</span>
                    <span className={`text-[10px] px-1 rounded ${m.status === 'paid' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700 text-zinc-400'}`}>
                      {m.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Submissions */}
          {bounty.submissions.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-semibold text-cyan-300 uppercase tracking-wide">Submissions</h4>
              {bounty.submissions.map((sub) => (
                <div key={sub.id} className="rounded border border-zinc-800 bg-zinc-900 p-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-zinc-200">{sub.summary}</p>
                    <span className={`text-[10px] px-1 rounded shrink-0 ${
                      sub.status === 'accepted' ? 'bg-emerald-500/20 text-emerald-300'
                      : sub.status === 'rejected' ? 'bg-red-500/20 text-red-300'
                      : 'bg-amber-500/20 text-amber-300'}`}>
                      {sub.status}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-0.5">by {sub.claimantId}</p>
                  {sub.link && (
                    <a href={sub.link} target="_blank" rel="noreferrer"
                      className="text-[10px] text-cyan-400 hover:underline flex items-center gap-0.5 mt-0.5">
                      <ExternalLink className="w-2.5 h-2.5" /> {sub.link}
                    </a>
                  )}
                  {sub.notes && <p className="text-[10px] text-zinc-400 mt-0.5">{sub.notes}</p>}
                  {sub.reviewNote && <p className="text-[10px] text-amber-400 mt-0.5">Review: {sub.reviewNote}</p>}
                  {isOwner && sub.status === 'pending' && (
                    <div className="flex gap-2 mt-1.5">
                      <button onClick={() => review(sub, 'accept')} disabled={busy}
                        className="flex items-center gap-1 text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-0.5 rounded disabled:opacity-50">
                        <CheckCircle2 className="w-3 h-3" /> Accept
                      </button>
                      <button onClick={() => review(sub, 'reject')} disabled={busy}
                        className="flex items-center gap-1 text-[10px] bg-red-800 hover:bg-red-700 text-white px-2 py-0.5 rounded disabled:opacity-50">
                        <XCircle className="w-3 h-3" /> Reject
                      </button>
                      {sub.milestoneId && (
                        <button onClick={() => releaseMilestone(sub.milestoneId!, sub.claimantId)} disabled={busy}
                          className="flex items-center gap-1 text-[10px] bg-amber-700 hover:bg-amber-600 text-white px-2 py-0.5 rounded disabled:opacity-50">
                          <MilestoneIcon className="w-3 h-3" /> Release milestone
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Dispute */}
          {bounty.dispute && (
            <div className="rounded border border-red-800/50 bg-red-950/30 p-2">
              <h4 className="text-[11px] font-semibold text-red-300 flex items-center gap-1">
                <Gavel className="w-3 h-3" /> Dispute — {bounty.dispute.status}
              </h4>
              <p className="text-[10px] text-red-200/80 mt-0.5">{bounty.dispute.reason}</p>
              <p className="text-[10px] text-zinc-400">opened by {bounty.dispute.openedBy}</p>
              {bounty.dispute.ruling && (
                <p className="text-[10px] text-amber-300 mt-0.5">Ruling: {bounty.dispute.ruling}{bounty.dispute.rulingNote ? ` — ${bounty.dispute.rulingNote}` : ''}</p>
              )}
              {bounty.dispute.status === 'open' && (
                <div className="flex gap-1.5 mt-1.5">
                  <button onClick={() => resolveDispute('uphold')} disabled={busy}
                    className="text-[10px] bg-zinc-700 hover:bg-zinc-600 text-white px-2 py-0.5 rounded disabled:opacity-50">Uphold</button>
                  <button onClick={() => resolveDispute('overturn')} disabled={busy}
                    className="text-[10px] bg-amber-700 hover:bg-amber-600 text-white px-2 py-0.5 rounded disabled:opacity-50">Overturn</button>
                  <button onClick={() => resolveDispute('split')} disabled={busy}
                    className="text-[10px] bg-cyan-700 hover:bg-cyan-600 text-white px-2 py-0.5 rounded disabled:opacity-50">Split</button>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            {!isOwner && bounty.status !== 'paid' && bounty.status !== 'cancelled' && (
              <button onClick={() => setShowSubmit((v) => !v)}
                className="flex items-center gap-1 text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-3 py-1.5 rounded focus:ring-2 focus:ring-cyan-400 focus:outline-none">
                <Send className="w-3.5 h-3.5" /> Submit work
              </button>
            )}
            {involved && (!bounty.dispute || bounty.dispute.status === 'resolved') && (
              <button onClick={() => setShowDispute((v) => !v)}
                className="flex items-center gap-1 text-xs bg-red-900 hover:bg-red-800 text-red-100 px-3 py-1.5 rounded focus:ring-2 focus:ring-red-500 focus:outline-none">
                <Gavel className="w-3.5 h-3.5" /> Open dispute
              </button>
            )}
            {isOwner && bounty.status === 'open' && bounty.submissions.length === 0 && (
              <button onClick={startEdit} disabled={busy}
                className="flex items-center gap-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded disabled:opacity-50 focus:ring-2 focus:ring-zinc-400 focus:outline-none">
                <Pencil className="w-3.5 h-3.5" /> Edit bounty
              </button>
            )}
            {isOwner && (bounty.status === 'open' || bounty.status === 'claimed') && (
              <StickyDeleteConfirm
                disabled={busy}
                onConfirm={cancelBounty}
                armLabel={
                  <span className="flex items-center gap-1">
                    <Ban className="w-3.5 h-3.5" /> Cancel bounty
                  </span>
                }
                confirmLabel="Cancel this bounty?"
                armAriaLabel="Cancel bounty"
                confirmAriaLabel="Confirm cancel bounty"
                cancelAriaLabel="Keep bounty"
                className="flex items-center gap-1 rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
              />
            )}
            {isOwner && bounty.status === 'cancelled' && (
              <StickyDeleteConfirm
                disabled={busy}
                onConfirm={deleteBounty}
                armLabel={
                  <span className="flex items-center gap-1">
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </span>
                }
                confirmLabel="Delete bounty?"
                armAriaLabel="Delete bounty"
                confirmAriaLabel="Confirm delete bounty"
                cancelAriaLabel="Cancel delete"
                className="flex items-center gap-1 rounded bg-rose-900 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-800 disabled:opacity-50"
              />
            )}
          </div>
          {isOwner && (bounty.status === 'open' || bounty.status === 'claimed') && (
            <p role="note" className="text-[10px] leading-relaxed text-zinc-500">
              Cancelling closes the bounty to new submissions. No CC was taken when you posted it,
              so there is nothing to refund — the posted reward was never escrowed.
            </p>
          )}

          {/* Submission form */}
          {showSubmit && (
            <div className="rounded-lg border border-cyan-800/40 bg-zinc-900 p-3 space-y-2">
              <textarea value={subSummary} onChange={(e) => setSubSummary(e.target.value)}
                placeholder="Summary of work delivered (min 8 chars)" rows={2}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none resize-none" />
              <input value={subLink} onChange={(e) => setSubLink(e.target.value)}
                placeholder="Link to PR / artifact (optional)"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none" />
              <textarea value={subNotes} onChange={(e) => setSubNotes(e.target.value)}
                placeholder="Reviewer notes (optional)" rows={2}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none resize-none" />
              {bounty.milestones.length > 0 && (
                <select value={subMilestone} onChange={(e) => setSubMilestone(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none">
                  <option value="">Whole bounty</option>
                  {bounty.milestones.filter((m) => m.status !== 'paid').map((m) => (
                    <option key={m.id} value={m.id}>{m.title} ({m.rewardCc} CC)</option>
                  ))}
                </select>
              )}
              <button onClick={submitWork} disabled={busy}
                className="w-full flex items-center justify-center gap-1 text-xs bg-cyan-600 hover:bg-cyan-500 text-white py-1.5 rounded disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Submit
              </button>
            </div>
          )}

          {/* Dispute form */}
          {showDispute && (
            <div className="rounded-lg border border-red-800/40 bg-zinc-900 p-3 space-y-2">
              <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}
                placeholder="Why is this resolution contested? (min 10 chars)" rows={3}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-red-500 focus:outline-none resize-none" />
              <button onClick={openDispute} disabled={busy}
                className="w-full flex items-center justify-center gap-1 text-xs bg-red-700 hover:bg-red-600 text-white py-1.5 rounded disabled:opacity-50">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Gavel className="w-3.5 h-3.5" />}
                Open dispute
              </button>
            </div>
          )}

          {/* Edit form (owner, pre-submission) */}
          {showEdit && (
            <div className="rounded-lg border border-zinc-700/60 bg-zinc-900 p-3 space-y-2">
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                aria-label="Edit bounty title" maxLength={160}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none" />
              <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)}
                aria-label="Edit bounty description" rows={3}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none resize-none" />
              <div className="flex flex-wrap gap-2">
                <select value={editCategory} onChange={(e) => setEditCategory(e.target.value)}
                  aria-label="Edit bounty category"
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={editDifficulty} onChange={(e) => setEditDifficulty(e.target.value)}
                  aria-label="Edit bounty difficulty"
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none">
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <input type="date" value={editDeadline} onChange={(e) => setEditDeadline(e.target.value)}
                  aria-label="Edit bounty deadline"
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none" />
              </div>
              <input value={editTags} onChange={(e) => setEditTags(e.target.value)}
                aria-label="Edit bounty tags" placeholder="Tags, comma separated"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none" />
              <p role="note" className="text-[10px] leading-relaxed text-zinc-500">
                The reward and milestones are the posted terms — cancel and repost to change them.
              </p>
              <div className="flex gap-2">
                <button onClick={saveEdit} disabled={busy}
                  className="flex-1 text-xs bg-amber-600 hover:bg-amber-500 text-white py-1.5 rounded disabled:opacity-50">
                  Save changes
                </button>
                <button onClick={() => setShowEdit(false)} disabled={busy}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded disabled:opacity-50">
                  Cancel edit
                </button>
              </div>
            </div>
          )}

          {err && <p className="text-xs text-red-400" role="alert">{err}</p>}
        </div>
      )}
    </li>
  );
}
