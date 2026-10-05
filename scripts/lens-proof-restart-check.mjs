// scripts/lens-proof-restart-check.mjs — after a hard kill -9 + restart of the
// proof API, log in again in Chrome and confirm the lens record, its DTU, and
// the Thread draft citing it all came back, and that the Thread Composer
// still lists the draft.
//
// Run: node scripts/lens-proof-restart-check.mjs <lens> <domain> <listAction> <text> <dtuId> <draftId> [listInputJSON]
import {
  mkLog, openBrowser, login, gotoLens, pageLensRun, verifyReadBack, verifyThreadHandoff,
} from './lens-proof-lib.mjs';

const [lens, domain, listAction, text, dtuId, draftId, listInput = '{}'] = process.argv.slice(2);
const log = mkLog(`${lens}-restart`);
const { browser, ctx, page } = await openBrowser(log);
try {
  await login(ctx, log);
  await gotoLens(page, `/lenses/${lens}`, log);
  const list = await pageLensRun(page, domain, listAction, JSON.parse(listInput));
  const found = JSON.stringify(list.result || {}).includes(text);
  log(`${domain}.${listAction} still contains "${text}"?`, found);
  if (!found) throw new Error('lens record missing after restart');
  await verifyReadBack(page, { dtuId, draftId }, null, log);
  await verifyThreadHandoff(page, { dtuId, draftId }, null, log);
  log('RESTART OK');
} catch (e) {
  log('RESTART CHECK FAILED:', e?.message || e);
  process.exitCode = 1;
} finally {
  await ctx.close();
  await browser.close();
}
