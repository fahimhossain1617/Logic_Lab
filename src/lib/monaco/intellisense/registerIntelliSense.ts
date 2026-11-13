import { javaRegistry } from './java';
import { cppRegistry } from './cpp';
import { pythonRegistry } from './python';
import { javascriptRegistry } from './javascript';
import { extractDocumentSymbols } from './symbolExtractor';
import {
  buildSmartCompletionItem,
  createMonacoRange,
  formatSnippetPreview,
  resolveCompletionKind,
} from './smartCompletion';
import {
  CompletionTemplate,
  DisposableHandle,
  LanguageCompletionRegistry,
} from './types';

export { buildSmartCompletionItem, formatSnippetPreview };

const REGISTRIES: LanguageCompletionRegistry[] = [
  javaRegistry,
  cppRegistry,
  pythonRegistry,
  javascriptRegistry,
];

const ACTIVE_DISPOSABLE_SYMBOL = Symbol.for('logiclab.monaco.intellisense.disposable');

function extractReceiverChain(linePrefixBeforeDot: string): string {
  const match = linePrefixBeforeDot.match(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/);
  return match ? match[1] : '';
}

function createCompletionProvider(
  monaco: any,
  registry: LanguageCompletionRegistry
) {
  const knownStaticReceivers = new Set<string>();
  for (const member of registry.memberCompletions) {
    if (member.receivers) {
      for (const r of member.receivers) knownStaticReceivers.add(r);
    }
  }

  return {
    triggerCharacters: registry.triggerCharacters,
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const wordRange = createMonacoRange(
        monaco,
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn
      );

      const lineUntilWordStart: string = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: word.startColumn,
      });

      // 1. C++ namespace scope (`std::`)
      if (
        registry.language === 'cpp' &&
        registry.namespaceCompletions &&
        lineUntilWordStart.endsWith('::')
      ) {
        const beforeScope = lineUntilWordStart.slice(0, -2);
        const nsMatch = beforeScope.match(/([A-Za-z_]\w*)$/);
        if (!nsMatch || nsMatch[1] === 'std') {
          return {
            suggestions: registry.namespaceCompletions.map((tpl) =>
              buildSmartCompletionItem(monaco, model, position, tpl, {
                language: registry.language,
                skipPrefixMerge: true,
              })
            ),
          };
        }
      }

      // 2. Member completion after `.` or `->`
      const isAfterArrow =
        registry.language === 'cpp' && lineUntilWordStart.endsWith('->');
      const isAfterDot = lineUntilWordStart.endsWith('.');

      if (isAfterDot || isAfterArrow) {
        const prefixBeforeAccessor = isAfterArrow
          ? lineUntilWordStart.slice(0, -2)
          : lineUntilWordStart.slice(0, -1);
        const receiverChain = extractReceiverChain(prefixBeforeAccessor);
        const lastReceiver = receiverChain.split('.').pop() || '';

        let matchedMembers: CompletionTemplate[];
        if (knownStaticReceivers.has(receiverChain)) {
          matchedMembers = registry.memberCompletions.filter((m) =>
            m.receivers?.includes(receiverChain)
          );
        } else if (knownStaticReceivers.has(lastReceiver)) {
          matchedMembers = registry.memberCompletions.filter((m) =>
            m.receivers?.includes(lastReceiver)
          );
        } else {
          matchedMembers = registry.memberCompletions.filter(
            (m) => !m.receivers || m.receivers.length === 0
          );
        }

        return {
          suggestions: matchedMembers.map((tpl) =>
            buildSmartCompletionItem(monaco, model, position, tpl, {
              language: registry.language,
              skipPrefixMerge: true,
            })
          ),
        };
      }

      // 3. Preprocessor `#` prefix in C++
      const hasHashPrefix =
        registry.language === 'cpp' && lineUntilWordStart.endsWith('#');

      if (hasHashPrefix) {
        const preprocessorTemplates = registry.templates.filter(
          (t) => t.absorbsHashPrefix
        );
        return {
          suggestions: preprocessorTemplates.map((tpl) =>
            buildSmartCompletionItem(monaco, model, position, tpl, {
              language: registry.language,
              hasHashPrefix: true,
              skipPrefixMerge: true,
            })
          ),
        };
      }

      // 4. Top-level live templates + built-in APIs/keywords + document symbols
      //    with context-aware line-prefix merging so partial statements never duplicate
      const staticSuggestions = registry.templates.map((tpl) =>
        buildSmartCompletionItem(monaco, model, position, tpl, {
          language: registry.language,
        })
      );

      const docSymbols = extractDocumentSymbols(
        model.getValue(),
        registry.language,
        position.lineNumber,
        word.word
      );

      const seenLabels = new Set(staticSuggestions.map((s) => s.label));
      const symbolSuggestions = docSymbols
        .filter((sym) => !seenLabels.has(sym.name))
        .map((sym) => ({
          label: sym.name,
          kind: resolveCompletionKind(monaco, sym.kind),
          insertText: sym.name,
          detail: sym.detail,
          documentation: {
            value: `User-defined symbol declared on line ${sym.lineNumber}.`,
          },
          sortText: `1_symbol_${sym.name}`,
          range: wordRange,
        }));

      return {
        suggestions: [...staticSuggestions, ...symbolSuggestions],
      };
    },
  };
}

/**
 * Idempotently registers enterprise IntelliSense & Live Snippet providers for
 * Java, C++, Python, and JavaScript on the given Monaco instance.
 *
 * Any prior registration on the same Monaco instance is disposed first so
 * hot-reloads, StrictMode remounts, or language switches never produce duplicates.
 */
export function registerIntelliSense(monaco: any): DisposableHandle {
  if (!monaco?.languages?.registerCompletionItemProvider) {
    return { dispose: () => {} };
  }

  // Dispose any previously registered IntelliSense providers on this Monaco instance
  const existing: DisposableHandle | undefined = (monaco as any)[
    ACTIVE_DISPOSABLE_SYMBOL
  ];
  if (existing) {
    existing.dispose();
  }

  const disposables: Array<{ dispose?: () => void }> = [];

  for (const registry of REGISTRIES) {
    const provider = createCompletionProvider(monaco, registry);
    const disposable = monaco.languages.registerCompletionItemProvider(
      registry.language,
      provider
    );
    if (disposable) {
      disposables.push(disposable);
    }
  }

  let disposed = false;
  const handle: DisposableHandle = {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const d of disposables) {
        try {
          d.dispose?.();
        } catch {
          // Ignore disposal errors during teardown
        }
      }
      disposables.length = 0;
      if ((monaco as any)[ACTIVE_DISPOSABLE_SYMBOL] === handle) {
        delete (monaco as any)[ACTIVE_DISPOSABLE_SYMBOL];
      }
    },
  };

  (monaco as any)[ACTIVE_DISPOSABLE_SYMBOL] = handle;
  return handle;
}
