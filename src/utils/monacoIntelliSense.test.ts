import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerIntelliSense,
  formatSnippetPreview,
  buildSmartCompletionItem,
} from '../lib/monaco/intellisense/registerIntelliSense';
import { findOverlappingInsertPrefixLength } from '../lib/monaco/intellisense/smartCompletion';
import { extractDocumentSymbols } from '../lib/monaco/intellisense/symbolExtractor';

function createMockMonaco() {
  const activeProviders = new Map<string, any[]>();

  class MockRange {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number
    ) {}
  }

  const monaco = {
    Range: MockRange,
    languages: {
      CompletionItemKind: {
        Snippet: 27,
        Keyword: 17,
        Function: 1,
        Method: 0,
        Class: 5,
        Variable: 4,
        Constant: 14,
        Module: 8,
        Struct: 6,
        Property: 9,
        Text: 18,
      },
      CompletionItemInsertTextRule: {
        InsertAsSnippet: 4,
      },
      registerCompletionItemProvider: (lang: string, provider: any) => {
        const list = activeProviders.get(lang) || [];
        list.push(provider);
        activeProviders.set(lang, list);
        return {
          dispose: () => {
            const current = activeProviders.get(lang) || [];
            activeProviders.set(
              lang,
              current.filter((p) => p !== provider)
            );
          },
        };
      },
    },
  };

  return { monaco, activeProviders };
}

function createMockModel(code: string, lineNumber: number, column: number) {
  const lines = code.split('\n');
  const line = lines[lineNumber - 1] || '';
  const prefix = line.slice(0, column - 1);
  const wordMatch = prefix.match(/([A-Za-z_$][\w$]*)$/);
  const word = wordMatch ? wordMatch[1] : '';
  const startColumn = word ? column - word.length : column;

  return {
    getValue: () => code,
    getWordUntilPosition: () => ({
      word,
      startColumn,
      endColumn: column,
    }),
    getValueInRange: (range: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    }) => {
      const targetLine = lines[range.startLineNumber - 1] || '';
      return targetLine.slice(range.startColumn - 1, range.endColumn - 1);
    },
  };
}

test('registerIntelliSense is idempotent and disposes cleanly', () => {
  const { monaco, activeProviders } = createMockMonaco();

  const handle1 = registerIntelliSense(monaco);
  assert.equal(activeProviders.get('java')?.length, 1);
  assert.equal(activeProviders.get('cpp')?.length, 1);
  assert.equal(activeProviders.get('python')?.length, 1);
  assert.equal(activeProviders.get('javascript')?.length, 1);

  // Calling again without explicit dispose must still replace cleanly (no duplicates)
  const handle2 = registerIntelliSense(monaco);
  assert.equal(activeProviders.get('java')?.length, 1);
  assert.equal(activeProviders.get('cpp')?.length, 1);
  assert.equal(activeProviders.get('python')?.length, 1);
  assert.equal(activeProviders.get('javascript')?.length, 1);

  handle1.dispose(); // Stale handle should not disturb handle2
  assert.equal(activeProviders.get('java')?.length, 1);

  handle2.dispose();
  assert.equal(activeProviders.get('java')?.length, 0);
  assert.equal(activeProviders.get('cpp')?.length, 0);
  assert.equal(activeProviders.get('python')?.length, 0);
  assert.equal(activeProviders.get('javascript')?.length, 0);
});

