#!/usr/bin/env python3
"""Generate walker/specs/core_verbs.json (GB-1576 W5a).

Inputs: walker/inventory.json (the 270-lens spine) + a domain->actions map
produced by scanning the server tree at the walk build for
registerLensAction('domain', 'action', ...) — the same regex family as
walker/tools/action_registry.py (ACTION_RE). Drafts pick each domain's
best create-class action by a scored token heuristic; lenses whose code
shows no create-class action get action=null (UNSPECIFIED by construction).
The CONFIRMED set is hand-grounded in the W1 redesign study record
(walker/docs/REDESIGN-STUDY.md) with registry-verified action names.

Usage: gen_core_verbs.py <inventory.json> <domains.json> <out.json>
"""
import json
import re
import sys

# slug -> (domain, action, verb, visibility, note, args) — W1-study grounded.
# args is the minimal argument template for the drive; "{label}" is replaced
# with the walk's unique fixture label. None = the leg's default template.
CONFIRMED = {
    "retail": ("retail", "cart-open", "open a register cart and ring a sale", "private",
               "The Stall (PR #2396): the register is the lens; cart-open is the sale's first write. Tender is money-class and is never the driven action.", {}),
    "conkay": ("conkay_design", "from-brief", "design an object from a brief", "private",
               "The Workshop (PR #2396): a designed object must persist and stay addressable (the redesign's lost-design find).", {"brief": "{label}", "title": "{label}"}),
    "studio": ("studio", "project-create", "create a song project", "private",
               "The Booth (PR #2396): one project, one store — the created project is what the engine plays.", {"title": "{label}", "name": "{label}"}),
    "music": ("music", "track-add", "add a track to your catalogue", "private",
               "Liner Notes (PR #2396): a track is the artist's until the separate publish action; uploaded metadata must be the file's own.", {"title": "{label}", "name": "{label}"}),
    "code": ("code", "files-write", "write a file in a project", "private",
               "Proof (PR #2396): files persist in the project; runs are judged by RUNNER-TRUTH, not this spec.", {"path": "{label}.md", "content": "{label}"}),
    "news": ("news", "article-save", "save an article to your reader", "private",
               "The Situation Room (PR #2396): a reading lens — the persisted save is its defining write.", {"title": "{label}"}),
    "marketplace": ("marketplace", "listings-create", "create a marketplace listing", "private",
                    "The Auction House (PR #2396): the W1 study's Market rows ride this domain; a created listing is a draft until listings-publish.", {"title": "{label}", "name": "{label}"}),
    "art": ("art", "artwork-create", "create an artwork", "private",
            "The Atelier (PR #2396).", {"title": "{label}", "name": "{label}"}),
    "podcast": ("podcast", "show-add", "create a podcast show", "private",
                "The Transcript Page (PR #2398): the show is the maker's; episodes inherit the show's ownership (PC-02).", {"title": "{label}", "name": "{label}"}),
    "dtus": (None, None, "publish a knowledge DTU to the catalogue", "public",
             "The Binder (PR #2398): the publish paths (publishDTU, marketplace.list) are lib paths, not registered lens actions in the dtus domain — the action stays unpinned, so the check verdicts UNSPECIFIED until the desk pins it. Publishing itself is gated by the publish gate (DT-01).", None),
    "film-studios": ("film-studios", "project-create", "create a production project", "private",
                     "The Production Office (PR #2398).", {"title": "{label}", "name": "{label}"}),
    "animation": ("animation", "anim-create", "create an animation", "private",
                  "The Light Table (PR #2398): the animator's own work; shares are a separate grant (AN-03).", {"title": "{label}", "name": "{label}"}),
    "graph": ("graph", "map-create", "create a knowledge map", "private",
              "The Star Chart (PR #2398): the map is the maker's; linking a DTU never grants write over it (GR-01).", {"title": "{label}", "name": "{label}"}),
    "photos": ("photography", "photo-import", "import a photo into the catalog", "private",
               "The Darkroom (PR #2398, founder-ruled into the study): the catalog is the lens; imported photos are the photographer's.", {"title": "{label}", "name": "{label}"}),
    "chat": (None, None, "send a message in a thread", "private",
             "The Notebook (PR #2398 branch): message routes are not registered lens actions — the action stays unpinned, so the check verdicts UNSPECIFIED until the desk pins it.", None),
}

