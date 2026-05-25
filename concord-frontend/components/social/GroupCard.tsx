'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Users, LogIn, LogOut, Hash } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GroupData {
  groupId: string;
  name: string;
  description: string;
  memberCount: number;
  tags: string[];
  isMember?: boolean;
  coverColor?: string;
}

interface GroupCardProps {
  group: GroupData;
  onNavigate?: (groupId: string) => void;
  className?: string;
}

// ── Gradient helper ──────────────────────────────────────────────────────────

const gradients = [
  'from-neon-cyan/20 to-blue-600/20',
  'from-neon-purple/20 to-pink-600/20',
  'from-amber-400/20 to-orange-600/20',
  'from-violet-500/20 to-indigo-600/20',
  'from-teal-400/20 to-cyan-600/20',
  'from-rose-400/20 to-red-600/20',
];

function pickGradient(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return gradients[Math.abs(hash) % gradients.length];
}

// ── Main Component ───────────────────────────────────────────────────────────

export function GroupCard({ group, onNavigate, className }: GroupCardProps) {
  const queryClient = useQueryClient();
  const [isMember, setIsMember] = useState(group.isMember ?? false);
  const gradient = pickGradient(group.groupId);

  const joinMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/api/social/group/${group.groupId}/join`);
    },
    onSuccess: () => {
      setIsMember(true);
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  const leaveMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/api/social/group/${group.groupId}/leave`);
    },
    onSuccess: () => {
      setIsMember(false);
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  const handleToggleMembership = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isMember) {
      leaveMutation.mutate();
    } else {
      joinMutation.mutate();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => onNavigate?.(group.groupId)}
      className={cn(
        'group rounded-xl bg-lattice-deep border border-lattice-border hover:border-neon-cyan/30 transition-all cursor-pointer overflow-hidden',
        className
      )}
    >
      {/* Cover strip */}
      <div className={cn('h-16 bg-gradient-to-r', gradient)} />

      {/* Content */}
      <div className="p-4 -mt-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-lattice-surface border border-lattice-border flex items-center justify-center mb-3">
          <Users className="w-5 h-5 text-neon-cyan" />
        </div>

        <h3 className="text-white font-semibold text-sm group-hover:text-neon-cyan transition-colors truncate">
          {group.name}
        </h3>

        <p className="text-xs text-gray-400 mt-1 line-clamp-2">
          {group.description}
        </p>

        {/* Tags */}
        {group.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {group.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] text-neon-purple/70 bg-neon-purple/5 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
              >
                <Hash className="w-2 h-2" />
                {tag}
              </span>
            ))}
            {group.tags.length > 3 && (
              <span className="text-[10px] text-gray-400">
                +{group.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-lattice-border">
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <Users className="w-3 h-3" />
            {formatNumber(group.memberCount)} members
          </span>

          <button
            onClick={handleToggleMembership}
            disabled={joinMutation.isPending || leaveMutation.isPending}
            className={cn(
              'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-all',
              isMember
                ? 'bg-lattice-surface text-gray-400 border border-lattice-border hover:border-red-500/30 hover:text-red-400'
                : 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/25'
            )}
          >
            {isMember ? (
              <>
                <LogOut className="w-3 h-3" />
                Leave
              </>
            ) : (
              <>
                <LogIn className="w-3 h-3" />
                Join
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default GroupCard;