test('Java, C++, Python, and JavaScript live templates & APIs resolve in < 10ms', () => {
  const { monaco, activeProviders } = createMockMonaco();
  const handle = registerIntelliSense(monaco);

  const checkSnippets = (lang: string, code: string, line: number, col: number, expectedLabels: string[]) => {
    const provider = activeProviders.get(lang)![0];
    const model = createMockModel(code, line, col);
    const t0 = performance.now();
    const res = provider.provideCompletionItems(model, { lineNumber: line, column: col });
    const elapsed = performance.now() - t0;

    assert.ok(elapsed < 10, `${lang} completion took ${elapsed.toFixed(2)}ms (>= 10ms)`);
    const labels = new Set(res.suggestions.map((s: any) => s.label));
    for (const expected of expectedLabels) {
      assert.ok(labels.has(expected), `Missing ${expected} in ${lang} completions`);
    }
    return res.suggestions;
  };

  const javaItems = checkSnippets('java', 'so', 1, 3, [
    'psvm', 'main', 'sout', 'souf', 'serr', 'cl', 'class', 'fori', 'fore', 'iter',
    'while', 'if', 'ifelse', 'try', 'scanner', 'sc', 'arrlist', 'hashmap',
    'Math.max()', 'Math.min()', 'Arrays.sort()', 'Collections.sort()',
  ]);
  const sout = javaItems.find((s: any) => s.label === 'sout');
  assert.equal(sout.insertText, 'System.out.println($1);$0');
  assert.equal(sout.insertTextRules, 4);
  assert.ok(sout.documentation.value.includes('System.out.println'));

  checkSnippets('cpp', 'co', 1, 3, [
    'cpp', 'boilerplate', 'inc', 'main', 'cout', 'cin', 'fori', 'fore', 'vec', 'pb',
    'class', 'struct', 'vector', 'unordered_map', 'sort()', 'max()', 'min()', 'nullptr',
  ]);

  checkSnippets('python', 'de', 1, 3, [
    'def', 'class', 'ifm', 'main', 'fori', 'fore', 'while', 'if', 'ifelse', 'try',
    'pr', 'print', 'inp', 'listcomp', 'len()', 'enumerate()', 'zip()', 'sorted()',
  ]);

  checkSnippets('javascript', 'cl', 1, 3, [
    'clg', 'log', 'fn', 'afn', 'arrow', 'fori', 'fore', 'forof', 'forEach', 'map',
    'filter', 'if', 'ifelse', 'try', 'class', 'async', 'await', 'prom',
    'JSON.stringify()', 'Object.keys()', 'Array.isArray()', 'Math.floor()', 'fetch()',
  ]);

  handle.dispose();
});

test('Dot, ::, and # contexts prevent duplicate prefixes and suggest scoped members', () => {
  const { monaco, activeProviders } = createMockMonaco();
  const handle = registerIntelliSense(monaco);

  // Java: Math. -> max() without leading dot
  const javaProvider = activeProviders.get('java')![0];
  const javaDot = javaProvider.provideCompletionItems(
    createMockModel('Math.m', 1, 7),
    { lineNumber: 1, column: 7 }
  );
  assert.ok(javaDot.suggestions.some((s: any) => s.label === 'max()'));
  assert.ok(!javaDot.suggestions.some((s: any) => s.label === 'psvm'));

  // Java: generic variable str. -> length(), equals(), charAt()
  const javaInstance = javaProvider.provideCompletionItems(
    createMockModel('str.', 1, 5),
    { lineNumber: 1, column: 5 }
  );
  assert.ok(javaInstance.suggestions.some((s: any) => s.label === 'length()'));
  assert.ok(javaInstance.suggestions.some((s: any) => s.label === 'equals()'));
  assert.ok(javaInstance.suggestions.some((s: any) => s.label === 'charAt()'));

  // C++: #inc -> range absorbs `#` so `#include` doesn't become `##include`
  const cppProvider = activeProviders.get('cpp')![0];
  const cppHash = cppProvider.provideCompletionItems(
    createMockModel('#inc', 1, 5),
    { lineNumber: 1, column: 5 }
  );
  const incItem = cppHash.suggestions.find((s: any) => s.label === 'inc');
  assert.ok(incItem);
  assert.equal(incItem.range.startColumn, 1);

  // C++: std:: -> cout, vector, etc.
  const cppNs = cppProvider.provideCompletionItems(
    createMockModel('std::c', 1, 7),
    { lineNumber: 1, column: 7 }
  );
  assert.ok(cppNs.suggestions.some((s: any) => s.label === 'cout'));

  handle.dispose();
});

