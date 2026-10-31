// Ramaj's iPhone: a phone that another account used keeps that account's chat
// session id in localStorage. The server refuses it (session_forbidden) and the
// chat used to print "may be overloaded or misconfigured". It must instead start
// a new chat, resend, and show the answer. Backend fully mocked.
import { test, expect, devices } from '@playwright/test';
import { blockUnmockedApi, corsFulfill, mockAuthSuccess } from './_helpers';

// A device descriptor carries defaultBrowserType, which test.use() rejects inside
// a describe; the chromium project runs the iPhone 14 viewport/UA/touch profile.
const { defaultBrowserType: _ignored, ...iphone14 } = devices['iPhone 14'];
test.use(iphone14);

const sse = (events: Array<Record<string, unknown>>) =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

test('stale session from another account: new chat + answer, never "misconfigured"', async ({ page }) => {
  await blockUnmockedApi(page);
  await mockAuthSuccess(page);
  await page.addInitScript(() => {
    try { localStorage.setItem('concord_chat_session', 'session-owned-by-someone-else'); } catch { /* storage off */ }
  });

  const sessionIds: Array<string | null> = [];
  await page.route('**/api/chat/stream', async (route) => {
    if (route.request().method() === 'OPTIONS') return corsFulfill(route, { status: 204 });
    const body = JSON.parse(route.request().postData() || '{}');
    sessionIds.push(body.sessionId ?? null);
    const forbidden = body.sessionId === 'session-owned-by-someone-else';
    const events = forbidden
      ? [{ ok: true, progress: { stage: 'accepted' }, done: false },
         { ok: false, done: true, out: { ok: false, error: 'session_forbidden', reason: 'not_owner_or_participant' } }]
      : [{ ok: true, chunk: 'Hello from the model', done: false },
         { ok: true, done: true, out: { ok: true, reply: 'Hello from the model' } }];
    return corsFulfill(route, { status: 200, contentType: 'text/event-stream', body: sse(events) });
  });

  await page.goto('/lenses/chat');
  const composer = page.getByPlaceholder(/^Message /);
  await composer.fill('hi');
  await page.getByLabel('Send message').click();

  await expect(page.getByText('Hello from the model')).toBeVisible();
  await expect(page.getByText(/misconfigured/i)).toHaveCount(0);
  // Mobile fit: the answer is inside the viewport, nothing scrolls sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // A foreign id is never reused for the retry.
  expect(sessionIds.filter((s) => s === 'session-owned-by-someone-else').length).toBeLessThanOrEqual(1);
  expect(sessionIds.at(-1)).not.toBe('session-owned-by-someone-else');
});
