// Lightweight token-based syntax highlighter for the docs code block.
// Pure-compute, no dependencies — escapes HTML then wraps recognised
// tokens (keywords, strings, numbers, comments) in coloured spans.

const KEYWORDS: Record<string, string[]> = {
  javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'throw', 'typeof', 'this', 'null', 'true', 'false', 'undefined'],
  typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'class', 'new', 'import', 'export', 'from', 'async', 'await', 'try', 'catch', 'throw', 'typeof', 'this', 'null', 'true', 'false', 'undefined', 'interface', 'type', 'enum', 'as', 'extends', 'implements', 'public', 'private', 'readonly'],
  python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'class', 'import', 'from', 'as', 'try', 'except', 'raise', 'with', 'lambda', 'None', 'True', 'False', 'and', 'or', 'not', 'in', 'is', 'pass', 'yield', 'async', 'await'],
  rust: ['fn', 'let', 'mut', 'return', 'if', 'else', 'for', 'while', 'loop', 'struct', 'enum', 'impl', 'trait', 'use', 'pub', 'mod', 'match', 'self', 'Some', 'None', 'Ok', 'Err', 'true', 'false', 'async', 'await'],
  go: ['func', 'var', 'const', 'return', 'if', 'else', 'for', 'range', 'struct', 'interface', 'type', 'package', 'import', 'go', 'defer', 'chan', 'map', 'nil', 'true', 'false', 'switch', 'case'],
  sql: ['SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'UPDATE', 'DELETE', 'CREATE', 'TABLE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'VALUES', 'SET', 'AND', 'OR', 'NOT', 'NULL', 'AS', 'DISTINCT'],
  bash: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'echo', 'export', 'local', 'return'],
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightCode(code: string, language: string): string {
  if (!code) return '';
  const lang = (language || 'plain').toLowerCase();

  // JSON / YAML / HTML / CSS / markdown / plain: escape only (still readable).
  const kw = KEYWORDS[lang];
  let html = esc(code);

  // strings
  html = html.replace(/(&quot;|&#39;|')(?:(?!\1).)*\1|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
    (m) => `<span style="color:#fca5a5">${m}</span>`);
  // comments
  if (lang === 'python' || lang === 'bash' || lang === 'yaml') {
    html = html.replace(/#[^\n]*/g, (m) => `<span style="color:#71717a">${m}</span>`);
  } else if (lang !== 'plain' && lang !== 'json') {
    html = html.replace(/\/\/[^\n]*/g, (m) => `<span style="color:#71717a">${m}</span>`);
  }
  // numbers
  html = html.replace(/\b\d+(?:\.\d+)?\b/g, (m) => `<span style="color:#fbbf24">${m}</span>`);
  // keywords
  if (kw && kw.length) {
    const re = new RegExp(`\\b(${kw.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
    html = html.replace(re, (m) => `<span style="color:#93c5fd;font-weight:600">${m}</span>`);
  }
  return html;
}
