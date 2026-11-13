# Cockpit research: how other systems keep long tool runs reliable

Ticket GB-1500, brief `FABLE-COCKPIT-BRIEF.md`. Research done 2026-11-12, before any design.
Every source below was opened in this run. Where a page did not show what I wanted, that is said.

## 1. What each system does

### OpenAI: function calling and Structured Outputs
Source: https://developers.openai.com/api/docs/guides/function-calling (the brief's `platform.openai.com` URL redirects here) and https://developers.openai.com/api/docs/guides/structured-outputs

- `strict: true` constrains the call to the schema. Requirements quoted from the page: "`additionalProperties` must be set to `false` for each object in the `parameters`" and "All fields in `properties` must be marked as `required`". Optional fields are written as a union with `null`. The docs say "We recommend always enabling strict mode."
- `tool_choice` has four shapes: auto, required, one forced function, and an allowed-tools subset ("Restrict the tool calls the model can make to a subset of the tools available to the model").
- `parallel_tool_calls: false` limits a turn to zero or one call. The page recommends turning parallel calls off for the smallest model snapshot it names.
- Tool count guidance: aim for fewer than 20 functions at the start of a turn ("just a soft suggestion"), and use tool search to defer the rest.
- Design guidance: use enums and object structure to make invalid states impossible, don't make the model fill arguments the code already knows, combine functions that are always called in sequence.
- Structured Outputs "constrains completed, non-refusal model output to your supplied JSON Schema". Two escape hatches remain: a refusal, and truncation at the token limit (`incomplete`).

### OpenAI Agents SDK
Source: https://openai.github.io/openai-agents-python/

- Primitives: agents, handoffs, guardrails (run alongside the agent and "fail fast when checks do not pass"), sessions, tracing, human in the loop.
- The landing page does not describe max turns, tool error handling, or resume in any detail. I did not read deeper pages, so I make no claim about them.

