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
  RuntimeActionType,
  SupportedLanguage,
  TraceErrorDetails,
  TraceStep,
  VariableSnapshot,
  VisualCue,
} from '../../../shared/types';
import {
  extractDeclaredVariableTypes,
  resolveAccurateVariableType,
} from '../../../shared/declaredTypeHelper';
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

const modelCooldownUntil = new Map<string, number>();

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
  stdin?: string;
}): string {
  const filePart = params.fileName ? `::${params.fileName.trim()}` : '';
  const stdinPart = params.stdin ? `::stdin=${params.stdin}` : '';
  const payload = `v7::${params.language}::${params.explainLanguage}::${params.depth}${filePart}${stdinPart}::${params.code.trim()}`;
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
  'declaration',
  'declare',
  'allocation',
  'assign',
  'condition',
  'comparison',
  'loop',
  'call',
  'return',
  'output',
  'scope_end',
  'block_end',
  'comment',
]);

const VALID_OPERATION_TAGS = new Set<RuntimeActionType>([
  'DECLARATION',
  'ALLOCATION',
  'DECLARE',
  'ASSIGN',
  'CONDITION',
  'LOOP',
  'LOOP_CHECK',
  'CONDITION_CHECK',
  'COMPARISON',
  'CALL',
  'OUTPUT',
  'RETURN',
  'SCOPE_END',
  'METHOD_ENTRY',
  'BLOCK_END',
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
          operationTag: {
            type: Type.STRING,
            description:
              'AST-accurate tag: DECLARATION, ALLOCATION, ASSIGN, CONDITION, LOOP, COMPARISON, CALL, OUTPUT, RETURN, or SCOPE_END',
          },
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
          variableSnapshotsJson: {
            type: Type.STRING,
            nullable: true,
            description:
              'JSON array string of variable objects: [{"name":"a","type":"Integer","value":127,"memoryAddress":"@IntegerCache[127]","referenceId":"@IntegerCache[127]","pointsTo":null,"changed":true}]',
          },
          visualCue: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              mode: { type: Type.STRING },
              highlightVars: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.STRING },
              },
              compareVars: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.STRING },
              },
              linkVars: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.STRING },
              },
              comparison: {
                type: Type.OBJECT,
                nullable: true,
                properties: {
                  leftVar: { type: Type.STRING, nullable: true },
                  rightVar: { type: Type.STRING, nullable: true },
                  leftLabel: { type: Type.STRING },
                  rightLabel: { type: Type.STRING },
                  operator: { type: Type.STRING },
                  result: { type: Type.BOOLEAN },
                  reason: { type: Type.STRING, nullable: true },
                },
                required: ['leftLabel', 'rightLabel', 'operator', 'result'],
              },
            },
          },
          structure: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              kind: { type: Type.STRING },
              valuesJson: {
                type: Type.STRING,
                nullable: true,
                description:
                  'JSON array string of structure values, e.g. "[5,2,8,1]" or "["fact(3)","fact(2)"]"',
              },
              highlight: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.INTEGER },
              },
              swapping: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.INTEGER },
                description: 'Two-element index pair [i, j] when swapping elements, else null',
              },
              sortedFrom: { type: Type.INTEGER, nullable: true },
              pointersJson: {
                type: Type.STRING,
                nullable: true,
                description: 'JSON object string of pointer indices, e.g. "{\\"i\\":0,\\"j\\":1}"',
              },
              lap: { type: Type.INTEGER, nullable: true },
              maxLaps: { type: Type.INTEGER, nullable: true },
              conditionText: { type: Type.STRING, nullable: true },
            },
            required: ['kind'],
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
  const declaredTypesByVar = extractDeclaredVariableTypes(cleanCode, fallbackLang);
  let heapAllocCounter = 0;
  const resolveMissingRef = (
    name: string,
    resolvedType: string,
    val: any,
    lineText: string
  ): { memoryAddress: string | null; referenceId: string | null; pointsTo: string | null } => {
    const aliasMatch = lineText.match(
      new RegExp(`\\b${name}\\s*=\\s*(&?)([A-Za-z_$][\\w$]*)\\s*;?`)
    );
    if (aliasMatch && runningSnapshotMeta[aliasMatch[2]]) {
      const targetSnap = runningSnapshotMeta[aliasMatch[2]];
      const targetAddr = targetSnap.referenceId || targetSnap.memoryAddress;
      if (targetAddr) {
        return {
          memoryAddress: targetAddr,
          referenceId: targetAddr,
          pointsTo: aliasMatch[1] === '&' ? aliasMatch[2] : targetSnap.pointsTo ?? null,
        };
      }
    }
    if (fallbackLang === 'java' && resolvedType === 'Integer' && typeof val === 'number' && Number.isInteger(val)) {
      const usesNew = /\bnew\s+Integer\s*\(/.test(lineText);
      if (!usesNew && val >= -128 && val <= 127) {
        const addr = `@IntegerCache[${val}]`;
        return { memoryAddress: addr, referenceId: addr, pointsTo: null };
      }
      heapAllocCounter++;
      const hex = `@0x${(0x4a1 + heapAllocCounter * 0x17).toString(16).toUpperCase()}`;
      return { memoryAddress: hex, referenceId: hex, pointsTo: null };
    }
    return { memoryAddress: null, referenceId: null, pointsTo: null };
  };

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
        const isPrintLineNote =
          /\b(System\.out\.print|console\.log|print\s*\(|cout\s*<<|printf\s*\()/.test(
            rawLineText
          );
        const isScopeCloseNote = /^[\}\s;]*$/.test(rawLineText) && rawLineText.includes('}');
        const isDeclNote =
          /^(?:public|private|protected|class|interface|def|function|int\s+main\s*\(|void\s+\w+\s*\()/.test(
            rawLineText
          );
        const rawRoleLower = typeof ln.role === 'string' ? ln.role.toLowerCase() : '';
        const normalizedRole = isPrintLineNote
          ? 'output'
          : isScopeCloseNote
          ? 'scope_end'
          : isDeclNote
          ? 'declaration'
          : VALID_ROLES.has(rawRoleLower)
          ? rawRoleLower
          : inferLineRole(rawLineText);
        return {
          line: lineNum,
          role: normalizedRole,
          text: String(ln.text || ''),
          why: ln.why ? String(ln.why) : undefined,
        };
      })
    : [];

  let runningVars: Record<string, any> = {};
  let runningSnapshotMeta: Record<string, VariableSnapshot> = {};

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

        let normalizedStructure = autoStructure;
        if (
          s.structure &&
          typeof s.structure === 'object' &&
          ['array', 'loop', 'stack', 'queue', 'list'].includes(s.structure.kind)
        ) {
          let parsedValues: (number | string)[] | null = null;
          if (Array.isArray(s.structure.values)) {
            parsedValues = s.structure.values.map((v: any) =>
              typeof v === 'number' || typeof v === 'string' ? v : String(v)
            );
          } else if (typeof s.structure.valuesJson === 'string' && s.structure.valuesJson.trim()) {
            try {
              const arr = JSON.parse(s.structure.valuesJson);
              if (Array.isArray(arr)) {
                parsedValues = arr.map((v: any) =>
                  typeof v === 'number' || typeof v === 'string' ? v : String(v)
                );
              }
            } catch {}
          }

          let parsedPointers: Record<string, number> | null = null;
          if (s.structure.pointers && typeof s.structure.pointers === 'object') {
            parsedPointers = {};
            for (const [pk, pv] of Object.entries(s.structure.pointers)) {
              if (typeof pv === 'number' && Number.isFinite(pv)) {
                parsedPointers[pk] = pv;
              }
            }
          } else if (
            typeof s.structure.pointersJson === 'string' &&
            s.structure.pointersJson.trim()
          ) {
            try {
              const obj = JSON.parse(s.structure.pointersJson);
              if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                parsedPointers = {};
                for (const [pk, pv] of Object.entries(obj)) {
                  if (typeof pv === 'number' && Number.isFinite(pv)) {
                    parsedPointers[pk] = pv;
                  }
                }
              }
            } catch {}
          }

          const rawSwap = Array.isArray(s.structure.swapping) ? s.structure.swapping : null;
          const normalizedSwapping: [number, number] | null =
            rawSwap &&
            rawSwap.length >= 2 &&
            typeof rawSwap[0] === 'number' &&
            typeof rawSwap[1] === 'number'
              ? [rawSwap[0], rawSwap[1]]
              : null;

          const normalizedHighlight: number[] | null = Array.isArray(s.structure.highlight)
            ? s.structure.highlight.filter((n: any) => typeof n === 'number' && Number.isFinite(n))
            : null;

          normalizedStructure = {
            kind: s.structure.kind,
            values: parsedValues ?? autoStructure?.values ?? null,
            highlight: normalizedHighlight ?? autoStructure?.highlight ?? null,
            swapping: normalizedSwapping,
            sortedFrom:
              typeof s.structure.sortedFrom === 'number' && Number.isFinite(s.structure.sortedFrom)
                ? s.structure.sortedFrom
                : null,
            pointers: parsedPointers ?? autoStructure?.pointers ?? null,
            lap:
              typeof s.structure.lap === 'number' && Number.isFinite(s.structure.lap)
                ? s.structure.lap
                : autoStructure?.lap ?? null,
            maxLaps:
              typeof s.structure.maxLaps === 'number' && Number.isFinite(s.structure.maxLaps)
                ? s.structure.maxLaps
                : autoStructure?.maxLaps ?? null,
            conditionText:
              typeof s.structure.conditionText === 'string'
                ? s.structure.conditionText
                : autoStructure?.conditionText ?? null,
          };
        }

        const uiAct = VALID_ACTIONS.has(s.action) ? s.action : 'assign';
        const isPrintLine =
          /\b(System\.out\.print|console\.log|print\s*\(|cout\s*<<|printf\s*\()/.test(
            rawLineText
          );
        const isScopeClose = /^[\}\s;]*$/.test(rawLineText) && rawLineText.includes('}');

        let mappedActionType: RuntimeActionType =
          typeof s.operationTag === 'string' &&
          VALID_OPERATION_TAGS.has(s.operationTag.toUpperCase() as RuntimeActionType)
            ? (s.operationTag.toUpperCase() as RuntimeActionType)
            : uiAct === 'declare'
            ? 'DECLARATION'
            : uiAct === 'loop_check'
            ? 'LOOP'
            : uiAct === 'compare'
            ? 'COMPARISON'
            : uiAct === 'call'
            ? 'CALL'
            : uiAct === 'return'
            ? 'RETURN'
            : s.stdout
            ? 'OUTPUT'
            : 'ASSIGN';

        if (s.stdout || isPrintLine) {
          mappedActionType = 'OUTPUT';
        } else if (isScopeClose && mappedActionType === 'ASSIGN') {
          mappedActionType = 'SCOPE_END';
        }

        // Parse language-accurate variableSnapshots (with memoryAddress, referenceId, pointsTo)
        const changedNameSet = new Set(rawChanges.map((c: any) => c.name));
        let normalizedSnapshots: VariableSnapshot[] | null = null;
        const parseSnapshotsArray = (arr: any[]): VariableSnapshot[] =>
          arr
            .filter((item) => item && typeof item === 'object' && item.name)
            .map((item) => {
              const name = String(item.name);
              const prevMeta = runningSnapshotMeta[name];
              const val = item.value !== undefined ? item.value : variables[name];
              const sameVal =
                prevMeta && JSON.stringify(prevMeta.value) === JSON.stringify(val);
              const resolvedType = resolveAccurateVariableType(
                item.type || prevMeta?.type,
                val,
                fallbackLang,
                name,
                declaredTypesByVar
              );
              const explicitAddr = item.memoryAddress ? String(item.memoryAddress) : null;
              const explicitRef = item.referenceId ? String(item.referenceId) : null;
              const fallbackRef =
                explicitAddr || explicitRef || (sameVal && prevMeta?.memoryAddress)
                  ? null
                  : resolveMissingRef(name, resolvedType, val, rawLineText);
              return {
                name,
                type: resolvedType,
                value: val,
                memoryAddress:
                  explicitAddr ||
                  (sameVal ? prevMeta?.memoryAddress : null) ||
                  fallbackRef?.memoryAddress ||
                  null,
                referenceId:
                  explicitRef ||
                  (sameVal ? prevMeta?.referenceId : null) ||
                  fallbackRef?.referenceId ||
                  explicitAddr ||
                  null,
                pointsTo: item.pointsTo
                  ? String(item.pointsTo)
                  : (sameVal ? prevMeta?.pointsTo : null) ||
                    fallbackRef?.pointsTo ||
                    null,
                changed:
                  typeof item.changed === 'boolean'
                    ? item.changed
                    : changedNameSet.has(name),
              };
            });

        if (Array.isArray(s.variableSnapshots)) {
          normalizedSnapshots = parseSnapshotsArray(s.variableSnapshots);
        } else if (
          typeof s.variableSnapshotsJson === 'string' &&
          s.variableSnapshotsJson.trim()
        ) {
          try {
            const parsedSnaps = JSON.parse(s.variableSnapshotsJson);
            if (Array.isArray(parsedSnaps)) {
              normalizedSnapshots = parseSnapshotsArray(parsedSnaps);
            }
          } catch {}
        }

        if (normalizedSnapshots && normalizedSnapshots.length > 0) {
          for (const snap of normalizedSnapshots) {
            runningSnapshotMeta[snap.name] = snap;
            if (variables[snap.name] === undefined) {
              variables[snap.name] = snap.value;
            }
          }
          runningVars = { ...runningVars, ...variables };
        } else if (Object.keys(variables).length > 0) {
          normalizedSnapshots = Object.entries(variables).map(([vName, vVal]) => {
            const prevMeta = runningSnapshotMeta[vName];
            const sameVal =
              prevMeta && JSON.stringify(prevMeta.value) === JSON.stringify(vVal);
            const resolvedType = resolveAccurateVariableType(
              prevMeta?.type,
              vVal,
              fallbackLang,
              vName,
              declaredTypesByVar
            );
            const missingRef =
              sameVal && (prevMeta?.memoryAddress || prevMeta?.referenceId)
                ? null
                : resolveMissingRef(vName, resolvedType, vVal, rawLineText);
            const snap: VariableSnapshot = {
              name: vName,
              type: resolvedType,
              value: vVal,
              memoryAddress:
                (sameVal ? prevMeta?.memoryAddress : null) ||
                missingRef?.memoryAddress ||
                null,
              referenceId:
                (sameVal ? prevMeta?.referenceId : null) ||
                missingRef?.referenceId ||
                null,
              pointsTo:
                (sameVal ? prevMeta?.pointsTo : null) ||
                missingRef?.pointsTo ||
                null,
              changed: changedNameSet.has(vName),
            };
            runningSnapshotMeta[vName] = snap;
            return snap;
          });
        }

        // Parse explicit visualCue (compareVars, linkVars, comparison pill)
        const VALID_CUE_MODES = new Set([
          'memory',
          'compare',
          'reference',
          'mutate',
          'loop',
          'output',
          'call',
          'return',
        ]);
        let normalizedVisualCue: VisualCue | null = null;
        if (s.visualCue && typeof s.visualCue === 'object') {
          const rawCompare = Array.isArray(s.visualCue.compareVars)
            ? s.visualCue.compareVars.map(String).filter(Boolean)
            : null;
          const comparePair: [string, string] | null =
            rawCompare && rawCompare.length >= 2 ? [rawCompare[0], rawCompare[1]] : null;

          const compObj =
            s.visualCue.comparison &&
            typeof s.visualCue.comparison === 'object' &&
            s.visualCue.comparison.leftLabel &&
            s.visualCue.comparison.rightLabel
              ? {
                  leftVar: s.visualCue.comparison.leftVar
                    ? String(s.visualCue.comparison.leftVar)
                    : comparePair?.[0] || null,
                  rightVar: s.visualCue.comparison.rightVar
                    ? String(s.visualCue.comparison.rightVar)
                    : comparePair?.[1] || null,
                  leftLabel: String(s.visualCue.comparison.leftLabel),
                  rightLabel: String(s.visualCue.comparison.rightLabel),
                  operator: String(s.visualCue.comparison.operator || '=='),
                  result: Boolean(s.visualCue.comparison.result),
                  reason: s.visualCue.comparison.reason
                    ? String(s.visualCue.comparison.reason)
                    : null,
                }
              : null;

          normalizedVisualCue = {
            mode: VALID_CUE_MODES.has(s.visualCue.mode) ? s.visualCue.mode : undefined,
            highlightVars: Array.isArray(s.visualCue.highlightVars)
              ? s.visualCue.highlightVars.map(String)
              : undefined,
            compareVars: comparePair,
            linkVars: Array.isArray(s.visualCue.linkVars)
              ? s.visualCue.linkVars.map(String)
              : null,
            comparison: compObj,
          };
        }

        // Synthesize comparison visualCue if the line performs == / === / != / .equals() / < / > on known variables
        if (!normalizedVisualCue?.comparison && normalizedSnapshots && normalizedSnapshots.length > 0) {
          const snapByName = new Map(normalizedSnapshots.map((sn) => [sn.name, sn]));
          const equalsCallMatch = rawLineText.match(/\b([A-Za-z_$][\w$]*)\.equals\(\s*([A-Za-z_$][\w$]*)\s*\)/);
          const binOpMatch = rawLineText.match(/\b([A-Za-z_$][\w$]*)\s*(===|==|!==|!=|<=|>=|<|>)\s*([A-Za-z_$][\w$]*)\b/);

          if (equalsCallMatch && snapByName.has(equalsCallMatch[1]) && snapByName.has(equalsCallMatch[2])) {
            const left = snapByName.get(equalsCallMatch[1])!;
            const right = snapByName.get(equalsCallMatch[2])!;
            const res = JSON.stringify(left.value) === JSON.stringify(right.value);
            normalizedVisualCue = {
              ...(normalizedVisualCue || {}),
              mode: 'compare',
              compareVars: [left.name, right.name],
              highlightVars: [left.name, right.name],
              comparison: {
                leftVar: left.name,
                rightVar: right.name,
                leftLabel: `value(${String(left.value)})`,
                rightLabel: `value(${String(right.value)})`,
                operator: '.equals()',
                result: res,
                reason: normalizedVisualCue?.comparison?.reason || null,
              },
            };
          } else if (binOpMatch && snapByName.has(binOpMatch[1]) && snapByName.has(binOpMatch[3])) {
            const left = snapByName.get(binOpMatch[1])!;
            const op = binOpMatch[2];
            const right = snapByName.get(binOpMatch[3])!;
            const useRefCompare =
              (op === '==' || op === '===') &&
              Boolean(left.referenceId && right.referenceId) &&
              (fallbackLang === 'java' || typeof left.value === 'object');
            const leftLbl = useRefCompare
              ? String(left.referenceId)
              : `${left.name}(${String(left.value)})`;
            const rightLbl = useRefCompare
              ? String(right.referenceId)
              : `${right.name}(${String(right.value)})`;
            let res = false;
            if (op === '==' || op === '===') {
              res = useRefCompare
                ? left.referenceId === right.referenceId
                : left.value === right.value;
            } else if (op === '!=' || op === '!==') {
              res = useRefCompare
                ? left.referenceId !== right.referenceId
                : left.value !== right.value;
            } else if (op === '<') res = Number(left.value) < Number(right.value);
            else if (op === '>') res = Number(left.value) > Number(right.value);
            else if (op === '<=') res = Number(left.value) <= Number(right.value);
            else if (op === '>=') res = Number(left.value) >= Number(right.value);

            normalizedVisualCue = {
              ...(normalizedVisualCue || {}),
              mode: 'compare',
              compareVars: [left.name, right.name],
              highlightVars: [left.name, right.name],
              comparison: {
                leftVar: left.name,
                rightVar: right.name,
                leftLabel: leftLbl,
                rightLabel: rightLbl,
                operator: op,
                result: res,
                reason: normalizedVisualCue?.comparison?.reason || null,
              },
            };
          }
        }

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
          structure: normalizedStructure,
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
          whatHappened: String(s.explanation || ''),
          whyAndLogic: String(s.why || ''),
          variableSnapshots: normalizedSnapshots,
          visualCue: normalizedVisualCue,
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

  const stepPreview =
    params.language === 'javascript'
      ? (sandboxResult.recordedSteps || [])
          .slice(0, 45)
          .map((st, i) => {
            const userLine =
              prep.injectedPrefixLines > 0
                ? Math.max(1, st.line - prep.injectedPrefixLines)
                : st.line;
            return `  Step ${i + 1}: Line ${userLine} [${st.actionType}] (${st.codeSnippet}) -> memoryState=${JSON.stringify(
              st.variables
            )}, delta=${JSON.stringify(st.memoryDelta)}${
              st.consoleOutput ? `, consoleOutput=${JSON.stringify(st.consoleOutput)}` : ''
            }`;
          })
          .join('\n')
      : '';

  const groundTruthContext = [
    `- Real Compiler Status: Succeeded without errors`,
    `- Real Runtime Exit Code: ${realExec.exitCode}`,
    `- Real Runtime Execution Timed Out: ${realExec.timedOut}`,
    `- Real Runtime Error: ${realExec.runtimeError || 'None'}`,
    `- Real Runtime Final Stdout: ${JSON.stringify(cleanedStdout)}`,
    `- Real Runtime Final Variables: ${JSON.stringify(sandboxResult.finalVariables)}`,
    stepPreview ? `- Real Runtime Recorded Step Sequence:\n${stepPreview}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const DEPRECATED_MODEL_PREFIXES = ['gemini-2.5-', 'gemini-2.0-', 'gemini-1.5-', 'gemini-1.0-'];
  const configuredModel = process.env.GEMINI_MODEL?.trim();
  const isDeprecated =
    configuredModel &&
    DEPRECATED_MODEL_PREFIXES.some((prefix) => configuredModel.startsWith(prefix));
  const primaryModel = !configuredModel || isDeprecated ? 'gemini-3.8-flash' : configuredModel;
  const rawCandidateModels = [
    primaryModel,
    'gemini-3.8-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-4-argon',
  ].filter((v, i, a) => a.indexOf(v) === i);

  const nowMs = Date.now();
  const activeModels = rawCandidateModels.filter((m) => (modelCooldownUntil.get(m) ?? 0) <= nowMs);
  const candidateModels = activeModels.length > 0 ? activeModels : rawCandidateModels;

  const baseUserPrompt = buildUserTracePrompt({
    ...params,
    groundTruthContext: groundTruthContext || undefined,
  });

  let lastValidationError = '';
  let abortAllModels = false;
  const overallDeadline = Date.now() + 24000;

  for (const modelName of candidateModels) {
    if (abortAllModels || Date.now() >= overallDeadline) break;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const remainingMs = overallDeadline - Date.now();
      if (remainingMs < 1500) break;
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
            abortSignal: AbortSignal.timeout(Math.min(20000, remainingMs)),
          },
        });

        const rawText = (response.text ?? '{}').trim();
        const parsedJson = JSON.parse(rawText);
        const normalized = normalizeGeminiRawOutput(
          parsedJson,
          params.language,
          params.code
        );

        // Align finalOutput with ground-truth runtime stdout while preserving Gemini's
        // authentic step-by-step trace, variable transitions, analogyType, and 3D structures.
        if (!normalized.hasError) {
          if (cleanedStdout !== '') {
            normalized.finalOutput = cleanedStdout;
          }
          if (normalized.programSummary) {
            normalized.programSummary.totalExecutionSteps = Array.isArray(normalized.steps)
              ? normalized.steps.length
              : 0;
            normalized.programSummary.finalOutput = normalized.finalOutput;
          }
        }

        if (!normalized.hasError && (!Array.isArray(normalized.steps) || normalized.steps.length === 0)) {
          lastValidationError = 'Generated trace had 0 steps for valid code.';
          continue;
        }

        const validated = ExecutionTraceSchema.safeParse(normalized);

        if (validated.success) {
          const finalTrace: ExecutionTrace = validated.data as unknown as ExecutionTrace;
          if (!finalTrace.hasError) {
            traceCache.set(hash, { trace: finalTrace, createdAt: Date.now() });
          }
          return formatResult(finalTrace, false, combinedDiagnostics);
        }

        lastValidationError = validated.error.message;
      } catch (err: any) {
        lastValidationError = String(err?.message || err);
        console.warn(`[geminiTraceService] Model ${modelName} attempt ${attempt} failed:`, lastValidationError);
        if (
          lastValidationError.includes('429') ||
          lastValidationError.includes('RESOURCE_EXHAUSTED') ||
          lastValidationError.includes('404') ||
          lastValidationError.includes('NOT_FOUND')
        ) {
          // Put quota-exhausted or unavailable models on a 5-minute cooldown so subsequent runs skip straight to working fallback models
          modelCooldownUntil.set(modelName, Date.now() + 5 * 60 * 1000);
        }
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

  const fallbackResult = formatResult(deterministicTrace, false, combinedDiagnostics);
  fallbackResult.apiNotice = {
    code: 'GEMINI_TEMPORARY_FALLBACK',
    message_bn:
      'Gemini AI সাময়িকভাবে ব্যস্ত বা অনুপলব্ধ থাকায় ডিটারমিনিস্টিক রানটাইম ট্রেস দেখানো হচ্ছে। কিছুক্ষণ পর আবার রান করুন।',
    message_en:
      'Gemini AI was temporarily unavailable, so the deterministic runtime trace is shown. Please run again shortly.',
  };
  return fallbackResult;
}

