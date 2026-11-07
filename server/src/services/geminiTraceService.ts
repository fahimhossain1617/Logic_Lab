import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import {
  AnalogyType,
  ExecutionDiagnostic,
  ExecutionResultPayload,
  ExecutionStatus,
  ExecutionTrace,
  ExplainLanguage,
  ExplanationDepth,
  ProgramSummary,
  SupportedLanguage,
  TraceErrorDetails,
  TraceStep,
} from '../../../shared/types';
import { preprocessCode } from './codePreprocessor';
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
import { analyzeCode, executeCode } from './toolchains/toolchainManager';

export interface ApiNotice {
  code: string;
  message_bn: string;
  message_en: string;
}

export interface TraceServiceResult extends ExecutionResultPayload {
  hasError: boolean;
  errorDetails: TraceErrorDetails | null;
  programSummary: ProgramSummary | null;
  steps: TraceStep[];
  trace: ExecutionTrace;
  cached: boolean;
  apiNotice: ApiNotice | null;
}

const traceCache = new Map<string, { trace: ExecutionTrace; createdAt: number }>();

export function clearTraceCache(): void {
  traceCache.clear();
}

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

function formatResult(
  trace: ExecutionTrace,
  cached: boolean,
  diagnostics: ExecutionDiagnostic[] = []
): TraceServiceResult {
  const hasError = Boolean(trace.hasError || trace.verdict.status === 'compile_error');
  const allDiagnostics = [...diagnostics];

  if (hasError && trace.errorDetails) {
    const errLine = trace.errorDetails.lineNumber || trace.errorDetails.line || 1;
    if (!allDiagnostics.some((d) => d.severity === 'error' && d.line === errLine)) {
      allDiagnostics.unshift({
        line: errLine,
        severity: 'error',
        message: trace.errorDetails.message,
      });
    }
  }

  const hasErrors = hasError || allDiagnostics.some((d) => d.severity === 'error');
  const hasWarnings = allDiagnostics.some((d) => d.severity === 'warning');
  const status: ExecutionStatus = hasErrors ? 'error' : hasWarnings ? 'warning' : 'success';
  const canRun = !hasErrors;

  const output = hasError
    ? trace.errorDetails?.message || trace.verdict.message || 'Execution failed.'
    : trace.finalOutput || '';

  trace.status = status;
  trace.diagnostics = allDiagnostics;

  return {
    status,
    canRun,
    output,
    diagnostics: allDiagnostics,
    visualizerData: canRun ? trace : null,
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
  bypassCache?: boolean;
}): Promise<TraceServiceResult> {
  // Preprocess code: auto-inject missing imports/headers & collect non-blocking warnings
  const prep = preprocessCode(params.code, params.language);
  const codeToRun = prep.code;
  const initialDiagnostics = [...prep.diagnostics];

  // 1. Real Compiler / Toolchain validation (source of truth)
  const toolchainAnalysis = await analyzeCode(codeToRun, params.language, params.fileName);
  if (!toolchainAnalysis.canCompile) {
    const firstErr = toolchainAnalysis.diagnostics.find((d) => d.severity === 'error');
    const errLine = firstErr?.line || 1;
    const errTrace = buildFallbackTrace({ ...params, code: codeToRun });
    errTrace.hasError = true;
    errTrace.verdict.status = 'compile_error';
    errTrace.verdict.message = firstErr?.message || 'Compilation error.';
    errTrace.errorDetails = {
      errorType: 'COMPILATION_ERROR',
      lineNumber: errLine,
      line: errLine,
      message: firstErr?.message || 'Compilation failed.',
      messageBn:
        params.explainLanguage === 'bn'
          ? `কম্পাইল ত্রুটি (লাইন ${errLine}): ${firstErr?.message}`
          : undefined,
    };
    return formatResult(errTrace, false, [
      ...initialDiagnostics,
      ...toolchainAnalysis.diagnostics,
    ]);
  }

  // 1B. Quick sanity check with detectSyntaxError (for bracket balance / file name mismatch)
  const syntaxErr = detectSyntaxError(
    codeToRun,
    params.explainLanguage,
    params.language,
    params.fileName
  );
  if (syntaxErr && syntaxErr.errorType === 'FILE_NAME_MISMATCH') {
    if (prep.injectedPrefixLines > 0 && syntaxErr.lineNumber) {
      syntaxErr.lineNumber = Math.max(1, syntaxErr.lineNumber - prep.injectedPrefixLines);
      syntaxErr.line = syntaxErr.lineNumber;
    }
    const errTrace = buildFallbackTrace({ ...params, code: codeToRun });
    errTrace.errorDetails = syntaxErr;
    return formatResult(errTrace, false, initialDiagnostics);
  }

  const hash = computeTraceHash(params);
  if (!params.bypassCache) {
    const cachedEntry = traceCache.get(hash);
    if (
      cachedEntry &&
      !cachedEntry.trace.hasError &&
      cachedEntry.trace.verdict.status !== 'compile_error'
    ) {
      return formatResult(cachedEntry.trace, true, initialDiagnostics);
    }
  }

  // 2. Real Sandboxed Execution across ALL 4 languages
  const realExec = await executeCode(
    codeToRun,
    params.language,
    params.stdin || '',
    3500,
    params.fileName
  );

  // 3. Deterministic step recorder for UI animation
  const sandboxResult = runDeterministicMultiLanguage(
    codeToRun,
    params.language,
    params.stdin || '',
    1200
  );

  const deterministicTrace = buildFallbackTrace({ ...params, code: codeToRun });

  // Use real execution stdout as ground truth (normalized of trailing newline)
  const cleanedStdout = (realExec.stdout || sandboxResult.stdout || '').replace(/\r?\n$/, '');
  deterministicTrace.finalOutput = cleanedStdout;

  if (realExec.runtimeError) {
    deterministicTrace.hasError = true;
    deterministicTrace.isValidLogic = false;
    deterministicTrace.verdict.status = realExec.timedOut ? 'infinite_loop' : 'runtime_error';
    deterministicTrace.verdict.message = realExec.runtimeError;
    deterministicTrace.errorDetails = {
      lineNumber: realExec.runtimeErrorLine || 1,
      line: realExec.runtimeErrorLine || 1,
      message: realExec.runtimeError,
    };
  } else {
    // Real execution succeeded with exitCode 0
    deterministicTrace.hasError = false;
    deterministicTrace.isValidLogic = true;
    deterministicTrace.errorDetails = null;
    deterministicTrace.verdict.status = 'ok';
    deterministicTrace.verdict.message = 'Program compiled and executed successfully.';
    deterministicTrace.outputExplanation =
      params.explainLanguage === 'bn'
        ? `প্রোগ্রামটি সফলভাবে সম্পন্ন হয়েছে এবং আউটপুট তৈরি করেছে।`
        : `Program compiled and executed successfully.`;
    deterministicTrace.traceSource = 'real_execution';
  }

  // If deterministicTrace.steps is empty but sandbox recorded steps, use them!
  if (deterministicTrace.steps.length === 0 && sandboxResult.recordedSteps.length > 0) {
    deterministicTrace.steps = sandboxResult.recordedSteps.map((st, idx) => ({
      stepIndex: idx + 1,
      step: idx + 1,
      activeLine: st.line,
      lineNumber: st.line,
      codeSnippet: st.codeSnippet,
      action: st.actionType === 'DECLARE' ? 'declare' : 'assign',
      actionType: st.actionType,
      analogyType: 'generic_memory',
      from: null,
      to: st.memoryDelta?.variable || null,
      explanation: st.consoleOutput
        ? `Output: ${st.consoleOutput}`
        : `Executing line ${st.line}: ${st.codeSnippet}`,
      why: '',
      stdout: st.consoleOutput,
      consoleOutput: st.consoleOutput,
      changes: st.memoryDelta
        ? [{ name: st.memoryDelta.variable || '', from: st.memoryDelta.oldValue, to: st.memoryDelta.newValue }]
        : [],
      variables: st.variables || {},
      memoryState: st.variables || {},
      memoryDelta: st.memoryDelta || { variable: null, oldValue: null, newValue: null },
      fault: null,
      structure: null,
      whatHappenedBn: st.consoleOutput
        ? `আউটপুট: ${st.consoleOutput}`
        : `লাইন ${st.line} কার্যকর হয়েছে।`,
      logicBuildingBn: '',
    }));
  } else if (deterministicTrace.steps.length === 0 && realExec.status === 'success') {
    // Generate fallback steps from executable lines and final stdout
    const codeLines = codeToRun.split('\n');
    const execLines: { line: number; text: string }[] = [];
    for (let i = 0; i < codeLines.length; i++) {
      const t = codeLines[i].trim();
      if (
        t &&
        !t.startsWith('//') &&
        !t.startsWith('/*') &&
        !t.startsWith('*') &&
        !t.startsWith('import ') &&
        !t.startsWith('#include') &&
        !t.startsWith('package ')
      ) {
        execLines.push({ line: i + 1, text: t });
      }
    }
    const sampleSteps = execLines.slice(0, 30);
    deterministicTrace.steps = sampleSteps.map((el, idx) => ({
      stepIndex: idx + 1,
      step: idx + 1,
      activeLine: el.line,
      lineNumber: el.line,
      codeSnippet: el.text,
      action: 'assign',
      actionType: idx === sampleSteps.length - 1 && cleanedStdout ? 'OUTPUT' : 'ASSIGN',
      analogyType: 'generic_memory',
      from: null,
      to: null,
      explanation:
        idx === sampleSteps.length - 1 && cleanedStdout
          ? `Program Output: ${cleanedStdout.split('\n')[0]}`
          : `Line ${el.line}: ${el.text}`,
      why: '',
      stdout: idx === sampleSteps.length - 1 ? cleanedStdout : null,
      consoleOutput: idx === sampleSteps.length - 1 ? cleanedStdout : null,
      changes: [],
      variables: {},
      memoryState: {},
      memoryDelta: { variable: null, oldValue: null, newValue: null },
      fault: null,
      structure: null,
      whatHappenedBn:
        idx === sampleSteps.length - 1 && cleanedStdout
          ? `প্রোগ্রাম আউটপুট: ${cleanedStdout.split('\n')[0]}`
          : `লাইন ${el.line}: ${el.text}`,
      logicBuildingBn: '',
    }));
  }

  // Adjust line numbers if boilerplate was prepended
  if (prep.injectedPrefixLines > 0) {
    for (const st of deterministicTrace.steps) {
      st.activeLine = Math.max(1, st.activeLine - prep.injectedPrefixLines);
      if (st.lineNumber) st.lineNumber = Math.max(1, st.lineNumber - prep.injectedPrefixLines);
    }
    for (const ln of deterministicTrace.lineNotes) {
      ln.line = Math.max(1, ln.line - prep.injectedPrefixLines);
    }
  }

  const combinedDiagnostics: ExecutionDiagnostic[] = [
    ...toolchainAnalysis.diagnostics,
    ...realExec.diagnostics,
    ...initialDiagnostics,
  ];

  // If real execution had fatal compilation failure, halt immediately
  if (
    deterministicTrace.hasError ||
    (deterministicTrace.verdict.status as string) === 'compile_error'
  ) {
    return formatResult(deterministicTrace, false, combinedDiagnostics);
  }

  if (!isGeminiKeyConfigured()) {
    if (!deterministicTrace.hasError) {
      traceCache.set(hash, { trace: deterministicTrace, createdAt: Date.now() });
    }
    return formatResult(deterministicTrace, false, combinedDiagnostics);
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
    `- Real Compiler Status: Succeeded without errors`,
    `- Real Runtime Exit Code: ${realExec.exitCode}`,
    `- Real Runtime Execution Timed Out: ${realExec.timedOut}`,
    `- Real Runtime Error: ${realExec.runtimeError || 'None'}`,
    `- Real Runtime Final Stdout: ${JSON.stringify(realExec.stdout || sandboxResult.stdout)}`,
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
  const primaryModel = configuredModel || 'gemini-2.5-flash';
  const candidateModels = [
    primaryModel,
    'gemini-2.5-flash',
    'gemini-1.5-flash',
  ].filter((v, i, a) => a.indexOf(v) === i);

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
            temperature: 0.2,
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
          const finalTrace: ExecutionTrace = validated.data as unknown as ExecutionTrace;
          if (prep.injectedPrefixLines > 0) {
            for (const st of finalTrace.steps) {
              st.activeLine = Math.max(1, st.activeLine - prep.injectedPrefixLines);
              if (st.lineNumber) st.lineNumber = Math.max(1, st.lineNumber - prep.injectedPrefixLines);
            }
            for (const ln of finalTrace.lineNotes) {
              ln.line = Math.max(1, ln.line - prep.injectedPrefixLines);
            }
          }
          if (!finalTrace.hasError) {
            traceCache.set(hash, { trace: finalTrace, createdAt: Date.now() });
          }
          return formatResult(finalTrace, false, initialDiagnostics);
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

  if (!deterministicTrace.hasError) {
    traceCache.set(hash, { trace: deterministicTrace, createdAt: Date.now() });
  }
  return formatResult(deterministicTrace, false, initialDiagnostics);
}

