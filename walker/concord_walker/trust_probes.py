"""ULW v3 (GB-1575 scope addition): the trust probes — OWNER-MUTATION and
ACTOR-SPOOF as STANDARD per-lens phases, from the W1 redesign study's check
sketches (rows X-01 / X-02 / X-05, PC-02, GR-01).

The study's headline: the walker's two-account machinery aimed at READS
(foreign rows leaking) while the redesigns' worst finds were WRITES landing
across accounts — coin theft through a request-supplied identity (X-01),
its route-variant bypass (X-02), and identity-correct ownership-absent
writes (X-05: a share call that never checks the caller owns the project).
These probes extend the foreign-account probe from reads to writes:

  OWNER-MUTATION  the observer re-issues the owner's recorded object-write
                  calls sending its OWN identity correctly everywhere, plus
                  DELETE attempts on the objects this walk created; any
                  landed mutation fails the lens.
  ACTOR-SPOOF     for every recorded write call whose body carries an
                  actor-shaped field, the observer re-issues it with that
                  field set to the OWNER's id; a pass requires refusal AND
                  the owner's state byte-unchanged on re-read.
  ACTOR-SPOOF-VARIANTS (a leg of the spoof probe): each spoof repeats
                  against the route's case-variant and trailing-slash
                  forms — X-02's bypass shape.

Pure by design: no browser, no network. Planning (which attempts exist),
route variants, verdicts and the counted packet block are decidable and
testable offline; the browser-driving legs live in
checks.LensWalk.trust_phase, next to cross_account, whose replay machinery
they reuse. Raw bodies and ids live only in memory there; this module's
plans carry field NAMES and the owner's id values only inside attempt
bodies built for immediate use, and the stored rows keep neither.
"""
import json

# The study's actor-shaped field list (REDESIGN-STUDY ACTOR-SPOOF sketch).
ACTOR_FIELDS = ("odId", "buyerId", "ownerId", "fromUserId", "userId", "hostId")
WRITE_METHODS = ("POST", "PUT", "PATCH")


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


def actor_fields_in(post):
    """Actor-shaped fields present in a recorded body, with scalar values."""
    obj = body_obj(post)
    if not obj:
        return []
    return [f for f in ACTOR_FIELDS if isinstance(obj.get(f), (str, int)) and obj.get(f) not in ("", None)]


def owner_actor_values(calls, *, owner_acct=None, walk_acct=None):
    """{field: value} — the actor ids the OWNER itself used, per field, from
    its own recorded write bodies (the values a spoof would impersonate).
    When the account names are given, only the owner's calls are read."""
    if owner_acct is not None:
        calls = _owner_calls(calls, owner_acct, walk_acct or owner_acct)
    out = {}
    for r in calls:
        if (r.get("method") or "") not in WRITE_METHODS:
            continue
        obj = body_obj(r.get("post")) or {}
        for f in actor_fields_in(r.get("post")):
            out.setdefault(f, obj[f])
    return out


def _owner_calls(calls, owner_acct, walk_acct):
    """The walk's own calls: rows recorded under the owner (untagged rows
    belong to the walk account, per the C28 discipline cross_account uses)."""
    out = []
    for r in calls:
        acct = r.get("acct") or walk_acct
        if acct in (owner_acct, walk_acct):
            out.append(r)
    return out


def _id_segmented(path):
    """True when the path's last segment looks like an object id (not a verb):
    longer than 3 chars and not purely alphabetic-short."""
    seg = (path or "").rstrip("/").rsplit("/", 1)[-1]
    return len(seg) > 3 and not seg.isalpha()


