// scripts/lens-proof-trades.mjs — REAL browser proof for the Trades lens.
//
// Headless Chrome via Playwright (channel: 'chrome'), shared proof user:
//   0. header chip reads "Real" (never "Simulated"), no SIM_GRADE copy
//   1. Workbench → Customers → New customer (customer-upsert) → listed
//   2. Workbench → Dispatch → New job for that customer (job-create) → card
//   3. Payments: record a request — listed, no fake "Copy link"; Reminders:
//      log an SMS reminder — shows "not sent"
//   4. full reload → the customer and job are still there
//   5. kill -9 restart of the proof API → reload → still there
//   6. Keep this job → Save job as DTU (dtu.create + read-back; title carries
//      the job id) → Draft in Thread → trades.png; dtu.get + thread.draft-detail
//   7. /lenses/thread → Composer lists the draft citing the DTU (trades-thread.png)
//
// Run: node scripts/lens-proof-trades.mjs   Env: PROOF_BASE_URL (default http://localhost:5399)
import { execFileSync } from 'node:child_process';
import {
  mkLog, openBrowser, login, gotoLens, pageLensRun, keepToDtuAndThread, keepMenu, verifyReadBack,
  verifyThreadHandoff, shot, checkDisk,
} from './lens-proof-lib.mjs';

const log = mkLog('trades');
const result = {};
const RESTART = '/private/tmp/concord-fitness-proof/restart-5299.sh';
const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
const CUSTOMER = `Proof Customer ${stamp}`;
const DESC = `Proof job ${stamp}: replace the water heater`;
const INV = `INV-${stamp}`;

