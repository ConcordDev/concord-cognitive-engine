"""ULW v3 (GB-1576 W5c): DURABILITY — a standard per-lens phase.

The founder rule behind it: if it doesn't work live, every time, it isn't
fixed. Many Concord domains keep state in `globalThis` Maps saved on a
debounce; a write can look saved in the session that made it and be gone
minutes later. This phase is the walker's standing test for that class:

  write via the lens (a recorded create re-issued with a planted marker),
  wait past the domain's save debounce, then verify the marker survived —
  via a FRESH session (new context, reload, durable texts) and via a
  BACKEND READ (the lens's own recorded read route re-issued). The backend
  read is the arbiter: a marker the server cannot produce after the wait
  did not persist, whatever the writing session showed.

Verdicts per probe (probe_verdict):
  DURABLE_PASS        marker in the backend read AND the fresh session.
  DURABLE_FAIL        the backend read has it but a fresh session does not
                      (read-your-writes divergence), or neither has it
                      after the wait (the write never persisted).
  DURABLE_UNVERIFIED  the probe could not judge: the probe write did not
                      land, no backend read exists for the write's
                      collection, the read failed, or the fresh session
                      shows the marker while the recorded read route does
                      not (the route may not be the object's source).
                      Named, never a pass.

Pure by design: planning (which recorded writes can carry a probe), marker
planting, read-route selection, verdicts and the counted record block are
decidable offline; the driving leg lives in
checks.LensWalk.durability_phase. The static half of W5c — flagging
globalThis state and debounced saves in domain code — lives in
dossier._code_scan (kinds globalthis_state / debounced_save, class
durability), feeding the move-to-DB list.
"""
import json, re

WRITE_METHODS = ("POST", "PUT", "PATCH")
# Path segments that mark a call as telemetry/search/batch plumbing rather
# than an object create — re-issuing those proves nothing about durability.
_NON_CREATE = re.compile(
    r"(?i)(search|track|telemetry|analytic|beacon|metric|/log|event|batch|"
    r"heartbeat|presence)")
# Fields that conventionally carry an object's identity text, in the order
# a marker should be planted into them.
MARKER_FIELDS = ("title", "name", "label", "subject", "heading", "text")
ID_KEYS = ("id", "_id", "dtuId", "objectId", "uuid", "key")


def body_obj(post):
    """A recorded request body as a dict, or None (form/non-JSON/absent)."""
    if isinstance(post, dict):
        return post
    if isinstance(post, str) and post.strip().startswith("{"):
        try:
            obj = json.loads(post)
        except Exception:
            return None
        return obj if isinstance(obj, dict) else None
    return None


def plant_marker(post, marker, fixture_label=None):
    """(new_body_str, field) with `marker` planted in the field carrying
    the object's identity text: the field whose value contains the fixture
    label when known, else the first MARKER_FIELDS string field, else any
    string field. (None, None) when no field can carry the marker."""
    obj = body_obj(post)
    if not obj:
        return None, None
    if fixture_label:
        for k, v in obj.items():
            if isinstance(v, str) and fixture_label in v:
                out = dict(obj)
                out[k] = marker
                return json.dumps(out), k
    for k in MARKER_FIELDS:
        if isinstance(obj.get(k), str):
            out = dict(obj)
            out[k] = marker
            return json.dumps(out), k
    for k, v in obj.items():
        if isinstance(v, str) and v:
            out = dict(obj)
            out[k] = marker
            return json.dumps(out), k
    return None, None


def _id_segmented(path):
    seg = (path or "").rstrip("/").rsplit("/", 1)[-1]
    return len(seg) > 3 and not seg.isalpha()


def collection_of(path):
    """The collection a write belongs to: the path itself, minus a trailing
    id segment when it has one."""
    p = (path or "").rstrip("/")
    if _id_segmented(p):
        return p.rsplit("/", 1)[0]
    return p


