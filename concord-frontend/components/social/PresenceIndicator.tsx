'use client';

import { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, MessageSquare, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

interface User {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  status: 'active' | 'idle' | 'viewing';
  location?: string; // Current DTU or lens
  lastSeen?: Date;
}

interface PresenceIndicatorProps {
  users: User[];
  maxVisible?: number;
  showStatus?: boolean;
  className?: string;
  onUserClick?: (user: User) => void;
}

const statusConfig = {
  active: { color: 'bg-green-400', label: 'Active' },
  idle: { color: 'bg-yellow-400', label: 'Idle' },
  viewing: { color: 'bg-blue-400', label: 'Viewing' }
};

export function PresenceIndicator({
  users,
  maxVisible = 4,
  showStatus = true,
  className,
  onUserClick
}: PresenceIndicatorProps) {
  const [showAll, setShowAll] = useState(false);
  const visibleUsers = users.slice(0, maxVisible);
  const remainingCount = Math.max(0, users.length - maxVisible);

  if (users.length === 0) return null;

  return (
    <div className={cn('relative', className)}>
      <div className="flex items-center">
        {/* Avatar stack */}
        <div className="flex -space-x-2">
          {visibleUsers.map((user, index) => (
            <motion.button
              key={user.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => onUserClick?.(user)}
              className="relative group"
              style={{ zIndex: maxVisible - index }}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium text-white ring-2 ring-lattice-bg',
                )}
                style={{ backgroundColor: user.color }}
              >
                {user.avatar ? (
                  <Image
                    src={user.avatar}
                    alt={user.name}
                    width={32}
                    height={32}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  user.name.charAt(0).toUpperCase()
                )}
              </div>

              {/* Status dot */}
              {showStatus && (
                <span
                  className={cn(
                    'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-lattice-bg',
                    statusConfig[user.status].color
                  )}
                />
              )}

              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
                <div className="px-2 py-1 bg-black rounded text-xs text-white whitespace-nowrap">
                  {user.name}
                  {user.location && (
                    <span className="text-gray-400 ml-1">· {user.location}</span>
                  )}
                </div>
              </div>
            </motion.button>
          ))}

          {/* Overflow indicator */}
          {remainingCount > 0 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="w-8 h-8 rounded-full bg-lattice-surface border border-lattice-border flex items-center justify-center text-xs text-gray-400 hover:text-white transition-colors ring-2 ring-lattice-bg"
            >
              +{remainingCount}
            </button>
          )}
        </div>

        {/* Quick actions */}
        <button
          onClick={() => { window.dispatchEvent(new CustomEvent('presence:view-all')); }}
          className="ml-2 p-1.5 text-gray-400 hover:text-white transition-colors"
          title="View all"
        >
          <Users className="w-4 h-4" />
        </button>
      </div>

      {/* Expanded user list */}
      <AnimatePresence>
        {showAll && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full mt-2 right-0 w-64 bg-lattice-bg border border-lattice-border rounded-lg shadow-xl overflow-hidden z-50"
          >
            <div className="px-3 py-2 border-b border-lattice-border">
              <span className="text-sm font-medium text-white">
                {users.length} collaborator{users.length !== 1 ? 's' : ''} online
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {users.map(user => (
                <button
                  key={user.id}
                  onClick={() => {
                    onUserClick?.(user);
                    setShowAll(false);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-lattice-surface transition-colors"
                >
                  <div className="relative">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium text-white"
                      style={{ backgroundColor: user.color }}
                    >
                      {user.avatar ? (
                        <Image
                          src={user.avatar}
                          alt={user.name}
                          width={32}
                          height={32}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        user.name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <span
                      className={cn(
                        'absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-lattice-bg',
                        statusConfig[user.status].color
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm text-white truncate">{user.name}</p>
                    {user.location && (
                      <p className="text-xs text-gray-400 truncate flex items-center gap-1">
                        <Eye className="w-3 h-3" />
                        {user.location}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // Open chat
                      }}
                      className="p-1 text-gray-400 hover:text-white"
                    aria-label="Message">
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Cursor presence for collaborative editing
interface CursorPresence {
  userId: string;
  userName: string;
  color: string;
  position: { x: number; y: number };
  selection?: { start: number; end: number };
}

interface CollaborativeCursorsProps {
  cursors: CursorPresence[];
  containerRef: React.RefObject<HTMLElement>;
}

export function CollaborativeCursors({ cursors, containerRef }: CollaborativeCursorsProps) {
  const getRelativePosition = (position: { x: number; y: number }) => {
    if (!containerRef.current) return position;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: position.x - rect.left,
      y: position.y - rect.top,
    };
  };

  return (
    <>
      {cursors.map(cursor => {
        const relPos = getRelativePosition(cursor.position);
        return (
        <motion.div
          key={cursor.userId}
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            x: relPos.x,
            y: relPos.y
          }}
          transition={{ type: 'spring', damping: 30, stiffness: 500 }}
          className="absolute pointer-events-none z-50"
          style={{ left: 0, top: 0 }}
        >
          {/* Cursor */}
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            style={{ color: cursor.color }}
          >
            <path
              d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.94a.5.5 0 0 0 .35-.85L6.35 2.79a.5.5 0 0 0-.85.42z"
              fill="currentColor"
            />
          </svg>

          {/* Name label */}
          <div
            className="absolute left-5 top-5 px-2 py-0.5 rounded text-xs text-white whitespace-nowrap"
            style={{ backgroundColor: cursor.color }}
          >
            {cursor.userName}
          </div>
        </motion.div>
        );
      })}
    </>
  );
}

// Activity feed for social updates
interface ActivityItem {
  id: string;
  user: User;
  action: 'created' | 'edited' | 'commented' | 'connected' | 'shared';
  target: string;
  timestamp: Date;
}

interface ActivityFeedProps {
  activities: ActivityItem[];
  onActivityClick?: (activity: ActivityItem) => void;
  className?: string;
}

export function ActivityFeed({ activities, onActivityClick, className }: ActivityFeedProps) {
  const actionLabels = {
    created: 'created',
    edited: 'edited',
    commented: 'commented on',
    connected: 'connected',
    shared: 'shared'
  };

  return (
    <div className={cn('space-y-3', className)}>
      {activities.map(activity => (
        <motion.button
          key={activity.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => onActivityClick?.(activity)}
          className="w-full flex items-start gap-3 text-left hover:bg-lattice-surface p-2 rounded-lg transition-colors"
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white flex-shrink-0"
            style={{ backgroundColor: activity.user.color }}
          >
            {activity.user.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-300">
              <span className="text-white font-medium">{activity.user.name}</span>
              {' '}{actionLabels[activity.action]}{' '}
              <span className="text-neon-cyan">{activity.target}</span>
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatRelativeTime(activity.timestamp)}
            </p>
          </div>
        </motion.button>
      ))}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

