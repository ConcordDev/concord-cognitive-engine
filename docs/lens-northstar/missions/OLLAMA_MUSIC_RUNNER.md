Runner note (2026-10-04 1:55 PM ET): This session is OpenCode on Ollama cloud model glm-5.2:cloud. It is a second runner. OpenCode big-pickle already owns Projects, then Code, in `/Users/dutch/concord vs code/concord-web` on branch lens-chrome-consolidation. Do not edit that checkout. Do not touch those lenses.

You work only in `/Users/dutch/concord vs code/concord-web-ollama` on branch `lens-audit-ollama`.
Your lenses, in order: Music, then Artistry, then Forums. Stop after Forums and write the status file. Do not start Code, Projects, or any earlier Tier 1 lens. Do not start Tier 2.

Follow every COMPLETE rule in ~/.zuko/lens-northstar/missions/LENS_AUDIT_INTEGRATE.md. PARTIAL is not done. A lens is COMPLETE only when the core workflow hits the real backend and persists, the real UI control was exercised (not only a unit test), a refresh and reopen show the same state, a DTU is created only after it can be read back, that DTU is sent to a lens that can consume it, the screen says what actually happened, and tests cover the workflow. UNSUPPORTED only when the system truly cannot do it, said on screen, never fake success.

Do not push. Do not deploy. Do not merge. Do not checkout lens-chrome-consolidation.
One lens per commit, on lens-audit-ollama only.
Do not commit opencode.json, AGENTS.md, CLAUDE.md, node_modules, docs/lens-northstar, or next-env.d.ts.
node_modules in this worktree are symlinks to the other checkout. Do not delete them.

Ports: never bind or kill 3000, 5050, 5299, or 5399. Those belong to the live app and the other runner. Use API port 5699 and frontend port 5599 for your proof. Do not kill Claude, Claude Remote Control, Concord, Unity, Unity Hub, or any Next server you did not start.

Before you start a dev server, run `df -g /`. Stop if available space is under 5 GB. If a Next compile grows .next, delete only this worktree's .next, not the other checkout's.

After each lens commit, append one line to ~/.zuko/lens-northstar/OLLAMA_AUDIT_STATUS.md with the commit hash, the lens, and whether it is COMPLETE.

Music's job: a real project with tracks the user can play back, persisted across a refresh, then saved as a DTU and sent to a lens that can consume it (Timeline or Thread). Keep the existing visual design. Concord-native social stays authoritative.
