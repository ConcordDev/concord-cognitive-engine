'use client';

import { Handshake, Paintbrush, PenTool, Monitor, Search } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectType = 'design' | 'development' | 'research' | 'art' | 'writing';
export type SessionStatus = 'open' | 'in-progress' | 'full' | 'private';
export type Privacy = 'public' | 'private' | 'invite-only';
// 'participant' is a real, honest category — a live joiner tracked by the
// backend's genuine session roster (collab.sessionJoin/sessionRoster) who
// hasn't been assigned a project role. It is not a fabricated skill/role
// claim, just an accurate "connected, role unspecified" label.
export type ParticipantRole = 'host' | 'developer' | 'designer' | 'reviewer' | 'creator' | 'writer' | 'participant';
export type MainTab = 'active' | 'mine' | 'invitations' | 'history';
export type FilterPill = 'all' | ProjectType;

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  role: ParticipantRole;
  online: boolean;
}

export interface CollabSession {
  id: string;
  name: string;
  projectType: ProjectType;
  host: Participant;
  participants: Participant[];
  status: SessionStatus;
  privacy: Privacy;
  genre: string[];
  maxCapacity: number;
  description: string;
  startedAt: number;
  linkedProjectId?: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

// Real shape produced by the backend's collab.sessionInvite /
// sessionInviteRespond / sessionInviteList macros (server/domains/collab.js)
// — a targeted (1:1) invite to a real, already-created session. This
// replaced an earlier placeholder shape (`fromAvatar` as a server-picked
// Tailwind class, `genre` as a pre-joined string, no `sessionId`/`toId`/
// `status`) that nothing ever actually produced. Avatars are still derived
// client-side via `avatarForUser(id)` — the backend never owns a UI class
// name — and `projectType`/`genre` are honestly nullable/empty because a
// session isn't required to have them.
export interface Invitation {
  id: string;
  sessionId: string;
  sessionName: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  projectType: ProjectType | null;
  genre: string[];
  message: string;
  status: 'pending' | 'accepted' | 'declined';
  sentAt: number;
  respondedAt: number | null;
}

export interface HistoryEntry {
  id: string;
  sessionName: string;
  projectType: ProjectType;
  duration: number;
  participantCount: number;
  filesShared: number;
  endedAt: number;
}

// ---------------------------------------------------------------------------
// Avatar palette — a real per-user visual, deterministic from the user's own
// id (same technique as the backend's `colorFor(userId)` in
// server/domains/collab.js), never a fabricated name/identity generator.
// ---------------------------------------------------------------------------

export const AVATARS = [
  'bg-gradient-to-br from-neon-blue to-neon-purple',
  'bg-gradient-to-br from-neon-cyan to-neon-blue',
  'bg-gradient-to-br from-neon-purple to-pink-500',
  'bg-gradient-to-br from-amber-500 to-orange-600',
  'bg-gradient-to-br from-emerald-500 to-teal-600',
  'bg-gradient-to-br from-rose-500 to-red-600',
  'bg-gradient-to-br from-violet-500 to-indigo-600',
  'bg-gradient-to-br from-sky-400 to-blue-600',
];

export function avatarForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const TYPE_ICONS: Record<ProjectType, typeof Handshake> = {
  design: Paintbrush,
  development: Monitor,
  research: Search,
  art: PenTool,
  writing: PenTool,
};

export const TYPE_COLORS: Record<ProjectType, string> = {
  design: 'text-neon-blue',
  development: 'text-neon-purple',
  research: 'text-neon-cyan',
  art: 'text-amber-400',
  writing: 'text-emerald-400',
};

export const STATUS_STYLES: Record<SessionStatus, string> = {
  open: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'in-progress': 'bg-neon-blue/20 text-neon-blue border-neon-blue/30',
  full: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  private: 'bg-neon-purple/20 text-neon-purple border-neon-purple/30',
};

export const ROLE_BADGE: Record<ParticipantRole, { label: string; color: string }> = {
  host: { label: 'Host', color: 'bg-amber-500/20 text-amber-400' },
  developer: { label: 'Developer', color: 'bg-neon-blue/20 text-neon-blue' },
  designer: { label: 'Designer', color: 'bg-neon-purple/20 text-neon-purple' },
  reviewer: { label: 'Reviewer', color: 'bg-neon-cyan/20 text-neon-cyan' },
  creator: { label: 'Creator', color: 'bg-amber-400/20 text-amber-400' },
  writer: { label: 'Writer', color: 'bg-emerald-400/20 text-emerald-400' },
  participant: { label: 'Member', color: 'bg-gray-500/20 text-gray-300' },
};

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

