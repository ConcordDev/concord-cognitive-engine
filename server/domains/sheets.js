// server/domains/sheets.js
//
// Real Google Sheets connector. Thin macros over the SSRF-guarded connector
// egress (lib/connector-client.js), reading the user's stored OAuth token
// (connector_id "google_sheets") with auto-refresh rotation. Inbound read
// (values.get) + outbound write (values.append). Honest reason codes when no
// token / not configured — never faked data.

import { readGoogleSheet, appendGoogleSheetRow } from "../lib/connector-client.js";

const SHEETS_ENABLED = process.env.CONCORD_SHEETS_ENABLED !== "0";

export default function registerSheetsActions(registerLensAction) {
  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const fail = (res, fallback) => {
    const reason = res?.reason || fallback;
    return { ok: false, reason, error: reason, detail: res };
  };
  const guard = (ctx) => {
    if (!SHEETS_ENABLED) return { ok: false, reason: "sheets_disabled", error: "sheets_disabled" };
    const userId = uid(ctx);
    if (!userId || userId === "anon") return { ok: false, reason: "no_user", error: "no_user" };
    if (!ctx?.db) return { ok: false, error: "db unavailable" };
    return null;
  };

  // Read a range. params: { spreadsheetId, range? }
  registerLensAction("sheets", "read", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    const spreadsheetId = params.spreadsheetId || params.id;
    if (!spreadsheetId) return { ok: false, error: "spreadsheetId required" };
    try {
      const res = await readGoogleSheet(ctx.db, uid(ctx), spreadsheetId, params.range || "A1:Z1000");
      if (!res.ok) return fail(res, "read_failed");
      return { ok: true, result: { range: res.range, values: res.values, rowCount: res.rowCount } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Append a row. params: { spreadsheetId, range?, values: any[] }
  registerLensAction("sheets", "append", async (ctx, _a, params = {}) => {
    const bad = guard(ctx); if (bad) return bad;
    const spreadsheetId = params.spreadsheetId || params.id;
    if (!spreadsheetId) return { ok: false, error: "spreadsheetId required" };
    if (!params.values) return { ok: false, error: "values required" };
    try {
      const res = await appendGoogleSheetRow(ctx.db, uid(ctx), spreadsheetId, params.range, params.values);
      if (!res.ok) return fail(res, "append_failed");
      return { ok: true, result: { updatedRange: res.updatedRange, updatedRows: res.updatedRows } };
    } catch (e) {
      return { ok: false, error: "handler_error", message: String(e?.message || e) };
    }
  });

  // Authorize URL. Tokens persist under connector_id "google_sheets". The
  // spreadsheets scope covers both read + append (real two-way).
  registerLensAction("sheets", "connect", (_ctx, _a, params = {}) => {
    const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
    const qs = new URLSearchParams({ token_key: "google_sheets", scopes: scopes.join(" ") });
    if (params.redirect) qs.set("redirect", String(params.redirect));
    return { ok: true, result: { provider: "google", authorizeUrl: `/api/oauth/google/authorize?${qs.toString()}`, scopes } };
  });
}
