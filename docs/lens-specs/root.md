# root — Feature Gap vs a programmer's calculator

Category leader (2026): no consumer rival — closest analog is a base-converting programmer's calculator (this is a bespoke base-6 "Refusal Algebra" tool). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: client-side computation (mirrors `server/lib/refusal-algebra/glyphs.js`); saves computations as `root` lens artifacts via the generic store; mounts RootMetrics.

## Has (verified in code)
- Glyph reference table (base-6 digits 0–5 with semantic names: Refusal/Pivot/Bridge/compounds)
- Decimal ↔ glyph-notation converter with swap, fractional radix support, negatives
- Operation playground: +, −, ×, ÷ over two operands with glyph + decimal + semantic-layer output
- Glyph insertion palette; save-to-notebook (computations persist as artifacts); recent-computations list
- RootMetrics substrate panel

## Missing — buildable feature backlog
- [x] `[S]` Expression evaluator — multi-term expressions with precedence, not just two operands
- [x] `[S]` History re-load — click a saved computation to reload it into the playground
- [x] `[S]` Bitwise / modular operations in the base-6 algebra
- [x] `[S]` Shareable computation link — export a glyph result
- [x] `[S]` Glyph keyboard input mode — type semantic names instead of pasting glyphs
- [x] `[S]` Algebra tutorial / worked examples — explain the semantic layer

## Parity
~95% of what this bespoke tool needs. The base-6 algebra calculator (converter, operations, semantic layer, saved notebook) plus a multi-term expression evaluator with precedence, history re-load, bitwise/modular operations, shareable computation links, a glyph keyboard input mode, and a worked-examples tutorial all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
