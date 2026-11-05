import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import {
  AnalogyType,
  ExecutionTrace,
  ExplainLanguage,
  ExplanationDepth,
  ProgramSummary,
  SupportedLanguage,
  TraceErrorDetails,
  TraceStep,
} from '../../../shared/types';
import { ExecutionTraceSchema } from '../../../shared/traceSchema';
import {
  GEMINI_TRACE_SYSTEM_PROMPT,
  buildUserTracePrompt,
} from '../prompts/systemPrompt';
import {
  buildFallbackTrace,
  buildStructureFromVariables,
  detectSyntaxError,
  inferLineRole,
} from '../tracers/fallbackTracer';
import {
  runDeterministicMultiLanguage,
  stripCommentsPreservingLines,
} from '../tracers/realExecutionRunner';

export interface ApiNotice {
  code: string;
  message_bn: string;
  message_en: string;
}

export interface TraceServiceResult {
  hasError: boolean;
  errorDetails: TraceErrorDetails | null;
  programSummary: ProgramSummary | null;
  steps: TraceStep[];
  trace: ExecutionTrace;
  cached: boolean;
  apiNotice: ApiNotice | null;
}

const traceCache = new Map<string, { trace: ExecutionTrace; createdAt: number }>();

export function computeTraceHash(params: {
  language: SupportedLanguage;
  code: string;
  explainLanguage: ExplainLanguage;
  depth: ExplanationDepth;
  fileName?: string;
}): string {
  const filePart = params.fileName ? `::${params.fileName.trim()}` : '';
  const payload = `v4::${params.language}::${params.explainLanguage}::${params.depth}${filePart}::${params.code.trim()}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function getCacheSize(): number {
  return traceCache.size;
}

export function isGeminiKeyConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(
    key &&
      key !== 'MY_GEMINI_API_KEY' &&
      !key.startsWith('YOUR_') &&
      key.length > 10
  );
}

const VALID_ANALOGIES = new Set<AnalogyType>([
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
]);

const VALID_ROLES = new Set([
  'declare',
  'assign',
  'condition',
  'loop',
  'call',
  'return',
  'output',
  'block_end',
  'comment',
]);

const VALID_ACTIONS = new Set([
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
]);

const VALID_FAULT_TYPES = new Set([
  'lost_value',
  'index_out_of_bounds',
  'infinite_loop',
  'null_pointer',
  'stack_overflow',
  'off_by_one',
  'type_error',
]);

const VALID_VERDICTS = new Set([
  'ok',
  'logic_error',
  'runtime_error',
  'infinite_loop',
  'compile_error',
]);

const TRACE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hasError: { type: Type.BOOLEAN },
    isValidLogic: { type: Type.BOOLEAN },
    errorDetails: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        errorType: { type: Type.STRING },
        lineNumber: { type: Type.INTEGER },
        lineCode: { type: Type.STRING },
        messageBn: { type: Type.STRING },
        solutionBn: { type: Type.STRING },
        line: { type: Type.INTEGER, nullable: true },
        message: { type: Type.STRING },
      },
      required: ['message'],
    },
    language: { type: Type.STRING },
    analogyType: { type: Type.STRING },
    traceSource: { type: Type.STRING },
    logicSummary: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        goal: { type: Type.STRING },
        idea: { type: Type.STRING },
        keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
        analogyStory: { type: Type.STRING },
        complexity: {
          type: Type.OBJECT,
          properties: {
            time: { type: Type.STRING },
            space: { type: Type.STRING },
            note: { type: Type.STRING },
          },
          required: ['time', 'space', 'note'],
        },
        commonMistakes: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        'title',
        'goal',
        'idea',
        'keyPoints',
        'analogyStory',
        'complexity',
        'commonMistakes',
      ],
    },
    lineNotes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          line: { type: Type.INTEGER },
          role: { type: Type.STRING },
          text: { type: Type.STRING },
          why: { type: Type.STRING },
        },
        required: ['line', 'role', 'text', 'why'],
      },
    },
    steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          stepIndex: { type: Type.INTEGER },
          activeLine: { type: Type.INTEGER },
          analogyType: { type: Type.STRING },
          action: { type: Type.STRING },
          from: { type: Type.STRING, nullable: true },
          to: { type: Type.STRING, nullable: true },
          explanation: { type: Type.STRING },
          why: { type: Type.STRING },
          stdout: { type: Type.STRING, nullable: true },
          changes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                from: { type: Type.STRING, nullable: true },
                to: { type: Type.STRING, nullable: true },
              },
              required: ['name', 'from', 'to'],
            },
          },
          variablesJson: {
            type: Type.STRING,
            description:
              'JSON object string of all current variables and their exact values after this step executes, e.g. {"a":5,"b":10}',
          },
          fault: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              type: { type: Type.STRING },
              message: { type: Type.STRING },
              fixHint: { type: Type.STRING },
              target: { type: Type.STRING, nullable: true },
            },
            required: ['type', 'message', 'fixHint'],
          },
        },
        required: [
          'stepIndex',
          'activeLine',
          'analogyType',
          'action',
          'explanation',
          'why',
          'changes',
          'variablesJson',
        ],
      },
    },
    finalOutput: { type: Type.STRING },
    outputExplanation: { type: Type.STRING },
    verdict: {
      type: Type.OBJECT,
      properties: {
        status: { type: Type.STRING },
        message: { type: Type.STRING },
      },
      required: ['status', 'message'],
    },
  },
  required: [
    'isValidLogic',
    'language',
    'analogyType',
    'traceSource',
    'logicSummary',
    'lineNotes',
    'steps',
    'finalOutput',
    'outputExplanation',
    'verdict',
  ],
};

function normalizeGeminiRawOutput(
  rawObj: any,
  fallbackLang: SupportedLanguage,
  code: string
): any {
  if (!rawObj || typeof rawObj !== 'object') return rawObj;
  const cleanCode = stripCommentsPreservingLines(code, fallbackLang);
  const codeLines = cleanCode.split('\n');
  const maxLine = Math.max(1, codeLines.length);

  const topAnalogy: AnalogyType = VALID_ANALOGIES.has(rawObj.analogyType)
    ? rawObj.analogyType
    : 'generic_memory';

  const lineNotes = Array.isArray(rawObj.lineNotes)
    ? rawObj.lineNotes.map((ln: any, i: number) => {
        const lineNum =
          typeof ln.line === 'number' && ln.line >= 1 && ln.line <= maxLine
            ? ln.line
            : Math.min(maxLine, i + 1);
        const rawLineText = (codeLines[lineNum - 1] || '').trim();
        return {
          line: lineNum,
          role: VALID_ROLES.has(ln.role) ? ln.role : inferLineRole(rawLineText),
          text: String(ln.text || ''),
          why: ln.why ? String(ln.why) : undefined,
        };
      })
    : [];

  let runningVars: Record<string, any> = {};

  const steps = Array.isArray(rawObj.steps)
    ? rawObj.steps.slice(0, 120).map((s: any, idx: number) => {
        let variables: Record<string, any> = {};
        if (s.variables && typeof s.variables === 'object') {
          variables = s.variables;
        } else if (typeof s.variablesJson === 'string' && s.variablesJson.trim()) {
          try {
            const parsed = JSON.parse(s.variablesJson);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              variables = parsed;
            }
          } catch {
            variables = { ...runningVars };
          }
        }

        const rawChanges = Array.isArray(s.changes)
          ? s.changes.map((c: any) => ({
              name: String(c?.name || 'var'),
              from:
                c?.from === undefined || c?.from === null
                  ? null
                  : typeof c.from === 'object'
                  ? JSON.stringify(c.from)
                  : c.from,
              to:
                c?.to === undefined || c?.to === null
                  ? null
                  : typeof c.to === 'object'
                  ? JSON.stringify(c.to)
                  : c.to,
            }))
          : [];

        if (Object.keys(variables).length === 0 && rawChanges.length > 0) {
          variables = { ...runningVars };
          for (const chg of rawChanges) {
            if (chg.to !== null) {
              try {
                variables[chg.name] = JSON.parse(String(chg.to));
              } catch {
                variables[chg.name] = chg.to;
              }
            }
          }
        }
        runningVars = { ...runningVars, ...variables };

        const activeLine =
          typeof s.activeLine === 'number' && s.activeLine >= 1 && s.activeLine <= maxLine
            ? s.activeLine
            : 1;
        const stepAnalogy: AnalogyType = VALID_ANALOGIES.has(s.analogyType)
          ? s.analogyType
          : topAnalogy;
        const rawLineText = (codeLines[activeLine - 1] || '').trim();

        let normalizedFault = null;
        if (s.fault && typeof s.fault === 'object' && s.fault.message) {
          normalizedFault = {
            type: VALID_FAULT_TYPES.has(s.fault.type) ? s.fault.type : 'off_by_one',
            message: String(s.fault.message),
            fixHint: String(s.fault.fixHint || s.fault.message),
            target: s.fault.target ? String(s.fault.target) : undefined,
          };
        }

        const autoStructure = buildStructureFromVariables(
          stepAnalogy,
          variables,
          rawLineText
        );

        const uiAct = VALID_ACTIONS.has(s.action) ? s.action : 'assign';
        const mappedActionType =
          uiAct === 'declare'
            ? 'DECLARE'
            : uiAct === 'loop_check'
            ? 'LOOP_CHECK'
            : uiAct === 'compare'
            ? 'CONDITION_CHECK'
            : uiAct === 'return'
            ? 'BLOCK_END'
            : s.stdout
            ? 'OUTPUT'
            : 'ASSIGN';

        return {
          stepIndex: idx + 1,
          activeLine,
          analogyType: stepAnalogy,
          action: uiAct,
          from: s.from ? String(s.from) : null,
          to: s.to ? String(s.to) : rawChanges[0]?.name || null,
          explanation: String(s.explanation || ''),
          why: String(s.why || ''),
          stdout: s.stdout ? String(s.stdout) : null,
          changes: rawChanges,
          variables,
          fault: normalizedFault,
          structure: s.structure && typeof s.structure === 'object' ? s.structure : autoStructure,
          step: idx + 1,
          lineNumber: activeLine,
          codeSnippet: rawLineText,
          actionType: mappedActionType,
          memoryState: variables,
          memoryDelta: rawChanges[0]
            ? {
                variable: rawChanges[0].name,
                oldValue: rawChanges[0].from,
                newValue: rawChanges[0].to,
              }
            : { variable: null, oldValue: null, newValue: null },
          consoleOutput: s.stdout ? String(s.stdout) : null,
          whatHappenedBn: String(s.explanation || ''),
          logicBuildingBn: String(s.why || ''),
        };
      })
    : [];

  const verdictStatus = VALID_VERDICTS.has(rawObj.verdict?.status)
    ? rawObj.verdict.status
    : rawObj.isValidLogic === false
    ? 'logic_error'
    : 'ok';

  const hasErr = Boolean(rawObj.hasError || verdictStatus === 'compile_error');

  let normalizedErrorDetails: TraceErrorDetails | null = null;
  if (rawObj.errorDetails && typeof rawObj.errorDetails === 'object' && rawObj.errorDetails.message) {
    const ln =
      typeof rawObj.errorDetails.lineNumber === 'number' && rawObj.errorDetails.lineNumber >= 1
        ? rawObj.errorDetails.lineNumber
        : typeof rawObj.errorDetails.line === 'number' && rawObj.errorDetails.line >= 1
        ? rawObj.errorDetails.line
        : 1;
    normalizedErrorDetails = {
      errorType:
        rawObj.errorDetails.errorType === 'FILE_NAME_MISMATCH' ||
        rawObj.errorDetails.errorType === 'COMPILATION_ERROR'
          ? rawObj.errorDetails.errorType
          : 'SYNTAX_ERROR',
      lineNumber: ln,
      lineCode: String(rawObj.errorDetails.lineCode || codeLines[ln - 1] || '').trim(),
      messageBn: String(rawObj.errorDetails.messageBn || rawObj.errorDetails.message),
      solutionBn: String(rawObj.errorDetails.solutionBn || ''),
      line: ln,
      message: String(rawObj.errorDetails.message),
    };
  }

  const timeComp = String(rawObj.logicSummary?.complexity?.time || 'O(n)');
  const spaceComp = String(rawObj.logicSummary?.complexity?.space || 'O(1)');
  const finalOut = String(rawObj.finalOutput ?? '');

  return {
    ...rawObj,
    hasError: hasErr,
    isValidLogic: Boolean(rawObj.isValidLogic ?? verdictStatus === 'ok'),
    errorDetails: normalizedErrorDetails,
    language: fallbackLang,
    analogyType: topAnalogy,
    traceSource: 'ai_predicted',
    logicSummary: {
      title: String(rawObj.logicSummary?.title || 'Code Analysis'),
      goal: String(rawObj.logicSummary?.goal || ''),
      idea: String(rawObj.logicSummary?.idea || ''),
      keyPoints: Array.isArray(rawObj.logicSummary?.keyPoints)
        ? rawObj.logicSummary.keyPoints.map(String)
        : [],
      analogyStory: String(rawObj.logicSummary?.analogyStory || ''),
      complexity: {
        time: timeComp,
        space: spaceComp,
        note: String(rawObj.logicSummary?.complexity?.note || ''),
      },
      commonMistakes: Array.isArray(rawObj.logicSummary?.commonMistakes)
        ? rawObj.logicSummary.commonMistakes.map(String)
        : [],
    },
    lineNotes,
    steps: hasErr ? [] : steps,
    finalOutput: hasErr ? '' : finalOut,
    outputExplanation: String(rawObj.outputExplanation ?? ''),
    verdict: {
      status: verdictStatus,
      message: String(rawObj.verdict?.message || ''),
    },
    programSummary: hasErr
      ? null
      : {
          totalExecutionSteps: steps.length,
          timeComplexity: timeComp,
          spaceComplexity: spaceComp,
          finalOutput: finalOut,
        },
  };
}

function formatResult(trace: ExecutionTrace, cached: boolean): TraceServiceResult {
  const hasError = Boolean(trace.hasError || trace.verdict.status === 'compile_error');
  return {
    hasError,
    errorDetails: hasError ? trace.errorDetails : null,
    programSummary: hasError ? null : trace.programSummary ?? null,
    steps: hasError ? [] : trace.steps,
    trace,
    cached,
    apiNotice: null,
  };
}

export async function generateExecutionTrace(params: {
  code: string;
  language: SupportedLanguage;
  explainLanguage: ExplainLanguage;
  depth: ExplanationDepth;
  fileName?: string;
  stdin?: string;
}): Promise<TraceServiceResult> {
  // 1. Pre-execution static analysis & javac validation (reject errors immediately before any simulation)
  const syntaxErr = detectSyntaxError(
    params.code,
    params.explainLanguage,
    params.language,
    params.fileName
  );
  if (syntaxErr) {
    const errTrace = buildFallbackTrace(params);
    return formatResult(errTrace, false);
  }

  const hash = computeTraceHash(params);
  const cachedEntry = traceCache.get(hash);
  if (cachedEntry) {
    return formatResult(cachedEntry.trace, true);
  }

  // 2. Build ground-truth runtime execution across ALL 4 languages (JS, Python, C++, Java)
  const sandboxResult = runDeterministicMultiLanguage(
    params.code,
    params.language,
    params.stdin || '',
    1200
  );

  const deterministicTrace = buildFallbackTrace(params);

  // If runtime execution or static check flagged a compilation/syntax error, halt immediately
  if (
    deterministicTrace.hasError ||
    deterministicTrace.verdict.status === 'compile_error' ||
    (sandboxResult.runtimeError &&
      (sandboxResult.recordedSteps.length === 0 ||
        /is not defined|SyntaxError|ReferenceError/.test(sandboxResult.runtimeError)))
  ) {
    return formatResult(deterministicTrace, false);
  }

  if (!isGeminiKeyConfigured()) {
    traceCache.set(hash, { trace: deterministicTrace, createdAt: Date.now() });
    return formatResult(deterministicTrace, false);
  }

  const stepPreview = (sandboxResult.recordedSteps || [])
    .slice(0, 45)
    .map(
      (st, i) =>
        `  Step ${i + 1}: Line ${st.line} [${st.actionType}] (${st.codeSnippet}) -> memoryState=${JSON.stringify(
          st.variables
        )}, delta=${JSON.stringify(st.memoryDelta)}${
          st.consoleOutput ? `, consoleOutput=${JSON.stringify(st.consoleOutput)}` : ''
        }`
    )
    .join('\n');

  const groundTruthContext = [
    `- Real Runtime Execution Timed Out (Infinite Loop): ${sandboxResult.timedOut}`,
    `- Real Runtime Error: ${sandboxResult.runtimeError || 'None'}`,
    `- Real Runtime Final Stdout: ${JSON.stringify(sandboxResult.stdout)}`,
    `- Real Runtime Final Variables: ${JSON.stringify(sandboxResult.finalVariables)}`,
    stepPreview ? `- Real Runtime Recorded Step Sequence:\n${stepPreview}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const configuredModel = process.env.GEMINI_MODEL?.trim();
  const candidateModels = [
    configuredModel &&
    !configuredModel.startsWith('gemini-1.') &&
    !configuredModel.startsWith('gemini-2.0')
      ? configuredModel
      : 'gemini-3.8-flash',
    'gemini-flash-latest',
  ];

  const baseUserPrompt = buildUserTracePrompt({
    ...params,
    groundTruthContext: groundTruthContext || undefined,
  });

  let lastValidationError = '';
  let abortAllModels = false;

  for (const modelName of candidateModels) {
    if (abortAllModels) break;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const promptText =
          attempt === 1
            ? baseUserPrompt
            : `${baseUserPrompt}\n\nVALIDATION ERROR ON PREVIOUS ATTEMPT:\n${lastValidationError}\nFix the JSON so it strictly passes validation.`;

        const response = await ai.models.generateContent({
          model: modelName,
          contents: promptText,
          config: {
            systemInstruction: GEMINI_TRACE_SYSTEM_PROMPT,
            responseMimeType: 'application/json',
            responseSchema: TRACE_RESPONSE_SCHEMA,
          },
        });

        const rawText = (response.text ?? '{}').trim();
        const parsedJson = JSON.parse(rawText);
        const normalized = normalizeGeminiRawOutput(
          parsedJson,
          params.language,
          params.code
        );

        // Preserve exact ground-truth runtime stdout, variables, and step structures when deterministic execution succeeded
        if (!normalized.hasError && deterministicTrace.steps.length > 0) {
          const detSteps = deterministicTrace.steps;
          const aiSteps: TraceStep[] = Array.isArray(normalized.steps) ? normalized.steps : [];

          normalized.analogyType =
            deterministicTrace.analogyType !== 'generic_memory'
              ? deterministicTrace.analogyType
              : normalized.analogyType;

          normalized.finalOutput =
            deterministicTrace.finalOutput || normalized.finalOutput || '';

          // Map AI explanations onto deterministic runtime steps so memory states and 3D structures are 100% exact
          normalized.steps = detSteps.map((dStep, idx) => {
            const matchingAiStep =
              aiSteps[idx]?.activeLine === dStep.activeLine
                ? aiSteps[idx]
                : aiSteps.find((a) => a.activeLine === dStep.activeLine);

            return {
              ...dStep,
              explanation: matchingAiStep?.explanation || dStep.explanation,
              why: matchingAiStep?.why || dStep.why,
              whatHappenedBn: matchingAiStep?.explanation || dStep.whatHappenedBn,
              logicBuildingBn: matchingAiStep?.why || dStep.logicBuildingBn,
            };
          });

          if (normalized.programSummary) {
            normalized.programSummary.totalExecutionSteps = normalized.steps.length;
            normalized.programSummary.finalOutput = normalized.finalOutput;
          }
        }

        const validated = ExecutionTraceSchema.safeParse(normalized);

        if (validated.success) {
          traceCache.set(hash, { trace: validated.data, createdAt: Date.now() });
          return formatResult(validated.data, false);
        }

        lastValidationError = validated.error.message;
      } catch (err: any) {
        lastValidationError = String(err?.message || err);
        if (
          lastValidationError.includes('403') ||
          lastValidationError.includes('PERMISSION_DENIED') ||
          lastValidationError.includes('API_KEY_INVALID')
        ) {
          abortAllModels = true;
        }
        break;
      }
    }
  }

  traceCache.set(hash, { trace: deterministicTrace, createdAt: Date.now() });
  return formatResult(deterministicTrace, false);
}

