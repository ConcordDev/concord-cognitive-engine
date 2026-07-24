// server/domains/notebook.js
//
// V1.2 Wave E grounding audit — cross-domain reproducible notebooks
// (server/lib/notebook.js, server/migrations/384_cross_domain_notebooks.js).
//
// A notebook's cells are REAL macro-call records from ANY domain (chem,
// bio, math-adjacent register()-based macros, dtu.*, …), executed through
// `ctx.macro.run` — the SAME internal macro-invocation mechanism this
// codebase already uses everywhere a macro calls another macro (see
// server.js `makeCtx`/`makeInternalCtx`, and e.g.
// `server/lib/forge-marketplace.js#listForgeAppOnMarketplace`). This domain
// never reimplements any per-domain "lab notebook" (chem.js/bio.js/
// science.js/lab.js all keep their own real logs) — it only records what
// a real macro call actually did, in order, with honest reproducibility.
//
// Registered from server.js: registerNotebookMacros(register).

import {
  createNotebook, listNotebooks, getNotebook, addCell, replayCell,
} from "../lib/notebook.js";

export default function registerNotebookMacros(register) {
  register("notebook", "create", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return createNotebook(db, userId, input.title, { description: input.description });
  }, { note: "create a cross-domain reproducible notebook (a container for real macro-call cells)" });

  register("notebook", "list-mine", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, notebooks: listNotebooks(db, userId, { limit: input.limit }) };
  }, { note: "list the caller's own notebooks, newest-updated first, with a cheap cell count" });

  register("notebook", "get", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.notebookId) return { ok: false, reason: "missing_notebook_id" };
    return getNotebook(db, userId, input.notebookId);
  }, { note: "fetch a notebook + all its real cells in order" });

  register("notebook", "add-cell", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.notebookId) return { ok: false, reason: "missing_notebook_id" };
    if (!ctx?.macro?.run) return { ok: false, reason: "no_macro_runtime" };
    return addCell(
      db, userId, input.notebookId,
      { domain: input.domain, action: input.action, input: input.input },
      ctx.macro.run,
      // ctx.state?.dtus is the live write-through DTU store (same access
      // pattern as server/domains/agent-projects.js#get) — its absence
      // (e.g. a minimal test harness with no live state) degrades the
      // optional citation lookup honestly rather than fabricating one.
      { citeParentDtuId: input.citeParentDtuId, dtus: ctx?.state?.dtus },
    );
  }, { note: "execute a REAL macro call (domain.action) and record it as a new notebook cell" });

  register("notebook", "replay-cell", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.notebookId) return { ok: false, reason: "missing_notebook_id" };
    if (!input.cellId) return { ok: false, reason: "missing_cell_id" };
    if (!ctx?.macro?.run) return { ok: false, reason: "no_macro_runtime" };
    return replayCell(db, userId, input.notebookId, input.cellId, ctx.macro.run);
  }, { note: "re-invoke an earlier cell's exact macro call; returns an honest matched/diff verdict, never a fabricated 'reproduced' claim" });
}
