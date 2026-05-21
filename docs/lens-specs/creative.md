# creative — Feature Gap vs Frame.io / StudioBinder

Category leader (2026): StudioBinder (production management) + Frame.io (review). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: domain macros (`creative.shotListGenerate/assetOrganize/budgetTrack/distributionChecklist`); 402-line domain; generic `/api/lens` artifact store.

## Has (verified in code)
- Creative project management with multiple artifact types
- AI actions: shot-list generation, asset organization, budget tracking, distribution checklist
- Generic artifact CRUD with status workflow

## Missing — buildable feature backlog
- [ ] `[L]` Asset review with frame-accurate comments — timestamped notes on uploaded video/images
- [ ] `[M]` Storyboard / shot-list visual board — ordered shot cards with thumbnails
- [ ] `[M]` Call sheet generator — cast/crew, locations, schedule per shoot day
- [ ] `[M]` Script breakdown — tag elements (props, cast, locations) from a script
- [ ] `[S]` Version stacking on assets — track revisions of a deliverable
- [ ] `[M]` Approval workflow — submit asset, route for review, approve/reject with status
- [ ] `[S]` Production calendar — shoot days, milestones, deliverable due dates

## Parity
~40% of StudioBinder's feature surface. Has the project + budget + checklist scaffold, but missing the frame-accurate review, storyboard, call-sheet, and script-breakdown features that define creative-production tools.
