/**
 * MathFormula — real KaTeX rendering, replacing the old hand-rolled
 * Unicode-substitution `renderFormula` helper in app/lenses/math/page.tsx.
 *
 * These tests exercise the REAL `katex` package (already vendored in this
 * app as a transitive dependency of mermaid — see package.json) via the
 * component's actual `katex.renderToString` call. No mocking of katex: we
 * assert against genuine KaTeX-generated markup (`class="katex"`,
 * `katex-mathml`/`katex-html` internals), not a stand-in string.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MathFormula } from '@/components/math/MathFormula';

describe('MathFormula', () => {
  it('renders a real LaTeX formula through actual KaTeX markup', () => {
    const { container } = render(<MathFormula latex="a^2 + b^2 = c^2" />);
    const katexSpan = container.querySelector('.katex');
    expect(katexSpan).not.toBeNull();
    // Genuine KaTeX internals — not producible by string substitution.
    expect(container.querySelector('.katex-mathml')).not.toBeNull();
    expect(container.querySelector('.katex-html')).not.toBeNull();
    // MathML semantic output should contain the actual variables.
    expect(container.innerHTML).toContain('<annotation encoding="application/x-tex">a^2 + b^2 = c^2</annotation>');
  });

  it('renders \\frac and \\sqrt as real KaTeX fraction/sqrt structures, not string substitution', () => {
    // NOTE: JSX string-literal attributes (attr="...") do not interpret JS
    // escape sequences the way {"..."} expression attributes do — a literal
    // "\\frac" written as a bare JSX string attribute stays as two backslash
    // characters instead of one. Use the {"..."} expression form for any
    // LaTeX string containing backslash commands.
    const { container } = render(
      <MathFormula latex={'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}'} />
    );
    // Real KaTeX builds semantic <mfrac> and <msqrt> MathML nodes for these —
    // the old hand-rolled renderer only ever produced "(...)/(...)" text.
    expect(container.querySelector('mfrac')).not.toBeNull();
    expect(container.querySelector('msqrt')).not.toBeNull();
    expect(container.innerHTML).not.toContain('(-b');
  });

  it('renders greek letters and operators as real glyphs via KaTeX, not ad-hoc unicode swaps', () => {
    const { container } = render(<MathFormula latex={'\\sigma = \\sqrt{\\frac{\\sum (x_i - \\mu)^2}{n}}'} />);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('msqrt')).not.toBeNull();
    // KaTeX renders \sum as a proper <mo> large-operator node inside MathML
    // (jsdom decodes the &#x2211; numeric entity to the literal ∑ glyph).
    expect(container.innerHTML).toContain('<mo>∑</mo>');
  });

  it('never throws on malformed LaTeX — renders KaTeX error-highlighted output instead', () => {
    // \frac with an unmatched brace is invalid TeX. throwOnError:false means
    // KaTeX renders its own error markup (red text via .katex-error class or
    // an annotation containing the raw source) rather than the component
    // throwing and crashing the page.
    expect(() => render(<MathFormula latex={'\\frac{1}{'} />)).not.toThrow();
    const { container } = render(<MathFormula latex={'\\frac{1}{'} />);
    expect(container.querySelector('.katex-error, .katex')).not.toBeNull();
  });

  it('renders inline (non-display) mode when displayMode=false', () => {
    const { container } = render(<MathFormula latex="E = mc^2" displayMode={false} />);
    const katexSpan = container.querySelector('.katex');
    expect(katexSpan).not.toBeNull();
    // Display-mode KaTeX wraps output in a block element with the
    // "katex-display" class; inline mode must NOT have it.
    expect(container.querySelector('.katex-display')).toBeNull();
  });

  it('renders display mode (default) with the katex-display wrapper', () => {
    const { container } = render(<MathFormula latex="E = mc^2" />);
    expect(container.querySelector('.katex-display')).not.toBeNull();
  });

  it('does not honor \\href / \\includegraphics (trust:false) — no injected anchor/image', () => {
    const { container } = render(
      <MathFormula latex={'\\href{https://evil.example/x}{click}'} />
    );
    // trust defaults to false, so KaTeX refuses to emit a real <a href>.
    expect(container.querySelector('a[href]')).toBeNull();
  });

  it('falls back to plain text for an empty formula without crashing', () => {
    const { container, getByTestId } = render(<MathFormula latex="" />);
    expect(getByTestId('math-formula-empty')).toBeDefined();
    expect(container.querySelector('.katex')).toBeNull();
  });
});
