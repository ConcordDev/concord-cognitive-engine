'use client';

/**
 * PersistentChatRail — Chat panel that persists across all lens navigations.
 *
 * The killer feature: conversation context carries across lenses.
 * User chats in healthcare -> taps fitness lens -> same conversation.
 * The brain now has context from both domains.
 *
 * ENHANCED: 5-Mode Chat System
 *   - Welcome:  Greeting state with quick actions (shown when 0 messages)
 *   - Assist:   Task-focused assistant with workflow buttons
 *   - Explore:  Discovery, trending topics, "Surprise me"
 *   - Connect:  Collaboration, shared sessions, social feed
 *   - Chat:     Free-form conversation (legacy default)
 *
 * Also adds:
 *   - Proactive messages (time-based, idle, lens navigation, DTU events)
 *   - Action buttons on messages (Save as DTU, Explore deeper, etc.)
 *   - Cross-lens memory indicator (lens trail, context badge, clear/preserve toggle)
 */

import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { useSessionId, resetSessionId } from '@/hooks/useSessionId';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';
import { SovereigntyPrompt } from '@/components/sovereignty/SovereigntyPrompt';
import { SkeletonChat } from '@/components/common/Skeleton';
import { PipelineProgress } from '@/components/pipeline/PipelineProgress';
import {
  MessageSquare,
  Send,
  X,
  ChevronRight,
  ArrowRight,
  Brain,
  Globe,
  ExternalLink,
  Zap,
  Compass,
  Loader,
  Plus,
  Minimize2,
  Maximize2,
  Layers,
  Database,
  Archive,
} from 'lucide-react';

// ── Mode system imports ─────────────────────────────────────────

import type { ChatMode } from './ChatModeTypes';
import { CHAT_MODES } from './ChatModeTypes';
import {
  WelcomePanel,
  AssistPanel,
  ExplorePanel,
  ConnectPanel,
  ChatPanel,
  ModeSelector,
  ResponseActions,
  CrossLensMemoryBar,
  ProactiveChip,
} from './ChatModePanels';
import { useChatProactive } from './useChatProactive';
import { useCrossLensMemory } from './useCrossLensMemory';
import { useConversationMemory } from '@/hooks/useConversationMemory';
import { ContextOverlay } from './ContextOverlay';
import { InitiativeList } from './InitiativeChip';
import type { Initiative } from './InitiativeChip';
import ChatRouteOverlay from './ChatRouteOverlay';
import ForgeCard from './ForgeCard';

// ── Types ──────────────────────────────────────────────────────

interface RouteMeta {
  actionType: string;
  lenses: { lensId: string; score: number }[];
  primaryLens: string | null;
  isMultiLens: boolean;
  confidence: number;
  attribution: string[];
  message: string | null;
}

interface ForgeEnvelope {
  dtu: { id: string; title: string; artifact?: { content?: string }; tags?: string[] };
  presentation: {
    title: string;
    format: string;
    primaryType: number;
    preview: string;
    sourceLenses: string[];
    cretiScore: number;
    substrateCitationCount: number;
    formatAmbiguous: boolean;
    alternatives?: string[];
  };
  actions: {
    save: { available: boolean; description: string };
    delete: { available: boolean; description: string };
    saveAndList: { available: boolean; description: string };
    iterate: { available: boolean; description: string };
  };
  isMultiArtifact?: boolean;
  offerForge?: boolean;
}

interface DTUSource {
  id: string;
  title: string;
  tier: string;
  score: number | null;
  sources?: {
    queryMatch?: boolean;
    edgeSpread?: boolean;
    globalWarmth?: boolean;
    userProfileSeed?: boolean;
    autogen?: boolean;
  };
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  lens?: string | null;
  timestamp: string;
  lensRecommendation?: LensRecommendation | null;
  suggestedAction?: string | null;
  sources?: { title: string; url: string; source: string }[];
  // DTU context pipeline metadata
  dtuCount?: number;
  dtuIds?: string[];
  dtuSources?: DTUSource[];
  brain?: string;
  // Chat router metadata (lens attribution, action type)
  route?: RouteMeta | null;
  // Inline forge artifact (when CREATE action produces deliverable)
  forge?: ForgeEnvelope | null;
}

interface LensRecommendation {
  domain: string;
  reason: string;
  suggestedAction?: string | null;
  confidence: number;
}

interface WebResult {
  title: string;
  source: string;
  snippet: string;
}

interface PersistentChatRailProps {
  currentLens: string;
  collapsed?: boolean;
  onToggle?: () => void;
  onLensNavigate?: (domain: string) => void;
}

type ChatStatus = 'idle' | 'thinking' | 'searching' | 'responding' | 'queued';

interface QueueStatus {
  position: number;
  estimatedWaitMs: number;
  pressure?: number;
}

// ── DTU Sources Section (expandable context sources below assistant messages) ──

const TIER_BADGE_STYLES: Record<string, string> = {
  hyper: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  mega: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  regular: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  shadow: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  archive: 'bg-zinc-600/20 text-zinc-500 border-zinc-600/30',
};

