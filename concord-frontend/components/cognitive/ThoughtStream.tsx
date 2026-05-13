'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Brain,
  Sparkles,
  GitBranch,
  Zap,
  AlertTriangle,
  CheckCircle,
  Filter,
  Pause,
  Play,
  RefreshCw,
  ChevronRight
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { getSocket } from '@/lib/realtime/socket';

type EventType = 'create' | 'update' | 'connect' | 'synthesis' | 'ai' | 'alert' | 'consolidate';

interface ThoughtEvent {
  id: string;
  type: EventType;
  title: string;
  description?: string;
  dtuId?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

interface ThoughtStreamProps {
  events?: ThoughtEvent[];
  maxEvents?: number;
  onEventClick?: (event: ThoughtEvent) => void;
  className?: string;
  realtime?: boolean;
}

const eventConfig: Record<EventType, { icon: React.ElementType; color: string; bgColor: string }> = {
  create: { icon: Brain, color: 'text-green-400', bgColor: 'bg-green-500/20' },
  update: { icon: RefreshCw, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  connect: { icon: GitBranch, color: 'text-neon-cyan', bgColor: 'bg-neon-cyan/20' },
  synthesis: { icon: Sparkles, color: 'text-neon-purple', bgColor: 'bg-neon-purple/20' },
  ai: { icon: Zap, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  alert: { icon: AlertTriangle, color: 'text-red-400', bgColor: 'bg-red-500/20' },
  consolidate: { icon: CheckCircle, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' }
};

export function ThoughtStream({
  events: initialEvents = [],
  maxEvents = 50,
  onEventClick,
  className,
  realtime = true
}: ThoughtStreamProps) {
  const [events, setEvents] = useState<ThoughtEvent[]>(initialEvents);
  const [isPaused, setIsPaused] = useState(false);
  const [filter, setFilter] = useState<EventType | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);

  // Listen for real-time DTU events via shared WebSocket singleton
  useEffect(() => {
    if (!realtime || isPaused) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const push = (eventType: EventType, data: Record<string, unknown>) => {
      const newEvent: ThoughtEvent = {
        id: Date.now().toString(),
        type: eventType,
        title: (data.title as string) || getRandomTitle(eventType),
        description: (data.content as string)?.slice(0, 120) || getRandomDescription(eventType),
        timestamp: new Date(),
        dtuId: (data.id as string) || (data.dtuId as string),
      };
      setEvents(prev => [newEvent, ...prev].slice(0, maxEvents));
    };

    const onCreated = (d: Record<string, unknown>) => push('create', d);
    const onUpdated = (d: Record<string, unknown>) => push('update', d);
    const onDeleted = (d: Record<string, unknown>) => push('consolidate', d);
    const onPipeline = (d: Record<string, unknown>) => push('synthesis', d);

    socket.on('dtu:created', onCreated);
    socket.on('dtu:updated', onUpdated);
    socket.on('dtu:deleted', onDeleted);
    socket.on('pipeline:completed', onPipeline);

    return () => {
      socket.off('dtu:created', onCreated);
      socket.off('dtu:updated', onUpdated);
      socket.off('dtu:deleted', onDeleted);
      socket.off('pipeline:completed', onPipeline);
    };
  }, [realtime, isPaused, maxEvents]);

  const filteredEvents = filter === 'all'
    ? events
    : events.filter(e => e.type === filter);

  return (
    <div className={cn('flex flex-col h-full bg-lattice-bg', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-neon-cyan" />
          <span className="font-medium text-white">Thought Stream</span>
          {realtime && (
            <span className={cn(
              'flex items-center gap-1 text-xs',
              isPaused ? 'text-gray-500' : 'text-green-400'
            )}>
              <span className={cn(
                'w-2 h-2 rounded-full',
                isPaused ? 'bg-gray-500' : 'bg-green-400 animate-pulse'
              )} />
              {isPaused ? 'Paused' : 'Live'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {realtime && (
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? (
                <Play className="w-4 h-4" />
              ) : (
                <Pause className="w-4 h-4" />
              )}
            </button>
          )}
          <button
            onClick={() => { window.dispatchEvent(new CustomEvent('thought-stream:toggle-filter')); }}
            className="p-1.5 text-gray-400 hover:text-white transition-colors"
            title="Filter"
          >
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-lattice-border overflow-x-auto">
        <FilterTab
          label="All"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          count={events.length}
        />
        {(Object.keys(eventConfig) as EventType[]).map(type => (
          <FilterTab
            key={type}
            label={type}
            active={filter === type}
            onClick={() => setFilter(type)}
            count={events.filter(e => e.type === type).length}
            color={eventConfig[type].color}
          />
        ))}
      </div>

      {/* Events list */}
      <div ref={streamRef} className="flex-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <Activity className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm">No activity yet</p>
            </div>
          ) : (
            filteredEvents.map((event, index) => (
              <ThoughtEventItem
                key={event.id}
                event={event}
                isExpanded={expandedId === event.id}
                onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
                onClick={() => onEventClick?.(event)}
                isNew={index === 0}
              />
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Stats footer */}
      <div className="px-4 py-2 border-t border-lattice-border bg-lattice-surface/50 text-xs text-gray-500">
        <div className="flex items-center justify-between">
          <span>{events.length} events</span>
          <span>Last: {events[0] ? formatRelativeTime(events[0].timestamp) : 'Never'}</span>
        </div>
      </div>
    </div>
  );
}

interface ThoughtEventItemProps {
  event: ThoughtEvent;
  isExpanded: boolean;
  onToggle: () => void;
  onClick?: () => void;
  isNew?: boolean;
}

const ThoughtEventItem = React.memo(function ThoughtEventItem({ event, isExpanded, onToggle, onClick, isNew }: ThoughtEventItemProps) {
  const config = eventConfig[event.type];
  const Icon = config.icon;

  return (
    <motion.div
      initial={isNew ? { opacity: 0, x: -20 } : false}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="border-b border-lattice-border last:border-0"
    >
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-4 py-3 hover:bg-lattice-surface/50 transition-colors text-left"
      >
        <div className={cn('p-1.5 rounded-lg mt-0.5', config.bgColor)}>
          <Icon className={cn('w-4 h-4', config.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm text-white font-medium truncate">
              {event.title}
            </span>
            {isNew && (
              <span className="px-1.5 py-0.5 text-[10px] bg-neon-cyan/20 text-neon-cyan rounded">
                NEW
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {formatRelativeTime(event.timestamp)}
          </p>
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </motion.div>
      </button>

      <AnimatePresence>
        {isExpanded && event.description && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pl-12">
              <p className="text-sm text-gray-400">{event.description}</p>
              {event.dtuId && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClick?.();
                  }}
                  className="mt-2 text-xs text-neon-cyan hover:underline"
                >
                  View DTU →
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

const FilterTab = React.memo(function FilterTab({
  label,
  active,
  onClick,
  count,
  color
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count: number;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1 text-xs rounded-full transition-colors capitalize',
        active
          ? 'bg-neon-cyan/20 text-neon-cyan'
          : 'text-gray-400 hover:text-white hover:bg-lattice-surface'
      )}
    >
      {label}
      <span className={cn('ml-1', color || 'text-gray-500')}>({count})</span>
    </button>
  );
});

// Fallback labels for WebSocket events that lack title/description
function getRandomTitle(type: EventType): string {
  const titles: Record<EventType, string[]> = {
    create: ['New DTU created', 'Thought captured', 'Idea recorded'],
    update: ['DTU updated', 'Content revised', 'Metadata changed'],
    connect: ['New connection', 'Link established', 'Relationship found'],
    synthesis: ['Synthesis complete', 'Ideas merged', 'Pattern detected'],
    ai: ['AI insight', 'Auto-tag applied', 'Suggestion ready'],
    alert: ['Contradiction found', 'Attention needed', 'Review required'],
    consolidate: ['MEGA formed', 'DTUs consolidated', 'Memory compressed']
  };
  return titles[type][Math.floor(Math.random() * titles[type].length)];
}

function getRandomDescription(type: EventType): string {
  const descriptions: Record<EventType, string[]> = {
    create: ['A new discrete thought unit was added to your knowledge base.'],
    update: ['Content was updated with new information.'],
    connect: ['Two related thoughts have been linked together.'],
    synthesis: ['Multiple DTUs were analyzed and synthesized into insights.'],
    ai: ['The AI assistant discovered a new pattern in your thoughts.'],
    alert: ['Potential inconsistency detected between related DTUs.'],
    consolidate: ['Related DTUs were merged into a higher-order structure.']
  };
  return descriptions[type][Math.floor(Math.random() * descriptions[type].length)];
}
