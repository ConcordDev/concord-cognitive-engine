#!/usr/bin/env python3
"""ULW v3 trust-probes selftest (B2): OWNER-MUTATION + ACTOR-SPOOF as
standard per-lens phases (GB-1575 scope addition, W1 study rows X-01/X-02/
X-05).

Covers the pure layer (concord_walker.trust_probes):
  * actor-field extraction from recorded bodies (JSON string + dict forms,
    non-JSON ignored) and the owner's own actor values;
  * mutation planning: owner write calls deduped into update attempts,
    DELETE attempts only on objects this walk created (a POSTed collection
    + an id-segmented child the owner addressed) — never on arbitrary
    paths, never the observer's own calls, capped;
  * spoof planning: one attempt per actor field, the body rebuilt with the
    owner's id, the original kept for restore; strip_actor_fields produces
    the identity-correct mutation body;
  * route variants: case-variant + trailing-slash (X-02's shapes);
  * verdicts: REFUSED / LANDED / TOLERATED / UNVERIFIED / ERROR, incl. the
    rule that a 2xx with the owner's state byte-unchanged is TOLERATED
    (the handler acted as the caller), not a finding;
  * leg plans: named skip reasons, never silent;
  * the trust block: RAN / PARTIAL / SKIPPED counting, FAIL on any landing;
  * wiring: LensWalk.isolation_phase calls trust_phase, and trust_phase
    files findings through _premap_finding (source-level, the fleet's
    wiring-test idiom — the legs themselves are browser-live).

Fail-on-pristine: concord_walker.trust_probes does not exist pre-build.
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker import trust_probes as tp

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

B = "https://app.example"
def call(method, path, post=None, acct=None, t=1):
    return {"method": method, "path": path, "url": B + path, "post": post, "acct": acct, "t": t}

CALLS = [
    call("GET", "/api/artistry/projects", None, "t1"),
    call("POST", "/api/artistry/projects", json.dumps({"name": "fixture-1"}), "t1"),          # create (collection)
    call("GET", "/api/artistry/projects/abc123", None, "t1"),                                  # the created object
    call("POST", "/api/artistry/collab/share", json.dumps({"projectId": "abc123", "ownerId": "user-t1", "collab": "x"}), "t1"),
    call("PUT", "/api/artistry/projects/abc123", json.dumps({"name": "renamed"}), "t1"),
    call("POST", "/api/artistry/collab/share", json.dumps({"projectId": "abc123", "ownerId": "user-t1"}), "t1"),  # dup (method,path)
    call("POST", "/api/economic/marketplace/buy", json.dumps({"odId": "user-t1", "item": "it-9"}), "t1"),
    call("POST", "/api/other/thing", json.dumps({"userId": "user-t2"}), "t2"),                  # observer's own call: excluded
    call("GET", "/api/artistry/projects/zzz999", None, "t1"),                                  # object NOT created this walk
]

# --- extraction -------------------------------------------------------------
check("actor fields from JSON string", tp.actor_fields_in(CALLS[3]["post"]) == ["ownerId"])
check("actor fields from dict body", tp.actor_fields_in({"userId": "u1", "x": 2}) == ["userId"])
check("no actor fields in plain body", tp.actor_fields_in(CALLS[1]["post"]) == [])
check("non-JSON body -> no fields", tp.actor_fields_in("name=x&y=1") == [])
check("owner actor values", tp.owner_actor_values(CALLS, owner_acct="t1", walk_acct="t1") == {"ownerId": "user-t1", "odId": "user-t1"},
      tp.owner_actor_values(CALLS, owner_acct="t1", walk_acct="t1"))

# --- mutation plan ------------------------------------------------------------
m = tp.mutation_plan(CALLS, owner_acct="t1", walk_acct="t1")
kinds = [(a["kind"], a["method"], a["path"]) for a in m]
check("mutation updates deduped", kinds.count(("update", "POST", "/api/artistry/collab/share")) == 1, kinds)
check("mutation includes the buy write", ("update", "POST", "/api/economic/marketplace/buy") in kinds)
check("observer's own calls excluded", all(a["path"] != "/api/other/thing" for a in m))
deletes = [a for a in m if a["kind"] == "delete"]
check("delete scoped to this walk's creation", len(deletes) == 1 and deletes[0]["path"] == "/api/artistry/projects/abc123", deletes)
check("no delete on the uncreated object", all(a["path"] != "/api/artistry/projects/zzz999" for a in m))
check("mutation cap honoured", len(tp.mutation_plan(CALLS * 6, owner_acct="t1", walk_acct="t1", cap=3)) == 3)
check("mutation keeps orig_post for restore", all("orig_post" in a for a in m if a["kind"] == "update"))

# --- spoof plan ---------------------------------------------------------------
s = tp.spoof_plan(CALLS, owner_acct="t1", walk_acct="t1")
check("spoof attempts per actor field", sorted((a["path"], a["field"]) for a in s) == [
    ("/api/artistry/collab/share", "ownerId"), ("/api/economic/marketplace/buy", "odId")], s)
buy = next(a for a in s if a["field"] == "odId")
check("spoof body carries the owner's id", json.loads(buy["post"])["odId"] == "user-t1")
check("spoof keeps the original for restore", json.loads(buy["orig_post"])["odId"] == "user-t1" and buy["orig_url"].endswith("/buy"))
stripped = tp.strip_actor_fields(CALLS[3]["post"])
check("strip removes actor fields only", json.loads(stripped) == {"projectId": "abc123", "collab": "x"}, stripped)
check("strip is a no-op without actor fields", tp.strip_actor_fields(CALLS[1]["post"]) == CALLS[1]["post"])

# --- variants -------------------------------------------------------------------
v = tp.variant_paths("/api/economic/marketplace/buy")
check("case variant present", "/API/economic/marketplace/buy" in v or "/api/ECONOMIC/marketplace/buy" in v or any(x != x.lower() and "economic" in x.lower() for x in v), v)
check("trailing-slash variant present", "/api/economic/marketplace/buy/" in v, v)
check("variants differ from the original", all(x != "/api/economic/marketplace/buy" for x in v))

# --- verdicts -------------------------------------------------------------------
check("403 -> REFUSED", tp.attempt_verdict(403, None, None) == "REFUSED")
check("2xx + error body -> REFUSED", tp.attempt_verdict(200, {"ok": False, "error": "forbidden"}, True) == "REFUSED")
check("2xx + owner changed -> LANDED", tp.attempt_verdict(200, {"ok": True}, True) == "LANDED")
check("2xx + owner unchanged -> TOLERATED", tp.attempt_verdict(200, {"ok": True}, False) == "TOLERATED")
check("2xx + no owner reading -> UNVERIFIED", tp.attempt_verdict(200, {"ok": True}, None) == "UNVERIFIED")
check("transport failure -> ERROR", tp.attempt_verdict(None, None, None) == "ERROR")

# --- leg plans ------------------------------------------------------------------
check("mutation skip names its reason", tp.leg_plan("mutation", write_calls=0, created_objects=0)["run"] is False
      and "no owner write calls" in tp.leg_plan("mutation", write_calls=0, created_objects=0)["reason"])
check("spoof skip without actor fields", "no actor-shaped fields" in tp.leg_plan("spoof", write_calls=3, actor_fields=0)["reason"])
check("spoof runs with fields", tp.leg_plan("spoof", write_calls=3, actor_fields=2)["run"] is True)
check("mutation runs with a creation", tp.leg_plan("mutation", write_calls=0, created_objects=1)["run"] is True)

# --- trust block ------------------------------------------------------------------
row = lambda v: {"kind": "update", "method": "POST", "path": "/x", "status": 200, "verdict": v}
b = tp.trust_block([row("REFUSED"), row("TOLERATED")], [row("LANDED")])
check("block RAN + FAIL on a landing", b["status"] == "RAN" and b["verdict"] == "FAIL" and b["findings"] == 1 and b["checks"] == 3, b)
b2 = tp.trust_block([row("REFUSED")], None, None, "no actor-shaped fields in the recorded write bodies")
check("block PARTIAL + PASS + skip recorded", b2["status"] == "PARTIAL" and b2["verdict"] == "PASS"
      and b2["legs"]["spoof"]["skip"].startswith("no actor-shaped"), b2)
b3 = tp.trust_block(None, None, "reason a", "reason b")
check("block SKIPPED carries both reasons", b3["status"] == "SKIPPED" and b3["checks"] == 0 and "verdict" not in b3)

# --- wiring -----------------------------------------------------------------------
checks_src = open(os.path.join(os.path.dirname(__file__), "..", "concord_walker", "checks.py")).read()
check("isolation phase calls trust_phase", "self.trust_phase(owner, observer)" in checks_src)
check("trust_phase files ownership findings", '_premap_finding("ownership"' in checks_src and "trust_probe_max_calls" in checks_src)
check("variants leg wired", "ACTOR-SPOOF-VARIANTS" in checks_src and "variant_paths" in checks_src)

print()
if FAILS:
    print("TRUST PROBES: %d FAILURES: %s" % (len(FAILS), FAILS))
    sys.exit(1)
print("TRUST PROBES: ALL PASS")