function DTUSourcesSection({ sources }: { sources: DTUSource[] }) {
  const [expanded, setExpanded] = useState(false);
  if (sources.length === 0) return null;

  // Tier boost labels for context transparency
  const TIER_BOOST: Record<string, string> = {
    hyper: '2.0x boost',
    mega: '1.5x boost',
    regular: '',
    shadow: '0.6x',
    archive: '0.3x',
  };

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-zinc-300 transition-colors w-full"
      >
        <Database className="w-2.5 h-2.5" />
        <span>{sources.length} DTU source{sources.length !== 1 ? 's' : ''} used</span>
        <ChevronRight className={`w-2.5 h-2.5 ml-auto transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 max-h-52 overflow-y-auto">
          {sources.map((src) => {
            const tierStyle = TIER_BADGE_STYLES[src.tier] || TIER_BADGE_STYLES.regular;
            const boost = TIER_BOOST[src.tier] || '';
            const s = src.sources;
            return (
              <div
                key={src.id}
                className="text-[10px] px-1.5 py-1.5 rounded bg-zinc-800/50 hover:bg-zinc-700/50 cursor-pointer transition-colors"
                title={`DTU: ${src.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`px-1 py-0.5 rounded border text-[9px] font-medium uppercase ${tierStyle}`}>
                    {src.tier}
                  </span>
                  <span className="text-zinc-300 truncate flex-1">{src.title || src.id}</span>
                  {src.score != null && (
                    <span className="text-zinc-500 font-mono shrink-0">{(src.score * 100).toFixed(0)}%</span>
                  )}
                </div>
                {/* Activation sources and tier boost — why this DTU was selected */}
                {(s || boost) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {boost && (
                      <span className="px-1 py-0.5 rounded bg-zinc-700/50 text-zinc-500 text-[9px]">{boost}</span>
                    )}
                    {s?.queryMatch && (
                      <span className="px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[9px]">query</span>
                    )}
                    {s?.edgeSpread && (
                      <span className="px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 text-[9px]">spread</span>
                    )}
                    {s?.globalWarmth && (
                      <span className="px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[9px]">global</span>
                    )}
                    {s?.userProfileSeed && (
                      <span className="px-1 py-0.5 rounded bg-green-500/10 text-green-400 text-[9px]">profile</span>
                    )}
                    {s?.autogen && (
                      <span className="px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[9px]">autogen</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── DTU Sources Section (expandable context sources below assistant messages) ──

const TIER_BADGE_STYLES: Record<string, string> = {
  hyper: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  mega: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  regular: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  shadow: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  archive: 'bg-zinc-600/20 text-zinc-500 border-zinc-600/30',
};

function DTUSourcesSection({ sources }: { sources: DTUSource[] }) {
  const [expanded, setExpanded] = useState(false);
  if (sources.length === 0) return null;

  // Tier boost labels for context transparency
  const TIER_BOOST: Record<string, string> = {
    hyper: '2.0x boost',
    mega: '1.5x boost',
    regular: '',
    shadow: '0.6x',
    archive: '0.3x',
  };

  return (
    <div className="mt-2 pt-2 border-t border-zinc-700/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-zinc-300 transition-colors w-full"
      >
        <Database className="w-2.5 h-2.5" />
        <span>{sources.length} DTU source{sources.length !== 1 ? 's' : ''} used</span>
        <ChevronRight className={`w-2.5 h-2.5 ml-auto transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 max-h-52 overflow-y-auto">
          {sources.map((src) => {
            const tierStyle = TIER_BADGE_STYLES[src.tier] || TIER_BADGE_STYLES.regular;
            const boost = TIER_BOOST[src.tier] || '';
            const s = src.sources;
            return (
              <div
                key={src.id}
                className="text-[10px] px-1.5 py-1.5 rounded bg-zinc-800/50 hover:bg-zinc-700/50 cursor-pointer transition-colors"
                title={`DTU: ${src.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`px-1 py-0.5 rounded border text-[9px] font-medium uppercase ${tierStyle}`}>
                    {src.tier}
                  </span>
                  <span className="text-zinc-300 truncate flex-1">{src.title || src.id}</span>
                  {src.score != null && (
                    <span className="text-zinc-500 font-mono shrink-0">{(src.score * 100).toFixed(0)}%</span>
                  )}
                </div>
                {/* Activation sources and tier boost — why this DTU was selected */}
                {(s || boost) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {boost && (
                      <span className="px-1 py-0.5 rounded bg-zinc-700/50 text-zinc-500 text-[9px]">{boost}</span>
                    )}
                    {s?.queryMatch && (
                      <span className="px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[9px]">query</span>
                    )}
                    {s?.edgeSpread && (
                      <span className="px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 text-[9px]">spread</span>
                    )}
                    {s?.globalWarmth && (
                      <span className="px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 text-[9px]">global</span>
                    )}
                    {s?.userProfileSeed && (
                      <span className="px-1 py-0.5 rounded bg-green-500/10 text-green-400 text-[9px]">profile</span>
                    )}
                    {s?.autogen && (
                      <span className="px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-400 text-[9px]">autogen</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────

export function PersistentChatRail({
  currentLens,
  collapsed = false,
  onToggle,
  onLensNavigate,
}: PersistentChatRailProps) {
  const sessionId = useSessionId();
  const { on, off, emit, isConnected } = useSocket({ autoConnect: true });

  // ── Core chat state ────────────────────────────────────────

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [chatStatus, setChatStatus] = useState<ChatStatus>('idle');
  // When the LLM queue is under load, the server tells us our position +
  // estimated wait. Cleared when status leaves 'queued'.
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [webResults, setWebResults] = useState<WebResult[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [lastDtuCount, setLastDtuCount] = useState(0);
  const [contextOverlayOpen, setContextOverlayOpen] = useState(false);
  const [serverInitiatives, setServerInitiatives] = useState<Initiative[]>([]);

  // ── Mode state ─────────────────────────────────────────────

  const [chatMode, setChatMode] = useState<ChatMode>('welcome');

  // Auto-switch from welcome mode when first message is sent
  useEffect(() => {
    if (messages.length > 0 && chatMode === 'welcome') {
      setChatMode('chat');
    }
  }, [messages.length, chatMode]);

  // ── Cross-lens memory ──────────────────────────────────────

  const crossLensMemory = useCrossLensMemory(currentLens);

  // ── Conversation memory (compression & stats) ─────────────

  const {
    stats: memoryStats,
    isCompressing: memoryCompressing,
    forceCompress: memoryForceCompress,
    refreshStats: memoryRefreshStats,
  } = useConversationMemory();

  // ── Proactive messages ─────────────────────────────────────

  const proactive = useChatProactive({
    currentLens,
    messageCount: messages.length,
    enabled: !collapsed && chatMode !== 'chat', // disable proactive in pure chat mode
    onSocket: on,
    offSocket: off,
  });

  // ── DTU event listener for proactive notifications ─────────

  useEffect(() => {
    const handleDTUCreated = (data: unknown) => {
      const d = data as { title?: string; domain?: string };
      if (d?.title) {
        proactive.addDTUNotification(d.title, 'created');
      }
    };
    const handleDTUPromoted = (data: unknown) => {
      const d = data as { title?: string };
      if (d?.title) {
        proactive.addDTUNotification(d.title, 'promoted');
      }
    };

    on('dtu:created', handleDTUCreated);
    on('dtu:promoted', handleDTUPromoted);

    return () => {
      off('dtu:created', handleDTUCreated);
      off('dtu:promoted', handleDTUPromoted);
    };
  }, [on, off, proactive]);

  // ── Server initiative listener (rich initiative chips) ─────

  useEffect(() => {
    // Convert snake_case trigger types from backend to camelCase for frontend chip styling
    const snakeToCamel: Record<string, string> = {
      substrate_discovery: 'substrateDiscovery',
      citation_alert: 'citationAlert',
      check_in: 'genuineCheckIn',
      pending_work: 'pendingWorkReminder',
      world_event: 'worldEventConnection',
      reflective_followup: 'reflectiveFollowUp',
      morning_context: 'morningContext',
    };

    const handleInitiative = (data: unknown) => {
      const d = data as Initiative & { deliveredAt?: string };
      if (!d?.id || !d?.message) return;

      const triggerType = snakeToCamel[d.triggerType] || d.triggerType || 'genuineCheckIn';

      setServerInitiatives(prev => {
        // Deduplicate by id and cap at 5
        if (prev.some(i => i.id === d.id)) return prev;
        const next = [...prev, {
          id: d.id,
          triggerType,
          message: d.message,
          priority: d.priority || 'normal',
          score: d.score ?? 0.5,
          status: d.status || 'delivered',
          channel: d.channel,
          metadata: d.metadata,
          deliveredAt: d.deliveredAt,
          createdAt: d.createdAt || new Date().toISOString(),
        } as Initiative];
        return next.slice(-5);
      });
    };

    on('initiative:new', handleInitiative);
    return () => {
      off('initiative:new', handleInitiative);
    };
  }, [on, off]);

  // ── Sovereignty prompt state ───────────────────────────────

  const [sovereigntyPrompt, setSovereigntyPrompt] = useState<{
    message: string;
    localCount: number;
    globalCount: number;
    globalDomains: string[];
    globalDTUIds: string[];
    globalPreview?: { id: string; title: string; domain: string; score: number }[];
    originalPrompt: string;
  } | null>(null);
  const [isResolvingSovereignty, setIsResolvingSovereignty] = useState(false);

  // ── Pipeline prompt state ──────────────────────────────────

  const [pipelinePrompt, setPipelinePrompt] = useState<{
    pipelineId: string;
    description: string;
    variables: Record<string, unknown>;
    steps: { lens: string; action: string; order: number }[];
    message: string;
  } | null>(null);
  const [activePipeline, setActivePipeline] = useState<{
    pipelineId: string;
    executionId: string;
    description: string;
    steps: { lens: string; action: string; order: number }[];
  } | null>(null);

  // ── Refs ───────────────────────────────────────────────────

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // ── WebSocket event listeners ──────────────────────────────

  useEffect(() => {
    const handleStatus = (data: unknown) => {
      const d = data as { sessionId?: string; status?: ChatStatus; queue?: QueueStatus };
      if (d.sessionId === sessionId) {
        setChatStatus(d.status || 'idle');
        // Queued under load — surface position/ETA. Any non-queued status
        // resets the indicator so it doesn't linger on the next message.
        if (d.status === 'queued' && d.queue) {
          setQueueStatus(d.queue);
        } else {
          setQueueStatus(null);
        }
      }
    };

    const handleToken = (data: unknown) => {
      const d = data as { sessionId?: string; token?: string };
      if (d.sessionId === sessionId && d.token) {
        setStreamingText(prev => prev + d.token);
      }
    };

    const handleWebResults = (data: unknown) => {
      const d = data as { sessionId?: string; results?: WebResult[] };
      if (d.sessionId === sessionId && d.results) {
        setWebResults(d.results);
      }
    };

    const handleComplete = (data: unknown) => {
      const d = data as {
        sessionId?: string;
        response?: string;
        lensRecommendation?: LensRecommendation;
        sources?: { title: string; url: string; source: string }[];
        dtuCount?: number;
        dtuIds?: string[];
        dtuSources?: DTUSource[];
        brain?: string;
        route?: RouteMeta | null;
        forge?: ForgeEnvelope | null;
      };
      if (d.sessionId === sessionId) {
        const msg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          content: d.response || '',
          lens: currentLens,
          timestamp: new Date().toISOString(),
          lensRecommendation: d.lensRecommendation || null,
          sources: d.sources || [],
          dtuCount: d.dtuCount ?? 0,
          dtuIds: d.dtuIds || [],
          dtuSources: d.dtuSources || [],
          brain: d.brain || undefined,
          route: d.route || null,
          forge: d.forge || null,
        };
        setMessages(prev => [...prev, msg]);
        setStreamingText('');
        setChatStatus('idle');
        setWebResults([]);
        // Update DTU context depth counter
        if (d.dtuCount != null) setLastDtuCount(d.dtuCount);
        // Refresh conversation memory stats after each response
        memoryRefreshStats();
      }
    };

    const handleToolResult = (data: unknown) => {
      const d = data as { tool: string; result: string; ok: boolean; sessionId: string };
      if (d.sessionId !== sessionId) return;
      setMessages(prev => [...prev, {
        id: `tool-${Date.now()}`,
        role: 'system' as const,
        content: `\u{1F527} ${d.tool}: ${d.ok ? d.result : `Error: ${d.result}`}`,
        timestamp: new Date().toISOString(),
      }]);
    };

    on('chat:status', handleStatus);
    on('chat:token', handleToken);
    on('chat:web_results', handleWebResults);
    on('chat:complete', handleComplete);
    on('chat:tool_result', handleToolResult);

    return () => {
      off('chat:status', handleStatus);
      off('chat:token', handleToken);
      off('chat:web_results', handleWebResults);
      off('chat:complete', handleComplete);
      off('chat:tool_result', handleToolResult);
    };
  }, [on, off, sessionId, currentLens, memoryRefreshStats]);

  // ── Send message ──────────────────────────────────────────

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;

    // Record message in cross-lens memory
    crossLensMemory.recordMessage();

    // Reset proactive idle timer on activity
    proactive.resetIdleTimer();

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: content.trim(),
      lens: currentLens,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setChatStatus('thinking');

    // Try WebSocket first, fall back to HTTP
    if (isConnected) {
      emit('chat:message', {
        sessionId,
        prompt: content.trim(),
        lens: currentLens,
      });
    } else {
      try {
        const response = await api.post('/api/chat?full=1', {
          sessionId,
          prompt: content.trim(),
          lens: currentLens,
        });
        const data = response.data;

        // Handle sovereignty prompt — local substrate insufficient
        if (data?.type === 'sovereignty_prompt') {
          setSovereigntyPrompt({
            message: data.message || 'Your substrate needs global knowledge for this.',
            localCount: data.localCount || 0,
            globalCount: data.globalCount || 0,
            globalDomains: data.globalDomains || [],
            globalDTUIds: data.globalDTUIds || [],
            globalPreview: data.globalPreview || [],
            originalPrompt: content.trim(),
          });
          setChatStatus('idle');
          return;
        }

        // Handle pipeline prompt — life event detected
        if (data?.type === 'pipeline_prompt') {
          setPipelinePrompt({
            pipelineId: data.pipelineId,
            description: data.description,
            variables: data.variables || {},
            steps: data.steps || [],
            message: data.message,
          });
          setChatStatus('idle');
          return;
        }

        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          content: data?.response || data?.reply || data?.message || data?.output || JSON.stringify(data),
          lens: currentLens,
          timestamp: new Date().toISOString(),
          lensRecommendation: data?.lensRecommendation || null,
          dtuCount: data?.dtuCount ?? 0,
          route: data?.route || null,
          forge: data?.forge || null,
        };
        setMessages(prev => [...prev, assistantMsg]);
        if (data?.dtuCount != null) setLastDtuCount(data.dtuCount);
        memoryRefreshStats();
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Failed to get response'}`,
          lens: currentLens,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errorMsg]);
      } finally {
        setChatStatus('idle');
      }
    }
  }, [sessionId, currentLens, isConnected, emit, crossLensMemory, proactive, memoryRefreshStats]);

  // ── Handle sovereignty resolution ──────────────────────────

  const handleSovereigntyResolve = useCallback(async (
    choice: 'sync_temp' | 'sync_permanent' | 'skip',
    remember: boolean,
  ) => {
    if (!sovereigntyPrompt) return;
    setIsResolvingSovereignty(true);
    setChatStatus('thinking');

    try {
      const response = await api.post('/api/chat/sovereignty-resolve', {
        sessionId,
        choice,
        globalDTUIds: sovereigntyPrompt.globalDTUIds,
        originalPrompt: sovereigntyPrompt.originalPrompt,
        lens: currentLens,
        remember,
      });
      const data = response.data;
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-sov`,
        role: 'assistant',
        content: data?.content || data?.reply || data?.response || 'Response received.',
        lens: currentLens,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-sov-err`,
        role: 'assistant',
        content: `Error resolving sovereignty: ${err instanceof Error ? err.message : 'Unknown error'}`,
        lens: currentLens,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setSovereigntyPrompt(null);
      setIsResolvingSovereignty(false);
      setChatStatus('idle');
    }
  }, [sovereigntyPrompt, sessionId, currentLens]);

  // ── Handle mode change ────────────────────────────────────

  const handleModeChange = useCallback((mode: ChatMode) => {
    setChatMode(mode);
    // If switching to welcome with messages, auto-switch to chat instead
    if (mode === 'welcome' && messages.length > 0) {
      // Allow it — user explicitly chose welcome mode
    }
  }, [messages.length]);

  // ── Handle proactive action ───────────────────────────────

  const handleProactiveAction = useCallback((payload: string) => {
    if (payload.startsWith('navigate:')) {
      const domain = payload.replace('navigate:', '');
      onLensNavigate?.(domain);
    } else {
      sendMessage(payload);
    }
  }, [onLensNavigate, sendMessage]);

  // ── Handle submit ──────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const handleNewConversation = () => {
    resetSessionId();
    setMessages([]);
    setStreamingText('');
    setChatStatus('idle');
    setWebResults([]);
    setChatMode('welcome');
    crossLensMemory.clearTrail();
    proactive.dismissAll();
  };

  // ── Get mode-specific placeholder ─────────────────────────

  const getPlaceholder = (): string => {
    const modeConfig = CHAT_MODES.find(m => m.id === chatMode);
    return modeConfig?.placeholder || 'Ask Concord anything...';
  };

  // ── Render mode panel ─────────────────────────────────────

  const renderModePanel = () => {
    // Only show mode panels when there are 0 messages OR when not in chat mode
    const showPanel = messages.length === 0 || chatMode !== 'chat';

    if (!showPanel) return null;

    const panelProps = {
      currentLens,
      onSendMessage: sendMessage,
      onLensNavigate,
    };

    switch (chatMode) {
      case 'welcome':
        return <WelcomePanel {...panelProps} />;
      case 'assist':
        return <AssistPanel {...panelProps} />;
      case 'explore':
        return <ExplorePanel {...panelProps} />;
      case 'connect':
        return <ConnectPanel {...panelProps} />;
      case 'chat':
        return <ChatPanel {...panelProps} />;
      default:
        return null;
    }
  };

  // ── Collapsed state (floating button) ──────────────────────

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full
          bg-gradient-to-br from-neon-blue to-neon-purple
          shadow-lg shadow-neon-blue/20 hover:shadow-neon-blue/40
          flex items-center justify-center transition-all hover:scale-105"
        aria-label="Open chat"
      >
        <MessageSquare className="w-6 h-6 text-white" />
        {messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-neon-pink
            text-white text-[10px] rounded-full flex items-center justify-center">
            {messages.length > 9 ? '9+' : messages.length}
          </span>
        )}
      </button>
    );
  }

  // ── Expanded state (side panel) ────────────────────────────

  return (
    <div
      data-lens-theme="chat"
      className={cn(
        'fixed right-0 top-14 lg:top-16 bottom-0 z-30 flex flex-col',
        'bg-lattice-deep border-l border-blue-500/10',
        'transition-all duration-300',
        isExpanded ? 'w-[600px]' : 'w-[380px]'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border bg-lattice-surface">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-neon-cyan" />
          <span className="text-sm font-medium text-white">Concord Chat</span>
          {currentLens && (
            <span className="text-xs text-zinc-500 px-2 py-0.5 rounded-full bg-zinc-800">
              {currentLens}
            </span>
          )}
          {lastDtuCount > 0 && (
            <button
              onClick={() => setContextOverlayOpen(true)}
              className="flex items-center gap-1 text-[10px] text-neon-green px-1.5 py-0.5 rounded-full bg-neon-green/10 border border-neon-green/20 hover:bg-neon-green/20 transition-colors"
              title="View DTU context"
            >
              <Database className="w-2.5 h-2.5" />
              {lastDtuCount} DTUs
            </button>
          )}
          {/* Conversation memory stats indicator */}
          {memoryStats && (
            <button
              onClick={memoryForceCompress}
              disabled={memoryCompressing}
              className={cn(
                'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors',
                memoryCompressing
                  ? 'text-amber-400 bg-amber-400/10 border-amber-400/20 animate-pulse'
                  : 'text-zinc-400 bg-zinc-800 border-zinc-700 hover:text-zinc-300 hover:bg-zinc-700',
              )}
              title={memoryCompressing
                ? 'Compressing memory...'
                : `${memoryStats.activeMessages} msgs in window (${memoryStats.windowUtilization}) | ${memoryStats.compressionCycles} compressions | Click to compress`}
            >
              <Archive className="w-2.5 h-2.5" />
              {memoryCompressing ? 'Compressing...' : `${memoryStats.activeMessages} msgs`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewConversation}
            className="p-1.5 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
            title="New conversation"
            aria-label="New conversation"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse chat panel' : 'Expand chat panel'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-lattice-elevated text-gray-400 hover:text-white transition-colors"
            title="Close chat"
            aria-label="Close chat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode selector bar */}
      <ModeSelector activeMode={chatMode} onModeChange={handleModeChange} />

      {/* Cross-lens memory indicator */}
      <CrossLensMemoryBar
        trail={crossLensMemory.trail}
        totalLensCount={crossLensMemory.totalLensCount}
        memoryPreserved={crossLensMemory.memoryPreserved}
        onToggleMemory={crossLensMemory.toggleMemoryPreserved}
        onClearTrail={crossLensMemory.clearTrail}
      />

      {/* Mode-specific panel (above messages) */}
      {renderModePanel()}

      {/* Proactive messages (client-side suggestions) */}
      {proactive.proactiveMessages.length > 0 && (
        <div className="shrink-0">
          {proactive.proactiveMessages.slice(-2).map(pm => (
            <ProactiveChip
              key={pm.id}
              content={pm.content}
              actionLabel={pm.actionLabel}
              onAction={() => {
                if (pm.actionPayload) {
                  handleProactiveAction(pm.actionPayload);
                }
                proactive.dismissProactive(pm.id);
              }}
              onDismiss={() => proactive.dismissProactive(pm.id)}
            />
          ))}
        </div>
      )}

      {/* Server-pushed initiative chips (rich proactive messages from Concord) */}
      {serverInitiatives.length > 0 && (
        <div className="shrink-0">
          <InitiativeList
            initiatives={serverInitiatives}
            onDismiss={(id) => {
              setServerInitiatives(prev => prev.filter(i => i.id !== id));
            }}
            onAction={(id, action, payload) => {
              const initiative = serverInitiatives.find(i => i.id === id);
              if (action === 'view_dtu' && payload?.dtuId) {
                sendMessage(`Show me details about DTU ${payload.dtuId}`);
              } else if (action === 'explain' || action === 'expand_thought') {
                sendMessage(initiative?.message || 'Tell me more about this.');
              } else if (action === 'catch_up' || action === 'morning_brief') {
                sendMessage('Give me a catch-up summary of my substrate activity.');
              } else if (action === 'resume_work') {
                sendMessage('What pending work should I pick up?');
              } else if (action === 'analyze_event') {
                sendMessage(initiative?.message || 'Analyze this event for me.');
              } else if (initiative?.message) {
                sendMessage(initiative.message);
              }
              setServerInitiatives(prev => prev.filter(i => i.id !== id));
            }}
            onRespond={(id) => {
              // Report response to backend
              fetch(`/api/initiative/${id}/respond`, { method: 'POST' }).catch(err => console.error('[Initiative] Failed to respond:', err));
              setServerInitiatives(prev => prev.filter(i => i.id !== id));
            }}
            maxVisible={2}
            compact={!isExpanded}
          />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && chatMode === 'chat' && chatStatus === 'thinking' && (
          <SkeletonChat count={3} />
        )}
        {messages.length === 0 && chatMode === 'chat' && chatStatus !== 'thinking' && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Brain className="w-10 h-10 text-zinc-600 mb-3" />
            <p className="text-sm text-zinc-400 mb-1">Chat with Concord</p>
            <p className="text-xs text-zinc-600 max-w-[240px]">
              Your conversation follows you across all lenses. Context is never lost.
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const prevLens = i > 0 ? messages[i - 1].lens : null;
          const showTransition = msg.lens && msg.lens !== prevLens && i > 0;

          return (
            <Fragment key={msg.id}>
              {/* Lens transition marker */}
              {showTransition && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-zinc-700" />
                  <span className="text-[10px] text-zinc-500 flex items-center gap-1.5 whitespace-nowrap">
                    <ArrowRight className="w-3 h-3" />
                    Moved to {msg.lens} lens
                  </span>
                  <div className="flex-1 h-px bg-zinc-700" />
                </div>
              )}

              {/* Route overlay (shows lens attribution above assistant messages) */}
              {msg.role === 'assistant' && msg.route && (
                <ChatRouteOverlay
                  route={msg.route}
                  requiresConfirmation={false}
                />
              )}

              {/* Message */}
              <div
                className={cn(
                  'flex',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-blue-600/25 text-zinc-100 border border-blue-500/25'
                      : 'bg-gradient-to-br from-zinc-800/90 to-zinc-800/60 text-zinc-200 border border-zinc-700/40 shadow-sm shadow-blue-500/5'
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                  {/* Web Sources — styled panel */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-blue-500/10 space-y-1">
                      {msg.sources.map((s, si) => (
                        <div key={si} className="flex items-center gap-1 text-[10px] text-blue-400/60 hover:text-blue-400/80 transition-colors">
                          <ExternalLink className="w-2.5 h-2.5" />
                          <span>{s.source}: {s.title}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* DTU Sources — expandable section showing which DTUs were used as context */}
                  {msg.role === 'assistant' && msg.dtuSources && msg.dtuSources.length > 0 && (
                    <DTUSourcesSection sources={msg.dtuSources} />
                  )}

                  {/* Lens recommendation chip */}
                  {msg.lensRecommendation && (
                    <button
                      onClick={() => onLensNavigate?.(msg.lensRecommendation!.domain)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-2
                        bg-neon-cyan/10 border border-neon-cyan/30 rounded-full
                        text-xs text-neon-cyan hover:bg-neon-cyan/20 transition-all"
                    >
                      <Compass className="w-3 h-3" />
                      Open {msg.lensRecommendation.domain} lens
                      <ChevronRight className="w-2.5 h-2.5" />
                    </button>
                  )}

                  {/* Suggested action button */}
                  {msg.lensRecommendation?.suggestedAction && (
                    <button
                      onClick={() => {
                        onLensNavigate?.(msg.lensRecommendation!.domain);
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 mt-2
                        bg-neon-blue/10 border border-neon-blue/30 rounded-lg
                        text-xs text-neon-blue hover:bg-neon-blue/20 transition-all"
                    >
                      <Zap className="w-3 h-3" />
                      Generate {msg.lensRecommendation.suggestedAction.replace(/-/g, ' ')}
                    </button>
                  )}

                  {/* Confidence score indicator */}
                  {msg.role === 'assistant' && msg.confidence && msg.confidence.score > 0 && (
                    <div className="mt-1.5 flex justify-end">
                      <ConfidenceBadge
                        score={msg.confidence.score}
                        label={msg.confidence.level}
                        factors={msg.confidence.factors
                          ? Object.fromEntries(Object.entries(msg.confidence.factors).map(([k, v]) => [k, typeof v === 'object' && v !== null && 'score' in v ? (v as { score: number }).score : (v as number)]))
                          : undefined}
                        showFactors
                        size="sm"
                      />
                    </div>
                  )}

                  {/* Action buttons on assistant messages */}
                  {msg.role === 'assistant' && msg.content.length > 30 && (
                    <ResponseActions
                      mode={chatMode}
                      responseContent={msg.content}
                      currentLens={currentLens}
                      onSendMessage={sendMessage}
                      onViewContext={() => setContextOverlayOpen(true)}
                      onForgeDTU={async (content) => {
                        try {
                          await api.post('/api/chat/forge/message', {
                            content,
                            sessionId,
                          });
                        } catch (e) { console.error('[Chat] Failed to forge DTU:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to forge DTU' }); }
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Inline forge card (when CREATE action produces deliverable artifact) */}
              {msg.role === 'assistant' && msg.forge && msg.forge.presentation && (
                <div className="mt-2 max-w-[85%]">
                  <ForgeCard
                    dtu={msg.forge.dtu}
                    presentation={msg.forge.presentation}
                    actions={msg.forge.actions}
                    isMultiArtifact={msg.forge.isMultiArtifact}
                    offerForge={msg.forge.offerForge}
                    onSave={async (forgeDtu) => {
                      try {
                        await api.post('/api/chat/forge/save', { dtu: forgeDtu });
                      } catch {}
                    }}
                    onDelete={async (dtuId) => {
                      try {
                        await api.post('/api/chat/forge/delete', { dtuId });
                      } catch {}
                    }}
                    onList={async (forgeDtu) => {
                      try {
                        await api.post('/api/chat/forge/list', { dtu: forgeDtu });
                      } catch {}
                    }}
                    onIterate={async (forgeDtu, instruction) => {
                      try {
                        const iterRes = await api.post('/api/chat/forge/iterate', {
                          dtu: forgeDtu,
                          instruction,
                          sessionId,
                        });
                        // If iteration returns new content, send as follow-up message
                        if (iterRes.data?.ok) {
                          sendMessage(`Iterate on the forged artifact: ${instruction}`);
                        }
                      } catch {}
                    }}
                  />
                </div>
              )}
            </Fragment>
          );
        })}

        {/* Status indicators — typing animation */}
        {chatStatus === 'thinking' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-blue-400/80 px-2 py-1">
              <Brain className="w-4 h-4 animate-pulse" />
              <span>Thinking</span>
              <span className="flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 rounded-full bg-blue-400/60 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
            {lastDtuCount > 0 && (
              <div className="flex items-center gap-2 text-[10px] text-zinc-500 px-2">
                <Database className="w-3 h-3 animate-pulse text-neon-green/50" />
                Harvesting context from {lastDtuCount} DTUs...
              </div>
            )}
          </div>
        )}
        {chatStatus === 'searching' && (
          <div className="flex items-center gap-2 text-sm text-neon-cyan px-2 py-1">
            <Globe className="w-4 h-4 animate-spin" />
            Searching the web...
          </div>
        )}

        {/* Web search results */}
        {webResults.length > 0 && (
          <div className="px-2 py-1 space-y-1">
            {webResults.map((r, i) => (
              <div key={i} className="text-[10px] text-zinc-500 flex items-center gap-1">
                <ExternalLink className="w-2.5 h-2.5" />
                {r.source}: {r.title}
              </div>
            ))}
          </div>
        )}

        {/* Streaming text */}
        {streamingText && (
          <div className="bg-zinc-800/80 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 border border-zinc-700/50">
            <div className="whitespace-pre-wrap break-words">{streamingText}</div>
            <span className="inline-block w-1.5 h-4 bg-neon-cyan animate-pulse ml-0.5" />
          </div>
        )}

        {/* Sovereignty Prompt */}
        {sovereigntyPrompt && (
          <SovereigntyPrompt
            message={sovereigntyPrompt}
            onResolve={handleSovereigntyResolve}
            isResolving={isResolvingSovereignty}
          />
        )}

        {/* Pipeline Prompt — life event detected */}
        {pipelinePrompt && (
          <div className="mx-4 my-3 p-4 rounded-lg border border-blue-500/30 bg-blue-900/10">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-blue-300">Pipeline Available</span>
            </div>
            <p className="text-sm text-zinc-300 mb-3">{pipelinePrompt.message}</p>
            <div className="mb-3 space-y-1">
              <p className="text-xs text-zinc-500">Steps:</p>
              {pipelinePrompt.steps.map((s, i) => (
                <div key={i} className="text-xs text-zinc-400 flex items-center gap-2">
                  <span className="text-zinc-600">{s.order}.</span>
                  <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{s.lens}</span>
                  {s.action.replace(/-/g, ' ')}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  const pp = pipelinePrompt;
                  setPipelinePrompt(null);
                  try {
                    const res = await api.post('/api/pipeline/execute', { pipelineId: pp.pipelineId, variables: pp.variables, sessionId }).then(r => r.data);
                    if (res?.execution) {
                      setActivePipeline({
                        pipelineId: pp.pipelineId,
                        executionId: res.execution.id,
                        description: pp.description,
                        steps: pp.steps,
                      });
                    }
                  } catch (e) { console.error('[Chat] Pipeline execution failed:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to run pipeline' }); }
                }}
                className="px-3 py-2 rounded-lg text-sm bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 transition-colors"
              >
                Run pipeline
              </button>
              <button
                onClick={() => setPipelinePrompt(null)}
                className="px-3 py-2 rounded-lg text-sm bg-zinc-800 border border-zinc-700 text-zinc-400 hover:border-zinc-600 transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* Active Pipeline Progress */}
        {activePipeline && (
          <PipelineProgress
            pipelineId={activePipeline.pipelineId}
            executionId={activePipeline.executionId}
            description={activePipeline.description}
            steps={activePipeline.steps}
            onComplete={() => {
              setMessages(prev => [...prev, {
                id: `msg-${Date.now()}-pipeline`,
                role: 'assistant' as const,
                content: `Pipeline complete! ${activePipeline.description} — all documents generated.`,
                lens: currentLens,
                timestamp: new Date().toISOString(),
              }]);
              setActivePipeline(null);
            }}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="px-4 py-3 border-t border-lattice-border bg-lattice-surface"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
            rows={1}
            className="flex-1 resize-none bg-lattice-deep border border-lattice-border rounded-lg
              px-3 py-2 text-sm text-white placeholder:text-zinc-500
              outline-none focus:border-neon-blue/50 transition-colors
              max-h-32 overflow-y-auto"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || chatStatus !== 'idle'}
            aria-label={chatStatus !== 'idle' ? 'Sending message' : 'Send message'}
            className="p-2 rounded-lg bg-neon-blue/20 text-neon-blue
              hover:bg-neon-blue/30 disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors"
          >
            {chatStatus !== 'idle' ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </form>

      {/* Context Overlay */}
      <ContextOverlay
        sessionId={sessionId}
        lens={currentLens ?? undefined}
        isOpen={contextOverlayOpen}
        onClose={() => setContextOverlayOpen(false)}
      />
    </div>
  );
}

export default PersistentChatRail;
