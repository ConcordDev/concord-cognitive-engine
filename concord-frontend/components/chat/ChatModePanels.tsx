'use client';

/**
 * ChatModePanels — Sub-components rendered inside the Chat Rail
 * based on the active ChatMode.
 *
 * Each panel provides mode-specific UI above the message history:
 *   WelcomePanel  — Personalized greeting, quick actions, activity summary
 *   AssistPanel   — Task-focused buttons, workflow guidance
 *   ExplorePanel  — Discovery prompts, trending topics, "Surprise me"
 *   ConnectPanel  — Shared sessions, collaboration tools
 *   ChatPanel     — (Minimal, the default experience)
 */

import { useState } from 'react';
import {
  Sparkles,
  Sun,
  Moon,
  Sunrise,
  Sunset,
  FileText,
  Search,
  Play,
  BarChart3,
  Compass,
  Shuffle,
  TrendingUp,
  Link2,
  Users,
  UserPlus,
  Radio,
  Lightbulb,
  Zap,
  Database,
  BookOpen,
  MessageSquare,
  Eye,
  Hammer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMode } from './ChatModeTypes';

// ── Shared types ────────────────────────────────────────────────

interface ModePanelProps {
  currentLens: string;
  onSendMessage: (content: string) => void;
  onLensNavigate?: (domain: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────

function getTimeIcon() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return <Sunrise className="w-5 h-5 text-amber-400" />;
  if (hour >= 8 && hour < 17) return <Sun className="w-5 h-5 text-yellow-400" />;
  if (hour >= 17 && hour < 20) return <Sunset className="w-5 h-5 text-orange-400" />;
  return <Moon className="w-5 h-5 text-indigo-400" />;
}

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'Burning the midnight oil';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Burning the midnight oil';
}

// ── Quick Action Button ─────────────────────────────────────────

