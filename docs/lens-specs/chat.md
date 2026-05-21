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
- [x] `[M]` Voice mode (speech in / TTS out)
- [x] `[M]` Custom GPTs / configurable assistants with instructions + knowledge files
- [x] `[M]` Canvas-style side-by-side document/code editing
- [x] `[S]` Memory across conversations (persistent user facts)
- [x] `[M]` Code interpreter / sandboxed execution of generated code
- [x] `[S]` Conversation share links (public read-only)
- [x] `[S]` Image generation in-thread

## Parity
~95% of ChatGPT's surface. Streaming, branching, projects, prompts, web search, attachments, vision plus voice mode, custom GPTs/assistants, a canvas editor, persistent memory, a code interpreter, share links, and in-thread image generation all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
