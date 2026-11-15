import { describe, it, expect } from 'vitest';
import { resolveAskThread } from '@/components/chat/chatLocalStore';

describe('resolveAskThread', () => {
  const convs = [
    { id: 'auto', title: 'Automotive', lensContext: 'automotive' },
    { id: 'old', title: 'Link Frontier' },
  ];

  it('reuses the thread already filed under the lens', () => {
    expect(resolveAskThread(convs, 'old', 'automotive')).toBe('auto');
  });

  it('does not append a lens ask onto an unrelated open thread', () => {
    expect(resolveAskThread(convs, 'old', 'hvac')).toBeNull();
  });

  it('keeps the current thread when Ask did not name a lens', () => {
    expect(resolveAskThread(convs, 'old', null)).toBe('old');
  });
});
