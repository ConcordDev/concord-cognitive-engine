/**
 * Chat mode / persona / slash-command catalogs.
 * Extracted from app/lenses/chat/page.tsx (lens consolidation playbook).
 */

import type { ComponentType } from 'react';
import {
  BookOpen,
  Bot,
  Brain,
  Code,
  Download,
  Globe,
  GraduationCap,
  Hash,
  HelpCircle,
  MessageSquare,
  Search,
  Settings,
  Sparkles,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react';

export interface AIMode {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string; size?: number | string }>;
  description: string;
}

export interface Persona {
  id: string;
  name: string;
  icon: ComponentType<{ className?: string; size?: number | string }>;
  description: string;
  systemPrompt: string;
}

export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string; size?: number | string }>;
  args?: string;
}



// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

export const AI_MODES: AIMode[] = [
  { id: 'overview', name: 'Overview', icon: MessageSquare, description: 'General conversation' },
  { id: 'deep', name: 'Deep', icon: Brain, description: 'In-depth analysis' },
  {
    id: 'creative',
    name: 'Creative',
    icon: Sparkles,
    description: 'Creative writing & brainstorming',
  },
  { id: 'code', name: 'Code', icon: Code, description: 'Programming help' },
  { id: 'research', name: 'Research', icon: BookOpen, description: 'Research mode with citations' },
  { id: 'creti', name: 'CRETI', icon: Zap, description: 'Structured CRETI format' },
  { id: 'conkay', name: 'ConKay', icon: Sparkles, description: 'Voice-native majordomo — archives + research, holographic' },
];

export const PERSONAS: Persona[] = [
  {
    id: 'default',
    name: 'Default Assistant',
    icon: Bot,
    description: 'Standard helpful assistant',
    systemPrompt: '',
  },
  {
    id: 'research-analyst',
    name: 'Research Analyst',
    icon: Search,
    description: 'Thorough analysis with citations and evidence',
    systemPrompt:
      'You are a rigorous research analyst. Provide well-structured analysis backed by evidence and citations. Always consider multiple perspectives, identify assumptions, and note limitations in the evidence. Use structured formatting with clear sections.',
  },
  {
    id: 'creative-writer',
    name: 'Creative Writer',
    icon: Sparkles,
    description: 'Imaginative and expressive writing style',
    systemPrompt:
      'You are a talented creative writer. Use vivid language, metaphors, and engaging narrative techniques. Be imaginative and expressive while remaining clear. Adapt your tone to match the creative task at hand.',
  },
  {
    id: 'code-expert',
    name: 'Code Expert',
    icon: Terminal,
    description: 'Expert programmer with best practices',
    systemPrompt:
      'You are an expert software engineer. Write clean, well-documented, production-quality code. Always explain your approach, consider edge cases, suggest optimizations, and follow established design patterns and best practices for the relevant language/framework.',
  },
  {
    id: 'domain-specialist',
    name: 'Domain Specialist',
    icon: Globe,
    description: 'Uses current lens context for domain expertise',
    systemPrompt:
      'You are a domain specialist who deeply understands the current context and domain. Reference relevant domain-specific terminology, frameworks, and knowledge. Connect new information to existing domain knowledge in the lattice.',
  },
  {
    id: 'socratic-tutor',
    name: 'Socratic Tutor',
    icon: GraduationCap,
    description: 'Teaches through guided questioning',
    systemPrompt:
      'You are a Socratic tutor. Instead of giving direct answers, guide the learner through carefully crafted questions that help them discover the answer themselves. Break complex topics into smaller concepts. Validate understanding at each step before proceeding.',
  },
];

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/mode',
    label: '/mode [mode]',
    description: 'Switch AI mode',
    icon: Settings,
    args: 'mode',
  },
  { command: '/clear', label: '/clear', description: 'Clear chat history', icon: Trash2 },
  {
    command: '/export',
    label: '/export',
    description: 'Export conversation as JSON',
    icon: Download,
  },
  { command: '/forge', label: '/forge', description: 'Forge last response to DTU', icon: Zap },
  {
    command: '/tool',
    label: '/tool',
    description: 'Open the tool palette (every domain.action runnable)',
    icon: Sparkles,
  },
  { command: '/help', label: '/help', description: 'Show available commands', icon: HelpCircle },
  {
    command: '/context',
    label: '/context [domain]',
    description: 'Set domain context',
    icon: Hash,
    args: 'domain',
  },
  {
    command: '/oracle',
    label: '/oracle [query]',
    description: 'Ask the Oracle Engine (rich response)',
    icon: Sparkles,
    args: 'query',
  },
];



