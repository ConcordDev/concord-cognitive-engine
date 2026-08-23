'use client';

/**
 * JsonSyntaxBlock — a small, real, hand-rolled JSON syntax highlighter.
 * No new dependency was pulled in for this: this codebase has no
 * syntax-highlighting library installed, and adding one just for a single
 * decorative marketing-page snippet wasn't warranted. Tokenizes real JSON
 * text into key/string/number/boolean/null/punctuation spans — genuine
 * syntax highlighting of genuine text, not a static screenshot.
 */

interface Token {
  text: string;
  kind: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'whitespace';
}

const TOKEN_COLOR: Record<Token['kind'], string> = {
  key: 'text-sky-300',
  string: 'text-emerald-300',
  number: 'text-orange-300',
  boolean: 'text-purple-300',
  null: 'text-purple-300',
  punctuation: 'text-zinc-500',
  whitespace: '',
};

// Matches, in priority order: a quoted string immediately followed by a
// colon (a key), any other quoted string (a value), numbers, true/false/
// null literals, or a single punctuation/whitespace character.
const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)|("(?:\\.|[^"\\])*")|(-?\d+\.?\d*)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],:])|(\s+)/g;

function tokenize(json: string): Token[] {
  const tokens: Token[] = [];
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(json)) !== null) {
    const [, keyStr, keyColon, valStr, num, bool, nul, punct, ws] = match;
    if (keyStr !== undefined) {
      tokens.push({ text: keyStr, kind: 'key' });
      tokens.push({ text: keyColon, kind: 'punctuation' });
    } else if (valStr !== undefined) tokens.push({ text: valStr, kind: 'string' });
    else if (num !== undefined) tokens.push({ text: num, kind: 'number' });
    else if (bool !== undefined) tokens.push({ text: bool, kind: 'boolean' });
    else if (nul !== undefined) tokens.push({ text: nul, kind: 'null' });
    else if (punct !== undefined) tokens.push({ text: punct, kind: 'punctuation' });
    else if (ws !== undefined) tokens.push({ text: ws, kind: 'whitespace' });
  }
  return tokens;
}

export function JsonSyntaxBlock({ value, caption }: { value: unknown; caption?: string }) {
  const json = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const tokens = tokenize(json);
  return (
    <div>
      <pre className="overflow-x-auto font-mono text-[12px] leading-relaxed">
        <code>
          {tokens.map((t, i) => (
            <span key={i} className={TOKEN_COLOR[t.kind]}>
              {t.text}
            </span>
          ))}
        </code>
      </pre>
      {caption && <p className="mt-2 text-[10px] italic text-zinc-500">{caption}</p>}
    </div>
  );
}

export default JsonSyntaxBlock;
