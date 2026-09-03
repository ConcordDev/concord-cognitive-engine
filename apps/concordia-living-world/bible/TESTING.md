# TESTING

**Status:** PARTIAL (server/browser) · MISSING (Unity play)  
**Authority:** Concord tests own sim; Unity tests presentation contracts  

LIVE: `godot-gateway.test.js`; browser combat is code-true but not Unity. No Unity test that dummy HP drops.

TARGET: vertical slice playtest (fresh 15 min) is blocking. Authority tests must not use `process.exit` in `after()` (see repo CLAUDE.md).
