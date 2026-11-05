import { z } from 'zod';

export const FaultInfoSchema = z.object({
  type: z.enum([
    'lost_value',
    'index_out_of_bounds',
    'infinite_loop',
    'null_pointer',
    'stack_overflow',
    'off_by_one',
    'type_error',
  ]),
  message: z.string(),
  fixHint: z.string(),
  target: z.string().nullable().optional(),
  lostValue: z.union([z.string(), z.number()]).nullable().optional(),
});

export const VariableChangeSchema = z.object({
  name: z.string(),
  from: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().default(null),
  to: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().default(null),
});

export const StepStructureSchema = z.object({
  kind: z.enum(['array', 'loop', 'stack', 'queue', 'list']),
  values: z.array(z.union([z.number(), z.string()])).nullable().optional(),
  highlight: z.array(z.number()).nullable().optional(),
  swapping: z.tuple([z.number(), z.number()]).nullable().optional(),
  sortedFrom: z.number().nullable().optional(),
  pointers: z.record(z.string(), z.number()).nullable().optional(),
  lap: z.number().nullable().optional(),
  maxLaps: z.number().nullable().optional(),
  conditionText: z.string().nullable().optional(),
  unchangedVar: z.string().nullable().optional(),
});

export const MemoryDeltaSchema = z.object({
  variable: z.string().nullable(),
  oldValue: z.any().nullable().optional().default(null),
  newValue: z.any().nullable().optional().default(null),
});

export const ProgramSummarySchema = z.object({
  totalExecutionSteps: z.number(),
  timeComplexity: z.string(),
  spaceComplexity: z.string(),
  finalOutput: z.string(),
});

export const TraceStepSchema = z.object({
  stepIndex: z.number(),
  activeLine: z.number(),
  analogyType: z.enum([
    'swap_buckets',
    'sort_blocks',
    'pointer_arrows',
    'binary_search_cards',
    'stack_plates',
    'queue_line',
    'linked_list_train',
    'tree_nodes',
    'graph_nodes',
    'recursion_tower',
    'loop_gauge',
    'generic_memory',
  ]),
  action: z.enum([
    'declare',
    'assign',
    'transfer',
    'compare',
    'swap',
    'move_pointer',
    'push',
    'pop',
    'enqueue',
    'dequeue',
    'insert',
    'remove',
    'call',
    'return',
    'loop_check',
    'halt',
  ]),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  explanation: z.string(),
  why: z.string(),
  stdout: z.string().nullable().optional(),
  changes: z.array(VariableChangeSchema),
  variables: z.record(z.string(), z.any()),
  fault: FaultInfoSchema.nullable(),
  structure: StepStructureSchema.nullable(),
  step: z.number().optional(),
  lineNumber: z.number().optional(),
  codeSnippet: z.string().optional(),
  actionType: z
    .enum([
      'DECLARE',
      'ASSIGN',
      'LOOP_CHECK',
      'CONDITION_CHECK',
      'OUTPUT',
      'METHOD_ENTRY',
      'BLOCK_END',
    ])
    .optional(),
  memoryState: z.record(z.string(), z.any()).optional(),
  memoryDelta: MemoryDeltaSchema.nullable().optional(),
  consoleOutput: z.string().nullable().optional(),
  whatHappenedBn: z.string().optional(),
  logicBuildingBn: z.string().optional(),
});

export const LineNoteSchema = z.object({
  line: z.number(),
  role: z.enum([
    'declare',
    'assign',
    'condition',
    'loop',
    'call',
    'return',
    'output',
    'block_end',
    'comment',
  ]),
  text: z.string(),
  why: z.string().optional(),
});

export const LogicSummarySchema = z.object({
  title: z.string(),
  goal: z.string(),
  idea: z.string(),
  keyPoints: z.array(z.string()),
  analogyStory: z.string(),
  complexity: z.object({
    time: z.string(),
    space: z.string(),
    note: z.string(),
  }),
  commonMistakes: z.array(z.string()),
});

export const TraceErrorDetailsSchema = z.object({
  errorType: z
    .enum(['COMPILATION_ERROR', 'SYNTAX_ERROR', 'FILE_NAME_MISMATCH'])
    .optional()
    .default('SYNTAX_ERROR'),
  lineNumber: z.number().optional().default(1),
  lineCode: z.string().optional().default(''),
  messageBn: z.string().optional().default(''),
  solutionBn: z.string().optional().default(''),
  line: z.number().nullable().optional(),
  message: z.string(),
});

export const ExecutionTraceSchema = z.object({
  hasError: z.boolean().optional(),
  isValidLogic: z.boolean(),
  errorDetails: TraceErrorDetailsSchema.nullable(),
  language: z.enum(['javascript', 'python', 'cpp', 'java']),
  analogyType: z.enum([
    'swap_buckets',
    'sort_blocks',
    'pointer_arrows',
    'binary_search_cards',
    'stack_plates',
    'queue_line',
    'linked_list_train',
    'tree_nodes',
    'graph_nodes',
    'recursion_tower',
    'loop_gauge',
    'generic_memory',
  ]),
  traceSource: z.enum(['real_execution', 'ai_predicted', 'builtin_verified']),
  logicSummary: LogicSummarySchema,
  lineNotes: z.array(LineNoteSchema),
  steps: z.array(TraceStepSchema).max(120),
  finalOutput: z.string(),
  outputExplanation: z.string(),
  verdict: z.object({
    status: z.enum([
      'ok',
      'logic_error',
      'runtime_error',
      'infinite_loop',
      'compile_error',
    ]),
    message: z.string(),
  }),
  programSummary: ProgramSummarySchema.nullable().optional(),
});