# slug -> domain where the lens's code lives under another name.
ALIASES = {
    "photos": "photography",
    "conkay": "conkay_design",
    "frontier": "concord-link-frontier",
    "reasoning-traces": "reasoning",
    "event-timeline": "events",
    "world-creator/anomalies": "world-creator",
}

CREATE_TOKENS = [
    ("create", 100), ("add", 90), ("publish", 85), ("upload", 82), ("new", 80),
    ("import", 78), ("record", 75), ("post", 75), ("submit", 72), ("register", 70),
    ("start", 65), ("save", 60), ("compose", 60), ("write", 60), ("build", 58),
    ("make", 58), ("open", 55), ("schedule", 55), ("send", 55), ("track", 50),
    ("mint", 50), ("enqueue", 60), ("capture", 45), ("connect", 45),
    ("upsert", 40), ("generate", 35), ("set", 25),
]
READ_TOKENS = {"get", "list", "detail", "search", "stats", "dashboard", "summary",
               "analysis", "analyze", "compute", "check", "preview", "history",
               "feed", "status", "info", "count", "validate", "verify", "fetch",
               "load", "view", "delete", "remove", "update", "edit", "archive",
               "restore", "undo", "redo", "clear", "toggle", "mark", "move",
               "reorder", "sync", "refresh", "run", "exec", "play", "export"}


def tokens(name):
    # Split on -, _, and camelCase boundaries (evidenceAdd -> evidence, add).
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "-", name)
    return [t for t in re.split(r"[-_]", spaced.lower()) if t]


def score_action(name):
    toks = tokens(name)
    if not toks:
        return 0
    # A leading read/mutation verb makes it a read or a mutation of an
    # existing object, never the defining create (listViews, deleteView,
    # updateLayers). A trailing noun (saveView, captureUpload) does not.
    if toks[0] in READ_TOKENS:
        return 0
    best = 0
    for tok, pts in CREATE_TOKENS:
        if tok in toks:
            best = max(best, pts)
    return best


def pick_action(actions):
    scored = [(score_action(a), a) for a in actions]
    scored = [s for s in scored if s[0] >= 40]
    if not scored:
        return None
    scored.sort(key=lambda s: (-s[0], len(s[1]), s[1]))
    return scored[0][1]


def humanize(action):
    toks = tokens(action)
    if len(toks) >= 2 and toks[-1] in dict(CREATE_TOKENS):
        return "%s a %s" % (toks[-1], " ".join(toks[:-1]))
    if toks and toks[0] in dict(CREATE_TOKENS):
        return "%s %s" % (toks[0], " ".join(toks[1:]) or "item")
    return " ".join(toks)


def sibling_cleanup(actions, action):
    """The delete/remove sibling of a create-class action in the same
    domain (listings-create -> listings-delete), or None."""
    if not action:
        return None
    toks = tokens(action)
    create_toks = {t for t, _ in CREATE_TOKENS}
    # Try every create-token position, verb-last (noun-verb names like
    # track-add, listings-create) first: a noun can itself be a create
    # token elsewhere (track), so the first position is not the verb's.
    positions = [i for i, t in enumerate(toks) if t in create_toks]
    for i in reversed(positions):
        for kill in ("delete", "remove"):
            cand = toks[:]
            cand[i] = kill
            for form in ("-".join(cand), "_".join(cand),
                         cand[0] + "".join(c.title() for c in cand[1:])):
                if form in actions:
                    return form
    return None


