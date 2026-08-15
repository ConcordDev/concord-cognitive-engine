# Dynamic Context Engine — Design Plan

## Problem
Conscious brain KV cache consumes 0.75GB at 8K, 1.5GB at 16K, 2.8GB at 30K.
With 5 brains loaded + OLLAMA_KEEP_ALIVE=-1 on 48GB A40, we have:
- 8K all-brains:  ~22.6GB weights + ~1.75GB KV = 24.4GB used (good)
- 16K all-brains: +0.75GB = 25.2GB (good)
- 20K all-brains: +0.94GB = 25.4GB (acceptable)
- 30K all-brains: +1.4GB = 26GB (acceptable BUT scratch space tight)

## Solution: Dynamic Context Orchestrator
1. **Per-request context sizing**: 8K → 20K dynamic range based on input length + intent
2. **Sliding-window KV compaction**: When context overflows N tokens, summarize oldest chunk
3. **DTU substrate memory vault**: Per-user private DTU store — past conversations stored as DTUs
4. **Reference instead of replay**: When relevant prior context exists as DTU, inject DTU ID not raw tokens

## Architecture

### 1. dynamic-context.js
   - `getContextSize({ inputTokens, intent, userTier, systemLoad })`
   - Returns 8192 / 12288 / 16384 / 20480
   - Intent detection: 'chat' → 8K, 'analysis' → 12K, 'long-doc' → 16K, 'codebase' → 20K
   - System load check: if VRAM > 35GB, halve max
   - Cache the result per (userId, intent, inputLength bucket) for 60s

### 2. kv-compactor.js
   - `compactKV(messages, maxTokens, summaryThreshold)`
   - When total > maxTokens: split into [recent, older]
   - older → summarize via utility brain (3B, fast) → compact summary
   - Output: [summaryMessage, ...recent]
   - Token savings: 20K → 2K summary = 90% reduction
   - Summary stored as DTU with id = dtu_compact_<userId>_<timestamp>

### 3. dtu-memory-vault.js
   - `vaultStore(userId, key, content, kind)` → DTU
   - `vaultRecall(userId, query, topK=3)` → DTU IDs (relevance ranked)
   - `vaultCompact(userId, olderThan)` → prune old entries
   - Storage: existing DTU table with new kind='memory_vault'
   - Indexes: user_id, created_at, kind
   - Embedding: use mxbai-embed-large for semantic recall

### 4. context-orchestrator.js
   - `prepareContext({ userId, messages, intent, systemLoad })`
   - 1. Determine target size via dynamic-context
   - 2. Try vaultRecall for relevant prior context
   - 3. If total > target, run kv-compactor
   - 4. Inject vault references as compact system messages
   - 5. Return final messages array + metadata

## Integration
- brain-config.js: add `dynamicContextForRequest(brainName, request)` hook
- server.js: route conscious calls through context-orchestrator
- Keep other 4 brains at static caps (no need to over-engineer)

## Token Economics (per conscious call)

### Current (8K fixed):
- 8K context = 0.75GB VRAM always
- Wasted tokens: 8K-actual_tokens (often 80% unused)

### After (8K-20K dynamic):
- Avg 12K context = ~1.1GB VRAM (50% more)
- BUT vault recall replaces 5K of recent context with 200-token DTU ref
- Net: 12K - 5K + 200 = 7.2K effective, only 0.67GB
- PLUS: user gets richer context via vault refs

### After (with KV compaction):
- 20K context budget, but only last 8K is raw
- Older 12K compressed to 1.5K summary + 1 DTU ref
- Net: 8K raw + 1.5K summary + 200 ref = 9.7K effective
- User has full conversation memory via vault refs

## Files to ship (commit boundary)

1. server/lib/dynamic-context.js
2. server/lib/kv-compactor.js
3. server/lib/dtu-memory-vault.js
4. server/lib/context-orchestrator.js
5. server/lib/brain-config.js (update — add dynamicContextForRequest hook)
6. server/server.js (wire orchestrator into conscious call path)
7. server/migrations/<n>_memory_vault.js (DTU table for vault)
8. server/tests/dynamic-context.test.js
9. server/tests/kv-compactor.test.js
10. server/tests/dtu-memory-vault.test.js
11. server/tests/context-orchestrator.test.js

## Testing strategy
- Unit tests for each module
- Integration test: full prepareContext → ollama call → verify token savings
- Mock ollama for fast tests, real ollama for E2E

## Out of scope (separate tasks)
- Multi-user vault isolation (do in next pass)
- Vault pruning policy (TTL-based, 30-day default)
- Vault export/import (user data rights)
- Cross-session memory continuity (needs auth context)

## Risks
- KV compaction via utility brain adds latency (~100ms)
- DTU vault growth — needs TTL/cleanup
- Embedding lookup cost — cache embeddings in-memory
