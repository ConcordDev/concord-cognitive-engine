//! concord-dtu-sidecar — read-only reader for the Concord `dtu_store` table.
//!
//! Concurrency Refactor Phase 3. `dtu.get` / `dtu.list` run on the Node event
//! loop: `dtu.list` iterates the entire in-memory DTU set and filters/sorts in
//! JS on every locker page load. This process reads `dtu_store` READ-ONLY over a
//! Unix socket and does the get / visibility-filter / sort / paginate off-thread.
//!
//! SINGLE WRITER stays Node — this opens the DB with `SQLITE_OPEN_READ_ONLY` +
//! `PRAGMA query_only`. WAL gives it consistent snapshot reads.
//!
//!   GET /v1/health
//!   GET /v1/dtu?id=...
//!   GET /v1/dtus/list?viewer=&scope=&tier=&q=&mine=&owner=&limit=&offset=
//!                    &viewerRegional=&viewerNational=
//!   GET /v1/dtus/recent?limit=&scope=&tier=&source=
//!   GET /v1/wallet/balance?user=...   (Phase 3b — economy ledger sums off-loop)
//!   GET /v1/session?tokenHash=...     (Phase 3b — auth sessions row lookup)
//!
//! The `list` filter is a faithful port of server.js `userVisibleDTUs` +
//! `dtu.list`, filtering an in-memory parsed cache (refreshed every ~2.5s) by
//! reference. It is pinned by a differential test
//! (engines/concord-dtu-sidecar/proof/run-proof.mjs) that diffs its output
//! ID-set + order against the live JS macro across a privacy-filter scenario
//! matrix — keep it green on any filter or DTU-schema change.
//!
//! Socket: $CONCORD_DTU_SIDECAR_SOCK  (default ~/concord/run/concord-dtu-sidecar.sock)
//! DB:     $CONCORD_DB_PATH || $DB_PATH || ~/concord/concord.db  (READ-ONLY)

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, RwLock,
};
use std::time::{Duration, Instant};

const SYSTEM_DTU_SOURCES: &[&str] = &[
    "repair_cortex", "concord_brain_index", "system_guardian", "guardian_monitor",
    "lattice_audit", "self_repair", "system", "concord-mesh", "system.analogize",
    "auto", "autogen", "system_tick", "heartbeat", "system_repair", "concord_system",
    "background", "internal", "migration", "embedding_backfill", "consolidation", "evolution",
];
const INTERNAL_KINDS: &[&str] = &[
    "shadow", "pattern_shadow", "repair_record", "royalty_record", "session_context",
    "linguistic_map", "audit_trail", "system_metric", "repair_dtu", "client_error",
];

fn db_path() -> String {
    for k in ["CONCORD_DB_PATH", "DB_PATH"] {
        if let Ok(v) = std::env::var(k) {
            if !v.is_empty() {
                return v;
            }
        }
    }
    format!("{}/concord/concord.db", std::env::var("HOME").unwrap_or_default())
}

