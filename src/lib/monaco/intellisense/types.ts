/**
 * Shared types for LogicLab's client-side Monaco IntelliSense & Live Snippet system.
 */

export type IntelliSenseLanguage = 'java' | 'cpp' | 'python' | 'javascript';

export type CompletionItemKindKey =
  | 'Snippet'
  | 'Keyword'
  | 'Function'
  | 'Method'
  | 'Class'
  | 'Variable'
  | 'Constant'
  | 'Module'
  | 'Struct'
  | 'Property';

export type SortGroup =
  | '0_snippet'
  | '1_symbol'
  | '2_api'
  | '3_type'
  | '4_keyword';

export interface CompletionTemplate {
  /** Text displayed in the suggestion dropdown */
  label: string;
  /** Semantic icon kind shown in Monaco's completion widget */
  kind: CompletionItemKindKey;
  /** Expanded code or snippet (supports $1, ${1:placeholder}, $0 tab-stops) */
  insertText: string;
  /** True when insertText uses Monaco snippet tab-stops/placeholders */
  isSnippet?: boolean;
  /** Right-aligned inline detail (e.g. "IntelliJ Live Template", "Java Standard Method") */
  detail: string;
  /** Short human-readable summary shown in the documentation popup */
  description?: string;
  /** Explicit code preview for the documentation popup (auto-derived from insertText if omitted) */
  previewCode?: string;
  /** Custom filter text for fuzzy matching */
  filterText?: string;
  /** Ordering bucket within the suggestion list */
  sortGroup?: SortGroup;
  /** For member completions triggered after `.` (or `->`), optional matching static receivers */
  receivers?: string[];
  /** If true, adjust range to absorb a leading `#` when typed (e.g. `#inc` -> `#include`) */
  absorbsHashPrefix?: boolean;
}

export interface LanguageCompletionRegistry {
  language: IntelliSenseLanguage;
  triggerCharacters: string[];
  /** Top-level live templates, built-in APIs, types, and keywords */
  templates: CompletionTemplate[];
  /** Member methods & properties suggested after `.` (and `->` in C++) */
  memberCompletions: CompletionTemplate[];
  /** Namespace-scoped completions (e.g. after `std::` in C++) */
  namespaceCompletions?: CompletionTemplate[];
}

export interface ExtractedSymbol {
  name: string;
  kind: 'Class' | 'Struct' | 'Function' | 'Method' | 'Variable' | 'Constant' | 'Module';
  detail: string;
  lineNumber: number;
}

export interface DisposableHandle {
  dispose: () => void;
}

