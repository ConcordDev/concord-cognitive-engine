/**
 * Proof's Monaco themes. Monaco needs literal colours, so they live here and
 * mirror the --pf-* tokens in proof.css. Syntax colour is deliberately quiet
 * (graphite greys and two soft hues) so lime stays reserved for "proved".
 */
import type { editor } from 'monaco-editor';

const colors: editor.IColors = {
  'editor.background': '#0c0e11',
  'editor.foreground': '#e4e7eb',
  'editorLineNumber.foreground': '#3d4450',
  'editorLineNumber.activeForeground': '#b9bfc8',
  'editor.lineHighlightBackground': '#14171c',
  'editor.lineHighlightBorder': '#00000000',
  'editor.selectionBackground': '#2a3a1666',
  'editor.inactiveSelectionBackground': '#2a3a1633',
  'editorCursor.foreground': '#e4e7eb',
  'editorIndentGuide.background1': '#1a1e24',
  'editorIndentGuide.activeBackground1': '#2e3440',
  'editorWhitespace.foreground': '#22272f',
  'editorGutter.background': '#0c0e11',
  'editorWidget.background': '#111419',
  'editorWidget.border': '#2e3440',
  'editorSuggestWidget.background': '#111419',
  'editorSuggestWidget.border': '#2e3440',
  'editorSuggestWidget.selectedBackground': '#1e232b',
  'editorHoverWidget.background': '#111419',
  'editorHoverWidget.border': '#2e3440',
  'editorError.foreground': '#ff6a5c',
  'editorWarning.foreground': '#e6b54a',
  'editorBracketMatch.background': '#1e232b',
  // Brackets stay graphite: lime is the lens's only meaningful colour.
  'editorBracketHighlight.foreground1': '#9aa1ad',
  'editorBracketHighlight.foreground2': '#9aa1ad',
  'editorBracketHighlight.foreground3': '#9aa1ad',
  'editorBracketHighlight.foreground4': '#9aa1ad',
  'editorBracketHighlight.foreground5': '#9aa1ad',
  'editorBracketHighlight.foreground6': '#9aa1ad',
  'editorBracketMatch.border': '#555d6a',
  'scrollbarSlider.background': '#2e344066',
  'scrollbarSlider.hoverBackground': '#2e3440aa',
  'minimap.background': '#0c0e11',
  'diffEditor.insertedTextBackground': '#8fd14f1f',
  'diffEditor.removedTextBackground': '#ff80731f',
  'diffEditor.insertedLineBackground': '#8fd14f12',
  'diffEditor.removedLineBackground': '#ff807312',
};

const rules: editor.ITokenThemeRule[] = [
  { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
  { token: 'keyword', foreground: 'c7ccd4', fontStyle: 'bold' },
  { token: 'string', foreground: 'a8c5a0' },
  { token: 'number', foreground: 'd9b88a' },
  { token: 'regexp', foreground: 'd9b88a' },
  { token: 'type', foreground: '9fb8d6' },
  { token: 'type.identifier', foreground: '9fb8d6' },
  { token: 'function', foreground: 'e4e7eb' },
  { token: 'variable', foreground: 'e4e7eb' },
  { token: 'identifier', foreground: 'e4e7eb' },
  { token: 'delimiter', foreground: '848c99' },
  { token: 'operator', foreground: '848c99' },
  { token: 'tag', foreground: '9fb8d6' },
  { token: 'attribute.name', foreground: 'c7ccd4' },
  { token: 'attribute.value', foreground: 'a8c5a0' },
];

export const PROOF_EDITOR_THEME = { name: 'proof-ink', data: { base: 'vs-dark', inherit: true, rules, colors } as editor.IStandaloneThemeData };
export const PROOF_DIFF_THEME = { name: 'proof-ink-diff', data: { base: 'vs-dark', inherit: true, rules, colors } as editor.IStandaloneThemeData };
export const PROOF_CODE_FONT = "var(--pf-font-mono), 'Geist Mono', ui-monospace, monospace";
