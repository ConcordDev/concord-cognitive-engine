// scripts/lens-proof-timeline.mjs — REAL browser proof for the Timeline lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   0. honesty: no "Demo" chip, no empty "↓ .dtu" export button in the header
//   1. /lenses/timeline?tab=feed → composer "What's on your mind?" → a unique
//      post → "Only me" privacy → Post (timeline.post-create) → the post card
//      renders from timeline.feed-list
//   2. the card's "Keep" → "Save as private DTU" (dtu.create + dtu.get
//      read-back in the UI) → "Send this DTU to Thread" (thread.thread-draft
//      citing the DTU) → timeline.png
//   3. independent read-back: dtu.get + thread.draft-detail
//   4. full reload → Feed → the post is still listed
//   5. /lenses/thread → Composer lists the draft citing the DTU (timeline-thread.png)
//
// Run: node scripts/lens-proof-timeline.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import {
  mkLog, openBrowser, login, gotoLens, pageLensRun, verifyReadBack, verifyThreadHandoff, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('timeline');
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const TEXT = `Proof timeline post ${stamp}: logged a real run of the timeline lens.`;
const result = { text: TEXT };

const { browser, ctx, page } = await openBrowser(log);
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/timeline?tab=feed', log);
  const box = page.locator('textarea[placeholder="What\'s on your mind?"]').first();
  await box.waitFor({ state: 'visible', timeout: 90000 });
  await page.getByRole('button', { name: /^Reject$/ }).first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => page.getByRole('button', { name: /^Reject$/ }).first().click(), () => {});
  result.demoChips = await page.getByText('Demo', { exact: true }).count();
  result.emptyDtuExportButtons = await page.getByRole('button', { name: /\.dtu/ }).count();
  log('"Demo" chips:', result.demoChips, '— "↓ .dtu" export buttons:', result.emptyDtuExportButtons);
  if (result.demoChips || result.emptyDtuExportButtons) throw new Error('Demo chip or empty .dtu export still rendered');

  // 1. Post for real.
  await box.fill(TEXT);
  await page.locator('button[title="Only me"]').first().click();
  await page.getByRole('button', { name: /^Post$/ }).first().click();
  const card = page.locator('article, div').filter({ hasText: TEXT }).filter({ has: page.getByRole('button', { name: /^Keep$/ }) }).last();
  await card.waitFor({ state: 'visible', timeout: 60000 });
  const feed = await pageLensRun(page, 'timeline', 'feed-list', { limit: 30, offset: 0 });
  const post = (feed.result?.posts || []).find((p) => p.content === TEXT);
  result.postId = post?.id || null;
  result.privacy = post?.privacy || null;
  if (!result.postId) throw new Error('post not in timeline.feed-list');
  log('post created and listed:', result.postId, 'privacy:', result.privacy);

  // 2. Keep → DTU → Thread.
  await card.getByRole('button', { name: /^Keep$/ }).click();
  const menu = card.getByRole('group', { name: 'Keep this post' });
  await menu.waitFor({ state: 'visible', timeout: 15000 });
  await menu.getByRole('button', { name: /Save as private DTU/ }).click();
  const saved = menu.locator('[role="status"]', { hasText: /Saved as private DTU|Not saved/ }).first();
  await saved.waitFor({ state: 'visible', timeout: 60000 });
  const savedText = (await saved.innerText()).trim();
  log('save status:', savedText);
  const dtuId = (savedText.match(/Saved as private DTU (\S+?)\.$/) || [])[1];
  if (!dtuId) throw new Error('DTU not saved: ' + savedText);
  await menu.getByRole('button', { name: /Send this DTU to Thread/ }).click();
  const sent = menu.locator('[role="status"]', { hasText: /Sent DTU|Not sent|came back|without DTU/ }).first();
  await sent.waitFor({ state: 'visible', timeout: 60000 });
  const sentText = (await sent.innerText()).trim();
  log('draft status:', sentText);
  const draftId = (sentText.match(/as draft (\S+?)\. Not posted/) || [])[1];
  if (!draftId) throw new Error('Thread draft not created: ' + sentText);
  const ids = { dtuId, draftId };
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('timeline.png') });
  log('screenshot: timeline.png');

  Object.assign(result, await verifyReadBack(page, ids, 'timeline-lens:post', log));

  // 4. Reload survival through the UI.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.getByText(TEXT).first().waitFor({ state: 'visible', timeout: 90000 });
  result.survivedReload = true;
  log('after full reload the post is still in the feed');

  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('timeline-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('timeline-failed.png') }); log('failure screenshot: timeline-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