test('Context-aware symbol extraction detects user symbols and ignores comments/strings', () => {
  const javaCode = `
// int fakeCommentVar = 99;
public class BinarySearch {
  static final int MAX_SIZE = 100;
  public static int search(int[] nums, int targetVal) {
    String msg = "int fakeStringVar = 0;";
    int leftPtr = 0;
    return leftPtr;
  }
}
`;
  const javaSymbols = extractDocumentSymbols(javaCode, 'java', 8, 'lef');
  const javaNames = new Set(javaSymbols.map((s) => s.name));
  assert.ok(javaNames.has('BinarySearch'));
  assert.ok(javaNames.has('MAX_SIZE'));
  assert.ok(javaNames.has('search'));
  assert.ok(javaNames.has('nums'));
  assert.ok(javaNames.has('targetVal'));
  assert.ok(javaNames.has('leftPtr'));
  assert.ok(!javaNames.has('fakeCommentVar'));
  assert.ok(!javaNames.has('fakeStringVar'));

  const pyCode = `
# ignored_var = 1
class Node:
    pass

def two_sum(values, target):
    seen_map = {}
    for idx in range(len(values)):
        pass
`;
  const pySymbols = extractDocumentSymbols(pyCode, 'python');
  const pyNames = new Set(pySymbols.map((s) => s.name));
  assert.ok(pyNames.has('Node'));
  assert.ok(pyNames.has('two_sum'));
  assert.ok(pyNames.has('values'));
  assert.ok(pyNames.has('target'));
  assert.ok(pyNames.has('seen_map'));
  assert.ok(pyNames.has('idx'));
  assert.ok(!pyNames.has('ignored_var'));

  const jsCode = `
class Graph {}
const bfsTraverse = (adjList, startNode) => {
  const visitedSet = new Set();
};
`;
  const jsSymbols = extractDocumentSymbols(jsCode, 'javascript');
  const jsNames = new Set(jsSymbols.map((s) => s.name));
  assert.ok(jsNames.has('Graph'));
  assert.ok(jsNames.has('bfsTraverse'));
  assert.ok(jsNames.has('adjList'));
  assert.ok(jsNames.has('startNode'));
  assert.ok(jsNames.has('visitedSet'));
});

test('formatSnippetPreview strips tab-stops cleanly for documentation preview', () => {
  const preview = formatSnippetPreview(
    'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}'
  );
  assert.equal(preview, 'for (int i = 0; i < n; i++) {\n  \n}');
});

function applyCompletionEdit(line: string, item: any): string {
  const before = line.slice(0, item.range.startColumn - 1);
  const after = line.slice(item.range.endColumn - 1);
  return before + item.insertText + after;
}

test('Smart prefix merging eliminates duplicate prefixes across Java, C++, Python, and JavaScript', () => {
  const { monaco, activeProviders } = createMockMonaco();
  const handle = registerIntelliSense(monaco);

  // 1. Java: `public class` / `public cl` / `public class cl` -> no `public class public class`
  const javaProvider = activeProviders.get('java')![0];

  for (const typed of ['public class', 'public cl', 'public class cl', '    public cl']) {
    const col = typed.length + 1;
    const res = javaProvider.provideCompletionItems(
      createMockModel(typed, 1, col),
      { lineNumber: 1, column: col }
    );
    const classSnippet = res.suggestions.find(
      (s: any) => (s.label === 'class' || s.label === 'cl') && s.kind === 27
    );
    assert.ok(classSnippet, `Missing class snippet for "${typed}"`);
    const merged = applyCompletionEdit(typed, classSnippet);
    assert.ok(
      merged.trimStart().startsWith('public class ${1:ClassName}'),
      `Duplicate or broken merge for "${typed}": ${merged}`
    );
    assert.equal(merged.match(/public class/g)?.length, 1);
  }

  // 2. Java: `public static void ma` and `public static void ps` -> no `public static void public static void`
  for (const typed of ['    public static void ma', '    public static void ps', 'public static ma']) {
    const col = typed.length + 1;
    const res = javaProvider.provideCompletionItems(
      createMockModel(typed, 1, col),
      { lineNumber: 1, column: col }
    );
    const targetLabel = typed.endsWith('ps') ? 'psvm' : 'main';
    const mainSnippet = res.suggestions.find(
      (s: any) => s.label === targetLabel && s.kind === 27
    );
    assert.ok(mainSnippet);
    const merged = applyCompletionEdit(typed, mainSnippet);
    assert.ok(
      merged.trimStart().startsWith('public static void main(String[] args)'),
      `Duplicate or broken merge for "${typed}": ${merged}`
    );
    assert.equal(merged.match(/public static void/g)?.length, 1);
  }

  // 3. C++: `int ma` -> `int main()` without `int int main()`
  const cppProvider = activeProviders.get('cpp')![0];
  const cppTyped = 'int ma';
  const cppRes = cppProvider.provideCompletionItems(
    createMockModel(cppTyped, 1, cppTyped.length + 1),
    { lineNumber: 1, column: cppTyped.length + 1 }
  );
  const cppMain = cppRes.suggestions.find((s: any) => s.label === 'main' && s.kind === 27);
  assert.ok(cppMain);
  const cppMerged = applyCompletionEdit(cppTyped, cppMain);
  assert.ok(cppMerged.startsWith('int main() {\n'));
  assert.equal(cppMerged.match(/\bint\b/g)?.length, 1);

  // 4. Python: `def ` with Ctrl+Space and `async de` -> no `def def`
  const pyProvider = activeProviders.get('python')![0];
  const pyTyped = 'def ';
  const pyRes = pyProvider.provideCompletionItems(
    createMockModel(pyTyped, 1, pyTyped.length + 1),
    { lineNumber: 1, column: pyTyped.length + 1 }
  );
  const pyDef = pyRes.suggestions.find((s: any) => s.label === 'def' && s.kind === 27);
  assert.ok(pyDef);
  const pyMerged = applyCompletionEdit(pyTyped, pyDef);
  assert.ok(pyMerged.startsWith('def ${1:function_name}'));
  assert.equal(pyMerged.match(/\bdef\b/g)?.length, 1);

  // 5. JavaScript: `async fn` and `function ` -> no duplicate `async` or `function`
  const jsProvider = activeProviders.get('javascript')![0];
  const jsAsyncTyped = 'async a';
  const jsAsyncRes = jsProvider.provideCompletionItems(
    createMockModel(jsAsyncTyped, 1, jsAsyncTyped.length + 1),
    { lineNumber: 1, column: jsAsyncTyped.length + 1 }
  );
  const jsAsyncSnippet = jsAsyncRes.suggestions.find((s: any) => s.label === 'async' && s.kind === 27);
  assert.ok(jsAsyncSnippet);
  const jsAsyncMerged = applyCompletionEdit(jsAsyncTyped, jsAsyncSnippet);
  assert.ok(jsAsyncMerged.startsWith('async function ${1:name}'));
  assert.equal(jsAsyncMerged.match(/\basync\b/g)?.length, 1);

  const jsFnTyped = 'function ';
  const jsFnRes = jsProvider.provideCompletionItems(
    createMockModel(jsFnTyped, 1, jsFnTyped.length + 1),
    { lineNumber: 1, column: jsFnTyped.length + 1 }
  );
  const jsFnSnippet = jsFnRes.suggestions.find((s: any) => s.label === 'fn' && s.kind === 27);
  assert.ok(jsFnSnippet);
  const jsFnMerged = applyCompletionEdit(jsFnTyped, jsFnSnippet);
  assert.ok(jsFnMerged.startsWith('function ${1:name}'));
  assert.equal(jsFnMerged.match(/\bfunction\b/g)?.length, 1);

  handle.dispose();
});

