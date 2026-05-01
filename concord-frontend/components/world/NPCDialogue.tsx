'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, ChevronRight, Skull, Heart, AlertTriangle, Briefcase } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DialogueOption {
  label: string;
  key: string;
}

interface QuestOffered {
  id: string;
  title: string;
  description: string;
  reward?: unknown;
}

interface NPCState {
  id: string;
  name: string;
  archetype: string;
  faction?: string;
  isConscious?: boolean;
  griefLevel?: number;
  criminalRep?: number;
  isWanted?: boolean;
  currentHp?: number;
  maxHp?: number;
  jobType?: string;
}

interface NPCDialogueProps {
  npc: NPCState;
  worldId: string;
  onClose: () => void;
  onQuestAccepted?: (questId: string) => void;
}

// ── Mood colours ───────────────────────────────────────────────────────────────

const MOOD_CONFIG = {
  friendly: { ring: 'border-emerald-500/60', label: 'Friendly', dot: 'bg-emerald-400' },
  neutral: { ring: 'border-white/20', label: 'Neutral', dot: 'bg-gray-400' },
  suspicious: { ring: 'border-amber-500/60', label: 'Suspicious', dot: 'bg-amber-400' },
  grieving: { ring: 'border-blue-500/60', label: 'Grieving', dot: 'bg-blue-400' },
  fearful: { ring: 'border-purple-500/60', label: 'Fearful', dot: 'bg-purple-400' },
  hostile: { ring: 'border-red-500/60', label: 'Hostile', dot: 'bg-red-400' },
} as const;

type Mood = keyof typeof MOOD_CONFIG;