def steps_for(name, verb, action, visibility):
    vis_line = ("the result must be VISIBLE to them (spec visibility: %s)" % visibility
                if visibility in ("public", "shared") else
                "the result must NOT be visible to them (spec visibility: %s)" % visibility)
    return [
        "Open the %s lens as the writer account." % name,
        "Perform the core verb: %s%s." % (verb, " (via %s)" % action if action else ""),
        "Reload the lens and re-read through the API: the result must still be there (persistence).",
        "Open the same surface as the observer account: %s." % vis_line,
        "Delete the created data via the write account (cleanup).",
    ]


def main():
    inv_path, dom_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    inventory = json.load(open(inv_path))
    domains = json.load(open(dom_path))
    lenses = {}
    counts = {"confirmed": 0, "draft_action": 0, "draft_null": 0}
    for entry in inventory:
        slug = entry["slug"]
        name = entry.get("name") or slug
        if slug in CONFIRMED:
            dom, act, verb, vis, note, args = CONFIRMED[slug]
            action = {"domain": dom, "name": act} if dom and act else None
            lenses[slug] = {
                "name": name, "category": entry.get("category"), "verb": verb,
                "action": action, "visibility": vis,
                "args": args,
                "cleanup_action": ({"domain": dom, "name": sibling_cleanup(domains.get(dom, []), act)}
                                   if action and sibling_cleanup(domains.get(dom, []), act) else None),
                "expect": "After the verb, the result exists in the writer's %s data, survives a reload, and its visibility matches the spec." % name,
                "steps": steps_for(name, verb, ("%s.%s" % (dom, act)) if action else None, vis),
                "status": "confirmed", "source": "w1-study", "note": note,
            }
            counts["confirmed"] += 1
            continue
        dom = ALIASES.get(slug) or next(
            (v for v in dict.fromkeys([slug, slug.replace("-", ""), slug.replace("-", "_"),
                                       slug.replace("_", "-"), slug.split("/")[0]])
             if v in domains), None)
        act = pick_action(domains.get(dom, [])) if dom else None
        if act:
            verb = humanize(act)
            cleanup = sibling_cleanup(domains.get(dom, []), act)
            lenses[slug] = {
                "name": name, "category": entry.get("category"), "verb": verb,
                "action": {"domain": dom, "name": act}, "visibility": "private",
                "args": None,
                "cleanup_action": {"domain": dom, "name": cleanup} if cleanup else None,
                "expect": "After the verb, the result exists in the writer's %s data, survives a reload, and is not visible to other accounts." % name,
                "steps": steps_for(name, verb, "%s.%s" % (dom, act), "private"),
                "status": "draft", "source": "registry-draft",
                "note": "Draft derived from the registerLensAction registry scan (domain %s); the defining-verb choice and the private default are unreviewed." % dom,
            }
            counts["draft_action"] += 1
        else:
            lenses[slug] = {
                "name": name, "category": entry.get("category"),
                "verb": "use %s" % name, "action": None, "visibility": "private",
                "args": None, "cleanup_action": None,
                "expect": "No create-class action is registered for this lens's domain in the scanned code; the core verb is unspecified until a human pins it.",
                "steps": steps_for(name, "use %s" % name, None, "private"),
                "status": "draft", "source": "registry-draft",
                "note": "No domain with a create-class registered action was found for this slug in the scan; action unpinned by construction.",
            }
            counts["draft_null"] += 1
    doc = {
        "kind": "core-verb-specs",
        "version": 1,
        "work_order": "GB-1576 W5a",
        "build": "21303b4672",
        "derived": "walker/inventory.json (270 lenses) + registerLensAction scan of server/ at walker/ulw-v3 bf59c7718a + the W1 redesign study (walker/docs/REDESIGN-STUDY.md). Drafts are derivation-grade, not truth; confirmed entries are grounded in the study record with registry-verified action names.",
        "counts": counts,
        "lenses": lenses,
    }
    with open(out_path, "w") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print("wrote", out_path, counts, "total", len(lenses))


if __name__ == "__main__":
    main()
