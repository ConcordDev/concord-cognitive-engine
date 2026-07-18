'use client';

// P-D — the "AI · reenactment of {person}" disclosure badge required by
// docs/GOVERNANCE_DESIGN.md §2.3: "wherever a reenacted 'you' appears — NPC
// nameplate, DM header, dialogue panel, marketplace listing card — the UI
// MUST render an unmissable 'AI · reenactment of {person}' badge sourced
// from users.is_agent + agent_kind."
//
// Distinct from components/world/AgentDisclosureBadge.tsx (the generic "AI"
// chip for autonomous residents/NPCs). This one names the SOURCE person a
// forked-self agent was instantiated from — the fact that most needs
// disclosing for a reenactment specifically, not just "this is an AI".
//
// Honest-by-construction: renders NOTHING unless isAgent is true. Never
// infers or fabricates a person name — personName must come from real
// server data (fork.instantiate_preview's sourceDisplayName, or an
// equivalent is_agent-joined read). No isAgent -> no badge, full stop.

import { Bot } from 'lucide-react';

export function ForkDisclosureBadge({
  isAgent,
  personName,
  agentKind,
  size = 'sm',
  className = '',
}: {
  isAgent?: boolean;
  personName?: string | null;
  agentKind?: string | null;
  size?: 'sm' | 'xs';
  className?: string;
}) {
  if (!isAgent) return null;

  const label = personName ? `AI · reenactment of ${personName}` : 'AI · reenactment';
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-1 text-[11px]';

  return (
    <span
      role="status"
      title={
        personName
          ? `This is an AI agent instantiated from ${personName}'s corpus — not ${personName} themselves. ${agentKind ? `(${agentKind})` : ''}`
          : 'This is an AI agent, not a human.'
      }
      className={`inline-flex items-center gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/15 font-semibold uppercase tracking-wide text-amber-300 ${pad} ${className}`}
    >
      <Bot className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}

export default ForkDisclosureBadge;
