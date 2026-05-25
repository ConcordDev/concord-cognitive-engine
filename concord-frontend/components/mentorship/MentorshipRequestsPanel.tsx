'use client';

/**
 * MentorshipRequestsPanel — the request → accept matching flow. Mentors see
 * incoming requests and accept/decline them; mentees see their outgoing
 * requests and can withdraw pending ones. All data from `mentorship` macros.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Inbox, Send, Check, X, Clock, ArrowRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MentorshipRequest {
  id: string;
  mentorId: string;
  mentorName: string;
  menteeId: string;
  menteeName: string;
  topic: string;
  message: string;
  goals: string[];
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  createdAt: string;
  respondedAt: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-amber-400 bg-amber-400/10',
  accepted: 'text-neon-green bg-neon-green/10',
  declined: 'text-red-400 bg-red-400/10',
  withdrawn: 'text-zinc-400 bg-zinc-400/10',
};

export function MentorshipRequestsPanel() {
  const [incoming, setIncoming] = useState<MentorshipRequest[]>([]);
  const [outgoing, setOutgoing] = useState<MentorshipRequest[]>([]);
  const [pendingIncoming, setPendingIncoming] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mentorship', 'request-list', {});
    if (r.data?.ok === false) { setError(r.data.error || 'Failed to load requests.'); }
    else {
      setIncoming(r.data?.result?.incoming || []);
      setOutgoing(r.data?.result?.outgoing || []);
      setPendingIncoming(r.data?.result?.pendingIncoming || 0);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const respond = async (requestId: string, decision: 'accept' | 'decline') => {
    setBusyId(requestId);
    const r = await lensRun('mentorship', 'request-respond', { requestId, decision });
    setBusyId(null);
    if (r.data?.ok === false) { setError(r.data.error || 'Action failed.'); return; }
    void refresh();
  };

  const withdraw = async (requestId: string) => {
    setBusyId(requestId);
    const r = await lensRun('mentorship', 'request-withdraw', { requestId });
    setBusyId(null);
    if (r.data?.ok === false) { setError(r.data.error || 'Withdraw failed.'); return; }
    void refresh();
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>;
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Incoming — mentor view */}
      <div className="panel p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Inbox className="w-4 h-4 text-neon-blue" /> Incoming requests
          {pendingIncoming > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-400">{pendingIncoming} pending</span>
          )}
        </h3>
        {incoming.length === 0 ? (
          <p className="text-xs text-zinc-400">No incoming requests. List yourself as a mentor to receive them.</p>
        ) : incoming.map((req) => (
          <div key={req.id} className="lens-card space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{req.menteeName}</span>
              <span className={cn('text-[10px] px-2 py-0.5 rounded', STATUS_STYLE[req.status])}>{req.status}</span>
            </div>
            <p className="text-xs text-zinc-400">Topic: <span className="text-white">{req.topic}</span></p>
            {req.message && <p className="text-xs text-zinc-300 italic">&ldquo;{req.message}&rdquo;</p>}
            {req.goals.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {req.goals.map((g) => <span key={g} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{g}</span>)}
              </div>
            )}
            {req.status === 'pending' && (
              <div className="flex gap-2 pt-1">
                <button onClick={() => respond(req.id, 'accept')} disabled={busyId === req.id} className="btn-neon green text-xs flex-1">
                  {busyId === req.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <><Check className="w-3 h-3 inline" /> Accept</>}
                </button>
                <button onClick={() => respond(req.id, 'decline')} disabled={busyId === req.id} className="btn-secondary text-xs flex-1">
                  <X className="w-3 h-3 inline" /> Decline
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Outgoing — mentee view */}
      <div className="panel p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Send className="w-4 h-4 text-neon-cyan" /> Outgoing requests
        </h3>
        {outgoing.length === 0 ? (
          <p className="text-xs text-zinc-400">No outgoing requests. Find a mentor in the Directory tab.</p>
        ) : outgoing.map((req) => (
          <div key={req.id} className="lens-card space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm flex items-center gap-1.5">
                <ArrowRight className="w-3.5 h-3.5 text-zinc-400" /> {req.mentorName}
              </span>
              <span className={cn('text-[10px] px-2 py-0.5 rounded', STATUS_STYLE[req.status])}>{req.status}</span>
            </div>
            <p className="text-xs text-zinc-400">Topic: <span className="text-white">{req.topic}</span></p>
            <p className="text-[10px] text-zinc-400 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {new Date(req.createdAt).toLocaleDateString()}
            </p>
            {req.status === 'pending' && (
              <button onClick={() => withdraw(req.id)} disabled={busyId === req.id} className="btn-secondary text-xs w-full">
                {busyId === req.id ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Withdraw request'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
