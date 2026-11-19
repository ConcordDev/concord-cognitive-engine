"""Click policy. The walker never clicks anything that could write shared state.

Read-only mode clicks only: role=tab, and 'opener' controls (export/download/
filter/sort/view/settings/menu/more/help/info/details/close/cancel).
Write mode (explicit --allow-write, never on admin lenses) additionally clicks
New/Create/Add openers, the in-dialog Create/Save of its OWN labelled fixture,
and Delete on its OWN fixture (identified by label, never position).
"""
import re

# ------------------------------------------------------------ ULW C40 (§6 deny list)
# UPGRADE-PLAN-20261114 §6 names thirteen money verbs that are never clicked
# ANYWHERE: transfer, withdraw, payout, mint, stake, tip, gift, donate,
# subscribe, checkout, buy, purchase, pay. This tuple is the canonical set;
# every deny list below carries all thirteen, and selftest/test_c40_safety.py
# pins each verb against every click-decision surface (sweep_decision,
# write_step_decision, is_opener_safe, is_tab_safe). Add a verb HERE and to
# the lists in the same change — the selftest fails otherwise.
MONEY_VERBS = ("transfer", "withdraw", "payout", "mint", "stake", "tip", "gift",
               "donate", "subscribe", "checkout", "buy", "purchase", "pay")
MONEY_DENY = re.compile(r"(?i)\b(transfer|withdraw|payouts?|mint|stake|tip|gift|donate|"
                        r"subscri\w*|checkout|buy|purchase|pay)\b")


def money_deny(name):
    """True when a control name carries a §6 money verb (ULW C40)."""
    return bool(MONEY_DENY.search(name or ""))


# Never clicked in any mode (substring/word match, case-insensitive).
HARD_DENY = re.compile(r"(?i)\b(restore|roll\s*back|rollback|revert|reset|replay|undo|redo|re-?run|rerun|"
                       r"publish|unpublish|share|send|post|broadcast|announce|invite|dm|message all|"
                       r"approve|reject|deny|vote|sign(?!\s*in)|e-?sign|mint|deploy|launch|execute|run|trigger|"
                       r"page|paging|ingest|alert|notify|notification|escalate|ack|acknowledge|resolve|"
                       r"pay|payout|buy|purchase|checkout|order|donate|gift|fund|tip|transfer|withdraw|deposit|bid|sell|trade|swap|stake|claim|"
                       r"import|sync|archive|unarchive|purge|wipe|clear|flush|drop|truncate|seed|migrate|reindex|rebuild|"
                       r"install|uninstall|enable|disable|connect|disconnect|revoke|grant|promote|demote|ban|kick|block|mute|"
                       r"follow|subscribe|join|leave|like|upvote|downvote|report|flag|accept|decline|"
                       r"generate|train|render|bake|upload|record|snapshot|commit|merge|push|fork|clone|duplicate|"
                       r"log\s*out|logout|sign\s*out|switch account|impersonate|"
                       r"save|submit|apply|confirm|create|add|new|edit|rename|delete|remove|trash|destroy|"
                       r"cancel subscription|book|reserve|schedule|start|stop|pause|resume|complete|mark|check\s*in|"
                       r"global|public|everyone|all users|test\s*fire|simulate|kill|restart|shutdown|failover)\b")

# Opener vocabulary allowed in read-only mode (must also pass HARD_DENY, with these exceptions).
OPENER = re.compile(r"(?i)^\s*(export|download|filters?|sort( by)?|view|views|settings|options|more|more options|menu|"
                    r"help|info|details|about|show|expand|open menu|actions|\u22ef|\u2026|\.\.\.|keyboard shortcuts|shortcuts)\b")
EXPORT = re.compile(r"(?i)\b(export|download)\b")
EXPORT_DENY = re.compile(r"(?i)\b(global|all users|everyone|public|publish|share|council|bulk|system|server|database|db|backup)\b")
EXPORT_FORMAT = re.compile(r"(?i)\b(json|csv|pdf|markdown|md|txt|png|svg|zip|xlsx|ics|html|export|download)\b")
CLOSE = re.compile(r"(?i)^\s*(close|cancel|dismiss|done|back|\u00d7|x|\u2715|\u2716)\s*$")

