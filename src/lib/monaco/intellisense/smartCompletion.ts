import {
  CompletionItemKindKey,
  CompletionTemplate,
  IntelliSenseLanguage,
} from './types';

/**
 * Formats a Monaco snippet template into clean human-readable code for the
 * suggestion dropdown's detail & documentation preview pane.
 */
export function formatSnippetPreview(
  insertText: string,
  explicitPreview?: string
): string {
  if (explicitPreview) return explicitPreview;
  return insertText
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$0/g, '')
    .replace(/\$\d+/g, '...')
    .replace(/\t/g, '  ')
    .trimEnd();
}

export function resolveCompletionKind(
  monaco: any,
  kind: CompletionItemKindKey
): number {
  const Kind = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 'Snippet':
      return Kind.Snippet;
    case 'Keyword':
      return Kind.Keyword;
    case 'Function':
      return Kind.Function;
    case 'Method':
      return Kind.Method;
    case 'Class':
      return Kind.Class;
    case 'Variable':
      return Kind.Variable;
    case 'Constant':
      return Kind.Constant;
    case 'Module':
      return Kind.Module;
    case 'Struct':
      return Kind.Struct;
    case 'Property':
      return Kind.Property;
    default:
      return Kind.Text;
  }
}

export function createMonacoRange(
  monaco: any,
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number
) {
  if (typeof monaco?.Range === 'function') {
    return new monaco.Range(
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn
    );
  }
  return {
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
  };
}

/**
 * Inspects `lineBeforeWord` (text on the current line before `word.startColumn`)
 * to detect if the user has already typed a leading portion of `insertText`
 * (e.g. `public static void ` before `ma`, or `public ` before `class`).
 *
 * Returns the character length of the matched prefix in `insertText` so it can
 * be stripped before insertion, preventing duplicate prefixes while keeping
 * `CompletionItem.range` cleanly anchored to the active token for Monaco's filter.
 */
export function findOverlappingInsertPrefixLength(
  lineBeforeWord: string,
  insertText: string
): number {
  if (!lineBeforeWord || !insertText) return 0;

  const firstDollar = insertText.search(/\$(?:\d+|\{\d+:)/);
  const literalPrefix =
    firstDollar === -1 ? insertText : insertText.slice(0, firstDollar);
  if (!literalPrefix) return 0;

  const len = lineBeforeWord.length;
  for (let i = 0; i < len; i++) {
    if (/\s/.test(lineBeforeWord[i])) continue;

    // Candidate must begin at line start or right after whitespace/delimiter
    if (i > 0 && !/[\s;{}(),]/.test(lineBeforeWord[i - 1])) continue;

    const candidate = lineBeforeWord.slice(i);

    // Do not strip across an unclosed '(' so arguments inside parens aren't altered
    let parenDepth = 0;
    for (let k = 0; k < candidate.length; k++) {
      if (candidate[k] === '(') parenDepth++;
      else if (candidate[k] === ')' && parenDepth > 0) parenDepth--;
    }
    if (parenDepth > 0) continue;

    if (literalPrefix.startsWith(candidate)) {
      return candidate.length;
    }

    const normalizedCandidate = candidate.replace(/[ \t]+/g, ' ');
    if (literalPrefix.startsWith(normalizedCandidate)) {
      return normalizedCandidate.length;
    }
  }

  return 0;
}

function buildDocumentation(
  template: CompletionTemplate,
  language: IntelliSenseLanguage
): { value: string } {
  const preview = formatSnippetPreview(
    template.insertText,
    template.previewCode
  );
  if (template.kind === 'Keyword') {
    return {
      value: template.description || `Keyword \`${template.label}\``,
    };
  }
  const header = template.description ? `${template.description}\n\n` : '';
  return {
    value: `${header}\`\`\`${language}\n${preview}\n\`\`\``,
  };
}

export interface SmartCompletionOptions {
  language: IntelliSenseLanguage;
  hasHashPrefix?: boolean;
  /** Disable prefix overlap merging for scoped member/namespace completions */
  skipPrefixMerge?: boolean;
}

/**
 * Shared smart completion builder used across Java, C++, Python, and JavaScript.
 *
 * Inspects the full line content before the cursor (`lineContentBeforeCursor`),
 * computes an explicit `monaco.Range`, strips any overlapping leading statement
 * prefix from multi-token snippets so already-typed text merges cleanly, and
 * keeps single-word Keyword completions isolated from Snippet blocks.
 */
export function buildSmartCompletionItem(
  monaco: any,
  model: any,
  position: any,
  template: CompletionTemplate,
  options: SmartCompletionOptions
) {
  const word = model.getWordUntilPosition(position);
  const lineContentBeforeCursor: string = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  const wordOffsetInLine = Math.max(0, word.startColumn - 1);
  const lineBeforeWord = lineContentBeforeCursor.slice(0, wordOffsetInLine);

  const rangeStartColumn =
    options.hasHashPrefix && template.absorbsHashPrefix
      ? Math.max(1, word.startColumn - 1)
      : word.startColumn;

  const range = createMonacoRange(
    monaco,
    position.lineNumber,
    rangeStartColumn,
    position.lineNumber,
    word.endColumn
  );

  let effectiveInsertText = template.insertText;
  let hasOverlap = false;
  if (
    !options.skipPrefixMerge &&
    template.kind !== 'Keyword' &&
    !(options.hasHashPrefix && template.absorbsHashPrefix)
  ) {
    const overlapLen = findOverlappingInsertPrefixLength(
      lineBeforeWord,
      template.insertText
    );
    if (overlapLen > 0 && overlapLen < template.insertText.length) {
      effectiveInsertText = template.insertText.slice(overlapLen);
      hasOverlap = true;
    }
  }

  const sortPrefix = hasOverlap
    ? `0_0_merged_${template.sortGroup ?? '2_api'}`
    : (template.sortGroup ?? '2_api');
  const item: Record<string, any> = {
    label: template.label,
    kind: resolveCompletionKind(monaco, template.kind),
    insertText: effectiveInsertText,
    detail: template.detail,
    documentation: buildDocumentation(template, options.language),
    filterText: template.filterText ?? template.label,
    sortText: `${sortPrefix}_${template.label}`,
    range,
  };

  if (hasOverlap && template.kind === 'Snippet') {
    item.preselect = true;
  }

  if (template.isSnippet) {
    item.insertTextRules =
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  }

  return item;
}
