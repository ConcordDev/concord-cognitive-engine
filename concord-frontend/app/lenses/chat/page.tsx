'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HackerNewsReference } from '@/components/chat/HackerNewsReference';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useTilePush } from '@/hooks/useTilePush';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import {
  Bot as MTabChat, MessageSquare as MTabConvos, Search as MTabSearch,
  Command as MTabTools, Clock as MTabSched, Folder as MTabProj,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
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
  Terminal,
  GraduationCap,
  Globe,
  HelpCircle,
  Trash2,
  Download,
  Users,
  Check,
  ExternalLink,
  Layers,
  Loader2,
  XCircle,
  BarChart3,
  Hammer,
  ChevronRight,
  PauseCircle,
  PlayCircle,
  GitBranch,
  Key,
  FolderOpen,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
// ConKay ("Kay") — Concord's JARVIS-style majordomo, as a voice-native chat MODE.
import { ConKayBackdrop } from '@/components/conkay/ConKayBackdrop';
import { ConKayHud } from '@/components/conkay/ConKayHud';
import { ConKayMessage } from '@/components/conkay/ConKayViz';
import { useConKayVoice } from '@/components/conkay/useConKayVoice';
import { CONKAY_PERSONA_PROMPT, type ConKayState } from '@/components/conkay/conkay-persona';
import { matchConKaySkill, type ConKaySkill } from '@/components/conkay/conkay-skills';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { formatBytes } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { LensContextPanel } from '@/components/lens/LensContextPanel';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import MessageRenderer from '@/components/chat/MessageRenderer';
import OracleResponse from '@/components/chat/OracleResponse';
import { ToolCallCard } from '@/components/chat/ToolCallCard';
import ComputeBadge from '@/components/chat/ComputeBadge';
import CitationChips from '@/components/chat/CitationChips';
import AnonNudge from '@/components/chat/AnonNudge';
import BYOKeyDrawer from '@/components/chat/BYOKeyDrawer';
import { useAuth } from '@/hooks/useAuth';
import { ReasoningIndicator } from '@/components/chat/ReasoningIndicator';
import { MessageContinuationMarker } from '@/components/chat/MessageContinuationMarker';
import { useOracleSolve, type OracleResponseData } from '@/hooks/useOracleSolve';
import AtlasOverlay from '@/components/chat/AtlasOverlay';
import AtlasViewer from '@/components/chat/AtlasViewer';
import ProjectsPanel, { type ChatProject } from '@/components/chat/ProjectsPanel';
import PromptsLibrary from '@/components/chat/PromptsLibrary';
import ThreadSearchOverlay from '@/components/chat/ThreadSearchOverlay';
import ScheduledTasksPanel from '@/components/chat/ScheduledTasksPanel';
import ChatStudioPanel, { type StudioMessage } from '@/components/chat/ChatStudioPanel';
import {
  WelcomePanel,
  ModeSelector,
  ChatPanel as ChatModePanel,
} from '@/components/chat/ChatModePanels';
import ChatRouteOverlay from '@/components/chat/ChatRouteOverlay';
import { ContextOverlay } from '@/components/chat/ContextOverlay';
import ForgeCard from '@/components/chat/ForgeCard';
import FoundationCard from '@/components/chat/FoundationCard';
import { SessionSidebar } from '@/components/chat/SessionSidebar';
// ── Systems panels ─────────────────────────────────────────────
// These five panels round-trip through the /api/chat cognitive
// pipeline and surface system-level context alongside the
// conversation — security posture, mesh state, inference model
// status, proactive initiative chips, and Atlas privacy zones.
// All fully built, all previously orphaned.
import ShieldCard from '@/components/chat/ShieldCard';
import MeshStatusCard from '@/components/chat/MeshStatusCard';
import IntelligenceCard from '@/components/chat/IntelligenceCard';
import AtlasPrivacyMonitor from '@/components/chat/AtlasPrivacyMonitor';
import { InitiativeChip, type Initiative } from '@/components/chat/InitiativeChip';
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

const AI_MODES: AIMode[] = [
  { id: 'overview', name: 'Overview', icon: MessageSquare, description: 'General conversation' },
  { id: 'deep', name: 'Deep', icon: Brain, description: 'In-depth analysis' },
  {
    id: 'creative',
    name: 'Creative',
    icon: Sparkles,
    description: 'Creative writing & brainstorming',
  },
  { id: 'code', name: 'Code', icon: Code, description: 'Programming help' },
  { id: 'research', name: 'Research', icon: BookOpen, description: 'Research mode with citations' },
  { id: 'creti', name: 'CRETI', icon: Zap, description: 'Structured CRETI format' },
  { id: 'conkay', name: 'ConKay', icon: Sparkles, description: 'Voice-native majordomo — archives + research, holographic' },
];

