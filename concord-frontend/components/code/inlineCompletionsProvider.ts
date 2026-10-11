/**
 * Monaco's inline-completions lifecycle calls disposeInlineCompletions when a
 * suggestion is dropped. A provider that only implements freeInlineCompletions
 * throws on editor load ("disposeInlineCompletions is not a function").
 */

export interface InlineCompletionQuery {
  textBeforeCursor: string;
  textAfterCursor: string;
  language: string;
}

export interface InlineCompletionModel {
  getLineCount: () => number;
  getLineMaxColumn: (line: number) => number;
  getValueInRange: (range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }) => string;
}

export interface InlineCompletionPosition {
  lineNumber: number;
  column: number;
}

export interface InlineCompletionList {
  items: Array<{
    insertText: string;
    range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    };
  }>;
}

export function createInlineCompletionsProvider(
  language: string,
  inlineCompletion: (ctx: InlineCompletionQuery) => Promise<string>,
) {
  return {
    async provideInlineCompletions(
      model: InlineCompletionModel,
      position: InlineCompletionPosition,
    ): Promise<InlineCompletionList> {
      const lineCount = model.getLineCount();
      const afterLine = Math.min(lineCount, position.lineNumber + 20);
      const textBeforeCursor = model.getValueInRange({
        startLineNumber: Math.max(1, position.lineNumber - 40),
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const textAfterCursor = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: afterLine,
        endColumn: model.getLineMaxColumn(afterLine),
      });
      try {
        const completion = await inlineCompletion({ textBeforeCursor, textAfterCursor, language });
        if (!completion) return { items: [] };
        return {
          items: [{
            insertText: completion,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
          }],
        };
      } catch {
        return { items: [] };
      }
    },
    freeInlineCompletions(_completions?: InlineCompletionList) { /* Monaco lifecycle */ },
    disposeInlineCompletions(_completions?: InlineCompletionList, _reason?: unknown) { /* Monaco lifecycle */ },
  };
}
