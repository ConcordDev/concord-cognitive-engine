'use client';

// SessionPlayerPanel — Sprint B Item #1.
//
// A producer's hub for AI Session Players. Summon a player per role,
// have them generate patterns, mentor them with text feedback, then
// publish the trained player as an agent_spec DTU so other producers
// can hire them.

import { useState, useCallback, useEffect } from 'react';
import {
  Users, Drum, Music2, Piano, Waves, MessageSquare, Sparkles, Send,
  Share2, RefreshCw, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Role = 'drummer' | 'bass_player' | 'keys_player' | 'synth_player';

interface SessionPlayer {
  id: string;
  title: string;
  meta: {
    role: Role;
    generation_count?: number;
    skill_level?: number;
    mentorship_log?: Array<{ feedback: string; given_at: number }>;
  };
  created_at: number;
}

interface GeneratedNote {
  tick: number;
  pitch: number;
  velocity: number;
  duration: number;
}

interface SessionPlayerPanelProps {
  bpm: number;
  trackKey?: string;
  trackMood?: string;
  onPasteIntoTrack?: (notes: GeneratedNote[], playerId: string) => void;
  onCancel?: () => void;
}

const ROLE_META: Record<Role, { label: string; icon: typeof Drum; color: string }> = {
  drummer:      { label: 'Drummer',     icon: Drum,   color: 'neon-purple' },
  bass_player:  { label: 'Bass Player', icon: Music2, color: 'neon-green' },
  keys_player:  { label: 'Keys Player', icon: Piano,  color: 'neon-cyan' },
  synth_player: { label: 'Synth Player',icon: Waves,  color: 'neon-pink' },
};

export default function SessionPlayerPanel({
  bpm, trackKey, trackMood,
  onPasteIntoTrack, onCancel,
}: SessionPlayerPanelProps) {
  const [players, setPlayers] = useState<SessionPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastNotes, setLastNotes] = useState<Record<string, GeneratedNote[]>>({});
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPublish, setShowPublish] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: 'studio', name: 'player_list', input: {} }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (result?.ok) setPlayers(result.players || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const summon = useCallback(async (role: Role) => {
    setBusyAction(`summon-${role}`);
    setError(null);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: 'studio', name: 'player_summon', input: { role } }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (result?.ok) {
        await refresh();
        setActiveId(result.playerId);
      } else {
        setError(result?.reason || 'summon_failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request_failed');
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const generate = useCallback(async (playerId: string) => {
    setBusyAction(`gen-${playerId}`);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain: 'studio', name: 'player_generate',
          input: { playerId, bars: 4, context: { bpm, key: trackKey, mood: trackMood } },
        }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (result?.ok) {
        setLastNotes(prev => ({ ...prev, [playerId]: result.notes }));
        await refresh();
      } else {
        setError(result?.reason || 'generate_failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request_failed');
    } finally {
      setBusyAction(null);
    }
  }, [bpm, trackKey, trackMood, refresh]);

  const mentor = useCallback(async (playerId: string) => {
    const feedback = feedbackDraft.trim();
    if (!feedback) return;
    setBusyAction(`mentor-${playerId}`);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: 'studio', name: 'player_mentor', input: { playerId, feedback } }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (result?.ok) {
        setFeedbackDraft('');
        await refresh();
      } else {
        setError(result?.reason || 'mentor_failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request_failed');
    } finally {
      setBusyAction(null);
    }
  }, [feedbackDraft, refresh]);

  const publish = useCallback(async (playerId: string, priceCents: number, license: string) => {
    setBusyAction(`publish-${playerId}`);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain: 'studio', name: 'player_publish',
          input: { playerId, priceCents, license },
        }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (result?.ok) {
        setShowPublish(null);
        await refresh();
      } else {
        setError(result?.reason || 'publish_failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request_failed');
    } finally {
      setBusyAction(null);
    }
  }, [refresh]);

  const active = players.find(p => p.id === activeId);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-neon-purple" />
          <h2 className="text-lg font-bold">Session Players</h2>
          <span className="text-[10px] text-gray-500">Logic Pro 11 parity, but publishable</span>
        </div>
        {onCancel && (
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-white">
            Close
          </button>
        )}
      </div>

      {/* Summon panel */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10">
        <div className="text-[10px] text-gray-400 uppercase mb-2">Summon a player</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {(Object.entries(ROLE_META) as [Role, typeof ROLE_META[Role]][]).map(([role, m]) => {
            const Icon = m.icon;
            return (
              <button
                key={role}
                onClick={() => summon(role)}
                disabled={busyAction === `summon-${role}`}
                className={cn(
                  'flex flex-col items-center gap-1 px-3 py-3 rounded border transition-colors',
                  `bg-${m.color}/10 hover:bg-${m.color}/20 text-${m.color} border-${m.color}/30 disabled:opacity-50`,
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Roster */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-gray-400 uppercase">Your roster</div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1"
          >
            <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> Refresh
          </button>
        </div>
        {players.length === 0 ? (
          <div className="text-xs text-gray-500 italic">
            No players yet — summon one above.
          </div>
        ) : (
          <div className="space-y-1.5">
            {players.map(p => {
              const m = ROLE_META[p.meta.role];
              const Icon = m?.icon || Users;
              return (
                <button
                  key={p.id}
                  onClick={() => setActiveId(p.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded border text-left transition-colors',
                    activeId === p.id
                      ? `bg-${m.color}/10 border-${m.color}/40`
                      : 'bg-black/30 border-white/10 hover:border-white/20',
                  )}
                >
                  <Icon className={`w-4 h-4 text-${m.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{p.title}</div>
                    <div className="text-[9px] text-gray-500">
                      {m?.label} · gen {p.meta.generation_count || 0} · skill {(p.meta.skill_level || 1).toFixed(2)}
                      {(p.meta.mentorship_log?.length || 0) > 0 && ` · ${p.meta.mentorship_log!.length} mentor notes`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Active player workspace */}
      {active && (
        <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{active.title}</div>
              <div className="text-[10px] text-gray-500">{ROLE_META[active.meta.role]?.label}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => generate(active.id)}
                disabled={busyAction === `gen-${active.id}`}
                className="px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-xs font-medium hover:bg-neon-cyan/30 disabled:opacity-50 flex items-center gap-1"
              >
                <Sparkles className={cn('w-3 h-3', busyAction === `gen-${active.id}` && 'animate-pulse')} />
                Generate
              </button>
              <button
                onClick={() => setShowPublish(active.id)}
                className="px-3 py-1.5 bg-neon-purple/20 text-neon-purple rounded text-xs font-medium hover:bg-neon-purple/30 flex items-center gap-1"
              >
                <Share2 className="w-3 h-3" /> Publish
              </button>
            </div>
          </div>

          {/* Generated notes preview + paste */}
          {lastNotes[active.id] && (
            <div className="bg-black/40 rounded p-2 space-y-2">
              <div className="text-[10px] text-gray-400">
                Latest pattern — {lastNotes[active.id].length} notes
              </div>
              <PianoRollPreview notes={lastNotes[active.id]} />
              {onPasteIntoTrack && (
                <button
                  onClick={() => onPasteIntoTrack(lastNotes[active.id], active.id)}
                  className="w-full px-3 py-1.5 bg-neon-green/20 text-neon-green rounded text-xs font-medium hover:bg-neon-green/30"
                >
                  Paste into active track
                </button>
              )}
            </div>
          )}

          {/* Mentor */}
          <div className="bg-black/30 rounded p-2 space-y-2">
            <div className="flex items-center gap-2 text-[10px] text-gray-400">
              <MessageSquare className="w-3 h-3" /> Mentor — feedback biases the next generation
            </div>
            <div className="flex gap-2">
              <input
                type="text" value={feedbackDraft}
                onChange={e => setFeedbackDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') mentor(active.id); }}
                placeholder='e.g. "more snare on the and of 2", "lay back behind the beat"'
                className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
              />
              <button
                onClick={() => mentor(active.id)}
                disabled={!feedbackDraft.trim() || busyAction === `mentor-${active.id}`}
                className="px-3 py-1 bg-neon-purple/20 text-neon-purple rounded text-xs hover:bg-neon-purple/30 disabled:opacity-50 flex items-center gap-1"
              >
                <Send className="w-3 h-3" /> Mentor
              </button>
            </div>
            {(active.meta.mentorship_log?.length || 0) > 0 && (
              <div className="text-[10px] text-gray-500 max-h-32 overflow-y-auto space-y-0.5">
                {active.meta.mentorship_log!.slice(-8).reverse().map((m, i) => (
                  <div key={i}>· {m.feedback}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Publish modal */}
      {showPublish && (
        <PublishDialog
          onCancel={() => setShowPublish(null)}
          onPublish={(price, license) => publish(showPublish, price, license)}
          busy={busyAction === `publish-${showPublish}`}
        />
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300 flex items-start gap-2">
          <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function PianoRollPreview({ notes }: { notes: GeneratedNote[] }) {
  if (notes.length === 0) return null;
  const maxTick = Math.max(...notes.map(n => n.tick + n.duration));
  const pitches = notes.map(n => n.pitch);
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);
  const range = Math.max(1, maxPitch - minPitch);
  return (
    <svg className="w-full h-24" viewBox={`0 0 ${maxTick} ${range + 1}`} preserveAspectRatio="none">
      {notes.map((n, i) => (
        <rect
          key={i}
          x={n.tick}
          y={maxPitch - n.pitch}
          width={n.duration}
          height={1}
          fill="rgb(34 211 238)"
          opacity={0.3 + (n.velocity / 127) * 0.7}
        />
      ))}
    </svg>
  );
}

function PublishDialog({
  onCancel, onPublish, busy,
}: {
  onCancel: () => void;
  onPublish: (priceCents: number, license: string) => void;
  busy: boolean;
}) {
  const [priceUsd, setPriceUsd] = useState(0);
  const [license, setLicense] = useState('CC-BY-SA-4.0');
  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-black border border-white/10 rounded-xl p-4 max-w-md w-full space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold">Publish Session Player</h3>
        <p className="text-xs text-gray-400">
          Your trained player will be wrapped as a <code className="bg-white/10 px-1 rounded">agent_spec</code> DTU.
          Other producers can hire it; the royalty cascade pays you on every use.
        </p>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">
          Price (USD)
          <input
            type="number" min={0} step={0.50} value={priceUsd}
            onChange={e => setPriceUsd(Math.max(0, Number(e.target.value)))}
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
          />
          <span className="text-[9px] text-gray-500">0 = free; paid players require an entry fee per hire</span>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">
          License
          <select
            value={license} onChange={e => setLicense(e.target.value)}
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
          >
            <option value="CC-BY-4.0">CC-BY-4.0 (attribution)</option>
            <option value="CC-BY-SA-4.0">CC-BY-SA-4.0 (attribution, share-alike)</option>
            <option value="MIT">MIT</option>
            <option value="Apache-2.0">Apache-2.0</option>
            <option value="proprietary">Proprietary</option>
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => onPublish(Math.round(priceUsd * 100), license)}
            disabled={busy}
            className="px-3 py-1.5 bg-neon-purple/20 text-neon-purple rounded text-xs font-medium hover:bg-neon-purple/30 disabled:opacity-50"
          >
            {busy ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  );
}
