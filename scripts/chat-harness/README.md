# Chat + MCP harness

`node scripts/chat-harness/run.mjs --profile light` (live, localhost:5050) or `--profile full`.

What it does, in order: lists every chat tool (server list vs `chat-tool-surface.js`) and every MCP tool and marks each
REACHABLE / UNREACHABLE / AUTH-GATED-AS-EXPECTED; calls the read-only MCP tools with valid inputs; checks the anonymous and
non-admin MCP gates; runs direct known-answer compute calls; then drives `/api/chat/stream` as the verify account through
normal, edge and adversarial prompts. Each case is PASS / FAIL / CONFUSED with a reason code
(wrong_tool, bad_args, untraced_number, hallucinated_citation, refused_wrongly, looped, timeout, tool_error, auth_leak).

Output: `~/.zuko/quality/chat-tests/<timestamp>/{results.jsonl,summary.txt}`.

Safety: reads the account file in-process and never logs it (`redact()` also strips tokens/cookies/jwt-looking strings);
concurrency 1; `--delay-ms` between calls; `--max-minutes` budget; MCP/chat tools that write, spend or run code are only
enumerated, never called; adversarial "injection" cases put the hostile text in the user turn because the harness cannot write
DTUs on a live site. Add a regression case to `cases.mjs` whenever a chat failure is fixed.
