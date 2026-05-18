'use client';

import { useEffect, useState } from 'react';
import { FileText, Plus, Loader2, Clock, Check, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface FOIARequest {
  id: string;
  agency: string;
  subject: string;
  body: string;
  submittedAt: string;
  status: 'draft' | 'submitted' | 'acknowledged' | 'in_review' | 'fulfilled' | 'denied';
  trackingNumber?: string;
  responseDate?: string;
}

const TEMPLATES = [
  {
    title: 'Government contracts (vendor X)',
    agency: 'GSA',
    body: 'I request all records of contracts awarded to [VENDOR] between [DATE 1] and [DATE 2], including:\n- Contract numbers and dollar values\n- Statements of work\n- Award justifications\n- Modifications and amendments\n\nI request these records in electronic format. I am willing to pay reasonable fees up to $50; please notify me if fees will exceed this amount.',
  },
  {
    title: 'Police incident reports (date range)',
    agency: 'Local PD',
    body: 'I request copies of all incident reports filed at [LOCATION] between [DATE 1] and [DATE 2], including:\n- Initial responding officer narratives\n- Photographs (redacted as needed)\n- Disposition status\n\nI request electronic delivery and waive fees up to $25.',
  },
  {
    title: 'Communications between officials',
    agency: '[AGENCY]',
    body: 'I request all email correspondence between [OFFICIAL A] and [OFFICIAL B] between [DATE 1] and [DATE 2] mentioning [TOPIC/KEYWORD]. Please include cc/bcc recipients.\n\nElectronic delivery preferred. Public-interest fee waiver requested.',
  },
  {
    title: 'Inspector general reports',
    agency: 'IG / OIG',
    body: 'I request copies of all Inspector General reports issued in calendar year [YEAR] relating to [PROGRAM/TOPIC], including:\n- Final published reports\n- Underlying audit working papers (where not exempt)\n- Management responses\n\nElectronic delivery, fee waiver requested for public interest reporting.',
  },
];

export function FOIATracker() {
  const [requests, setRequests] = useState<FOIARequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draftAgency, setDraftAgency] = useState('');
  const [draftSubject, setDraftSubject] = useState('');
  const [draftBody, setDraftBody] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'government', action: 'foia-list', input: {} });
      setRequests((res.data?.result?.requests || []) as FOIARequest[]);
    } catch (e) { console.error('[FOIA] failed', e); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!draftAgency.trim() || !draftSubject.trim() || !draftBody.trim()) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'government', action: 'foia-create',
        input: { agency: draftAgency.trim(), subject: draftSubject.trim(), body: draftBody.trim() },
      });
      setDraftAgency(''); setDraftSubject(''); setDraftBody(''); setCreating(false);
      await refresh();
    } catch (e) { console.error('[FOIA] save failed', e); }
  }

  function applyTemplate(t: typeof TEMPLATES[0]) {
    setDraftAgency(t.agency);
    setDraftSubject(t.title);
    setDraftBody(t.body);
    setCreating(true);
  }

  const STATUS_ICON: Record<FOIARequest['status'], React.ReactNode> = {
    draft: <FileText className="w-3.5 h-3.5 text-gray-400" />,
    submitted: <Clock className="w-3.5 h-3.5 text-blue-400" />,
    acknowledged: <Clock className="w-3.5 h-3.5 text-cyan-400" />,
    in_review: <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" />,
    fulfilled: <Check className="w-3.5 h-3.5 text-green-400" />,
    denied: <X className="w-3.5 h-3.5 text-red-400" />,
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">FOIA tracker</span>
        <span className="ml-auto text-[10px] text-gray-500">{requests.length} requests</span>
        <button onClick={() => setCreating(v => !v)} className="p-1 text-gray-400 hover:text-white" title="New request">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {creating && (
        <div className="p-3 border-b border-white/10 space-y-2">
          <div className="flex items-center gap-2 flex-wrap text-[10px]">
            <span className="text-gray-500 uppercase tracking-wider">Templates:</span>
            {TEMPLATES.map(t => (
              <button key={t.title} onClick={() => applyTemplate(t)} className="px-2 py-0.5 rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10">
                {t.title}
              </button>
            ))}
          </div>
          <input value={draftAgency} onChange={e => setDraftAgency(e.target.value)} placeholder="Agency (e.g. FBI, GSA, Local PD)" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draftSubject} onChange={e => setDraftSubject(e.target.value)} placeholder="Subject" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} rows={8} placeholder="Request body..." className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono resize-y" />
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={!draftAgency.trim() || !draftSubject.trim() || !draftBody.trim()} className="px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">Save draft</button>
            <button onClick={() => setCreating(false)} className="px-3 py-1 text-xs rounded border border-white/10 text-gray-400 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : requests.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">No FOIA requests yet. Use a template above to start.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {requests.map(r => (
              <li key={r.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  {STATUS_ICON[r.status]}
                  <span className="text-sm text-white font-medium">{r.subject}</span>
                  <span className={cn('ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold',
                    r.status === 'fulfilled' ? 'bg-green-500/20 text-green-300' :
                    r.status === 'denied' ? 'bg-red-500/20 text-red-300' :
                    r.status === 'in_review' ? 'bg-yellow-500/20 text-yellow-300' :
                    'bg-gray-500/20 text-gray-300'
                  )}>{r.status.replace(/_/g, ' ')}</span>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  {r.agency} · {new Date(r.submittedAt).toLocaleDateString()}
                  {r.trackingNumber && ` · #${r.trackingNumber}`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default FOIATracker;