fn sock_path() -> PathBuf {
    if let Ok(v) = std::env::var("CONCORD_DTU_SIDECAR_SOCK") {
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    let run = std::env::var("CONCORD_RUN_DIR")
        .unwrap_or_else(|_| format!("{}/concord/run", std::env::var("HOME").unwrap_or_default()));
    PathBuf::from(run).join("concord-dtu-sidecar.sock")
}

fn open_ro(path: &str) -> rusqlite::Result<Connection> {
    let c = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    c.busy_timeout(std::time::Duration::from_millis(4000))?;
    c.pragma_update(None, "query_only", true)?;
    Ok(c)
}

// ── DTU field access — mirrors server.js dual camelCase/snake_case reads ──────
fn s<'a>(v: &'a Value, keys: &[&str]) -> &'a str {
    for k in keys {
        if let Some(x) = v.get(*k).and_then(|x| x.as_str()) {
            return x;
        }
    }
    ""
}
fn tags_of(v: &Value) -> Vec<String> {
    v.get("tags")
        .and_then(|t| t.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}
fn machine_kind(v: &Value) -> &str {
    v.get("machine").and_then(|m| m.get("kind")).and_then(|k| k.as_str()).unwrap_or("")
}
fn is_shadow(v: &Value) -> bool {
    s(v, &["tier"]).eq_ignore_ascii_case("shadow") || tags_of(v).iter().any(|t| t == "shadow")
}
fn owner_of(v: &Value) -> String {
    for k in ["author", "ownerId", "userId", "createdBy"] {
        if let Some(x) = v.get(k).and_then(|x| x.as_str()) {
            if !x.is_empty() {
                return x.to_string();
            }
        }
    }
    String::new()
}

struct ListReq {
    viewer: String,
    scope: Option<String>,
    tier: String,
    q: String,
    mine: bool,
    limit: usize,
    offset: usize,
    viewer_regional: String,
    viewer_national: String,
}

fn normalize_lc(s: &str) -> String {
    // server.js tokenish = normalizeText().toLowerCase(); normalizeText collapses
    // whitespace + strips control chars. Approximate: lowercase + collapse ws.
    s.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Faithful port of userVisibleDTUs(viewerId) — the system/privacy/federation gate.
fn user_visible(d: &Value, r: &ListReq) -> bool {
    if SYSTEM_DTU_SOURCES.contains(&s(d, &["source"])) {
        return false;
    }
    if SYSTEM_DTU_SOURCES.contains(&s(d, &["creatorType"])) {
        return false;
    }
    if s(d, &["scope"]) == "system" {
        return false;
    }
    if s(d, &["visibility"]) == "internal" {
        return false;
    }
    let privacy = s(d, &["privacy"]);
    let is_private = privacy == "private"
        || privacy == "followers-only"
        || s(d, &["scope"]) == "user"
        || s(d, &["visibility"]) == "private";
    let owner = owner_of(d);
    if is_private {
        if r.viewer.is_empty() || owner != r.viewer {
            return false;
        }
    }
    let fed_tier = {
        let t = s(d, &["federation_tier", "federationTier"]);
        if t.is_empty() { None } else { Some(t) }
    };
    if let Some(t) = fed_tier {
        if r.viewer != owner {
            match t {
                "local" => return false,
                "regional" => {
                    let dtu_reg = s(d, &["location_regional", "locationRegional"]);
                    if !dtu_reg.is_empty() {
                        if r.viewer_regional.is_empty() || r.viewer_regional != dtu_reg {
                            return false;
                        }
                    }
                }
                "national" => {
                    let dtu_nat = s(d, &["location_national", "locationNational"]);
                    if !dtu_nat.is_empty() {
                        if r.viewer_national.is_empty() || r.viewer_national != dtu_nat {
                            return false;
                        }
                    }
                }
                _ => {} // "global" — always visible
            }
        }
    }
    true
}

fn scope_level(sc: &str) -> i32 {
    match sc {
        "regional" => 1,
        "national" => 2,
        "global" => 3,
        _ => 0, // local / unknown
    }
}

const ROW_COLS: &str = "id, title, tier, scope, tags, source, created_at, updated_at, data, \
    owner_user_id, visibility, privacy, federation_tier, location_regional, location_national, kind";

/// Reconstruct a DTU Value from a dtu_store row.
///
/// Since migration 442, `data` is ALWAYS the full DTU object — so it is the
/// source of truth and the filter reads it exactly as server.js reads the
/// in-memory object (JS parity). The `scope`/`tier`/`source`/`title` columns are
/// NOT merged: `scope` in particular is persist-defaulted to 'global', which
/// would diverge from `d.scope === undefined` in the JS filter.
///
/// Returns `Ok(None)` for a row whose `data` is not a full DTU object with an
/// `id` — mirrors `rehydrateFromSQLite`'s `if (dtu && dtu.id)` check, so the
/// sidecar's corpus is exactly the one the Node process holds in memory (old
/// body-only rows are dead weight for both).
///
/// The 6 visibility columns are merged ONLY when `data` lacks the key (a bridge
/// for pre-442 rows the migration backfilled from a full `data` blob).
fn row_to_dtu(row: &rusqlite::Row) -> rusqlite::Result<Option<Value>> {
    let gs = |i: usize| row.get::<_, Option<String>>(i).unwrap_or(None).unwrap_or_default();
    let go = |i: usize| row.get::<_, Option<String>>(i).unwrap_or(None).filter(|s| !s.is_empty());

    let data = gs(8);
    let mut d: Value = match serde_json::from_str(&data) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    // rehydrateFromSQLite parity: only rows whose data IS a DTU object with an id.
    let has_id = d.get("id").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    if !d.is_object() || !has_id {
        return Ok(None);
    }
    let o = d.as_object_mut().unwrap();
    // keep the column id authoritative in case data.id drifted
    o.insert("id".into(), json!(gs(0)));

    let fill = |o: &mut serde_json::Map<String, Value>, key: &str, v: Option<String>| {
        if let Some(v) = v {
            if !o.contains_key(key) {
                o.insert(key.into(), json!(v));
            }
        }
    };
    fill(o, "ownerId", go(9));
    fill(o, "visibility", go(10));
    fill(o, "privacy", go(11));
    fill(o, "federation_tier", go(12));
    fill(o, "location_regional", go(13));
    fill(o, "location_national", go(14));
    // JS dtu.list only ever checks d.machine?.kind, so merge there (not top-level).
    if let Some(v) = go(15) {
        if o.get("machine").and_then(|m| m.get("kind")).is_none() {
            let m = o.entry("machine").or_insert_with(|| json!({}));
            if let Some(mo) = m.as_object_mut() {
                mo.insert("kind".into(), json!(v));
            }
        }
    }
    Ok(Some(d))
}

fn vis_published_or_public(d: &Value) -> bool {
    let vis = d
        .get("meta")
        .and_then(|m| m.get("visibility"))
        .and_then(|x| x.as_str())
        .unwrap_or_else(|| s(d, &["visibility"]));
    vis == "published" || vis == "public"
}

/// Port of the dtu.list body. Filters the pre-parsed in-memory cache by
/// reference (the whole point — the JS macro filters `STATE.dtus.values()`;
/// this does the equivalent work off the Node event loop, over a snapshot
/// refreshed every few seconds). Only the final page is cloned.
fn list_dtus(cache: &[Value], r: &ListReq) -> (Vec<Value>, usize) {
    let uid = &r.viewer;
    let mut items: Vec<&Value> = cache
        .iter()
        .filter(|d| user_visible(d, r))
        .filter(|d| !is_shadow(d))
        .filter(|d| !INTERNAL_KINDS.contains(&machine_kind(d)))
        .filter(|d| s(d, &["tier"]) != "shadow")
        .collect();

    if r.mine {
        items = if uid.is_empty() {
            vec![]
        } else {
            items.into_iter().filter(|d| s(d, &["ownerId"]) == *uid).collect()
        };
    } else if let Some(sf) = r.scope.as_deref() {
        if ["local", "regional", "national", "global"].contains(&sf) {
            items.retain(|d| {
                let lvl = scope_level(s(d, &["scope"]));
                match sf {
                    "global" => lvl == 3,
                    "national" => lvl >= 2,
                    "regional" => (1..=2).contains(&lvl),
                    "local" => {
                        if lvl > 0 {
                            return false;
                        }
                        let o = s(d, &["ownerId"]);
                        uid.is_empty() || o.is_empty() || o == *uid
                    }
                    _ => true,
                }
            });
            if sf != "local" {
                items.retain(|d| {
                    let o = s(d, &["ownerId"]);
                    o.is_empty() || o == *uid || vis_published_or_public(d)
                });
            }
        } else if !uid.is_empty() {
            items.retain(|d| {
                let o = s(d, &["ownerId"]);
                o.is_empty() || o == *uid || s(d, &["scope"]) == "global" || vis_published_or_public(d)
            });
        }
    } else if !uid.is_empty() {
        items.retain(|d| {
            let o = s(d, &["ownerId"]);
            o.is_empty() || o == *uid || s(d, &["scope"]) == "global" || vis_published_or_public(d)
        });
    }

    // sort by createdAt desc
    items.sort_by(|a, b| s(b, &["createdAt"]).cmp(s(a, &["createdAt"])));

    if r.tier != "any" {
        items.retain(|d| s(d, &["tier"]) == r.tier);
    }
    if !r.q.is_empty() {
        let q = &r.q;
        items.retain(|d| {
            normalize_lc(s(d, &["title"])).contains(q)
                || normalize_lc(&tags_of(d).join(" ")).contains(q)
                || normalize_lc(s(d, &["cretiHuman", "creti"])).contains(q)
        });
    }

    let total = items.len();
    let end = (r.offset + r.limit).min(total);
    let page = if r.offset < total {
        items[r.offset..end].iter().map(|d| (*d).clone()).collect()
    } else {
        vec![]
    };
    (page, total)
}

fn get_dtu(conn: &Connection, id: &str) -> rusqlite::Result<Option<Value>> {
    let mut stmt = conn.prepare(&format!("SELECT {ROW_COLS} FROM dtu_store WHERE id = ? LIMIT 1"))?;
    let mut rows = stmt.query([id])?;
    match rows.next()? {
        Some(row) => Ok(row_to_dtu(row)?),
        None => Ok(None),
    }
}

// ── in-memory parsed cache ─────────────────────────────────────────────────
// The list filter runs against this snapshot by reference — that's the
// event-loop win (parity with the JS macro filtering STATE.dtus.values(),
// off-thread).
//
// Snapshot pointer swap: readers lock only to clone the Arc (a pointer copy,
// sub-microsecond), then filter the immutable Vec with no lock held. The
// refresher builds the next Vec entirely off-lock and swaps the pointer under
// the same brief lock. So a slow refresh NEVER stalls a reader.
//
// The refresher is INCREMENTAL: it re-reads only rows whose updated_at advanced
// since the last pass and upserts them by id (in place, so an edited DTU keeps
// its slot — matching JS `STATE.dtus.set(existingId, …)`), so steady-state
// refresh is a tiny indexed query even with a large corpus. A drop in row count
// triggers one full reload. A few seconds of staleness on the locker list is fine.
type Cache = Arc<RwLock<Arc<Vec<Value>>>>;

fn snapshot(cache: &Cache) -> Arc<Vec<Value>> {
    cache.read().map(|g| Arc::clone(&g)).unwrap_or_else(|_| Arc::new(Vec::new()))
}

fn dtu_id(v: &Value) -> &str {
    v.get("id").and_then(|x| x.as_str()).unwrap_or("")
}

fn row_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT count(*) FROM dtu_store", [], |r| r.get(0)).unwrap_or(-1)
}

fn load_all(conn: &Connection) -> Vec<Value> {
    load_where(conn, None)
}

/// Load rows, optionally only those with `updated_at > since` (strictly newer).
fn load_where(conn: &Connection, since: Option<&str>) -> Vec<Value> {
    let mut out = Vec::new();
    let sql = match since {
        Some(_) => format!("SELECT {ROW_COLS} FROM dtu_store WHERE updated_at > ?"),
        None => format!("SELECT {ROW_COLS} FROM dtu_store"),
    };
    let Ok(mut stmt) = conn.prepare(&sql) else { return out };
    let rows = match since {
        Some(s) => stmt.query_map([s], row_to_dtu),
        None => stmt.query_map([], row_to_dtu),
    };
    if let Ok(rows) = rows {
        for r in rows.flatten().flatten() {
            out.push(r);
        }
    }
    out
}

fn max_updated(cache: &[Value]) -> String {
    cache
        .iter()
        .filter_map(|d| d.get("updatedAt").and_then(|x| x.as_str()))
        .max()
        .unwrap_or("")
        .to_string()
}

fn spawn_cache_refresher(path: String, cache: Cache) {
    std::thread::spawn(move || {
        let conn = match open_ro(&path) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("cache refresher open db: {e}");
                return;
            }
        };
        let mut last_count: i64 = snapshot(&cache).len() as i64;
        let mut ticks: u64 = 0;
        loop {
            ticks += 1;
            let count = row_count(&conn);
            let cur = snapshot(&cache);
            let since = max_updated(&cur);
            // safety net: a full reconcile every ~60 refreshes catches same-ms
            // updated_at collisions the `>` incremental query could skip.
            let force_full = ticks % 24 == 0;

            let next: Option<Vec<Value>> = if count < last_count || force_full {
                Some(load_all(&conn))
            } else {
                // incremental: pull only rows strictly newer than our newest.
                let changed = load_where(&conn, if since.is_empty() { None } else { Some(&since) });
                if changed.is_empty() {
                    None
                } else {
                    // build the next Vec off-lock: clone current, update in place
                    // (edited DTU keeps its slot ~ JS Map.set), append new ones.
                    let mut v: Vec<Value> = (*cur).clone();
                    for d in changed {
                        let id = dtu_id(&d).to_string();
                        if let Some(slot) = v.iter_mut().find(|x| dtu_id(x) == id) {
                            *slot = d;
                        } else {
                            v.push(d);
                        }
                    }
                    Some(v)
                }
            };
            if let Some(v) = next {
                if let Ok(mut w) = cache.write() {
                    *w = Arc::new(v);
                }
            }
            last_count = count;

            std::thread::sleep(Duration::from_millis(
                std::env::var("CONCORD_DTU_SIDECAR_REFRESH_MS")
                    .ok().and_then(|s| s.parse().ok()).unwrap_or(2500),
            ));
        }
    });
}

