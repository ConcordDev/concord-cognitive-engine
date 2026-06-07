'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';
import {
  FileQuestion,
  Search,
  Inbox,
  FolderOpen,
  WifiOff,
  Database,
  Users,
  Lightbulb,
  Brain,
  Network,
  MessageSquare,
  Calendar,
  Layers,
  Sparkles,
  ShieldAlert
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  variant?: 'default' | 'minimal' | 'illustrated';
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'default',
  className
}: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex flex-col items-center justify-center text-center p-8',
        variant === 'minimal' && 'p-4',
        className
      )}
    >
      {icon && (
        <motion.div
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
          className={cn(
            'mb-4 p-4 rounded-full bg-lattice-surface/50 border border-lattice-border',
            variant === 'minimal' && 'p-2 mb-2'
          )}
        >
          <div className="text-gray-400">
            {icon}
          </div>
        </motion.div>
      )}

      <motion.h3
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className={cn(
          'text-lg font-medium text-white mb-2',
          variant === 'minimal' && 'text-base mb-1'
        )}
      >
        {title}
      </motion.h3>

      {description && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className={cn(
            'text-gray-400 max-w-sm mb-6',
            variant === 'minimal' && 'text-sm mb-3'
          )}
        >
          {description}
        </motion.p>
      )}

      {(action || secondaryAction) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
          className="flex items-center gap-3"
        >
          {action && (
            <button
              onClick={action.onClick}
              className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 rounded-lg hover:bg-neon-cyan/30 transition-colors"
            >
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              {secondaryAction.label}
            </button>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}

// Preset empty states for common scenarios

export function EmptyDTUs({ onForge }: { onForge?: () => void }) {
  return (
    <EmptyState
      icon={<Brain className="w-8 h-8" />}
      title="No thoughts yet"
      description="Start capturing your ideas. Each DTU is a discrete thought unit that can evolve and connect with others."
      action={onForge ? { label: 'Forge your first DTU', onClick: onForge } : undefined}
    />
  );
}

export function EmptySearch({ query }: { query: string }) {
  return (
    <EmptyState
      icon={<Search className="w-8 h-8" />}
      title="No results found"
      description={`We couldn't find anything matching "${query}". Try a different search term.`}
    />
  );
}

export function EmptyGraph({ onForge }: { onForge?: () => void }) {
  return (
    <EmptyState
      icon={<Network className="w-8 h-8" />}
      title="Your knowledge graph is empty"
      description="Create DTUs and connect them to see your knowledge network grow and evolve."
      action={onForge ? { label: 'Create first node', onClick: onForge } : undefined}
    />
  );
}

export function EmptyChat({ onStart }: { onStart?: () => void }) {
  return (
    <EmptyState
      icon={<MessageSquare className="w-8 h-8" />}
      title="Start a conversation"
      description="Ask questions, explore ideas, or request synthesis across your knowledge base."
      action={onStart ? { label: 'Begin chat', onClick: onStart } : undefined}
    />
  );
}

export function EmptyInbox() {
  return (
    <EmptyState
      icon={<Inbox className="w-8 h-8" />}
      title="Inbox zero!"
      description="You're all caught up. No pending items to review."
    />
  );
}

export function EmptyFolder({ folderName }: { folderName?: string }) {
  return (
    <EmptyState
      icon={<FolderOpen className="w-8 h-8" />}
      title={folderName ? `${folderName} is empty` : 'This folder is empty'}
      description="Add items to this folder to organize your thoughts."
    />
  );
}

export function EmptyConnections({ onExplore }: { onExplore?: () => void }) {
  return (
    <EmptyState
      icon={<Layers className="w-8 h-8" />}
      title="No connections yet"
      description="This DTU hasn't been linked to others. Explore your knowledge base to find related thoughts."
      action={onExplore ? { label: 'Find connections', onClick: onExplore } : undefined}
    />
  );
}

export function EmptyCollaborators({ onInvite }: { onInvite?: () => void }) {
  return (
    <EmptyState
      icon={<Users className="w-8 h-8" />}
      title="No collaborators"
      description="Invite others to collaborate on this workspace in real-time."
      action={onInvite ? { label: 'Invite collaborators', onClick: onInvite } : undefined}
    />
  );
}

export function EmptyCalendar({ onSchedule }: { onSchedule?: () => void }) {
  return (
    <EmptyState
      icon={<Calendar className="w-8 h-8" />}
      title="Nothing scheduled"
      description="Your calendar is clear. Schedule events or set reminders for your DTUs."
      action={onSchedule ? { label: 'Schedule something', onClick: onSchedule } : undefined}
    />
  );
}

export function EmptyPlugins({ onBrowse }: { onBrowse?: () => void }) {
  return (
    <EmptyState
      icon={<Sparkles className="w-8 h-8" />}
      title="No plugins installed"
      description="Extend Concord's capabilities with community plugins from the marketplace."
      action={onBrowse ? { label: 'Browse marketplace', onClick: onBrowse } : undefined}
    />
  );
}

export function OfflineState({ onRetry }: { onRetry?: () => void }) {
  return (
    <EmptyState
      icon={<WifiOff className="w-8 h-8" />}
      title="You're offline"
      description="Some features may be limited. Your changes will sync when you're back online."
      action={onRetry ? { label: 'Retry connection', onClick: onRetry } : undefined}
    />
  );
}

export function ErrorState({
  error,
  onRetry
}: {
  error?: string;
  onRetry?: () => void
}) {
  return (
    <EmptyState
      icon={<FileQuestion className="w-8 h-8 text-red-400" />}
      title="Something went wrong"
      description={error || 'An unexpected error occurred. Please try again.'}
      action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined}
    />
  );
}

/**
 * Friendly state for admin/operator-gated lenses when the backend returns 403.
 * Replaces the prior raw error string / blank page / stuck spinner. Render this
 * when `isForbidden(...)` (from @/lib/api/client) matches the lens's load error.
 */
export function AdminRequiredState({ roles }: { roles?: string[] }) {
  return (
    <EmptyState
      icon={<ShieldAlert className="w-8 h-8 text-amber-400" />}
      title="Admin access required"
      description={
        roles?.length
          ? `This operator surface needs one of: ${roles.join(', ')}. Ask an administrator for access.`
          : 'This operator surface is restricted to administrators. Ask an administrator for access.'
      }
    />
  );
}

export function LoadingState({ message }: { message?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center p-8"
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="w-8 h-8 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full mb-4"
      />
      <p className="text-gray-400">{message || 'Loading...'}</p>
    </motion.div>
  );
}

// Illustrated empty state with animated SVG
export function IllustratedEmptyState({
  type,
  onAction
}: {
  type: 'knowledge' | 'connection' | 'idea';
  onAction?: () => void;
}) {
  const configs = {
    knowledge: {
      title: 'Build your knowledge base',
      description: 'Start by capturing thoughts, importing documents, or connecting external sources.',
      actionLabel: 'Get started'
    },
    connection: {
      title: 'Discover connections',
      description: 'As you add more DTUs, Concord will help you find surprising connections between ideas.',
      actionLabel: 'Add first DTU'
    },
    idea: {
      title: 'Let ideas flourish',
      description: 'Your cognitive garden awaits. Plant the seeds of your first thoughts.',
      actionLabel: 'Plant first seed'
    }
  };

  const config = configs[type];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center p-12 text-center"
    >
      {/* Animated illustration */}
      <div className="relative w-48 h-48 mb-8">
        <motion.div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-neon-cyan/20 to-neon-purple/20"
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ duration: 3, repeat: Infinity }}
        />
        <motion.div
          className="absolute inset-4 rounded-full bg-gradient-to-br from-neon-purple/20 to-neon-pink/20"
          animate={{ scale: [1.1, 1, 1.1] }}
          transition={{ duration: 3, repeat: Infinity, delay: 0.5 }}
        />
        <motion.div
          className="absolute inset-8 rounded-full bg-lattice-surface border border-lattice-border flex items-center justify-center"
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
        >
          {type === 'knowledge' && <Database className="w-12 h-12 text-neon-cyan" />}
          {type === 'connection' && <Network className="w-12 h-12 text-neon-purple" />}
          {type === 'idea' && <Lightbulb className="w-12 h-12 text-neon-pink" />}
        </motion.div>

        {/* Orbiting particles */}
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute w-3 h-3 rounded-full bg-neon-cyan/60"
            style={{
              top: '50%',
              left: '50%',
              marginTop: -6,
              marginLeft: -6
            }}
            animate={{
              x: [0, 80 * Math.cos((i * 2 * Math.PI) / 3), 0],
              y: [0, 80 * Math.sin((i * 2 * Math.PI) / 3), 0],
              opacity: [0.3, 1, 0.3]
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              delay: i * 1.3,
              ease: 'easeInOut'
            }}
          />
        ))}
      </div>

      <h2 className="text-xl font-semibold text-white mb-3">{config.title}</h2>
      <p className="text-gray-400 max-w-md mb-6">{config.description}</p>

      {onAction && (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onAction}
          className="px-6 py-3 bg-gradient-to-r from-neon-cyan to-neon-purple text-white font-medium rounded-lg shadow-lg shadow-neon-cyan/25"
        >
          {config.actionLabel}
        </motion.button>
      )}
    </motion.div>
  );
}
