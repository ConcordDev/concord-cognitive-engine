'use client';

// ProductionCreditsPanel — Sprint B Item #11.
//
// Credits panel for any track DTU. Shows existing credits + lets the
// track owner add a new credit (producer userId + role + contribution
// share). Surfaces inline on the track inspector.

import { useState, useEffect, useCallback } from 'react';
import { Award, Plus, X, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Credit {
  id: string;
  production_dtu_id: string;
  producer_user_id: string;
  role: string;
  contribution_ratio: number;
  skill_level_at_credit: number;
  cc_payment_at_credit: number;
  notes?: string;
  created_at: number;
}

interface ProductionCreditsPanelProps {
  trackDtuId: string;
  trackTitle?: string;
  isOwner: boolean;
}

const ROLES = [
  'mixer', 'arranger', 'mastering', 'co_producer',
  'session_player', 'vocal_producer', 'sound_designer',
];

const ROLE_LABELS: Record<string, string> = {
  mixer: 'Mixer',
  arranger: 'Arranger',
  mastering: 'Mastering Engineer',
  co_producer: 'Co-Producer',
  session_player: 'Session Player',
  vocal_producer: 'Vocal Producer',
  sound_designer: 'Sound Designer',
};

export default function ProductionCreditsPanel({
  trackDtuId, trackTitle, isOwner,
}: ProductionCreditsPanelProps) {
  const [credits, setCredits] = useState<Credit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Draft for the "add credit" form
  const [producerId, setProducerId] = useState('');
  const [role, setRole] = useState('mixer');
  const [contribution, setContribution] = useState(0.2);
  const [ccPayment, setCcPayment] = useState(0);
  const [notes, setNotes] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain: 'studio', name: 'list_credits',
          input: { track_dtuId: trackDtuId },
        }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (result?.ok) setCredits(result.credits || []);
      else setError(result?.reason || 'load_failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request_failed');
    } finally {
      setLoading(false);
    }
  }, [trackDtuId]);

  useEffect(() => { refresh(); }, [refresh]);

  const submitCredit = useCallback(async () => {
    if (!producerId.trim()) {
      setError('producer_user_id required');
      return;
    }
    setError(null);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain: 'studio', name: 'credit_producer',
          input: {
            track_dtuId: trackDtuId,
            producer_user_id: producerId.trim(),
            role,
            contribution_ratio: contribution,
            cc_payment_at_credit: ccPayment,
            notes: notes || undefined,
          },
        }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (result?.ok) {
        setAdding(false);
        setProducerId('');
        setNotes('');
        await refresh();
      } else {
        setError(result?.reason || 'credit_failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request_failed');
    }
  }, [producerId, role, contribution, ccPayment, notes, trackDtuId, refresh]);

  return (
    <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-xs font-semibold">Production Credits</h3>
          {trackTitle && <span className="text-[10px] text-gray-500">· {trackTitle}</span>}
        </div>
        {isOwner && (
          <button
            onClick={() => setAdding(v => !v)}
            className="text-[10px] text-gray-400 hover:text-white flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add credit
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-[10px] text-red-300 flex items-start gap-2">
          <X className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {adding && (
        <div className="bg-black/40 rounded p-2 space-y-2 border border-white/10">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              Producer user id
              <input
                type="text" value={producerId}
                onChange={e => setProducerId(e.target.value)}
                placeholder="e.g. user_abc123"
                className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              Role
              <select
                value={role} onChange={e => setRole(e.target.value)}
                className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
              >
                {ROLES.map(r => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              Contribution share
              <input
                type="range" min={0.01} max={1} step={0.01} value={contribution}
                onChange={e => setContribution(Number(e.target.value))}
                className="w-full accent-neon-cyan"
              />
              <span className="text-[9px] text-gray-500 font-mono">{(contribution * 100).toFixed(0)}%</span>
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-gray-400">
              Up-front CC paid
              <input
                type="number" min={0} step={0.01} value={ccPayment}
                onChange={e => setCcPayment(Number(e.target.value))}
                className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
              />
            </label>
          </div>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value.slice(0, 2000))}
            placeholder="Optional notes about what they did…"
            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
            rows={2}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setAdding(false)}
              className="px-2 py-1 text-[10px] text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={submitCredit}
              className="px-3 py-1 bg-neon-cyan/20 text-neon-cyan rounded text-[10px] font-medium hover:bg-neon-cyan/30"
            >
              Credit producer
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-[10px] text-gray-500 italic">Loading credits…</div>
      ) : credits.length === 0 ? (
        <div className="text-[10px] text-gray-500 italic flex items-center gap-2">
          <Users className="w-3 h-3" />
          No collaborators credited on this track yet.
        </div>
      ) : (
        <ul className="space-y-1">
          {credits.map(c => (
            <li
              key={c.id}
              className="flex items-start gap-2 p-2 bg-black/30 rounded border border-white/5"
            >
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">
                  {ROLE_LABELS[c.role] || c.role}
                  <span className="text-[10px] text-gray-500 ml-2">
                    @{c.producer_user_id.slice(0, 16)}{c.producer_user_id.length > 16 ? '…' : ''}
                  </span>
                </div>
                <div className="text-[10px] text-gray-500">
                  {(c.contribution_ratio * 100).toFixed(0)}% share
                  · skill {c.skill_level_at_credit}
                  {c.cc_payment_at_credit > 0 && ` · paid ${c.cc_payment_at_credit.toFixed(2)} CC`}
                </div>
                {c.notes && (
                  <div className="text-[10px] text-gray-400 mt-1 italic">"{c.notes}"</div>
                )}
              </div>
              <span className={cn(
                'text-[9px] px-1.5 py-0.5 rounded font-mono',
                c.contribution_ratio >= 0.5 ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/10 text-gray-400',
              )}>
                {(c.contribution_ratio * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
