"""Click policy. The walker never clicks anything that could write shared state.

Read-only mode clicks only: role=tab, and 'opener' controls (export/download/
filter/sort/view/settings/menu/more/help/info/details/close/cancel).
Write mode (explicit --allow-write, never on admin lenses) additionally clicks
New/Create/Add openers, the in-dialog Create/Save of its OWN labelled fixture,
and Delete on its OWN fixture (identified by label, never position).
"""
import re

# Never clicked in any mode (substring/word match, case-insensitive).
HARD_DENY = re.compile(r"(?i)\b(restore|roll\s*back|rollback|revert|reset|replay|undo|redo|re-?run|rerun|"
                       r"publish|unpublish|share|send|post|broadcast|announce|invite|dm|message all|"
                       r"approve|reject|deny|vote|sign(?!\s*in)|e-?sign|mint|deploy|launch|execute|run|trigger|"
                       r"page|paging|ingest|alert|notify|notification|escalate|ack|acknowledge|resolve|"
                       r"pay|buy|purchase|checkout|order|donate|fund|tip|transfer|withdraw|deposit|bid|sell|trade|swap|stake|claim|"
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
CONFIRM_DELETE = re.compile(r"(?i)^\s*(delete|remove|yes|confirm|ok)\b[\w\s-]{0,20}$")
PUBLIC_HINT = re.compile(r"(?i)\b(public|publish|everyone|global|feed|post to|visible to all|community|marketplace|share with)\b")
CONFIRM_TEXT = re.compile(r"(?i)(are you sure|cannot be undone|can't be undone|permanently|confirm|delete .*\?|remove .*\?)")
ADMIN_EXTRA_DENY = re.compile(r"(?i)\b(page|trigger|ingest|alert|notify|escalate|test|fire|on-?call|incident|ack|silence|"
                              r"maintenance|toggle|flag|kill|restart|deploy|rotate|purge|evict|throttle|limit)\b")


def is_tab_safe(name, admin=False):
    if admin and ADMIN_EXTRA_DENY.search(name or ""):
        return False
    # Tabs are navigation; still refuse obviously-actiony tab labels.
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
SWEEP_DENY = re.compile(r"(?i)\b(delete|remove|clear|reset|publish|share|send|pay|buy|purchase|withdraw|transfer|"
                        r"mint|approve|reject|accept|sign\s*out|log\s*out|logout|theme|dark mode|light mode|"
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