fn recent(conn: &Connection, limit: usize, scope: Option<&str>, tier: Option<&str>, source: Option<&str>) -> rusqlite::Result<Vec<Value>> {
    let mut sql = format!("SELECT {ROW_COLS} FROM dtu_store WHERE 1=1");
    let mut params: Vec<String> = Vec::new();
    if let Some(v) = scope { sql.push_str(" AND scope = ?"); params.push(v.to_string()); }
    if let Some(v) = tier { sql.push_str(" AND tier = ?"); params.push(v.to_string()); }
    if let Some(v) = source { sql.push_str(" AND source = ?"); params.push(v.to_string()); }
    sql.push_str(" ORDER BY updated_at DESC LIMIT ?");
    params.push(limit.to_string());
    let mut stmt = conn.prepare(&sql)?;
    let pr: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
    let rows = stmt.query_map(pr.as_slice(), row_to_dtu)?;
    Ok(rows.filter_map(|r| r.ok().flatten()).collect())
}

// ── minimal HTTP over UnixListener ──────────────────────────────────────────
fn parse_query(path: &str) -> (String, std::collections::HashMap<String, String>) {
    let mut map = std::collections::HashMap::new();
    let (p, qs) = match path.split_once('?') {
        Some((a, b)) => (a.to_string(), b),
        None => (path.to_string(), ""),
    };
    for kv in qs.split('&') {
        if kv.is_empty() { continue; }
        let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
        map.insert(urldecode(k), urldecode(v));
    }
    (p, map)
}