const PERSONAS: Persona[] = [
  {
    id: 'default',
    name: 'Default Assistant',
    icon: Bot,
    description: 'Standard helpful assistant',
    systemPrompt: '',
  },
  {
    id: 'research-analyst',
    name: 'Research Analyst',
    icon: Search,
    description: 'Thorough analysis with citations and evidence',
    systemPrompt:
      'You are a rigorous research analyst. Provide well-structured analysis backed by evidence and citations. Always consider multiple perspectives, identify assumptions, and note limitations in the evidence. Use structured formatting with clear sections.',
  },
  {
    id: 'creative-writer',
    name: 'Creative Writer',
    icon: Sparkles,
    description: 'Imaginative and expressive writing style',
    systemPrompt:
      'You are a talented creative writer. Use vivid language, metaphors, and engaging narrative techniques. Be imaginative and expressive while remaining clear. Adapt your tone to match the creative task at hand.',
  },
  {
    id: 'code-expert',
    name: 'Code Expert',
    icon: Terminal,
    description: 'Expert programmer with best practices',
    systemPrompt:
      'You are an expert software engineer. Write clean, well-documented, production-quality code. Always explain your approach, consider edge cases, suggest optimizations, and follow established design patterns and best practices for the relevant language/framework.',
  },
  {
    id: 'domain-specialist',
    name: 'Domain Specialist',
    icon: Globe,
    description: 'Uses current lens context for domain expertise',
    systemPrompt:
      'You are a domain specialist who deeply understands the current context and domain. Reference relevant domain-specific terminology, frameworks, and knowledge. Connect new information to existing domain knowledge in the lattice.',
  },
  {
    id: 'socratic-tutor',
    name: 'Socratic Tutor',
    icon: GraduationCap,
    description: 'Teaches through guided questioning',
    systemPrompt:
      'You are a Socratic tutor. Instead of giving direct answers, guide the learner through carefully crafted questions that help them discover the answer themselves. Break complex topics into smaller concepts. Validate understanding at each step before proceeding.',
  },
];

const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/mode',
    label: '/mode [mode]',
    description: 'Switch AI mode',
    icon: Settings,
    args: 'mode',
  },
  { command: '/clear', label: '/clear', description: 'Clear chat history', icon: Trash2 },
  {
    command: '/export',
    label: '/export',
    description: 'Export conversation as JSON',
    icon: Download,
  },
  { command: '/forge', label: '/forge', description: 'Forge last response to DTU', icon: Zap },
  {
    command: '/tool',
    label: '/tool',
    description: 'Open the tool palette (every domain.action runnable)',
    icon: Sparkles,
  },
  { command: '/help', label: '/help', description: 'Show available commands', icon: HelpCircle },
  {
    command: '/context',
    label: '/context [domain]',
    description: 'Set domain context',
    icon: Hash,
    args: 'domain',
  },
  {
    command: '/oracle',
    label: '/oracle [query]',
    description: 'Ask the Oracle Engine (rich response)',
    icon: Sparkles,
    args: 'query',
  },
];

const ACCEPTED_FILE_TYPES = '.txt,.md,.json,.csv,.pdf,.png,.jpg,.jpeg';
const MAX_BASE64_SIZE = 512 * 1024; // 512KB — encode files smaller than this

const STORAGE_KEY_CONVERSATIONS = 'concord_chat_conversations';
const STORAGE_KEY_SESSION = 'concord_chat_session';
const STORAGE_KEY_MESSAGES_PREFIX = 'concord_chat_msgs_';

// ──────────────────────────────────────────────
// Helper: UUID generation
// ──────────────────────────────────────────────

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ──────────────────────────────────────────────
// Helper: localStorage-backed conversation registry
// ──────────────────────────────────────────────

function loadConversations(): Conversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONVERSATIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveConversations(convs: Conversation[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_CONVERSATIONS, JSON.stringify(convs));
  } catch {
    // Storage full or unavailable
  }
}

function loadSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY_SESSION);
  } catch {
    return null;
  }
}

function saveSessionId(id: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) {
      localStorage.setItem(STORAGE_KEY_SESSION, id);
    } else {
      localStorage.removeItem(STORAGE_KEY_SESSION);
    }
  } catch {
    // Storage unavailable
  }
}

function loadMessagesForSession(sessionId: string): Message[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MESSAGES_PREFIX + sessionId);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveMessagesForSession(sessionId: string, messages: Message[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_MESSAGES_PREFIX + sessionId, JSON.stringify(messages));
  } catch {
    // Storage full
  }
}