def mutation_plan(calls, *, owner_acct, walk_acct, cap=12):
    """OWNER-MUTATION attempts from the walk's recorded calls.

    update: the owner's recorded object-write calls (POST/PUT/PATCH),
    deduped by (method, path) — re-issued as the observer with the
    observer's own identity (the recorded body is the owner's; the leg
    strips actor fields so the attempt is identity-correct, per sketch).
    delete: DELETE on each object this walk CREATED and then exercised —
    operationally, an id-segmented path the owner WROTE to (PUT/PATCH/POST)
    whose collection received a POST in this walk. A path the owner merely
    read is never a delete target. Scoped to this walk's own creations
    (the labelled-fixture discipline), never arbitrary objects.
    """
    own = _owner_calls(calls, owner_acct, walk_acct)
    attempts, seen = [], set()
    for r in own:
        if (r.get("method") or "") in WRITE_METHODS:
            k = (r["method"], r["path"])
            if k in seen:
                continue
            seen.add(k)
            attempts.append({"kind": "update", "method": r["method"], "url": r["url"],
                             "path": r["path"], "post": r.get("post"),
                             "orig_post": r.get("post"), "t": r.get("t")})
    collections = {r["path"].rstrip("/") for r in own
                   if (r.get("method") or "") == "POST" and not _id_segmented(r["path"])}
    for r in own:
        if (r.get("method") or "") not in WRITE_METHODS:
            continue
        p = (r.get("path") or "").rstrip("/")
        if _id_segmented(p) and p.rsplit("/", 1)[0] in collections:
            k = ("DELETE", p)
            if k in seen:
                continue
            seen.add(k)
            attempts.append({"kind": "delete", "method": "DELETE", "url": r["url"],
                             "path": r["path"], "post": None, "t": r.get("t")})
    return attempts[:cap]


def spoof_plan(calls, *, owner_acct, walk_acct, cap=12):
    """ACTOR-SPOOF attempts: for each owner write call carrying actor-shaped
    fields, one attempt per field, the body rebuilt with that field set to
    the owner's own value for it, to be issued as the observer."""
    own = _owner_calls(calls, owner_acct, walk_acct)
    values = owner_actor_values(own)
    attempts, seen = [], set()
    for r in own:
        if (r.get("method") or "") not in WRITE_METHODS:
            continue
        obj = body_obj(r.get("post"))
        if not obj:
            continue
        for f in actor_fields_in(r.get("post")):
            if f not in values:
                continue
            k = (r["method"], r["path"], f)
            if k in seen:
                continue
            seen.add(k)
            body = dict(obj)
            body[f] = values[f]
            attempts.append({"kind": "spoof", "method": r["method"], "url": r["url"],
                             "path": r["path"], "field": f,
                             "post": json.dumps(body), "orig_post": r.get("post"),
                             "orig_url": r["url"], "t": r.get("t")})
    return attempts[:cap]


def variant_paths(path):
    """X-02's bypass shapes for a route path: a case-variant (the first
    segment's case flipped — Express matches case-insensitively while the
    shipped guard's regexes were case-sensitive) and the trailing-slash
    form. Returns the variants that differ from the path itself."""
    out = []
    segs = (path or "").split("/")
    for i, seg in enumerate(segs):
        if seg and any(c.isalpha() for c in seg):
            flipped = seg.upper() if seg.lower() == seg and seg != seg.upper() else seg.lower()
            if flipped != seg:
                v = list(segs)
                v[i] = flipped
                out.append("/".join(v))
            break
    if path and not path.endswith("/"):
        out.append(path + "/")
    elif path and path.endswith("/") and len(path) > 1:
        out.append(path.rstrip("/"))
    return out


def strip_actor_fields(post):
    """The identity-correct form of a recorded write body: every actor-shaped
    field removed, so the handler must take the actor from the caller's
    session (the OWNER-MUTATION attempt shape). Returns a JSON string, or
    the original body when it carries no actor fields / is not JSON."""
    obj = body_obj(post)
    if not obj:
        return post
    kept = {k: v for k, v in obj.items() if k not in ACTOR_FIELDS}
    if len(kept) == len(obj):
        return post if isinstance(post, str) else json.dumps(obj)
    return json.dumps(kept)


def refused_body(body):
    return isinstance(body, dict) and (body.get("ok") is False or "error" in body)