function QuickActionButton({
  label,
  icon: Icon,
  color = 'neon-cyan',
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium',
        'border transition-all duration-200',
        'hover:scale-[1.02] active:scale-[0.98]',
        color === 'neon-cyan' && 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/20',
        color === 'neon-blue' && 'bg-neon-blue/10 border-neon-blue/30 text-neon-blue hover:bg-neon-blue/20',
        color === 'neon-purple' && 'bg-neon-purple/10 border-neon-purple/30 text-neon-purple hover:bg-neon-purple/20',
        color === 'neon-pink' && 'bg-neon-pink/10 border-neon-pink/30 text-neon-pink hover:bg-neon-pink/20',
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

// ── Welcome Panel ───────────────────────────────────────────────

export function WelcomePanel({ currentLens, onSendMessage }: ModePanelProps) {
  return (
    <div className="px-3 py-4 space-y-4">
      {/* Greeting */}
      <div className="flex items-center gap-3">
        {getTimeIcon()}
        <div>
          <h3 className="text-sm font-semibold text-white">{getTimeGreeting()}</h3>
          <p className="text-xs text-zinc-500">
            Your conversation context carries across all lenses
          </p>
        </div>
      </div>

      {/* Quick action buttons */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium">
          Quick actions
        </p>
        <div className="flex flex-wrap gap-2">
          <QuickActionButton
            label="What's new?"
            icon={Sparkles}
            color="neon-cyan"
            onClick={() => onSendMessage('What\'s new in my substrate since my last visit?')}
          />
          <QuickActionButton
            label="Show my DTUs"
            icon={Database}
            color="neon-blue"
            onClick={() => onSendMessage('Show me my recent DTUs and their status')}
          />
          <QuickActionButton
            label="Today's insights"
            icon={Lightbulb}
            color="neon-purple"
            onClick={() => onSendMessage('What insights do you have for me today based on my knowledge base?')}
          />
        </div>
      </div>

      {/* Lens context */}
      {currentLens && (
        <div className="p-2.5 rounded-lg bg-lattice-elevated border border-lattice-border">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Compass className="w-3 h-3 text-neon-cyan" />
            <span>Currently in <span className="text-neon-cyan font-medium">{currentLens}</span> lens</span>
          </div>
        </div>
      )}

      {/* Proactive suggestion placeholder */}
      <div className="p-2.5 rounded-lg bg-neon-cyan/5 border border-neon-cyan/20">
        <p className="text-xs text-zinc-400">
          <Zap className="w-3 h-3 text-neon-cyan inline mr-1" />
          I can help you create DTUs, search your knowledge base, run pipelines, or explore connections across your lenses.
        </p>
      </div>
    </div>
  );
}

// ── Assist Panel ────────────────────────────────────────────────

export function AssistPanel({ currentLens, onSendMessage }: ModePanelProps) {
  return (
    <div className="px-3 py-4 space-y-4">
      {/* Mode header */}
      <div className="p-2.5 rounded-lg bg-neon-blue/5 border border-neon-blue/20">
        <p className="text-xs text-neon-blue font-medium mb-1">Task Assistant Mode</p>
        <p className="text-[11px] text-zinc-500">
          I'm here to help you accomplish tasks. Select an action or describe what you need.
        </p>
      </div>

      {/* Action buttons grid */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium">
          Common operations
        </p>
        <div className="grid grid-cols-2 gap-2">
          <QuickActionButton
            label="Create DTU"
            icon={FileText}
            color="neon-blue"
            onClick={() => onSendMessage(`Create a new DTU in the ${currentLens} lens. Ask me what content to include.`)}
          />
          <QuickActionButton
            label="Search Knowledge"
            icon={Search}
            color="neon-blue"
            onClick={() => onSendMessage('Search my knowledge base. What would you like to find?')}
          />
          <QuickActionButton
            label="Run Pipeline"
            icon={Play}
            color="neon-blue"
            onClick={() => onSendMessage('What pipelines are available for me to run right now?')}
          />
          <QuickActionButton
            label="Generate Report"
            icon={BarChart3}
            color="neon-blue"
            onClick={() => onSendMessage(`Generate a report summarizing my ${currentLens} data and recent activity`)}
          />
        </div>
      </div>

      {/* Context-aware suggestion */}
      <div className="p-2.5 rounded-lg bg-lattice-elevated border border-lattice-border">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Lightbulb className="w-3 h-3 text-neon-blue" />
          <span>Context-aware for <span className="text-neon-blue font-medium">{currentLens}</span> lens</span>
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">
          Actions are scoped to your current lens context. I can also work across lenses if needed.
        </p>
      </div>
    </div>
  );
}

// ── Explore Panel ───────────────────────────────────────────────

export function ExplorePanel({ currentLens, onSendMessage }: ModePanelProps) {
  const [surpriseLoading, setSurpriseLoading] = useState(false);

  const handleSurprise = () => {
    setSurpriseLoading(true);
    setTimeout(() => setSurpriseLoading(false), 500);
    const prompts = [
      'Show me an unexpected connection between two different areas of my knowledge',
      'What\'s the most surprising pattern you can find in my substrate?',
      'Connect two seemingly unrelated DTUs and explain why they matter together',
      'What knowledge gap would be most valuable for me to fill right now?',
      'Find a cross-domain insight I haven\'t noticed yet',
    ];
    const pick = prompts[Math.floor(Math.random() * prompts.length)];
    onSendMessage(pick);
  };

  return (
    <div className="px-3 py-4 space-y-4">
      {/* Mode header */}
      <div className="p-2.5 rounded-lg bg-neon-purple/5 border border-neon-purple/20">
        <p className="text-xs text-neon-purple font-medium mb-1">Explore Mode</p>
        <p className="text-[11px] text-zinc-500">
          Discover knowledge, find connections, and explore the unknown.
        </p>
      </div>

      {/* Discovery buttons */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium">
          Discovery prompts
        </p>
        <div className="flex flex-wrap gap-2">
          <QuickActionButton
            label="Trending Topics"
            icon={TrendingUp}
            color="neon-purple"
            onClick={() => onSendMessage('What topics are trending in my substrate? Show activity and growth patterns.')}
          />
          <QuickActionButton
            label="Cross-Domain Links"
            icon={Link2}
            color="neon-purple"
            onClick={() => onSendMessage('Show me the most interesting cross-domain connections in my knowledge base')}
          />
          <QuickActionButton
            label="Knowledge Gaps"
            icon={BookOpen}
            color="neon-purple"
            onClick={() => onSendMessage('What knowledge gaps exist in my substrate that I should consider filling?')}
          />
        </div>
      </div>

      {/* Surprise me button */}
      <button
        onClick={handleSurprise}
        disabled={surpriseLoading}
        className={cn(
          'w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg',
          'bg-gradient-to-r from-neon-purple/20 to-neon-pink/20',
          'border border-neon-purple/30',
          'text-sm font-medium text-neon-purple',
          'hover:from-neon-purple/30 hover:to-neon-pink/30',
          'transition-all duration-200',
          'disabled:opacity-50',
        )}
      >
        <Shuffle className={cn('w-4 h-4', surpriseLoading && 'animate-spin')} />
        Surprise me
      </button>

      {/* Related suggestion */}
      <div className="p-2.5 rounded-lg bg-lattice-elevated border border-lattice-border">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Compass className="w-3 h-3 text-neon-purple" />
          <span>Exploring from <span className="text-neon-purple font-medium">{currentLens}</span></span>
        </div>
      </div>
    </div>
  );
}

// ── Connect Panel ───────────────────────────────────────────────

export function ConnectPanel({ currentLens, onSendMessage }: ModePanelProps) {
  return (
    <div className="px-3 py-4 space-y-4">
      {/* Mode header */}
      <div className="p-2.5 rounded-lg bg-neon-pink/5 border border-neon-pink/20">
        <p className="text-xs text-neon-pink font-medium mb-1">Connect Mode</p>
        <p className="text-[11px] text-zinc-500">
          Collaborate with others, share sessions, and work together.
        </p>
      </div>

      {/* Collaboration actions */}
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-medium">
          Collaboration tools
        </p>
        <div className="flex flex-wrap gap-2">
          <QuickActionButton
            label="Invite Collaborator"
            icon={UserPlus}
            color="neon-pink"
            onClick={() => onSendMessage(`I want to invite a collaborator to work with me on the "${currentLens}" lens`)}
          />
          <QuickActionButton
            label="Shared Sessions"
            icon={Users}
            color="neon-pink"
            onClick={() => onSendMessage('Show me active shared sessions I can join or my recent collaborative work')}
          />
          <QuickActionButton
            label="Social Feed"
            icon={Radio}
            color="neon-pink"
            onClick={() => onSendMessage('Show me recent social activity and collaboration updates')}
          />
        </div>
      </div>

      {/* Active sessions placeholder */}
      <div className="p-3 rounded-lg bg-lattice-elevated border border-lattice-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Active sessions</span>
          <span className="text-[10px] text-zinc-600">0 live</span>
        </div>
        <p className="text-[11px] text-zinc-600">
          No active shared sessions. Invite someone to start collaborating.
        </p>
      </div>

      {/* Workspace suggestion */}
      <div className="p-2.5 rounded-lg bg-neon-pink/5 border border-neon-pink/20">
        <p className="text-xs text-zinc-400">
          <Lightbulb className="w-3 h-3 text-neon-pink inline mr-1" />
          Collaborative workspaces let you share DTUs, chat in real-time, and co-create artifacts.
        </p>
        <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1.5">
          <Eye className="w-3 h-3 text-neon-pink" />
          <span>Current lens: <span className="text-neon-pink font-medium">{currentLens}</span></span>
        </div>
      </div>
    </div>
  );
}

// ── Chat Panel (minimal) ────────────────────────────────────────

export function ChatPanel({ currentLens }: ModePanelProps) {
  // The chat panel is intentionally minimal — it's the legacy default mode.
  // It only shows when there are 0 messages and the mode is explicitly 'chat'.
  if (!currentLens) return null;
  return (
    <div className="px-3 py-2">
      <div className="p-2 rounded-lg bg-lattice-elevated border border-lattice-border">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <MessageSquare className="w-3 h-3 text-neon-cyan" />
          <span>Chatting in <span className="text-neon-cyan font-medium">{currentLens}</span></span>
        </div>
      </div>
    </div>
  );
}

// ── Mode selector bar ───────────────────────────────────────────

const MODE_ICONS: Record<ChatMode, React.ComponentType<{ className?: string }>> = {
  welcome: Sparkles,
  assist: Zap,
  explore: Compass,
  connect: Users,
  chat: MessageSquare,
};

const MODE_COLORS: Record<ChatMode, string> = {
  welcome: 'neon-cyan',
  assist: 'neon-blue',
  explore: 'neon-purple',
  connect: 'neon-pink',
  chat: 'neon-cyan',
};

const MODE_LABELS: Record<ChatMode, string> = {
  welcome: 'Welcome',
  assist: 'Assist',
  explore: 'Explore',
  connect: 'Connect',
  chat: 'Chat',
};

interface ModeSelectorProps {
  activeMode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

export function ModeSelector({ activeMode, onModeChange }: ModeSelectorProps) {
  const modes: ChatMode[] = ['welcome', 'assist', 'explore', 'connect', 'chat'];

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-lattice-border bg-lattice-surface/50 overflow-x-auto no-scrollbar">
      {modes.map(mode => {
        const Icon = MODE_ICONS[mode];
        const isActive = mode === activeMode;
        const color = MODE_COLORS[mode];

        return (
          <button
            key={mode}
            onClick={() => onModeChange(mode)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium',
              'transition-all duration-200 whitespace-nowrap',
              isActive
                ? cn(
                    color === 'neon-cyan' && 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40',
                    color === 'neon-blue' && 'bg-neon-blue/20 text-neon-blue border border-neon-blue/40',
                    color === 'neon-purple' && 'bg-neon-purple/20 text-neon-purple border border-neon-purple/40',
                    color === 'neon-pink' && 'bg-neon-pink/20 text-neon-pink border border-neon-pink/40',
                  )
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700',
            )}
            title={MODE_LABELS[mode]}
          >
            <Icon className="w-3 h-3" />
            <span className={cn(isActive ? 'inline' : 'hidden sm:inline')}>
              {MODE_LABELS[mode]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Message action buttons ──────────────────────────────────────

interface MessageActionsProps {
  messageContent: string;
  onSendMessage: (content: string) => void;
}

export function MessageActions({ messageContent, onSendMessage }: MessageActionsProps) {
  return (
    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-700/30">
      <button
        onClick={() => onSendMessage(`Save this as a DTU: "${messageContent.slice(0, 100)}..."`)}
        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-zinc-500 hover:text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
        title="Save as DTU"
      >
        <FileText className="w-2.5 h-2.5" />
        Save as DTU
      </button>
      <button
        onClick={() => onSendMessage(`Explore this topic deeper: "${messageContent.slice(0, 80)}"`)}
        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-zinc-500 hover:text-neon-purple hover:bg-neon-purple/10 transition-colors"
        title="Explore deeper"
      >
        <Compass className="w-2.5 h-2.5" />
        Explore deeper
      </button>
    </div>
  );
}

// ── Response action buttons (mode-specific) ─────────────────────

interface ResponseActionsProps {
  mode: ChatMode;
  responseContent: string;
  currentLens: string;
  onSendMessage: (content: string) => void;
  onViewContext?: () => void;
  onForgeDTU?: (content: string) => void;
}

export function ResponseActions({ mode, responseContent, currentLens, onSendMessage, onViewContext, onForgeDTU }: ResponseActionsProps) {
  const getActions = (): { label: string; prompt: string; icon: React.ComponentType<{ className?: string }> }[] => {
    switch (mode) {
      case 'assist':
        return [
          {
            label: 'Create DTU from this',
            prompt: `Create a DTU from this response in ${currentLens}: "${responseContent.slice(0, 120)}"`,
            icon: FileText,
          },
          {
            label: 'What\'s next?',
            prompt: 'Based on what we just discussed, what should I do next?',
            icon: Zap,
          },
        ];
      case 'explore':
        return [
          {
            label: 'Go deeper',
            prompt: `Tell me more about this: "${responseContent.slice(0, 120)}"`,
            icon: Compass,
          },
          {
            label: 'Find connections',
            prompt: `What connections exist between this and other areas of my knowledge: "${responseContent.slice(0, 100)}"`,
            icon: Link2,
          },
        ];
      case 'connect':
        return [
          {
            label: 'Share this',
            prompt: `I want to share this insight with a collaborator: "${responseContent.slice(0, 120)}"`,
            icon: Users,
          },
        ];
      default:
        return [
          {
            label: 'Save as DTU',
            prompt: `Save this as a DTU: "${responseContent.slice(0, 120)}"`,
            icon: FileText,
          },
        ];
    }
  };

  const actions = getActions();
  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-zinc-700/30">
      {actions.map((action, i) => {
        const Icon = action.icon;
        return (
          <button
            key={i}
            onClick={() => onSendMessage(action.prompt)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-lattice-elevated transition-colors"
          >
            <Icon className="w-2.5 h-2.5" />
            {action.label}
          </button>
        );
      })}

      {/* DTU Pipeline Actions */}
      {onViewContext && (
        <button
          onClick={onViewContext}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-neon-cyan/60 hover:text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
          title="View DTU context that informed this response"
        >
          <Eye className="w-2.5 h-2.5" />
          Context
        </button>
      )}
      {onForgeDTU && (
        <button
          onClick={() => onForgeDTU(responseContent)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-neon-purple/60 hover:text-neon-purple hover:bg-neon-purple/10 transition-colors"
          title="Promote this exchange to a permanent DTU"
        >
          <Hammer className="w-2.5 h-2.5" />
          Forge DTU
        </button>
      )}
    </div>
  );
}

// ── Cross-Lens Memory Indicator ─────────────────────────────────

interface CrossLensMemoryBarProps {
  trail: { lens: string; messageCount: number }[];
  totalLensCount: number;
  memoryPreserved: boolean;
  onToggleMemory: () => void;
  onClearTrail: () => void;
}

export function CrossLensMemoryBar({
  trail,
  totalLensCount,
  memoryPreserved,
  onToggleMemory,
  onClearTrail,
}: CrossLensMemoryBarProps) {
  const [expanded, setExpanded] = useState(false);

  if (totalLensCount <= 1) return null;

  return (
    <div className="px-3 py-1.5 border-b border-lattice-border bg-lattice-surface/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left"
      >
        <div className="flex items-center gap-1">
          {trail.slice(-4).map((entry, i) => (
            <span
              key={`${entry.lens}-${i}`}
              className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-zinc-800 text-zinc-400 border border-zinc-700"
            >
              {entry.lens}
            </span>
          ))}
          {trail.length > 4 && (
            <span className="text-[9px] text-zinc-600">+{trail.length - 4}</span>
          )}
        </div>
        <span className="ml-auto text-[10px] text-zinc-600 flex items-center gap-1">
          <Database className="w-2.5 h-2.5" />
          {totalLensCount} lens{totalLensCount !== 1 ? 'es' : ''} of context
        </span>
      </button>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1">
          {trail.map((entry, i) => (
            <div key={`${entry.lens}-expanded-${i}`} className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-400">{entry.lens}</span>
              <span className="text-zinc-600">{entry.messageCount} msg{entry.messageCount !== 1 ? 's' : ''}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1.5 mt-1.5 border-t border-zinc-800">
            <button
              onClick={(e) => { e.stopPropagation(); onToggleMemory(); }}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded transition-colors',
                memoryPreserved
                  ? 'text-neon-cyan bg-neon-cyan/10 hover:bg-neon-cyan/20'
                  : 'text-zinc-500 bg-zinc-800 hover:bg-zinc-700',
              )}
            >
              Memory: {memoryPreserved ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClearTrail(); }}
              className="text-[10px] px-2 py-0.5 rounded text-zinc-600 hover:text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              Clear trail
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Proactive Message Chip ──────────────────────────────────────

interface ProactiveChipProps {
  content: string;
  actionLabel?: string;
  onAction: () => void;
  onDismiss: () => void;
}

export function ProactiveChip({ content, actionLabel, onAction, onDismiss }: ProactiveChipProps) {
  return (
    <div className="mx-3 my-1.5 p-2.5 rounded-lg bg-neon-cyan/5 border border-neon-cyan/20 animate-in slide-in-from-top-2 duration-300">
      <div className="flex items-start gap-2">
        <Lightbulb className="w-3.5 h-3.5 text-neon-cyan mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-zinc-300 leading-relaxed">{content}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {actionLabel && (
              <button
                onClick={onAction}
                className="text-[10px] font-medium text-neon-cyan hover:text-neon-cyan/80 transition-colors"
              >
                {actionLabel}
              </button>
            )}
            <button
              onClick={onDismiss}
              className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
