# ux-suite — Feature Gap vs Storybook / a component directory

Category leader (2026): Storybook (component catalog) — internal utility, no consumer rival. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: none — static directory page; links to the real semantic home of each absorbed UX component.

## Has (verified in code)
- Directory of 19 absorbed UX components grouped into Settings / Progress / World / Ops / Shell.
- Each row — component name, description, deep-link to its real mount, home label, icon.
- Group filter chips with counts; UxRepos discovery panel.
- Deliberately mock-free — the prior fabricated-prop showcase was removed.

## Missing — buildable feature backlog
- [ ] `[M]` Live component preview — render each component in an isolated sandbox (Storybook's core).
- [ ] `[S]` Search / filter across the component list.
- [ ] `[M]` Props/controls panel — interactively tweak a component's props.
- [ ] `[S]` Source / usage snippet per component.
- [ ] `[S]` Auto-generate the catalog from the codebase instead of a hand-maintained array.
- [ ] `[M]` Accessibility / responsive checks per component.
- [ ] `[S]` Variant/state gallery (default / loading / error / empty) per component.

## Parity
~25% of Storybook. As an internal directory it does its narrow job — honestly pointing at real mounts with no mock data — but it is a link list, not a component workbench: no live previews, controls, or search.
