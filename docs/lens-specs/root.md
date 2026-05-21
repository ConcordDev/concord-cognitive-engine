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
- [ ] `[S]` Expression evaluator — multi-term expressions with precedence, not just two operands
- [ ] `[S]` History re-load — click a saved computation to reload it into the playground
- [ ] `[S]` Bitwise / modular operations in the base-6 algebra
- [ ] `[S]` Shareable computation link — export a glyph result
- [ ] `[S]` Glyph keyboard input mode — type semantic names instead of pasting glyphs
- [ ] `[S]` Algebra tutorial / worked examples — explain the semantic layer

## Parity
~70% of what this bespoke tool needs. As a domain-specific base-6 algebra calculator it is genuinely complete — converter, operations, semantic layer, and a saved notebook. The few gaps are a multi-term expression evaluator and history re-load.
