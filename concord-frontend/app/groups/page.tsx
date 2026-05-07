'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  X,
  Users,
  Hash,
  Loader2,
  Shield,
  Tag,
} from 'lucide-react';
import { cn, debounce } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { GroupCard } from '@/components/social/GroupCard';
import type { GroupData } from '@/components/social/GroupCard';

// ── Create Group Modal ───────────────────────────────────────────────────────

function CreateGroupModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/api/social/group', {
        name,
        description,
        rules,
        tags,
      });
      return res.data as { groupId: string };
    },
    onSuccess: (data) => {
      onCreated(data.groupId);
      onClose();
    },
  });

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t) && tags.length < 10) {
      setTags([...tags, t]);
      setTagInput('');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg bg-lattice-surface border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-cyan" />
            <h2 className="text-sm font-semibold text-white">Create Group</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Group Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-neon-cyan/50"
              placeholder="Enter group name..."
              maxLength={60}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 500))}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-neon-cyan/50 resize-none"
              rows={3}
              placeholder="What is this group about?"
              maxLength={500}
            />
            <span className="text-[10px] text-gray-600 float-right">
              {description.length}/500
            </span>
          </div>

          {/* Rules */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
              <Shield className="w-3 h-3" /> Group Rules
              <span className="text-gray-600">(optional)</span>
            </label>
            <textarea
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-neon-cyan/50 resize-none"
              rows={3}
              placeholder="1. Be respectful..."
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block flex items-center gap-1">
              <Tag className="w-3 h-3" /> Topic Tags
            </label>
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 text-[10px] text-gray-300"
                >
                  <Hash className="w-2.5 h-2.5" /> {tag}
                  <button
                    onClick={() => setTags(tags.filter((t) => t !== tag))}
                    className="text-gray-500 hover:text-white ml-0.5"
                  >
                    <X className="w-2 h-2" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none"
                placeholder="Add tag..."
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/5 bg-white/[0.02]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
            className="px-5 py-2 rounded-lg bg-neon-cyan text-black text-sm font-semibold hover:brightness-110 disabled:opacity-30 transition flex items-center gap-2"
          >
            {createMutation.isPending && (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            Create Group
          </button>
        </div>

        {createMutation.isError && (
          <div className="px-5 pb-4 text-xs text-red-400">
            Failed to create group. Please try again.
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function GroupsPage() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const handleSearchChange = useMemo(
    () =>
      debounce((value: string) => {
        setSearchQuery(value);
      }, 300),
    []
  );

  const { data: groups, isLoading } = useQuery({
    queryKey: ['groups', searchQuery],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit: 20 };
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      const res = await api.get('/api/social/groups', { params });
      return (res.data.groups || []) as GroupData[];
    },
  });

  const handleNavigateToGroup = (groupId: string) => {
    window.location.href = `/groups/${groupId}`;
  };

  const handleGroupCreated = (groupId: string) => {
    queryClient.invalidateQueries({ queryKey: ['groups'] });
    window.location.href = `/groups/${groupId}`;
  };

  return (
    <div className="min-h-screen bg-lattice-deep">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Groups</h1>
            <p className="text-sm text-gray-500 mt-1">
              Discover and join communities around shared interests
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neon-cyan/15 text-neon-cyan text-sm font-medium border border-neon-cyan/30 hover:bg-neon-cyan/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            Create Group
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              handleSearchChange(e.target.value);
            }}
            placeholder="Search groups by name or topic..."
            className="w-full pl-11 pr-4 py-3 rounded-xl bg-lattice-surface border border-lattice-border text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/40 transition-all"
          />
          {searchInput && (
            <button
              onClick={() => {
                setSearchInput('');
                setSearchQuery('');
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Groups grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
          </div>
        ) : groups && groups.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {groups.map((group) => (
              <GroupCard
                key={group.groupId}
                group={group}
                onNavigate={handleNavigateToGroup}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <Users className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-white font-medium mb-2">
              {searchQuery ? 'No groups found' : 'No Groups Yet'}
            </h3>
            <p className="text-sm text-gray-400 max-w-sm mx-auto">
              {searchQuery
                ? 'Try a different search term or create a new group.'
                : 'Be the first to create a group and build a community.'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-4 px-4 py-2 rounded-lg bg-neon-cyan/15 text-neon-cyan text-sm font-medium border border-neon-cyan/30 hover:bg-neon-cyan/25 transition-all"
              >
                Create the first group
              </button>
            )}
          </div>
        )}
      </div>

      {/* Create modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreateGroupModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onCreated={handleGroupCreated}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
