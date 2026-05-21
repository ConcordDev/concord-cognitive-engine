# chat — Feature Gap vs ChatGPT

Category leader (2026): ChatGPT. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST `/api/chat/*` (stream, conversations, messages, sessions, context, tools, summary, harvest, forge, feedback, route, web-metrics) + `server/domains/chat.js` macros (projects CRUD, prompt library CRUD, thread index/search, branches fork/list/delete, scheduled messages).

## Has (verified in code)
- Streaming chat over WebSocket; four-brain routing; DTU-grounded context
- Conversations + sessions; message edit, regenerate, copy, thumbs up/down
- Projects (group conversations); reusable prompt library
- Conversation branching/forking; thread search/index
- Scheduled messages (create/list/cancel); file attachments
- Web search integration; pinned messages, quotes; HackerNews reference panel
- Artifact rendering inline; vision (LLaVA) on image attachments

## Missing — buildable feature backlog
- [ ] `[M]` Voice mode (speech in / TTS out)
- [ ] `[M]` Custom GPTs / configurable assistants with instructions + knowledge files
- [ ] `[M]` Canvas-style side-by-side document/code editing
- [ ] `[S]` Memory across conversations (persistent user facts)
- [ ] `[M]` Code interpreter / sandboxed execution of generated code
- [ ] `[S]` Conversation share links (public read-only)
- [ ] `[S]` Image generation in-thread

## Parity
~68% of ChatGPT's surface. The core — streaming, branching, projects, prompts, web search, attachments, vision — is genuinely complete; gaps are voice, custom GPTs, canvas, persistent memory, and code interpreter.
