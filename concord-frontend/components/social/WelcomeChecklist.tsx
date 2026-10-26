'use client';

/**
 * WelcomeChecklist — friendly first-run state for brand-new users.
 *
 * No tour overlays (those were removed on purpose). This is an inline
 * checklist on Home with three REAL steps: set avatar, set bio, make a
 * first post. Completion state comes from GET /api/social/welcome-state —
 * the server's own profile/post store — so a step only checks off when it
 * actually happened:
 *   - avatar / bio: the existing profile fields, saved through the real
 *     POST /api/social/profile (the ProfileEditDialog below is the same
 *     component You > Posts uses);
 *   - first post: any post the server has from this user (the composer
 *     right below this checklist POSTs /api/social/post).
 * The checklist disappears once every step is done, or when the user
 * dismisses it — dismissal POSTs /api/social/welcome-dismiss and persists
 * server-side on the social profile (survives reloads and restarts).
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { ProfileEditDialog, type ProfileEditValues } from './ProfileEditDialog';

interface WelcomeState {
  hasAvatar?: boolean;
  hasBio?: boolean;
  hasFirstPost?: boolean;
  dismissed?: boolean;
}

interface WelcomeChecklistProps {
  currentUserId: string;
  /** Used to seed the edit dialog when no profile exists yet. */
  fallbackDisplayName?: string | null;
  onStartPost: () => void;
  className?: string;
}

export function WelcomeChecklist({ currentUserId, fallbackDisplayName, onStartPost, className }: WelcomeChecklistProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data } = useQuery<WelcomeState>({
    queryKey: ['social-welcome-state', currentUserId],
    queryFn: async () => {
      const res = await api.get<WelcomeState>('/api/social/welcome-state');
      return res.data || {};
    },
    staleTime: 30 * 1000,
    enabled: Boolean(currentUserId),
  });

  // The edit dialog's initial values come from the real profile record —
  // the same GET the You view uses. A user with no profile yet edits from
  // their session name (the page auto-creates the profile on first visit).
  const { data: profileData } = useQuery<{ profile?: Partial<ProfileEditValues> } | null>({
    queryKey: ['social-welcome-profile', currentUserId],
    queryFn: async () => {
      try {
        const res = await api.get<{ ok?: boolean; profile?: Partial<ProfileEditValues> }>(
          `/api/social/profile/${encodeURIComponent(currentUserId)}`,
        );
        return res.data?.profile ? { profile: res.data.profile } : null;
      } catch {
        return null; // no profile yet — the dialog creates one on save
      }
    },
    enabled: Boolean(currentUserId) && editing,
  });

  const dismiss = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ ok?: boolean }>('/api/social/welcome-dismiss');
      if (res.data?.ok === false) throw new Error('Dismiss failed');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['social-welcome-state'] });
    },
  });

  if (!currentUserId || data?.dismissed) return null;

  const steps = [
    { id: 'avatar', label: 'Set your avatar', done: data?.hasAvatar === true, actionLabel: 'Set avatar' },
    { id: 'bio', label: 'Add a short bio', done: data?.hasBio === true, actionLabel: 'Add bio' },
    { id: 'post', label: 'Make your first post', done: data?.hasFirstPost === true, actionLabel: 'Write a post' },
  ];
  const remaining = steps.filter((s) => !s.done);
  if (remaining.length === 0) return null;

  const profile = profileData?.profile;
  const editInitial: ProfileEditValues = {
    displayName: profile?.displayName || fallbackDisplayName || currentUserId,
    bio: profile?.bio || '',
    avatar: profile?.avatar || '',
    website: profile?.website || '',
    isPublic: profile?.isPublic !== false,
  };

  return (
    <section className={cn('rounded-2xl border border-white/10 bg-[#111] p-3', className)} aria-label="Set up your profile">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-200">Welcome to Concord — a few steps to get started</h2>
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
          aria-label="Dismiss the welcome checklist"
        >
          {dismiss.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <ul className="space-y-1">
        {steps.map((step) => (
          <li key={step.id} className="flex min-h-[44px] items-center gap-2">
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                step.done ? 'border-teal-400/60 bg-teal-400/20 text-teal-200' : 'border-zinc-700 text-zinc-600',
              )}
              aria-hidden="true"
            >
              {step.done ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className={cn('text-sm', step.done ? 'text-zinc-500' : 'text-zinc-200')}>
              {step.label}
              {step.done ? ' — done' : ''}
            </span>
            {!step.done && (
              <button
                type="button"
                onClick={() => {
                  if (step.id === 'post') {
                    onStartPost();
                  } else {
                    setEditing(true);
                  }
                }}
                className="ml-auto rounded-full border border-teal-400/40 bg-teal-400/10 px-3 py-1.5 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-400/20"
                aria-label={step.actionLabel}
              >
                {step.actionLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <div className="mt-2 rounded-xl border border-white/10 bg-zinc-950/60">
          <ProfileEditDialog
            userId={currentUserId}
            initial={editInitial}
            onClose={() => {
              setEditing(false);
              void queryClient.invalidateQueries({ queryKey: ['social-welcome-state'] });
            }}
          />
        </div>
      )}
    </section>
  );
}

export default WelcomeChecklist;