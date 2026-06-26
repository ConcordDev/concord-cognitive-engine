'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, Loader2, ChevronRight, Skull, Heart, AlertTriangle, Briefcase } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DialogueOption {
  label: string;
  key: string;
}

// Hand-authored branching dialogue tree (content/dialogues/*.json), shipped on
// the /dialogue response when one exists for this NPC. The walk is purely
// client-side — trees are immutable per release.
interface AuthoredPlayerOption { text: string; leadsTo: string }
interface AuthoredNode { id: string; npcText: string; playerOptions?: AuthoredPlayerOption[] }
interface AuthoredTree { greeting?: string; nodes?: AuthoredNode[] }

const WALK_PREFIX = '__walk:';

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

// ── Voice profiles per archetype ───────────────────────────────────────────────

interface VoiceProfile {
  pitch: number;
  rate: number;
  preferFemale?: boolean;
}

const VOICE_PROFILES: Record<string, VoiceProfile> = {
  guard: { pitch: 0.8, rate: 0.9, preferFemale: false },
  mage: { pitch: 1.4, rate: 1.0 },
  merchant: { pitch: 1.1, rate: 1.2, preferFemale: true },
  blacksmith: { pitch: 0.7, rate: 0.85, preferFemale: false },
  bandit: { pitch: 0.85, rate: 1.1, preferFemale: false },
  innkeeper: { pitch: 1.0, rate: 1.15, preferFemale: true },
  scholar: { pitch: 1.2, rate: 0.95 },
  priest: { pitch: 1.1, rate: 0.95, preferFemale: true },
  default: { pitch: 1.0, rate: 1.0 },
};

const TTS_SUPPORTED = typeof window !== 'undefined' && 'speechSynthesis' in window;

// ── SVG Face ───────────────────────────────────────────────────────────────────

interface FaceExpressionConfig {
  // Eye: ry shrinks to 1 on blink
  eyeRx: number;
  eyeRy: number;
  // Eyebrow: path d
  browPath: string;
  // Mouth path d (rest position)
  mouthPath: string;
  // Tear element for grieving
  tear?: boolean;
}

const FACE_EXPRESSIONS: Record<Mood, FaceExpressionConfig> = {
  friendly: {
    eyeRx: 4,
    eyeRy: 3.5,
    browPath: 'M 10 12 Q 14 10 18 12',
    mouthPath: 'M 10 26 Q 14 31 18 26',
  },
  neutral: {
    eyeRx: 3.5,
    eyeRy: 3,
    browPath: 'M 10 12 Q 14 11 18 12',
    mouthPath: 'M 10 27 Q 14 27 18 27',
  },
  suspicious: {
    eyeRx: 4,
    eyeRy: 1.8,
    browPath: 'M 10 11 Q 14 13 18 11',
    mouthPath: 'M 10 27 Q 14 26 18 27',
  },
  grieving: {
    eyeRx: 3.5,
    eyeRy: 3,
    browPath: 'M 10 13 Q 14 11 18 13',
    mouthPath: 'M 10 29 Q 14 25 18 29',
    tear: true,
  },
  fearful: {
    eyeRx: 5,
    eyeRy: 5,
    browPath: 'M 10 10 Q 14 8 18 10',
    mouthPath: 'M 10 28 Q 14 26 18 28',
  },
  hostile: {
    eyeRx: 4,
    eyeRy: 2,
    browPath: 'M 10 13 Q 14 14 18 13',
    mouthPath: 'M 10 28 Q 14 24 18 28',
  },
};

// Open mouth path for talking animation
const MOUTH_OPEN = 'M 10 25 Q 14 32 18 25';

interface NPCFaceProps {
  mood: Mood;
  isTalking: boolean;
  moodRing: string;
}