def attempt_verdict(status, body, owner_changed):
    """One attempt's verdict. REFUSED: non-2xx or an explicit error body.
    LANDED: 2xx, non-refused, and the owner's state provably changed (or,
    for a delete, the object is gone — the caller folds that into
    owner_changed). TOLERATED: 2xx but the owner's state is byte-unchanged —
    the handler acted as the CALLER, which is correct behaviour, not a
    finding. UNVERIFIED: 2xx with no owner-side reading to judge by.
    ERROR: the attempt itself never completed."""
    if status is None:
        return "ERROR"
    if not (200 <= status < 300) or refused_body(body):
        return "REFUSED"
    if owner_changed is True:
        return "LANDED"
    if owner_changed is False:
        return "TOLERATED"
    return "UNVERIFIED"


def broadcast_verdict(frames_seen, marker_seen):
    """The private-broadcast leg's verdict (W5b). LEAK: the run's private
    fixture marker arrived in the foreign context's socket frames. CLEAN:
    frames flowed and none carried the marker. NO_FRAMES: no socket
    traffic was observed at all — inconclusive, named as such, never a
    pass (the lens may simply have no live socket on this view)."""
    if marker_seen:
        return "LEAK"
    if frames_seen:
        return "CLEAN"
    return "NO_FRAMES"


def leg_plan(kind, *, write_calls, actor_fields=0, created_objects=0):
    """Should a trust leg run, and if not, why not — a skipped leg is a
    reported state with a named reason, never a silent absence."""
    if kind == "mutation":
        if not write_calls and not created_objects:
            return {"run": False, "reason": "no owner write calls or created objects recorded for this lens"}
        return {"run": True, "reason": "owner write calls recorded"}
    if kind == "spoof":
        if not write_calls:
            return {"run": False, "reason": "no owner write calls recorded for this lens"}
        if not actor_fields:
            return {"run": False, "reason": "no actor-shaped fields in the recorded write bodies"}
        return {"run": True, "reason": "actor-shaped fields present in recorded write bodies"}
    return {"run": False, "reason": "unknown leg %r" % (kind,)}


def _leg_block(rows):
    if rows is None:
        return None
    return {"attempts": len(rows),
            "landed": sum(1 for r in rows if r.get("verdict") == "LANDED"),
            "tolerated": sum(1 for r in rows if r.get("verdict") == "TOLERATED"),
            "unverified": sum(1 for r in rows if r.get("verdict") == "UNVERIFIED"),
            "rows": rows}


def trust_block(mutation_rows=None, spoof_rows=None, mutation_skip=None, spoof_skip=None,
                broadcast=None, broadcast_skip=None):
    """The per-lens trust block written into the walk result, next to the
    isolation block. Status: RAN when every leg ran, PARTIAL when some
    did, SKIPPED with the reasons otherwise; verdict FAIL when any attempt
    landed or the broadcast leg leaked, PASS when every run leg refused,
    tolerated, or stayed clean. `broadcast` (W5b) is the private-broadcast
    leg's outcome: {"verdict": LEAK|CLEAN|NO_FRAMES, "frames": n}."""
    block = {"status": "SKIPPED", "checks": 0, "findings": 0, "legs": {}}
    ran = []
    for name, rows, skip in (("mutation", mutation_rows, mutation_skip),
                             ("spoof", spoof_rows, spoof_skip)):
        if rows is not None:
            ran.append(name)
            leg = _leg_block(rows)
            block["legs"][name] = leg
            block["checks"] += leg["attempts"]
            block["findings"] += leg["landed"]
        elif skip:
            block["legs"][name] = {"skip": skip}
    if broadcast is not None:
        ran.append("broadcast")
        block["legs"]["broadcast"] = broadcast
        block["checks"] += 1
        if broadcast.get("verdict") == "LEAK":
            block["findings"] += 1
    elif broadcast_skip:
        block["legs"]["broadcast"] = {"skip": broadcast_skip}
    total = 3 if (broadcast is not None or broadcast_skip) else 2
    if len(ran) == total:
        block["status"] = "RAN"
    elif ran:
        block["status"] = "PARTIAL"
    if ran:
        block["verdict"] = "FAIL" if block["findings"] else "PASS"
    return block