# Write mode extras (own fixture only).
CREATE_OPENER = re.compile(r"(?i)^\s*(\+\s*)?(new|create|add)\b[\w\s-]{0,30}$")
CREATE_SUBMIT = re.compile(r"(?i)^\s*(create|save|add|submit|ok|done)\b[\w\s-]{0,20}$")
DELETE_CTRL = re.compile(r"(?i)\b(delete|remove|trash)\b")
# A quoted control label that names a delete button (formfuzz filters these out of "bad values").
DELETE_BTN = re.compile(r"(?i)^\s*(delete|remove|trash|destroy)\b[\w\s-]{0,20}$")
CONFIRM_DELETE = re.compile(r"(?i)^\s*(delete|remove|yes|confirm|ok)\b[\w\s-]{0,20}$")
PUBLIC_HINT = re.compile(r"(?i)\b(public|publish|everyone|global|feed|post to|visible to all|community|marketplace|share with)\b")
CONFIRM_TEXT = re.compile(r"(?i)(are you sure|cannot be undone|can't be undone|permanently|confirm|delete .*\?|remove .*\?)")
ADMIN_EXTRA_DENY = re.compile(r"(?i)\b(page|trigger|ingest|alert|notify|escalate|test|fire|on-?call|incident|ack|silence|"
                              r"maintenance|toggle|flag|kill|restart|deploy|rotate|purge|evict|throttle|limit)\b")


def is_tab_safe(name, admin=False):
    if admin and ADMIN_EXTRA_DENY.search(name or ""):
        return False
    # Tabs are navigation; still refuse obviously-actiony tab labels.
    if money_deny(name):
        return False  # ULW C40: a §6 money verb is never clicked, even as a tab
    return not re.search(r"(?i)\b(restore|rollback|revert|reset|replay|delete|publish|send|pay|trigger|page)\b", name or "")


def is_opener_safe(name, admin=False):
    n = name or ""
    if not OPENER.search(n):
        return False
    if admin and (ADMIN_EXTRA_DENY.search(n) or EXPORT.search(n)):
        return False
    # allow 'export'/'download' words themselves, deny everything else in HARD_DENY
    stripped = EXPORT.sub("", n)
    if HARD_DENY.search(stripped):
        return False
    if EXPORT.search(n) and EXPORT_DENY.search(n):
        return False
    return True


def is_export_safe(name):
    n = name or ""
    return bool(EXPORT.search(n)) and not EXPORT_DENY.search(n) and not HARD_DENY.search(EXPORT.sub("", n))


def is_menu_format_safe(name):
    n = name or ""
    return bool(EXPORT_FORMAT.search(n)) and not EXPORT_DENY.search(n) and not HARD_DENY.search(EXPORT_FORMAT.sub("", n))


def is_close_safe(name):
    return bool(CLOSE.search(name or ""))


# ---------------------------------------------------------------- MST-W0-03 premap sweep
# The sweep clicks a named control once only when this policy allows it. It
# reuses HARD_DENY / ADMIN_EXTRA_DENY and adds the spec's sweep list. Lens
# compute verbs (Run, Calculate, Balance, Solve, ...) are the one widening over
# HARD_DENY: they hit POST /api/lens/run, which is exactly the endpoint the
# premap must record. They are still refused on write-skip lenses, and any
# bulk/all qualifier refuses them everywhere.
SWEEP_DENY = re.compile(r"(?i)\b(delete|remove|clear|reset|publish|share|send|pay|payout|buy|purchase|checkout|withdraw|transfer|"
                        r"mint|tip|gift|donate|stake|subscribe|approve|reject|accept|sign\s*out|log\s*out|logout|theme|dark mode|light mode|"
                        r"notifications?|inbox|language|locale|mark (all )?(as )?read|dismiss all|unsubscribe|destroy|purge|wipe|trash)\b")
DESTRUCTIVE = re.compile(r"(?i)\b(delete|remove|clear|reset|purge|wipe|destroy|trash|drop|truncate|revoke|ban)\b")
SWEEP_COMPUTE = re.compile(r"(?i)^\s*(run|calc|calculate|compute|balance|solve|analy[sz]e|check|validate|preview|"
                           r"estimate|convert|predict|evaluate)\b")
SWEEP_NAV = re.compile(r"(?i)^\s*(search|find|refresh|reload|load more|show more|show less|next|prev|previous|"
                       r"zoom in|zoom out|expand|collapse|open|close|back|toggle sidebar)\b")
SWEEP_BULK = re.compile(r"(?i)\b(all|bulk|batch|every|everyone|global|public)\b")


# Payments stay untouched (standing rule): no upgrade/plan/pricing/billing/checkout-adjacent
# control is clicked by the sweep, even when it only looks like navigation.
SWEEP_PAYMENT = re.compile(r"(?i)\b(upgrade|go\s*pro|get\s*pro|pro\s*plan|premium|pricing|plans?|subscri\w*|billing|"
                           r"credits?|top\s*-?\s*up|wallet|invoices?|payouts?|stripe|card|refunds?|cart|paywall|tiers?|license|licence)\b")