async function dismiss(page) {
  for (const name of [/^Reject$/, /Skip onboarding/]) {
    const b = page.getByRole('button', { name }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}
const side = (page, label) => page.getByRole('navigation', { name: 'Trades ops' }).getByRole('button', { name: label, exact: true });
const workbench = (page) => page.getByText('Trades Workbench', { exact: true }).locator('xpath=ancestor::div[contains(@class,"flex-col")][1]');
const jobCard = (page) => workbench(page).locator('div.rounded.border', { hasText: DESC }).first();

async function openWorkbench(page) {
  const b = side(page, 'Workbench');
  await b.waitFor({ state: 'visible', timeout: 90000 });
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await workbench(page).waitFor({ state: 'visible', timeout: 60000 });
}

async function expectState(page, label) {
  await openWorkbench(page);
  await jobCard(page).waitFor({ state: 'visible', timeout: 60000 });
  const cardText = (await jobCard(page).innerText()).replace(/\s+/g, ' ');
  await workbench(page).getByRole('button', { name: /Customers/ }).click();
  const cust = await workbench(page).getByText(CUSTOMER, { exact: true }).first().isVisible({ timeout: 30000 }).catch(() => false);
  await workbench(page).getByText(CUSTOMER, { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  const custNow = cust || await workbench(page).getByText(CUSTOMER, { exact: true }).first().isVisible().catch(() => false);
  await workbench(page).getByRole('button', { name: /Dispatch/ }).first().click();
  const got = { job: cardText.includes(result.jobNumber) && cardText.includes(CUSTOMER), customer: custNow };
  log(label, JSON.stringify(got), '—', cardText.slice(0, 140));
  if (!got.job || !got.customer) throw new Error(`${label}: records not restored ${JSON.stringify(got)}`);
  await jobCard(page).waitFor({ state: 'visible', timeout: 60000 });
  return got;
}

const { browser, ctx, page } = await openBrowser(log);
try {
  checkDisk(log);
  await login(ctx, log);
  await gotoLens(page, '/lenses/trades', log);
  await page.getByText('Real', { exact: true }).first().waitFor({ state: 'visible', timeout: 90000 });
  await page.getByRole('button', { name: /^Reject$/ }).first()
    .waitFor({ state: 'visible', timeout: 10000 }).then(() => dismiss(page), () => {});
  await dismiss(page);
  result.badge = 'Real';
  result.simulatedChips = await page.getByText('Simulated', { exact: true }).count();
  const body = await page.locator('body').innerText();
  log('header chip: Real — "Simulated" chips:', result.simulatedChips, '— SIM_GRADE copy:', /SIM_GRADE|Not real data/.test(body));
  if (result.simulatedChips || /SIM_GRADE|Not real data/.test(body)) throw new Error('Trades still shows a Simulated chip / SIM_GRADE copy');

  // 1. Customer.
  await openWorkbench(page);
  const wb = workbench(page);
  await wb.getByRole('button', { name: /Customers/ }).click();
  await wb.getByRole('button', { name: /New customer/ }).click();
  await wb.getByPlaceholder('name', { exact: true }).fill(CUSTOMER);
  await wb.getByPlaceholder('phone', { exact: true }).fill('555-0142');
  await wb.getByPlaceholder('address', { exact: true }).fill('12 Proof Lane');
  await wb.getByRole('button', { name: /^Save$/ }).click();
  await wb.getByText(CUSTOMER, { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  const custs = await pageLensRun(page, 'trades', 'customer-list', {});
  result.customerId = (custs.result?.customers || []).find((c) => c.name === CUSTOMER)?.id || null;
  log('customer created:', CUSTOMER, result.customerId);
  if (!result.customerId) throw new Error('customer not saved');

  // 2. Job.
  await wb.getByRole('button', { name: /Dispatch/ }).first().click();
  await wb.getByRole('button', { name: /New job/ }).click();
  const form = wb.locator('div.rounded.border', { has: page.getByPlaceholder('Description of the job') }).first();
  await form.locator('select').first().selectOption({ label: CUSTOMER });
  await form.getByPlaceholder('Description of the job').fill(DESC);
  await form.locator('select').nth(1).selectOption('high');
  await form.getByPlaceholder('Est. hrs').fill('4');
  await form.getByRole('button', { name: /Dispatch/ }).click();
  await jobCard(page).waitFor({ state: 'visible', timeout: 30000 });
  const jobs = await pageLensRun(page, 'trades', 'job-list', {});
  const job = (jobs.result?.jobs || []).find((j) => j.description === DESC);
  if (!job) throw new Error('job not saved');
  Object.assign(result, { jobId: job.id, jobNumber: job.number, priority: job.priority, estimatedHours: job.estimatedHours });
  log('job created:', job.number, job.id, job.priority, job.estimatedHours + 'h', 'for', job.customerName);

  // 3. Payments + reminders say what they are.
  await side(page, 'Payments').click();
  await page.getByText(/Online checkout isn.t connected yet/).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.getByPlaceholder('Invoice ref').fill(INV);
  await page.getByPlaceholder('Amount $').fill('120');
  await page.getByRole('button', { name: /Record/ }).click();
  await page.getByText(INV, { exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  result.copyLinkButtons = await page.getByTitle('Copy link').count();
  log('payment request', INV, 'recorded — Copy link buttons:', result.copyLinkButtons);
  if (result.copyLinkButtons) throw new Error('fake Copy link still offered');
  await side(page, 'Reminders').click();
  await page.getByText(/reminders are logged here and not sent/).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.getByPlaceholder('Phone number').fill('555-0142');
  await page.getByPlaceholder('Message to the customer').fill(`Tech arriving 9am (${stamp})`);
  await page.getByRole('button', { name: /Log SMS reminder/ }).click();
  const remRow = page.locator('li', { hasText: `Tech arriving 9am (${stamp})` }).first();
  await remRow.waitFor({ state: 'visible', timeout: 30000 });
  result.reminderStatus = (await remRow.locator('span', { hasText: /sent/ }).last().innerText()).trim();
  log('reminder logged — status chip:', result.reminderStatus);
  if (result.reminderStatus.toLowerCase() !== 'not sent') throw new Error('reminder status is ' + result.reminderStatus);

  // 4. Reload survival.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await dismiss(page);
  result.afterReload = await expectState(page, 'after full reload:');
  await page.screenshot({ path: shot('trades-reload.png') });
  log('screenshot: trades-reload.png');

  // 5. kill -9 restart survival (state saves coalesce in a 5 s window).
  await page.waitForTimeout(8000);
  log('kill -9 restart of the proof API:', execFileSync('/bin/sh', [RESTART], { encoding: 'utf8', timeout: 240000 }).trim().replace(/\n/g, ' | '));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForTimeout(6000);
  if (/\/login/.test(page.url())) {
    log('session did not survive the restart (new JWT secret per boot); logging in again');
    await login(ctx, log);
    await gotoLens(page, '/lenses/trades', log);
  }
  await dismiss(page);
  result.afterRestart = await expectState(page, 'after kill -9 restart:');
  await page.screenshot({ path: shot('trades-restart.png') });
  log('screenshot: trades-restart.png');

  // 6. Keep → DTU → Thread from the job's card.
  const menu = keepMenu(jobCard(page), 'Keep this job');
  await menu.waitFor({ state: 'visible', timeout: 30000 });
  const ids = await keepToDtuAndThread(page, menu, log);
  Object.assign(result, ids);
  await menu.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('trades.png') });
  log('screenshot: trades.png');
  Object.assign(result, await verifyReadBack(page, ids, 'trades-lens:job-report', log));
  const dtu = await pageLensRun(page, 'dtu', 'get', { id: ids.dtuId });
  result.dtuTitle = dtu.result?.dtu?.title || dtu.result?.title || '';
  log('DTU title:', result.dtuTitle);
  if (!result.dtuTitle.includes(result.jobId)) throw new Error('DTU title does not carry the job id');

  result.threadHandoff = await verifyThreadHandoff(page, ids, shot('trades-thread.png'), log);
  log('RESULT', JSON.stringify(result));
} catch (e) {
  log('PROOF FAILED:', e?.message || e);
  try { await page.screenshot({ path: shot('trades-failed.png') }); log('failure screenshot: trades-failed.png'); } catch {}
  log('PARTIAL', JSON.stringify(result));
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