### Anthropic: tool use, strict tools, error results
Sources: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview (the brief's `docs.anthropic.com` URL redirects here), https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use, https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls

- `strict: true` "guarantees Claude's tool inputs match your JSON Schema by constraining the model's token sampling to schema-valid outputs (a technique called grammar-constrained sampling)". Two guarantees are listed: the input follows the schema, and the tool name is always valid.
- `tool_choice: {type: "auto", disable_parallel_tool_use: true}` gives at most one call per turn.
- Errors go back as a `tool_result` with `is_error: true`. The page's advice: "Write instructive error messages. Instead of generic errors such as `"failed"`, include what went wrong and what Claude should try next".
- On invalid or missing parameters the model "will retry 2–3 times with corrections before apologizing to the user". The fix the page recommends is strict mode.
- Tool results are untrusted input: "an attacker who can influence it might embed instructions that try to redirect Claude (indirect prompt injection)". Keep them inside tool-result blocks, never in the system prompt.
- A tool search tool exists for "thousands of tools by discovering and loading them on demand".

### Anthropic: "Building effective agents"
Source: https://www.anthropic.com/engineering/building-effective-agents

- Workflows are "LLMs and tools ... orchestrated through predefined code paths". Agents are where "LLMs dynamically direct their own processes and tool usage". The advice is to use the simplest thing that works; workflows give predictability for well-defined tasks.
- Named patterns: prompt chaining (with programmatic checks between steps), routing, parallelization, orchestrator-workers, evaluator-optimizer.
- Agents should get ground truth from the environment at each step, pause for human feedback at checkpoints, and have stopping conditions.
- Agent-computer interface: put as much design effort into tools as into a human interface, and "poka-yoke" the arguments so mistakes are hard to make.

### LangGraph: checkpoints, durability, interrupts
Sources: https://docs.langchain.com/oss/python/langgraph/checkpointers and https://docs.langchain.com/oss/python/langgraph/interrupts. The brief's two `langchain-ai.github.io` URLs returned only "Redirecting...", and `https://docs.langchain.com/oss/python/langgraph/durable-execution` served the persistence overview rather than a durable-execution page in my fetch, so the durable-execution wording is taken from the checkpointers page only.

- "A checkpoint is a snapshot of the graph state saved at each super-step." A thread groups checkpoints by `thread_id`.
- If a node fails mid-step, writes from nodes that already succeeded are kept: "When you resume graph execution from that super-step you don't re-run the successful nodes."
- Three durability modes: `exit` (persist only when the run ends), `async` (persist while the next step runs; a crash can lose a checkpoint), `sync` ("persists changes synchronously before the next step starts").
- `interrupt()` pauses with a JSON payload and waits with no time limit. Resume passes a value back. The node restarts from its beginning on resume, so side effects before the interrupt must be idempotent or moved after it.
- Approve, edit, and reject are the three human responses shown for a pending tool call.

### Temporal: deterministic workflows, retried activities
Sources: https://docs.temporal.io/workflows, https://docs.temporal.io/activities, https://docs.temporal.io/encyclopedia/retry-policies, https://docs.temporal.io/workflow-execution/event

- The event history is "the source of truth for everything that happens in the Workflow". On resume "the Workflow code is re-run, but uses the recorded events instead of redoing work". Workflow code must not read the clock, random numbers, or the network directly.
- Activities do the outside-world work (LLM calls are named as an example). "Activities aren't executed again during replay." The recommendation: "We recommend that it be idempotent, so retries can be processed without duplicate side effects."
- Default activity retry policy: initial interval 1 second, backoff coefficient 2.0, maximum interval 100 times the initial interval, unlimited attempts, and a list of non-retryable error types that is empty by default. Workflows have no default retry policy.
- A workflow is terminated when its history "exceeds 51,200 Events"; continue-as-new is the escape.

### MCP tools
Source: https://modelcontextprotocol.io/specification/2025-06-18/server/tools

- A tool has `name`, `title`, `description`, `inputSchema`, optional `outputSchema`, and `annotations`.
- Two error channels. Protocol errors (unknown tool, invalid arguments) are JSON-RPC errors. Tool execution errors come back in the result with `isError: true`, so the model can see and react to them.
- If `outputSchema` is present, "Servers MUST provide structured results that conform to this schema" and "Clients SHOULD validate structured results against this schema."
- Security: "there SHOULD always be a human in the loop with the ability to deny tool invocations". Servers must validate inputs, rate limit, and sanitize outputs. Clients should confirm sensitive operations, validate results before passing them to the model, set timeouts, and log usage.

### Constrained decoding for local models
Sources: https://ollama.com/blog/structured-outputs, https://docs.ollama.com/capabilities/tool-calling, https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md, https://dottxt-ai.github.io/outlines/latest/

- Ollama `/api/chat` takes `format: <JSON schema>` and returns content that matches it. Recommendations: set temperature to 0, and also tell the model in the prompt to return JSON.
- Ollama native tool calling: `tools` in the request, `tool_calls` in the reply, results sent back as `role: "tool"` with `tool_name`.
- llama.cpp converts a subset of JSON Schema to a GBNF grammar. Limits that matter for us: "Unsupported features are skipped silently"; `minimum`/`maximum` work for integers only; `pattern` must start with `^` and end with `$`; mixing `properties` with `anyOf`/`oneOf` in one type is not supported; nested `$ref` is broken. The grammar "is only used to constrain the model output and is not injected into the prompt", so the prompt must describe the shape too. Writing optional repeats as `x? x? x?` can cause "extremely slow sampling".
- Outlines "guarantees structured outputs during generation" for JSON schema, regex, choices and grammars across local and hosted backends.

### Small-model evidence
Sources: https://gorilla.cs.berkeley.edu/leaderboard.html, https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html, https://github.com/sierra-research/tau-bench, https://arxiv.org/abs/2406.12045, https://arxiv.org/abs/2509.26553, https://neurips.cc/virtual/2026/171271

- The BFCL leaderboard table did not render in my fetch, so I quote no scores from it. The V3 multi-turn write-up does list the failure modes: failing to make implicit calls, failing to probe state before acting ("Even the best LLMs sometimes fail to explore the current state before performing actions"), unnecessary planning, looping (a turn is force-terminated after 20 steps), and ending a turn early by emitting chat text instead of a call.
- tau-bench: function-calling agents "succeed on <50% of the tasks", and pass^8 in retail is below 25%. The repo's leaderboard shows the best listed model falling from 0.692 at pass^1 to 0.462 at pass^4 in retail. Its fault types are `goal_partially_completed`, `used_wrong_tool`, `used_wrong_tool_argument`, `took_unintended_action`.
- FuncBenchGen (arXiv 2509.26553): strong models make syntactically valid calls but "propagate incorrect or stale argument values across steps". Restating prior variable values at each step raised one model's success "from 62.5% to 81.3%".
- "Same Quantization, Different Failures" (NeurIPS 2026): on BFCL v4 multi-turn, xLAM-2-3B drops from 58.00% to 51.75% at Q4_K_M and Qwen3-1.7B from 14.50% to 8.75%. Qwen3-1.7B's wrong-argument rate rises from 20.8% to 26.9%, and more of its failures become "silent": trajectories with no runtime error that are still wrong.

### Coding-agent loops
Sources: https://arxiv.org/abs/2405.15793 (SWE-agent), https://cursor.com/docs/agent/overview, https://docs.openhands.dev/openhands/usage/agents

- SWE-agent's claim is that agents are a new kind of end user and that a purpose-built agent-computer interface "significantly enhances an agent's ability" on the same model.
- Cursor: checkpoints are created automatically before significant changes and can be restored; a follow-up message is queued and "delivered at the agent's next tool call"; "There is no limit on the number of tool calls Agent can make during a task."
- The OpenHands page I reached is an archived overview and says nothing about error feedback, stuck detection or limits, so I make no claim about OpenHands beyond that.
- I did not open any Devin page.

## 2. Comparison

"Concord now" is from the audit (`AUDIT.md`), with its evidence there.

| Capability | OpenAI | Anthropic | LangGraph | Temporal | MCP | Ollama / llama.cpp | Concord now |
|---|---|---|---|---|---|---|---|
| Schema-constrained call | `strict: true` | `strict: true` | n/a | n/a | `inputSchema` | `format` schema, GBNF | No. Text marker `[TOOL_CALL: …]` parsed by regex; `format` is plumbed in `ollama-client.js` but no tool loop passes it |
| Tool name always valid | yes under strict | yes under strict | n/a | n/a | protocol error | enum in schema | No. Unknown names reach `unknownToolResult` after the fact |
| Small tool menu | under 20 advised, tool search, allowed tools | tool search | n/a | n/a | paginated list | n/a | No. Agent loop sends all 34 tools every turn; `pickTools` is dead code |
| One call per turn | `parallel_tool_calls: false` | `disable_parallel_tool_use` | n/a | n/a | n/a | n/a | No. Up to 6 calls per turn, 5 on plain chat |
| Errors fed back to model | output string | `is_error` plus instructive text | node retry | activity retry | `isError: true` | n/a | Partial. Agent loop: 2 recovery turns. Plain chat: none |
| Retry policy by error class | caller's job | caller's job | per node | default policy, non-retryable list | n/a | n/a | One regex pair, same treatment for every recoverable class |
| Durable state per step | no | no | checkpoint per super-step | event history | n/a | n/a | Marathon logs tool dispatches; chat and agent loops keep everything in memory |
| Resume after crash | no | no | from last checkpoint | replay | n/a | n/a | Marathon only, and it re-runs the model |
| Human confirm | SDK feature | caller's job | `interrupt()` | signals | SHOULD confirm | n/a | High-risk needs `approval: true`, which the model itself can put in the call |
| Idempotent retries | caller's job | caller's job | caller's job | recommended for activities | n/a | n/a | F0 gate is in-memory, 60 s, observe-only for people |
| Output validation | schema | schema | n/a | n/a | `outputSchema` | n/a | Recipes only |
| Signed record of each step | tracing | no | no | history (unsigned) | "log usage" | n/a | Ed25519 receipts exist; used for recipes and ConKay, not for agent steps |
| Context per step | whole conversation | whole conversation | whole state | n/a | n/a | n/a | Whole conversation plus up to 12,000 chars per tool result |

## 3. What they do that Concord does not

1. Constrain the call at decode time, so a wrong shape or an invented tool name cannot be produced.
2. Give the model a short tool list instead of the whole catalogue.
3. Allow one call per turn for weak models.
4. Persist every step before the next one starts, and resume from that record without asking the model again.
5. Treat side effects as activities with idempotency, separate from the deterministic orchestration.
6. Put the human confirmation in the runtime (an interrupt), not in an argument the model writes.
7. Classify errors and attach a retry policy to each class, with a non-retryable list.
8. Validate tool output against a declared shape.

## 4. How Concord beats them

The north star is reliability per token on a small model. None of the systems above ship all of this together; each leaves at least plan state, verification or receipts to the application.

1. **The server owns the plan.** Every competitor loop leaves the plan in the model's context. Ours keeps it in the database and hands the model one step. The FuncBenchGen result (restating prior values lifts success from 62.5% to 81.3%) says small state restated every step is the right shape, and the plan makes that the default: each step packet carries a typed summary of the values earlier steps produced.
2. **Deterministic first, model second.** Concord has 31,404 registered lens actions, tested recipes, and deterministic solvers. A step whose tool and arguments the plan already knows runs with no model call at all. The model is only asked where a choice is real. Fewer model calls means fewer chances to fail, which is the cheapest reliability there is.
3. **Constrained calls on the local model.** Ollama's `format` gives the 2B the same guarantee `strict` gives the hosted models, and the schema is built from the per-step menu, so the tool name is an enum of at most 8 values.
4. **Repair before re-ask.** Alias maps, fuzzy name match, key normalization, unit coercion and hint defaults fix most bad calls in code. Anthropic's own number is 2 to 3 model retries for a missing parameter; a code repair costs zero tokens.
5. **Verification on every step.** tau-bench and the quantization paper both show failures that raise no error. Each step declares what it expects, and the check is code (schema, range, numeric trace, receipt) before any judge model.
6. **Signed receipts per step.** Concord already has Ed25519 receipts with a published key. Nobody in the table signs agent steps. A user or an outside agent can check that step 7 really ran with those inputs.
7. **F0 and account scopes on one path.** Chat, ConKay, lens Ask, the Agents lens and outside MCP agents call one executor, so GB-1498's per-account caps and the same risk classes apply to all of them.
8. **Confirmation the model cannot forge.** `awaiting_confirm` is a run state. Approval comes from the signed-in person's click, bound to the step's argument hash.
9. **Honest stops.** Only governance, auth, money and consent errors stop a run, and the run says which one. Everything else has a retry, a repair, an alternate tool or a question for the user.
10. **DTU memory across runs.** Completed steps are logged to the existing action memory, so the next run retrieves "last time this worked with these arguments" as evidence.
