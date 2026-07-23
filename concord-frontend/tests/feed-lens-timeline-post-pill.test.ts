// DET-C batch 3 — 'timeline:post' dead_socket_emit fix.
//
// server.js broadcasts a real, correctly-scoped-to-global 'timeline:post'
// event for every DTU tagged 'timeline' with privacy:'public' (see the
// emit site's own comment: "so they appear instantly in other players'
// feeds"), but nothing on the frontend ever subscribed to it — a real,
// literal, zero-consumer dead emit (flagged explicitly in the prior DET-C
// batch's notes, left unfixed pending a React-Query-aware integration).
//
// Fix: subscribe to it in the feed lens and surface a dismissible "N new
// posts" pill instead of auto-invalidating the infinite-scroll query
// (which would yank the reader's scroll position out from under them).
// Clicking the pill invalidates ['feed-posts'] — the same query key every
// existing mutation handler in this file already invalidates on success.
//
// The feed page pulls in a very large component/hook graph (see the
// existing full-render test tests/feed-lens-states.test.tsx); this follows
// the established source-pinning pattern for scoped wiring assertions
// (tests/world-lens-cinematic-camera-mode.test.ts) rather than re-mounting
// the whole page for one small feature.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(
  path.resolve(__dirname, '..', 'app/lenses/feed/page.tsx'),
  'utf8'
);
const socketSrc = readFileSync(
  path.resolve(__dirname, '..', 'lib/realtime/socket.ts'),
  'utf8'
);

describe("DET-C batch 3 — feed lens subscribes to 'timeline:post'", () => {
  it('imports subscribe from the realtime socket module', () => {
    expect(pageSrc).toMatch(/import \{ subscribe \} from '@\/lib\/realtime\/socket';/);
  });

  it("subscribes to the literal 'timeline:post' event name (statically greppable, not a template)", () => {
    expect(pageSrc).toMatch(/subscribe<\{ dtuId\?: string \}>\('timeline:post', \(\) => \{/);
  });

  it('increments a counter rather than auto-invalidating (does not yank scroll position)', () => {
    const effectBlock = pageSrc.match(/useEffect\(\(\) => \{\s*const off = subscribe<\{ dtuId\?: string \}>\('timeline:post'[\s\S]*?\n {2}\}, \[\]\);/);
    expect(effectBlock).toBeTruthy();
    expect(effectBlock![0]).toMatch(/setNewPostCount\(\(n\) => n \+ 1\)/);
    expect(effectBlock![0]).not.toMatch(/invalidateQueries/);
  });

  it("clicking the pill (showNewPosts) resets the counter and invalidates the exact ['feed-posts'] query key every other mutation handler already uses", () => {
    const showNewPostsBlock = pageSrc.match(/const showNewPosts = useCallback\(\(\) => \{[\s\S]*?\n {2}\}, \[queryClient\]\);/);
    expect(showNewPostsBlock).toBeTruthy();
    expect(showNewPostsBlock![0]).toMatch(/setNewPostCount\(0\)/);
    expect(showNewPostsBlock![0]).toMatch(/queryClient\.invalidateQueries\(\{ queryKey: \['feed-posts'\] \}\)/);
  });

  it('renders the pill only when newPostCount > 0, wired to showNewPosts', () => {
    expect(pageSrc).toMatch(/\{newPostCount > 0 && \(/);
    expect(pageSrc).toMatch(/onClick=\{showNewPosts\}/);
  });

  it("'timeline:post' is a member of the shared SocketEvent union (typed subscribe call)", () => {
    expect(socketSrc).toMatch(/\| 'timeline:post'/);
  });
});
