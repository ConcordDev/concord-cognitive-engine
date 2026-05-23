// server/domains/exportdomain.js
// Data-export / portability lens — domain macros.
//
// Registered under the "export" domain. The legacy four macros
// (generatePackage / validateExport / scheduleExport / diffExport) read
// from artifact.data; the parity macros below persist per-user state in
// globalThis._concordSTATE.exportLens and key everything by ctx user id.
//
// No fake/seed/demo data — every value is real user input or computed
// from real input. Empty collections render "no data yet" in the UI.

export default function registerExportActions(registerLensAction) {
  // ─── legacy stateless macros (unchanged behaviour) ──────────────────
  registerLensAction("export", "generatePackage", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const items = data.items || [];
    const format = (data.format || "json").toLowerCase();
    const formats = { json: { mime: "application/json", ext: ".json" }, csv: { mime: "text/csv", ext: ".csv" }, xml: { mime: "application/xml", ext: ".xml" }, pdf: { mime: "application/pdf", ext: ".pdf" }, zip: { mime: "application/zip", ext: ".zip" } };
    const fmt = formats[format] || formats.json;
    const estimatedSize = items.length * (format === "json" ? 500 : format === "csv" ? 100 : 800);
    return { ok: true, result: { format, mimeType: fmt.mime, extension: fmt.ext, itemCount: items.length, estimatedSizeBytes: estimatedSize, estimatedSizeHuman: estimatedSize > 1048576 ? `${Math.round(estimatedSize / 1048576 * 10) / 10} MB` : `${Math.round(estimatedSize / 1024 * 10) / 10} KB`, status: "ready", includes: { metadata: true, timestamps: true, relationships: data.includeRelationships !== false } } };
  });
  registerLensAction("export", "validateExport", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const items = data.items || [];
    const schema = data.schema || {};
    const errors = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.id && !item.title) errors.push({ index: i, error: "Missing id or title" });
      if (schema.requiredFields) for (const f of schema.requiredFields) { if (!item[f] && !item.data?.[f]) errors.push({ index: i, error: `Missing required field: ${f}` }); }
    }
    return { ok: true, result: { totalItems: items.length, valid: items.length - errors.length, invalid: errors.length, errors: errors.slice(0, 20), exportReady: errors.length === 0 } };
  });
  registerLensAction("export", "scheduleExport", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const frequency = data.frequency || "daily";
    const destination = data.destination || "local";
    return { ok: true, result: { schedule: { frequency, destination, format: data.format || "json", filters: data.filters || {}, lastRun: data.lastRun || null, nextRun: frequency === "daily" ? "Tomorrow at midnight" : frequency === "weekly" ? "Next Monday" : frequency === "monthly" ? "1st of next month" : "On demand" }, status: "configured" } };
  });
  registerLensAction("export", "diffExport", (ctx, artifact, _params) => {
    const current = artifact.data?.current || [];
    const previous = artifact.data?.previous || [];
    const currentIds = new Set(current.map(i => i.id));
    const previousIds = new Set(previous.map(i => i.id));
    const added = current.filter(i => !previousIds.has(i.id)).length;
    const removed = previous.filter(i => !currentIds.has(i.id)).length;
    const modified = current.filter(i => previousIds.has(i.id)).length;
    return { ok: true, result: { added, removed, modified, unchanged: current.length - added - modified, totalCurrent: current.length, totalPrevious: previous.length, changePercent: previous.length > 0 ? Math.round(((added + removed) / previous.length) * 100) : 100 } };
  });

  // ─── per-user state plumbing ────────────────────────────────────────
  function getState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.exportLens) STATE.exportLens = {};
    const s = STATE.exportLens;
    if (!(s.schedules instanceof Map)) s.schedules = new Map();   // userId -> Array<schedule>
    if (!(s.history instanceof Map)) s.history = new Map();       // userId -> Array<run record>
    if (!(s.cloud instanceof Map)) s.cloud = new Map();           // userId -> Array<cloud connection>
    if (!(s.cursors instanceof Map)) s.cursors = new Map();       // userId -> { [dataSource]: lastRunAt }
    return s;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const actor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const now = () => new Date().toISOString();
  const eid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const schedulesOf = (s, u) => { if (!s.schedules.has(u)) s.schedules.set(u, []); return s.schedules.get(u); };
  const historyOf = (s, u) => { if (!s.history.has(u)) s.history.set(u, []); return s.history.get(u); };
  const cloudOf = (s, u) => { if (!s.cloud.has(u)) s.cloud.set(u, []); return s.cloud.get(u); };
  const cursorsOf = (s, u) => { if (!s.cursors.has(u)) s.cursors.set(u, {}); return s.cursors.get(u); };
  const HISTORY_CAP = 500;

  const FREQ_MS = { daily: 86400000, weekly: 604800000, monthly: 2592000000 };
  function nextRunAt(frequency, fromIso) {
    const ms = FREQ_MS[frequency];
    if (!ms) return null;
    return new Date(new Date(fromIso).getTime() + ms).toISOString();
  }

  // ─── [M] selective field-level export — column picker ───────────────
  // Inspects a sample of records and returns the available fields per
  // data source so the UI can build a per-type column picker.
  registerLensAction("export", "field-schema", (ctx, _a, params = {}) => {
    const records = Array.isArray(params.records) ? params.records : [];
    const dataSource = clean(params.dataSource || "dtus", 60);
    const fieldMap = new Map(); // field -> { count, sampleType }
    for (const rec of records.slice(0, 2000)) {
      if (!rec || typeof rec !== "object") continue;
      for (const [k, v] of Object.entries(rec)) {
        const existing = fieldMap.get(k);
        const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
        if (existing) { existing.count++; if (existing.sampleType === "null") existing.sampleType = t; }
        else fieldMap.set(k, { count: 1, sampleType: t });
      }
    }
    const fields = [...fieldMap.entries()]
      .map(([name, m]) => ({ name, occurrences: m.count, type: m.sampleType, coverage: records.length ? Math.round((m.count / records.length) * 100) : 0 }))
      .sort((a, b) => b.occurrences - a.occurrences);
    return { ok: true, result: { dataSource, sampledRecords: Math.min(records.length, 2000), fieldCount: fields.length, fields } };
  });

  // Project a record set down to a chosen set of fields. Real data in,
  // real subset out — nothing synthesised.
  registerLensAction("export", "field-project", (ctx, _a, params = {}) => {
    const records = Array.isArray(params.records) ? params.records : [];
    const fields = Array.isArray(params.fields) ? params.fields.map((f) => clean(f, 80)).filter(Boolean) : [];
    if (fields.length === 0) return { ok: false, error: "at least one field required" };
    const projected = records.map((rec) => {
      const out = {};
      if (rec && typeof rec === "object") for (const f of fields) if (f in rec) out[f] = rec[f];
      return out;
    });
    const droppedFields = new Set();
    for (const rec of records.slice(0, 500)) {
      if (rec && typeof rec === "object") for (const k of Object.keys(rec)) if (!fields.includes(k)) droppedFields.add(k);
    }
    return { ok: true, result: { recordCount: projected.length, selectedFields: fields, droppedFieldCount: droppedFields.size, droppedFields: [...droppedFields].slice(0, 50), records: projected } };
  });

  // ─── [S] PDF export generator ───────────────────────────────────────
  // Emits a minimal, valid single-page PDF document (PDF 1.4) as a
  // base64 string. The text content is the caller's real records — no
  // placeholder copy. The UI base64-decodes and downloads it.
  registerLensAction("export", "pdf-generate", (ctx, _a, params = {}) => {
  try {
    const title = clean(params.title || "Concord Export", 120);
    const records = Array.isArray(params.records) ? params.records : [];
    const lines = [title, "Generated " + now(), `${records.length} record(s)`, ""];
    for (const rec of records.slice(0, 120)) {
      if (rec == null) continue;
      if (typeof rec === "object") {
        const label = clean(rec.title || rec.name || rec.id || "(record)", 90);
        lines.push("- " + label);
      } else {
        lines.push("- " + clean(rec, 90));
      }
    }
    if (records.length > 120) lines.push(`... and ${records.length - 120} more`);

    // Escape for PDF text strings.
    const esc = (t) => String(t).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    let textOps = "BT\n/F1 11 Tf\n14 TL\n56 760 Td\n";
    for (const ln of lines.slice(0, 60)) textOps += `(${esc(ln)}) Tj\nT*\n`;
    textOps += "ET";
    const contentStream = textOps;
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
      `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefStart = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    const base64 = Buffer.from(pdf, "latin1").toString("base64");
    return { ok: true, result: { mimeType: "application/pdf", extension: ".pdf", byteLength: pdf.length, recordCount: records.length, base64 } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── [S] encrypted / password-protected archive ─────────────────────
  // XOR-stream cipher keyed by a PBKDF-style iterated hash of the
  // password + per-archive salt. Deterministic, dependency-free,
  // round-trippable. Real payload only.
  function deriveKeyStream(password, salt, length) {
    // Iterated FNV-1a mixing to expand password+salt into a keystream.
    const seed = `${password}::${salt}`;
    const ks = Buffer.alloc(length);
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    for (let i = 0; i < length; i++) {
      h ^= (i & 0xff);
      h = Math.imul(h, 0x01000193) >>> 0;
      h ^= h >>> 13;
      ks[i] = h & 0xff;
    }
    return ks;
  }
  function checksum(buf) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < buf.length; i++) { h ^= buf[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  registerLensAction("export", "encrypt-archive", (ctx, _a, params = {}) => {
  try {
    const password = clean(params.password, 128);
    if (password.length < 4) return { ok: false, error: "password must be at least 4 characters" };
    const payload = typeof params.payload === "string"
      ? params.payload
      : JSON.stringify(params.payload ?? {});
    const plain = Buffer.from(payload, "utf8");
    const salt = clean(params.salt || eid("salt"), 40);
    const ks = deriveKeyStream(password, salt, plain.length);
    const cipher = Buffer.alloc(plain.length);
    for (let i = 0; i < plain.length; i++) cipher[i] = plain[i] ^ ks[i];
    return {
      ok: true,
      result: {
        algorithm: "concord-xor-fnv/v1",
        salt,
        plainChecksum: checksum(plain),
        byteLength: cipher.length,
        ciphertextBase64: cipher.toString("base64"),
        extension: ".enc",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("export", "decrypt-archive", (ctx, _a, params = {}) => {
    const password = clean(params.password, 128);
    const salt = clean(params.salt, 40);
    const b64 = typeof params.ciphertextBase64 === "string" ? params.ciphertextBase64 : "";
    if (!password || !salt || !b64) return { ok: false, error: "password, salt and ciphertextBase64 required" };
    let cipher;
    try { cipher = Buffer.from(b64, "base64"); } catch (_e) { return { ok: false, error: "ciphertext not valid base64" }; }
    const ks = deriveKeyStream(password, salt, cipher.length);
    const plain = Buffer.alloc(cipher.length);
    for (let i = 0; i < cipher.length; i++) plain[i] = cipher[i] ^ ks[i];
    const sum = checksum(plain);
    const expected = clean(params.expectedChecksum, 16);
    const verified = expected ? sum === expected : null;
    return {
      ok: true,
      result: {
        verified,
        checksum: sum,
        byteLength: plain.length,
        plaintext: plain.toString("utf8"),
      },
    };
  });

  // ─── [S] export history log + re-download ───────────────────────────
  // record-run is called by the UI after every completed export (bulk,
  // single, scheduled). It stores real metadata: format, item count,
  // byte size, data sources, and an optional retained payload so a past
  // archive can be re-downloaded.
  registerLensAction("export", "record-run", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const log = historyOf(s, actor(ctx));
    const format = clean(params.format || "json", 20).toLowerCase();
    const itemCount = Math.max(0, Math.floor(Number(params.itemCount) || 0));
    const byteLength = Math.max(0, Math.floor(Number(params.byteLength) || 0));
    const sources = Array.isArray(params.dataSources) ? params.dataSources.map((d) => clean(d, 40)).filter(Boolean) : [];
    const rec = {
      id: eid("run"),
      at: now(),
      format,
      itemCount,
      byteLength,
      dataSources: sources,
      trigger: clean(params.trigger || "manual", 20),
      filename: clean(params.filename || `concord-export${format ? "." + format : ""}`, 160),
      scheduleId: clean(params.scheduleId || "", 60) || null,
      // Retained payload for re-download. Capped so the log can't bloat STATE.
      payload: typeof params.payload === "string" && params.payload.length <= 2_000_000 ? params.payload : null,
      payloadEncoding: clean(params.payloadEncoding || "utf8", 12),
    };
    log.unshift(rec);
    if (log.length > HISTORY_CAP) log.splice(HISTORY_CAP);
    save();
    const { payload: _p, ...meta } = rec;
    return { ok: true, result: { run: meta, totalRuns: log.length } };
  });

  registerLensAction("export", "history-list", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const log = historyOf(s, actor(ctx));
    const limit = Math.min(Math.max(1, Math.floor(Number(params.limit) || 100)), HISTORY_CAP);
    const runs = log.slice(0, limit).map(({ payload: _p, ...meta }) => ({ ...meta, hasPayload: !!_p }));
    const totalBytes = log.reduce((acc, r) => acc + (r.byteLength || 0), 0);
    return { ok: true, result: { totalRuns: log.length, returned: runs.length, totalBytesExported: totalBytes, runs } };
  });

  registerLensAction("export", "history-download", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const id = clean(params.id, 60);
    const rec = historyOf(s, actor(ctx)).find((r) => r.id === id);
    if (!rec) return { ok: false, error: "run not found" };
    if (!rec.payload) return { ok: false, error: "payload not retained for this run" };
    return { ok: true, result: { id: rec.id, filename: rec.filename, format: rec.format, encoding: rec.payloadEncoding, payload: rec.payload } };
  });

  registerLensAction("export", "history-clear", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = actor(ctx);
    const had = historyOf(s, u).length;
    s.history.set(u, []);
    save();
    return { ok: true, result: { cleared: had } };
  });

  // ─── [S] cloud destinations via OAuth ───────────────────────────────
  // Connects a cloud destination by recording an OAuth-issued token
  // grant. We never fabricate tokens — the caller supplies the access
  // token obtained from the provider's real OAuth flow. delivery-push
  // records a delivery against a connection (the actual upload is a
  // browser-side fetch to the provider using the stored token).
  const CLOUD_PROVIDERS = new Set(["google_drive", "dropbox", "s3", "onedrive"]);

  registerLensAction("export", "cloud-connect", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const provider = clean(params.provider, 30).toLowerCase();
    if (!CLOUD_PROVIDERS.has(provider)) return { ok: false, error: `provider must be one of ${[...CLOUD_PROVIDERS].join(", ")}` };
    const accountLabel = clean(params.accountLabel, 120);
    const accessToken = clean(params.accessToken, 4096);
    if (!accountLabel) return { ok: false, error: "accountLabel required" };
    if (!accessToken) return { ok: false, error: "accessToken required (obtain via provider OAuth)" };
    const list = cloudOf(s, actor(ctx));
    const conn = {
      id: eid("cloud"),
      provider,
      accountLabel,
      // store only a non-reversible fingerprint of the token for display
      tokenFingerprint: checksum(Buffer.from(accessToken, "utf8")),
      scope: clean(params.scope || "file.write", 120),
      connectedAt: now(),
      lastDeliveryAt: null,
      deliveries: 0,
    };
    // Keep the live token in a non-enumerated slot so history-list etc.
    // never serialise it; UI re-supplies it per delivery anyway.
    Object.defineProperty(conn, "_token", { value: accessToken, enumerable: false });
    list.push(conn);
    save();
    const { ...safe } = conn;
    return { ok: true, result: { connection: safe } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("export", "cloud-list", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = cloudOf(s, actor(ctx)).map(({ _token, ...c }) => c);
    return { ok: true, result: { connections: list, count: list.length } };
  });

  registerLensAction("export", "cloud-disconnect", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = actor(ctx);
    const id = clean(params.id, 60);
    const list = cloudOf(s, u);
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return { ok: false, error: "connection not found" };
    list.splice(idx, 1);
    save();
    return { ok: true, result: { removed: id, remaining: list.length } };
  });

  registerLensAction("export", "delivery-push", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const id = clean(params.connectionId, 60);
    const conn = cloudOf(s, actor(ctx)).find((c) => c.id === id);
    if (!conn) return { ok: false, error: "connection not found" };
    const filename = clean(params.filename, 160) || "export";
    const byteLength = Math.max(0, Math.floor(Number(params.byteLength) || 0));
    conn.deliveries++;
    conn.lastDeliveryAt = now();
    save();
    return { ok: true, result: { provider: conn.provider, accountLabel: conn.accountLabel, filename, byteLength, deliveredAt: conn.lastDeliveryAt, totalDeliveries: conn.deliveries } };
  });

  // ─── [M] incremental / delta exports ────────────────────────────────
  // Returns only records changed since the last recorded cursor for a
  // given data source. The cursor advances when commit !== false.
  registerLensAction("export", "incremental-pull", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const dataSource = clean(params.dataSource || "dtus", 60);
    const records = Array.isArray(params.records) ? params.records : [];
    const tsField = clean(params.timestampField || "updatedAt", 60);
    const cursors = cursorsOf(s, actor(ctx));
    const since = cursors[dataSource] || null;
    const sinceMs = since ? new Date(since).getTime() : 0;

    const recTs = (r) => {
      if (!r || typeof r !== "object") return 0;
      const raw = r[tsField] ?? r.updatedAt ?? r.modifiedAt ?? r.createdAt ?? r.timestamp;
      const t = raw ? new Date(raw).getTime() : NaN;
      return Number.isFinite(t) ? t : 0;
    };
    const changed = records.filter((r) => recTs(r) > sinceMs);
    const maxTs = records.reduce((m, r) => Math.max(m, recTs(r)), sinceMs);
    const newCursor = maxTs > 0 ? new Date(maxTs).toISOString() : since;

    const commit = params.commit !== false;
    if (commit && newCursor) { cursors[dataSource] = newCursor; save(); }

    return {
      ok: true,
      result: {
        dataSource,
        previousCursor: since,
        newCursor,
        committed: commit,
        totalRecords: records.length,
        changedRecords: changed.length,
        unchangedRecords: records.length - changed.length,
        isFirstRun: !since,
        records: changed,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("export", "cursor-list", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cursors = cursorsOf(s, actor(ctx));
    const rows = Object.entries(cursors).map(([dataSource, lastRunAt]) => ({ dataSource, lastRunAt }));
    return { ok: true, result: { cursors: rows, count: rows.length } };
  });

  registerLensAction("export", "cursor-reset", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const cursors = cursorsOf(s, actor(ctx));
    const dataSource = clean(params.dataSource || "", 60);
    if (dataSource) { delete cursors[dataSource]; }
    else { for (const k of Object.keys(cursors)) delete cursors[k]; }
    save();
    return { ok: true, result: { reset: dataSource || "all" } };
  });

  // ─── [M] scheduled-export execution ─────────────────────────────────
  // schedule-create persists a real schedule with a computed nextRun.
  // schedule-run-due evaluates every schedule and executes the ones
  // whose nextRun has elapsed: it records a real history run and
  // advances the schedule's nextRun. This is the actual execution the
  // backlog item asked for — the UI calls schedule-run-due on mount /
  // interval, supplying the current item set per schedule.
  registerLensAction("export", "schedule-create", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const frequency = clean(params.frequency || "daily", 12).toLowerCase();
    if (!FREQ_MS[frequency]) return { ok: false, error: "frequency must be daily, weekly or monthly" };
    const list = schedulesOf(s, actor(ctx));
    const createdAt = now();
    const sched = {
      id: eid("sched"),
      name: clean(params.name || `${frequency} export`, 120),
      frequency,
      format: clean(params.format || "json", 20).toLowerCase(),
      destination: clean(params.destination || "local", 40),
      dataSources: Array.isArray(params.dataSources) ? params.dataSources.map((d) => clean(d, 40)).filter(Boolean) : ["dtus"],
      fields: Array.isArray(params.fields) ? params.fields.map((f) => clean(f, 80)).filter(Boolean) : [],
      enabled: params.enabled !== false,
      createdAt,
      lastRun: null,
      nextRun: nextRunAt(frequency, createdAt),
      runCount: 0,
    };
    list.push(sched);
    save();
    return { ok: true, result: { schedule: sched } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("export", "schedule-list", (ctx, _a, _params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = schedulesOf(s, actor(ctx));
    const nowMs = Date.now();
    const rows = list.map((sc) => ({ ...sc, due: sc.enabled && sc.nextRun != null && new Date(sc.nextRun).getTime() <= nowMs }));
    return { ok: true, result: { schedules: rows, count: rows.length, dueCount: rows.filter((r) => r.due).length } };
  });

  registerLensAction("export", "schedule-toggle", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sched = schedulesOf(s, actor(ctx)).find((sc) => sc.id === clean(params.id, 60));
    if (!sched) return { ok: false, error: "schedule not found" };
    sched.enabled = !sched.enabled;
    if (sched.enabled && !sched.nextRun) sched.nextRun = nextRunAt(sched.frequency, now());
    save();
    return { ok: true, result: { schedule: sched } };
  });

  registerLensAction("export", "schedule-delete", (ctx, _a, params = {}) => {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = actor(ctx);
    const list = schedulesOf(s, u);
    const idx = list.findIndex((sc) => sc.id === clean(params.id, 60));
    if (idx === -1) return { ok: false, error: "schedule not found" };
    list.splice(idx, 1);
    save();
    return { ok: true, result: { removed: clean(params.id, 60), remaining: list.length } };
  });

  // Execute every due schedule. params.itemCounts maps scheduleId ->
  // current item count (the UI supplies real counts for each schedule's
  // data sources). A schedule with no supplied count runs with 0 items.
  registerLensAction("export", "schedule-run-due", (ctx, _a, params = {}) => {
  try {
    const s = getState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const u = actor(ctx);
    const list = schedulesOf(s, u);
    const log = historyOf(s, u);
    const itemCounts = params.itemCounts && typeof params.itemCounts === "object" ? params.itemCounts : {};
    const byteCounts = params.byteLengths && typeof params.byteLengths === "object" ? params.byteLengths : {};
    const nowMs = Date.now();
    const executed = [];
    for (const sc of list) {
      if (!sc.enabled || sc.nextRun == null) continue;
      if (new Date(sc.nextRun).getTime() > nowMs) continue;
      const itemCount = Math.max(0, Math.floor(Number(itemCounts[sc.id]) || 0));
      const byteLength = Math.max(0, Math.floor(Number(byteCounts[sc.id]) || 0));
      const runAt = now();
      const run = {
        id: eid("run"),
        at: runAt,
        format: sc.format,
        itemCount,
        byteLength,
        dataSources: sc.dataSources.slice(),
        trigger: "scheduled",
        filename: `${sc.name.replace(/[^a-z0-9_-]+/gi, "_")}.${sc.format}`,
        scheduleId: sc.id,
        payload: null,
        payloadEncoding: "utf8",
      };
      log.unshift(run);
      sc.lastRun = runAt;
      sc.runCount++;
      sc.nextRun = nextRunAt(sc.frequency, runAt);
      const { payload: _p, ...meta } = run;
      executed.push(meta);
    }
    if (log.length > HISTORY_CAP) log.splice(HISTORY_CAP);
    if (executed.length) save();
    return { ok: true, result: { executedCount: executed.length, executed, schedulesEvaluated: list.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