fn urldecode(s: &str) -> String {
    let b = s.replace('+', " ");
    let bytes = b.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(n) = u8::from_str_radix(&b[i + 1..i + 3], 16) {
                out.push(n);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn respond(stream: &mut UnixStream, status: u16, body: &[u8]) {
    let reason = match status {
        200 => "OK", 400 => "Bad Request", 404 => "Not Found", 500 => "Internal Server Error", _ => "OK",
    };
    let hdr = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(hdr.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}


/// Mirrors server/economy/balances.js CREDIT_ROW_PREDICATE + getBalance.
/// Credits = SUM(net) for to_user_id rows that are NOT the redundant debit-half
/// of TRANSFER/MARKETPLACE_PURCHASE/BOUNTY_ESCROW/BOUNTY_CLAIM split batches.
/// Debits  = SUM(amount) for from_user_id complete rows.
fn wallet_balance(conn: &Connection, user_id: &str) -> rusqlite::Result<(f64, f64, f64)> {
    const CREDIT_PRED: &str = "NOT (from_user_id IS NOT NULL AND type IN ('TRANSFER','MARKETPLACE_PURCHASE','BOUNTY_ESCROW','BOUNTY_CLAIM'))";
    let credits_cents: i64 = conn.query_row(
        &format!(
            "SELECT COALESCE(SUM(CAST(ROUND(net * 100) AS INTEGER)), 0)
             FROM economy_ledger
             WHERE to_user_id = ?1 AND status = 'complete' AND {CREDIT_PRED}"
        ),
        [user_id],
        |r| r.get(0),
    )?;
    let debits_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(CAST(ROUND(amount * 100) AS INTEGER)), 0)
         FROM economy_ledger
         WHERE from_user_id = ?1 AND status = 'complete'",
        [user_id],
        |r| r.get(0),
    )?;
    let bal = (credits_cents - debits_cents) as f64 / 100.0;
    Ok((bal, credits_cents as f64 / 100.0, debits_cents as f64 / 100.0))
}

/// Auth `sessions` row by token_hash (JTI). Read-only; Node remains the writer.
fn session_by_token_hash(conn: &Connection, token_hash: &str) -> rusqlite::Result<Option<Value>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, token_hash, created_at, expires_at, ip_address, user_agent, is_revoked
         FROM sessions WHERE token_hash = ?1 LIMIT 1",
    )?;
    let mut rows = stmt.query([token_hash])?;
    if let Some(r) = rows.next()? {
        Ok(Some(json!({
            "id": r.get::<_, String>(0)?,
            "userId": r.get::<_, String>(1)?,
            "tokenHash": r.get::<_, String>(2)?,
            "createdAt": r.get::<_, String>(3)?,
            "expiresAt": r.get::<_, String>(4)?,
            "ipAddress": r.get::<_, Option<String>>(5)?,
            "userAgent": r.get::<_, Option<String>>(6)?,
            "isRevoked": r.get::<_, i64>(7)? != 0,
        })))
    } else {
        Ok(None)
    }
}