// ── Archetype avatar emoji ─────────────────────────────────────────────────────
const ARCHETYPE_EMOJI: Record<string, string> = {
  guard: '🛡',
  soldier: '⚔',
  merchant: '🛒',
  blacksmith: '🔨',
  mage: '🔮',
  priest: '✨',
  detective: '🔍',
  criminal: '🗡',
  bandit: '💀',
  farmer: '🌾',
  innkeeper: '🍺',
  scholar: '📚',
  hunter: '🏹',
  alchemist: '⚗',
  default: '👤',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function NPCDialogue({ npc, worldId, onClose, onQuestAccepted }: NPCDialogueProps) {
  const [phase, setPhase] = useState<'loading' | 'greeting' | 'responding' | 'done'>('loading');
  const [greeting, setGreeting] = useState('');
  const [mood, setMood] = useState<Mood>('neutral');
  const [options, setOptions] = useState<DialogueOption[]>([]);
  const [subtext, setSubtext] = useState<string | undefined>();
  const [response, setResponse] = useState('');
  const [questOffered, setQuestOffered] = useState<QuestOffered | null>(null);
  const [acceptingQuest, setAcceptingQuest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Open dialogue ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setError(null);

    fetch(`/api/worlds/${worldId}/npcs/${npc.id}/dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) {
          setError(data.error || 'Could not reach NPC');
          setPhase('done');
          return;
        }
        setGreeting(data.greeting || `${npc.name} looks at you.`);
        setMood((data.mood as Mood) || 'neutral');
        setOptions(data.options || [{ label: 'Leave', key: 'goodbye' }]);
        setSubtext(data.subtext);
        setPhase('greeting');
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not reach NPC.');
          setPhase('done');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [npc.id, npc.name, worldId]);

  // ── Player selects option ────────────────────────────────────────────────────
  const choose = useCallback(
    async (option: DialogueOption) => {
      if (option.key === 'goodbye') {
        onClose();
        return;
      }

      setPhase('responding');
      setResponse('');
      setQuestOffered(null);

      try {
        const r = await fetch(`/api/worlds/${worldId}/npcs/${npc.id}/dialogue/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ choice: option.key }),
        });
        const data = await r.json();
        setResponse(data.response || `${npc.name} nods.`);
        if (data.questOffered) setQuestOffered(data.questOffered);
      } catch {
        setResponse("They don't respond.");
      }

      setPhase('greeting'); // return to options after response
    },
    [npc.id, npc.name, worldId, onClose]
  );

  // ── Accept quest ─────────────────────────────────────────────────────────────
  const acceptQuest = useCallback(async () => {
    if (!questOffered) return;
    setAcceptingQuest(true);
    try {
      await fetch(`/api/worlds/${worldId}/quests/${questOffered.id}/accept`, { method: 'POST' });
      onQuestAccepted?.(questOffered.id);
      setResponse(`Quest accepted: "${questOffered.title}". Good luck.`);
      setQuestOffered(null);
    } catch {
      /* non-fatal */
    }
    setAcceptingQuest(false);
  }, [questOffered, worldId, onQuestAccepted]);

  // ── Render ───────────────────────────────────────────────────────────────────
  const moodCfg = MOOD_CONFIG[mood] ?? MOOD_CONFIG.neutral;
  const hpPct = npc.maxHp
    ? Math.max(0, Math.min(100, ((npc.currentHp ?? npc.maxHp) / npc.maxHp) * 100))
    : 100;
  const emoji = ARCHETYPE_EMOJI[npc.archetype] ?? ARCHETYPE_EMOJI.default;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pb-24 px-4 pointer-events-none">
      <div
        className={`pointer-events-auto w-full max-w-lg bg-black/95 border ${moodCfg.ring} rounded-2xl shadow-2xl overflow-hidden`}
      >
        {/* NPC header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <div className="relative flex-shrink-0">
            <div
              className={`w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-xl border ${moodCfg.ring}`}
            >
              {emoji}
            </div>
            {/* Mood dot */}
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-black ${moodCfg.dot}`}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white truncate">{npc.name}</span>
              {npc.isWanted && (
                <span className="text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-medium">
                  WANTED
                </span>
              )}
              {npc.isConscious && (
                <span className="text-[10px] bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.5 rounded">
                  EMERGENT
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] text-white/40 capitalize">{npc.archetype}</span>
              {npc.jobType && <span className="text-[10px] text-white/30">· {npc.jobType}</span>}
              <span className={`text-[10px] ${moodCfg.dot.replace('bg-', 'text-')}`}>
                {moodCfg.label}
              </span>
            </div>
          </div>

          {/* HP bar */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${hpPct > 50 ? 'bg-emerald-400' : hpPct > 25 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
            <span className="text-[9px] text-white/30">{Math.round(npc.currentHp ?? 100)} HP</span>
          </div>

          <button
            onClick={onClose}
            className="text-white/30 hover:text-white transition-colors ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* State badges */}
        {((npc.griefLevel ?? 0) > 0.4 || (npc.criminalRep ?? 0) > 0.4) && (
          <div className="flex gap-2 px-4 py-1.5 border-b border-white/5 bg-white/3">
            {(npc.griefLevel ?? 0) > 0.4 && (
              <div className="flex items-center gap-1 text-[10px] text-blue-300/80">
                <Heart className="w-2.5 h-2.5" /> Grieving
              </div>
            )}
            {(npc.criminalRep ?? 0) > 0.4 && (
              <div className="flex items-center gap-1 text-[10px] text-red-300/80">
                <Skull className="w-2.5 h-2.5" /> Criminal reputation
              </div>
            )}
          </div>
        )}

        {/* Dialogue body */}
        <div className="px-4 py-4 min-h-[100px]">
          {phase === 'loading' && (
            <div className="flex items-center gap-2 text-white/40 text-sm">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Approaching…
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-400/80 text-sm">
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </div>
          )}

          {(phase === 'greeting' || phase === 'responding') && (
            <>
              {/* NPC speech */}
              <div className="text-sm text-white/90 leading-relaxed mb-1">
                {response || greeting}
              </div>
              {subtext && !response && (
                <div className="text-[11px] text-white/30 italic mt-1">{subtext}</div>
              )}

              {/* Quest card */}
              {questOffered && (
                <div className="mt-3 p-3 rounded-lg bg-amber-900/20 border border-amber-500/30">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Briefcase className="w-3 h-3 text-amber-400" />
                    <span className="text-xs font-semibold text-amber-300">
                      {questOffered.title}
                    </span>
                  </div>
                  <p className="text-[11px] text-white/60 leading-relaxed mb-2">
                    {questOffered.description}
                  </p>
                  <button
                    onClick={acceptQuest}
                    disabled={acceptingQuest}
                    className="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                  >
                    {acceptingQuest ? 'Accepting…' : 'Accept Quest'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Options */}
        {phase === 'greeting' && options.length > 0 && (
          <div className="border-t border-white/10 px-4 pb-4 pt-3 flex flex-col gap-1.5">
            {options.map((opt) => (
              <button
                key={opt.key}
                onClick={() => choose(opt)}
                className="flex items-center justify-between gap-2 text-left text-sm text-white/70 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors group"
              >
                <span>{opt.label}</span>
                <ChevronRight className="w-3.5 h-3.5 text-white/20 group-hover:text-white/50 flex-shrink-0" />
              </button>
            ))}
          </div>
        )}

        {phase === 'responding' && (
          <div className="border-t border-white/10 px-4 pb-4 pt-3 flex items-center gap-2 text-white/30 text-xs">
            <Loader2 className="w-3 h-3 animate-spin" /> {npc.name} responds…
          </div>
        )}
      </div>
    </div>
  );
}
