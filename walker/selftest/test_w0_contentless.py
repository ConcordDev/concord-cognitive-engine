"""Unit checks for the two-account 'contentless' classifier (checks._contentless / _payload_shape)."""
import sys
from concord_walker.checks import _contentless, _payload_shape

fails = 0
def check(name, cond, info=None):
    global fails
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else "  %r" % (info,)))
    fails += 0 if cond else 1

# exact pre-#2371 GET /api/chat/memory/:id zero body (unseen session)
ZERO = {"ok": True, "activeMessages": 0, "totalMessagesProcessed": 0, "compressionCycles": 0,
        "memoryDtuCount": 0, "megaCount": 0, "topics": [], "windowUtilization": "0/50"}
check("chat-memory zero shape is contentless", _contentless(ZERO), _payload_shape(ZERO))
check("chat-memory zero shape with literal '0/N' is contentless", _contentless(dict(ZERO, windowUtilization="0/N")))
check("chat-memory zero shape: 7 leaves, 0 non-empty", _payload_shape(ZERO) == (7, 0), _payload_shape(ZERO))
REAL = dict(ZERO, activeMessages=12, topics=["tax", "garden"], windowUtilization="12/50")
check("real chat-memory stats are not contentless", not _contentless(REAL), _payload_shape(REAL))
check("real stats count non-empty leaves", _payload_shape(REAL)[1] == 4, _payload_shape(REAL))
for name, b in [("empty dict", {}), ("empty list", []), ("ok only", {"ok": True}), ("success only", {"success": True}),
                ("nested zeros", {"stats": {"a": 0, "b": 0.0, "c": None, "d": False, "e": "", "f": {}, "g": []}}),
                ("template strings", {"a": "0%", "b": "0.0", "c": "n/a", "d": "-", "e": "0 / 100"}),
                ("list of zero dicts", {"items": [{"n": 0}, {"n": 0}]})]:
    check("contentless: " + name, _contentless(b), _payload_shape(b))
for name, b in [("a title", {"title": "t1 private note"}), ("one count", {"n": 1}), ("true flag (not ok/success)", {"pinned": True}),
                ("nested string", {"a": {"b": ["x"]}}), ("non-template fraction", {"w": "3/50"}), ("zero-prefixed id", {"id": "0a1b"})]:
    check("has content: " + name, not _contentless(b), _payload_shape(b))
check("non-JSON (None) is never contentless", not _contentless(None))
check("a value echoing the requested path id is not content",
      _contentless({"sessionId": "abc123", "count": 0}, echoes=("api", "chat", "memory", "abc123")))
check("a different id is content", not _contentless({"sessionId": "zzz999", "count": 0}, echoes=("abc123",)))
print("failures:", fails)
sys.exit(1 if fails else 0)
