export type SupportedLanguage = 'javascript' | 'python' | 'cpp' | 'java';

export type ExplainLanguage = 'bn' | 'en';

export type ExplanationDepth = 'simple' | 'detailed';

export type AnalogyType =
  | 'swap_buckets'
  | 'sort_blocks'
  | 'pointer_arrows'
  | 'binary_search_cards'
  | 'stack_plates'
  | 'queue_line'
  | 'linked_list_train'
  | 'tree_nodes'
  | 'graph_nodes'
  | 'recursion_tower'
  | 'loop_gauge'
  | 'generic_memory';

export type TraceSource = 'real_execution' | 'ai_predicted' | 'builtin_verified';

export type LineRole =
  | 'declare'
  | 'assign'
  | 'condition'
  | 'loop'
  | 'call'
  | 'return'
  | 'output'
  | 'block_end'
  | 'comment';

export type StepAction =
  | 'declare'
  | 'assign'
  | 'transfer'
  | 'compare'
  | 'swap'
  | 'move_pointer'
  | 'push'
  | 'pop'
  | 'enqueue'
  | 'dequeue'
  | 'insert'
  | 'remove'
  | 'call'
  | 'return'
  | 'loop_check'
  | 'halt';

export type FaultType =
  | 'lost_value'
  | 'index_out_of_bounds'
  | 'infinite_loop'
  | 'null_pointer'
  | 'stack_overflow'
  | 'off_by_one'
  | 'type_error';

export type VerdictStatus =
  | 'ok'
  | 'logic_error'
  | 'runtime_error'
  | 'infinite_loop'
  | 'compile_error';

export interface FaultInfo {
  type: FaultType;
  message: string;
  fixHint: string;
  target?: string | null;
  lostValue?: string | number | null;
}

export interface VariableChange {
  name: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface StepStructure {
  kind: 'array' | 'loop' | 'stack' | 'queue' | 'list';
  values?: (number | string)[] | null;
  highlight?: number[] | null;
  swapping?: [number, number] | null;
  sortedFrom?: number | null;
  pointers?: Record<string, number> | null;
  lap?: number | null;
  maxLaps?: number | null;
  conditionText?: string | null;
  unchangedVar?: string | null;
}

export type RuntimeActionType =
  | 'DECLARE'
  | 'ASSIGN'
  | 'LOOP_CHECK'
  | 'CONDITION_CHECK'
  | 'OUTPUT'
  | 'METHOD_ENTRY'
  | 'BLOCK_END';

export interface MemoryDelta {
  variable: string | null;
  oldValue: any;
  newValue: any;
}

export interface ProgramSummary {
  totalExecutionSteps: number;
  timeComplexity: string;
  spaceComplexity: string;
  finalOutput: string;
}

export interface TraceStep {
  stepIndex: number;
  activeLine: number;
  analogyType: AnalogyType;
  action: StepAction;
  from?: string | null;
  to?: string | null;
  explanation: string;
  why: string;
  stdout?: string | null;
  changes: VariableChange[];
  variables: Record<string, any>;
  fault: FaultInfo | null;
  structure: StepStructure | null;
  // Exact runtime engine fields
  step?: number;
  lineNumber?: number;
  codeSnippet?: string;
  actionType?: RuntimeActionType;
  memoryState?: Record<string, any>;
  memoryDelta?: MemoryDelta | null;
  consoleOutput?: string | null;
  whatHappenedBn?: string;
  logicBuildingBn?: string;
}

export interface LineNote {
  line: number;
  role: LineRole;
  text: string;
  why?: string;
}

export interface LogicSummary {
  title: string;
  goal: string;
  idea: string;
  keyPoints: string[];
  analogyStory: string;
  complexity: {
    time: string;
    space: string;
    note: string;
  };
  commonMistakes: string[];
}

export interface TraceVerdict {
  status: VerdictStatus;
  message: string;
}

export type ExecutionStatus = 'success' | 'warning' | 'error';
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ExecutionDiagnostic {
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
}

export interface ExecutionResultPayload {
  status: ExecutionStatus;
  canRun: boolean;
  output: string;
  diagnostics: ExecutionDiagnostic[];
  visualizerData: ExecutionTrace | null;
}

export type CompilationErrorType =
  | 'COMPILATION_ERROR'
  | 'SYNTAX_ERROR'
  | 'FILE_NAME_MISMATCH';

export interface TraceErrorDetails {
  errorType?: CompilationErrorType;
  lineNumber?: number;
  lineCode?: string;
  messageBn?: string;
  solutionBn?: string;
  line?: number | null;
  message: string;
}

export interface ExecutionTrace {
  hasError?: boolean;
  isValidLogic: boolean;
  errorDetails: TraceErrorDetails | null;
  language: SupportedLanguage;
  analogyType: AnalogyType;
  traceSource: TraceSource;
  logicSummary: LogicSummary;
  lineNotes: LineNote[];
  steps: TraceStep[];
  finalOutput: string;
  outputExplanation: string;
  verdict: TraceVerdict;
  programSummary?: ProgramSummary | null;
  status?: ExecutionStatus;
  diagnostics?: ExecutionDiagnostic[];
}

export interface SampleProgram {
  id: string;
  title_bn: string;
  title_en: string;
  subtitle_bn: string;
  subtitle_en: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  analogyType: AnalogyType;
  isFaultySample?: boolean;
  breadcrumbName: string;
  codes: Record<SupportedLanguage, string>;
  traces: {
    bn: {
      simple: ExecutionTrace;
      detailed: ExecutionTrace;
    };
    en: {
      simple: ExecutionTrace;
      detailed: ExecutionTrace;
    };
  };
}
