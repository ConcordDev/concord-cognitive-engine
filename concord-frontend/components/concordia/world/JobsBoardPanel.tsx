'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Briefcase, CheckCircle, Zap } from 'lucide-react';

interface Job {
  id: string;
  title: string;
  description?: string;
  lens_id?: string;
  reward_sparks: number;
  required_skill?: string;
  required_skill_level?: number;
  status?: string;
}

const LENS_EMOJI: Record<string, string> = {
  studio: '🎵', architecture: '🏛️', code: '💻', research: '📚', materials: '⚗️',
  marketplace: '🏪', engineering: '⚙️', 'game-design': '🎮', science: '🔬',
};

interface JobsBoardPanelProps {
  playerId?: string;
  onClose?: () => void;
}

export function JobsBoardPanel({ playerId: _playerId, onClose }: JobsBoardPanelProps) {
  const [tab, setTab] = useState<'available' | 'mine'>('available');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/world/jobs');
      if (r.ok) {
        const d = await r.json();
        setJobs(d.jobs ?? []);
        setMyJobs(d.myJobs ?? []);
      }
    } catch { /* offline — show empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const accept = async (jobId: string) => {
    setActionId(jobId);
    try {
      await fetch(`/api/world/jobs/${jobId}/accept`, { method: 'POST' });
      load();
    } catch { /* offline */ }
    setActionId(null);
  };

  const complete = async (jobId: string) => {
    setActionId(jobId);
    try {
      const r = await fetch(`/api/world/jobs/${jobId}/complete`, { method: 'POST' });
      const d = await r.json();
      if (d.awarded) {
        // Brief toast could go here
      }
      load();
    } catch { /* offline */ }
    setActionId(null);
  };

  const displayJobs = tab === 'available' ? jobs : myJobs;

  return (
    <div className="fixed right-4 top-20 w-80 bg-black/90 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[70vh] z-40">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-amber-400" />
          <h2 className="text-white font-bold text-sm">Jobs Board</h2>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        {(['available', 'mine'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium capitalize transition-colors ${
              tab === t ? 'text-white border-b-2 border-amber-400' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {t === 'mine' ? 'My Jobs' : 'Available'}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto flex-1 p-3 space-y-2">
        {loading ? (
          <div className="text-white/30 text-xs text-center py-8">Loading…</div>
        ) : displayJobs.length === 0 ? (
          <div className="text-white/30 text-xs text-center py-8">
            {tab === 'available' ? 'No jobs available right now' : 'No active jobs'}
          </div>
        ) : (
          displayJobs.map(job => (
            <div key={job.id} className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-lg">{LENS_EMOJI[job.lens_id ?? ''] ?? '💼'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-semibold truncate">{job.title}</div>
                  {job.description && (
                    <div className="text-white/40 text-[10px] mt-0.5 line-clamp-2">{job.description}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0 text-yellow-400 text-xs font-bold">
                  <Zap className="w-3 h-3" />{job.reward_sparks}
                </div>
              </div>

              {job.lens_id && (
                <div className="text-white/30 text-[10px]">
                  Open the <span className="text-indigo-400">{job.lens_id}</span> portal to progress this job
                </div>
              )}

              {tab === 'available' ? (
                <button
                  onClick={() => accept(job.id)}
                  disabled={actionId === job.id}
                  className="w-full text-xs bg-amber-600/40 hover:bg-amber-600/70 text-amber-200 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {actionId === job.id ? 'Accepting…' : 'Accept Job'}
                </button>
              ) : (
                <button
                  onClick={() => complete(job.id)}
                  disabled={actionId === job.id}
                  className="w-full text-xs bg-green-600/40 hover:bg-green-600/70 text-green-200 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  <CheckCircle className="w-3 h-3" />
                  {actionId === job.id ? 'Completing…' : 'Mark Complete'}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