test('Keywords are distinct from Snippets and insert only single words', () => {
  const { monaco, activeProviders } = createMockMonaco();
  const handle = registerIntelliSense(monaco);

  const javaItems = activeProviders.get('java')![0].provideCompletionItems(
    createMockModel('cl', 1, 3),
    { lineNumber: 1, column: 3 }
  ).suggestions;
  const javaClassKw = javaItems.find((s: any) => s.label === 'class' && s.kind === 17);
  const javaClassSnip = javaItems.find((s: any) => s.label === 'class' && s.kind === 27);
  assert.ok(javaClassKw, 'Missing Keyword `class` in Java');
  assert.ok(javaClassSnip, 'Missing Snippet `class` in Java');
  assert.equal(javaClassKw.insertText, 'class');
  assert.ok(javaClassSnip.detail.startsWith('Snippet:'));

  const pyItems = activeProviders.get('python')![0].provideCompletionItems(
    createMockModel('de', 1, 3),
    { lineNumber: 1, column: 3 }
  ).suggestions;
  const pyDefKw = pyItems.find((s: any) => s.label === 'def' && s.kind === 17);
  const pyDefSnip = pyItems.find((s: any) => s.label === 'def' && s.kind === 27);
  assert.ok(pyDefKw);
  assert.ok(pyDefSnip);
  assert.equal(pyDefKw.insertText, 'def');
  assert.ok(pyDefSnip.detail.startsWith('Snippet:'));

  // Do not strip inside unclosed parentheses like `if (x`
  assert.equal(findOverlappingInsertPrefixLength('if (', 'if (${1:condition}) {\n\t$0\n}'), 0);

  // buildSmartCompletionItem returns monaco.Range instance
  const customItem = buildSmartCompletionItem(
    monaco,
    createMockModel('public cl', 1, 10),
    { lineNumber: 1, column: 10 },
    {
      label: 'cl',
      kind: 'Snippet',
      insertText: 'public class ${1:ClassName} {\n\t$0\n}',
      isSnippet: true,
      detail: 'Snippet: public class ClassName',
    },
    { language: 'java' }
  );
  assert.ok(customItem.range instanceof monaco.Range);
  assert.equal(customItem.insertText, 'class ${1:ClassName} {\n\t$0\n}');

  handle.dispose();
});

