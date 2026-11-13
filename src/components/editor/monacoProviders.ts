/**
 * Monaco Editor Hover Documentation and Document Formatting Providers.
 * Completion & Live Snippet providers live in src/lib/monaco/intellisense/.
 */

const HOVER_FORMAT_DISPOSABLE_SYMBOL = Symbol.for(
  'logiclab.monaco.hoverAndFormat.disposable'
);

export function registerMonacoLanguageProviders(monaco: any): {
  dispose: () => void;
} {
  if (!monaco?.languages) {
    return { dispose: () => {} };
  }

  const existing = (monaco as any)[HOVER_FORMAT_DISPOSABLE_SYMBOL];
  if (existing && typeof existing.dispose === 'function') {
    existing.dispose();
  }

  const disposables: Array<{ dispose?: () => void }> = [];

  // 1. HOVER PROVIDER (FOR JAVA STANDARD CLASSES)
  disposables.push(
    monaco.languages.registerHoverProvider('java', {
      provideHover: (model: any, position: any) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        const hoverMap: Record<string, string> = {
          Random:
            '**java.util.Random**\n\nAn instance of this class is used to generate a stream of pseudorandom numbers.',
          Scanner:
            '**java.util.Scanner**\n\nA simple text scanner which can parse primitive types and strings using regular expressions.',
          System:
            '**java.lang.System**\n\nThe System class contains several useful class fields and methods (out, in, err).',
          println:
            '**void PrintStream.println(Object x)**\n\nPrints an Object and then terminates the line.',
          ArrayList:
            '**java.util.ArrayList<E>**\n\nResizable-array implementation of the List interface.',
          HashMap:
            '**java.util.HashMap<K, V>**\n\nHash table based implementation of the Map interface.',
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
    })
  );

  // 2. DOCUMENT FORMATTING PROVIDERS (Java, C++, JavaScript)
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
      if (
        trimmed.startsWith('}') ||
        trimmed.startsWith(');') ||
        trimmed.startsWith(']')
      ) {
        depth = Math.max(0, depth - 1);
      }

      const indent = ' '.repeat(depth * indentSpaces);
      formatted.push(`${indent}${trimmed}`);

      // Check opening brace increasing depth after line
      if (
        trimmed.endsWith('{') ||
        (trimmed.endsWith('(') && !trimmed.startsWith('for'))
      ) {
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

  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider(
      'java',
      genericFormatter
    ),
    monaco.languages.registerDocumentFormattingEditProvider(
      'cpp',
      genericFormatter
    ),
    monaco.languages.registerDocumentFormattingEditProvider(
      'javascript',
      genericFormatter
    )
  );

  let disposed = false;
  const handle = {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const d of disposables) {
        try {
          d?.dispose?.();
        } catch {
          // Ignore disposal errors
        }
      }
      disposables.length = 0;
      if ((monaco as any)[HOVER_FORMAT_DISPOSABLE_SYMBOL] === handle) {
        delete (monaco as any)[HOVER_FORMAT_DISPOSABLE_SYMBOL];
      }
    },
  };

  (monaco as any)[HOVER_FORMAT_DISPOSABLE_SYMBOL] = handle;
  return handle;
}
