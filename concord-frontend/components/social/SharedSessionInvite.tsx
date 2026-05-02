'use client';

/**
 * SharedSessionInvite — Sovereignty gate before joining a shared session.
 * User chooses sharing level and which domains to expose.
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sharedSessionInviteDetails, joinSharedSession } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Users, Shield, Eye, MessageSquare, Loader } from 'lucide-react';

interface SharingLevelOption {
  id: 'query' | 'full' | 'none';
  label: string;
  description: string;
}

interface InviteDetails {
  sessionId: string;
  createdBy: string;
  participants: { name: string; sharingDomains: string[]; sharingLevel: string }[];
  message: string;
  options: {
    sharingLevels: SharingLevelOption[];
  };
}

const AVAILABLE_DOMAINS = [
  'healthcare',
  'food',
  'fitness',
  'finance',
  'accounting',
  'law',
  'insurance',
  'realestate',
  'household',
  'creative',
  'education',
  'technology',
  'business',
  'travel',
  'social',
  'music',
  'art',
  'writing',
  'science',
  'career',
];

interface SharedSessionInviteProps {
  sessionId: string;
  onJoined?: (sessionId: string) => void;
  onDeclined?: () => void;
}

function SharedSessionInvite({ sessionId, onJoined, onDeclined }: SharedSessionInviteProps) {
  const [sharingLevel, setSharingLevel] = useState<'query' | 'full' | 'none'>('query');
  const [sharingDomains, setSharingDomains] = useState<string[]>([]);
  const [isJoining, setIsJoining] = useState(false);

  const { data, isLoading } = useQuery<{ ok: boolean } & InviteDetails>({
    queryKey: ['shared-session-invite', sessionId],
    queryFn: () => sharedSessionInviteDetails(sessionId),
  });

  const toggleDomain = useCallback((domain: string) => {
    setSharingDomains((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  }, []);

  const joinSession = async () => {
    setIsJoining(true);
    try {
      await joinSharedSession(sessionId, sharingDomains, sharingLevel);
      onJoined?.(sessionId);
    } catch {
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader className="w-6 h-6 text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (!data?.ok) {
    return (
      <div className="max-w-lg mx-auto p-8 text-center text-zinc-500">
        Session not found or already ended.
      </div>
    );
  }

  const SHARING_ICONS = {
    full: Eye,
    query: Shield,
    none: MessageSquare,
  };

  return (
    <div className="max-w-lg mx-auto p-8 space-y-6">
      <div className="text-center">
        <Users className="w-10 h-10 text-cyan-400 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-white">Shared Session Invite</h2>
        <p className="text-sm text-zinc-400 mt-2">{data.message}</p>
      </div>

      {/* Current participants */}
      {data.participants.length > 0 && (
        <div className="bg-zinc-800/50 rounded-lg p-3">
          <p className="text-xs text-zinc-500 mb-2">Already in session:</p>
          {data.participants.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-zinc-300">{p.name}</span>
              <span className="text-xs text-zinc-600">
                {p.sharingLevel === 'full'
                  ? 'Full sharing'
                  : p.sharingLevel === 'query'
                    ? 'AI access'
                    : 'Chat only'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Sharing level selection */}
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">Choose how much of your substrate to share:</p>

        {(
          data.options?.sharingLevels || [
            {
              id: 'full' as const,
              label: 'Full collaboration',
              description: 'AI draws from your substrate. You can share DTUs and artifacts.',
            },
            {
              id: 'query' as const,
              label: 'AI can reference me',
              description:
                "The shared AI can search your substrate for context. Others can't browse your data.",
            },
            {
              id: 'none' as const,
              label: 'Just chat',
              description: 'Your substrate stays sealed. Only your messages contribute.',
            },
          ]
        ).map((option) => {
          const Icon = SHARING_ICONS[option.id] || Shield;
          return (
            <button
              key={option.id}
              onClick={() => setSharingLevel(option.id)}
              className={cn(
                'w-full text-left p-3 rounded-lg border transition-all flex items-start gap-3',
                sharingLevel === option.id
                  ? 'border-cyan-500 bg-cyan-500/5'
                  : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-600'
              )}
            >
              <Icon
                className={cn(
                  'w-4 h-4 mt-0.5 shrink-0',
                  sharingLevel === option.id ? 'text-cyan-400' : 'text-zinc-500'
                )}
              />
              <div>
                <p className="text-sm font-medium text-white">{option.label}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{option.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Domain selection (when sharing is enabled) */}
      {sharingLevel !== 'none' && (
        <div>
          <p className="text-sm text-zinc-400 mb-2">
            Limit sharing to specific domains (optional):
          </p>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_DOMAINS.map((d) => (
              <button
                key={d}
                onClick={() => toggleDomain(d)}
                className={cn(
                  'px-2 py-1 text-xs rounded-lg border transition-colors',
                  sharingDomains.includes(d)
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-600'
                )}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-zinc-600 mt-1">Leave empty to share all your domains</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={joinSession}
          disabled={isJoining}
          className="flex-1 py-3 rounded-lg bg-cyan-500/20 border border-cyan-500/50
            text-cyan-400 font-medium disabled:opacity-50 hover:bg-cyan-500/30 transition-colors"
        >
          {isJoining ? <Loader className="w-4 h-4 animate-spin mx-auto" /> : 'Join Session'}
        </button>
        <button
          onClick={onDeclined}
          className="px-6 py-3 rounded-lg bg-zinc-800 border border-zinc-700
            text-zinc-400 hover:border-zinc-600 transition-colors"
        >
          Decline
        </button>
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSharedSessionInvite = withErrorBoundary(SharedSessionInvite);
export { _WrappedSharedSessionInvite as SharedSessionInvite };
