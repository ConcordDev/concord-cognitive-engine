'use client';

import { FamilyPill } from '@/components/lens/NorthStarChrome';

const FAMILY = [
  { id: 'chat', label: 'Chat', href: '/lenses/chat' },
  { id: 'thread', label: 'Threads', href: '/lenses/thread' },
  { id: 'forum', label: 'Forum', href: '/lenses/forum' },
  { id: 'daily', label: 'Daily', href: '/lenses/daily' },
] as const;

export type ChatFamilyId = (typeof FAMILY)[number]['id'];

/** Chat · Threads · Forum · Daily pill from the north-star concepts. */
export function ChatFamilyPill({ active }: { active: ChatFamilyId }) {
  return <FamilyPill label="Chat family" active={active} items={[...FAMILY]} />;
}