function NPCFace({ mood, isTalking, moodRing }: NPCFaceProps) {
  const expr = FACE_EXPRESSIONS[mood] ?? FACE_EXPRESSIONS.neutral;

  // Blink state: eyeRy becomes 1 briefly
  const [blinkRy, setBlinkRy] = useState(expr.eyeRy);
  const blinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Talking mouth oscillation
  const [mouthOpen, setMouthOpen] = useState(false);
  const talkRafRef = useRef<number | null>(null);
  const talkLastRef = useRef<number>(0);

  // Update eye size when mood changes
  useEffect(() => {
    setBlinkRy(expr.eyeRy);
  }, [expr.eyeRy]);

  // Blink loop
  useEffect(() => {
    let alive = true;

    function scheduleBlink() {
      if (!alive) return;
      // Random interval 3000–5000ms
      const delay = 3000 + Math.random() * 2000;
      blinkTimerRef.current = setTimeout(() => {
        if (!alive) return;
        setBlinkRy(1); // close eyes
        blinkOpenTimerRef.current = setTimeout(() => {
          if (!alive) return;
          setBlinkRy(expr.eyeRy); // open eyes
          scheduleBlink();
        }, 120);
      }, delay);
    }

    scheduleBlink();
    return () => {
      alive = false;
      if (blinkTimerRef.current) clearTimeout(blinkTimerRef.current);
      if (blinkOpenTimerRef.current) clearTimeout(blinkOpenTimerRef.current);
    };
  }, [expr.eyeRy]);

  // Talking oscillation at ~4Hz
  useEffect(() => {
    if (!isTalking) {
      setMouthOpen(false);
      if (talkRafRef.current !== null) {
        cancelAnimationFrame(talkRafRef.current);
        talkRafRef.current = null;
      }
      return;
    }

    talkLastRef.current = 0;

    function frame(ts: number) {
      if (talkLastRef.current === 0) talkLastRef.current = ts;
      const elapsed = ts - talkLastRef.current;
      // 4Hz → toggle every 125ms
      if (elapsed >= 125) {
        setMouthOpen((prev) => !prev);
        talkLastRef.current = ts;
      }
      talkRafRef.current = requestAnimationFrame(frame);
    }

    talkRafRef.current = requestAnimationFrame(frame);
    return () => {
      if (talkRafRef.current !== null) cancelAnimationFrame(talkRafRef.current);
    };
  }, [isTalking]);

  const mouthD = isTalking && mouthOpen ? MOUTH_OPEN : expr.mouthPath;

  return (
    <div className="relative flex-shrink-0">
      <div
        className={`w-12 h-12 rounded-full bg-white/10 flex items-center justify-center border ${moodRing}`}
      >
        <svg
          width="28"
          height="36"
          viewBox="0 0 28 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Head circle */}
          <ellipse cx="14" cy="16" rx="12" ry="14" fill="#C8A97E" />

          {/* Left eye */}
          <ellipse
            cx="10"
            cy="15"
            rx={expr.eyeRx}
            ry={blinkRy}
            fill="#2C1A0E"
            style={{ transition: 'ry 80ms ease-in-out' }}
          />
          {/* Right eye */}
          <ellipse
            cx="18"
            cy="15"
            rx={expr.eyeRx}
            ry={blinkRy}
            fill="#2C1A0E"
            style={{ transition: 'ry 80ms ease-in-out' }}
          />

          {/* Eyebrows */}
          <path
            d={expr.browPath}
            stroke="#5C3D1E"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
            style={{ transition: 'd 300ms ease' }}
          />

          {/* Mouth */}
          <path
            d={mouthD}
            stroke="#5C3D1E"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
            style={{ transition: 'd 80ms ease' }}
          />

          {/* Tear for grieving mood */}
          {expr.tear && <ellipse cx="18" cy="19" rx="1" ry="2" fill="#60A5FA" opacity="0.8" />}
        </svg>
      </div>
      {/* Mood dot */}
      <div
        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-black ${MOOD_CONFIG[mood]?.dot ?? 'bg-gray-400'}`}
      />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NPCDialogue({ npc, worldId, onClose, onQuestAccepted }: NPCDialogueProps) {
  const [phase, setPhase] = useState<'loading' | 'greeting' | 'responding' | 'done'>('loading');
  const [isAgent, setIsAgent] = useState(false); // Wave 7 / C1 — AI disclosure
  const [greeting, setGreeting] = useState('');
  const [mood, setMood] = useState<Mood>('neutral');
  const [options, setOptions] = useState<DialogueOption[]>([]);
  const [subtext, setSubtext] = useState<string | undefined>();
  const [response, setResponse] = useState('');
  // Authored branching dialogue (when the NPC has a hand-authored tree).
  const [tree, setTree] = useState<AuthoredTree | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [questOffered, setQuestOffered] = useState<QuestOffered | null>(null);
  const [acceptingQuest, setAcceptingQuest] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // TTS state
  const [muted, setMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem('npc-tts-muted') === 'true';
  });
  const [isTalking, setIsTalking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const talkCheckRafRef = useRef<number | null>(null);
  // Tier 2 deferral 11: Piper TTS playback handle. When the new path is
  // active this holds the cancel hook; the old utteranceRef is unused.
  const piperHandleRef = useRef<{ cancel: () => void } | null>(null);

  // Cancel TTS and clean up
  const cancelSpeech = useCallback(() => {
    // Piper path
    if (piperHandleRef.current) {
      try { piperHandleRef.current.cancel(); } catch { /* ok */ }
      piperHandleRef.current = null;
    }
    // Web Speech path
    if (TTS_SUPPORTED) {
      try { window.speechSynthesis.cancel(); } catch { /* ok */ }
    }
    utteranceRef.current = null;
    setIsTalking(false);
    if (talkCheckRafRef.current !== null) {
      cancelAnimationFrame(talkCheckRafRef.current);
      talkCheckRafRef.current = null;
    }
  }, []);

  // Poll speechSynthesis.speaking to keep isTalking in sync
  const startTalkingPoll = useCallback(() => {
    if (!TTS_SUPPORTED) return;

    function poll() {
      if (window.speechSynthesis.speaking) {
        setIsTalking(true);
        talkCheckRafRef.current = requestAnimationFrame(poll);
      } else {
        setIsTalking(false);
        talkCheckRafRef.current = null;
      }
    }

    talkCheckRafRef.current = requestAnimationFrame(poll);
  }, []);

  // Speak text
  const speak = useCallback(
    (text: string) => {
      if (muted) return;
      cancelSpeech();

      const profile = VOICE_PROFILES[npc.archetype] ?? VOICE_PROFILES.default;

      // Tier 2 deferral 11: try Piper first, fall back to Web Speech.
      // The Piper module handles the fallback internally — if the network
      // request 4xx's or exceeds the 800ms perceived-lag threshold, it
      // calls back into Web Speech automatically.
      void (async () => {
        try {
          const { speakWithPiperOrFallback } = await import('@/lib/voice/piper-stream');
          const handle = await speakWithPiperOrFallback(
            text,
            { rate: profile.rate, pitch: profile.pitch },
            {
              onStart: () => {
                setIsTalking(true);
                startTalkingPoll();
                try { window.dispatchEvent(new CustomEvent('concordia:dialogue-active', { detail: { npcId: npc.id } })); }
                catch { /* ok */ }
                // Wave 1 deferral 1: light DoF for dialogue framing.
                try {
                  window.dispatchEvent(new CustomEvent('concordia:cinematic-mode', {
                    detail: { active: true, strength: 0.4 },
                  }));
                } catch { /* ok */ }
                // EvoAsset: record interaction with the NPC's dialogue asset
                // so frequently-talked-to NPCs evolve their speech-line variety
                // and visual fidelity ahead of unused ones.
                try {
                  import('@/lib/evo-asset/loader').then((m) =>
                    m.recordAssetInteraction('authored', `npc:${npc.id}`, 'dialogue', 1.5),
                  ).catch(() => { /* network silent */ });
                } catch { /* import silent */ }
              },
              onEnd: () => {
                setIsTalking(false);
                if (talkCheckRafRef.current !== null) {
                  cancelAnimationFrame(talkCheckRafRef.current);
                  talkCheckRafRef.current = null;
                }
                try { window.dispatchEvent(new CustomEvent('concordia:dialogue-ended', { detail: { npcId: npc.id } })); }
                catch { /* ok */ }
                try {
                  window.dispatchEvent(new CustomEvent('concordia:cinematic-mode', {
                    detail: { active: false },
                  }));
                } catch { /* ok */ }
              },
            },
          );
          piperHandleRef.current = handle;
        } catch {
          // Piper module failed to load; fall through to legacy Web Speech path below.
        }
      })();

      // Note: legacy Web Speech path removed. The Piper module's internal
      // fallback (lib/voice/piper-stream.ts:speakWithWebSpeech) handles the
      // case where Piper is unavailable, so we don't need a parallel path
      // here. archetype voice selection is intentionally simpler now —
      // Piper voice mapping happens server-side via PIPER_VOICE env var.
    },
    [muted, npc.archetype, npc.id, cancelSpeech, startTalkingPoll]
  );

  // Toggle mute
  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('npc-tts-muted', String(next));
      }
      if (next) cancelSpeech();
      return next;
    });
  }, [cancelSpeech]);

  // Speak greeting when it arrives. In authored-tree mode the greeting is just
  // scene-setting context (shown italic); the spoken line is the node's npcText
  // (handled by the node-walk effect below), so we don't speak it here.
  useEffect(() => {
    if (greeting && !nodeId) speak(greeting);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greeting]);

  // Speak response when it updates
  useEffect(() => {
    if (response) speak(response);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelSpeech();
    };
  }, [cancelSpeech]);

  // Phase 16: external barge-in. Anything firing
  // `concordia:dialogue-barge-in` cancels the active utterance — VAD on
  // player mic input (future), or a UI button, or the player initiating
  // a new combat action.
  useEffect(() => {
    const handler = () => cancelSpeech();
    window.addEventListener('concordia:dialogue-barge-in', handler);
    return () => window.removeEventListener('concordia:dialogue-barge-in', handler);
  }, [cancelSpeech]);

  // Wave 1 deferral 6: voice activity detection during NPC speech.
  // While isTalking, the VAD samples the player's mic and dispatches
  // `concordia:dialogue-barge-in` when sustained speech is detected.
  // The VAD only listens during NPC speech (no always-on mic), and the
  // user must accept the browser's getUserMedia permission. Stops the
  // moment isTalking flips to false.
  useEffect(() => {
    if (!isTalking || muted) return;
    let cancelled = false;
    let vadHandle: { stop: () => void } | null = null;
    (async () => {
      try {
        const { createDialogueBargeInVAD } = await import('@/lib/voice/vad');
        const vad = createDialogueBargeInVAD();
        const ok = await vad.start();
        if (cancelled) {
          vad.stop();
          return;
        }
        if (ok) vadHandle = vad;
      } catch { /* VAD is best-effort */ }
    })();
    return () => {
      cancelled = true;
      vadHandle?.stop();
    };
  }, [isTalking, muted]);

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
        setIsAgent(!!data.isAgent); // Wave 7 / C1 — hard AI disclosure
        // Hand-authored branching tree, if present — start the walk at its
        // first node (the opening exchange). The flat greeting/options above
        // remain the fallback for NPCs with no authored tree.
        const t: AuthoredTree | undefined = data.dialogueTree;
        if (t?.nodes?.length) {
          setTree(t);
          setNodeId(t.nodes[0].id);
        } else {
          setTree(null);
          setNodeId(null);
        }
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

  // ── Authored tree walk ───────────────────────────────────────────────────────
  // The current node is whatever nodeId points at; a node with no playerOptions
  // is terminal (farewell line → the player can only Leave).
  const currentNode = tree?.nodes?.find((n) => n.id === nodeId) ?? null;

  // Speak the node's line as the walk advances (greeting is spoken separately).
  useEffect(() => {
    if (currentNode?.npcText) speak(currentNode.npcText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const walkTo = useCallback((leadsTo: string) => {
    const next = tree?.nodes?.find((n) => n.id === leadsTo);
    if (!next) { onClose(); return; }   // unresolved branch → end the exchange
    setNodeId(next.id);
  }, [tree, onClose]);

  // What the body renders: in authored-tree mode the NPC speech is the current
  // node's line and the options are its branches; otherwise the flat LLM/
  // deterministic path (greeting + canonical action options).
  const treeMode = !!currentNode;
  const displayedSpeech = treeMode ? (currentNode?.npcText ?? '') : (response || greeting);
  const displayedSubtext = treeMode ? tree?.greeting : subtext;
  const displayedOptions: DialogueOption[] = treeMode
    ? (currentNode?.playerOptions?.length
        ? currentNode.playerOptions.map((o) => ({ label: o.text, key: `${WALK_PREFIX}${o.leadsTo}` }))
        : [{ label: 'Leave', key: 'goodbye' }])
    : options;

  // ── Player selects option ────────────────────────────────────────────────────
  const choose = useCallback(
    async (option: DialogueOption) => {
      if (option.key === 'goodbye') {
        onClose();
        return;
      }
      // Authored branching walk — navigate to the linked node, no server call.
      if (option.key.startsWith(WALK_PREFIX)) {
        walkTo(option.key.slice(WALK_PREFIX.length));
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
    [npc.id, npc.name, worldId, onClose, walkTo]
  );

  // ── Accept quest ─────────────────────────────────────────────────────────────
  const acceptQuest = useCallback(async () => {
    if (!questOffered) return;
    setAcceptingQuest(true);
    try {
      // Try the canonical /api/quests/accept first; fall back to the legacy
      // world-scoped endpoint if it isn't available.
      let r = await fetch('/api/quests/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questId: questOffered.id }),
      }).catch(() => null);
      if (!r || !r.ok) {
        r = await fetch(`/api/worlds/${worldId}/quests/${questOffered.id}/accept`, { method: 'POST' });
      }
      onQuestAccepted?.(questOffered.id);
      setResponse(`Quest accepted: "${questOffered.title}". Good luck.`);
      setQuestOffered(null);
      try {
        window.dispatchEvent(new CustomEvent('concordia:tutorial-action', {
          detail: { action: 'accepted-quest' },
        }));
      } catch { /* tutorial dispatch best-effort */ }
    } catch {
      /* non-fatal */
    }
    setAcceptingQuest(false);
  }, [questOffered, worldId, onQuestAccepted]);

  const declineQuest = useCallback(() => {
    if (!questOffered) return;
    fetch('/api/quests/decline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ questId: questOffered.id }),
    }).catch(() => { /* decline silent */ });
    setResponse('Maybe another time, then.');
    setQuestOffered(null);
  }, [questOffered]);

  // ── Render ───────────────────────────────────────────────────────────────────
  const moodCfg = MOOD_CONFIG[mood] ?? MOOD_CONFIG.neutral;
  const hpPct = npc.maxHp
    ? Math.max(0, Math.min(100, ((npc.currentHp ?? npc.maxHp) / npc.maxHp) * 100))
    : 100;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pb-24 px-4 pointer-events-none">
      <div
        className={`pointer-events-auto w-full max-w-lg bg-black/95 border ${moodCfg.ring} rounded-2xl shadow-2xl overflow-hidden`}
      >
        {/* NPC header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          {/* Animated face avatar */}
          <NPCFace mood={mood} isTalking={isTalking} moodRing={moodCfg.ring} />

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
              {isAgent && (
                <span
                  title="This character is controlled by an autonomous AI agent."
                  className="text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/40 px-1.5 py-0.5 rounded font-medium"
                >
                  AI
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

          {/* Mute button */}
          {TTS_SUPPORTED && (
            <button
              onClick={toggleMute}
              className="text-white/30 hover:text-white transition-colors ml-1"
              aria-label={muted ? 'Unmute NPC voice' : 'Mute NPC voice'}
              title={muted ? 'Unmute NPC voice' : 'Mute NPC voice'}
            >
              {muted ? '🔇' : '🔊'}
            </button>
          )}

          <button
            onClick={onClose}
            className="text-white/30 hover:text-white transition-colors ml-1"
          aria-label="Close">
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
                {displayedSpeech}
              </div>
              {displayedSubtext && !response && (
                <div className="text-[11px] text-white/30 italic mt-1">{displayedSubtext}</div>
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
                  <div className="flex gap-2">
                    <button
                      onClick={acceptQuest}
                      disabled={acceptingQuest}
                      className="text-[11px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                    >
                      {acceptingQuest ? 'Accepting…' : 'Accept Quest'}
                    </button>
                    <button
                      onClick={declineQuest}
                      disabled={acceptingQuest}
                      className="text-[11px] bg-stone-700/40 text-stone-300 border border-stone-600/40 px-3 py-1.5 rounded-lg hover:bg-stone-600/50 transition-colors disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Options */}
        {phase === 'greeting' && displayedOptions.length > 0 && (
          <div className="border-t border-white/10 px-4 pb-4 pt-3 flex flex-col gap-1.5">
            {displayedOptions.map((opt) => (
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
