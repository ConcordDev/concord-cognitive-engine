# creative — Feature Gap vs StudioBinder / Frame.io

Category leader (2026): StudioBinder (production management) + Frame.io (review). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `creative` domain macros — pure-compute (shotListGenerate, assetOrganize, budgetTrack, distributionChecklist) plus full board/card/connection substrate (board-create/list/get/rename/delete/duplicate, card-add/update/move/raise/delete, connection-add/delete, board-templates, creative-dashboard).

## Has (verified in code)
- 8-tab workspace: Dashboard, Projects, Asset Library, Revisions, Shot List, Client Proofing, Budget, Distribution
- Project CRUD across 11 project types (video/audio/design/writing/branding/campaign/film/social/web/print)
- Mood/idea boards with cards + connections + templates (whiteboard-style ideation substrate)
- Asset library with category taxonomy (photo/video/audio/graphic/document); ArtifactUploader + ArtifactRenderer
- Shot list, client proofing, budget line items, distribution checklist artifact types
- AI actions: shot-list generation, asset organization, budget tracking, distribution checklist
- Revisions artifact type; RedditCreative inspiration feed; realtime panel

## Missing — buildable feature backlog
- [ ] `[L]` Frame-accurate review comments — timestamped notes on uploaded video/images
- [ ] `[M]` Call sheet generator — cast/crew, locations, schedule per shoot day
- [ ] `[M]` Script breakdown — tag props/cast/locations from a script
- [ ] `[M]` Version stacking on assets — explicit revision chain per deliverable
- [ ] `[M]` Approval workflow — submit asset, route for review, approve/reject status
- [ ] `[S]` Production calendar — shoot days, milestones, deliverable due dates
- [ ] `[S]` Shareable client-proof links with external comment capture

## Parity
~50% of a StudioBinder+Frame.io composite. The project + board + budget + shot-list scaffold is broad, but missing the frame-accurate review, call-sheet, and script-breakdown that define production tools.