def sweep_decision(name, admin=False, read_only=False):
    """(clickable, reason) for the premap sweep. reason in unsafe | destructive |
    admin_only | write_skip_lens (None when clickable)."""
    n = (name or "").strip()
    if not n:
        return False, "unsafe"
    if DESTRUCTIVE.search(n):
        return False, "destructive"
    if admin:
        return False, "admin_only"  # admin lenses stay look-only: nothing new is clicked there
    if SWEEP_DENY.search(n):
        return False, "unsafe"
    if SWEEP_PAYMENT.search(n):
        return False, "payments"
    m = SWEEP_COMPUTE.match(n)
    if m:
        rest = n[m.end():]
        if SWEEP_BULK.search(rest) or HARD_DENY.search(rest):
            return False, "unsafe"
        if read_only:
            return False, "write_skip_lens"
        return True, None
    if is_opener_safe(n):
        return True, None
    m = SWEEP_NAV.match(n)
    if m:
        rest = n[m.end():]
        return (False, "unsafe") if HARD_DENY.search(rest) else (True, None)
    if HARD_DENY.search(n):
        return False, "unsafe"
    return True, None


def is_sweep_safe(name, admin=False, read_only=False):
    return sweep_decision(name, admin, read_only)[0]


# ---------------------------------------------------------------- replay write policy (--allow-write)
# Replayed ticket steps may create/edit/delete ONLY on the walker's own labelled fixture data, as the
# test accounts, on a lens that is neither write-skip nor admin. WRITE_NEVER is refused even with
# --allow-write: payments/billing, roles/permissions/admin, account deletion/sign-out, and anything
# that publishes or sends to other people. Anything in HARD_DENY that is not a plain create/edit verb
# or a delete of the walker's own fixture stays refused exactly as in read-only mode.
WRITE_NEVER = re.compile(r"(?i)\b(pay|payment|payments|buy|purchase|checkout|billing|invoice|subscri\w*|upgrade|plans?|pricing|"
                         r"withdraw|transfer|deposit|donate|gift|fund|tip|stake|sell|trade|swap|bid|mint|refund|payout|wallet|credits?|"
                         r"roles?|permissions?|grant|revoke|promote|demote|ban|kick|impersonate|admin\w*|sudo|"
                         r"account|log\s*out|logout|sign\s*out|deactivate|"
                         r"publish|unpublish|share|send|post|broadcast|announce|invite|dm|"
                         r"all users|everyone|global|public|bulk|every|wipe|purge|truncate|drop|"
                         r"deploy|restart|shutdown|failover|kill|rotate)\b")
WRITE_CREATE_EDIT = re.compile(r"(?i)\b(save|submit|create|add|new|edit|rename|apply|confirm|update|capture|schedule|ok|done)\b")
WRITE_DELETE = re.compile(r"(?i)\b(delete|remove|trash)\b")


def write_step_decision(name, *, admin=False, write_skip=False, allow_write=False, fixture_labels=()):
    """(allowed, reason, kind) for a replayed click. kind: read | create | delete.
    `fixture_labels` are labels of fixtures THIS run's walker created (rec.fixtures, live state)."""
    n = name or ""
    if SWEEP_PAYMENT.search(n):
        return False, "control %r is payment/billing-adjacent - payments are never touched, even with --allow-write" % n, "payment"
    if not HARD_DENY.search(n):
        return True, None, "read"
    if not allow_write:
        return False, "write step needs --allow-write", "write"
    if admin:
        return False, "admin lens stays look-only (no write step)", "write"
    if write_skip:
        return False, "write-skip lens stays read-only (no write step)", "write"
    if WRITE_NEVER.search(n):
        return False, "control %r is a payment/billing/role/admin/account/outward-facing action (safety.WRITE_NEVER) - never run, even with --allow-write" % n, "write"
    if WRITE_DELETE.search(n):
        low = n.lower()
        labels = [l for l in fixture_labels if l]
        if any(l.lower() in low for l in labels):
            return True, None, "delete"
        if labels:
            # a plain "Delete" control: the executor must click it ROW-SCOPED to a walker fixture label
            return True, None, "delete_scoped"
        return False, "delete refused: %r - no fixture created by this walker in this run to target" % n, "delete"
    rest = WRITE_CREATE_EDIT.sub("", n)
    if WRITE_CREATE_EDIT.search(n) and not HARD_DENY.search(rest):
        return True, None, "create"
    return False, "control %r is not a plain create/edit action (safety.HARD_DENY)" % n, "write"
