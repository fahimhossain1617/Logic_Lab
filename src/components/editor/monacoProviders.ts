/**
 * Monaco Editor Language Providers: Autocompletion, Hover, and Document Formatting
 */

let providersRegistered = false;

export function registerMonacoLanguageProviders(monaco: any): void {
  if (providersRegistered || !monaco) return;
  providersRegistered = true;

  // 1. JAVA COMPLETIONS & SNIPPETS
  monaco.languages.registerCompletionItemProvider('java', {
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        {
          label: 'Scanner',
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: 'Scanner input = new Scanner(System.in);',
          detail: 'java.util.Scanner',
          documentation: 'Reads formatted input from standard input stream (System.in).',
          range,
        },
        {
          label: 'Random',
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: 'Random random = new Random();',
          detail: 'java.util.Random',
          documentation: 'Instance used to generate a stream of pseudorandom numbers.',
          range,
        },
        {
          label: 'sout',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'System.out.println(${1:value});',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'System.out.println(...)',
          documentation: 'Prints a value to stdout with a newline.',
          range,
        },
        {
          label: 'souf',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'System.out.printf("${1:%s}\\n", ${2:args});',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'System.out.printf(...)',
          documentation: 'Prints a formatted string to stdout.',
          range,
        },
        {
          label: 'main',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'public static void main(String[] args) {\n\t${1}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'public static void main(String[] args)',
          documentation: 'Standard Java main method entrypoint.',
          range,
        },
        {
          label: 'ArrayList',
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: 'ArrayList<${1:Integer}> ${2:list} = new ArrayList<>();',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'java.util.ArrayList',
          documentation: 'Resizable-array implementation of the List interface.',
          range,
        },
        {
          label: 'HashMap',
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: 'HashMap<${1:String}, ${2:Integer}> ${3:map} = new HashMap<>();',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'java.util.HashMap',
          documentation: 'Hash table based implementation of the Map interface.',
          range,
        },
        {
          label: 'fori',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'for loop with integer index',
          range,
        },
        {
          label: 'foreach',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'for (${1:int} ${2:item} : ${3:collection}) {\n\t${4}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'enhanced for-each loop',
          range,
        },
        {
          label: 'import java.util.Scanner;',
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: 'import java.util.Scanner;',
          detail: 'Import Scanner class',
          range,
        },
        {
          label: 'import java.util.Random;',
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: 'import java.util.Random;',
          detail: 'Import Random class',
          range,
        },
        {
          label: 'import java.util.*;',
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: 'import java.util.*;',
          detail: 'Import all java.util classes',
          range,
        },
      ];

      return { suggestions };
    },
  });

  // 2. C++ COMPLETIONS & SNIPPETS
  monaco.languages.registerCompletionItemProvider('cpp', {
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        {
          label: '#include <iostream>',
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: '#include <iostream>',
          detail: 'Standard input/output stream',
          range,
        },
        {
          label: '#include <vector>',
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: '#include <vector>',
          detail: 'Dynamic array container',
          range,
        },
        {
          label: '#include <algorithm>',
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: '#include <algorithm>',
          detail: 'Standard algorithms (sort, reverse, etc.)',
          range,
        },
        {
          label: 'cout',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'std::cout << ${1:value} << std::endl;',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Print to standard output',
          range,
        },
        {
          label: 'cin',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'std::cin >> ${1:var};',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Read from standard input',
          range,
        },
        {
          label: 'main',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'int main() {\n\t${1}\n\treturn 0;\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'C++ main function entrypoint',
          range,
        },
        {
          label: 'vector',
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: 'std::vector<${1:int}> ${2:v};',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'std::vector<T>',
          range,
        },
        {
          label: 'using namespace std;',
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: 'using namespace std;',
          detail: 'Use standard library namespace',
          range,
        },
      ];

      return { suggestions };
    },
  });

  // 3. PYTHON COMPLETIONS & SNIPPETS
  monaco.languages.registerCompletionItemProvider('python', {
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        {
          label: 'print',
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: 'print(${1})',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'print(*values)',
          range,
        },
        {
          label: 'def',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'def ${1:func_name}(${2:args}):\n\t${3:pass}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Function definition',
          range,
        },
        {
          label: 'fori',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'for ${1:i} in range(${2:n}):\n\t${3:pass}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'for loop with range',
          range,
        },
        {
          label: 'main',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: "if __name__ == '__main__':\n\t${1:pass}",
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Main module guard',
          range,
        },
        {
          label: 'import math',
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: 'import math',
          detail: 'Standard math module',
          range,
        },
        {
          label: 'import random',
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: 'import random',
          detail: 'Generate pseudo-random numbers',
          range,
        },
      ];

      return { suggestions };
    },
  });

  // 4. JAVASCRIPT COMPLETIONS & SNIPPETS
  monaco.languages.registerCompletionItemProvider('javascript', {
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const suggestions = [
        {
          label: 'clg',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'console.log(${1:value});',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'console.log(...)',
          range,
        },
        {
          label: 'afn',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'const ${1:name} = (${2:params}) => {\n\t${3}\n};',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Arrow function expression',
          range,
        },
        {
          label: 'asyncfn',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'async function ${1:name}(${2:params}) {\n\t${3}\n}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Async function declaration',
          range,
        },
      ];

      return { suggestions };
    },
  });

  // 5. HOVER PROVIDER (FOR JAVA & C++ STANDARD CLASSES)
  monaco.languages.registerHoverProvider('java', {
    provideHover: (model: any, position: any) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;

      const hoverMap: Record<string, string> = {
        Random: '**java.util.Random**\n\nAn instance of this class is used to generate a stream of pseudorandom numbers.',
        Scanner: '**java.util.Scanner**\n\nA simple text scanner which can parse primitive types and strings using regular expressions.',
        System: '**java.lang.System**\n\nThe System class contains several useful class fields and methods (out, in, err).',
        println: '**void PrintStream.println(Object x)**\n\nPrints an Object and then terminates the line.',
        ArrayList: '**java.util.ArrayList<E>**\n\nResizable-array implementation of the List interface.',
        HashMap: '**java.util.HashMap<K, V>**\n\nHash table based implementation of the Map interface.',
      };

      if (hoverMap[word.word]) {
        return {
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          ),
          contents: [{ value: hoverMap[word.word] }],
        };
      }
      return null;
    },
  });

  // 6. DOCUMENT FORMATTING PROVIDERS (Java, C++, Python)
  const formatIndentedCode = (text: string, indentSpaces = 4): string => {
    const lines = text.split('\n');
    let depth = 0;
    const formatted: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) {
        if (formatted.length > 0 && formatted[formatted.length - 1] !== '') {
          formatted.push('');
        }
        continue;
      }

      // Check closing brace decreasing depth before line
      if (trimmed.startsWith('}') || trimmed.startsWith(');') || trimmed.startsWith(']')) {
        depth = Math.max(0, depth - 1);
      }

      const indent = ' '.repeat(depth * indentSpaces);
      formatted.push(`${indent}${trimmed}`);

      // Check opening brace increasing depth after line
      if (trimmed.endsWith('{') || (trimmed.endsWith('(') && !trimmed.startsWith('for'))) {
        depth++;
      }
    }

    return formatted.join('\n');
  };

  const genericFormatter = {
    provideDocumentFormattingEdits: (model: any) => {
      const text = model.getValue();
      const formatted = formatIndentedCode(text, 4);
      return [
        {
          range: model.getFullModelRange(),
          text: formatted,
        },
      ];
    },
  };

  monaco.languages.registerDocumentFormattingEditProvider('java', genericFormatter);
  monaco.languages.registerDocumentFormattingEditProvider('cpp', genericFormatter);
  monaco.languages.registerDocumentFormattingEditProvider('javascript', genericFormatter);
}

