"""C16 (ULW-43): the per-lens isolation phase — plan, packet block, roll-up.

WALK-04c built the two-account machinery (privacy_checks: the foreign-row
probe + the socket pair probe) and LensWalk grew an opt-in --two-account
replay (cross_account). The mapping capture still showed the second account
7 times against 583 t1 checks: the machinery fired only where a ticket or a
flag asked for it. This module is the wiring that makes isolation a STANDARD
per-lens phase (Gate section 14): the phase plan that decides — honestly,
with a named reason when it cannot run — whether a walk carries the phase,
the per-lens packet block the phase writes, and the run-level counts the
roll-up reports ("isolation checks run / lenses walked").

Pure by design: no browser, no network. The browser-driving legs live in
checks.LensWalk.isolation_phase and privacy_checks; everything here is
decidable and testable offline (selftest/run_selftest_c16.py).
"""


def phase_plan(*, acct, admin, allow_write, has_t2, two_account_flag=False):
    """Should this walk carry the isolation phase, and if not, why not.

    The phase is standard for a t1 member walk that can write: the walk
    creates under A in its write phase, and isolation verifies under B.
    A read-only or non-t1 walk carries it only when explicitly flagged
    (the replay leg needs no fixture; the probe leg still skips inside).
    Every refusal names its reason — a skipped phase is a reported state,
    never a silent absence.
    """
    if admin:
        return {"run": False, "reason": "admin look-only walk"}
    if acct != "t1":
        return {"run": False, "reason": "t1 member walks only"}
    if not has_t2:
        return {"run": False, "reason": "no saved t2 session (auth/t2.json)"}
    if allow_write or two_account_flag:
        return {"run": True, "reason": "standard phase (write-capable t1 walk)"
                if allow_write else "explicitly flagged"}
    return {"run": False, "reason": "read-only run without --two-account"}


def probe_plan(*, fixture_label, api_paths):
    """Should the foreign-row probe leg run inside the phase.

    The probe needs the walk's own labelled fixture (created under A in
    the write phase) and at least one API path the lens actually called.
    Missing either is a named skip, never a guessed verdict.
    """
    if not fixture_label:
        return {"run": False, "reason": "no live labelled fixture for this lens in this run"}
    if not api_paths:
        return {"run": False, "reason": "no API paths recorded for this lens"}
    return {"run": True, "reason": "labelled fixture + recorded API paths"}


def packet_block(two_account=None, probe=None, probe_skip=None):
    """The per-lens isolation block written into the walk result (packet).

    Merges the two legs' outcomes into counted form: checks = replayed
    calls + probed paths; findings = foreign 2xx replays (ownership);
    leaks = foreign-row probe leaks. Status: RAN when any leg ran,
    SKIPPED with the phase reason otherwise, PARTIAL when one leg ran
    and the other skipped.
    """
    block = {"status": "SKIPPED", "checks": 0, "findings": 0, "leaks": [],
             "two_account": two_account, "probe": probe}
    ran = []
    if two_account and two_account.get("status") not in (None, "SKIPPED"):
        ran.append("two_account")
        block["checks"] += int(two_account.get("replayed") or 0)
        block["findings"] += int(two_account.get("ownership_failures") or 0)
    if probe:
        ran.append("probe")
        block["leaks"] = list(probe.get("leaks") or [])
        block["probe_verdict"] = probe.get("verdict")
    if probe_skip:
        block["probe_skip"] = probe_skip
    if len(ran) == 2:
        block["status"] = "RAN"
    elif ran:
        block["status"] = "PARTIAL"
    return block


def summarize(blocks):
    """Run-level isolation counts for the roll-up (Gate section 14).

    Input: the per-lens isolation blocks (or None for lenses whose walk
    produced none). Output counts lenses walked, lenses where the phase
    ran (RAN or PARTIAL), total checks, total ownership findings, and
    lenses with a foreign-row leak.
    """
    out = {"lenses": 0, "ran": 0, "checks": 0, "findings": 0, "leak_lenses": 0}
    for b in blocks:
        out["lenses"] += 1
        if not b:
            continue
        if b.get("status") in ("RAN", "PARTIAL"):
            out["ran"] += 1
        out["checks"] += int(b.get("checks") or 0)
        out["findings"] += int(b.get("findings") or 0)
        if b.get("leaks"):
            out["leak_lenses"] += 1
    return out


def summary_line(counts):
    """The roll-up line, in the summary's own voice."""
    return ("Isolation phase: ran on %d of %d lenses - %d checks, "
            "%d ownership findings, %d lenses with foreign-row leaks"
            % (counts["ran"], counts["lenses"], counts["checks"],
               counts["findings"], counts["leak_lenses"]))
