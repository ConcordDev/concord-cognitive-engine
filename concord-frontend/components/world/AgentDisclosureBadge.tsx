'use client';

// Wave 7 / C1 + E6 — the hard AI-disclosure chip. Wherever an autonomous agent is
// rendered (NPC nameplate, agents roster), a human must always know it's an AI.
// Reusable + tiny; renders nothing when the subject isn't an agent.

import { Bot } from 'lucide-react';

export function AgentDisclosureBadge({
  isAgent,
  size = 'sm',
  className = '',
}: {
  isAgent?: boolean;
  size?: 'sm' | 'xs';
  className?: string;
}) {
  if (!isAgent) return null;
  const pad = size === 'xs' ? 'px-1 py-0.5 text-[9px]' : 'px-1.5 py-0.5 text-[10px]';
  return (
    <span
      title="This character is controlled by an autonomous AI agent."
      className={`inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/20 font-medium text-sky-300 ${pad} ${className}`}
    >
      <Bot className="h-2.5 w-2.5" aria-hidden="true" /> AI
    </span>
  );
}

export default AgentDisclosureBadge;