def pick_write_calls(calls, *, cap=3, fixture_label=None):
    """Probe candidates from the walk's recorded calls: write-method calls
    with a JSON body a marker can be planted into, on non-plumbing paths.
    Latest first, deduped by (method, path). Each candidate carries the
    planted body + field, ready to fire."""
    out, seen = [], set()
    for r in reversed(list(calls or [])):
        if (r.get("method") or "") not in WRITE_METHODS:
            continue
        path = r.get("path") or ""
        if not path or _NON_CREATE.search(path):
            continue
        k = (r["method"], path)
        if k in seen:
            continue
        body, field = plant_marker(r.get("post"), "@@MARKER@@", fixture_label)
        if body is None:
            continue
        seen.add(k)
        out.append({"method": r["method"], "url": r.get("url"), "path": path,
                    "post": r.get("post"), "field": field,
                    "collection": collection_of(path), "t": r.get("t")})
        if len(out) >= cap:
            break
    return out


def pick_read_calls(calls, write):
    """Recorded GETs that can serve as the backend read for a write: GETs on
    the write's collection or on the write path itself, latest first,
    deduped by path."""
    coll = write.get("collection") or collection_of(write.get("path") or "")
    out, seen = [], set()
    for r in reversed(list(calls or [])):
        if (r.get("method") or "") != "GET":
            continue
        p = r.get("path") or ""
        if p == coll or p == write.get("path") or p.startswith(coll + "/"):
            if p in seen:
                continue
            seen.add(p)
            out.append({"method": "GET", "url": r.get("url"), "path": p})
    return out


def object_url(write, response_obj):
    """The created object's URL when the write's response carries an id:
    <collection>/<id> beside the write's own URL. None otherwise."""
    if not isinstance(response_obj, dict):
        return None
    oid = None
    for k in ID_KEYS:
        v = response_obj.get(k)
        if isinstance(v, (str, int)) and v not in ("", None):
            oid = v
            break
    if oid is None:
        return None
    base = (write.get("url") or "").rstrip("/")
    coll = write.get("collection") or ""
    if coll and base.endswith(coll):
        return "%s/%s" % (base, oid)
    return "%s/%s" % (base, oid)


def probe_verdict(write_status, fresh, backend, backend_status):
    """One probe's (verdict, reason). fresh/backend are True/False, or None
    when that leg could not run at all."""
    if write_status is None:
        return "DURABLE_UNVERIFIED", "probe write never completed"
    if not (200 <= write_status < 300):
        return ("DURABLE_UNVERIFIED",
                "probe write did not land (status %s)" % write_status)
    if backend is None:
        return ("DURABLE_UNVERIFIED",
                "no backend read available for the write's collection")
    if backend_status is not None and not (200 <= backend_status < 300):
        return ("DURABLE_UNVERIFIED",
                "backend read failed (status %s)" % backend_status)
    if backend and fresh:
        return "DURABLE_PASS", "marker in backend read and fresh session"
    if backend and not fresh:
        return ("DURABLE_FAIL",
                "persisted server-side but absent in a fresh session "
                "after the debounce wait")
    if not backend and not fresh:
        return ("DURABLE_FAIL",
                "absent from the backend read and a fresh session after "
                "the debounce wait — the write did not persist")
    return ("DURABLE_UNVERIFIED",
            "fresh session shows the marker but the recorded backend read "
            "does not — the read route may not be the object's source")


def probe_plan(candidates):
    """Should the durability phase run, and if not, why not — a skipped
    phase is a reported state with a named reason, never a silent absence."""
    if not candidates:
        return {"run": False,
                "reason": "no recorded write with a plantable marker field "
                          "for this lens"}
    return {"run": True, "reason": "%d probe candidate(s)" % len(candidates)}


def durability_block(rows=None, skip=None):
    """The per-lens durability block written into the walk result.
    Status RAN when probes ran, SKIPPED with the reason otherwise; verdict
    FAIL when any probe failed, PASS when every probe passed or was
    unverified-with-reason (unverified is counted, never hidden)."""
    if rows is None:
        return {"status": "SKIPPED", "reason": skip or "not run",
                "probes": 0, "failed": 0, "unverified": 0, "rows": []}
    failed = sum(1 for r in rows if r.get("verdict") == "DURABLE_FAIL")
    block = {"status": "RAN", "probes": len(rows), "failed": failed,
             "unverified": sum(1 for r in rows
                               if r.get("verdict") == "DURABLE_UNVERIFIED"),
             "rows": rows}
    block["verdict"] = "FAIL" if failed else "PASS"
    return block
