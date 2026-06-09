// concord-frontend/lib/dsl/concord-dsl-lang.ts
//
// Frontend registration of the Concord DSL (server/lib/dsl.js) as a Monaco
// language: syntax highlighting (Monarch grammar), language config (comments,
// brackets, auto-close), and a completion provider for keywords + macro calls.
// `registerConcordDsl` takes `monaco` by injection so the pure pieces (grammar,
// config, completion logic) are unit-testable without loading the editor.

export const CONCORD_DSL_ID = "concord-dsl";

export const DSL_KEYWORDS = ["let", "if", "else", "true", "false", "null"] as const;

// Monarch tokenizer — mirrors the server lexer (server/lib/dsl.js#tokenize):
// `#` line comments, strings, numbers, the `let/if/else` keywords, a `domain` in a
// `domain.macro(` call highlighted as a type, brackets + delimiters.
export const MONARCH = {
  defaultToken: "",
  keywords: [...DSL_KEYWORDS],
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      // a dotted name immediately followed by `(` is a macro call → its head is a "type"
      [/[a-zA-Z_]\w*(?=\s*\.\s*[a-zA-Z_]\w*\s*\()/, "type"],
      [/\b(?:let|if|else|true|false|null)\b/, "keyword"],
      [/[a-zA-Z_]\w*/, "identifier"],
      [/"(?:[^"\\]|\\.)*"/, "string"],
      [/'(?:[^'\\]|\\.)*'/, "string"],
      [/-?\d+(?:\.\d+)?/, "number"],
      [/[{}()[\]]/, "@brackets"],
      [/[.,:=|]/, "delimiter"],
    ],
  },
};

export const LANG_CONFIG = {
  comments: { lineComment: "#" },
  brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

export interface DslCompletion {
  label: string;
  kind: "keyword" | "function";
  insertText: string;
  snippet?: boolean;
}

/**
 * Pure completion logic: keywords + macro `domain.macro(…)` snippets, filtered by
 * the typed prefix. `macroNames` is a list like ["dtu.create", "discovery.search"].
 */
export function dslCompletions(prefix: string, macroNames: string[] = []): DslCompletion[] {
  const p = String(prefix || "").toLowerCase();
  const kw: DslCompletion[] = DSL_KEYWORDS.map((k) => ({ label: k, kind: "keyword", insertText: k }));
  const macros: DslCompletion[] = (macroNames || []).map((m) => ({ label: m, kind: "function", insertText: `${m}(\${1})`, snippet: true }));
  return [...kw, ...macros].filter((c) => !p || c.label.toLowerCase().startsWith(p));
}

type MonacoLike = {
  languages: {
    getLanguages: () => Array<{ id: string }>;
    register: (def: unknown) => void;
    setMonarchTokensProvider: (id: string, g: unknown) => void;
    setLanguageConfiguration: (id: string, c: unknown) => void;
    registerCompletionItemProvider: (id: string, provider: unknown) => void;
    CompletionItemKind: { Keyword: number; Function: number };
    CompletionItemInsertTextRule: { InsertAsSnippet: number };
  };
};

/**
 * Register the language with Monaco (idempotent). `getMacros` supplies the macro
 * name list for completions (e.g. from the lens manifest); optional.
 */
export function registerConcordDsl(monaco: MonacoLike, { getMacros }: { getMacros?: () => string[] } = {}): boolean {
  if (!monaco?.languages) return false;
  if (monaco.languages.getLanguages().some((l) => l.id === CONCORD_DSL_ID)) return false; // once
  monaco.languages.register({ id: CONCORD_DSL_ID, extensions: [".cdsl"], aliases: ["Concord DSL", "concord-dsl"] });
  monaco.languages.setMonarchTokensProvider(CONCORD_DSL_ID, MONARCH);
  monaco.languages.setLanguageConfiguration(CONCORD_DSL_ID, LANG_CONFIG);
  monaco.languages.registerCompletionItemProvider(CONCORD_DSL_ID, {
    triggerCharacters: [".", " "],
    provideCompletionItems(model: { getWordUntilPosition: (p: unknown) => { word: string; startColumn: number; endColumn: number } }, position: { lineNumber: number }) {
      const word = model.getWordUntilPosition(position);
      const macroNames = typeof getMacros === "function" ? getMacros() : [];
      const suggestions = dslCompletions(word.word, macroNames).map((c) => ({
        label: c.label,
        kind: c.kind === "keyword" ? monaco.languages.CompletionItemKind.Keyword : monaco.languages.CompletionItemKind.Function,
        insertText: c.insertText,
        insertTextRules: c.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
        range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn },
      }));
      return { suggestions };
    },
  });
  return true;
}
