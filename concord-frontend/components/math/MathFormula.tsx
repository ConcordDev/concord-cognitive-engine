'use client';

/**
 * MathFormula — real LaTeX rendering via KaTeX.
 *
 * Replaces the prior hand-rolled Unicode-substitution `renderFormula` helper
 * (which only mapped a couple dozen \commands to single Unicode glyphs and
 * dropped every brace) with the actual KaTeX engine, already vendored in
 * this app as a transitive dependency of mermaid (concord-frontend's
 * `@excalidraw/excalidraw` -> `@excalidraw/mermaid-to-excalidraw` ->
 * `mermaid` -> `katex@0.16.45`) and now declared explicitly in package.json.
 *
 * Usage pattern is KaTeX's own documented safe usage
 * (see node_modules/katex/README.md "API" section): `katex.renderToString`
 * returns a self-contained `<span class="katex">...</span>` tree that KaTeX
 * itself sanitizes -- `trust` defaults to `false`, so embedded commands like
 * `\href`/`\includegraphics` that could otherwise inject arbitrary
 * URLs/HTML are refused. `throwOnError: false` means a malformed LaTeX
 * string renders KaTeX's own error-highlighted markup instead of throwing,
 * so a bad formula can never crash the page.
 */

import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathFormulaProps {
  latex: string;
  /** Block/centered display style vs. inline. Defaults to true for the Formulas tab. */
  displayMode?: boolean;
  className?: string;
}

export function MathFormula({ latex, displayMode = true, className }: MathFormulaProps) {
  const html = useMemo(() => {
    if (!latex || !latex.trim()) return '';
    try {
      return katex.renderToString(latex, {
        displayMode,
        throwOnError: false,
        strict: 'ignore',
        trust: false,
      });
    } catch {
      // renderToString with throwOnError:false already swallows LaTeX
      // syntax errors internally; this catch is a last-resort guard against
      // any other unexpected failure so a malformed formula never crashes
      // the tab.
      return '';
    }
  }, [latex, displayMode]);

  if (!html) {
    return (
      <span className={className} data-testid="math-formula-empty">
        {latex}
      </span>
    );
  }

  return (
    <span
      className={className}
      data-testid="math-formula"
      // KaTeX's own renderToString output -- self-sanitized (trust: false),
      // this is KaTeX's documented API for rendering to an HTML string.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default MathFormula;
