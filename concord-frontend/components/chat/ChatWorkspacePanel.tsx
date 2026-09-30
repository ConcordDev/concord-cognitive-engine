'use client';

/**
 * ChatWorkspacePanel — conversation canvas for the chat lens.
 *
 * Owns thread state, composer, ConKay mode, and ONE `overlay` union for
 * secondary panels (projects / prompts / tools / search / studio / …).
 * Page.tsx is the thin shell that owns the ONE view-state machine (`active`).
 */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { HackerNewsReference } from '@/components/chat/HackerNewsReference';
import { ExternalReferenceLocale } from '@/components/lens/ExternalReferenceLocale';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useTilePush } from '@/hooks/useTilePush';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import {
  Bot as MTabChat, MessageSquare as MTabConvos, Search as MTabSearch,
  Command as MTabTools, Clock as MTabSched, Folder as MTabProj,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiHelpers, lensRun } from '@/lib/api/client';
import { getApiBase } from '@/lib/api/base';
import { useUIStore } from '@/store/ui';
import { Virtuoso } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Paperclip,
  Smile,
  Pencil,
  MoreVertical,
  Search,
  Settings,
  Plus,
  Bot,
  User,
  Sparkles,
  Copy,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Code,
  FileText,
  Brain,
  ChevronDown,
  MessageSquare,
  Zap,
  BookOpen,
  Eye,
  Activity,
  CheckCircle2,
  Pin,
  Quote,
  X,
  Hash,
  Globe,
  Trash2,
  Download,
  Users,
  Check,
  ExternalLink,
  Layers,
  Loader2,
  Hammer,
  ChevronRight,
  PauseCircle,
  PlayCircle,
  GitBranch,
  Key,
  FolderOpen,
  Clock,
  LayoutGrid,
} from 'lucide-react';
import { cn } from '@/lib/utils';
// ConKay ("Kay") — Concord's JARVIS-style majordomo, as a voice-native chat MODE.
import { ConKayBackdrop } from '@/components/conkay/ConKayBackdrop';
import { ConKayHud } from '@/components/conkay/ConKayHud';
import { SessionContextBadge } from '@/components/conkay/SessionContextBadge';
import { ConKayMessage } from '@/components/conkay/ConKayViz';
import { useConKayVoice } from '@/components/conkay/useConKayVoice';
import { CONKAY_PERSONA_PROMPT, type ConKayState } from '@/components/conkay/conkay-persona';
import { matchConKaySkill, type ConKaySkill } from '@/components/conkay/conkay-skills';
// Unit A5-backport — the SAME cockpit machinery the global ConKayOverlay uses
// (docs/NEXT_ARC_PLAN.md Track A), reused (not forked) so `/mode conkay`
// inside the chat lens reaches feature parity with the summonable overlay:
// the pre-execution confirm gate, the artifact→3D pipeline, and the F1
// cockpit's panel lanes (macro library / provenance / forward-sim / artifact
// viewer / orchestration trace / telemetry / connector status).
import { ConKayActionConfirm } from '@/components/conkay/ConKayActionConfirm';
import { ConKayCockpit } from '@/components/conkay/ConKayCockpit';
import { isMutatingMacro } from '@/lib/conkay/mutating-macros';
import { detectArtifact } from '@/lib/conkay/artifact-kinds';
import { useConkayHudStore, feaResultFromRun } from '@/components/conkay/conkayHudStore';
import { subscribe, connectSocket, onConnectionLost, onReconnected } from '@/lib/realtime/socket';
import { formatBytes } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import MessageRenderer from '@/components/chat/MessageRenderer';
import OracleResponse from '@/components/chat/OracleResponse';
import { ToolCallCard } from '@/components/chat/ToolCallCard';
import ComputeBadge from '@/components/chat/ComputeBadge';
import CitationChips from '@/components/chat/CitationChips';
import AnonNudge from '@/components/chat/AnonNudge';
import BranchForkButton from '@/components/chat/BranchForkButton';
import BYOKeyDrawer from '@/components/chat/BYOKeyDrawer';
import { useAuth } from '@/hooks/useAuth';
import { ReasoningIndicator } from '@/components/chat/ReasoningIndicator';
import { MessageContinuationMarker } from '@/components/chat/MessageContinuationMarker';
import { useOracleSolve, type OracleResponseData } from '@/hooks/useOracleSolve';
import AtlasOverlay from '@/components/chat/AtlasOverlay';
import ProjectsPanel, { type ChatProject } from '@/components/chat/ProjectsPanel';
import PromptsLibrary from '@/components/chat/PromptsLibrary';
import ThreadSearchOverlay from '@/components/chat/ThreadSearchOverlay';
import ScheduledTasksPanel from '@/components/chat/ScheduledTasksPanel';
import ChatStudioPanel, { type StudioMessage } from '@/components/chat/ChatStudioPanel';
import {
  WelcomePanel,
  AssistPanel,
  ExplorePanel,
  ConnectPanel,
  ModeSelector,
  ChatPanel as ChatModePanel,
} from '@/components/chat/ChatModePanels';
import ChatRouteOverlay from '@/components/chat/ChatRouteOverlay';
import { ContextOverlay } from '@/components/chat/ContextOverlay';
import ForgeCard from '@/components/chat/ForgeCard';
import FoundationCard from '@/components/chat/FoundationCard';
import { SessionSidebar } from '@/components/chat/SessionSidebar';
import { BrainModePanel } from '@/components/byo-keys/BrainModePanel';
// ── Systems panels ─────────────────────────────────────────────
// These five panels round-trip through the /api/chat cognitive
// pipeline and surface system-level context alongside the
// conversation — security posture, mesh state, inference model
// status, proactive initiative chips, and Atlas privacy zones.
// All fully built, all previously orphaned.
import { InitiativeChip, type Initiative } from '@/components/chat/InitiativeChip';
import { ChatSystemsDrawer } from '@/components/chat/ChatSystemsDrawer';
import { ChatToolsDrawer } from '@/components/chat/ChatToolsDrawer';
import { ChatWorkspaceMenu } from '@/components/chat/ChatWorkspaceMenu';
import {
  ACCEPTED_FILE_TYPES,
  MAX_BASE64_SIZE,
  deleteMessagesForSession,
  fileToBase64,
  formatRelativeTime,
  generateUUID,
  loadConversations,
  loadMessagesForSession,
  loadSessionId,
  saveConversations,
  saveMessagesForSession,
  saveSessionId,
  type ChatMessageLike,
} from '@/components/chat/chatLocalStore';
import { AI_MODES, PERSONAS, SLASH_COMMANDS } from '@/components/chat/ChatModeConfig';
import { ToolTraceBlock } from '@/components/chat/ToolTraceBlock';
import type { ChatMode } from '@/components/chat/ChatModeTypes';

import { AssistantMoodChip } from '@/components/chat/AssistantMoodChip';
import { ToolPalette } from '@/components/chat/ToolPalette';
import { SafeCard } from '@/components/common/SafeCard';
import { GracefulFallback } from '@/components/common/GracefulFallback';
// Sprint 11 — Agent Mode + initiative bell (mounted alongside, no
// modification to existing chat state). Dynamic to keep main-bundle
// LCP/FCP from regressing (Sprint 15 Lighthouse fix).
import dynamicSprint11 from 'next/dynamic';
const AgentModePanel = dynamicSprint11(() => import('@/components/chat/AgentModePanel'), { ssr: false });
const InitiativeBell = dynamicSprint11(() => import('@/components/chat/InitiativeBell'), { ssr: false });
import { useEvent } from '@/lib/realtime/event-bus';
import {
  recommendLenses,
  createSessionContext,
  createSessionTelemetry,
  recordLensOpened,
  type LensRecommendation,
  type SessionContext,
  type SessionTelemetry,
} from '@/lib/lenses/chat-lens-recommender';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface Attachment {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  preview?: string; // base64 data URL for images
  dataBase64?: string; // base64 content for small files (< 512KB)
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  model?: string;
  tokens?: number;
  refs?: Array<{ id: string; title: string; lineageHash?: string }>;
  dtuId?: string;
  feedbackGiven?: 'up' | 'down' | null;
  pinned?: boolean;
  attachments?: Array<{ name: string; size: number; type: string }>;
  quotedMessageId?: string;
  quotedContent?: string;
  sources?: Array<{
    type: string;
    title: string;
    url: string;
    source: string;
    snippet?: string;
    fetchedAt?: string;
  }>;
  webAugmented?: boolean;
  oracleResponse?: OracleResponseData;
  toolCalls?: Array<{
    tool: string;
    params: Record<string, unknown>;
    result: unknown;
    ok: boolean;
    key?: string;
    url?: string;
    title?: string;
  }>;
  reasoningSessionId?: string;
  wasSynthesized?: boolean;
  shadowsUsed?: number;
  computed?: {
    capabilities?: Array<{ key: string; score?: number; description?: string }>;
    engineCount?: number;
  } | null;
  dtuRefs?: Array<{ id: string; title: string | null; tier: string | null }>;
}

interface Conversation {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
  messageCount: number;
}

interface AIMode {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  description: string;
}

interface Persona {
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  description: string;
  systemPrompt: string;
}

interface SlashCommand {
  command: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string; size?: number | string }>;
  args?: string;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────