fn handle(stream: &mut UnixStream, conn: &Connection, cache: &Cache, served: &AtomicU64) {
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    // drain headers
    loop {
        let mut l = String::new();
        if reader.read_line(&mut l).unwrap_or(0) == 0 || l == "\r\n" || l == "\n" {
            break;
        }
    }
    served.fetch_add(1, Ordering::Relaxed);

    let mut parts = request_line.split_whitespace();
    let _method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/");
    let (route, qp) = parse_query(path);

    let started = Instant::now();
    let (status, val): (u16, Value) = match route.as_str() {
        "/v1/health" => {
            let n: i64 = conn.query_row("SELECT count(*) FROM dtu_store", [], |r| r.get(0)).unwrap_or(-1);
            let qo: i64 = conn.query_row("PRAGMA query_only", [], |r| r.get(0)).unwrap_or(-1);
            let cached = snapshot(cache).len();
            (200, json!({
                "ok": true, "service": "concord-dtu-sidecar", "impl": "rust",
                "dtuStoreRows": n, "cachedDtus": cached, "queryOnly": qo,
                "served": served.load(Ordering::Relaxed), "db": db_path(),
            }))
        }
        "/v1/dtu" => match qp.get("id") {
            None => (400, json!({"ok": false, "error": "id required"})),
            Some(id) => match get_dtu(conn, id) {
                Ok(Some(d)) => {
                    if is_shadow(&d) {
                        (404, json!({"ok": false, "error": "DTU not found"}))
                    } else {
                        (200, json!({"ok": true, "dtu": d}))
                    }
                }
                Ok(None) => (404, json!({"ok": false, "error": "DTU not found"})),
                Err(e) => (500, json!({"ok": false, "error": e.to_string()})),
            },
        },
        "/v1/dtus/list" => {
            let req = ListReq {
                viewer: qp.get("viewer").cloned().unwrap_or_default(),
                scope: qp.get("scope").filter(|s| !s.is_empty()).cloned(),
                tier: qp.get("tier").cloned().unwrap_or_else(|| "any".into()),
                q: normalize_lc(qp.get("q").map(|s| s.as_str()).unwrap_or("")),
                mine: matches!(qp.get("mine").map(|s| s.as_str()), Some("true") | Some("1"))
                    || matches!(qp.get("owner").map(|s| s.as_str()), Some("me")),
                limit: qp.get("limit").and_then(|s| s.parse().ok()).unwrap_or(5000).clamp(1, 5000),
                offset: qp.get("offset").and_then(|s| s.parse().ok()).unwrap_or(0),
                viewer_regional: qp.get("viewerRegional").cloned().unwrap_or_default(),
                viewer_national: qp.get("viewerNational").cloned().unwrap_or_default(),
            };
            let snap = snapshot(cache); // pointer clone; lock released immediately
            let (page, total) = list_dtus(&snap, &req);
            (200, json!({
                "ok": true, "dtus": page, "total": total,
                "limit": req.limit, "offset": req.offset, "cachedDtus": snap.len(),
            }))
        }
        "/v1/dtus/recent" => {
            let limit = qp.get("limit").and_then(|s| s.parse().ok()).unwrap_or(50usize).clamp(1, 500);
            match recent(conn, limit, qp.get("scope").map(|s| s.as_str()).filter(|s| !s.is_empty()),
                qp.get("tier").map(|s| s.as_str()).filter(|s| !s.is_empty()),
                qp.get("source").map(|s| s.as_str()).filter(|s| !s.is_empty())) {
                Ok(v) => (200, json!({"ok": true, "count": v.len(), "dtus": v})),
                Err(e) => (500, json!({"ok": false, "error": e.to_string()})),
            }
        }
        "/v1/wallet/balance" => match qp.get("user").filter(|s| !s.is_empty()) {
            None => (400, json!({"ok": false, "error": "user required"})),
            Some(uid) => match wallet_balance(conn, uid) {
                Ok((balance, total_credits, total_debits)) => (200, json!({
                    "ok": true,
                    "userId": uid,
                    "balance": balance,
                    "totalCredits": total_credits,
                    "totalDebits": total_debits,
                })),
                Err(e) => (500, json!({"ok": false, "error": e.to_string()})),
            },
        },
        "/v1/session" => match qp.get("tokenHash").filter(|s| !s.is_empty()) {
            None => (400, json!({"ok": false, "error": "tokenHash required"})),
            Some(th) => match session_by_token_hash(conn, th) {
                Ok(Some(s)) => (200, json!({"ok": true, "session": s})),
                Ok(None) => (404, json!({"ok": false, "error": "session_not_found"})),
                Err(e) => (500, json!({"ok": false, "error": e.to_string()})),
            },
        },
        _ => (404, json!({"ok": false, "error": "not_found"})),
    };

    let mut out = val;
    if let Some(obj) = out.as_object_mut() {
        obj.insert("_ms".into(), json!(started.elapsed().as_millis() as u64));
    }
    respond(stream, status, serde_json::to_vec(&out).unwrap_or_default().as_slice());
}

