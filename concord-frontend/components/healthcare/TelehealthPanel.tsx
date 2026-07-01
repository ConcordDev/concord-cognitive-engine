'use client';

/**
 * TelehealthPanel — video visit scheduling + room lifecycle.
 * Backend: healthcare.telehealth-create / telehealth-list /
 * telehealth-update-status. A real Daily.co room is minted when
 * DAILY_API_KEY is set; otherwise the in-lens concord-webrtc path is
 * used (TelehealthVideoCall joins the socket.io signalling room
 * `webrtc:<visitId>` — no token, room privacy comes from the
 * unguessable visit id). When neither is available the backend says so
 * honestly (videoReady:false + note) and only the appointment exists.
 */

import { useEffect, useState, useCallback } from 'react';
import { Video, Loader2, Plus, Play, CheckCircle, XCircle, ExternalLink, UserX } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { TelehealthVideoCall } from './TelehealthVideoCall';

interface Patient { id: string; firstName: string; lastName: string; mrn: string }
interface TeleVisit {
  id: string; patientId: string; appointmentId: string; provider: string;
  scheduledAt: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  roomProvider: string; roomUrl: string | null; roomName?: string;
  videoReady?: boolean; note?: string;
  join?: { transport: string; joinEvent: string; room: string; visitId: string; component: string };
  startedAt?: string; endedAt?: string;
}

const STATUS_STYLE: Record<TeleVisit['status'], string> = {
  scheduled: 'bg-cyan-500/20 text-cyan-300',
  in_progress: 'bg-emerald-500/20 text-emerald-300',
  completed: 'bg-gray-500/20 text-gray-300',
  cancelled: 'bg-rose-500/20 text-rose-300',
  no_show: 'bg-amber-500/20 text-amber-300',
};

export function TelehealthPanel({ patientId }: { patientId: string }) {
  const [visits, setVisits] = useState<TeleVisit[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ provider: '', scheduledAt: '' });
  // In-lens video tile: when a visit is `Start`-ed we mount the
  // `TelehealthVideoCall` component which acquires camera + mic and
  // opens a WebRTC peer connection via Concord's Socket.IO signalling.
  // No external client / hand-off needed.
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [v, p] = await Promise.all([
        lensRun('healthcare', 'telehealth-list', { patientId }),
        lensRun('healthcare', 'patients-list', {}),
      ]);
      if (v.data?.ok) setVisits((v.data.result.visits || []) as TeleVisit[]);
      if (p.data?.ok) setPatients((p.data.result.patients || []) as Patient[]);
    } catch (e) { console.error('[Telehealth] refresh', e); }
    finally { setLoading(false); }
  }, [patientId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function create() {
    try {
      const r = await lensRun('healthcare', 'telehealth-create', {
        patientId,
        provider: draft.provider.trim(),
        scheduledAt: draft.scheduledAt || new Date().toISOString(),
      });
      if (r.data?.ok) {
        setDraft({ provider: '', scheduledAt: '' });
        setCreating(false);
        await refresh();
      }
    } catch (e) { console.error('[Telehealth] create', e); }
  }

  async function setStatus(id: string, status: TeleVisit['status']) {
    try {
      const r = await lensRun('healthcare', 'telehealth-update-status', { id, status });
      if (r.data?.ok) await refresh();
    } catch (e) { console.error('[Telehealth] status', e); }
  }

  function patientName(id: string): string {
    const p = patients.find(x => x.id === id);
    return p ? `${p.lastName}, ${p.firstName}` : id;
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Video className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold text-gray-200">Telehealth video visits</span>
        <span className="text-[10px] text-gray-400">{visits.length}</span>
        <button onClick={() => setCreating(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-cyan-500 text-black font-semibold hover:bg-cyan-400 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Schedule visit
        </button>
      </header>

      {creating && (
        <div className="p-3 grid grid-cols-12 gap-2 border-b border-white/10">
          <input value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })} placeholder="Provider name" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="datetime-local" value={draft.scheduledAt} onChange={e => setDraft({ ...draft, scheduledAt: e.target.value })} className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="col-span-3 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">Create room</button>
        </div>
      )}

      {/* In-lens video tile — mounted as soon as a visit is Start-ed.
          The TelehealthVideoCall component handles getUserMedia + WebRTC
          peer setup over Concord's Socket.IO signalling. Closing it
          ends the call cleanly (stops tracks, destroys peer, emits
          webrtc:leave) but does NOT change the visit's clinical status —
          the provider still has to click "End" to mark it completed. */}
      {activeVisitId && (
        <div className="border-b border-white/10 p-3 bg-zinc-950/30">
          <TelehealthVideoCall
            visitId={activeVisitId}
            initiator={true}
            onEnd={() => setActiveVisitId(null)}
          />
        </div>
      )}

      <div className="max-h-[32rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : visits.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Video className="w-6 h-6 mx-auto mb-2 opacity-30" />No telehealth visits yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visits.map(v => (
              <li key={v.id} className="px-4 py-2.5 hover:bg-white/[0.02] flex items-center gap-3">
                <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', STATUS_STYLE[v.status])}>{v.status.replace('_', ' ')}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{patientName(v.patientId)}{v.provider && <span className="text-[10px] text-gray-400"> · {v.provider}</span>}</div>
                  <div className="text-[10px] text-gray-400 truncate">
                    {new Date(v.scheduledAt).toLocaleString()} · {v.roomProvider}
                    {v.videoReady === false && <span className="text-amber-400/80"> · video not configured</span>}
                  </div>
                </div>
                {/* External-client fallback for visits using a Daily.co room URL.
                    For concord-webrtc rooms, the in-lens video tile renders below
                    via the `activeVisitId` state — the user clicks Start and the
                    WebRTC call mounts directly inside the panel. */}
                {v.roomUrl ? (
                  <a href={v.roomUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-0.5 text-[10px] rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 inline-flex items-center gap-0.5"><ExternalLink className="w-3 h-3" />Open in Daily</a>
                ) : null}
                {v.status === 'scheduled' && (
                  <button onClick={() => { void setStatus(v.id, 'in_progress'); setActiveVisitId(v.id); }} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-0.5"><Play className="w-3 h-3" />Start</button>
                )}
                {v.status === 'in_progress' && (
                  <>
                    {activeVisitId !== v.id && (
                      <button onClick={() => setActiveVisitId(v.id)} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 inline-flex items-center gap-0.5"><Video className="w-3 h-3" />Join</button>
                    )}
                    <button onClick={() => { void setStatus(v.id, 'completed'); if (activeVisitId === v.id) setActiveVisitId(null); }} className="px-2 py-0.5 text-[10px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center gap-0.5"><CheckCircle className="w-3 h-3" />End</button>
                  </>
                )}
                {v.status === 'scheduled' && (
                  <>
                    <button onClick={() => setStatus(v.id, 'no_show')} className="px-2 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 inline-flex items-center gap-0.5"><UserX className="w-3 h-3" />No-show</button>
                    <button onClick={() => setStatus(v.id, 'cancelled')} className="px-2 py-0.5 text-[10px] rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 inline-flex items-center gap-0.5"><XCircle className="w-3 h-3" />Cancel</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TelehealthPanel;
