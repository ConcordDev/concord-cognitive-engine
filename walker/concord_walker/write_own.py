"""WRITE-OWN profiles for write-skip lenses (ULW C38, U10 tail).

63 of the 401 write rows sit on write-skip lenses (46 lenses in
config.write_skip_lenses: social, feed, forum, chat, marketplace, mail, ...).
The t1 write lane skips those lenses entirely — their surfaces are shared or
public, and t1's fixtures there would pollute them. The upgrade plan's
answer (§3, §5 U10): the SECOND account exercises those rows against its
OWN content — a WRITE-OWN profile per (lens, run, ticket):

  - the replay session is t2, never t1 (account_for is overridden by the
    caller for candidate lenses when the run enables write-own);
  - every fixture label carries the t2 stem, and the profile's live-label
    filter admits ONLY labels under that stem — t2's write steps can only
    ever target content t2 itself created in this run;
  - admin lenses are never candidates, session or not;
  - the profile is refused outright when the config carries no t2 account.

This module is machinery only: it builds and validates profiles. Whether a
run enables write-own is the caller's flag (--allow-write-own); the firing
itself is walk-2 work at the walker desk.
"""

import re


class WriteOwnRefused(Exception):
    """A WRITE-OWN profile was requested for a lens/run that may not have one."""


def is_write_own_candidate(cfg, lens):
    """A lens is a WRITE-OWN candidate iff it is write-skip-listed (that is
    the population the t1 lane cannot exercise) and not an admin lens."""
    if not lens:
        return False
    if lens in cfg.get("admin_lenses", []):
        return False
    return lens in cfg.get("write_skip_lenses", [])


def write_own_profile(cfg, lens, run_id, ticket_id):
    """The WRITE-OWN profile for one row. Raises WriteOwnRefused with the
    reason when the lens/run may not have one — fail closed, never a
    half-profile."""
    if lens in cfg.get("admin_lenses", []):
        raise WriteOwnRefused("lens %r is an admin lens — write-own never applies" % lens)
    if lens not in cfg.get("write_skip_lenses", []):
        raise WriteOwnRefused(
            "lens %r is not write-skip-listed — its rows ride the t1 write lane, not write-own" % lens)
    accounts = cfg.get("accounts", {})
    if "t2" not in accounts:
        raise WriteOwnRefused("config carries no t2 account — no second account to write as")
    prefix = cfg.get("fixture_prefix") or "qa-walker"
    rid = re.sub(r"[^a-z0-9]+", "", str(run_id or "").lower())[-6:] or "run"
    tid = re.sub(r"[^a-z0-9]+", "", str(ticket_id or "x").lower())[-12:]
    stem = "%s-%s-t2-%s-%s" % (prefix, lens, rid, tid)
    return {
        "lens": lens,
        "account": "t2",
        "label_base": stem,
        "own_only": True,
        "write_own": True,
    }


def own_labels(profile, fixtures):
    """The live fixture labels a WRITE-OWN profile may act on: only labels
    under the profile's own t2 stem, in a live state. `fixtures` is the
    recorder's fixture map (label -> {lens, state, ...})."""
    stem = profile["label_base"]
    out = []
    for label, f in (fixtures or {}).items():
        if not isinstance(f, dict):
            continue
        if f.get("lens") != profile["lens"]:
            continue
        if f.get("state") in ("deleted", "never_created"):
            continue
        if label == stem or label.startswith(stem + "-") or label.startswith(stem):
            out.append(label)
    return out


def label_is_own(profile, label):
    """True iff `label` was minted under this profile's stem."""
    if not label:
        return False
    stem = profile["label_base"]
    return label == stem or label.startswith(stem)