fn main() {
    let path = db_path();
    // one connection per worker thread; SQLite RO connections are cheap.
    let n_workers: usize = std::env::var("CONCORD_DTU_SIDECAR_WORKERS")
        .ok().and_then(|s| s.parse().ok()).unwrap_or(4).clamp(1, 16);

    let sock = sock_path();
    let _ = std::fs::remove_file(&sock);
    if let Some(dir) = sock.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let listener = UnixListener::bind(&sock).unwrap_or_else(|e| {
        eprintln!("listen {}: {e}", sock.display());
        std::process::exit(1);
    });
    let _ = std::fs::set_permissions(&sock, std::os::unix::fs::PermissionsExt::from_mode(0o600));

    // build the parsed cache up front so the first request is served from it
    let boot_conn = match open_ro(&path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("open db {path}: {e}");
            std::process::exit(1);
        }
    };
    let cache: Cache = Arc::new(RwLock::new(Arc::new(load_all(&boot_conn))));
    let boot_n = snapshot(&cache).len();
    drop(boot_conn);
    spawn_cache_refresher(path.clone(), Arc::clone(&cache));

    eprintln!(
        "concord-dtu-sidecar (rust) listening on unix:{} (db={path}, {n_workers} workers, {boot_n} dtus cached, read-only)",
        sock.display()
    );

    let served = Arc::new(AtomicU64::new(0));
    let listener = Arc::new(listener);

    let mut handles = Vec::new();
    for _ in 0..n_workers {
        let listener = Arc::clone(&listener);
        let served = Arc::clone(&served);
        let cache = Arc::clone(&cache);
        let path = path.clone();
        handles.push(std::thread::spawn(move || {
            let conn = match open_ro(&path) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("worker open db: {e}");
                    return;
                }
            };
            loop {
                // UnixListener::accept takes &self and is safe to call from
                // multiple threads — the kernel serialises accept() on the fd.
                match listener.accept() {
                    Ok((mut s, _)) => handle(&mut s, &conn, &cache, &served),
                    Err(_) => continue,
                }
            }
        }));
    }
    for h in handles {
        let _ = h.join();
    }
}
