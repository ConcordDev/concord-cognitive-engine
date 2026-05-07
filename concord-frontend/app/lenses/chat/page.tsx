'use client';

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { useLensNav } from '@/hooks/useLensNav';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
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
import { SharedSessionChat } from '@/components/social/SharedSessionChat';

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
  icon: React.ElementType;
  description: string;
}

interface Persona {
  id: string;
  name: string;
  icon: React.ElementType;
  description: string;
  systemPrompt: string;
}

interface SlashCommand {
  command: string;
  label: string;
  description: string;
  icon: React.ElementType;
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
  const [selectedConversation, setSelectedConversation] = useState<string | null>(() => loadSessionId());
  const [aiMode, setAiMode] = useState<AIMode>(AI_MODES[0]);
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [localMessages, setLocalMessages] = useState<Message[]>([]);
  const [feedbackState, setFeedbackState] = useState<Record<string, 'up' | 'down'>>({});
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState('');
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const [storedConversations, setStoredConversations] = useState<Conversation[]>(() => loadConversations());

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

  // Load messages from localStorage when switching conversations
  useEffect(() => {
    if (selectedConversation) {
      const saved = loadMessagesForSession(selectedConversation);
      setLocalMessages(saved);
    }
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
        setStoredConversations(prev => {
          const next = [newConv, ...prev];
          saveConversations(next);
          return next;
        });
        setSelectedConversation(newId);
        // Save the user message for this new session right away
        saveMessagesForSession(newId, [userMsg]);
      }
      setLocalMessages(prev => [...prev, userMsg]);

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
            mode: aiMode.id,
            sessionId: activeSessionId,
            ...(systemPrompt ? { systemPrompt } : {}),
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
        const response = await api.post('/api/chat', {
          message: messageContent,
          mode: aiMode.id,
          sessionId: activeSessionId,
          ...(systemPrompt ? { systemPrompt } : {}),
          ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
        });
        return response.data;
      }
    },
    onSuccess: (data) => {
      // If a tool was executed, include it in the response metadata
      const toolInfo = data.toolExecution?.executed
        ? `\n\n> 🔧 **Tool:** \`${data.toolExecution.domain}.${data.toolExecution.action}\`${data.toolExecution.result?.ok ? ' — Success' : ' — Failed'}`
        : '';

      const assistantMsg: Message = {
        id: `asst-${Date.now()}`,
        role: 'assistant',
        content: (data.reply || data.answer || data.content || data.text || data.response || (data.error ? `Error: ${data.error}` : 'The conscious brain is not responding. Check that the Ollama service is running.')) + toolInfo,
        timestamp: new Date().toISOString(),
        refs: data.refs,
        sources: data.sources as Message['sources'],
        webAugmented: !!data.webAugmented,
        toolCalls: Array.isArray(data.toolCalls)
          ? (data.toolCalls as Message['toolCalls'])
          : undefined,
        reasoningSessionId:
          typeof data.reasoningSessionId === 'string' ? data.reasoningSessionId : undefined,
        wasSynthesized: !!data.wasSynthesized,
        shadowsUsed: typeof data.shadowsUsed === 'number' ? data.shadowsUsed : undefined,
      };

      setLocalMessages(prev => [...prev, assistantMsg]);

      // Update conversation registry metadata
      if (selectedConversation) {
        setStoredConversations(prev => {
          const next = prev.map(c =>
            c.id === selectedConversation
              ? { ...c, lastMessage: (assistantMsg.content || '').slice(0, 100), updatedAt: new Date().toISOString(), messageCount: c.messageCount + 2 }
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
      setLocalMessages(prev => [...prev, errorMsg]);
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
      setLocalMessages(prev => {
        const lastAssistantIdx = [...prev].reverse().findIndex(m => m.role === 'assistant');
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
      setLocalMessages(prev => [...prev, errorMsg]);
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
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
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
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
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
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
    onSuccess: (deletedId: string) => {
      deleteMessagesForSession(deletedId);
      setStoredConversations(prev => {
        const next = prev.filter(c => c.id !== deletedId);
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

  const handleSend = useCallback(() => {
    if (!input.trim() || sendMutation.isPending) return;

    // Check for slash commands
    if (input.trim().startsWith('/')) {
      executeSlashCommand(input);
      return;
    }

    sendMutation.mutate(input);
  }, [input, sendMutation, executeSlashCommand]);

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

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showSlashMenu, filteredSlashCommands, slashSelectedIndex, handleSend, executeSlashCommand]
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

  const renderMessage = useCallback((msgIdx: number, message: Message) => {
    const isPinned = pinnedMessages.has(message.id) || message.pinned;
    const timeStr = message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className={cn(
          'flex gap-4 px-4 lg:px-6 py-3 group relative',
          message.role === 'user' ? 'flex-row-reverse' : '',
          isPinned && 'bg-yellow-500/5 border-l-2 border-l-yellow-500/50'
        )}
      >
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg',
          message.role === 'user'
            ? 'bg-gradient-to-br from-neon-purple to-purple-700'
            : 'bg-gradient-to-br from-neon-cyan/30 to-cyan-900/40 ring-1 ring-neon-cyan/20'
        )}>
          {message.role === 'user' ? (
            <User className="w-5 h-5 text-white" />
          ) : (
            <Bot className="w-5 h-5 text-neon-cyan" />
          )}
        >
          <div
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg',
              message.role === 'user'
                ? 'bg-neon-purple/10 border-neon-purple/30 ml-auto'
                : 'bg-lattice-bg border-lattice-border'
            )}>
              <div className="flex items-center gap-1 mb-1 text-gray-500">
                <Quote className="w-3 h-3" />
                <span>Replying to</span>
              </div>
              <p className="truncate">{message.quotedContent}</p>
            </div>
          )}

          <div className={cn(
            'inline-block p-4 rounded-2xl shadow-sm',
            message.role === 'user'
              ? 'bg-gradient-to-br from-neon-purple to-purple-700 text-white rounded-br-md'
              : message.role === 'system'
                ? 'bg-red-500/10 border border-red-500/30 text-red-300 rounded-bl-md'
                : 'bg-lattice-surface border border-lattice-border text-gray-200 rounded-bl-md hover:border-lattice-border/80 transition-colors'
          )}>
            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>

            {/* Attachment chips on user messages */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-1.5">
                {message.attachments.map((att, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 bg-white/10 rounded text-xs">
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
                        <p className="text-xs text-neon-cyan/90 truncate group-hover/src:text-neon-cyan">{src.title}</p>
                        <p className="text-[10px] text-gray-500 truncate">{src.source}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
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
                <div className="flex items-center gap-1 mb-1 text-gray-500">
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
                {timeStr && <p className="text-[10px] text-gray-500 mt-1 select-none">{timeStr}</p>}
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
                ) : (
                  <MessageRenderer content={message.content} />
                )}
                {timeStr && editingMessageId !== message.id && (
                  <p className="text-[10px] text-gray-500 mt-1 select-none">{timeStr}</p>
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
                            <p className="text-[10px] text-gray-500 truncate">{src.source}</p>
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
                'flex items-center gap-2 mt-2 text-xs text-gray-500',
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
        </div>
      </motion.div>
    );
  }, [feedbackState, feedbackMutation, forgeMutation, regenerateMutation, handleRegenerate, copyToClipboard, formatTime, pinnedMessages, copiedMessageId, togglePin, quoteMessage]);

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
        <ErrorState error={error?.message} onRetry={() => { refetch(); }} />
      </div>
    );
  }

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────

  return (
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
          onClick={() => setChatSidebarOpen(false)}
        />
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
            <button
              className="p-2 hover:bg-lattice-bg rounded-lg transition-colors"
              aria-label="Chat settings"
              onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Use the mode selector in the chat rail to configure chat behavior' })}
            >
              <Settings className="w-5 h-5 text-gray-400" />
            </button>
          </div>
          <button
            onClick={() => { startNewChat(); setChatSidebarOpen(false); }}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
        </div>

        {/* DTU Context */}
        <div className="p-3 border-t border-white/10 space-y-3">
          <ArtifactUploader lens="chat" acceptTypes="*/*" multi compact onUploadComplete={() => refetchDTUs()} />
          <LensContextPanel
            hyperDTUs={hyperDTUs}
            megaDTUs={megaDTUs}
            regularDTUs={regularDTUs}
            tierDistribution={tierDistribution}
            onPublish={(dtu) => publishToMarketplace({ dtuId: dtu.id })}
            title="Chat DTUs"
            className="!bg-transparent !border-0 !p-0"
          />
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

        <div className="flex-1 overflow-y-auto" role="list" aria-label="Conversations">
          {filteredConversations.length === 0 && (
            <div className="p-6 text-center text-gray-500 text-sm">
              {conversationSearch ? 'No matching conversations' : 'No conversations yet. Start a new chat!'}
            </div>
          )}
          {filteredConversations.map((conv: Conversation) => (
            <div
              key={conv.id}
              className={cn(
                'group relative w-full p-4 text-left hover:bg-lattice-bg transition-colors border-b border-lattice-border/50 cursor-pointer',
                selectedConversation === conv.id && 'bg-neon-cyan/10 border-l-2 border-l-neon-cyan'
              )}
              role="listitem"
              aria-current={selectedConversation === conv.id ? 'true' : undefined}
              onClick={() => { setSelectedConversation(conv.id); setChatSidebarOpen(false); }}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
                  selectedConversation === conv.id ? 'bg-neon-cyan/20' : 'bg-lattice-bg'
                )}>
                  <MessageSquare className={cn(
                    'w-5 h-5',
                    selectedConversation === conv.id ? 'text-neon-cyan' : 'text-gray-400'
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-medium text-white truncate text-sm">{conv.title}</h3>
                    <span className="text-[10px] text-gray-500 whitespace-nowrap flex-shrink-0">
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate mt-0.5">{conv.lastMessage || 'No messages'}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-gray-500">{conv.messageCount} message{conv.messageCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>
              {/* Delete button - visible on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversationMutation.mutate(conv.id);
                }}
                disabled={deleteConversationMutation.isPending}
                className="absolute top-3 right-3 p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all"
                title="Delete conversation"
                aria-label={`Delete conversation: ${conv.title}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </aside>

          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
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
              <div className="p-6 text-center text-gray-500 text-sm">
                {conversationSearch
                  ? 'No matching conversations'
                  : 'No conversations yet. Start a new chat!'}
              </div>
            )}
          </div>

          {/* Cognitive Status Bar */}
          {cogStatus && (
            <div className="hidden md:flex items-center gap-4 text-xs">
              {exp && (
                <div className="flex items-center gap-1.5 text-gray-400" title={`${exp.episodes} episodes, ${exp.patterns} patterns learned`}>
                  <Brain className="w-3.5 h-3.5 text-neon-purple" />
                  <span>{exp.patterns} patterns</span>
                </div>
              )}
              {attn && (
                <div className="flex items-center gap-1.5 text-gray-400" title={`${attn.activeThreads} active threads`}>
                  <Eye className="w-3.5 h-3.5 text-neon-cyan" />
                  <span>{attn.activeThreads} threads</span>
                </div>
              )}
              {refl && (
                <div className="flex items-center gap-1.5" title={`Self-calibration: ${((refl.calibration || 0) * 100).toFixed(0)}%`}>
                  <Activity className={`w-3.5 h-3.5 ${(refl.calibration || 0) > 0.6 ? 'text-neon-green' : 'text-yellow-400'}`} />
                  <span className={`${(refl.calibration || 0) > 0.6 ? 'text-neon-green' : 'text-yellow-400'}`}>
                    {((refl.calibration || 0) * 100).toFixed(0)}%
                  </span>
                </div>
              )}
              {refl?.strengths?.length > 0 && (
                <div className="flex items-center gap-1 text-neon-green" title={`Strengths: ${refl.strengths.join(', ')}`}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 relative">
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
                    onClick={handleExportChat}
                    disabled={messages.length === 0}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    Export Chat
                  </button>
                  <button
                    onClick={() => { startNewChat(); setShowMoreMenu(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors"
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
                      <RefreshCw className={`w-4 h-4 ${deleteConversationMutation.isPending ? 'animate-spin' : ''}`} />
                      {deleteConversationMutation.isPending ? 'Deleting...' : 'Delete Conversation'}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-hidden flex flex-col" role="log" aria-label="Chat messages" aria-live="polite">
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
              >Yo. What&apos;s the move?</motion.h2>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25, duration: 0.4 }}
                className="text-gray-400 max-w-md mb-8"
              >
                Pick a direction or ask me anything. Everything we talk about becomes knowledge in your lattice.
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
                ].map(suggestion => (
                  <button
                    key={suggestion.label}
                    onClick={() => setInput(suggestion.label)}
                    className="flex items-start gap-3 p-4 bg-lattice-surface border border-lattice-border rounded-xl hover:border-neon-cyan/50 hover:bg-lattice-surface/80 transition-all text-left group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-neon-cyan/10 flex items-center justify-center flex-shrink-0 group-hover:bg-neon-cyan/20 transition-colors">
                      <suggestion.icon className="w-4.5 h-4.5 text-neon-cyan" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-white block">{suggestion.label}</span>
                      <span className="text-xs text-gray-500">{suggestion.desc}</span>
                    </div>
                  </button>
                ))}
              </motion.div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.4 }}
                className="text-xs text-gray-500 mt-6"
              >
                Type <code className="px-1.5 py-0.5 bg-lattice-surface rounded text-gray-400">/help</code> for slash commands &middot; <code className="px-1.5 py-0.5 bg-lattice-surface rounded text-gray-400">/forge</code> to create DTUs
              </motion.p>
            </div>
          )}

          {messages.length > 0 && (
            <Virtuoso
              data={messages}
              followOutput="smooth"
              initialTopMostItemIndex={messages.length - 1}
              className="flex-1"
              itemContent={renderMessage}
            />
          )}

          {/* Streaming indicator */}
          {isStreaming && streamingContent && (
            <div className="flex gap-4 px-4 lg:px-6 pb-2">
              <div className="w-10 h-10 rounded-lg bg-neon-cyan/20 flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-neon-cyan animate-pulse" />
              </div>
              <div className="flex-1 max-w-2xl">
                <div className="inline-block p-4 rounded-2xl rounded-bl-md bg-lattice-surface border border-neon-cyan/30 text-gray-200">
                  <p className="whitespace-pre-wrap">{streamingContent}</p>
                  <span className="inline-block w-2 h-4 bg-neon-cyan/60 animate-pulse ml-0.5" />
                </div>
              </div>
            </div>
          )}

          {/* Thinking indicator (when not streaming) */}
          {(sendMutation.isPending || regenerateMutation.isPending) && !isStreaming && (
            <div className="flex gap-4 px-4 lg:px-6 pb-2" role="status" aria-label="AI is thinking">
              <div className="w-10 h-10 rounded-lg bg-neon-cyan/20 flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-neon-cyan animate-pulse" />
              </div>
              <div className="flex-1 max-w-2xl">
                <div className="inline-block p-4 rounded-2xl rounded-bl-md bg-lattice-surface border border-lattice-border">
                  <div className="flex items-center gap-2 text-gray-400">
                    <div className="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-neon-cyan rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="sr-only">AI is generating a response...</span>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-lattice-border bg-lattice-surface">
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
                {attachments.map(att => (
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
                      <span className="text-[10px] text-gray-500 whitespace-nowrap flex-shrink-0">
                        {formatRelativeTime(conv.updatedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 truncate mt-0.5">
                      {conv.lastMessage || 'No messages'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-gray-500">
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
                    className="p-1.5 rounded-md hover:bg-lattice-bg text-gray-500 hover:text-white transition-colors"
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
                    className="p-1.5 rounded-md hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
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
        <main className="flex-1 flex flex-col" aria-label="Chat messages">
          <header className="px-4 lg:px-6 py-4 border-b border-lattice-border flex items-center justify-between bg-lattice-surface">
            <div className="flex items-center gap-3 lg:gap-4">
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
                      onClick={handleExportChat}
                      disabled={messages.length === 0}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors disabled:opacity-50"
                    >
                      <Download className="w-4 h-4" />
                      Export Chat
                    </button>
                    <button
                      onClick={() => {
                        startNewChat();
                        setShowMoreMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-200 hover:bg-lattice-bg transition-colors"
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
          <ModeSelector activeMode={chatMode} onModeChange={setChatMode} />

          {/* Chat Mode Panel — shown when in chat mode */}
          {chatMode === 'chat' && messages.length > 0 && (
            <div className="px-4 py-2 border-b border-lattice-border/30">
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
            className="flex-1 overflow-hidden flex flex-col"
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
                        <span className="text-xs text-gray-500">{suggestion.desc}</span>
                      </div>
                    </button>
                  ))}
                </motion.div>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6, duration: 0.4 }}
                  className="text-xs text-gray-500 mt-6"
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

            {messages.length > 0 && (
              <Virtuoso
                data={messages}
                followOutput="smooth"
                initialTopMostItemIndex={messages.length - 1}
                className="flex-1"
                itemContent={renderMessage}
              />
            )}

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
          <div className="p-4 border-t border-lattice-border bg-lattice-surface">
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
                      <span className="text-gray-500 text-xs">{formatBytes(att.size)}</span>
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
                      <div className="p-2 border-t border-lattice-border text-xs text-gray-500 flex items-center gap-3">
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
                  <button
                    onClick={handleSend}
                    disabled={(!input.trim() && attachments.length === 0) || sendMutation.isPending}
                    className="p-4 bg-neon-cyan text-black rounded-2xl hover:bg-neon-cyan/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <p className="text-xs text-gray-500 text-center mt-2">
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
                >
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
                      <p className="text-xs text-gray-500 uppercase tracking-wider">Key Points</p>
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
                      <p className="text-[10px] text-gray-500">Messages</p>
                    </div>
                    {threadSummarizeResult.participants !== undefined && (
                      <div className="p-2 bg-lattice-bg rounded text-center">
                        <p className="text-sm font-bold text-neon-purple">
                          {threadSummarizeResult.participants as number}
                        </p>
                        <p className="text-[10px] text-gray-500">Participants</p>
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
                >
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
                      <p className="text-[10px] text-gray-500">Total</p>
                    </div>
                    {participantAnalysisResult.activeParticipants !== undefined && (
                      <div className="p-2 bg-lattice-bg rounded text-center">
                        <p className="text-sm font-bold text-neon-green">
                          {participantAnalysisResult.activeParticipants as number}
                        </p>
                        <p className="text-[10px] text-gray-500">Active</p>
                      </div>
                    )}
                    {participantAnalysisResult.engagementScore !== undefined && (
                      <div className="p-2 bg-lattice-bg rounded text-center">
                        <p className="text-sm font-bold text-neon-cyan">
                          {participantAnalysisResult.engagementScore as number}
                        </p>
                        <p className="text-[10px] text-gray-500">Engagement</p>
                      </div>
                    )}
                  </div>
                )}
                {Array.isArray(participantAnalysisResult.participants) &&
                  (participantAnalysisResult.participants as Array<Record<string, unknown>>)
                    .length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">
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
                >
                  <XCircle className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2 text-sm text-gray-300">
                {!!topicDetectionResult.primaryTopic && (
                  <div className="p-2 bg-neon-green/10 border border-neon-green/30 rounded">
                    <p className="text-xs text-gray-500 mb-0.5">Primary Topic</p>
                    <p className="text-white font-medium">
                      {topicDetectionResult.primaryTopic as string}
                    </p>
                  </div>
                )}
                {Array.isArray(topicDetectionResult.topics) &&
                  (topicDetectionResult.topics as Array<Record<string, unknown>>).length > 0 && (
                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-gray-500 uppercase tracking-wider">
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
                        <span className="text-[10px] text-gray-500">
                          {Math.round(rec.score * 100)}%
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500">
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
                    <p className="text-xs text-gray-500 text-center py-8">
                      No proactive initiatives right now. Claude will surface them here when
                      opportunities arise.
                    </p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
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
    </div>
  );
}