function newConKayRunId(): string {
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Parse the explicit "run <domain>.<macro> [{json}]" command chat's ConKay
 *  mode supports — the same client-initiated syntax ConKayOverlay accepts
 *  (minus the bare-macro/current-lens shorthand, which has no meaning inside
 *  the chat lens itself: there is no "lens being operated," so the domain is
 *  always required explicitly). Returns null when the text doesn't match. */
function parseConKayRunCommand(
  text: string
): { domain: string; macro: string; input: Record<string, unknown> } | null {
  const m = text.trim().match(/^run\s+([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\s*(\{[\s\S]*\})?$/i);
  if (!m) return null;
  let input: Record<string, unknown> = {};
  if (m[3]) {
    try {
      const parsed = JSON.parse(m[3]);
      if (parsed && typeof parsed === 'object') input = parsed as Record<string, unknown>;
    } catch {
      // leave input empty — an honest "couldn't parse" is surfaced by the
      // resulting macro call failing validation server-side, not silently
      // guessed at here.
    }
  }
  return { domain: m[1], macro: m[2], input };
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export interface ChatWorkspacePanelProps {
  active: ChatMode;
  onActiveChange: (mode: ChatMode) => void;
}

export function ChatWorkspacePanel({ active, onActiveChange }: ChatWorkspacePanelProps) {
  // Phase 12 (Item 8 cont.) — flash on chat completion + multi-device
  // message saves. Excludes chat:token / chat:status because those fire
  // once per streamed token and would strobe the surface.
  useTilePush({ lensId: 'chat', events: ['chat:complete', 'message:saved'] });
  const queryClient = useQueryClient();

  const {
    hyperDTUs,
    megaDTUs,
    regularDTUs,
    tierDistribution,
    publishToMarketplace,
    refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'chat' });

  // Existing state
  const [input, setInput] = useState('');
  const [selectedConversation, setSelectedConversation] = useState<string | null>(() =>
    loadSessionId()
  );
  const [aiMode, setAiMode] = useState<AIMode>(AI_MODES[0]);
  const isConKay = aiMode.id === 'conkay';
  const [conkayMuted, setConkayMuted] = useState(false);
  // Ambient "acting" flare + a "skill is running" flag (drives the processing state).
  const [conkayActing, setConkayActing] = useState(false);
  const [conkaySkillRunning, setConkaySkillRunning] = useState(false);
  const conkayBottomRef = useRef<HTMLDivElement>(null);
  // Unit A5-backport — the correlation id of the macro run currently in
  // flight (mirrors ConKayOverlay's `liveRunRef`), and the pre-execution
  // confirm gate for a CLIENT-INITIATED mutating macro call typed as
  // "run domain.macro {json}". `pendingConfirmResolveRef` is the in-flight
  // promise's resolver — never a fabricated auto-approve; only
  // `resolveConkayPendingConfirm` (wired to the real Confirm/Cancel buttons
  // on <ConKayActionConfirm>) settles it.
  const conkayLiveRunRef = useRef<string | null>(null);
  const [conkayPendingConfirm, setConkayPendingConfirm] = useState<{
    domain: string;
    macro: string;
    input: Record<string, unknown>;
  } | null>(null);
  const conkayPendingConfirmResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  // True while a "run domain.macro" call (including its confirm wait) is
  // in flight — feeds the same `conkayState` processing signal skills use,
  // so the HUD/backdrop honestly reflect a run-command the same way they
  // reflect a skill run (no separate, lesser "processing" state for this path).
  const [conkayMacroRunning, setConkayMacroRunning] = useState(false);
  const [modeSelectOpen, setModeSelectOpen] = useState(false);
  // ONE overlay primitive — kills the showX modal soup (playbook §2).
  type ChatOverlay =
    | null
    | 'systems'
    | 'tools'
    | 'tool-palette'
    | 'agent'
    | 'projects'
    | 'prompts'
    | 'scheduled'
    | 'thread-search'
    | 'studio'
    | 'byo'
    | 'context'
    | 'session'
    | 'global-search'
    | 'convos';
  const [overlay, setOverlay] = useState<ChatOverlay>(null);
  const systemsPanelOpen = overlay === 'systems';
  const toolsPanelOpen = overlay === 'tools';
  const toolPaletteOpen = overlay === 'tool-palette';
  const agentPanelOpen = overlay === 'agent';
  const projectsPanelOpen = overlay === 'projects';
  const promptsPanelOpen = overlay === 'prompts';
  const scheduledPanelOpen = overlay === 'scheduled';
  const threadSearchOpen = overlay === 'thread-search';
  const studioOpen = overlay === 'studio';
  const byoOpen = overlay === 'byo';
  const contextOverlayOpen = overlay === 'context';
  const sessionSidebarOpen = overlay === 'session';
  const globalSearchOpen = overlay === 'global-search';
  const chatSidebarOpen = overlay === 'convos';
  const setSystemsPanelOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(systemsPanelOpen) : v;
    setOverlay(next ? 'systems' : null);
  };
  const setToolsPanelOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(toolsPanelOpen) : v;
    setOverlay(next ? 'tools' : null);
  };
  const setToolPaletteOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(toolPaletteOpen) : v;
    setOverlay(next ? 'tool-palette' : null);
  };
  const setAgentPanelOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(agentPanelOpen) : v;
    setOverlay(next ? 'agent' : null);
  };
  const setProjectsPanelOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(projectsPanelOpen) : v;
    setOverlay(next ? 'projects' : null);
  };
  const setPromptsPanelOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(promptsPanelOpen) : v;
    setOverlay(next ? 'prompts' : null);
  };
  const setScheduledPanelOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(scheduledPanelOpen) : v;
    setOverlay(next ? 'scheduled' : null);
  };
  const setThreadSearchOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(threadSearchOpen) : v;
    setOverlay(next ? 'thread-search' : null);
  };
  const setStudioOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(studioOpen) : v;
    setOverlay(next ? 'studio' : null);
  };
  const setByoOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(byoOpen) : v;
    setOverlay(next ? 'byo' : null);
  };
  const setContextOverlayOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(contextOverlayOpen) : v;
    setOverlay(next ? 'context' : null);
  };
  const setSessionSidebarOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(sessionSidebarOpen) : v;
    setOverlay(next ? 'session' : null);
  };
  const setGlobalSearchOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(globalSearchOpen) : v;
    setOverlay(next ? 'global-search' : null);
  };
  const setChatSidebarOpen = (v: boolean | ((p: boolean) => boolean)) => {
    const next = typeof v === 'function' ? v(chatSidebarOpen) : v;
    setOverlay(next ? 'convos' : null);
  };
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [feedbackState, setFeedbackState] = useState<Record<string, 'up' | 'down'>>({});
  const [conversationSearch, setConversationSearch] = useState('');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  // Front-door density: the 8 secondary workspace tools (Context/Tools/Systems/
  // Projects/Prompts/Schedule/Studio/Search) collapse into one "Workspace" overflow
  // so the header reads as a chat app, not a cockpit. Primary controls (AI mode,
  // persona, domain badge, mood) stay inline.
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [renamingConversation, setRenamingConversation] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [storedConversations, setStoredConversations] = useState<Conversation[]>(() =>
    loadConversations<Conversation>()
  );

  // Hydrate sidebar from server-persisted sessions (authenticated users
  // only — anon users have no backend session record). Runs once on
  // mount + whenever auth state flips. Merges with localStorage by
  // session id so the user sees BOTH (cross-device server-side + this
  // device's local-only).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/chat/sessions?limit=100', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json() as { ok: boolean; sessions?: Array<{ id: string; title: string | null; lens: string | null; updated_at: number; created_at: number; msg_count: number }> };
        if (cancelled || !json.ok || !Array.isArray(json.sessions)) return;
        setStoredConversations((prev) => {
          const localById = new Map(prev.map((c) => [c.id, c]));
          for (const s of json.sessions!) {
            const existing = localById.get(s.id);
            const remote: Conversation = {
              id: s.id,
              title: s.title || existing?.title || 'New conversation',
              lastMessage: existing?.lastMessage || '',
              updatedAt: new Date(s.updated_at).toISOString(),
              messageCount: s.msg_count || existing?.messageCount || 0,
            };
            localById.set(s.id, remote);
          }
          return Array.from(localById.values()).sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        });
      } catch { /* anon or offline — sidebar stays localStorage-only */ }
    })();
    return () => { cancelled = true; };
  // Re-fetch when auth flips (login → cross-device sessions appear).
  }, []);

  // New state — Persona picker
  const [selectedPersona, setSelectedPersona] = useState<Persona>(PERSONAS[0]);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);

  // New state — Slash commands
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

  // New state — File attachments
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // New state — Message actions
  const [pinnedMessages, setPinnedMessages] = useState<Set<string>>(new Set());
  const [quotedMessage, setQuotedMessage] = useState<Message | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  // New state — Domain context
  const [domainContext, setDomainContext] = useState<string>('');
  const [inspectingDtuId, setInspectingDtuId] = useState<string | null>(null);

  // Consume ?context=<domain> from the URL on mount — this is what the per-lens
  // "Ask about {lens}" button (SmartContextBar) passes, so arriving here actually
  // sets the domain context (previously it was dropped → the button looked broken).
  useEffect(() => {
    try {
      const ctx = new URLSearchParams(window.location.search).get('context');
      if (ctx) setDomainContext(ctx);
    } catch { /* SSR / no window */ }
  }, []);

  // Consume ?mode=<id> from the URL on mount — this is how ConKay becomes a
  // "hidden staple" summonable from anywhere (command palette "Summon Kay",
  // deep links). /lenses/chat?mode=conkay drops you straight into ConKay mode.
  useEffect(() => {
    try {
      const m = new URLSearchParams(window.location.search).get('mode');
      if (m) {
        const found = AI_MODES.find((x) => x.id === m);
        if (found) setAiMode(found);
      }
    } catch { /* SSR / no window */ }
  }, []);

  // New state — Wired orphan components

  // ── Systems panel (shield / mesh / intel / privacy / initiatives) ─────
  // Opt-in drawer surfacing the orphaned systems cards. All five
  // components are fully built; this gives them a live home inside
  // the chat lens where they're most useful (the AI can reference
  // shield/mesh/intel state while responding). Endpoints are thin
  // REST wrappers that delegate to the corresponding macros server-side.
  // Chat "Analysis & features" tools live in a right-side drawer (opened from
  // the Workspace menu), NOT inline in the message column — see the drawer near
  // the Systems drawer below. Default closed so the lens reads as a clean chat.

  // Tool palette — every domain.action across all 200 lens manifests
  // is searchable + runnable from here. Open via /tool slash command
  // or Cmd/Ctrl+. keyboard shortcut.

  // 2026 parity — Projects / Prompts / Search / Scheduled slide-overs.
  // Parity vs Claude Projects + ChatGPT Projects + Perplexity Spaces +
  // ChatGPT scheduled-tasks. State management mirrors systemsPanelOpen.
  const [activeProject, setActiveProject] = useState<ChatProject | null>(null);

  // ChatGPT-parity studio — voice / custom GPTs / canvas / memory /
  // code interpreter / share links / image generation. One slide-over,
  // seven tabs, each backed by a real chat-domain macro.

  // Tool execution traces — when Concord (or the user via the palette)
  // runs a tool, the result appears inline in the thread as a trace
  // block. Sourced from chat:tool_result socket events + direct local
  // dispatch when the user runs from the palette.
  interface ToolTrace {
    id: string;
    domain: string;
    action: string;
    result: unknown;
    error?: string;
    createdAt: string;
  }
  const [toolTraces, setToolTraces] = useState<ToolTrace[]>([]);
  useEvent<{ id?: string; domain?: string; action?: string; result?: unknown; error?: string }>(
    'chat:tool_result',
    (data) => {
      if (!data?.domain || !data?.action) return;
      setToolTraces((prev) => [
        ...prev,
        {
          id: data.id ?? `trace_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          domain: data.domain!,
          action: data.action!,
          result: data.result,
          error: data.error,
          createdAt: new Date().toISOString(),
        },
      ]);
    }
  );

  // "Pause Concord" — toggles initiative delivery server-side via
  // PUT /api/initiative/settings. When paused, the engine continues to
  // queue but doesn't deliver until unpaused.
  const [initiativesPaused, setInitiativesPaused] = useState(false);
  useEffect(() => {
    api
      .get<{ ok?: boolean; settings?: { disabled?: boolean } }>('/api/initiative/settings')
      .then((r) => setInitiativesPaused(!!r.data?.settings?.disabled))
      .catch(() => {});
  }, []);
  const toggleInitiativesPaused = useCallback(() => {
    const next = !initiativesPaused;
    setInitiativesPaused(next);
    api
      .put('/api/initiative/settings', { disabled: next })
      .catch(() => setInitiativesPaused(!next));
  }, [initiativesPaused]);
  // Initiatives are Concord's proactive messages to the user. They
  // arrive unprompted — Concord can "double-text" — and need to appear
  // *inline in the conversation thread*, not buried in a drawer. Poll
  // continuously while the chat lens is mounted.
  const { data: initiativesData } = useQuery({
    queryKey: ['chat-initiatives'],
    queryFn: () =>
      api
        .get<{ pending?: Initiative[]; initiatives?: Initiative[] }>('/api/initiative/pending')
        .then((r) => r.data?.pending || r.data?.initiatives || []),
    refetchInterval: 30_000,
  });
  const [atlasQuery, _setAtlasQuery] = useState('');
  const [atlasResult, _setAtlasResult] = useState<Record<string, unknown> | null>(null);
  const [atlasLoading, _setAtlasLoading] = useState(false);
  const [routeMeta, setRouteMeta] = useState<{
    actionType: string;
    lenses: Array<{ lensId: string; score: number }>;
    primaryLens: string | null;
    isMultiLens: boolean;
    confidence: number;
    attribution: string[];
    message: string | null;
  } | null>(null);
  const [forgeEnvelope, setForgeEnvelope] = useState<Record<string, unknown> | null>(null);

  // ── Chat backend action state ──
  const runChatAction = useRunArtifact('chat');
  const { items: chatArtifacts } = useLensData<Record<string, unknown>>('chat', 'conversation', {
    seed: [],
  });
  const [chatActionRunning, setChatActionRunning] = useState<string | null>(null);
  const [threadSummarizeResult, setThreadSummarizeResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [participantAnalysisResult, setParticipantAnalysisResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [topicDetectionResult, setTopicDetectionResult] = useState<Record<string, unknown> | null>(
    null
  );

  // ── Lens Recommender state ──
  const [lensRecommendations, setLensRecommendations] = useState<LensRecommendation[]>([]);
  const lensSessionCtx = useRef<SessionContext>(createSessionContext());
  const lensTelemetry = useRef<SessionTelemetry>(createSessionTelemetry());

  // Compute lens recommendations whenever messages change
  const lastUserMessage = useMemo(() => {
    const userMessages = localMessages.filter((m) => m.role === 'user');
    return userMessages.length > 0 ? userMessages[userMessages.length - 1].content : '';
  }, [localMessages]);

  useEffect(() => {
    if (!lastUserMessage) {
      setLensRecommendations([]);
      return;
    }
    try {
      const result = recommendLenses(lastUserMessage, lensSessionCtx.current);
      setLensRecommendations(result.recs.slice(0, 3));
    } catch {
      setLensRecommendations([]);
    }
  }, [lastUserMessage]);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ──────────────────────────────────────────────
  // Queries
  // ──────────────────────────────────────────────

  const {
    data: cogStatus,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['cognitive-status'],
    queryFn: () => apiHelpers.cognitive.status().then((r) => r.data),
    refetchInterval: 30000,
    retry: 1,
    staleTime: 15_000,
  });

  // Persist selectedConversation to localStorage whenever it changes
  useEffect(() => {
    saveSessionId(selectedConversation);
  }, [selectedConversation]);

  // Load messages when switching conversations. localStorage is the
  // hot read (this device), but if it's empty AND the user is signed
  // in, fetch from /api/chat/messages — that's the cross-device case
  // (chatted on laptop, opened on phone). Server-side messages always
  // override empty local state; non-empty local state wins to avoid
  // clobbering unsynced drafts from a recent send.
  useEffect(() => {
    if (!selectedConversation) return;
    const saved = loadMessagesForSession<Message>(selectedConversation);
    if (saved.length > 0) {
      setLocalMessages(saved);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/chat/messages?sessionId=${encodeURIComponent(selectedConversation)}&limit=200`,
          { credentials: 'include' }
        );
        if (!res.ok || cancelled) return;
        const json = await res.json() as { ok: boolean; messages?: Array<{ role: string; content: string; ts: string; meta?: Record<string, unknown> }> };
        if (cancelled || !json.ok || !Array.isArray(json.messages)) return;
        // Hydrate into Message[] shape; meta carries computed/dtuRefs/toolCalls
        // we previously persisted so chip + badge surfaces re-render identically.
        const hydrated: Message[] = json.messages.map((m, i) => {
          const meta = (m.meta || {}) as Record<string, unknown>;
          return {
            id: `hyd-${selectedConversation}-${i}-${m.ts}`,
            role: (m.role === 'assistant' || m.role === 'system') ? m.role : 'user',
            content: m.content,
            timestamp: m.ts,
            toolCalls: Array.isArray(meta.toolCalls) ? (meta.toolCalls as Message['toolCalls']) : undefined,
            computed: (meta.computed && typeof meta.computed === 'object') ? (meta.computed as Message['computed']) : undefined,
            dtuRefs: Array.isArray(meta.dtuRefs) ? (meta.dtuRefs as Message['dtuRefs']) : undefined,
            sources: Array.isArray(meta.sources) ? (meta.sources as Message['sources']) : undefined,
            webAugmented: !!meta.webAugmented,
          };
        });
        setLocalMessages(hydrated);
        // Backfill localStorage so the next open is hot-path again.
        try { saveMessagesForSession(selectedConversation, hydrated as ChatMessageLike[]); } catch { /* private mode */ }
      } catch { /* anon, offline, or 403 — leave empty */ }
    })();
    return () => { cancelled = true; };
  }, [selectedConversation]);

  // Persist messages whenever they change (debounced via the conversation id)
  useEffect(() => {
    if (selectedConversation && localMessages.length > 0) {
      saveMessagesForSession(selectedConversation, localMessages as ChatMessageLike[]);
    }
  }, [localMessages, selectedConversation]);

  // Feed the server-side thread search index (chat.thread-index) so ⌘K /
  // "Search chats" (ThreadSearchOverlay -> chat.threads-search) actually has
  // something to search. Previously nothing ever called thread-index, so the
  // overlay always reported "0 threads indexed" no matter how many real
  // conversations existed. Debounced (2s of quiet) so a fast exchange doesn't
  // fire one index write per token.
  useEffect(() => {
    if (!selectedConversation || localMessages.length === 0) return;
    const t = setTimeout(() => {
      const conv = storedConversations.find((c) => c.id === selectedConversation);
      const title = conv?.title || 'Untitled conversation';
      const lastMsg = localMessages[localMessages.length - 1];
      const snippet = (lastMsg?.content || '').slice(0, 400);
      api.post('/api/lens/run', {
        domain: 'chat',
        action: 'thread-index',
        input: {
          threadId: selectedConversation,
          title,
          snippet,
          lastMsgAt: lastMsg?.timestamp || new Date().toISOString(),
        },
      }).catch(() => { /* best-effort — search staying stale is non-fatal */ });
    }, 2000);
    return () => clearTimeout(t);
  }, [localMessages, selectedConversation, storedConversations]);

  // Conversations are managed in local state (backed by localStorage)
  const conversations = storedConversations;

  const messages = localMessages;

  const filteredConversations = useMemo(() => {
    if (!conversations || !conversationSearch.trim()) return conversations || [];
    const q = conversationSearch.toLowerCase();
    return conversations.filter(
      (c) => c.title.toLowerCase().includes(q) || c.lastMessage?.toLowerCase().includes(q)
    );
  }, [conversations, conversationSearch]);

  const [streamingContent, setStreamingContent] = useState('');
  const [streamActive, setStreamActive] = useState(false);

  // Scroll anchor — keeps the bottom of the streaming preview in view as
  // tokens arrive. Throttled via rAF so fast token bursts don't queue up
  // dozens of scroll calls. Only scrolls when the user is already near
  // the bottom (auto-follow); if they've scrolled up to read history we
  // don't yank them back.
  const streamingAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTsRef = useRef<number>(0);
  useEffect(() => {
    if (!streamActive || !streamingContent || !streamingAnchorRef.current) return;
    const now = performance.now();
    if (now - lastScrollTsRef.current < 80) return; // ~12 fps cap
    lastScrollTsRef.current = now;
    const anchor = streamingAnchorRef.current;
    const scroller = anchor.closest('.overflow-y-auto, .overflow-auto') as HTMLElement | null;
    if (scroller) {
      const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
      // Only auto-follow when the user is within 200px of the bottom.
      if (distanceFromBottom > 200) return;
    }
    requestAnimationFrame(() => {
      anchor?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
  }, [streamingContent, streamActive]);

  // BYO key drawer + anon-nudge UI state.
  const [anonNudgeDismissed, setAnonNudgeDismissed] = useState(() => {
    try { return typeof window !== 'undefined' && localStorage.getItem('concord_anon_nudge_dismissed') === '1'; }
    catch { return false; }
  });
  const { isAuthenticated } = useAuth();
  const dismissAnonNudge = useCallback(() => {
    setAnonNudgeDismissed(true);
    try { localStorage.setItem('concord_anon_nudge_dismissed', '1'); } catch { /* private mode */ }
  }, []);

  // ──────────────────────────────────────────────
  // Oracle Engine — rich response mutation
  // ──────────────────────────────────────────────

  const oracleSolveMutation = useOracleSolve();

  const runOracleQuery = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        const sysMsg: Message = {
          id: `sys-${Date.now()}`,
          role: 'system',
          content:
            'Usage: /oracle [your question]. The Oracle Engine returns a rich answer with sources, computations, and cross-domain connections.',
          timestamp: new Date().toISOString(),
        };
        setLocalMessages((prev) => [...prev, sysMsg]);
        return;
      }

      // Push the user message immediately so the query appears in the thread
      const userMsg: Message = {
        id: `oracle-user-${Date.now()}`,
        role: 'user',
        content: `/oracle ${trimmed}`,
        timestamp: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, userMsg]);

      // Status placeholder while the Oracle solves
      const pendingId = `oracle-pending-${Date.now()}`;
      const pendingMsg: Message = {
        id: pendingId,
        role: 'system',
        content: 'Oracle Engine is solving — running 6-phase pipeline…',
        timestamp: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, pendingMsg]);

      oracleSolveMutation.mutate(
        { query: trimmed, context: domainContext ? { domain: domainContext } : null },
        {
          onSuccess: (data) => {
            const assistantMsg: Message = {
              id: `oracle-asst-${Date.now()}`,
              role: 'assistant',
              content: data.answer || '(no answer)',
              timestamp: new Date().toISOString(),
              oracleResponse: data,
            };
            setLocalMessages((prev) => [...prev.filter((m) => m.id !== pendingId), assistantMsg]);
            queryClient.invalidateQueries({ queryKey: ['dtus'] });
          },
          onError: (err) => {
            const errMsg: Message = {
              id: `oracle-err-${Date.now()}`,
              role: 'system',
              content: `Oracle Engine failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
              timestamp: new Date().toISOString(),
            };
            setLocalMessages((prev) => [...prev.filter((m) => m.id !== pendingId), errMsg]);
          },
        }
      );
    },
    [oracleSolveMutation, domainContext, queryClient]
  );

  // ──────────────────────────────────────────────
  // Slash command filtering
  // ──────────────────────────────────────────────

  const filteredSlashCommands = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS;
    const q = slashFilter.toLowerCase();
    return SLASH_COMMANDS.filter(
      (cmd) => cmd.command.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q)
    );
  }, [slashFilter]);

  // Reset selection when filtered commands change
  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [filteredSlashCommands.length]);

  // ──────────────────────────────────────────────
  // Slash command execution
  // ──────────────────────────────────────────────

  const executeSlashCommand = useCallback(
    (rawInput: string) => {
      const trimmed = rawInput.trim();
      const parts = trimmed.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case '/mode': {
          if (arg) {
            const mode = AI_MODES.find(
              (m) =>
                m.id.toLowerCase() === arg.toLowerCase() ||
                m.name.toLowerCase() === arg.toLowerCase()
            );
            if (mode) {
              setAiMode(mode);
              const sysMsg: Message = {
                id: `sys-${Date.now()}`,
                role: 'system',
                content: `Switched to ${mode.name} mode: ${mode.description}`,
                timestamp: new Date().toISOString(),
              };
              setLocalMessages((prev) => [...prev, sysMsg]);
            } else {
              const sysMsg: Message = {
                id: `sys-${Date.now()}`,
                role: 'system',
                content: `Unknown mode "${arg}". Available: ${AI_MODES.map((m) => m.id).join(', ')}`,
                timestamp: new Date().toISOString(),
              };
              setLocalMessages((prev) => [...prev, sysMsg]);
            }
          } else {
            setModeSelectOpen(true);
          }
          break;
        }
        case '/clear':
          startNewChat();
          break;
        case '/export':
          handleExportChat();
          break;
        case '/forge': {
          const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
          if (lastAssistant) {
            forgeMutation.mutate(lastAssistant.content);
          } else {
            const sysMsg: Message = {
              id: `sys-${Date.now()}`,
              role: 'system',
              content: 'No assistant message to forge.',
              timestamp: new Date().toISOString(),
            };
            setLocalMessages((prev) => [...prev, sysMsg]);
          }
          break;
        }
        case '/tool': {
          setToolPaletteOpen(true);
          break;
        }
        case '/help': {
          const helpText = SLASH_COMMANDS.map((c) => `${c.label} — ${c.description}`).join('\n');
          const sysMsg: Message = {
            id: `sys-${Date.now()}`,
            role: 'system',
            content: `Available commands:\n${helpText}`,
            timestamp: new Date().toISOString(),
          };
          setLocalMessages((prev) => [...prev, sysMsg]);
          break;
        }
        case '/oracle': {
          runOracleQuery(arg);
          break;
        }
        case '/context': {
          if (arg) {
            setDomainContext(arg);
            const sysMsg: Message = {
              id: `sys-${Date.now()}`,
              role: 'system',
              content: `Domain context set to: ${arg}`,
              timestamp: new Date().toISOString(),
            };
            setLocalMessages((prev) => [...prev, sysMsg]);
          } else {
            const current = domainContext || '(none)';
            const sysMsg: Message = {
              id: `sys-${Date.now()}`,
              role: 'system',
              content: `Current domain context: ${current}. Use /context [domain] to set one.`,
              timestamp: new Date().toISOString(),
            };
            setLocalMessages((prev) => [...prev, sysMsg]);
          }
          break;
        }
        default: {
          const sysMsg: Message = {
            id: `sys-${Date.now()}`,
            role: 'system',
            content: `Unknown command: ${cmd}. Type /help for available commands.`,
            timestamp: new Date().toISOString(),
          };
          setLocalMessages((prev) => [...prev, sysMsg]);
        }
      }

      setInput('');
      setSlashMenuOpen(false);
      setSlashFilter('');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, domainContext, runOracleQuery]
  );

  // ──────────────────────────────────────────────
  // Chat backend action handler
  // ──────────────────────────────────────────────

  const handleChatAction = async (
    action: 'threadSummarize' | 'participantAnalysis' | 'topicDetection'
  ) => {
    const targetId = chatArtifacts[0]?.id;
    if (!targetId) return;
    setChatActionRunning(action);
    try {
      const res = await runChatAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) {
        const errResult = {
          message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
        };
        if (action === 'threadSummarize') setThreadSummarizeResult(errResult);
        else if (action === 'participantAnalysis') setParticipantAnalysisResult(errResult);
        else if (action === 'topicDetection') setTopicDetectionResult(errResult);
      } else {
        const result = res.result as Record<string, unknown>;
        if (action === 'threadSummarize') setThreadSummarizeResult(result);
        else if (action === 'participantAnalysis') setParticipantAnalysisResult(result);
        else if (action === 'topicDetection') setTopicDetectionResult(result);
      }
    } catch (e) {
      console.error(`Chat action ${action} failed:`, e);
    }
    setChatActionRunning(null);
  };

  // ──────────────────────────────────────────────
  // Mutations
  // ──────────────────────────────────────────────

  const chatAbortControllerRef = useRef<AbortController | null>(null);

  // Abort in-flight chat requests on unmount
  useEffect(() => {
    return () => {
      chatAbortControllerRef.current?.abort();
    };
  }, []);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      // Build attachment metadata
      const attachmentMeta = attachments.map((a) => ({
        name: a.name,
        size: a.size,
        type: a.type,
        ...(a.dataBase64 ? { data: a.dataBase64 } : {}),
      }));

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
        attachments: attachmentMeta.map((a) => ({ name: a.name, size: a.size, type: a.type })),
        quotedMessageId: quotedMessage?.id,
        quotedContent: quotedMessage?.content ? quotedMessage.content.slice(0, 200) : undefined,
      };

      // Ensure we have a session — if none, create one now
      let activeSessionId = selectedConversation;
      if (!activeSessionId) {
        const newId = generateUUID();
        activeSessionId = newId;
        const title = content.slice(0, 60) || 'New Conversation';
        const newConv: Conversation = {
          id: newId,
          title,
          lastMessage: content.slice(0, 100),
          updatedAt: new Date().toISOString(),
          messageCount: 1,
        };
        setStoredConversations((prev) => {
          const next = [newConv, ...prev];
          saveConversations(next);
          return next;
        });
        setSelectedConversation(newId);
        // Save the user message for this new session right away
        saveMessagesForSession(newId, [userMsg] as ChatMessageLike[]);
      }
      setLocalMessages((prev) => [...prev, userMsg]);

      // Build system prompt from persona + domain context
      let systemPrompt = '';
      if (selectedPersona.systemPrompt) {
        systemPrompt = selectedPersona.systemPrompt;
      }
      if (domainContext) {
        systemPrompt +=
          (systemPrompt ? '\n\n' : '') +
          `Current domain context: ${domainContext}. Use domain-specific knowledge and terminology.`;
      }

      // Build the message to send, optionally including quoted context
      let messageContent = content;
      if (quotedMessage) {
        messageContent = `[Quoting: "${quotedMessage.content.slice(0, 200)}"]\n\n${content}`;
      }

      // Clear attachments and quote after building message
      setAttachments([]);
      setQuotedMessage(null);

      const apiUrl = getApiBase();

      // Abort any previous in-flight request and create a new controller
      chatAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      chatAbortControllerRef.current = abortController;

      // Idle-stall watchdog: a half-open TCP / a proxy holding the socket open
      // with zero bytes would leave the stream reader awaiting forever and the
      // "typing…" state stuck. If no chunk arrives within IDLE_STALL_MS, abort
      // the stream (flagged as a stall, NOT a user abort) so the catch below
      // falls through to the buffered POST instead of hanging. The nginx 15s
      // SSE heartbeat normally keeps bytes flowing; this is the client backstop.
      const IDLE_STALL_MS = 45000;
      let idleStalled = false;

      try {
        setStreamActive(true);
        setStreamingContent('');
        const streamRes = await fetch(`${apiUrl}/api/chat/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: abortController.signal,
          body: JSON.stringify({
            message: messageContent,
            // ConKay presents as its own mode but rides the citation-oriented
            // "research" backend path + its persona prompt (archives + research).
            mode: isConKay ? 'research' : aiMode.id,
            sessionId: activeSessionId,
            ...(isConKay ? { systemPrompt: CONKAY_PERSONA_PROMPT } : systemPrompt ? { systemPrompt } : {}),
            ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
          }),
        });

        if (streamRes.ok && streamRes.headers.get('content-type')?.includes('text/event-stream')) {
          const reader = streamRes.body?.getReader();
          const decoder = new TextDecoder();
          let accumulated = '';
          let finalOut: Record<string, unknown> | null = null;

          if (reader) {
            let idleTimer: ReturnType<typeof setTimeout> | null = null;
            const armIdle = () => {
              if (idleTimer) clearTimeout(idleTimer);
              idleTimer = setTimeout(() => {
                idleStalled = true;
                try { reader.cancel(); } catch { /* already closed */ }
                try { abortController.abort(); } catch { /* already aborted */ }
              }, IDLE_STALL_MS);
            };
            try {
              armIdle(); // start the clock before the first read
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                armIdle(); // bytes arrived — reset the stall clock
                const text = decoder.decode(value, { stream: true });
              const lines = text.split('\n');
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.chunk) {
                    accumulated += data.chunk;
                    setStreamingContent(accumulated);
                  }
                  if (data.done && data.out) {
                    finalOut = data.out;
                  }
                } catch {
                  // Malformed SSE chunk, skip
                }
              }
              }
            } finally {
              if (idleTimer) clearTimeout(idleTimer);
            }
          }

          setStreamActive(false);
          setStreamingContent('');
          return {
            reply: accumulated || ((finalOut as Record<string, unknown>)?.reply as string) || '',
            refs: (finalOut as Record<string, unknown>)?.refs,
            sources: (finalOut as Record<string, unknown>)?.sources,
            webAugmented: (finalOut as Record<string, unknown>)?.webAugmented,
            toolCalls: (finalOut as Record<string, unknown>)?.toolCalls,
            computed: (finalOut as Record<string, unknown>)?.computed,
            dtuRefs: (finalOut as Record<string, unknown>)?.dtuRefs,
            streamed: true,
          };
        }

        // Non-SSE response: fall back to regular JSON
        setStreamActive(false);
        setStreamingContent('');
        const data = await streamRes.json();
        return data;
      } catch (err) {
        // A real user abort (unmount / navigation) must NOT retry. But an
        // idle-stall abort (the watchdog fired) SHOULD fall through to the
        // buffered POST — so only re-throw when the abort was NOT a stall.
        if (abortController.signal.aborted && !idleStalled) throw err;

        // Stream endpoint failed OR stalled — fall back to regular POST.
        setStreamActive(false);
        setStreamingContent('');
        // If the stream was aborted by the stall watchdog, its signal is now
        // in the aborted state and would instantly kill this POST too. Use a
        // fresh controller (still cancellable on unmount) for the fallback.
        const fbController = idleStalled ? new AbortController() : abortController;
        if (idleStalled) chatAbortControllerRef.current = fbController;
        const response = await api.post(
          '/api/chat',
          {
            message: messageContent,
            // ConKay presents as its own mode but rides the citation-oriented
            // "research" backend path + its persona prompt (archives + research).
            mode: isConKay ? 'research' : aiMode.id,
            sessionId: activeSessionId,
            ...(isConKay ? { systemPrompt: CONKAY_PERSONA_PROMPT } : systemPrompt ? { systemPrompt } : {}),
            ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
          },
          { signal: fbController.signal }
        );
        return response.data;
      }
    },
    onSuccess: (data) => {
      const assistantMsg: Message = {
        id: `asst-${Date.now()}`,
        role: 'assistant',
        content:
          data.reply ||
          data.out?.reply ||
          data.answer ||
          data.content ||
          data.text ||
          data.response ||
          (data.error
            ? `Error: ${data.error}`
            : 'The conscious brain is not responding. Check that the Ollama service is running.'),
        timestamp: new Date().toISOString(),
        refs: data.refs,
        sources: data.sources as Message['sources'],
        webAugmented: !!data.webAugmented,
        toolCalls: Array.isArray(data.toolCalls)
          ? (data.toolCalls as Message['toolCalls'])
          : undefined,
        computed: (data.computed && typeof data.computed === 'object')
          ? (data.computed as Message['computed'])
          : undefined,
        dtuRefs: Array.isArray(data.dtuRefs)
          ? (data.dtuRefs as Message['dtuRefs'])
          : undefined,
        reasoningSessionId:
          typeof data.reasoningSessionId === 'string' ? data.reasoningSessionId : undefined,
        wasSynthesized: !!data.wasSynthesized,
        shadowsUsed: typeof data.shadowsUsed === 'number' ? data.shadowsUsed : undefined,
        // Which brain/source produced this (ConKay surfaces it when present).
        model: (typeof data.brain === 'string' && data.brain)
          || (typeof data.source === 'string' && data.source)
          || (typeof data.model === 'string' && data.model)
          || undefined,
      };

      setLocalMessages((prev) => [...prev, assistantMsg]);

      // Update conversation registry metadata
      if (selectedConversation) {
        setStoredConversations((prev) => {
          const next = prev.map((c) =>
            c.id === selectedConversation
              ? {
                  ...c,
                  lastMessage: (assistantMsg.content || '').slice(0, 100),
                  updatedAt: new Date().toISOString(),
                  messageCount: c.messageCount + 2,
                }
              : c
          );
          saveConversations(next);
          return next;
        });
      }

      queryClient.invalidateQueries({ queryKey: ['cognitive-status'] });
      setInput('');
    },
    onError: (err) => {
      setStreamActive(false);
      setStreamingContent('');
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        role: 'system',
        content: `Failed to send message: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again.`,
        timestamp: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, errorMsg]);
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async (lastUserContent: string) => {
      chatAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      chatAbortControllerRef.current = abortController;

      const response = await api.post(
        '/api/chat',
        {
          message: lastUserContent,
          mode: aiMode.id,
          sessionId: selectedConversation,
        },
        { signal: abortController.signal }
      );
      return response.data;
    },
    onSuccess: (data) => {
      const assistantMsg: Message = {
        id: `asst-regen-${Date.now()}`,
        role: 'assistant',
        content: data.reply || data.answer || 'No response',
        timestamp: new Date().toISOString(),
        refs: data.refs,
      };
      setLocalMessages((prev) => {
        const lastAssistantIdx = [...prev].reverse().findIndex((m) => m.role === 'assistant');
        if (lastAssistantIdx === -1) return [...prev, assistantMsg];
        const idx = prev.length - 1 - lastAssistantIdx;
        return [...prev.slice(0, idx), assistantMsg];
      });
      queryClient.invalidateQueries({ queryKey: ['cognitive-status'] });
    },
    onError: (err) => {
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        role: 'system',
        content: `Regeneration failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      };
      setLocalMessages((prev) => [...prev, errorMsg]);
    },
  });

  const handleRegenerate = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg && !regenerateMutation.isPending) {
      regenerateMutation.mutate(lastUserMsg.content);
    }
  }, [messages, regenerateMutation]);

  const feedbackMutation = useMutation({
    mutationFn: async ({
      messageId,
      rating,
      index,
    }: {
      messageId: string;
      rating: 'up' | 'down';
      index: number;
    }) => {
      const sessionId = selectedConversation || 'default';
      await apiHelpers.chat.feedback({ sessionId, rating, messageIndex: index });
      return { messageId, rating };
    },
    onSuccess: ({ messageId, rating }) => {
      setFeedbackState((prev) => ({ ...prev, [messageId]: rating }));
    },
    onError: () => {
      useUIStore
        .getState()
        .addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const forgeMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await apiHelpers.forge.hybrid({
        content,
        tags: ['chat-forged'],
        source: 'chat-lens',
      });
      return response.data;
    },
    onSuccess: (data) => {
      const forgeMsg: Message = {
        id: `forge-${Date.now()}`,
        role: 'system',
        content: `Forged to DTU: ${data?.dtu?.title || data?.title || 'New DTU created'}`,
        timestamp: new Date().toISOString(),
        dtuId: data?.dtu?.id || data?.id,
      };
      setLocalMessages((prev) => [...prev, forgeMsg]);
      queryClient.invalidateQueries({ queryKey: ['dtus'] });
    },
    onError: () => {
      useUIStore
        .getState()
        .addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const deleteConversationMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      // Try to delete on server (best-effort), but always remove locally
      try {
        await apiHelpers.lens.delete('chat', sessionId);
      } catch {
        // Server deletion failed — still remove locally
      }
      return sessionId;
    },
    onError: () => {
      useUIStore
        .getState()
        .addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
    onSuccess: (deletedId: string) => {
      deleteMessagesForSession(deletedId);
      setStoredConversations((prev) => {
        const next = prev.filter((c) => c.id !== deletedId);
        saveConversations(next);
        return next;
      });
      if (selectedConversation === deletedId) {
        setSelectedConversation(null);
        setLocalMessages([]);
      }
    },
  });

  // ──────────────────────────────────────────────
  // Handlers
  // ──────────────────────────────────────────────

  const handleExportChat = useCallback(() => {
    const exportData = messages.map((m: Message) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      ...(m.attachments ? { attachments: m.attachments } : {}),
      ...(m.pinned ? { pinned: true } : {}),
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMoreMenuOpen(false);
  }, [messages]);

  // Markdown export — chat-history-as-document, far more useful than JSON
  // for sharing or pasting into a doc.  Mirrors the Claude.ai / ChatGPT
  // behaviour where the export is a clean readable transcript.
  const handleExportMarkdown = useCallback(() => {
    const conv = conversations.find((c) => c.id === selectedConversation);
    const title = conv?.title || 'Concord Chat';
    const lines: string[] = [`# ${title}`, '', `_Exported ${new Date().toLocaleString()}_`, ''];
    for (const m of messages) {
      const who = m.role === 'user' ? '🧑 You' : m.role === 'assistant' ? '🤖 Concord' : '⚙️ System';
      const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
      lines.push(`## ${who}${ts ? `  ·  ${ts}` : ''}`, '');
      lines.push(m.content || '_(empty)_');
      if (m.refs?.length) {
        lines.push('', '**Citations:**');
        m.refs.forEach((r) => lines.push(`- ${r.title}${r.lineageHash ? ` (\`${r.lineageHash.slice(0, 8)}\`)` : ''}`));
      }
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setMoreMenuOpen(false);
  }, [messages, conversations, selectedConversation]);

  // Copy a markdown transcript to the clipboard — instant share without
  // a download step, handy for pasting into Slack / docs / a thread.
  const handleCopyTranscript = useCallback(async () => {
    const lines: string[] = [];
    for (const m of messages) {
      const who = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Concord' : 'System';
      lines.push(`**${who}:** ${m.content || ''}`, '');
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setMoreMenuOpen(false);
    } catch {
      console.warn('[Chat] clipboard write failed');
    }
  }, [messages]);

  // Branch from a specific message — copy this conversation's history up
  // to (and including) the chosen message into a new conversation, then
  // continue from there.  Mirrors Claude.ai's edit-rewind / ChatGPT's
  // "fork from here" behaviour, but as an explicit user action so the
  // original thread is preserved.
  const handleBranchFromMessage = useCallback((messageId: string) => {
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const slice = messages.slice(0, idx + 1).map((m) => ({ ...m, id: `${m.id}-b${Date.now().toString(36)}` }));
    const newId = generateUUID();
    const sourceTitle = conversations.find((c) => c.id === selectedConversation)?.title || 'Conversation';
    const newConv: Conversation = {
      id: newId,
      title: `↳ ${sourceTitle}`,
      lastMessage: slice[slice.length - 1]?.content?.slice(0, 100) || '',
      updatedAt: new Date().toISOString(),
      messageCount: slice.length,
    };
    setStoredConversations((prev) => {
      const next = [newConv, ...prev];
      saveConversations(next);
      return next;
    });
    saveMessagesForSession(newId, slice);
    setSelectedConversation(newId);
    setLocalMessages(slice);
    setMoreMenuOpen(false);
  }, [messages, conversations, selectedConversation]);

  // Global message search — scans every conversation in localStorage,
  // not just the current one.  Closes the gap with Claude.ai/ChatGPT
  // which both index message bodies, not titles only.
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const globalSearchInputRef = useRef<HTMLInputElement>(null);
  const globalSearchResults = useMemo(() => {
    const q = globalSearchQuery.trim().toLowerCase();
    if (!q || q.length < 2) return [] as Array<{ convId: string; convTitle: string; message: Message; preview: string }>;
    const out: Array<{ convId: string; convTitle: string; message: Message; preview: string }> = [];
    for (const conv of conversations) {
      let msgs: Message[];
      if (conv.id === selectedConversation) {
        msgs = messages;
      } else {
        try { msgs = loadMessagesForSession<Message>(conv.id); } catch { msgs = []; }
      }
      for (const m of msgs) {
        const lc = (m.content || '').toLowerCase();
        const pos = lc.indexOf(q);
        if (pos === -1) continue;
        const start = Math.max(0, pos - 40);
        const end = Math.min((m.content || '').length, pos + q.length + 80);
        const preview = (start > 0 ? '…' : '') + (m.content || '').slice(start, end) + (end < (m.content || '').length ? '…' : '');
        out.push({ convId: conv.id, convTitle: conv.title, message: m, preview });
        if (out.length >= 100) return out;
      }
    }
    return out;
  }, [globalSearchQuery, conversations, messages, selectedConversation]);

  const openGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(true);
    requestAnimationFrame(() => globalSearchInputRef.current?.focus());
  }, []);

  const jumpToSearchResult = useCallback((convId: string, messageId: string) => {
    setSelectedConversation(convId);
    setGlobalSearchOpen(false);
    setGlobalSearchQuery('');
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${messageId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('ring-2', 'ring-neon-cyan');
      setTimeout(() => el?.classList.remove('ring-2', 'ring-neon-cyan'), 1500);
    });
  }, []);

  // ── ConKay honest event spine (Unit A5-backport) ──────────────────────────
  // The SAME rule as ConKayOverlay's identical effect: every animated beat is
  // a pure function of a REAL backend event. While chat is in ConKay mode we
  // subscribe to the macro lifecycle the server emits to our user:<id> room
  // and feed it into the SAME `conkayHudStore` the overlay's cockpit panels
  // already read from (telemetry / orchestration-trace / macro-library all
  // become live the moment this fires) — so a macro run from the chat
  // surface lights the exact same cockpit as a macro run from the overlay.
  // No setInterval, no eased fake percentage — motion (or its absence) is
  // always caused by a real started/completed/stage event.
  useEffect(() => {
    if (!isConKay) return;
    connectSocket();
    const offStart = subscribe<{ runId?: string; domain?: string; action?: string }>(
      'macro:started',
      (d) => {
        if (!d?.runId || d.runId !== conkayLiveRunRef.current) return;
        useConkayHudStore.getState().macroStarted({ runId: d.runId, domain: d.domain, action: d.action });
      }
    );
    const offStage = subscribe<{ runId?: string; stage?: string; detail?: string }>(
      'macro:stage',
      (d) => {
        if (!d?.runId || d.runId !== conkayLiveRunRef.current || !d.stage) return;
        useConkayHudStore.getState().macroStage({ runId: d.runId, stage: d.stage, detail: d.detail });
      }
    );
    const offDone = subscribe<{ runId?: string; domain?: string; action?: string; ok?: boolean; ms?: number }>(
      'macro:completed',
      (d) => {
        if (!d?.runId || d.runId !== conkayLiveRunRef.current) return;
        useConkayHudStore.getState().macroCompleted({ runId: d.runId, domain: d.domain, action: d.action, ok: d.ok, ms: d.ms });
      }
    );
    const offLost = onConnectionLost(() => useConkayHudStore.getState().markConnectionLost());
    const offReconnected = onReconnected(() => useConkayHudStore.getState().markReconnected());
    // Leaving ConKay mode (or unmounting) resets the shared HUD store so the
    // cockpit's panels don't keep showing this session's rings/telemetry
    // after the surface that produced them is gone.
    return () => {
      offStart(); offStage(); offDone(); offLost(); offReconnected();
      useConkayHudStore.getState().reset();
    };
  }, [isConKay]);

  // Unit A5-backport — the pre-execution confirmation gate for the CLIENT-
  // INITIATED macro path (the explicit "run domain.macro {json}" command
  // below), reusing `isMutatingMacro` + <ConKayActionConfirm> exactly as
  // ConKayOverlay.tsx does. Resolves immediately (true) for a macro
  // `isMutatingMacro` doesn't flag as a write; for a mutating macro it holds
  // execution until the user explicitly confirms or cancels via the rendered
  // card — never an auto-approve.
  const conkayConfirmIfMutating = useCallback(
    (domain: string, macro: string, inputObj: Record<string, unknown>): Promise<boolean> => {
      if (!isMutatingMacro(domain, macro)) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        conkayPendingConfirmResolveRef.current = resolve;
        setConkayPendingConfirm({ domain, macro, input: inputObj });
      });
    },
    []
  );
  const resolveConkayPendingConfirm = useCallback((confirmed: boolean) => {
    const resolve = conkayPendingConfirmResolveRef.current;
    conkayPendingConfirmResolveRef.current = null;
    setConkayPendingConfirm(null);
    resolve?.(confirmed);
  }, []);

  // Unit A5-backport — executes a REAL macro via /api/lens/run, gated by the
  // confirm above. Mirrors ConKayOverlay.tsx#executeMacro: opts into the
  // honest lifecycle (runId → macro:started/completed), captures a real
  // artifact via the SAME `detectArtifact` registry the overlay uses (so the
  // cockpit's Artifact Viewer panel lights up identically whether the macro
  // was run from the overlay or from chat), and appends a truthful result
  // message — never a fabricated success on failure.
  const executeConKayMacro = useCallback(
    async (domain: string, macro: string, inputObj: Record<string, unknown>) => {
      setConkayMacroRunning(true);
      const allowed = await conkayConfirmIfMutating(domain, macro, inputObj);
      if (!allowed) {
        setLocalMessages((prev) => [...prev, {
          id: `asst-${Date.now()}-cancelled`, role: 'assistant',
          content: `Cancelled — I didn't run ${domain}.${macro}.`,
          timestamp: new Date().toISOString(), model: 'kay',
        }]);
        setConkayMacroRunning(false);
        return false;
      }
      try {
        const rid = newConKayRunId();
        conkayLiveRunRef.current = rid;
        const { data } = await lensRun(domain, macro, inputObj, rid);
        const ok = !!data?.ok;
        // Forward-Sim substrate parity: a real engineering.runFEA solve
        // populates the SAME store field the overlay's Forward-Sim panel reads.
        if (ok && domain === 'engineering' && macro === 'runFEA') {
          const fea = feaResultFromRun(inputObj, data?.result);
          if (fea) useConkayHudStore.getState().setLastFea(fea);
        }
        // Artifact→3D substrate parity: run the real return through the pure
        // detectArtifact registry; a genuine match feeds the cockpit's
        // Artifact Viewer panel. detectArtifact returns null unless the
        // result really matches a kind's real shape — no fabrication.
        if (ok) {
          const artifact = detectArtifact(domain, macro, inputObj, data?.result);
          if (artifact) useConkayHudStore.getState().setLastArtifact(artifact);
        }
        const resultStr = data?.result != null
          ? JSON.stringify(data.result, null, 2)
          : (ok ? '(done)' : (data?.error || 'no result'));
        const spoken = ok
          ? `Done — ran ${macro} on the ${domain} lens.`
          : `${macro} on ${domain} returned: ${data?.error || 'an error'}.`;
        const body = resultStr.length > 1200 ? resultStr.slice(0, 1200) + '\n…' : resultStr;
        setLocalMessages((prev) => [...prev, {
          id: `asst-${Date.now()}`, role: 'assistant',
          content: `${spoken}\n\n\`\`\`json\n${body}\n\`\`\``,
          timestamp: new Date().toISOString(), model: 'kay',
          toolCalls: [{ tool: `${domain}.${macro}`, params: inputObj, result: data?.result ?? null, ok }],
        }]);
        return ok;
      } catch {
        setLocalMessages((prev) => [...prev, {
          id: `asst-${Date.now()}`, role: 'assistant',
          content: `I couldn't run ${domain}.${macro} just now.`,
          timestamp: new Date().toISOString(),
        }]);
        return false;
      } finally {
        setConkayMacroRunning(false);
      }
    },
    [conkayConfirmIfMutating]
  );

  // ── ConKay vision: an image attachment in ConKay mode is a "look at this" —
  // POST the raw image to /api/vision/analyze (the vision brain). Honest offline
  // fallback when no vision model is connected. Reuses JARVIS-style perception.
  const conkayVisionMutation = useMutation({
    mutationFn: async ({ file, prompt }: { file: File; prompt: string }) => {
      const apiUrl = getApiBase();
      const res = await fetch(`${apiUrl}/api/vision/analyze?prompt=${encodeURIComponent(prompt)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/png' },
        credentials: 'include',
        body: file,
      });
      return res.json().catch(() => ({ ok: false, error: 'unreadable response' }));
    },
    onSuccess: (data: { ok?: boolean; description?: string; model?: string; error?: string }) => {
      const ok = !!data?.ok;
      const content = ok
        ? (data.description?.trim() || 'I looked, but the vision brain returned nothing.')
        : `I can't see that right now — the vision brain isn't reachable in this environment${data?.error ? ` (${data.error})` : ''}.`;
      setLocalMessages((prev) => [...prev, {
        id: `asst-${Date.now()}`, role: 'assistant', content,
        timestamp: new Date().toISOString(), model: ok ? (data.model || 'vision') : undefined,
      }]);
    },
    onError: () => {
      setLocalMessages((prev) => [...prev, {
        id: `asst-${Date.now()}`, role: 'assistant',
        content: "I couldn't reach the vision brain just now. Try again, or check that a vision model is connected.",
        timestamp: new Date().toISOString(),
      }]);
    },
  });

  // ── ConKay skills: Kay actually *does* things against real Concord data ──────
  // (brief me / search my archive / my activity / world pulse / open a lens /
  // enter the world). Runs instantly, even when the LLM brains are offline; the
  // reply renders as spoken prose + a live viz + archive citations, and may
  // navigate or flare the ambient "acting" state. Unmatched input falls through
  // to the normal four-brain chat pipeline.
  const runConKaySkill = useCallback(async (
    text: string,
    match: { skill: ConKaySkill; args: Record<string, string> },
  ) => {
    setLocalMessages((prev) => [...prev, {
      id: `user-${Date.now()}`, role: 'user' as const, content: text, timestamp: new Date().toISOString(),
    }]);
    setInput('');
    setConkaySkillRunning(true);
    setConkayActing(true);
    try {
      const apiBase = getApiBase();
      const result = await match.skill.run(match.args, {
        apiBase,
        fetchJson: async (path: string) => {
          try {
            const r = await fetch(`${apiBase}${path}`, { credentials: 'include' });
            return await r.json();
          } catch { return null; }
        },
        // Thread the active chat sessionId so skills that target a
        // specific session (e.g. `compress`) can act against the right
        // STATE.sessions row. Falls back to a localStorage pin when
        // the lens hasn't yet propagated the active sessionId prop.
        // Resolve the active chat sessionId so skills that target a
        // specific session (e.g. `compress`) act against the right
        // STATE.sessions row. The chat lens keeps active sessionId in
        // localStorage as 'concord:activeSessionId'; reading from
        // there is honest (no guessing) and survives the closure
        // boundary inside this useCallback.
        sessionId:
          typeof window !== 'undefined'
            ? window.localStorage?.getItem('concord:activeSessionId') || null
            : null,
      });
      // Live viz rides the existing conkay-viz fence ConKayMessage already parses.
      const fence = result.viz ? `\n\n\`\`\`conkay-viz\n${JSON.stringify(result.viz)}\n\`\`\`` : '';
      setLocalMessages((prev) => [...prev, {
        id: `asst-${Date.now()}`, role: 'assistant' as const,
        content: `${result.spoken}${fence}`,
        timestamp: new Date().toISOString(),
        model: 'kay',
        dtuRefs: result.dtuRefs,
        sources: result.sources,
        toolCalls: result.toolCalls,
      }]);
      if (result.navigate) {
        const dest = result.navigate;
        setTimeout(() => { window.location.href = dest; }, 900);
      }
    } catch {
      setLocalMessages((prev) => [...prev, {
        id: `asst-${Date.now()}`, role: 'assistant',
        content: 'I hit a snag running that — mind trying again?',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setConkaySkillRunning(false);
      setTimeout(() => setConkayActing(false), 2500);
    }
  }, [setLocalMessages, setInput]);

  const handleSend = useCallback(() => {
    // ConKay vision: an attached image is "look at this" — runs even with no text.
    if (isConKay && !conkayVisionMutation.isPending) {
      const img = attachments.find((a) => a.type.startsWith('image/'));
      if (img) {
        const prompt = input.trim() || 'Describe this image in detail.';
        setLocalMessages((prev) => [...prev, {
          id: `user-${Date.now()}`, role: 'user',
          content: input.trim() || 'What do you see?',
          timestamp: new Date().toISOString(),
          attachments: [{ name: img.name, size: img.size, type: img.type }],
        }]);
        setInput('');
        setAttachments([]);
        conkayVisionMutation.mutate({ file: img.file, prompt });
        return;
      }
    }

    if (!input.trim() || sendMutation.isPending) return;

    // Check for slash commands
    if (input.trim().startsWith('/')) {
      executeSlashCommand(input);
      return;
    }

    // ConKay: a matching imperative ("brief me", "open music") runs a skill
    // directly; everything else falls through to the chat pipeline.
    if (isConKay) {
      const m = matchConKaySkill(input.trim());
      if (m) { runConKaySkill(input.trim(), m); return; }
      // Unit A5-backport — the explicit "run domain.macro {json}" command,
      // the SAME client-initiated syntax ConKayOverlay accepts. Echoes the
      // command as a user turn (so the confirm card that may follow isn't
      // rendered into an empty thread), then routes through the confirm-
      // gated executor above.
      const runCmd = parseConKayRunCommand(input.trim());
      if (runCmd) {
        setLocalMessages((prev) => [...prev, {
          id: `user-${Date.now()}`, role: 'user', content: input.trim(),
          timestamp: new Date().toISOString(),
        }]);
        setInput('');
        executeConKayMacro(runCmd.domain, runCmd.macro, runCmd.input);
        return;
      }
    }

    sendMutation.mutate(input);
  }, [input, sendMutation, executeSlashCommand, isConKay, attachments, conkayVisionMutation, runConKaySkill, executeConKayMacro]);

  // ── ConKay: voice-native STT in / TTS out when the mode is active ───────────
  const conkayVoice = useConKayVoice({
    enabled: isConKay,
    muted: conkayMuted,
    onFinalTranscript: (t) => {
      const text = t.trim();
      if (!text || sendMutation.isPending) return;
      if (text.startsWith('/')) { executeSlashCommand(text); return; }
      const m = matchConKaySkill(text);
      if (m) { runConKaySkill(text, m); return; }
      const runCmd = parseConKayRunCommand(text);
      if (runCmd) {
        setLocalMessages((prev) => [...prev, {
          id: `user-${Date.now()}`, role: 'user', content: text,
          timestamp: new Date().toISOString(),
        }]);
        executeConKayMacro(runCmd.domain, runCmd.macro, runCmd.input);
        return;
      }
      sendMutation.mutate(text);
    },
  });
  // React to each new assistant reply: speak it, and flare "acting" when the
  // reply actually touched a system (real toolCalls — ambient action feedback).
  const conkaySpokeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isConKay) return;
    const last = [...localMessages].reverse().find((m) => m.role === 'assistant');
    if (!last || last.id === conkaySpokeRef.current) return;
    conkaySpokeRef.current = last.id;
    // Strip any conkay-viz fence so Kay never reads raw JSON aloud.
    if (!conkayMuted) conkayVoice.speak((last.content || '').replace(/```conkay-viz[\s\S]*?```/gi, '').trim());
    if (Array.isArray(last.toolCalls) && last.toolCalls.length > 0) {
      setConkayActing(true);
      const tmr = setTimeout(() => setConkayActing(false), 3500);
      return () => clearTimeout(tmr);
    }
  }, [isConKay, conkayMuted, localMessages, conkayVoice]);

  // ConKay greets on entering the mode — a spoken presence, no fabricated data.
  const conkayGreetedRef = useRef(false);
  useEffect(() => {
    if (!isConKay) { conkayGreetedRef.current = false; return; }
    if (conkayGreetedRef.current) return;
    conkayGreetedRef.current = true;
    if (!conkayMuted) conkayVoice.speak("Kay here. I'm listening — ask me anything, or say brief me.");
  }, [isConKay, conkayMuted, conkayVoice]);

  // ConKay's plain (non-virtualized) list needs explicit follow-output.
  useEffect(() => {
    if (!isConKay) return;
    conkayBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [isConKay, localMessages.length]);

  // ConKay state machine — driven by real signals (not a screensaver).
  const conkayState: ConKayState =
    (sendMutation.isPending || conkayVisionMutation.isPending || conkaySkillRunning || conkayMacroRunning) ? 'processing'
      : conkayActing ? 'acting'
        : conkayVoice.speaking ? 'presenting'
          : conkayVoice.listening ? 'listening'
            : 'idle';

  // Lens-scoped keyboard commands. Send via mod+enter is the power-user
  // shortcut (Enter still sends from inside the textarea); slash focuses
  // the message input from anywhere on the page (Slack-style).
  useLensCommand(
    [
      { id: 'send', keys: 'mod+enter', description: 'Send message', category: 'actions', action: handleSend, global: true },
      { id: 'focus-input', keys: '/', description: 'Focus message input', category: 'navigation', action: () => inputRef.current?.focus() },
      { id: 'tool-palette', keys: 'mod+.', description: 'Open tool palette', category: 'actions', action: () => setToolPaletteOpen(true), global: true },
      { id: 'toggle-pause', keys: 'mod+shift+p', description: 'Pause / resume Concord initiatives', category: 'actions', action: toggleInitiativesPaused, global: true },
      { id: 'global-search', keys: 'mod+shift+f', description: 'Search across all conversations', category: 'navigation', action: openGlobalSearch, global: true },
      { id: 'thread-search', keys: 'mod+k', description: 'Open thread search overlay', category: 'navigation', action: () => setThreadSearchOpen(true), global: true },
      { id: 'projects-panel', keys: 'mod+shift+o', description: 'Open Projects panel', category: 'navigation', action: () => setProjectsPanelOpen(true), global: true },
    ],
    { lensId: 'chat' }
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Slash menu navigation
      if (slashMenuOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSlashSelectedIndex((prev) => Math.min(prev + 1, filteredSlashCommands.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSlashSelectedIndex((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const selected = filteredSlashCommands[slashSelectedIndex];
          if (selected) {
            // Insert the command into the input
            setInput(selected.command + (selected.args ? ' ' : ''));
            setSlashMenuOpen(false);
            setSlashFilter('');
            // If no args needed, execute immediately
            if (!selected.args) {
              // Use setTimeout to allow state to settle
              setTimeout(() => executeSlashCommand(selected.command), 0);
            }
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashMenuOpen(false);
          setSlashFilter('');
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const selected = filteredSlashCommands[slashSelectedIndex];
          if (selected) {
            setInput(selected.command + (selected.args ? ' ' : ''));
            setSlashMenuOpen(false);
            setSlashFilter('');
          }
          return;
        }
      }

      // Esc stops generation if streaming or pending
      if (e.key === 'Escape' && (streamActive || sendMutation.isPending || regenerateMutation.isPending)) {
        e.preventDefault();
        chatAbortControllerRef.current?.abort();
        setStreamActive(false);
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [slashMenuOpen, filteredSlashCommands, slashSelectedIndex, handleSend, executeSlashCommand,
     streamActive, sendMutation.isPending, regenerateMutation.isPending]
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // Slash command detection
    if (value.startsWith('/')) {
      const commandText = value.slice(1).split(/\s/)[0]; // text after / before first space
      if (!value.includes(' ') || value.split(/\s/).length <= 1) {
        setSlashMenuOpen(true);
        setSlashFilter(commandText);
      } else {
        setSlashMenuOpen(false);
        setSlashFilter('');
      }
    } else {
      setSlashMenuOpen(false);
      setSlashFilter('');
    }
  }, []);

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      setInput(cmd.command + (cmd.args ? ' ' : ''));
      setSlashMenuOpen(false);
      setSlashFilter('');
      inputRef.current?.focus();
      if (!cmd.args) {
        setTimeout(() => executeSlashCommand(cmd.command), 0);
      }
    },
    [executeSlashCommand]
  );

  // ──────────────────────────────────────────────
  // File attachment handlers
  // ──────────────────────────────────────────────

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newAttachments: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const attachment: Attachment = {
        id: `att-${Date.now()}-${i}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
      };

      // Generate preview for images
      if (file.type.startsWith('image/')) {
        try {
          attachment.preview = await fileToBase64(file);
        } catch {
          // Preview generation failed — non-critical
        }
      }

      // Base64 encode small files
      if (file.size <= MAX_BASE64_SIZE) {
        try {
          attachment.dataBase64 = await fileToBase64(file);
        } catch {
          // Encoding failed — will send metadata only
        }
      }

      newAttachments.push(attachment);
    }

    setAttachments((prev) => [...prev, ...newAttachments]);

    // Reset file input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // ──────────────────────────────────────────────
  // Message action handlers
  // ──────────────────────────────────────────────

  const copyToClipboard = useCallback((text: string, messageId?: string) => {
    navigator.clipboard.writeText(text).then(() => {
      if (messageId) {
        setCopiedMessageId(messageId);
        setTimeout(() => setCopiedMessageId(null), 2000);
      }
    });
  }, []);

  const togglePin = useCallback((messageId: string) => {
    setPinnedMessages((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
    // Update the message in localMessages to reflect pinned state
    setLocalMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, pinned: !m.pinned } : m))
    );
  }, []);

  const quoteMessage = useCallback((message: Message) => {
    setQuotedMessage(message);
    inputRef.current?.focus();
  }, []);

  const formatTime = useCallback((dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }, []);

  const startNewChat = useCallback(() => {
    setSelectedConversation(null);
    setLocalMessages([]);
    setFeedbackState({});
    setAttachments([]);
    setQuotedMessage(null);
    setPinnedMessages(new Set());
    saveSessionId(null);
  }, []);

  // ── Message edit / delete ──
  const startEditMessage = useCallback((message: Message) => {
    setEditingMessageId(message.id);
    setEditContent(message.content);
  }, []);

  const saveEditMessage = useCallback(() => {
    if (!editingMessageId || !editContent.trim()) return;
    setLocalMessages((prev) =>
      prev.map((m) => (m.id === editingMessageId ? { ...m, content: editContent.trim() } : m))
    );
    setEditingMessageId(null);
    setEditContent('');
  }, [editingMessageId, editContent]);

  const cancelEditMessage = useCallback(() => {
    setEditingMessageId(null);
    setEditContent('');
  }, []);

  const deleteMessage = useCallback((messageId: string) => {
    setLocalMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  // ── Conversation rename ──
  const startRenameConversation = useCallback((conv: Conversation) => {
    setRenamingConversation(conv.id);
    setRenameValue(conv.title);
  }, []);

  const saveRenameConversation = useCallback(() => {
    if (!renamingConversation || !renameValue.trim()) return;
    setStoredConversations((prev) => {
      const next = prev.map((c) =>
        c.id === renamingConversation ? { ...c, title: renameValue.trim() } : c
      );
      saveConversations(next);
      return next;
    });
    setRenamingConversation(null);
    setRenameValue('');
  }, [renamingConversation, renameValue]);

  const exp = cogStatus?.experience;
  const attn = cogStatus?.attention;
  const refl = cogStatus?.reflection;

  // ──────────────────────────────────────────────
  // Message renderer
  // ──────────────────────────────────────────────

  // Initiatives + tool traces appear inline in the thread as proactive
  // Concord activity. We discriminate via a `__kind` tag on the merged
  // item so renderThreadItem can dispatch.
  type ThreadItem =
    | (Message & { __kind: 'message' })
    | (Initiative & { __kind: 'initiative' })
    | (ToolTrace & { __kind: 'tool_trace' });

  const threadItems = useMemo<ThreadItem[]>(() => {
    const items: ThreadItem[] = messages.map((m) => ({ ...m, __kind: 'message' as const }));
    const initiatives = Array.isArray(initiativesData) ? initiativesData : [];
    for (const init of initiatives) {
      const dup = items.some((it) => it.__kind === 'message' && it.id === init.id);
      if (!dup) items.push({ ...init, __kind: 'initiative' as const });
    }
    for (const trace of toolTraces) {
      items.push({ ...trace, __kind: 'tool_trace' as const });
    }
    items.sort((a, b) => {
      const at =
        a.__kind === 'message'
          ? a.timestamp
          : a.__kind === 'initiative'
            ? a.deliveredAt || a.createdAt
            : a.createdAt;
      const bt =
        b.__kind === 'message'
          ? b.timestamp
          : b.__kind === 'initiative'
            ? b.deliveredAt || b.createdAt
            : b.createdAt;
      const av = at ? new Date(at).getTime() : 0;
      const bv = bt ? new Date(bt).getTime() : 0;
      return av - bv;
    });
    return items;
  }, [messages, initiativesData, toolTraces]);

  // Count of unread initiatives — drives the "Concord wrote you while
  // you were away" banner that's surfaced on lens entry.
  const unreadInitiativesCount = Array.isArray(initiativesData)
    ? initiativesData.filter((i) => i.status !== 'read' && i.status !== 'dismissed').length
    : 0;

  const handleInitiativeDismiss = useCallback((id: string) => {
    api.post(`/api/initiative/${encodeURIComponent(id)}/dismiss`, {}).catch(() => {});
  }, []);
  const handleInitiativeRespond = useCallback((id: string) => {
    api.post(`/api/initiative/${encodeURIComponent(id)}/respond`, { responded: true }).catch(() => {});
  }, []);
  const handleInitiativeAction = useCallback(
    (id: string, action: string, payload?: Record<string, unknown>) => {
      api.post(`/api/initiative/${encodeURIComponent(id)}/respond`, { action, ...(payload || {}) }).catch(() => {});
    },
    []
  );

  const renderMessage = useCallback(
    (msgIdx: number, message: Message) => {
      const isPinned = pinnedMessages.has(message.id) || message.pinned;
      const timeStr = message.timestamp
        ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      // Real index within the flat `messages` array (NOT `msgIdx`, which is
      // an index into the mixed thread-item list that also carries
      // initiative chips / tool traces) — this is what the server-side
      // `chat.branch-fork` macro needs to slice history up to this point.
      const forkIdx = messages.findIndex((m) => m.id === message.id);

      return (
        <motion.div
          id={`msg-${message.id}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className={cn(
            'flex gap-4 px-4 lg:px-6 py-3 group relative rounded transition-all',
            message.role === 'user' ? 'flex-row-reverse' : '',
            isPinned && 'bg-yellow-500/5 border-l-2 border-l-yellow-500/50'
          )}
        >
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg',
              message.role === 'user'
                ? 'bg-gradient-to-br from-neon-purple to-purple-700'
                : 'bg-gradient-to-br from-neon-cyan/30 to-cyan-900/40 ring-1 ring-neon-cyan/20'
            )}
          >
            {message.role === 'user' ? (
              <User className="w-5 h-5 text-white" />
            ) : (
              <Bot className="w-5 h-5 text-neon-cyan" />
            )}
          </div>
          <div className={cn('flex-1 max-w-2xl', message.role === 'user' ? 'text-right' : '')}>
            {/* Pinned indicator */}
            {isPinned && (
              <div className="flex items-center gap-1 text-yellow-500/80 text-xs mb-1">
                <Pin className="w-3 h-3" />
                <span>Pinned</span>
              </div>
            )}

            {/* Quoted message reference */}
            {message.quotedContent && (
              <div
                className={cn(
                  'mb-2 p-2 rounded-lg border text-xs text-gray-400 max-w-sm',
                  message.role === 'user'
                    ? 'bg-neon-purple/10 border-neon-purple/30 ml-auto'
                    : 'bg-lattice-bg border-lattice-border'
                )}
              >
                <div className="flex items-center gap-1 mb-1 text-gray-400">
                  <Quote className="w-3 h-3" />
                  <span>Replying to</span>
                </div>
                <p className="truncate">{message.quotedContent}</p>
              </div>
            )}

            {message.role === 'assistant' && message.oracleResponse ? (
              <div className="w-full max-w-3xl">
                <OracleResponse
                  response={message.oracleResponse}
                  onOpenDTU={(id) => setInspectingDtuId(id)}
                />
                {timeStr && <p className="text-[10px] text-gray-400 mt-1 select-none">{timeStr}</p>}
              </div>
            ) : (
              <div
                className={cn(
                  'inline-block p-4 rounded-2xl shadow-sm',
                  message.role === 'user'
                    ? 'bg-gradient-to-br from-neon-purple to-purple-700 text-white rounded-br-md'
                    : message.role === 'system'
                      ? 'bg-red-500/10 border border-red-500/30 text-red-300 rounded-bl-md'
                      : 'bg-lattice-surface border border-lattice-border text-gray-200 rounded-bl-md hover:border-lattice-border/80 transition-colors'
                )}
              >
                {editingMessageId === message.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full bg-black/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-neon-cyan resize-none"
                      rows={3}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          saveEditMessage();
                        }
                        if (e.key === 'Escape') cancelEditMessage();
                      }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveEditMessage}
                        className="px-3 py-1 text-xs bg-neon-cyan/20 text-neon-cyan rounded-lg hover:bg-neon-cyan/30 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelEditMessage}
                        className="px-3 py-1 text-xs text-gray-400 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : isConKay && message.role === 'assistant' ? (
                  <ConKayMessage
                    fields={{
                      content: message.content,
                      computed: message.computed,
                      dtuRefs: message.dtuRefs,
                      refs: message.refs,
                      sources: message.sources,
                      toolCalls: message.toolCalls,
                      webAugmented: message.webAugmented,
                      brain: message.model,
                    }}
                    renderProse={(t) => <MessageRenderer content={t} />}
                  />
                ) : (
                  <MessageRenderer content={message.content} />
                )}
                {timeStr && editingMessageId !== message.id && (
                  <p className="text-[10px] text-gray-400 mt-1 select-none">{timeStr}</p>
                )}

                {/* Attachment chips on user messages */}
                {message.attachments && message.attachments.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-1.5">
                    {message.attachments.map((att, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1.5 px-2 py-1 bg-white/10 rounded text-xs"
                      >
                        <Paperclip className="w-3 h-3" />
                        <span className="truncate max-w-[120px]">{att.name}</span>
                        <span className="text-white/50">{formatBytes(att.size)}</span>
                      </span>
                    ))}
                  </div>
                )}

                {message.refs && message.refs.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-lattice-border/50">
                    <p className="text-xs text-gray-400 mb-2">Referenced DTUs:</p>
                    <div className="flex flex-wrap gap-1">
                      {message.refs.slice(0, 5).map((ref) => (
                        <button
                          key={ref.id}
                          onClick={() => setInspectingDtuId(ref.id)}
                          className="text-xs px-2 py-1 bg-neon-purple/20 text-neon-purple rounded cursor-pointer hover:bg-neon-purple/30 transition-colors"
                          title={`View DTU: ${ref.id}`}
                        >
                          {ref.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reasoning depth indicator (active sessions) */}
                {message.role === 'assistant' && message.reasoningSessionId && (
                  <ReasoningIndicator sessionId={message.reasoningSessionId} />
                )}

                {/* Reasoning synthesis marker */}
                {message.role === 'assistant' &&
                  (message.wasSynthesized || (message.shadowsUsed && message.shadowsUsed > 0)) && (
                    <MessageContinuationMarker
                      wasSynthesized={message.wasSynthesized}
                      shadowsUsed={message.shadowsUsed}
                    />
                  )}

                {/* Tool call results */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-lattice-border/50 space-y-1.5">
                    {message.toolCalls.map((call, i) => (
                      <ToolCallCard key={i} call={call} />
                    ))}
                  </div>
                )}

                {/* Compute provenance (compute-preflight ground truth) */}
                {message.role === 'assistant' && message.computed && (
                  <ComputeBadge computed={message.computed} />
                )}

                {/* DTU citation chips (surgical refs the brain grounded in) */}
                {message.role === 'assistant' && message.dtuRefs && message.dtuRefs.length > 0 && (
                  <CitationChips dtuRefs={message.dtuRefs} />
                )}

                {/* Web sources panel */}
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-lattice-border/50">
                    <div className="flex items-center gap-1.5 text-xs text-neon-cyan/80 mb-2">
                      <Globe className="w-3 h-3" />
                      <span>Web Sources</span>
                    </div>
                    <div className="space-y-1.5">
                      {message.sources.map((src, i) => (
                        <a
                          key={`${src.url}-${i}`}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-start gap-2 p-1.5 rounded bg-neon-cyan/5 hover:bg-neon-cyan/10 transition-colors group/src"
                        >
                          <ExternalLink className="w-3 h-3 mt-0.5 text-neon-cyan/60 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-neon-cyan/90 truncate group-hover/src:text-neon-cyan">
                              {src.title}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate">{src.source}</p>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Message action bar */}
            <div
              className={cn(
                'flex items-center gap-2 mt-2 text-xs text-gray-400',
                message.role === 'user' ? 'justify-end' : ''
              )}
            >
              <span>{formatTime(message.timestamp)}</span>

              {/* Copy button — available on ALL messages */}
              <span>·</span>
              <button
                onClick={() => copyToClipboard(message.content, message.id)}
                className="hover:text-white transition-colors"
                title="Copy to clipboard"
                aria-label="Copy message"
              >
                {copiedMessageId === message.id ? (
                  <Check className="w-3 h-3 text-neon-green" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>

              {/* Pin button — available on ALL messages */}
              <button
                onClick={() => togglePin(message.id)}
                className={cn(
                  'transition-colors',
                  isPinned ? 'text-yellow-500' : 'hover:text-yellow-500'
                )}
                title={isPinned ? 'Unpin message' : 'Pin message'}
                aria-label={isPinned ? 'Unpin message' : 'Pin message'}
              >
                <Pin className={cn('w-3 h-3', isPinned && 'fill-current')} />
              </button>

              {/* Quote / Reply button — available on ALL messages */}
              <button
                onClick={() => quoteMessage(message)}
                className="hover:text-neon-cyan transition-colors"
                title="Reply to this message"
                aria-label="Quote and reply"
              >
                <Quote className="w-3 h-3" />
              </button>

              {/* User-specific actions: edit & delete */}
              {message.role === 'user' && (
                <>
                  <span>·</span>
                  <button
                    onClick={() => startEditMessage(message)}
                    className="hover:text-white transition-colors"
                    title="Edit message"
                    aria-label="Edit message"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => deleteMessage(message.id)}
                    className="hover:text-red-400 transition-colors"
                    title="Delete message"
                    aria-label="Delete message"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}

              {/* Assistant-specific actions */}
              {message.role === 'assistant' && (
                <>
                  <span>·</span>
                  <button
                    onClick={() =>
                      feedbackMutation.mutate({
                        messageId: message.id,
                        rating: 'up',
                        index: msgIdx,
                      })
                    }
                    className={cn(
                      'transition-colors',
                      feedbackState[message.id] === 'up' ? 'text-green-400' : 'hover:text-green-400'
                    )}
                    title="Good response"
                    aria-label="Thumbs up"
                  >
                    <ThumbsUp
                      className={cn(
                        'w-3 h-3',
                        feedbackState[message.id] === 'up' && 'fill-current'
                      )}
                    />
                  </button>
                  <button
                    onClick={() =>
                      feedbackMutation.mutate({
                        messageId: message.id,
                        rating: 'down',
                        index: msgIdx,
                      })
                    }
                    className={cn(
                      'transition-colors',
                      feedbackState[message.id] === 'down' ? 'text-red-400' : 'hover:text-red-400'
                    )}
                    title="Bad response"
                    aria-label="Thumbs down"
                  >
                    <ThumbsDown
                      className={cn(
                        'w-3 h-3',
                        feedbackState[message.id] === 'down' && 'fill-current'
                      )}
                    />
                  </button>
                  <button
                    onClick={handleRegenerate}
                    disabled={regenerateMutation.isPending}
                    className={cn(
                      'hover:text-white transition-colors',
                      regenerateMutation.isPending && 'animate-spin'
                    )}
                    title="Regenerate response"
                    aria-label="Regenerate"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => handleBranchFromMessage(message.id)}
                    className="hover:text-neon-purple transition-colors"
                    title="Branch a new conversation from this message (local, instant)"
                    aria-label="Branch from here"
                  >
                    <GitBranch className="w-3 h-3" />
                  </button>
                  {isAuthenticated && selectedConversation && forkIdx !== -1 && (
                    <BranchForkButton
                      sourceThreadId={selectedConversation}
                      atMessageIdx={forkIdx}
                      messages={messages
                        .slice(0, forkIdx + 1)
                        .map((m) => ({ role: m.role, content: m.content, ts: m.timestamp }))}
                      label="Sync"
                      doneLabel="Synced"
                      title="Save a synced branch to your account (persists across devices, separate from the local branch above)"
                      ariaLabel="Save a server-synced branch from this message"
                      onForked={() =>
                        useUIStore.getState().addToast({
                          type: 'success',
                          message: 'Synced branch saved to your account.',
                        })
                      }
                      onError={() =>
                        useUIStore.getState().addToast({
                          type: 'error',
                          message: 'Could not save the synced branch. Please try again.',
                        })
                      }
                    />
                  )}
                  <span>·</span>
                  <button
                    onClick={() => forgeMutation.mutate(message.content)}
                    disabled={forgeMutation.isPending}
                    className={cn(
                      'hover:text-neon-cyan transition-colors flex items-center gap-1',
                      forgeMutation.isPending && 'opacity-50'
                    )}
                    title="Forge this response into a DTU"
                    aria-label="Forge to DTU"
                  >
                    <Zap className="w-3 h-3" />
                    <span className="hidden sm:inline">Forge DTU</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      );
    },
    [
      feedbackState,
      feedbackMutation,
      forgeMutation,
      regenerateMutation,
      handleRegenerate,
      copyToClipboard,
      formatTime,
      pinnedMessages,
      copiedMessageId,
      togglePin,
      quoteMessage,
      editingMessageId,
      editContent,
      startEditMessage,
      saveEditMessage,
      cancelEditMessage,
      deleteMessage,
      handleBranchFromMessage,
      isConKay,
      messages,
      selectedConversation,
      isAuthenticated,
    ]
  );

  // Thread renderer dispatches between assistant/user messages,
  // proactive initiative chips, and tool-execution traces. Defined
  // after renderMessage so the useCallback can close over it without a
  // forward reference.
  const renderThreadItemInner = useCallback(
    (idx: number, item: ThreadItem) => {
      if (item.__kind === 'initiative') {
        // pendingWorkReminder triggerType gets a "Create quest from
        // this" hand-off; one-click promote a nag into something
        // actionable in the quest engine.
        const isWorkReminder = item.triggerType === 'pendingWorkReminder';
        return (
          <div className="px-4 lg:px-6 pb-2">
            <InitiativeChip
              initiative={item}
              onDismiss={handleInitiativeDismiss}
              onRespond={handleInitiativeRespond}
              onAction={handleInitiativeAction}
            />
            {isWorkReminder && (
              <div className="mt-1.5 ml-12">
                <button
                  type="button"
                  onClick={() => {
                    const title = item.message.slice(0, 80);
                    window.location.href = `/lenses/maker?compose=quest&title=${encodeURIComponent(title)}&seedFromInitiative=${encodeURIComponent(item.id)}`;
                  }}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                >
                  <Plus className="w-3 h-3" /> Create quest from this
                </button>
              </div>
            )}
          </div>
        );
      }
      if (item.__kind === 'tool_trace') {
        return (
          <div className="px-4 lg:px-6 pb-2">
            <ToolTraceBlock trace={item} />
          </div>
        );
      }
      // Inject the anon-save nudge after the 3rd item so it lands once
      // the user has demonstrated they're actually using chat. Only for
      // unauthenticated, non-dismissed users.
      const showNudgeHere = !isAuthenticated && !anonNudgeDismissed && idx === 3;
      const msg = renderMessage(idx, item);
      if (!showNudgeHere) return msg;
      return (
        <>
          {msg}
          <div className="px-4 lg:px-6">
            <AnonNudge visible={true} onDismiss={dismissAnonNudge} />
          </div>
        </>
      );
    },
    [renderMessage, handleInitiativeDismiss, handleInitiativeRespond, handleInitiativeAction, isAuthenticated, anonNudgeDismissed, dismissAnonNudge]
  );

  // Phase P — wrap each thread item in SafeCard so a single bad
  // message can't tank the whole thread.
  const renderThreadItem = useCallback(
    (idx: number, item: ThreadItem) => (
      <SafeCard label={`Message ${item.__kind}`}>{renderThreadItemInner(idx, item)}</SafeCard>
    ),
    [renderThreadItemInner],
  );

  // ──────────────────────────────────────────────
  // Loading / Error states
  // ──────────────────────────────────────────────

  const modelOffline = isError || (cogStatus && cogStatus.llm && cogStatus.llm.enabled === false);

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────

  return (
    <>
    <div data-lens-theme="chat" className="relative h-full flex flex-col bg-lattice-bg">
      {modelOffline && (
        <div className="px-4 py-2 text-xs bg-amber-500/10 border-b border-amber-500/30 text-amber-200">
          Language model is offline — you can still type. Replies may not generate.
        </div>
      )}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile sidebar backdrop */}
        {chatSidebarOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-30"
            onClick={() => setChatSidebarOpen(false)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            'w-80 border-r border-lattice-border flex flex-col bg-lattice-surface z-40 transition-transform duration-200',
            'fixed inset-y-0 left-0 lg:relative lg:translate-x-0',
            chatSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
          role="complementary"
          aria-label="Conversation list"
        >
          <div className="p-4 border-b border-lattice-border">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <Bot className="w-6 h-6 text-neon-cyan" />
                Chat
              </h2>
              <div className="flex items-center gap-1">
                {isAuthenticated && (
                  <button
                    className="p-2 hover:bg-lattice-bg rounded-lg transition-colors"
                    aria-label="BYO API keys"
                    title="Plug your own API key into a brain slot"
                    onClick={() => setByoOpen(true)}
                  >
                    <Key className="w-5 h-5 text-gray-400 hover:text-neon-cyan" />
                  </button>
                )}
                <button
                  className="p-2 hover:bg-lattice-bg rounded-lg transition-colors"
                  aria-label="Chat settings"
                  onClick={() =>
                    useUIStore.getState().addToast({
                      type: 'info',
                      message: 'Use the mode selector in the chat rail to configure chat behavior',
                    })
                  }
                >
                  <Settings className="w-5 h-5 text-gray-400" />
                </button>
              </div>
            </div>
            <button
              onClick={() => {
                startNewChat();
                setChatSidebarOpen(false);
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Chat
            </button>
          </div>

          {/* DTU Context */}
          <div className="p-3 border-t border-white/10 space-y-3">
            <ArtifactUploader
              lens="chat"
              acceptTypes="*/*"
              multi
              compact
              onUploadComplete={() => refetchDTUs()}
            />
            <LensContextPanel
              hyperDTUs={hyperDTUs}
              megaDTUs={megaDTUs}
              regularDTUs={regularDTUs}
              tierDistribution={tierDistribution}
              onPublish={(dtu) => publishToMarketplace({ dtuId: dtu.id })}
              title="Chat DTUs"
              className="!bg-transparent !border-0 !p-0"
            />
            <FeedbackWidget targetType="lens" targetId="chat" />
            <FoundationCard type="status" />
          </div>

          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={conversationSearch}
                onChange={(e) => setConversationSearch(e.target.value)}
                placeholder="Search conversations..."
                aria-label="Search conversations"
                className="w-full pl-10 pr-4 py-2 bg-lattice-bg border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto" role="list" aria-label="Conversations">
            {filteredConversations.length === 0 && (
              <div className="p-6 text-center text-gray-400 text-sm">
                {conversationSearch
                  ? 'No matching conversations'
                  : 'No conversations yet. Start a new chat!'}
              </div>
            )}
            {filteredConversations.map((conv: Conversation) => (
              <div
                key={conv.id}
                className={cn(
                  'group relative w-full p-4 text-left hover:bg-lattice-bg transition-colors border-b border-lattice-border/50 cursor-pointer',
                  selectedConversation === conv.id &&
                    'bg-neon-cyan/10 border-l-2 border-l-neon-cyan'
                )}
                role="listitem"
                aria-current={selectedConversation === conv.id ? 'true' : undefined}
                onClick={() => {
                  setSelectedConversation(conv.id);
                  setChatSidebarOpen(false);
                }} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                      selectedConversation === conv.id ? 'bg-neon-cyan/20' : 'bg-lattice-bg'
                    )}
                  >
                    <MessageSquare
                      className={cn(
                        'w-5 h-5',
                        selectedConversation === conv.id ? 'text-neon-cyan' : 'text-gray-400'
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      {renamingConversation === conv.id ? (
                        <input
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              saveRenameConversation();
                            }
                            if (e.key === 'Escape') {
                              setRenamingConversation(null);
                              setRenameValue('');
                            }
                          }}
                          onBlur={saveRenameConversation}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 bg-lattice-bg border border-neon-cyan/50 rounded px-2 py-0.5 text-sm text-white focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <h3 className="font-medium text-white truncate text-sm">{conv.title}</h3>
                      )}
                      <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0">
                        {formatRelativeTime(conv.updatedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">
                      {conv.lastMessage || 'No messages'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-400">
                        {conv.messageCount} message{conv.messageCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                </div>
                {/* Hover actions: rename + delete */}
                <div className="absolute top-3 right-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRenameConversation(conv);
                    }}
                    className="p-1.5 rounded-md hover:bg-lattice-bg text-gray-400 hover:text-white transition-colors"
                    title="Rename conversation"
                    aria-label={`Rename conversation: ${conv.title}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversationMutation.mutate(conv.id);
                    }}
                    disabled={deleteConversationMutation.isPending}
                    className="p-1.5 rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                    title="Delete conversation"
                    aria-label={`Delete conversation: ${conv.title}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Main Chat Area */}
        <main className={cn('flex-1 flex flex-col', isConKay && 'relative isolate')} aria-label="Chat messages">
          {/* ConKay holographic world-tree — full-column, behind translucent chrome.
              Mounted at the lens column level (not the small messages panel) so it
              genuinely fills the screen. */}
          {isConKay && (
            <>
              <ConKayBackdrop
                state={conkayState}
                listening={conkayVoice.listening}
                muted={conkayMuted}
                ttsAmplitudeRef={conkayVoice.ttsAmplitudeRef}
                className="pointer-events-none absolute inset-0 -z-10"
              />
              <ConKayHud
                state={conkayState}
                muted={conkayMuted}
                onToggleMute={() => setConkayMuted((m) => !m)}
                listening={conkayVoice.listening}
                speaking={conkayVoice.speaking}
                voiceSupported={conkayVoice.supported}
                className="pointer-events-auto absolute right-3 top-3 z-20"
              />
            </>
          )}
          <header className={cn('px-4 lg:px-6 py-4 border-b border-lattice-border flex flex-wrap items-center justify-between gap-y-2', isConKay ? 'relative z-10 bg-lattice-surface/40 backdrop-blur-md border-cyan-400/15' : 'bg-lattice-surface')}>
            {/* Toolbar row wraps instead of clipping when the secondary pills
                (Context/Tools/Systems/Projects/Prompts/Schedule/Studio) overflow. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:gap-x-4 min-w-0">
              {/* Mobile: toggle conversation sidebar */}
              <button
                onClick={() => setChatSidebarOpen(true)}
                className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-lattice-bg text-gray-400 hover:text-white transition-colors"
                aria-label="Open conversation list"
              >
                <MessageSquare className="w-5 h-5" />
              </button>

              {/* Brain Mode Pill — Private ↔ High Power, in-chat toggle.
                  compact: full disclosure wall stays in Settings / byo-keys. */}
              <BrainModePanel compact />

              {/* System health now lives in the global Topbar
                  (<SovereignHealthRibbon />) on a PUBLIC endpoint — the old
                  CycleTelemetryRibbon here polled /api/admin/heartbeat-stats,
                  which 403s for every non-admin and rendered a permanent
                  "Health: unreachable" + a false permission toast. */}

              {/* Session Context Badge — honest-by-construction "X
                  turns · Y% full" chip. Reads the real
                  /api/chat/context-budget/:sessionId endpoint. Six
                  states (unreachable/empty/green/yellow/red/over). When
                  85%+ full, says "say 'compress'" — and 'compress' is
                  a real conkay skill (skill id 'compress') wired to
                  the same /api/chat/summary macro that the auto-trigger
                  uses. The badge NEVER fakes a recommendation. */}
              <SessionContextBadge sessionId={
                typeof window !== 'undefined'
                  ? window.localStorage?.getItem('concord:activeSessionId') || null
                  : null
              } />

              {/* AI Mode selector */}
              <div className="relative">
                <button
                  onClick={() => setModeSelectOpen(!modeSelectOpen)}
                  className="flex items-center gap-2 px-4 py-2 bg-lattice-bg border border-lattice-border rounded-lg hover:border-gray-500 transition-colors"
                >
                  <aiMode.icon className="w-4 h-4 text-neon-cyan" />
                  <span className="text-white text-sm font-medium">{aiMode.name}</span>
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                </button>

                <AnimatePresence>
                  {modeSelectOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-full left-0 mt-2 w-64 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl z-50 overflow-hidden"
                    >
                      {AI_MODES.map((mode) => (
                        <button
                          key={mode.id}
                          onClick={() => {
                            setAiMode(mode);
                            setModeSelectOpen(false);
                          }}
                          className={cn(
                            'w-full flex items-start gap-3 p-3 hover:bg-lattice-bg transition-colors',
                            aiMode.id === mode.id && 'bg-neon-cyan/10'
                          )}
                        >
                          <mode.icon
                            className={cn(
                              'w-5 h-5 mt-0.5',
                              aiMode.id === mode.id ? 'text-neon-cyan' : 'text-gray-400'
                            )}
                          />
                          <div className="text-left">
                            <p className="font-medium text-white">{mode.name}</p>
                            <p className="text-xs text-gray-300">{mode.description}</p>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Persona Picker */}
              <div className="relative">
                <button
                  onClick={() => setPersonaPickerOpen(!personaPickerOpen)}
                  className="flex items-center gap-2 px-3 py-2 bg-lattice-bg border border-lattice-border rounded-lg hover:border-gray-500 transition-colors"
                  title="Select persona"
                >
                  <Users className="w-4 h-4 text-neon-purple" />
                  <span className="text-white text-sm font-medium hidden sm:inline">
                    {selectedPersona.name}
                  </span>
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                </button>

                <AnimatePresence>
                  {personaPickerOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-full left-0 mt-2 w-72 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl z-50 overflow-hidden"
                    >
                      <div className="p-3 border-b border-lattice-border">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          Persona
                        </p>
                      </div>
                      {PERSONAS.map((persona) => (
                        <button
                          key={persona.id}
                          onClick={() => {
                            setSelectedPersona(persona);
                            setPersonaPickerOpen(false);
                            // Announce the change
                            if (persona.id !== selectedPersona.id) {
                              const sysMsg: Message = {
                                id: `sys-${Date.now()}`,
                                role: 'system',
                                content: `Persona switched to: ${persona.name} — ${persona.description}`,
                                timestamp: new Date().toISOString(),
                              };
                              setLocalMessages((prev) => [...prev, sysMsg]);
                            }
                          }}
                          className={cn(
                            'w-full flex items-start gap-3 p-3 hover:bg-lattice-bg transition-colors',
                            selectedPersona.id === persona.id && 'bg-neon-purple/10'
                          )}
                        >
                          <persona.icon
                            className={cn(
                              'w-5 h-5 mt-0.5',
                              selectedPersona.id === persona.id
                                ? 'text-neon-purple'
                                : 'text-gray-400'
                            )}
                          />
                          <div className="text-left">
                            <p className="font-medium text-white">{persona.name}</p>
                            <p className="text-xs text-gray-300">{persona.description}</p>
                          </div>
                          {selectedPersona.id === persona.id && (
                            <Check className="w-4 h-4 text-neon-purple ml-auto mt-0.5 flex-shrink-0" />
                          )}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Domain context badge */}
              {domainContext && (
                <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-neon-cyan/10 border border-neon-cyan/30 rounded-full text-xs text-neon-cyan">
                  <Hash className="w-3 h-3" />
                  <span>{domainContext}</span>
                  <button
                    onClick={() => setDomainContext('')}
                    className="ml-0.5 hover:text-white transition-colors"
                    title="Clear domain context"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Living chat / Layer 4b — the assistant's felt state (a qualeOf mood
                  label), surfaced honestly as a correlate. Renders only when lit. */}
              <AssistantMoodChip />

              {/* Active-project chip — surfaced inline only when one is active, so the
                  user sees their working space without opening the menu. */}
              {activeProject && (
                <button
                  type="button"
                  onClick={() => setProjectsPanelOpen(true)}
                  className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-cyan-500/10 border border-cyan-500/50 rounded-full text-xs text-cyan-300 hover:border-cyan-400 transition-colors"
                  title="Open active project"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>{activeProject.name.slice(0, 14)}</span>
                </button>
              )}

              <ChatWorkspaceMenu
                open={workspaceMenuOpen}
                onOpenChange={setWorkspaceMenuOpen}
                initiativesPaused={initiativesPaused}
                systemsPanelOpen={systemsPanelOpen}
                toolsPanelOpen={toolsPanelOpen}
                activeProject={activeProject}
                studioOpen={studioOpen}
                onViewContext={() => setContextOverlayOpen(true)}
                onToolPalette={() => setToolPaletteOpen(true)}
                onSearchChats={() => setThreadSearchOpen(true)}
                onProjects={() => setProjectsPanelOpen(true)}
                onPrompts={() => setPromptsPanelOpen(true)}
                onSchedule={() => setScheduledPanelOpen(true)}
                onStudio={() => setStudioOpen(true)}
                onToggleAnalysis={() => setToolsPanelOpen((v) => !v)}
                onToggleSystems={() => setSystemsPanelOpen((v) => !v)}
                onToggleInitiativesPaused={toggleInitiativesPaused}
              />

            </div>

            {/* Cognitive Status Bar */}
            {cogStatus && (
              <div className="hidden md:flex items-center gap-4 text-xs">
                {exp && (
                  <div
                    className="flex items-center gap-1.5 text-gray-400"
                    title={`${exp.episodes} episodes, ${exp.patterns} patterns learned`}
                  >
                    <Brain className="w-3.5 h-3.5 text-neon-purple" />
                    <span>{exp.patterns} patterns</span>
                  </div>
                )}
                {attn && (
                  <div
                    className="flex items-center gap-1.5 text-gray-400"
                    title={`${attn.activeThreads} active threads`}
                  >
                    <Eye className="w-3.5 h-3.5 text-neon-cyan" />
                    <span>{attn.activeThreads} threads</span>
                  </div>
                )}
                {refl && (
                  <div
                    className="flex items-center gap-1.5"
                    title={`Self-calibration: ${((refl.calibration || 0) * 100).toFixed(0)}%`}
                  >
                    <Activity
                      className={`w-3.5 h-3.5 ${(refl.calibration || 0) > 0.6 ? 'text-neon-green' : 'text-yellow-400'}`}
                    />
                    <span
                      className={`${(refl.calibration || 0) > 0.6 ? 'text-neon-green' : 'text-yellow-400'}`}
                    >
                      {((refl.calibration || 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
                {refl?.strengths?.length > 0 && (
                  <div
                    className="flex items-center gap-1 text-neon-green"
                    title={`Strengths: ${refl.strengths.join(', ')}`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 relative">
              <button
                onClick={() => setSessionSidebarOpen(true)}
                className="p-2 hover:bg-lattice-bg rounded-lg transition-colors"
                aria-label="Session history"
                title="Session history"
              >
                <Layers className="w-5 h-5 text-gray-400" />
              </button>
              <button
                onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                className="p-2 hover:bg-lattice-bg rounded-lg transition-colors"
                aria-label="Chat options"
              >
                <MoreVertical className="w-5 h-5 text-gray-400" />
              </button>
              <AnimatePresence>
                {moreMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full right-0 mt-2 w-48 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl z-50 overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        openGlobalSearch();
                        setMoreMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors"
                      title="Search across every conversation"
                    >
                      <Search className="w-4 h-4" />
                      Search all chats
                      <kbd className="ml-auto text-[10px] text-gray-400">⌘⇧F</kbd>
                    </button>
                    <button
                      onClick={handleExportChat}
                      disabled={messages.length === 0}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      Export JSON
                    </button>
                    <button
                      onClick={handleExportMarkdown}
                      disabled={messages.length === 0}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors disabled:opacity-50"
                    >
                      <FileText className="w-4 h-4" />
                      Export Markdown
                    </button>
                    <button
                      onClick={handleCopyTranscript}
                      disabled={messages.length === 0}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors disabled:opacity-50"
                    >
                      <Copy className="w-4 h-4" />
                      Copy transcript
                    </button>
                    <button
                      onClick={() => {
                        startNewChat();
                        setMoreMenuOpen(false);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors border-t border-lattice-border"
                    >
                      <Plus className="w-4 h-4" />
                      New Conversation
                    </button>
                    {selectedConversation && (
                      <button
                        onClick={() => {
                          deleteConversationMutation.mutate(selectedConversation);
                          setMoreMenuOpen(false);
                        }}
                        disabled={deleteConversationMutation.isPending}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors border-t border-lattice-border disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                        {deleteConversationMutation.isPending
                          ? 'Deleting...'
                          : 'Delete Conversation'}
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </header>

          {/* Chat Mode Selector Rail — ONE nav primitive (`active`) */}
          <div className={cn(isConKay && 'relative z-10')}>
            <ModeSelector activeMode={active} onModeChange={onActiveChange} />
          </div>

          {/* Mode surfaces — assist/explore/connect were unreachable before */}
          {active === 'assist' && (
            <div className={cn('px-4 py-2 border-b border-lattice-border/30', isConKay && 'relative z-10')}>
              <AssistPanel currentLens="chat" onSendMessage={(msg) => setInput(msg)} />
            </div>
          )}
          {active === 'explore' && (
            <div className={cn('px-4 py-2 border-b border-lattice-border/30', isConKay && 'relative z-10')}>
              <ExplorePanel currentLens="chat" onSendMessage={(msg) => setInput(msg)} />
            </div>
          )}
          {active === 'connect' && (
            <div className={cn('px-4 py-2 border-b border-lattice-border/30', isConKay && 'relative z-10')}>
              <ConnectPanel currentLens="chat" onSendMessage={(msg) => setInput(msg)} />
            </div>
          )}
          {active === 'welcome' && messages.length === 0 && (
            <div className={cn('px-4 py-2 border-b border-lattice-border/30', isConKay && 'relative z-10')}>
              <WelcomePanel currentLens="chat" onSendMessage={(msg) => setInput(msg)} />
            </div>
          )}
          {active === 'chat' && messages.length > 0 && (
            <div className={cn('px-4 py-2 border-b border-lattice-border/30', isConKay && 'relative z-10')}>
              <ChatModePanel
                currentLens="chat"
                onSendMessage={(msg) => {
                  setInput(msg);
                }}
              />
            </div>
          )}

          {/* Messages */}
          <div
            className={cn('flex-1 overflow-hidden flex flex-col', isConKay && 'relative z-10')}
            role="log"
            aria-label="Chat messages"
            aria-live="polite"
          >
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-full bg-neon-cyan/10 flex items-center justify-center mb-6">
                  <Bot className="w-10 h-10 text-neon-cyan" />
                </div>
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                  className="w-20 h-20 rounded-2xl bg-gradient-to-br from-neon-cyan/30 to-cyan-900/40 ring-1 ring-neon-cyan/20 flex items-center justify-center mb-6 shadow-lg shadow-neon-cyan/10"
                >
                  <Bot className="w-10 h-10 text-neon-cyan" />
                </motion.div>
                <motion.h2
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.4 }}
                  className="text-2xl font-bold text-white mb-2"
                >
                  Yo. What&apos;s the move?
                </motion.h2>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25, duration: 0.4 }}
                  className="text-gray-400 max-w-md mb-8"
                >
                  Pick a direction or ask me anything. Everything we talk about becomes knowledge in
                  your lattice.
                </motion.p>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35, duration: 0.4 }}
                  className="grid grid-cols-2 gap-3 max-w-lg"
                >
                  {[
                    { icon: Sparkles, label: 'Explain a concept', desc: 'Break anything down' },
                    { icon: Code, label: 'Help me code', desc: 'Debug, build, ship' },
                    { icon: FileText, label: 'Summarize text', desc: 'Condense anything' },
                    { icon: Brain, label: 'Forge a DTU', desc: 'Create knowledge' },
                  ].map((suggestion) => (
                    <button
                      key={suggestion.label}
                      onClick={() => setInput(suggestion.label)}
                      className="flex items-start gap-3 p-4 bg-lattice-surface border border-lattice-border rounded-xl hover:border-neon-cyan/50 hover:bg-lattice-surface/80 transition-all text-left group"
                    >
                      <div className="w-9 h-9 rounded-lg bg-neon-cyan/10 flex items-center justify-center flex-shrink-0 group-hover:bg-neon-cyan/20 transition-colors">
                        <suggestion.icon className="w-4.5 h-4.5 text-neon-cyan" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-white block">
                          {suggestion.label}
                        </span>
                        <span className="text-xs text-gray-400">{suggestion.desc}</span>
                      </div>
                    </button>
                  ))}
                </motion.div>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6, duration: 0.4 }}
                  className="text-xs text-gray-400 mt-6"
                >
                  Type{' '}
                  <code className="px-1.5 py-0.5 bg-lattice-surface rounded text-gray-400">
                    /help
                  </code>{' '}
                  for slash commands &middot;{' '}
                  <code className="px-1.5 py-0.5 bg-lattice-surface rounded text-gray-400">
                    /forge
                  </code>{' '}
                  to create DTUs
                </motion.p>

                {/* Welcome panel from ChatModePanels */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7, duration: 0.4 }}
                  className="mt-6 w-full max-w-lg"
                >
                  <WelcomePanel
                    currentLens="chat"
                    onSendMessage={(msg) => {
                      setInput(msg);
                    }}
                  />
                </motion.div>
              </div>
            )}

            {threadItems.length > 0 && (
              <>
                {unreadInitiativesCount > 0 && (
                  <div className="mx-4 lg:mx-6 mb-2 inline-flex items-center gap-2 self-start rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    Concord wrote you {unreadInitiativesCount} time{unreadInitiativesCount === 1 ? '' : 's'} while you were away.
                  </div>
                )}
                {isConKay ? (
                  // ConKay renders a plain, non-virtualized list: conversations
                  // are short and the immersive holographic layout doesn't give
                  // Virtuoso a stable scroll height (which silently unmounts the
                  // newest rows). A simple scroll container keeps every reply —
                  // including skill viz/citations — reliably mounted.
                  //
                  // Unit A5-backport — wrapped in the SAME <ConKayCockpit> the
                  // global overlay uses (imported, not forked): the left/right
                  // panel lanes resolve every registered `conkay.*` panel from
                  // `lib/panel-registry.ts` automatically (macro library,
                  // DTU provenance, forward-sim, artifact viewer, orchestration
                  // trace, telemetry, connector status), so chat's ConKay mode
                  // and the summonable overlay share one cockpit, not two.
                  <ConKayCockpit className="relative z-10">
                    <>
                      {threadItems.map((item, i) => (
                        <div key={item.__kind === 'message' ? item.id : `${item.__kind}-${i}`}>
                          {renderThreadItem(i, item)}
                        </div>
                      ))}
                      {/* Unit A5-backport — pre-execution confirm for a mutating
                          client-initiated macro call, set ONLY by
                          conkayConfirmIfMutating with the REAL proposed
                          {domain, macro, input}; resolveConkayPendingConfirm is
                          the ONLY way execution proceeds or is skipped. */}
                      {conkayPendingConfirm && (
                        <ConKayActionConfirm
                          domain={conkayPendingConfirm.domain}
                          macro={conkayPendingConfirm.macro}
                          input={conkayPendingConfirm.input}
                          onConfirm={() => resolveConkayPendingConfirm(true)}
                          onCancel={() => resolveConkayPendingConfirm(false)}
                        />
                      )}
                      <div ref={conkayBottomRef} aria-hidden="true" />
                    </>
                  </ConKayCockpit>
                ) : (
                  <Virtuoso
                    data={threadItems}
                    followOutput="smooth"
                    initialTopMostItemIndex={threadItems.length - 1}
                    className="flex-1"
                    itemContent={renderThreadItem}
                  />
                )}
              </>
            )}

            {/* Phase P — GracefulFallback wraps the AI-dependent
                streaming / thinking indicators so a downed conscious
                brain shows a clear status instead of an empty pulse. */}
            <GracefulFallback feature="Chat" brainRequired="conscious">
              <></>
            </GracefulFallback>

            {/* Streaming indicator */}
            {streamActive && streamingContent && (
              <div className="flex gap-4 px-4 lg:px-6 pb-2">
                <div className="w-10 h-10 rounded-lg bg-neon-cyan/20 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-neon-cyan animate-pulse" />
                </div>
                <div className="flex-1 max-w-2xl">
                  <div className="inline-block p-4 rounded-2xl rounded-bl-md bg-lattice-surface border border-neon-cyan/30 text-gray-200">
                    <MessageRenderer content={streamingContent} streaming />
                  </div>
                </div>
                {/* Scroll anchor: rAF-throttled scroll-into-view on token tick */}
                <div ref={streamingAnchorRef} aria-hidden="true" />
              </div>
            )}

            {/* Thinking indicator (when not streaming) */}
            {(sendMutation.isPending || regenerateMutation.isPending) && !streamActive && (
              <div
                className="flex gap-4 px-4 lg:px-6 pb-2"
                role="status"
                aria-label="AI is thinking"
              >
                <div className="w-10 h-10 rounded-lg bg-neon-cyan/20 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-neon-cyan animate-pulse" />
                </div>
                <div className="flex-1 max-w-2xl">
                  <div className="inline-block p-4 rounded-2xl rounded-bl-md bg-lattice-surface border border-lattice-border">
                    <div className="flex items-center gap-2 text-gray-400">
                      <div
                        className="w-2 h-2 bg-neon-cyan rounded-full animate-bounce"
                        style={{ animationDelay: '0ms' }}
                      />
                      <div
                        className="w-2 h-2 bg-neon-cyan rounded-full animate-bounce"
                        style={{ animationDelay: '150ms' }}
                      />
                      <div
                        className="w-2 h-2 bg-neon-cyan rounded-full animate-bounce"
                        style={{ animationDelay: '300ms' }}
                      />
                    </div>
                    <span className="sr-only">AI is generating a response...</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className={cn('p-4 border-t', isConKay ? 'relative z-10 border-cyan-400/15 bg-lattice-surface/40 backdrop-blur-md' : 'border-lattice-border bg-lattice-surface')}>
            <div className="max-w-4xl mx-auto">
              {/* Quoted message indicator */}
              {quotedMessage && (
                <div className="flex items-center gap-2 mb-2 p-2 bg-lattice-bg border border-lattice-border rounded-lg">
                  <Quote className="w-4 h-4 text-neon-cyan flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-400 mb-0.5">
                      Replying to {quotedMessage.role === 'user' ? 'yourself' : 'assistant'}
                    </p>
                    <p className="text-sm text-gray-300 truncate">{quotedMessage.content}</p>
                  </div>
                  <button
                    onClick={() => setQuotedMessage(null)}
                    className="p-1 hover:bg-lattice-surface rounded transition-colors flex-shrink-0"
                    aria-label="Cancel reply"
                  >
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
              )}

              {/* Attachment chips */}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {attachments.map((att) => (
                    <div
                      key={att.id}
                      className="flex items-center gap-2 px-3 py-1.5 bg-lattice-bg border border-lattice-border rounded-lg text-sm"
                    >
                      {att.preview ? (
                        <Image
                          src={att.preview}
                          alt={att.name}
                          width={24}
                          height={24}
                          className="w-6 h-6 rounded object-cover"
                        />
                      ) : (
                        <FileText className="w-4 h-4 text-gray-400" />
                      )}
                      <span className="text-gray-300 truncate max-w-[150px]">{att.name}</span>
                      <span className="text-gray-400 text-xs">{formatBytes(att.size)}</span>
                      <button
                        onClick={() => removeAttachment(att.id)}
                        className="p-0.5 hover:bg-lattice-surface rounded transition-colors"
                        aria-label={`Remove ${att.name}`}
                      >
                        <X className="w-3.5 h-3.5 text-gray-400 hover:text-red-400" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Slash command autocomplete dropdown */}
              <div className="relative">
                <AnimatePresence>
                  {slashMenuOpen && filteredSlashCommands.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute bottom-full left-0 mb-2 w-72 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl z-50 overflow-hidden"
                    >
                      <div className="p-2 border-b border-lattice-border">
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          Commands
                        </p>
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {filteredSlashCommands.map((cmd, idx) => (
                          <button
                            key={cmd.command}
                            onClick={() => handleSlashSelect(cmd)}
                            onMouseEnter={() => setSlashSelectedIndex(idx)}
                            className={cn(
                              'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                              idx === slashSelectedIndex ? 'bg-neon-cyan/10' : 'hover:bg-lattice-bg'
                            )}
                          >
                            <cmd.icon
                              className={cn(
                                'w-4 h-4 flex-shrink-0',
                                idx === slashSelectedIndex ? 'text-neon-cyan' : 'text-gray-400'
                              )}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-mono text-white">{cmd.label}</p>
                              <p className="text-xs text-gray-300">{cmd.description}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                      <div className="p-2 border-t border-lattice-border text-xs text-gray-400 flex items-center gap-3">
                        <span>
                          <kbd className="px-1 py-0.5 bg-lattice-bg rounded text-gray-400">Tab</kbd>{' '}
                          select
                        </span>
                        <span>
                          <kbd className="px-1 py-0.5 bg-lattice-bg rounded text-gray-400">
                            Enter
                          </kbd>{' '}
                          confirm
                        </span>
                        <span>
                          <kbd className="px-1 py-0.5 bg-lattice-bg rounded text-gray-400">Esc</kbd>{' '}
                          dismiss
                        </span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="flex items-end gap-4">
                  <div className="flex-1 flex items-end bg-lattice-bg border border-lattice-border rounded-2xl p-2">
                    {/* Hidden file input */}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPTED_FILE_TYPES}
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                      aria-label="Attach files"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 text-gray-400 hover:text-white transition-colors"
                      title="Attach files"
                      aria-label="Attach files"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder={`Message ${aiMode.name} mode${selectedPersona.id !== 'default' ? ` as ${selectedPersona.name}` : ''}... (/ for commands)`}
                      rows={1}
                      className="flex-1 px-2 py-2 bg-transparent text-white placeholder-gray-500 resize-none focus:outline-none max-h-32"
                      style={{ minHeight: '24px' }}
                      disabled={sendMutation.isPending}
                    />
                    <div className="relative">
                      <button
                        onClick={() => setEmojiPickerOpen((prev) => !prev)}
                        className="p-2 text-gray-400 hover:text-white transition-colors"
                        title="Add emoji"
                      >
                        <Smile className="w-5 h-5" />
                      </button>
                      <AnimatePresence>
                        {emojiPickerOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 8 }}
                            className="absolute bottom-full right-0 mb-2 p-2 bg-lattice-surface border border-lattice-border rounded-xl shadow-xl z-50 grid grid-cols-8 gap-1 w-72"
                          >
                            {[
                              '👍',
                              '👎',
                              '❤️',
                              '😂',
                              '🔥',
                              '💡',
                              '✅',
                              '❌',
                              '🎯',
                              '🚀',
                              '💪',
                              '🤔',
                              '👀',
                              '⭐',
                              '💬',
                              '🙏',
                              '📌',
                              '🎉',
                              '👏',
                              '💯',
                              '⚡',
                              '🧠',
                              '📝',
                              '🔗',
                            ].map((emoji) => (
                              <button
                                key={emoji}
                                onClick={() => {
                                  setInput((prev) => prev + emoji);
                                  setEmojiPickerOpen(false);
                                }}
                                className="w-8 h-8 flex items-center justify-center text-lg hover:bg-lattice-bg rounded-lg transition-colors"
                              >
                                {emoji}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                  {/* Send / Stop toggle — when streaming, swap to a stop
                      button (ChatGPT / Claude pattern). Aborts in-flight
                      send + regenerate via the abort controller ref. */}
                  {(streamActive || sendMutation.isPending || regenerateMutation.isPending) ? (
                    <button
                      onClick={() => {
                        chatAbortControllerRef.current?.abort();
                        setStreamActive(false);
                      }}
                      className="p-4 bg-rose-500 text-white rounded-2xl hover:bg-rose-400 transition-colors animate-pulse"
                      title="Stop generating (Esc)"
                      aria-label="Stop generating"
                    >
                      <PauseCircle className="w-5 h-5" />
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() && attachments.length === 0}
                      className="p-4 bg-neon-cyan text-black rounded-2xl hover:bg-neon-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Send (⌘ Enter)"
                      aria-label="Send message"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Composer footer — discoverable keyboard shortcuts (UI_QUALITY_RUBRIC
                  §2: "a kbd chip, a palette entry, not a hidden keybinding
                  nobody discovers"). Reference app: Claude.ai's composer,
                  which shows its send/newline shortcuts inline instead of
                  making the user guess — a single trimmed row, not a second
                  block of chrome, keeping the "not cumbersome" bar. Every
                  chip names a shortcut genuinely registered via
                  useLensCommand above (send / focus-input / thread-search),
                  not decorative text. */}
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-2 text-[10px] text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-lattice-bg rounded text-gray-400">Enter</kbd> send
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-lattice-bg rounded text-gray-400">Shift+Enter</kbd> new line
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-lattice-bg rounded text-gray-400">/</kbd> commands
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-lattice-bg rounded text-gray-400">⌘K</kbd> search chats
                </span>
                <span className="text-gray-600">·</span>
                <span>Saved as DTUs in your lattice</span>
              </div>
            </div>
          </div>
        </main>

        {/* Chat tools drawer — Analysis & features (extracted panel) */}
        <ChatToolsDrawer
          open={toolsPanelOpen}
          onClose={() => setToolsPanelOpen(false)}
          chatActionRunning={chatActionRunning}
          onChatAction={handleChatAction}
          threadSummarizeResult={threadSummarizeResult}
          onClearThreadSummarize={() => setThreadSummarizeResult(null)}
          participantAnalysisResult={participantAnalysisResult}
          onClearParticipantAnalysis={() => setParticipantAnalysisResult(null)}
          topicDetectionResult={topicDetectionResult}
          onClearTopicDetection={() => setTopicDetectionResult(null)}
          lensRecommendations={lensRecommendations}
          lensSessionCtx={lensSessionCtx}
          lensTelemetry={lensTelemetry}
        />

      </div>

      {/* DTU Detail Overlay -- opened when clicking a DTU reference */}
      {inspectingDtuId && (
        <DTUDetailView
          dtuId={inspectingDtuId}
          onClose={() => setInspectingDtuId(null)}
          onNavigate={(id) => setInspectingDtuId(id)}
        />
      )}

      {/* Session Sidebar — session management overlay */}
      <SessionSidebar isOpen={sessionSidebarOpen} onClose={() => setSessionSidebarOpen(false)} />

      {/* Context Overlay — shows working-set DTUs for a response */}
      <ContextOverlay
        sessionId={selectedConversation || ''}
        lens="chat"
        isOpen={contextOverlayOpen}
        onClose={() => setContextOverlayOpen(false)}
      />

      <ChatSystemsDrawer
        open={systemsPanelOpen}
        onClose={() => setSystemsPanelOpen(false)}
        initiativesData={Array.isArray(initiativesData) ? initiativesData : null}
      />

{/* Atlas Overlay — material query results */}
      {atlasLoading || atlasResult ? (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40">
          <AtlasOverlay query={atlasQuery} result={atlasResult as never} loading={atlasLoading} />
        </div>
      ) : null}

      {/* Chat Route Overlay — shows lens attribution on routed messages */}
      {routeMeta && (
        <ChatRouteOverlay
          route={routeMeta}
          onConfirm={() => setRouteMeta(null)}
          onCancel={() => setRouteMeta(null)}
        />
      )}

      {/* Forge Card — inline artifact creation when forge envelope exists */}
      {forgeEnvelope && (
        <div className="absolute bottom-20 right-4 z-40 w-96">
          <ForgeCard
            dtu={forgeEnvelope.dtu as never}
            presentation={forgeEnvelope.presentation as never}
            actions={forgeEnvelope.actions as never}
            onSave={() => setForgeEnvelope(null)}
            onDelete={() => setForgeEnvelope(null)}
          />
        </div>
      )}
      {/* Sprint 11B — Agent Mode floating action button (bottom-right) +
          slide-over panel + initiative bell. All three are self-contained;
          they don't touch existing chat state. */}
      <button
        onClick={() => setAgentPanelOpen(true)}
        className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-30 flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 rounded-full bg-amber-500 hover:bg-amber-400 text-amber-50 shadow-2xl ring-2 ring-amber-700/30 text-sm font-medium"
        title="Agent Mode — give Concord a task. It will use any of 200+ apps + web + compute to complete it."
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8V4H8M4 8h4v4M16 4v4h4M20 16h-4v4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="hidden sm:inline">Agent Mode</span>
      </button>
      <AgentModePanel open={agentPanelOpen} onClose={() => setAgentPanelOpen(false)} />
      <ProjectsPanel
        open={projectsPanelOpen}
        onClose={() => setProjectsPanelOpen(false)}
        onSelectProject={(p) => setActiveProject(p)}
        activeProjectId={activeProject?.id || null}
      />
      <PromptsLibrary
        open={promptsPanelOpen}
        onClose={() => setPromptsPanelOpen(false)}
        onInsert={(content) => {
          setInput((prev) => (prev ? `${prev}\n\n${content}` : content));
          inputRef.current?.focus();
        }}
      />
      <ScheduledTasksPanel
        open={scheduledPanelOpen}
        onClose={() => setScheduledPanelOpen(false)}
        activeProjectId={activeProject?.id || null}
      />
      <ThreadSearchOverlay
        open={threadSearchOpen}
        onClose={() => setThreadSearchOpen(false)}
        onSelect={(threadId) => {
          setSelectedConversation(threadId);
          setThreadSearchOpen(false);
        }}
        projectId={activeProject?.id || null}
      />
      <ChatStudioPanel
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        threadId={selectedConversation}
        messages={messages
          .filter((m): m is Message & { role: 'user' | 'assistant' | 'system' } => !!m.content)
          .map<StudioMessage>((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          }))}
        onInsert={(text) => {
          setInput((prev) => (prev ? `${prev}\n\n${text}` : text));
          inputRef.current?.focus();
        }}
        onActivateAssistant={(a) => {
          // A custom GPT becomes the active persona — its instructions
          // drive the system prompt and its default mode is selected.
          setSelectedPersona({
            id: `gpt-${a.id}`,
            name: a.name,
            icon: Bot,
            description: a.description || 'Custom GPT',
            systemPrompt: a.instructions,
          });
          const mode = AI_MODES.find((m) => m.id === a.model);
          if (mode) setAiMode(mode);
          setStudioOpen(false);
          const sysMsg: Message = {
            id: `sys-${Date.now()}`,
            role: 'system',
            content: `Activated custom GPT "${a.name}". Its instructions now guide every reply in this conversation.`,
            timestamp: new Date().toISOString(),
          };
          setLocalMessages((prev) => [...prev, sysMsg]);
        }}
      />
      <div className="fixed top-4 right-20 z-30">
        <InitiativeBell />
      </div>

      <ToolPalette
        open={toolPaletteOpen}
        onClose={() => setToolPaletteOpen(false)}
        onRunResult={(entry, result) => {
          // Mirror palette-run results into the same trace stream so
          // the user sees their action land inline alongside whatever
          // Concord would have run autonomously.
          setToolTraces((prev) => [
            ...prev,
            {
              id: `palette_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              domain: entry.domain,
              action: entry.action,
              result,
              createdAt: new Date().toISOString(),
            },
          ]);
        }}
      />

      {/* BYO API key drawer (slide-in from right) */}
      <BYOKeyDrawer open={byoOpen} onClose={() => setByoOpen(false)} />

      {/* ── Global message search (⌘⇧F) ───────────────────────── */}
      <AnimatePresence>
        {globalSearchOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setGlobalSearchOpen(false)}
          >
            <motion.div
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-2xl bg-[#0d1117] rounded-xl border border-neon-cyan/30 shadow-2xl shadow-neon-cyan/10 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 px-4 py-3 border-b border-lattice-border">
                <Search className="w-4 h-4 text-neon-cyan" />
                <input
                  ref={globalSearchInputRef}
                  type="text"
                  value={globalSearchQuery}
                  onChange={(e) => setGlobalSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setGlobalSearchOpen(false); }}
                  placeholder="Search every message in every conversation…"
                  className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
                  autoFocus
                />
                <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">esc</kbd>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {globalSearchQuery.trim().length < 2 && (
                  <div className="px-4 py-8 text-center text-xs text-gray-400">
                    Type at least 2 characters to search
                  </div>
                )}
                {globalSearchQuery.trim().length >= 2 && globalSearchResults.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-gray-400">
                    No matches across {conversations.length} conversation{conversations.length === 1 ? '' : 's'}
                  </div>
                )}
                {globalSearchResults.map((r, i) => {
                  const q = globalSearchQuery.trim();
                  const idx = r.preview.toLowerCase().indexOf(q.toLowerCase());
                  const before = idx >= 0 ? r.preview.slice(0, idx) : r.preview;
                  const match = idx >= 0 ? r.preview.slice(idx, idx + q.length) : '';
                  const after = idx >= 0 ? r.preview.slice(idx + q.length) : '';
                  return (
                    <button
                      key={`${r.convId}-${r.message.id}-${i}`}
                      onClick={() => jumpToSearchResult(r.convId, r.message.id)}
                      className="w-full text-left px-4 py-3 border-b border-lattice-border hover:bg-lattice-elevated transition-colors group"
                    >
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                        <MessageSquare className="w-3 h-3" />
                        <span className="text-neon-cyan/80">{r.convTitle}</span>
                        <span>·</span>
                        <span>{r.message.role}</span>
                        {r.message.timestamp && (
                          <>
                            <span>·</span>
                            <span>{new Date(r.message.timestamp).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                      <div className="text-xs text-gray-300 leading-relaxed">
                        {before}
                        <mark className="bg-neon-cyan/30 text-white px-0.5 rounded">{match}</mark>
                        {after}
                      </div>
                    </button>
                  );
                })}
              </div>
              {globalSearchResults.length > 0 && (
                <div className="px-4 py-2 border-t border-lattice-border text-[10px] text-gray-400 flex justify-between">
                  <span>{globalSearchResults.length} match{globalSearchResults.length === 1 ? '' : 'es'}</span>
                  <span>scanning {conversations.length} conversation{conversations.length === 1 ? '' : 's'}</span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <ExternalReferenceLocale label="Hacker News" source="hn.algolia.com" className="mt-6">
        <HackerNewsReference />
      </ExternalReferenceLocale>
    </div>
    {/* Phase 12 (C4) — mobile pane switcher. Chat has multiple overlays
        (sidebar, thread-search, tool-palette, scheduled, projects) that
        each ship their own desktop affordance; mobile users only need
        one tappable surface that opens each panel. The "active" tab
        here is best-effort — these panels close themselves on action. */}
    <MobileTabBar
      tabs={[
        { id: 'chat',      label: 'Chat',    icon: MTabChat },
        { id: 'convos',    label: 'Convos',  icon: MTabConvos },
        { id: 'projects',  label: 'Projects',icon: MTabProj },
        { id: 'threads',   label: 'Find',    icon: MTabSearch },
        { id: 'tools',     label: 'Tools',   icon: MTabTools },
        { id: 'scheduled', label: 'Sched',   icon: MTabSched },
      ]}
      active={
        threadSearchOpen ? 'threads'
        : toolPaletteOpen ? 'tools'
        : scheduledPanelOpen ? 'scheduled'
        : chatSidebarOpen ? 'convos'
        : 'chat'
      }
      onSelect={(id) => {
        // ONE overlay primitive — mobile tabs map onto it.
        if (id === 'convos' || id === 'projects') setOverlay('convos');
        else if (id === 'threads') setOverlay('thread-search');
        else if (id === 'tools') setOverlay('tool-palette');
        else if (id === 'scheduled') setOverlay('scheduled');
        else setOverlay(null); // 'chat' restores focus to the thread
      }}
    />
    </>
  );
}

// ── Tool trace block ─────────────────────────────────────────────────────────