function deleteMessagesForSession(sessionId: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY_MESSAGES_PREFIX + sessionId);
  } catch {
    // noop
  }
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ──────────────────────────────────────────────
// Helper: file to base64
// ──────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function ChatLensPage() {
  useLensNav('chat');
  // Phase 12 (Item 8 cont.) — flash on chat completion + multi-device
  // message saves. Excludes chat:token / chat:status because those fire
  // once per streamed token and would strobe the surface.
  useTilePush({ lensId: 'chat', events: ['chat:complete', 'message:saved'] });
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('chat');
  const queryClient = useQueryClient();

  const {
    hyperDTUs,
    megaDTUs,
    regularDTUs,
    tierDistribution,
    publishToMarketplace,
    isLoading: dtusLoading,
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
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [feedbackState, setFeedbackState] = useState<Record<string, 'up' | 'down'>>({});
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [renamingConversation, setRenamingConversation] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [storedConversations, setStoredConversations] = useState<Conversation[]>(() =>
    loadConversations()
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
  const [showPersonaPicker, setShowPersonaPicker] = useState(false);

  // New state — Slash commands
  const [showSlashMenu, setShowSlashMenu] = useState(false);
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
  const [chatMode, setChatMode] = useState<'welcome' | 'assist' | 'explore' | 'connect' | 'chat'>(
    'chat'
  );
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(false);
  const [contextOverlayOpen, setContextOverlayOpen] = useState(false);

  // ── Systems panel (shield / mesh / intel / privacy / initiatives) ─────
  // Opt-in drawer surfacing the orphaned systems cards. All five
  // components are fully built; this gives them a live home inside
  // the chat lens where they're most useful (the AI can reference
  // shield/mesh/intel state while responding). Endpoints are thin
  // REST wrappers that delegate to the corresponding macros server-side.
  const [systemsPanelOpen, setSystemsPanelOpen] = useState(false);
  const [systemsTab, setSystemsTab] = useState<
    'shield' | 'mesh' | 'intel' | 'privacy' | 'initiatives'
  >('shield');

  // Tool palette — every domain.action across all 200 lens manifests
  // is searchable + runnable from here. Open via /tool slash command
  // or Cmd/Ctrl+. keyboard shortcut.
  const [toolPaletteOpen, setToolPaletteOpen] = useState(false);
  // Sprint 11 — Agent Mode panel (slide-over, isolated session).
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);

  // 2026 parity — Projects / Prompts / Search / Scheduled slide-overs.
  // Parity vs Claude Projects + ChatGPT Projects + Perplexity Spaces +
  // ChatGPT scheduled-tasks. State management mirrors systemsPanelOpen.
  const [projectsPanelOpen, setProjectsPanelOpen] = useState(false);
  const [promptsPanelOpen, setPromptsPanelOpen] = useState(false);
  const [scheduledPanelOpen, setScheduledPanelOpen] = useState(false);
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [activeProject, setActiveProject] = useState<ChatProject | null>(null);

  // ChatGPT-parity studio — voice / custom GPTs / canvas / memory /
  // code interpreter / share links / image generation. One slide-over,
  // seven tabs, each backed by a real chat-domain macro.
  const [studioOpen, setStudioOpen] = useState(false);

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
  const { data: shieldData } = useQuery({
    queryKey: ['chat-shield-status'],
    queryFn: () =>
      api
        .get<{ ok: boolean; securityScore?: Record<string, unknown> }>('/api/shield/status')
        .then((r) => (r.data?.securityScore || r.data || {}) as Record<string, unknown>),
    enabled: systemsPanelOpen && systemsTab === 'shield',
    refetchInterval: systemsPanelOpen && systemsTab === 'shield' ? 10_000 : false,
  });
  const { data: meshData } = useQuery({
    queryKey: ['chat-mesh-status'],
    queryFn: () => api.get<Record<string, unknown>>('/api/mesh/status').then((r) => r.data || {}),
    enabled: systemsPanelOpen && systemsTab === 'mesh',
    refetchInterval: systemsPanelOpen && systemsTab === 'mesh' ? 10_000 : false,
  });
  const { data: intelData } = useQuery({
    queryKey: ['chat-intel-status'],
    queryFn: () => api.get<Record<string, unknown>>('/api/intel/status').then((r) => r.data || {}),
    enabled: systemsPanelOpen && systemsTab === 'intel',
    refetchInterval: systemsPanelOpen && systemsTab === 'intel' ? 15_000 : false,
  });
  const { data: privacyData } = useQuery({
    queryKey: ['chat-atlas-privacy'],
    queryFn: () =>
      api
        .get<Record<string, unknown>>('/api/atlas/privacy_zones?view=stats')
        .then((r) => r.data || null),
    enabled: systemsPanelOpen && systemsTab === 'privacy',
    refetchInterval: systemsPanelOpen && systemsTab === 'privacy' ? 20_000 : false,
  });
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
    refetchInterval: 10000,
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
    const saved = loadMessagesForSession(selectedConversation);
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
        try { saveMessagesForSession(selectedConversation, hydrated); } catch { /* private mode */ }
      } catch { /* anon, offline, or 403 — leave empty */ }
    })();
    return () => { cancelled = true; };
  }, [selectedConversation]);

  // Persist messages whenever they change (debounced via the conversation id)
  useEffect(() => {
    if (selectedConversation && localMessages.length > 0) {
      saveMessagesForSession(selectedConversation, localMessages);
    }
  }, [localMessages, selectedConversation]);

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
  const [isStreaming, setIsStreaming] = useState(false);

  // Scroll anchor — keeps the bottom of the streaming preview in view as
  // tokens arrive. Throttled via rAF so fast token bursts don't queue up
  // dozens of scroll calls. Only scrolls when the user is already near
  // the bottom (auto-follow); if they've scrolled up to read history we
  // don't yank them back.
  const streamingAnchorRef = useRef<HTMLDivElement | null>(null);
  const lastScrollTsRef = useRef<number>(0);
  useEffect(() => {
    if (!isStreaming || !streamingContent || !streamingAnchorRef.current) return;
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
  }, [streamingContent, isStreaming]);

  // BYO key drawer + anon-nudge UI state.
  const [byoOpen, setByoOpen] = useState(false);
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
            setShowModeSelect(true);
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
      setShowSlashMenu(false);
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
        saveMessagesForSession(newId, [userMsg]);
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

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

      // Abort any previous in-flight request and create a new controller
      chatAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      chatAbortControllerRef.current = abortController;

      try {
        setIsStreaming(true);
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
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
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
          }

          setIsStreaming(false);
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
        setIsStreaming(false);
        setStreamingContent('');
        const data = await streamRes.json();
        return data;
      } catch (err) {
        // If the request was aborted (unmount / navigation), don't retry
        if (abortController.signal.aborted) throw err;

        // Stream endpoint failed, fall back to regular POST
        setIsStreaming(false);
        setStreamingContent('');
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
          { signal: abortController.signal }
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
      setIsStreaming(false);
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
    setShowMoreMenu(false);
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
    setShowMoreMenu(false);
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
      setShowMoreMenu(false);
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
    setShowMoreMenu(false);
  }, [messages, conversations, selectedConversation]);

  // Global message search — scans every conversation in localStorage,
  // not just the current one.  Closes the gap with Claude.ai/ChatGPT
  // which both index message bodies, not titles only.
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
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
        try { msgs = loadMessagesForSession(conv.id); } catch { msgs = []; }
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

  // ── ConKay vision: an image attachment in ConKay mode is a "look at this" —
  // POST the raw image to /api/vision/analyze (the vision brain). Honest offline
  // fallback when no vision model is connected. Reuses JARVIS-style perception.
  const conkayVisionMutation = useMutation({
    mutationFn: async ({ file, prompt }: { file: File; prompt: string }) => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
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
      const apiBase = process.env.NEXT_PUBLIC_API_URL || '';
      const result = await match.skill.run(match.args, {
        apiBase,
        fetchJson: async (path: string) => {
          try {
            const r = await fetch(`${apiBase}${path}`, { credentials: 'include' });
            return await r.json();
          } catch { return null; }
        },
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
    }

    sendMutation.mutate(input);
  }, [input, sendMutation, executeSlashCommand, isConKay, attachments, conkayVisionMutation, runConKaySkill]);

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
    (sendMutation.isPending || conkayVisionMutation.isPending || conkaySkillRunning) ? 'processing'
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
      if (showSlashMenu) {
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
            setShowSlashMenu(false);
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
          setShowSlashMenu(false);
          setSlashFilter('');
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const selected = filteredSlashCommands[slashSelectedIndex];
          if (selected) {
            setInput(selected.command + (selected.args ? ' ' : ''));
            setShowSlashMenu(false);
            setSlashFilter('');
          }
          return;
        }
      }

      // Esc stops generation if streaming or pending
      if (e.key === 'Escape' && (isStreaming || sendMutation.isPending || regenerateMutation.isPending)) {
        e.preventDefault();
        chatAbortControllerRef.current?.abort();
        setIsStreaming(false);
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showSlashMenu, filteredSlashCommands, slashSelectedIndex, handleSend, executeSlashCommand,
     isStreaming, sendMutation.isPending, regenerateMutation.isPending]
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // Slash command detection
    if (value.startsWith('/')) {
      const commandText = value.slice(1).split(/\s/)[0]; // text after / before first space
      if (!value.includes(' ') || value.split(/\s/).length <= 1) {
        setShowSlashMenu(true);
        setSlashFilter(commandText);
      } else {
        setShowSlashMenu(false);
        setSlashFilter('');
      }
    } else {
      setShowSlashMenu(false);
      setSlashFilter('');
    }
  }, []);

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      setInput(cmd.command + (cmd.args ? ' ' : ''));
      setShowSlashMenu(false);
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
                    title="Branch a new conversation from this message"
                    aria-label="Branch from here"
                  >
                    <GitBranch className="w-3 h-3" />
                  </button>
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={error?.message}
          onRetry={() => {
            refetch();
          }}
        />
      </div>
    );
  }

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────

  return (
    <LensShell lensId="chat" asMain={false} disableAgentFab={true}>
      <FirstRunTour lensId="chat" />
      <DepthBadge lensId="chat" size="sm" className="ml-2" />
    <div data-lens-theme="chat" className="h-full flex flex-col bg-lattice-bg">
      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 px-4 py-1 border-b border-lattice-border/30 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="chat" data={realtimeData || {}} compact />
        {dtusLoading && (
          <span className="w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
        )}
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <RealtimeDataPanel
        domain="chat"
        data={realtimeData}
        isLive={isLive}
        lastUpdated={lastUpdated}
        insights={realtimeInsights}
        compact
      />
      <UniversalActions domain="chat" artifactId={null} compact />
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

              {/* AI Mode selector */}
              <div className="relative">
                <button
                  onClick={() => setShowModeSelect(!showModeSelect)}
                  className="flex items-center gap-2 px-4 py-2 bg-lattice-bg border border-lattice-border rounded-lg hover:border-gray-500 transition-colors"
                >
                  <aiMode.icon className="w-4 h-4 text-neon-cyan" />
                  <span className="text-white text-sm font-medium">{aiMode.name}</span>
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                </button>

                <AnimatePresence>
                  {showModeSelect && (
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
                            setShowModeSelect(false);
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
                            <p className="text-xs text-gray-400">{mode.description}</p>
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
                  onClick={() => setShowPersonaPicker(!showPersonaPicker)}
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
                  {showPersonaPicker && (
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
                            setShowPersonaPicker(false);
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
                            <p className="text-xs text-gray-400">{persona.description}</p>
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

              {/* View Context button — opens ContextOverlay */}
              <button
                onClick={() => setContextOverlayOpen(true)}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-lattice-bg border border-lattice-border rounded-full text-xs text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/30 transition-colors"
                title="View working set context"
              >
                <Eye className="w-3 h-3" />
                <span>Context</span>
              </button>

              {/* Pause Concord — toggles initiative delivery server-side
                  via PUT /api/initiative/settings. When paused, Concord
                  queues but doesn't double-text until resumed. */}
              <button
                onClick={toggleInitiativesPaused}
                className={cn(
                  'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-lattice-bg border rounded-full text-xs transition-colors',
                  initiativesPaused
                    ? 'border-amber-500/50 text-amber-300'
                    : 'border-lattice-border text-gray-400 hover:text-amber-300 hover:border-amber-500/30'
                )}
                aria-pressed={initiativesPaused}
                title={initiativesPaused ? 'Concord is paused — resume to allow proactive messages' : 'Pause Concord — stops double-texting'}
              >
                {initiativesPaused
                  ? <PlayCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  : <PauseCircle className="w-3.5 h-3.5" aria-hidden="true" />}
                {initiativesPaused ? 'Paused' : 'Active'}
              </button>
              {/* Tool palette button — every domain.action across the 200
                  lens manifests in one searchable surface. */}
              <button
                onClick={() => setToolPaletteOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-lattice-bg border border-lattice-border rounded-full text-xs text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/30 transition-colors"
                title="Open tool palette (Cmd+. or /tool)"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Tools
              </button>
              {/* Systems button — opens the ShieldCard / MeshStatusCard /
                IntelligenceCard / AtlasPrivacyMonitor / InitiativeChip
                drawer with live-polling data from shield/mesh/intel
                macros. */}
              <button
                onClick={() => setSystemsPanelOpen((v) => !v)}
                className={cn(
                  'hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-lattice-bg border rounded-full text-xs transition-colors',
                  systemsPanelOpen
                    ? 'border-neon-purple/50 text-neon-purple'
                    : 'border-lattice-border text-gray-400 hover:text-neon-purple hover:border-neon-purple/30'
                )}
                title="System health, mesh, intelligence, privacy, initiatives"
              >
                <Activity className="w-3 h-3" />
                <span>Systems</span>
              </button>
              {/* Living chat / Layer 4b — the assistant's felt state (a qualeOf mood
                  label), surfaced honestly as a correlate. Renders only when lit. */}
              <AssistantMoodChip />
              {/* 2026 parity — Projects, Prompts, Scheduled, Search.
                  Parity with Claude Projects / ChatGPT Projects-Tasks /
                  Perplexity Spaces. */}
              <button
                type="button"
                onClick={() => setProjectsPanelOpen(true)}
                className={cn(
                  'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-lattice-bg border rounded-full text-xs transition-colors',
                  activeProject
                    ? 'border-cyan-500/50 text-cyan-300'
                    : 'border-lattice-border text-gray-400 hover:text-cyan-300 hover:border-cyan-500/30',
                )}
                title="Projects (Claude / ChatGPT / Perplexity Spaces parity)"
              >
                <FolderOpen className="w-3 h-3" />
                <span>{activeProject ? activeProject.name.slice(0, 14) : 'Projects'}</span>
              </button>
              <button
                type="button"
                onClick={() => setPromptsPanelOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-lattice-bg border border-lattice-border rounded-full text-xs text-gray-400 hover:text-emerald-300 hover:border-emerald-500/30 transition-colors"
                title="Saved prompt library"
              >
                <BookOpen className="w-3 h-3" />
                <span>Prompts</span>
              </button>
              <button
                type="button"
                onClick={() => setScheduledPanelOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-lattice-bg border border-lattice-border rounded-full text-xs text-gray-400 hover:text-amber-300 hover:border-amber-500/30 transition-colors"
                title="Scheduled tasks (recurring prompts)"
              >
                <Clock className="w-3 h-3" />
                <span>Schedule</span>
              </button>
              {/* ChatGPT-parity studio — voice, custom GPTs, canvas,
                  memory, code interpreter, share links, image gen. */}
              <button
                type="button"
                onClick={() => setStudioOpen(true)}
                className={cn(
                  'hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-lattice-bg border rounded-full text-xs transition-colors',
                  studioOpen
                    ? 'border-violet-500/50 text-violet-300'
                    : 'border-lattice-border text-gray-400 hover:text-violet-300 hover:border-violet-500/30',
                )}
                title="Studio — voice, custom GPTs, canvas, memory, code, share, images"
              >
                <Sparkles className="w-3 h-3" />
                <span>Studio</span>
              </button>
              <button
                type="button"
                onClick={() => setThreadSearchOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 bg-lattice-bg border border-lattice-border rounded-full text-xs text-gray-400 hover:text-neon-cyan hover:border-neon-cyan/30 transition-colors"
                title="Search across all conversations (⌘K)"
              >
                <Search className="w-3 h-3" />
                <span>Search</span>
              </button>
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
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="p-2 hover:bg-lattice-bg rounded-lg transition-colors"
                aria-label="Chat options"
              >
                <MoreVertical className="w-5 h-5 text-gray-400" />
              </button>
              <AnimatePresence>
                {showMoreMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full right-0 mt-2 w-48 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl z-50 overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        openGlobalSearch();
                        setShowMoreMenu(false);
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
                        setShowMoreMenu(false);
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
                          setShowMoreMenu(false);
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

          {/* Chat Mode Selector Rail */}
          <div className={cn(isConKay && 'relative z-10')}>
            <ModeSelector activeMode={chatMode} onModeChange={setChatMode} />
          </div>

          {/* Chat Mode Panel — shown when in chat mode */}
          {chatMode === 'chat' && messages.length > 0 && (
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
                  <div className="flex-1 overflow-y-auto relative z-10">
                    {threadItems.map((item, i) => (
                      <div key={item.__kind === 'message' ? item.id : `${item.__kind}-${i}`}>
                        {renderThreadItem(i, item)}
                      </div>
                    ))}
                    <div ref={conkayBottomRef} aria-hidden="true" />
                  </div>
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
            {isStreaming && streamingContent && (
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
            {(sendMutation.isPending || regenerateMutation.isPending) && !isStreaming && (
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
                  {showSlashMenu && filteredSlashCommands.length > 0 && (
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
                              <p className="text-xs text-gray-400">{cmd.description}</p>
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
                        onClick={() => setShowEmojiPicker((prev) => !prev)}
                        className="p-2 text-gray-400 hover:text-white transition-colors"
                        title="Add emoji"
                      >
                        <Smile className="w-5 h-5" />
                      </button>
                      <AnimatePresence>
                        {showEmojiPicker && (
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
                                  setShowEmojiPicker(false);
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
                  {(isStreaming || sendMutation.isPending || regenerateMutation.isPending) ? (
                    <button
                      onClick={() => {
                        chatAbortControllerRef.current?.abort();
                        setIsStreaming(false);
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

              <p className="text-xs text-gray-400 text-center mt-2">
                Messages are saved as DTUs in your local lattice. AI runs through Ollama when
                available.
              </p>
            </div>
          </div>
        </main>

        {/* ── Chat Computational Actions ── */}
        <div className="border-t border-white/10 px-4 py-4 space-y-3">
          <div className="panel p-4">
            <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4 text-neon-yellow" /> Computational Actions
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => handleChatAction('threadSummarize')}
                disabled={chatActionRunning !== null}
                className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-cyan/50 transition-colors disabled:opacity-50"
              >
                {chatActionRunning === 'threadSummarize' ? (
                  <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
                ) : (
                  <MessageSquare className="w-5 h-5 text-neon-cyan" />
                )}
                <span className="text-xs text-gray-300">Thread Summarize</span>
              </button>
              <button
                onClick={() => handleChatAction('participantAnalysis')}
                disabled={chatActionRunning !== null}
                className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-purple/50 transition-colors disabled:opacity-50"
              >
                {chatActionRunning === 'participantAnalysis' ? (
                  <Loader2 className="w-5 h-5 text-neon-purple animate-spin" />
                ) : (
                  <Users className="w-5 h-5 text-neon-purple" />
                )}
                <span className="text-xs text-gray-300">Participant Analysis</span>
              </button>
              <button
                onClick={() => handleChatAction('topicDetection')}
                disabled={chatActionRunning !== null}
                className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-green/50 transition-colors disabled:opacity-50"
              >
                {chatActionRunning === 'topicDetection' ? (
                  <Loader2 className="w-5 h-5 text-neon-green animate-spin" />
                ) : (
                  <BarChart3 className="w-5 h-5 text-neon-green" />
                )}
                <span className="text-xs text-gray-300">Topic Detection</span>
              </button>
            </div>
          </div>

          {/* Thread Summarize Result */}
          {threadSummarizeResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-neon-cyan" /> Thread Summary
                </h3>
                <button
                  onClick={() => setThreadSummarizeResult(null)}
                  className="text-gray-400 hover:text-white"
                aria-label="Xcircle">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 text-sm text-gray-300">
                {!!threadSummarizeResult.summary && (
                  <p className="text-white">{threadSummarizeResult.summary as string}</p>
                )}
                {Array.isArray(threadSummarizeResult.keyPoints) &&
                  (threadSummarizeResult.keyPoints as string[]).length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-gray-400 uppercase tracking-wider">Key Points</p>
                      {(threadSummarizeResult.keyPoints as string[]).map((pt, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-gray-300">
                          <CheckCircle2 className="w-3 h-3 text-neon-cyan flex-shrink-0 mt-0.5" />{' '}
                          {pt}
                        </div>
                      ))}
                    </div>
                  )}
                {threadSummarizeResult.messageCount !== undefined && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="text-sm font-bold text-neon-cyan">
                        {threadSummarizeResult.messageCount as number}
                      </p>
                      <p className="text-[10px] text-gray-400">Messages</p>
                    </div>
                    {threadSummarizeResult.participants !== undefined && (
                      <div className="p-2 bg-lattice-bg rounded text-center">
                        <p className="text-sm font-bold text-neon-purple">
                          {threadSummarizeResult.participants as number}
                        </p>
                        <p className="text-[10px] text-gray-400">Participants</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* Participant Analysis Result */}
          {participantAnalysisResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-neon-purple" /> Participant Analysis
                </h3>
                <button
                  onClick={() => setParticipantAnalysisResult(null)}
                  className="text-gray-400 hover:text-white"
                aria-label="Xcircle">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 text-sm text-gray-300">
                {participantAnalysisResult.totalParticipants !== undefined && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 bg-lattice-bg rounded text-center">
                      <p className="text-sm font-bold text-neon-purple">
                        {participantAnalysisResult.totalParticipants as number}
                      </p>
                      <p className="text-[10px] text-gray-400">Total</p>
                    </div>
                    {participantAnalysisResult.activeParticipants !== undefined && (
                      <div className="p-2 bg-lattice-bg rounded text-center">
                        <p className="text-sm font-bold text-neon-green">
                          {participantAnalysisResult.activeParticipants as number}
                        </p>
                        <p className="text-[10px] text-gray-400">Active</p>
                      </div>
                    )}
                    {participantAnalysisResult.engagementScore !== undefined && (
                      <div className="p-2 bg-lattice-bg rounded text-center">
                        <p className="text-sm font-bold text-neon-cyan">
                          {participantAnalysisResult.engagementScore as number}
                        </p>
                        <p className="text-[10px] text-gray-400">Engagement</p>
                      </div>
                    )}
                  </div>
                )}
                {Array.isArray(participantAnalysisResult.participants) &&
                  (participantAnalysisResult.participants as Array<Record<string, unknown>>)
                    .length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-gray-400 uppercase tracking-wider">
                        Top Participants
                      </p>
                      {(participantAnalysisResult.participants as Array<Record<string, unknown>>)
                        .slice(0, 5)
                        .map((p, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between text-xs bg-lattice-bg rounded px-2 py-1"
                          >
                            <span className="text-gray-300">{p.name as string}</span>
                            <span className="text-neon-purple">
                              {p.messageCount as number} msgs
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
              </div>
            </motion.div>
          )}

          {/* Topic Detection Result */}
          {topicDetectionResult && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-white flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-neon-green" /> Topic Detection
                </h3>
                <button
                  onClick={() => setTopicDetectionResult(null)}
                  className="text-gray-400 hover:text-white"
                aria-label="Xcircle">
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 text-sm text-gray-300">
                {!!topicDetectionResult.primaryTopic && (
                  <div className="p-2 bg-neon-green/10 border border-neon-green/30 rounded">
                    <p className="text-xs text-gray-400 mb-0.5">Primary Topic</p>
                    <p className="text-white font-medium">
                      {topicDetectionResult.primaryTopic as string}
                    </p>
                  </div>
                )}
                {Array.isArray(topicDetectionResult.topics) &&
                  (topicDetectionResult.topics as Array<Record<string, unknown>>).length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-gray-400 uppercase tracking-wider">
                        Detected Topics
                      </p>
                      {(topicDetectionResult.topics as Array<Record<string, unknown>>).map(
                        (t, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between text-xs bg-lattice-bg rounded px-2 py-1"
                          >
                            <span className="text-gray-300">{t.topic as string}</span>
                            <span className="text-neon-green">
                              {typeof t.confidence === 'number'
                                ? `${Math.round((t.confidence as number) * 100)}%`
                                : (t.confidence as string)}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                {Array.isArray(topicDetectionResult.keywords) &&
                  (topicDetectionResult.keywords as string[]).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(topicDetectionResult.keywords as string[]).map((kw, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-2 py-0.5 bg-neon-green/10 text-neon-green rounded-full"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
              </div>
            </motion.div>
          )}
        </div>

        {/* Lens Features */}
        <div className="border-t border-white/10">
          <button
            onClick={() => setShowFeatures(!showFeatures)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
          >
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Lens Features & Capabilities
            </span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
            />
          </button>
          {showFeatures && (
            <div className="px-4 pb-4 space-y-4">
              <LensFeaturePanel lensId="chat" />
              {/* Lens Recommender — suggest relevant lenses based on chat context */}
              {lensRecommendations.length > 0 && (
                <div className="p-3 rounded-lg border border-neon-purple/20 bg-neon-purple/5 space-y-2">
                  <p className="text-xs font-semibold text-neon-purple flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    Suggested Lenses
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {lensRecommendations.map((rec) => (
                      <button
                        key={rec.lensId}
                        onClick={() => {
                          recordLensOpened(
                            lensTelemetry.current,
                            rec.lensId,
                            lensSessionCtx.current.currentTurn
                          );
                          window.location.href = `/lenses/${rec.lensId}`;
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-lattice-surface border border-lattice-border hover:border-neon-purple/50 transition-colors text-left group"
                      >
                        <span className="text-xs font-medium text-white group-hover:text-neon-purple transition-colors">
                          {rec.name}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {Math.round(rec.score * 100)}%
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400">
                    Based on your current conversation context
                  </p>
                </div>
              )}
              {/* Atlas Viewer — spatial/material data overview */}
              <AtlasViewer type="overview" />
            </div>
          )}
        </div>
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

      {/* Systems drawer — shield / mesh / intel / privacy / initiatives.
          Slides in from the right edge; lazy-fetches per-tab. */}
      <AnimatePresence>
        {systemsPanelOpen && (
          <motion.div
            initial={{ x: 420, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 420, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed top-20 right-4 bottom-4 w-[28rem] z-50 flex flex-col bg-lattice-surface border border-lattice-border rounded-lg shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-neon-purple" />
                <span className="text-sm font-semibold text-white">Systems</span>
              </div>
              <button
                onClick={() => setSystemsPanelOpen(false)}
                className="text-gray-400 hover:text-white transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* Tabs */}
            <div className="flex gap-1 px-3 py-2 border-b border-lattice-border overflow-x-auto">
              {(
                [
                  { key: 'shield', label: 'Shield' },
                  { key: 'mesh', label: 'Mesh' },
                  { key: 'intel', label: 'Intel' },
                  { key: 'privacy', label: 'Privacy' },
                  { key: 'initiatives', label: 'Initiatives' },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setSystemsTab(t.key)}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                    systemsTab === t.key
                      ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                      : 'text-gray-400 hover:text-white hover:bg-lattice-bg'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-3">
              {systemsTab === 'shield' && (
                <ShieldCard type="score" securityScore={shieldData as never} />
              )}
              {systemsTab === 'mesh' && (
                <MeshStatusCard type="status" metrics={meshData as never} />
              )}
              {systemsTab === 'intel' && (
                <IntelligenceCard type="overview" metrics={intelData as never} />
              )}
              {systemsTab === 'privacy' && (
                <AtlasPrivacyMonitor data={privacyData as never} loading={!privacyData} />
              )}
              {systemsTab === 'initiatives' && (
                <div className="space-y-2">
                  {Array.isArray(initiativesData) && initiativesData.length > 0 ? (
                    initiativesData.slice(0, 8).map((init: Initiative) => (
                      <InitiativeChip
                        key={init.id}
                        initiative={init}
                        onDismiss={(id: string) => {
                          try {
                            api.post(`/api/initiative/${encodeURIComponent(id)}/dismiss`, {});
                          } catch {
                            /* non-fatal */
                          }
                        }}
                        onAction={(id: string, action: string) => {
                          try {
                            api.post(`/api/initiative/${encodeURIComponent(id)}/respond`, {
                              response: action || 'acted',
                            });
                          } catch {
                            /* non-fatal */
                          }
                        }}
                        onRespond={(id: string) => {
                          try {
                            api.post(`/api/initiative/${encodeURIComponent(id)}/respond`, {
                              response: 'engaged',
                            });
                          } catch {
                            /* non-fatal */
                          }
                        }}
                      />
                    ))
                  ) : (
                    <p className="text-xs text-gray-400 text-center py-8">
                      No proactive initiatives right now. Claude will surface them here when
                      opportunities arise.
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
        className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-500 hover:bg-amber-400 text-amber-50 shadow-2xl ring-2 ring-amber-700/30 text-sm font-medium"
        title="Agent Mode — give Concord a task. It will use any of 200+ apps + web + compute to complete it."
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8V4H8M4 8h4v4M16 4v4h4M20 16h-4v4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Agent Mode
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
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <HackerNewsReference />
      </section>
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
        // Close everything first so the active panel is unambiguous.
        setChatSidebarOpen(false);
        setThreadSearchOpen(false);
        setToolPaletteOpen(false);
        setScheduledPanelOpen(false);
        if (id === 'convos')    setChatSidebarOpen(true);
        if (id === 'threads')   setThreadSearchOpen(true);
        if (id === 'tools')     setToolPaletteOpen(true);
        if (id === 'scheduled') setScheduledPanelOpen(true);
        // 'projects' tab opens the convos sidebar — projects live inside it.
        if (id === 'projects')  setChatSidebarOpen(true);
        // 'chat' just closes everything, restoring focus to the input.
      }}
    />
    </LensShell>
  );
}

// ── Tool trace block ─────────────────────────────────────────────────────────

interface ToolTraceBlockProps {
  trace: {
    id: string;
    domain: string;
    action: string;
    result: unknown;
    error?: string;
    createdAt: string;
  };
}

function ToolTraceBlock({ trace }: ToolTraceBlockProps) {
  const [open, setOpen] = useState(false);
  const failed = !!trace.error || (typeof trace.result === 'object' && trace.result && 'ok' in trace.result && (trace.result as { ok?: boolean }).ok === false);
  return (
    <div
      className={cn(
        'flex gap-4',
        // Match the Concord-side message shape; trace is "Concord did a thing"
      )}
    >
      <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center flex-shrink-0">
        <Hammer className="w-4 h-4 text-cyan-300" aria-hidden="true" />
      </div>
      <div className="flex-1 max-w-2xl">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-mono',
            failed
              ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
              : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
            'hover:brightness-110'
          )}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {trace.domain}.{trace.action}
          <span className="ml-1 text-[10px] opacity-70">
            {failed ? 'failed' : 'ok'}
          </span>
        </button>
        {open && (
          <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-lattice-border bg-black/60 p-3 text-[11px] font-mono text-gray-300">
            {trace.error
              ? trace.error
              : JSON.stringify(trace.result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
