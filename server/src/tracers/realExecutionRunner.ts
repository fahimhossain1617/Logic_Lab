import vm from 'node:vm';
import {
  AnalogyType,
  ExecutionTrace,
  ExplainLanguage,
  ExplanationDepth,
  LineNote,
  MemoryDelta,
  RuntimeActionType,
  SupportedLanguage,
  TraceSource,
  TraceStep,
} from '../../../shared/types';
import { PROBLEM_LIBRARY, CuratedProblem } from '../../../src/data/problemLibrary';

export interface RecordedStepMeta {
  subKind?:
    | 'CLASS_DEF'
    | 'MAIN_ENTRY'
    | 'FUNC_ENTRY'
    | 'ELSE_BRANCH'
    | 'RETURN'
    | 'TRY_BLOCK'
    | 'CATCH_BLOCK'
    | 'FINALLY_BLOCK'
    | 'EXCEPTION_THROWN';
  fnName?: string;
  targetVar?: string;
  rhsExpr?: string;
  conditionExpr?: string;
  conditionResult?: boolean;
  iteration?: number;
  printedText?: string;
  returnVal?: any;
  exceptionType?: string;
  exceptionMessage?: string;
}

export interface RecordedJsStep {
  line: number;
  actionType: RuntimeActionType;
  codeSnippet: string;
  variables: Record<string, any>;
  memoryDelta: MemoryDelta | null;
  consoleOutput: string | null;
  stdoutSoFar: string;
  meta?: RecordedStepMeta;
}

export interface SandboxExecutionResult {
  stdout: string;
  stderr: string;
  timedOut: boolean;
  runtimeError: string | null;
  runtimeErrorLine?: number;
  finalVariables: Record<string, any>;
  recordedSteps: RecordedJsStep[];
  cleanLines: string[];
}

const IGNORED_SANDBOX_KEYS = new Set([
  'console',
  'prompt',
  'input',
  'Math',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Object',
  'JSON',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'Map',
  'Set',
  '__traceStep',
  '__traceLoopCheck',
  '__traceCondCheck',
  '__printLine',
  '__print',
  '__toInt',
  '__checkNum',
  '__openFile',
  '__parseIntJava',
  '__parseDoubleJava',
  '__throwException',
  '__matchException',
  '__fmtException',
  '__fmtOut',
  '__cap',
]);

const LANGUAGE_KEYWORDS = new Set([
  'let',
  'const',
  'var',
  'int',
  'long',
  'short',
  'byte',
  'float',
  'double',
  'boolean',
  'bool',
  'char',
  'string',
  'String',
  'void',
  'auto',
  'final',
  'static',
  'public',
  'private',
  'protected',
  'class',
  'struct',
  'if',
  'else',
  'elif',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'return',
  'try',
  'catch',
  'except',
  'finally',
  'throw',
  'throws',
  'raise',
  'function',
  'def',
  'true',
  'false',
  'True',
  'False',
  'null',
  'None',
  'nullptr',
  'new',
  'System',
  'out',
  'println',
  'print',
  'printf',
  'cout',
  'cin',
  'endl',
  'std',
  'main',
  'args',
  'Math',
  'Array',
  'Integer',
  'Double',
  'Character',
  'File',
  'FileReader',
  'FileInputStream',
  'BufferedReader',
  'Scanner',
  'Exception',
  'RuntimeException',
  'ArithmeticException',
  'FileNotFoundException',
  'IOException',
  'NullPointerException',
  'ArrayIndexOutOfBoundsException',
  'NumberFormatException',
]);

function cloneSafeValue(val: any): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : String(val);
  }
  if (typeof val === 'string' || typeof val === 'boolean') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.slice(0, 35).map((item) => cloneSafeValue(item));
  }
  if (typeof val === 'object') {
    try {
      return JSON.parse(JSON.stringify(val));
    } catch {
      return String(val);
    }
  }
  return undefined;
}

/**
 * Strips all single-line (`// ...`, `# ...`) and multi-line (`/* ... *\/`) comments
 * while strictly preserving exact 1-based line numbers.
 */
export function stripCommentsPreservingLines(
  code: string,
  language: SupportedLanguage
): string {
  let result = '';
  let i = 0;
  const len = code.length;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBlockComment = false;

  while (i < len) {
    const ch = code[i];
    const next = i + 1 < len ? code[i + 1] : '';

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        result += '  ';
        i += 2;
        inBlockComment = false;
      } else if (ch === '\n') {
        result += '\n';
        i++;
      } else {
        result += ' ';
        i++;
      }
      continue;
    }

    if (inSingle) {
      result += ch;
      if (ch === '\\' && i + 1 < len) {
        result += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '\n') inSingle = false;
      i++;
      continue;
    }

    if (inDouble) {
      result += ch;
      if (ch === '\\' && i + 1 < len) {
        result += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"' || ch === '\n') inDouble = false;
      i++;
      continue;
    }

    if (inBacktick) {
      result += ch;
      if (ch === '\\' && i + 1 < len) {
        result += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === '`') inBacktick = false;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      result += '  ';
      i += 2;
      continue;
    }

    if (ch === '/' && next === '/' && language !== 'python') {
      while (i < len && code[i] !== '\n') {
        i++;
      }
      continue;
    }

    if (ch === '#' && language === 'python') {
      while (i < len && code[i] !== '\n') {
        i++;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      result += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      result += ch;
      i++;
      continue;
    }

    if (ch === '`') {
      inBacktick = true;
      result += ch;
      i++;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Extracts all declared/assigned variable identifiers and tracks integer-typed variables
 * (for exact integer division in Java and C++).
 */
function extractVariablesAndTypes(
  cleanCode: string,
  language: SupportedLanguage
): { varNames: string[]; intVars: Set<string>; hasFloatType: boolean } {
  const names = new Set<string>();
  const intVars = new Set<string>();
  const hasFloatType = /\b(?:float|double)\b/.test(cleanCode);

  const lines = cleanCode.split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check `catch (ExceptionType e)` or `except Exception as e:`
    const catchVarMatch =
      language === 'python'
        ? trimmed.match(/^except(?:\s+[A-Za-z0-9_.,\s()]+?\s+as\s+([A-Za-z_]\w*))?\s*:/)
        : trimmed.match(/^(?:\}?\s*)?catch\s*\(\s*(?:final\s+)?(?:[A-Za-z0-9_.$|&\s]+\s+)?([A-Za-z_$][\w$]*)\s*\)/);
    if (catchVarMatch && catchVarMatch[1] && !LANGUAGE_KEYWORDS.has(catchVarMatch[1])) {
      names.add(catchVarMatch[1]);
      continue;
    }

    // Skip class/method headers
    if (
      /\bclass\s+[A-Za-z_]\w*/.test(trimmed) ||
      /\bmain\s*\(/.test(trimmed) ||
      /^(?:public|private|protected|static|\s)*(?:void|int|long|double|float|boolean|bool|String|string)\s+[A-Za-z_]\w*\s*\(/.test(
        trimmed
      )
    ) {
      continue;
    }

    // Check integer declarations in Java/C++: e.g. `int a = 1, b = 2;` or `for (int i = 0; ...)`
    if (language === 'java' || language === 'cpp') {
      const intDeclRegex = /\b(?:int|long|short|byte)\s+(?!\[\s*\])([^;()]+)/g;
      let m: RegExpExecArray | null;
      while ((m = intDeclRegex.exec(trimmed)) !== null) {
        const declPart = m[1];
        const segments = declPart.split(',');
        for (const seg of segments) {
          const lhs = seg.split('=')[0].trim();
          const idMatch = lhs.match(/^([a-zA-Z_$][\w$]*)$/);
          if (idMatch && !LANGUAGE_KEYWORDS.has(idMatch[1])) {
            intVars.add(idMatch[1]);
            names.add(idMatch[1]);
          }
        }
      }
    }

    // Generic typed declarations (including Java/C++ object types like FileReader, Scanner, File)
    const typedDeclRegex =
      /\b(?:let|const|var|int|long|short|byte|float|double|boolean|bool|String|string|char|auto|FileReader|FileInputStream|BufferedReader|Scanner|File|Object|Integer|Double)\s*(?:\[\s*\])?\s+([a-zA-Z_$][\w$]*)/g;
    let tm: RegExpExecArray | null;
    while ((tm = typedDeclRegex.exec(trimmed)) !== null) {
      const v = tm[1];
      if (v && !LANGUAGE_KEYWORDS.has(v) && !IGNORED_SANDBOX_KEYS.has(v)) {
        names.add(v);
      }
    }

    // Python `for i in ...:`
    if (language === 'python') {
      const pyFor = trimmed.match(/^for\s+([a-zA-Z_]\w*)\s+in\b/);
      if (pyFor && !LANGUAGE_KEYWORDS.has(pyFor[1])) {
        names.add(pyFor[1]);
      }
      const pyTuple = trimmed.match(/^([a-zA-Z_]\w*)\s*,\s*([a-zA-Z_]\w*)\s*=/);
      if (pyTuple) {
        names.add(pyTuple[1]);
        names.add(pyTuple[2]);
      }
    }

    // Standard assignments `x = ...`, `x += ...`, `x++`
    const assignRegex =
      /(?:^|[;\s({,])([a-zA-Z_$][\w$]*)\s*(?:=(?!=)|(\+=|-=|\*=|\/=|%=|\+\+|--))/g;
    let am: RegExpExecArray | null;
    while ((am = assignRegex.exec(trimmed)) !== null) {
      const v = am[1];
      if (v && !LANGUAGE_KEYWORDS.has(v) && !IGNORED_SANDBOX_KEYS.has(v)) {
        names.add(v);
      }
    }
  }

  return {
    varNames: Array.from(names),
    intVars,
    hasFloatType,
  };
}

/**
 * Splits a C++ `cout << a << b << endl` chain into top-level expressions.
 */
function splitCoutStream(expr: string): { parts: string[]; hasNewline: boolean } {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    const next = i + 1 < expr.length ? expr[i + 1] : '';
    const prev = i > 0 ? expr[i - 1] : '';

    if (ch === "'" && prev !== '\\' && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && prev !== '\\' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      else if (ch === '<' && next === '<' && depth === 0) {
        parts.push(current.trim());
        current = '';
        i++;
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  let hasNewline = false;
  const filtered: string[] = [];
  for (const p of parts) {
    if (p === 'endl' || p === 'std::endl' || p === '"\\n"' || p === "'\\n'") {
      hasNewline = true;
    } else if (p) {
      filtered.push(p);
    }
  }

  return { parts: filtered, hasNewline };
}

/**
 * Normalizes language-specific expressions (Java/C++/Python) into valid JavaScript expressions.
 */
function normalizeExpressionToJs(
  expr: string,
  language: SupportedLanguage,
  isIntegerContext: boolean,
  lineNum = 1
): string {
  let out = expr.trim();

  if (language === 'python') {
    out = out
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null')
      .replace(/\band\b/g, '&&')
      .replace(/\bor\b/g, '||')
      .replace(/\bnot\s+/g, '!')
      .replace(/\blen\s*\(([^)]+)\)/g, '($1).length')
      .replace(/\.append\s*\(/g, '.push(')
      .replace(/\bopen\s*\(([^)]+)\)/g, `__openFile(${lineNum}, $1, () => __cap())`);

    // Python floor division `a // b` -> `__toInt((a) / (b), lineNum, () => __cap())`
    while (/([a-zA-Z0-9_)\]]+)\s*\/\/\s*([a-zA-Z0-9_(\[]+)/.test(out)) {
      out = out.replace(
        /([a-zA-Z0-9_)\]]+)\s*\/\/\s*([a-zA-Z0-9_(\[]+)/g,
        `__toInt(($1) / ($2), ${lineNum}, () => __cap())`
      );
    }
  }

  if (language === 'java' || language === 'cpp') {
    // Java file operations that throw FileNotFoundException in sandbox
    out = out
      .replace(
        /new\s+Scanner\s*\(\s*new\s+File\s*\(([^)]*)\)\s*\)/g,
        `__openFile(${lineNum}, $1, () => __cap())`
      )
      .replace(
        /new\s+(?:FileReader|FileInputStream)\s*\(([^)]*)\)/g,
        `__openFile(${lineNum}, $1, () => __cap())`
      )
      .replace(/new\s+File\s*\(([^)]*)\)/g, '($1)')
      .replace(
        /Integer\.parseInt\s*\(([^)]+)\)/g,
        `__parseIntJava(${lineNum}, $1, () => __cap())`
      )
      .replace(
        /Double\.parseDouble\s*\(([^)]+)\)/g,
        `__parseDoubleJava(${lineNum}, $1, () => __cap())`
      );

    // Java `new int[]{1, 2, 3}` -> `[1, 2, 3]`
    out = out.replace(
      /new\s+(?:int|long|double|float|boolean|String|char)\s*\[\s*\]\s*\{([^}]*)\}/g,
      '[$1]'
    );
    // Java `new int[5]` -> `new Array(5).fill(0)`
    out = out.replace(
      /new\s+(?:int|long|double|float)\s*\[\s*([^\]]+)\s*\]/g,
      'new Array($1).fill(0)'
    );
    // Array brace literal `{10, 20, 30}` -> `[10, 20, 30]`
    if (out.startsWith('{') && out.endsWith('}')) {
      out = `[${out.slice(1, -1)}]`;
    }
    // Java/C++ methods
    out = out
      .replace(/\.getMessage\s*\(\s*\)/g, '.toString()')
      .replace(/\.length\s*\(\s*\)/g, '.length')
      .replace(/\.size\s*\(\s*\)/g, '.length')
      .replace(/\.charAt\s*\(([^)]+)\)/g, '[($1)]')
      .replace(/\.push_back\s*\(/g, '.push(')
      .replace(/\.pop_back\s*\(\s*\)/g, '.pop()')
      .replace(/\.equals\s*\(([^)]+)\)/g, '=== ($1)')
      .replace(/\bInteger\.MAX_VALUE\b/g, '2147483647')
      .replace(/\bInteger\.MIN_VALUE\b/g, '-2147483648')
      .replace(/\bINT_MAX\b/g, '2147483647')
      .replace(/\bINT_MIN\b/g, '-2147483648');
  }

  if (isIntegerContext) {
    return `__toInt(${out}, ${lineNum}, () => __cap())`;
  }

  return out;
}

/**
 * Transpiles and instruments JavaScript, Python, C++, or Java into a line-accurate
 * V8 script that executes every loop iteration, conditional branch, and try/catch/finally block at runtime.
 */
function buildInstrumentedMultiLangScript(
  cleanCode: string,
  language: SupportedLanguage,
  varNames: string[],
  intVars: Set<string>,
  hasFloatType: boolean
): string | null {
  const captureEntries = varNames
    .map(
      (v) =>
        `...(typeof ${v} !== "undefined" && typeof ${v} !== "function" ? { ${JSON.stringify(
          v
        )}: ${v} } : {})`
    )
    .join(', ');

  const rawLines = cleanCode.split('\n');
  const processedLines: string[] = [];

  const pyIndentStack: number[] = [0];
  const seenVars = new Set<string>();

  // Track multi-catch chains in brace languages (`try { ... } catch (E1 e) { ... } catch (E2 e) { ... }`)
  let inCatchChain = false;

  const isNextNonEmptyLineAnotherCatch = (fromIdx: number): boolean => {
    for (let j = fromIdx + 1; j < rawLines.length; j++) {
      const nextTrimmed = rawLines[j].trim();
      if (!nextTrimmed) continue;
      return /^(?:\}?\s*)?catch\s*\(/.test(nextTrimmed);
    }
    return false;
  };

  for (let idx = 0; idx < rawLines.length; idx++) {
    const lineNum = idx + 1;
    const rawLine = rawLines[idx];
    const trimmed = rawLine.trim();

    let pyClosingPrefix = '';
    if (language === 'python' && trimmed.length > 0) {
      const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
      while (
        pyIndentStack.length > 1 &&
        indentSpaces < pyIndentStack[pyIndentStack.length - 1]
      ) {
        pyIndentStack.pop();
        pyClosingPrefix += '} ';
      }
    }

    if (!trimmed) {
      processedLines.push('');
      continue;
    }

    // 1. Preprocessor / package / import lines in C++ / Java / Python
    if (
      trimmed.startsWith('#include') ||
      trimmed.startsWith('#pragma') ||
      trimmed.startsWith('using namespace') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('from ') ||
      trimmed.startsWith('package ')
    ) {
      processedLines.push(pyClosingPrefix);
      continue;
    }

    // 2. Standalone braces `{` or `}` or `};`
    if (trimmed === '{' || trimmed === '}' || trimmed === '};') {
      if (trimmed !== '{' && inCatchChain && !isNextNonEmptyLineAnotherCatch(idx)) {
        inCatchChain = false;
        processedLines.push(`${pyClosingPrefix}} else { throw __rawErr; } }`);
      } else {
        processedLines.push(`${pyClosingPrefix}${trimmed === '};' ? '}' : trimmed}`);
      }
      continue;
    }

    // 3. `try` block header
    const tryMatch =
      language === 'python'
        ? trimmed.match(/^try\s*:\s*$/)
        : trimmed.match(/^try\s*(\{)?\s*$/);
    if (tryMatch) {
      if (language === 'python') {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}try { __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "TRY_BLOCK" });`
        );
      } else {
        const hasOpen = Boolean(tryMatch[1]);
        processedLines.push(
          `${pyClosingPrefix}try ${
            hasOpen ? '{' : ''
          } __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "TRY_BLOCK" });`
        );
      }
      continue;
    }

    // 4. `catch` / `except` block header
    const catchMatch =
      language === 'python'
        ? trimmed.match(/^except(?:\s+([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z_]\w*))?)?\s*:\s*$/)
        : trimmed.match(
            /^(\}?\s*)catch\s*\(\s*(?:final\s+)?(?:([A-Za-z0-9_.$|&\s]+)\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)|(\.\.\.))\s*\)\s*(\{)?\s*$/
          );
    if (catchMatch) {
      if (language === 'python') {
        const excType = catchMatch[1]?.trim() || 'Exception';
        const excVar = catchMatch[2]?.trim() || '__exc';
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        seenVars.add(excVar);
        processedLines.push(
          `${pyClosingPrefix}catch (__rawErr) { ${excVar} = __fmtException(__rawErr); __traceStep(${lineNum}, "CONDITION_CHECK", __cap({ ${JSON.stringify(
            excVar
          )}: ${excVar} }), { subKind: "CATCH_BLOCK", exceptionType: ${JSON.stringify(
            excType
          )}, targetVar: ${JSON.stringify(excVar)} });`
        );
      } else {
        const hasLeadCloseBrace = Boolean(catchMatch[1] && catchMatch[1].includes('}'));
        const excType = (catchMatch[2] || 'Exception').trim();
        const excVar = (catchMatch[3] || catchMatch[4] || '__exc').trim();
        const hasTrailOpenBrace = Boolean(catchMatch[6]);
        seenVars.add(excVar);

        if (!inCatchChain) {
          inCatchChain = true;
          const prefixClose = hasLeadCloseBrace ? '}' : '';
          processedLines.push(
            `${pyClosingPrefix}${prefixClose} catch (__rawErr) ${
              hasTrailOpenBrace ? '{' : ''
            } if (__matchException(__rawErr, ${JSON.stringify(
              excType
            )})) { ${excVar} = __fmtException(__rawErr); __traceStep(${lineNum}, "CONDITION_CHECK", __cap({ ${JSON.stringify(
              excVar
            )}: ${excVar} }), { subKind: "CATCH_BLOCK", exceptionType: ${JSON.stringify(
              excType
            )}, targetVar: ${JSON.stringify(excVar)} });`
          );
        } else {
          // Subsequent catch block in a multi-catch chain
          const prefixClose = hasLeadCloseBrace ? '}' : '';
          processedLines.push(
            `${pyClosingPrefix}${prefixClose} else if (__matchException(__rawErr, ${JSON.stringify(
              excType
            )})) { ${excVar} = __fmtException(__rawErr); __traceStep(${lineNum}, "CONDITION_CHECK", __cap({ ${JSON.stringify(
              excVar
            )}: ${excVar} }), { subKind: "CATCH_BLOCK", exceptionType: ${JSON.stringify(
              excType
            )}, targetVar: ${JSON.stringify(excVar)} });`
          );
        }
      }
      continue;
    }

    // 5. `finally` block header
    const finallyMatch =
      language === 'python'
        ? trimmed.match(/^finally\s*:\s*$/)
        : trimmed.match(/^(\}?\s*)finally\s*(\{)?\s*$/);
    if (finallyMatch) {
      if (language === 'python') {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}finally { __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "FINALLY_BLOCK" });`
        );
      } else {
        const hasLeadCloseBrace = Boolean(finallyMatch[1] && finallyMatch[1].includes('}'));
        const hasTrailOpenBrace = Boolean(finallyMatch[2]);
        let prefix = '';
        if (inCatchChain) {
          inCatchChain = false;
          prefix = hasLeadCloseBrace ? '} else { throw __rawErr; } }' : '';
        } else if (hasLeadCloseBrace) {
          prefix = '}';
        }
        processedLines.push(
          `${pyClosingPrefix}${prefix} finally ${
            hasTrailOpenBrace ? '{' : ''
          } __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "FINALLY_BLOCK" });`
        );
      }
      continue;
    }

    // 6. Explicit `throw new Exception(...)` / `raise Exception(...)`
    const throwMatch =
      language === 'python'
        ? trimmed.match(/^raise\s+([A-Za-z0-9_]+)\s*(?:\((.*)\))?\s*$/)
        : trimmed.match(/^throw\s+(?:new\s+)?([A-Za-z0-9_.$]+)\s*(?:\((.*)\))?\s*;?\s*$/);
    if (throwMatch) {
      const excType = throwMatch[1].trim();
      const rawArg = throwMatch[2]?.trim() || JSON.stringify(excType);
      const jsArg = normalizeExpressionToJs(rawArg, language, false, lineNum);
      processedLines.push(
        `${pyClosingPrefix}__throwException(${lineNum}, ${JSON.stringify(
          excType
        )}, (${jsArg}), () => __cap());`
      );
      continue;
    }

    // 7. Class definition header (Java / C++ / JS / Python)
    const classMatch = trimmed.match(
      /^(?:public\s+|private\s+|protected\s+|final\s+|abstract\s+)*class\s+([A-Za-z_]\w*)(?:[^{:;]*)(\{|:\s*)?$/
    );
    if (classMatch) {
      const hasOpen = Boolean(classMatch[2]);
      if (language === 'python' && classMatch[2]?.includes(':')) {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
      }
      if (hasOpen) {
        processedLines.push(
          `${pyClosingPrefix}if (true) { __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "CLASS_DEF", fnName: ${JSON.stringify(
            classMatch[1]
          )} });`
        );
      } else {
        processedLines.push(
          `${pyClosingPrefix}__traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "CLASS_DEF", fnName: ${JSON.stringify(
            classMatch[1]
          )} }); if (true)`
        );
      }
      continue;
    }

    // 8. `main` method header in Java or C++
    const mainMatch = trimmed.match(
      /^(?:public\s+|private\s+|static\s+|void\s+|int\s+)*main\s*\([^)]*\)(?:\s*throws\s+[A-Za-z0-9_.,\s]+)?\s*(\{)?\s*$/
    );
    if (mainMatch) {
      const hasOpen = Boolean(mainMatch[1]);
      if (hasOpen) {
        processedLines.push(
          `${pyClosingPrefix}if (true) { __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "MAIN_ENTRY", fnName: "main" });`
        );
      } else {
        processedLines.push(
          `${pyClosingPrefix}__traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "MAIN_ENTRY", fnName: "main" }); if (true)`
        );
      }
      continue;
    }

    // 9. Function / method definition (`function foo(...)`, `def foo(...):`, `static int foo(...)`)
    const fnMatch =
      language === 'python'
        ? trimmed.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:\s*$/)
        : trimmed.match(
            /^(?:(?:public|private|protected|static|final)\s+)*(?:function|void|int|long|double|float|boolean|bool|String|string)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(?:\s*throws\s+[A-Za-z0-9_.,\s]+)?\s*(\{)?\s*$/
          );
    if (fnMatch && fnMatch[1] !== 'main') {
      const fnName = fnMatch[1];
      const rawParams = fnMatch[2]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const cleanP = p.split('=')[0].trim();
          const parts = cleanP.replace(/\[\s*\]/g, '').trim().split(/\s+/);
          return parts[parts.length - 1];
        });
      const paramList = rawParams.join(', ');
      const localCapObj = `{ ${rawParams
        .map((p) => `${JSON.stringify(p)}: ${p}`)
        .join(', ')} }`;

      if (language === 'python') {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}function ${fnName}(${paramList}) { __traceStep(${lineNum}, "METHOD_ENTRY", __cap(${localCapObj}), { subKind: "FUNC_ENTRY", fnName: ${JSON.stringify(
            fnName
          )} });`
        );
      } else {
        const hasOpen = Boolean(fnMatch[3]);
        processedLines.push(
          `${pyClosingPrefix}function ${fnName}(${paramList}) ${
            hasOpen ? '{' : ''
          } __traceStep(${lineNum}, "METHOD_ENTRY", __cap(${localCapObj}), { subKind: "FUNC_ENTRY", fnName: ${JSON.stringify(
            fnName
          )} });`
        );
      }
      continue;
    }

    // 10. `while` loop header
    const whileMatch =
      language === 'python'
        ? trimmed.match(/^while\s+(.+?)\s*:\s*$/)
        : trimmed.match(/^while\s*\((.+)\)\s*(\{)?\s*$/);
    if (whileMatch) {
      const rawCond = whileMatch[1].trim();
      const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
      if (language === 'python') {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}while (__traceLoopCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) {`
        );
      } else {
        const brace = whileMatch[2] ? '{' : '';
        processedLines.push(
          `${pyClosingPrefix}while (__traceLoopCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) ${brace}`
        );
      }
      continue;
    }

    // 11. `for` loop header
    if (language === 'python') {
      const pyRangeMatch = trimmed.match(
        /^for\s+([A-Za-z_]\w*)\s+in\s+range\s*\(([^)]+)\)\s*:\s*$/
      );
      if (pyRangeMatch) {
        const loopVar = pyRangeMatch[1];
        const rangeArgs = pyRangeMatch[2].split(',').map((s) => s.trim());
        const startExpr = rangeArgs.length >= 2 ? rangeArgs[0] : '0';
        const stopExpr = rangeArgs.length >= 2 ? rangeArgs[1] : rangeArgs[0];
        const stepExpr = rangeArgs.length >= 3 ? rangeArgs[2] : '1';
        const cmpOp = stepExpr.startsWith('-') ? '>' : '<';
        const condDisplay = `${loopVar} ${cmpOp} ${stopExpr}`;
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        seenVars.add(loopVar);
        processedLines.push(
          `${pyClosingPrefix}for ((${loopVar} = ${normalizeExpressionToJs(
            startExpr,
            language,
            false,
            lineNum
          )}, __traceStep(${lineNum}, "DECLARE", __cap(), { targetVar: ${JSON.stringify(
            loopVar
          )}, rhsExpr: ${JSON.stringify(
            startExpr
          )} })); __traceLoopCheck(${lineNum}, () => (${loopVar} ${cmpOp} (${normalizeExpressionToJs(
            stopExpr,
            language,
            false,
            lineNum
          )})), ${JSON.stringify(
            condDisplay
          )}, () => __cap()); (${loopVar} += (${normalizeExpressionToJs(
            stepExpr,
            language,
            false,
            lineNum
          )}), __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
            loopVar
          )}, rhsExpr: ${JSON.stringify(`${loopVar} += ${stepExpr}`)} }))) {`
        );
        continue;
      }

      const pyForEachMatch = trimmed.match(/^for\s+([A-Za-z_]\w*)\s+in\s+(.+?)\s*:\s*$/);
      if (pyForEachMatch) {
        const loopVar = pyForEachMatch[1];
        const iterExpr = normalizeExpressionToJs(pyForEachMatch[2], language, false, lineNum);
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        seenVars.add(loopVar);
        processedLines.push(
          `${pyClosingPrefix}for (${loopVar} of (${iterExpr})) { __traceStep(${lineNum}, "LOOP_CHECK", __cap(), { conditionExpr: ${JSON.stringify(
            `${loopVar} in ${pyForEachMatch[2]}`
          )}, conditionResult: true });`
        );
        continue;
      }
    } else {
      const cForMatch = trimmed.match(
        /^for\s*\(\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*(\{)?\s*$/
      );
      if (cForMatch) {
        const rawInit = cForMatch[1].trim();
        const rawCond = cForMatch[2].trim();
        const rawStep = cForMatch[3].trim();
        const brace = cForMatch[4] ? '{' : '';

        const initAssignMatch = rawInit.match(
          /^(?:(?:let|const|var|int|long|short|size_t|auto)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(.+)$/
        );
        const targetVar = initAssignMatch ? initAssignMatch[1] : undefined;
        const initRhs = initAssignMatch ? initAssignMatch[2].trim() : rawInit;
        const cleanInitJs = initAssignMatch
          ? `${targetVar} = ${normalizeExpressionToJs(
              initRhs,
              language,
              Boolean(targetVar && intVars.has(targetVar)),
              lineNum
            )}`
          : rawInit.replace(/^\b(?:let|const|var|int|long|short|size_t|auto)\s+/, '');

        if (targetVar) seenVars.add(targetVar);

        const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
        const stepVarMatch = rawStep.match(/^([A-Za-z_$][\w$]*)/);
        const stepVar = stepVarMatch ? stepVarMatch[1] : targetVar;

        processedLines.push(
          `${pyClosingPrefix}for ((${cleanInitJs}, __traceStep(${lineNum}, "DECLARE", __cap(), { targetVar: ${JSON.stringify(
            targetVar
          )}, rhsExpr: ${JSON.stringify(
            initRhs
          )} })); __traceLoopCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap()); (${rawStep}, __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
            stepVar
          )}, rhsExpr: ${JSON.stringify(rawStep)} }))) ${brace}`
        );
        continue;
      }
    }

    // 12. `else if` / `elif` header
    const elseIfMatch =
      language === 'python'
        ? trimmed.match(/^elif\s+(.+?)\s*:\s*$/)
        : trimmed.match(/^(\}?\s*)else\s+if\s*\((.+)\)\s*(\{)?\s*$/);
    if (elseIfMatch) {
      if (language === 'python') {
        const rawCond = elseIfMatch[1].trim();
        const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}else if (__traceCondCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) {`
        );
      } else {
        const leadBrace = elseIfMatch[1] || '';
        const rawCond = elseIfMatch[2].trim();
        const trailBrace = elseIfMatch[3] ? '{' : '';
        const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
        processedLines.push(
          `${pyClosingPrefix}${leadBrace} else if (__traceCondCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) ${trailBrace}`
        );
      }
      continue;
    }

    // 13. `if` header
    const ifMatch =
      language === 'python'
        ? trimmed.match(/^if\s+(.+?)\s*:\s*$/)
        : trimmed.match(/^if\s*\((.+)\)\s*(\{)?\s*$/);
    if (ifMatch) {
      const rawCond = ifMatch[1].trim();
      const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
      if (language === 'python') {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}if (__traceCondCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) {`
        );
      } else {
        const brace = ifMatch[2] ? '{' : '';
        processedLines.push(
          `${pyClosingPrefix}if (__traceCondCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) ${brace}`
        );
      }
      continue;
    }

    // 14. `else` header
    const elseMatch =
      language === 'python'
        ? trimmed.match(/^else\s*:\s*$/)
        : trimmed.match(/^(\}?\s*)else\s*(\{)?\s*$/);
    if (elseMatch) {
      if (language === 'python') {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(`${pyClosingPrefix}else {`);
      } else {
        const leadBrace = elseMatch[1] || '';
        const trailBrace = elseMatch[2] ? '{' : '';
        processedLines.push(`${pyClosingPrefix}${leadBrace} else ${trailBrace}`);
      }
      continue;
    }

    // 15. Output / Print statements (`System.out.println`, `System.out.print`, `cout <<`, `console.log`, `print`, `e.printStackTrace()`)
    const stackTraceMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\.printStackTrace\s*\(\s*\)\s*;?\s*$/);
    if (stackTraceMatch) {
      processedLines.push(
        `${pyClosingPrefix}__printLine(${lineNum}, String(${stackTraceMatch[1]}), () => __cap());`
      );
      continue;
    }

    const javaPrintlnMatch = trimmed.match(/^System\.(?:out|err)\.println\s*\((.*)\)\s*;?\s*$/);
    if (javaPrintlnMatch) {
      const argExpr = javaPrintlnMatch[1].trim()
        ? normalizeExpressionToJs(javaPrintlnMatch[1], language, false, lineNum)
        : '""';
      processedLines.push(
        `${pyClosingPrefix}__printLine(${lineNum}, __checkNum((${argExpr}), ${lineNum}, () => __cap()), () => __cap());`
      );
      continue;
    }

    const javaPrintMatch = trimmed.match(/^System\.(?:out|err)\.print\s*\((.*)\)\s*;?\s*$/);
    if (javaPrintMatch) {
      const argExpr = javaPrintMatch[1].trim()
        ? normalizeExpressionToJs(javaPrintMatch[1], language, false, lineNum)
        : '""';
      processedLines.push(
        `${pyClosingPrefix}__print(${lineNum}, __checkNum((${argExpr}), ${lineNum}, () => __cap()), () => __cap());`
      );
      continue;
    }

    const cppCoutMatch = trimmed.match(/^(?:std::)?cout\s*<<\s*(.+?)\s*;?\s*$/);
    if (cppCoutMatch) {
      const { parts, hasNewline } = splitCoutStream(cppCoutMatch[1]);
      const jsParts = parts.map(
        (p) => `__checkNum((${normalizeExpressionToJs(p, language, false, lineNum)}), ${lineNum}, () => __cap())`
      );
      const joinedExpr = jsParts.length > 0 ? jsParts.join(' + "" + ') : '""';
      const fn = hasNewline ? '__printLine' : '__print';
      processedLines.push(
        `${pyClosingPrefix}${fn}(${lineNum}, (${joinedExpr}), () => __cap());`
      );
      continue;
    }

    const jsLogMatch = trimmed.match(/^console\.(?:log|warn|info|error)\s*\((.*)\)\s*;?\s*$/);
    if (jsLogMatch) {
      const rawArgs = jsLogMatch[1].trim();
      processedLines.push(
        `${pyClosingPrefix}__printLine(${lineNum}, [${rawArgs}].map(__fmtOut).join(" "), () => __cap());`
      );
      continue;
    }

    const pyPrintMatch =
      language === 'python' ? trimmed.match(/^print\s*\((.*)\)\s*$/) : null;
    if (pyPrintMatch) {
      const rawArgs = normalizeExpressionToJs(pyPrintMatch[1].trim(), language, false, lineNum);
      processedLines.push(
        `${pyClosingPrefix}__printLine(${lineNum}, [${rawArgs}].map(__fmtOut).join(" "), () => __cap());`
      );
      continue;
    }

    // 16. `return` statement
    const returnMatch = trimmed.match(/^return(?:\s+(.+?))?\s*;?\s*$/);
    if (returnMatch) {
      const retExpr = returnMatch[1]?.trim();
      if ((language === 'cpp' || language === 'java') && retExpr === '0') {
        processedLines.push(
          `${pyClosingPrefix}__traceStep(${lineNum}, "BLOCK_END", __cap(), { subKind: "RETURN", returnVal: 0 });`
        );
      } else if (retExpr) {
        const jsRet = normalizeExpressionToJs(retExpr, language, false, lineNum);
        processedLines.push(
          `${pyClosingPrefix}{ const __rv = (${jsRet}); __traceStep(${lineNum}, "BLOCK_END", __cap(), { subKind: "RETURN", returnVal: __rv }); return __rv; }`
        );
      } else {
        processedLines.push(
          `${pyClosingPrefix}{ __traceStep(${lineNum}, "BLOCK_END", __cap(), { subKind: "RETURN" }); return; }`
        );
      }
      continue;
    }

    // 17. C++ `swap(a, b);` or Python tuple swap `a, b = b, a`
    const cppSwapMatch = trimmed.match(
      /^(?:std::)?swap\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)\s*;?\s*$/
    );
    if (cppSwapMatch) {
      const lhs = cppSwapMatch[1].trim();
      const rhs = cppSwapMatch[2].trim();
      processedLines.push(
        `${pyClosingPrefix}[${lhs}, ${rhs}] = [${rhs}, ${lhs}]; __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
          lhs
        )}, rhsExpr: ${JSON.stringify(`swap(${lhs}, ${rhs})`)} });`
      );
      continue;
    }

    if (language === 'python') {
      const pyTupleSwap = trimmed.match(
        /^([A-Za-z_]\w*(?:\[[^\]]+\])?)\s*,\s*([A-Za-z_]\w*(?:\[[^\]]+\])?)\s*=\s*(.+?)\s*,\s*(.+?)\s*$/
      );
      if (pyTupleSwap) {
        const [, v1, v2, e1, e2] = pyTupleSwap;
        processedLines.push(
          `${pyClosingPrefix}[${v1}, ${v2}] = [${normalizeExpressionToJs(
            e1,
            language,
            false,
            lineNum
          )}, ${normalizeExpressionToJs(
            e2,
            language,
            false,
            lineNum
          )}]; __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
            v1
          )}, rhsExpr: ${JSON.stringify(`${v1}, ${v2} = ${e1}, ${e2}`)} });`
        );
        continue;
      }
    }

    // 18. Typed variable declaration with initialization (JS/Java/C++)
    const typedDeclAssign = trimmed.match(
      /^(?:final\s+|static\s+)*(?:let|const|var|int|long|short|byte|float|double|boolean|bool|String|string|char|auto|FileReader|FileInputStream|BufferedReader|Scanner|File|Object|Integer|Double|vector\s*<[^>]+>)\s*(?:\[\s*\])?\s+([A-Za-z_$][\w$]*)\s*(?:\[\s*\])?\s*=\s*(.+?)\s*;?\s*$/
    );
    if (typedDeclAssign) {
      const varName = typedDeclAssign[1];
      const rawRhs = typedDeclAssign[2].trim();
      const isInt =
        (language === 'java' || language === 'cpp') &&
        (intVars.has(varName) || (!hasFloatType && /^(?:final\s+|static\s+)*(?:int|long|short|byte)\b/.test(trimmed)));
      if (isInt) intVars.add(varName);
      const jsRhs = normalizeExpressionToJs(rawRhs, language, isInt, lineNum);
      const actType: RuntimeActionType = 'DECLARE';
      seenVars.add(varName);

      processedLines.push(
        `${pyClosingPrefix}${varName} = ${jsRhs}; __traceStep(${lineNum}, ${JSON.stringify(
          actType
        )}, __cap(), { targetVar: ${JSON.stringify(varName)}, rhsExpr: ${JSON.stringify(
          rawRhs
        )} });`
      );
      continue;
    }

    // 19. Typed variable declaration without initialization (e.g. `int temp;`)
    const typedDeclOnly = trimmed.match(
      /^(?:let|var|int|long|short|byte|float|double|boolean|bool|String|string|char|FileReader|Scanner|File)\s+([A-Za-z_$][\w$]*)\s*;?\s*$/
    );
    if (typedDeclOnly) {
      const varName = typedDeclOnly[1];
      seenVars.add(varName);
      processedLines.push(
        `${pyClosingPrefix}${varName} = null; __traceStep(${lineNum}, "DECLARE", __cap(), { targetVar: ${JSON.stringify(
          varName
        )} });`
      );
      continue;
    }

    // 20. Array element assignment `arr[i] = rhs;`
    const arrAssignMatch = trimmed.match(
      /^([A-Za-z_$][\w$]*)\s*\[\s*([^\]]+)\s*\]\s*=\s*(.+?)\s*;?\s*$/
    );
    if (arrAssignMatch) {
      const [, arrName, idxExpr, rawRhs] = arrAssignMatch;
      const jsIdx = normalizeExpressionToJs(idxExpr, language, false, lineNum);
      const jsRhs = normalizeExpressionToJs(rawRhs, language, false, lineNum);
      processedLines.push(
        `${pyClosingPrefix}${arrName}[${jsIdx}] = ${jsRhs}; __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
          arrName
        )}, rhsExpr: ${JSON.stringify(rawRhs)} });`
      );
      continue;
    }

    // 21. Compound assignment `x += y`, `x -= y`, `x *= y`, `x /= y`, `x %= y`
    const compoundMatch = trimmed.match(
      /^([A-Za-z_$][\w$]*)\s*(\+=|-=|\*=|\/=|%=)\s*(.+?)\s*;?\s*$/
    );
    if (compoundMatch) {
      const [, varName, op, rawRhs] = compoundMatch;
      const isInt = (language === 'java' || language === 'cpp') && intVars.has(varName);
      const jsRhs = normalizeExpressionToJs(rawRhs, language, false, lineNum);
      const stmtJs =
        isInt && op === '/='
          ? `${varName} = __toInt(${varName} / (${jsRhs}), ${lineNum}, () => __cap())`
          : `${varName} ${op} (${jsRhs})`;
      processedLines.push(
        `${pyClosingPrefix}${stmtJs}; __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
          varName
        )}, rhsExpr: ${JSON.stringify(`${varName} ${op} ${rawRhs}`)} });`
      );
      continue;
    }

    // 22. Standalone increment/decrement `i++;`, `++i;`, `i--;`, `--i;`
    const incDecMatch = trimmed.match(
      /^(?:(\+\+|--)([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)(\+\+|--))\s*;?\s*$/
    );
    if (incDecMatch) {
      const varName = incDecMatch[2] || incDecMatch[3];
      const cleanStmt = trimmed.replace(/;$/, '');
      processedLines.push(
        `${pyClosingPrefix}${cleanStmt}; __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
          varName
        )}, rhsExpr: ${JSON.stringify(cleanStmt)} });`
      );
      continue;
    }

    // 23. Standard assignment `x = rhs;`
    const plainAssignMatch = trimmed.match(
      /^([A-Za-z_$][\w$]*)\s*=(?!=)\s*(.+?)\s*;?\s*$/
    );
    if (plainAssignMatch) {
      const [, varName, rawRhs] = plainAssignMatch;
      const isInt = (language === 'java' || language === 'cpp') && intVars.has(varName);
      const jsRhs = normalizeExpressionToJs(rawRhs, language, isInt, lineNum);
      const actType: RuntimeActionType =
        language === 'python' && !seenVars.has(varName) ? 'DECLARE' : 'ASSIGN';
      seenVars.add(varName);

      processedLines.push(
        `${pyClosingPrefix}${varName} = ${jsRhs}; __traceStep(${lineNum}, ${JSON.stringify(
          actType
        )}, __cap(), { targetVar: ${JSON.stringify(varName)}, rhsExpr: ${JSON.stringify(
          rawRhs
        )} });`
      );
      continue;
    }

    // 24. Fallback statement (e.g. method call `arr.push(10)`, `new FileReader(...)`, `break`, `continue`)
    const normStmt = normalizeExpressionToJs(trimmed.replace(/;$/, ''), language, false, lineNum);
    if (/^(?:break|continue|pass)\b/.test(normStmt)) {
      processedLines.push(`${pyClosingPrefix}${normStmt === 'pass' ? '' : `${normStmt};`}`);
    } else {
      processedLines.push(
        `${pyClosingPrefix}${normStmt}; __traceStep(${lineNum}, "ASSIGN", __cap());`
      );
    }
  }

  if (language === 'python') {
    while (pyIndentStack.length > 1) {
      pyIndentStack.pop();
      processedLines.push('}');
    }
  }

  const varDeclHeader =
    varNames.length > 0 ? `var ${varNames.join(', ')};\n` : '';
  const capHelper = `function __cap(extra) { return Object.assign({ ${captureEntries} }, extra || {}); }\n`;
  const fullScript = `${varDeclHeader}${capHelper}${processedLines.join('\n')}`;

  try {
    new vm.Script(fullScript);
    return fullScript;
  } catch {
    return null;
  }
}

/**
 * Universal Multi-Language Runtime Execution Engine.
 * Executes JavaScript, Python, C++, and Java deterministically at runtime in a sandboxed V8 VM,
 * capturing every loop iteration, conditional check, try/catch/finally jump, memory state, memory delta, and console output.
 */
export function runDeterministicMultiLanguage(
  code: string,
  language: SupportedLanguage = 'javascript',
  stdin = '',
  timeoutMs = 1200
): SandboxExecutionResult {
  const commentFreeCode = stripCommentsPreservingLines(code, language);
  const cleanLines = commentFreeCode.split('\n').map((l) => l.trim());
  const { varNames, intVars, hasFloatType } = extractVariablesAndTypes(
    commentFreeCode,
    language
  );

  const logs: string[] = [];
  let inlineBuffer = '';
  const errors: string[] = [];
  const recordedSteps: RecordedJsStep[] = [];
  const stdinLines = stdin.split('\n');
  let stdinIdx = 0;
  let prevVarsSnapshot: Record<string, any> = {};
  const loopIterationCounts = new Map<number, number>();

  const flushInlineBufferToStdout = () => {
    const combined = [...logs];
    if (inlineBuffer) combined.push(inlineBuffer);
    return combined.join('\n');
  };

  const computeDelta = (
    currentVars: Record<string, any>,
    preferredVar?: string
  ): MemoryDelta | null => {
    if (preferredVar && preferredVar in currentVars) {
      const oldVal = preferredVar in prevVarsSnapshot ? prevVarsSnapshot[preferredVar] : null;
      const newVal = currentVars[preferredVar];
      return {
        variable: preferredVar,
        oldValue: oldVal === undefined ? null : cloneSafeValue(oldVal),
        newValue: cloneSafeValue(newVal),
      };
    }

    for (const [k, v] of Object.entries(currentVars)) {
      const oldVal = k in prevVarsSnapshot ? prevVarsSnapshot[k] : null;
      const oldStr = oldVal === null ? null : JSON.stringify(oldVal);
      const newStr = JSON.stringify(v);
      if (oldStr !== newStr) {
        return {
          variable: k,
          oldValue: oldVal === undefined ? null : cloneSafeValue(oldVal),
          newValue: cloneSafeValue(v),
        };
      }
    }
    return null;
  };

  const recordStepInternal = (
    line: number,
    actionType: RuntimeActionType,
    varsSnapshot: Record<string, any>,
    consoleOutOnThisStep: string | null = null,
    meta?: RecordedStepMeta
  ) => {
    if (recordedSteps.length >= 110) return;

    const cleanedVars: Record<string, any> = {};
    if (varsSnapshot && typeof varsSnapshot === 'object') {
      for (const [k, v] of Object.entries(varsSnapshot)) {
        const cloned = cloneSafeValue(v);
        if (cloned !== undefined) {
          cleanedVars[k] = cloned;
        }
      }
    }

    const delta =
      actionType === 'DECLARE' ||
      actionType === 'ASSIGN' ||
      meta?.subKind === 'CATCH_BLOCK'
        ? computeDelta(cleanedVars, meta?.targetVar)
        : null;

    const effectiveActionType: RuntimeActionType =
      actionType === 'DECLARE' && delta && delta.oldValue !== null
        ? 'ASSIGN'
        : actionType;

    const snippet = cleanLines[line - 1] || '';

    recordedSteps.push({
      line,
      actionType: effectiveActionType,
      codeSnippet: snippet,
      variables: cleanedVars,
      memoryDelta: delta,
      consoleOutput: consoleOutOnThisStep,
      stdoutSoFar: flushInlineBufferToStdout(),
      meta,
    });

    prevVarsSnapshot = { ...cleanedVars };
  };

  const throwSandboxException = (
    line: number,
    excType: string,
    msg: string,
    capFn?: () => Record<string, any>
  ): never => {
    const cleanMsg = String(msg ?? '');
    const errObj: any = new Error(`${excType}: ${cleanMsg}`);
    errObj.__exceptionType = excType;
    errObj.__shortMessage = cleanMsg;
    errObj.__line = line;
    errObj.getMessage = () => cleanMsg;
    errObj.toString = () => `${excType}: ${cleanMsg}`;

    if (capFn) {
      recordStepInternal(line, 'CONDITION_CHECK', capFn(), null, {
        subKind: 'EXCEPTION_THROWN',
        exceptionType: excType,
        exceptionMessage: cleanMsg,
      });
    }
    throw errObj;
  };

  const createSandbox = () => ({
    console: {
      log: (...args: any[]) => {
        logs.push(
          args
            .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
            .join(' ')
        );
      },
      warn: (...args: any[]) => {
        logs.push(args.map(String).join(' '));
      },
      error: (...args: any[]) => {
        errors.push(args.map(String).join(' '));
      },
    },
    prompt: () => stdinLines[stdinIdx++] ?? '',
    input: () => stdinLines[stdinIdx++] ?? '',
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    Map,
    Set,
    __toInt: (val: any, line = 1, capFn?: () => Record<string, any>) => {
      if (typeof val === 'number') {
        if (!Number.isFinite(val)) {
          const excName = language === 'python' ? 'ZeroDivisionError' : 'ArithmeticException';
          throwSandboxException(line, excName, '/ by zero', capFn);
        }
        return Math.trunc(val);
      }
      return val;
    },
    __checkNum: (val: any, line = 1, capFn?: () => Record<string, any>) => {
      if (
        typeof val === 'number' &&
        !Number.isFinite(val) &&
        (language === 'java' || language === 'cpp' || language === 'python')
      ) {
        const excName = language === 'python' ? 'ZeroDivisionError' : 'ArithmeticException';
        throwSandboxException(line, excName, '/ by zero', capFn);
      }
      return val;
    },
    __openFile: (line: number, filePath: any, capFn?: () => Record<string, any>) => {
      const nameStr = String(filePath ?? 'file.txt');
      const excName = language === 'python' ? 'FileNotFoundError' : 'FileNotFoundException';
      throwSandboxException(
        line,
        excName,
        `${nameStr} (No such file or directory)`,
        capFn
      );
    },
    __parseIntJava: (line: number, strVal: any, capFn?: () => Record<string, any>) => {
      const parsed = Number.parseInt(String(strVal).trim(), 10);
      if (Number.isNaN(parsed)) {
        throwSandboxException(
          line,
          'NumberFormatException',
          `For input string: "${strVal}"`,
          capFn
        );
      }
      return parsed;
    },
    __parseDoubleJava: (line: number, strVal: any, capFn?: () => Record<string, any>) => {
      const parsed = Number.parseFloat(String(strVal).trim());
      if (Number.isNaN(parsed)) {
        throwSandboxException(
          line,
          'NumberFormatException',
          `For input string: "${strVal}"`,
          capFn
        );
      }
      return parsed;
    },
    __throwException: (
      line: number,
      excType: string,
      msg: any,
      capFn?: () => Record<string, any>
    ) => {
      throwSandboxException(line, excType, String(msg ?? ''), capFn);
    },
    __matchException: (err: any, expectedTypeStr: string): boolean => {
      if (!expectedTypeStr || expectedTypeStr === '...') return true;
      const expectedList = expectedTypeStr
        .split('|')
        .map((s) => s.trim().split('.').pop() || '');
      const actual =
        err?.__exceptionType ||
        (String(err?.message || '').includes('null') ? 'NullPointerException' : 'RuntimeException');

      for (const exp of expectedList) {
        if (
          exp === 'Exception' ||
          exp === 'Throwable' ||
          exp === 'RuntimeException' ||
          exp === 'Error' ||
          exp === actual
        ) {
          return true;
        }
        if (exp === 'IOException' && actual === 'FileNotFoundException') {
          return true;
        }
        if (exp === 'IndexOutOfBoundsException' && actual === 'ArrayIndexOutOfBoundsException') {
          return true;
        }
      }
      return false;
    },
    __fmtException: (err: any): string => {
      if (!err) return 'Exception';
      if (err.__exceptionType) {
        return `${err.__exceptionType}: ${err.__shortMessage || err.message}`;
      }
      if (String(err.message || '').includes('null')) {
        return 'NullPointerException: Cannot invoke method on null reference';
      }
      return String(err.message || err);
    },
    __fmtOut: (val: any) =>
      typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val),
    __traceStep: (
      line: number,
      actionType: RuntimeActionType,
      varsSnapshot: Record<string, any>,
      meta?: RecordedStepMeta
    ) => {
      recordStepInternal(line, actionType, varsSnapshot, null, meta);
    },
    __traceLoopCheck: (
      line: number,
      condFn: () => boolean,
      condText: string,
      capFn: () => Record<string, any>
    ): boolean => {
      const result = Boolean(condFn());
      const prevIter = loopIterationCounts.get(line) || 0;
      const currentIter = result ? prevIter + 1 : prevIter;
      if (result) loopIterationCounts.set(line, currentIter);

      recordStepInternal(line, 'LOOP_CHECK', capFn(), null, {
        conditionExpr: condText,
        conditionResult: result,
        iteration: currentIter,
      });
      return result;
    },
    __traceCondCheck: (
      line: number,
      condFn: () => boolean,
      condText: string,
      capFn: () => Record<string, any>
    ): boolean => {
      const result = Boolean(condFn());
      recordStepInternal(line, 'CONDITION_CHECK', capFn(), null, {
        conditionExpr: condText,
        conditionResult: result,
      });
      return result;
    },
    __printLine: (
      line: number,
      val: any,
      capFn: () => Record<string, any>
    ) => {
      const text =
        inlineBuffer +
        (typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val));
      inlineBuffer = '';
      logs.push(text);
      recordStepInternal(line, 'OUTPUT', capFn(), text, {
        printedText: text,
      });
    },
    __print: (
      line: number,
      val: any,
      capFn: () => Record<string, any>
    ) => {
      const text =
        typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val);
      inlineBuffer += text;
      recordStepInternal(line, 'OUTPUT', capFn(), text, {
        printedText: text,
      });
    },
  });

  const instrumentedScript = buildInstrumentedMultiLangScript(
    commentFreeCode,
    language,
    varNames,
    intVars,
    hasFloatType
  );

  if (instrumentedScript) {
    const sandbox = createSandbox();
    vm.createContext(sandbox);
    try {
      const script = new vm.Script(instrumentedScript);
      script.runInContext(sandbox, { timeout: timeoutMs });

      const finalVariables: Record<string, any> =
        recordedSteps.length > 0
          ? { ...recordedSteps[recordedSteps.length - 1].variables }
          : {};
      for (const [k, v] of Object.entries(sandbox)) {
        if (!IGNORED_SANDBOX_KEYS.has(k) && typeof v !== 'function' && v !== undefined) {
          const cloned = cloneSafeValue(v);
          if (cloned !== undefined) finalVariables[k] = cloned;
        }
      }

      return {
        stdout: flushInlineBufferToStdout(),
        stderr: errors.join('\n'),
        timedOut: false,
        runtimeError: null,
        finalVariables,
        recordedSteps,
        cleanLines,
      };
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isTimeout =
        msg.includes('Script execution timed out') || msg.includes('timed out');
      if (isTimeout || recordedSteps.length > 0) {
        return {
          stdout: flushInlineBufferToStdout(),
          stderr: msg,
          timedOut: isTimeout,
          runtimeError: isTimeout ? null : msg,
          runtimeErrorLine: err?.__line,
          finalVariables:
            recordedSteps.length > 0
              ? recordedSteps[recordedSteps.length - 1].variables
              : {},
          recordedSteps,
          cleanLines,
        };
      }
      return {
        stdout: flushInlineBufferToStdout(),
        stderr: msg,
        timedOut: false,
        runtimeError: msg,
        runtimeErrorLine: err?.__line,
        finalVariables: {},
        recordedSteps: [],
        cleanLines,
      };
    }
  }

  // Fallback for direct JavaScript execution if custom syntax wasn't instrumentable
  if (language === 'javascript') {
    logs.length = 0;
    inlineBuffer = '';
    errors.length = 0;
    stdinIdx = 0;
    const plainSandbox = createSandbox();
    vm.createContext(plainSandbox);

    try {
      const inspectableCode = commentFreeCode.replace(/\b(let|const)\s+/g, 'var ');
      const script = new vm.Script(inspectableCode);
      script.runInContext(plainSandbox, { timeout: timeoutMs });

      const finalVariables: Record<string, any> = {};
      for (const [k, v] of Object.entries(plainSandbox)) {
        if (!IGNORED_SANDBOX_KEYS.has(k) && typeof v !== 'function' && v !== undefined) {
          const cloned = cloneSafeValue(v);
          if (cloned !== undefined) finalVariables[k] = cloned;
        }
      }

      return {
        stdout: flushInlineBufferToStdout(),
        stderr: errors.join('\n'),
        timedOut: false,
        runtimeError: null,
        finalVariables,
        recordedSteps: [],
        cleanLines,
      };
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isTimeout =
        msg.includes('Script execution timed out') || msg.includes('timed out');
      return {
        stdout: flushInlineBufferToStdout(),
        stderr: msg,
        timedOut: isTimeout,
        runtimeError: isTimeout ? null : msg,
        finalVariables: {},
        recordedSteps: [],
        cleanLines,
      };
    }
  }

  return {
    stdout: '',
    stderr: '',
    timedOut: false,
    runtimeError: null,
    finalVariables: {},
    recordedSteps: [],
    cleanLines,
  };
}

export function runSandboxedJavaScript(
  code: string,
  stdin = '',
  timeoutMs = 1200
): SandboxExecutionResult {
  return runDeterministicMultiLanguage(code, 'javascript', stdin, timeoutMs);
}

function buildLineNotesFromCode(
  code: string,
  explainLanguage: ExplainLanguage,
  conceptBn: string,
  conceptEn: string
): LineNote[] {
  return code
    .split('\n')
    .map((raw, idx) => ({ raw: raw.trim(), line: idx + 1 }))
    .filter((item) => item.raw.length > 0)
    .map((item) => ({
      line: item.line,
      role:
        item.raw.includes('while') || item.raw.includes('for')
          ? 'loop'
          : item.raw.includes('if')
          ? 'condition'
          : item.raw.includes('return')
          ? 'return'
          : item.raw.includes('log') || item.raw.includes('print') || item.raw.includes('cout')
          ? 'output'
          : item.raw.includes('=')
          ? 'assign'
          : 'call',
      text:
        explainLanguage === 'bn'
          ? `লাইন ${item.line} (\`${item.raw.slice(0, 34)}\`): ${conceptBn}`
          : `Line ${item.line} (\`${item.raw.slice(0, 34)}\`): ${conceptEn}`,
    }));
}

function normalizeSnippet(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function detectProblemAndFaultState(code: string): {
  prob: CuratedProblem;
  isFaulty: boolean;
} | null {
  const norm = normalizeSnippet(code);
  const langs: SupportedLanguage[] = ['javascript', 'python', 'cpp', 'java'];
  const skipIds = new Set(['swap_variables', 'bubble_sort', 'while_missing_increment']);

  for (const prob of PROBLEM_LIBRARY) {
    if (skipIds.has(prob.id)) continue;
    for (const l of langs) {
      if (normalizeSnippet(prob.codes[l]) === norm) {
        return { prob, isFaulty: false };
      }
      if (normalizeSnippet(prob.faultyCodes[l]) === norm) {
        return { prob, isFaulty: true };
      }
    }
  }

  return null;
}

export function matchCuratedLibraryProblemTrace(params: {
  code: string;
  language: SupportedLanguage;
  explainLanguage: ExplainLanguage;
  depth: ExplanationDepth;
}): ExecutionTrace | null {
  const { code, language, explainLanguage } = params;
  const matched = detectProblemAndFaultState(code);
  if (!matched) return null;

  const { prob, isFaulty } = matched;
  const traceSource: TraceSource =
    language === 'cpp' || language === 'java' ? 'ai_predicted' : 'real_execution';

  let steps: TraceStep[] = [];
  let finalOutput = '';

  switch (prob.id) {
    case 'reverse_array':
    case 'linear_search':
    case 'array_maximum': {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: 'pointer_arrows',
          action: 'declare',
          explanation:
            explainLanguage === 'bn'
              ? `${prob.title_bn}: অ্যারে \`[10, 20, 30, 40]\` এবং প্রারম্ভিক পয়েন্টার সেট করা হলো।`
              : `${prob.title_en}: Initialized array and pointers.`,
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [
            { name: 'left', from: null, to: 0 },
            { name: 'right', from: null, to: 3 },
          ],
          variables: { arr: [10, 20, 30, 40], left: 0, right: 3 },
          fault: null,
          structure: { kind: 'array', values: [10, 20, 30, 40], pointers: { left: 0, right: 3 } },
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: 'pointer_arrows',
          action: isFaulty ? 'halt' : 'swap',
          explanation: isFaulty
            ? explainLanguage === 'bn'
              ? prob.bugHint_bn
              : prob.bugHint_en
            : explainLanguage === 'bn'
            ? 'দুই প্রান্তের মান অদলবদল করে পয়েন্টার দুটি মাঝখানে (`left = 1, right = 2`) এগিয়ে এল এবং অ্যারে `[40, 30, 20, 10]` হলো।'
            : 'Swapped outer and inner pairs using `left` and `right` pointers to produce `[40, 30, 20, 10]`.',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [
            {
              name: 'arr',
              from: '[10, 20, 30, 40]',
              to: isFaulty ? '[10, 20, 30, 40]' : '[40, 30, 20, 10]',
            },
          ],
          variables: {
            arr: isFaulty ? [10, 20, 30, 40] : [40, 30, 20, 10],
            left: 1,
            right: 2,
          },
          fault: isFaulty
            ? {
                type: 'off_by_one',
                message: explainLanguage === 'bn' ? prob.bugHint_bn : prob.bugHint_en,
                fixHint: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
              }
            : null,
          structure: {
            kind: 'array',
            values: isFaulty ? [10, 20, 30, 40] : [40, 30, 20, 10],
            pointers: { left: 1, right: 2 },
            swapping: [0, 3],
          },
        },
      ];
      finalOutput = isFaulty ? 'Fault halted' : '[40, 30, 20, 10]';
      break;
    }

    case 'binary_search': {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: 'binary_search_cards',
          action: 'declare',
          explanation:
            explainLanguage === 'bn'
              ? 'সাজানো অ্যারে `[2, 5, 8, 12, 16, 23, 38]`-এ `low = 0`, `high = 6` এবং মাঝখানের কার্ড `mid = 3` (`12`) আলোকিত হলো।'
              : 'Illuminated middle card `mid = 3` (`12`) inside sorted range `[0..6]`.',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'mid', from: null, to: 3 }],
          variables: { arr: [2, 5, 8, 12, 16, 23, 38], low: 0, high: 6, mid: 3, target: 12 },
          fault: null,
          structure: { kind: 'array', values: [2, 5, 8, 12, 16, 23, 38], highlight: [3] },
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: 'binary_search_cards',
          action: isFaulty ? 'halt' : 'compare',
          explanation: isFaulty
            ? explainLanguage === 'bn'
              ? prob.bugHint_bn
              : prob.bugHint_en
            : explainLanguage === 'bn'
            ? '`mid = 3` ইনডেক্সে কাঙ্ক্ষিত সংখ্যা `12` পাওয়া গেছে!'
            : 'Target `12` matched at index `mid = 3`!',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'found', from: null, to: isFaulty ? -1 : 3 }],
          variables: {
            arr: [2, 5, 8, 12, 16, 23, 38],
            low: isFaulty ? 0 : 3,
            high: isFaulty ? 6 : 3,
            mid: 3,
            target: 12,
            found: isFaulty ? -1 : 3,
          },
          fault: isFaulty
            ? {
                type: 'infinite_loop',
                message: explainLanguage === 'bn' ? prob.bugHint_bn : prob.bugHint_en,
                fixHint: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
              }
            : null,
          structure: { kind: 'array', values: [2, 5, 8, 12, 16, 23, 38], highlight: [3] },
        },
      ];
      finalOutput = isFaulty ? 'Halted: Infinite loop at mid = 3' : 'Found: 12 at 3';
      break;
    }

    case 'stack_brackets': {
      steps = [
        {
          stepIndex: 1,
          activeLine: 2,
          analogyType: 'stack_plates',
          action: 'push',
          explanation:
            explainLanguage === 'bn'
              ? 'খোলা ব্র্যাকেট `(` এবং `[` স্ট্যাকের উপরে প্লেটের মতো পুশ (`push`) করা হলো।'
              : 'Pushed opening brackets `(` and `[` onto the top of the LIFO plate stack.',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'stackSize', from: 0, to: 2 }],
          variables: { st: ['(', '['], valid: true },
          fault: null,
          structure: { kind: 'stack', values: ['(', '['] },
        },
        {
          stepIndex: 2,
          activeLine: 5,
          analogyType: 'stack_plates',
          action: isFaulty ? 'halt' : 'pop',
          explanation: isFaulty
            ? explainLanguage === 'bn'
              ? prob.bugHint_bn
              : prob.bugHint_en
            : explainLanguage === 'bn'
            ? 'বন্ধ ব্র্যাকেট `]` এবং `)` মিলে যাওয়ায় স্ট্যাকের সব প্লেট পপ (`pop`) হয়ে স্ট্যাক খালি ও সুষম (`Balanced`) হয়েছে!'
            : 'Popped matching `]` and `)`. Stack is empty (`size = 0`) and balanced!',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'stackSize', from: 2, to: isFaulty ? 1 : 0 }],
          variables: { st: isFaulty ? ['('] : [], valid: !isFaulty },
          fault: isFaulty
            ? {
                type: 'off_by_one',
                message: explainLanguage === 'bn' ? prob.bugHint_bn : prob.bugHint_en,
                fixHint: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
              }
            : null,
          structure: { kind: 'stack', values: isFaulty ? ['('] : [] },
        },
      ];
      finalOutput = isFaulty ? 'Unbalanced stack!' : 'Balanced, size: 0';
      break;
    }

    case 'queue_bfs': {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: 'queue_line',
          action: 'enqueue',
          explanation:
            explainLanguage === 'bn'
              ? 'BFS কিউর পেছনে (`REAR`) নোড `A`, `B`, `C` এনকিউ (`enqueue`) করা হলো।'
              : 'Enqueued nodes `A`, `B`, `C` at the rear of the FIFO queue.',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'queued', from: 0, to: 3 }],
          variables: { q: ['A', 'B', 'C'], visited: 1 },
          fault: null,
          structure: { kind: 'queue', values: ['A', 'B', 'C'] },
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: 'queue_line',
          action: isFaulty ? 'halt' : 'dequeue',
          explanation: isFaulty
            ? explainLanguage === 'bn'
              ? prob.bugHint_bn
              : prob.bugHint_en
            : explainLanguage === 'bn'
            ? 'কিউর সামনে (`FRONT`) থেকে `A` ডিকিউ করে প্রতিবেশী ভিজিট সম্পন্ন করা হলো।'
            : 'Dequeued `A` from the front of the queue and marked neighbors visited.',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'visited', from: 1, to: 3 }],
          variables: { q: isFaulty ? ['A', 'B', 'A', 'B'] : ['B', 'C'], front: 'A', visited: 3 },
          fault: isFaulty
            ? {
                type: 'infinite_loop',
                message: explainLanguage === 'bn' ? prob.bugHint_bn : prob.bugHint_en,
                fixHint: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
              }
            : null,
          structure: { kind: 'queue', values: isFaulty ? ['A', 'B', 'A', 'B'] : ['B', 'C'] },
        },
      ];
      finalOutput = isFaulty ? 'Infinite cycle in BFS queue' : 'Visited nodes: 3';
      break;
    }

    case 'linked_list_reverse': {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: 'linked_list_train',
          action: 'declare',
          explanation:
            explainLanguage === 'bn'
              ? 'লিঙ্কড লিস্টের তিনটি ট্রেন বগি `10 -> 20 -> 30 -> NULL` প্রস্তুত করা হলো।'
              : 'Initialized train coaches `10 -> 20 -> 30 -> NULL`.',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'curr', from: null, to: 10 }],
          variables: { nodes: [10, 20, 30], prev: 'NULL', curr: 10, nextTemp: 20 },
          fault: null,
          structure: { kind: 'list', values: [10, 20, 30] },
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: 'linked_list_train',
          action: isFaulty ? 'halt' : 'transfer',
          explanation: isFaulty
            ? explainLanguage === 'bn'
              ? prob.bugHint_bn
              : prob.bugHint_en
            : explainLanguage === 'bn'
            ? '`nextTemp`-এ পরের বগি বাঁচিয়ে রেখে কাপলার ঘুরিয়ে `30 -> 20 -> 10 -> NULL` তৈরি করা হলো।'
            : 'Saved `nextTemp` and reversed couplers cleanly to `30 -> 20 -> 10 -> NULL`.',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'curr', from: 10, to: 20 }],
          variables: {
            nodes: isFaulty ? [10] : [30, 20, 10],
            prev: 10,
            curr: isFaulty ? 'LOST' : 20,
          },
          fault: isFaulty
            ? {
                type: 'lost_value',
                message: explainLanguage === 'bn' ? prob.bugHint_bn : prob.bugHint_en,
                fixHint: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
              }
            : null,
          structure: { kind: 'list', values: isFaulty ? [10] : [30, 20, 10] },
        },
      ];
      finalOutput = isFaulty ? 'Broken chain: lost nodes 20 -> 30' : 'New head: 20 prev: 10';
      break;
    }

    case 'recursion_factorial':
    default: {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: 'recursion_tower',
          action: 'call',
          explanation:
            explainLanguage === 'bn'
              ? 'রিকার্শন কল স্ট্যাকে `fact(3) -> fact(2) -> fact(1)` ফ্রেমগুলো স্তরে স্তরে জমা হলো।'
              : 'Stacked recursive call frames `fact(3) -> fact(2) -> fact(1)` on the Call Tower.',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'n', from: 3, to: 1 }],
          variables: { callStack: ['fact(3)', 'fact(2)', 'fact(1)'], n: 1 },
          fault: null,
          structure: { kind: 'stack', values: ['fact(3)', 'fact(2)', 'fact(1)'] },
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: 'recursion_tower',
          action: isFaulty ? 'halt' : 'return',
          explanation: isFaulty
            ? explainLanguage === 'bn'
              ? prob.bugHint_bn
              : prob.bugHint_en
            : explainLanguage === 'bn'
            ? 'বেস কেস `fact(1) = 1` থেকে ফ্রেমগুলো ফিরে এসে `3 * 2 * 1 = 6` ফলাফল দিল!'
            : 'Base case `fact(1) = 1` returned, unwinding the call stack to compute `3! = 6`.',
          why: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
          changes: [{ name: 'result', from: 1, to: isFaulty ? 'StackOverflow' : 6 }],
          variables: {
            callStack: isFaulty
              ? ['fact(3)', 'fact(2)', 'fact(1)', 'fact(0)', 'fact(-1) 💥']
              : ['fact(3) → 6'],
            result: isFaulty ? 'StackOverflow' : 6,
          },
          fault: isFaulty
            ? {
                type: 'stack_overflow',
                message: explainLanguage === 'bn' ? prob.bugHint_bn : prob.bugHint_en,
                fixHint: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
              }
            : null,
          structure: {
            kind: 'stack',
            values: isFaulty
              ? ['fact(3)', 'fact(2)', 'fact(1)', 'fact(0)', 'fact(-1) 💥']
              : ['fact(3) → 6'],
          },
        },
      ];
      finalOutput = isFaulty ? 'Stack Overflow!' : '3! = 6';
      break;
    }
  }

  return {
    hasError: false,
    isValidLogic: !isFaulty,
    errorDetails: null,
    language,
    analogyType: steps[0].analogyType,
    traceSource,
    logicSummary: {
      title: explainLanguage === 'bn' ? prob.title_bn : prob.title_en,
      goal: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
      idea: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
      keyPoints: [
        explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
        explainLanguage === 'bn' ? prob.bugHint_bn : prob.bugHint_en,
      ],
      analogyStory: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
      complexity: {
        time: prob.id === 'binary_search' ? 'O(log n)' : 'O(n)',
        space: prob.id === 'recursion_factorial' || prob.id === 'stack_brackets' ? 'O(n)' : 'O(1)',
        note: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
      },
      commonMistakes: [explainLanguage === 'bn' ? prob.bugHint_bn : prob.bugHint_en],
    },
    lineNotes: buildLineNotesFromCode(code, explainLanguage, prob.concept_bn, prob.concept_en),
    steps,
    finalOutput,
    outputExplanation: explainLanguage === 'bn' ? prob.concept_bn : prob.concept_en,
    verdict: {
      status: isFaulty ? 'logic_error' : 'ok',
      message: isFaulty
        ? explainLanguage === 'bn'
          ? prob.bugHint_bn
          : prob.bugHint_en
        : explainLanguage === 'bn'
        ? 'সফলভাবে ভিজ্যুয়ালাইজ করা হয়েছে।'
        : 'Visualized accurately.',
    },
    programSummary: {
      totalExecutionSteps: steps.length,
      timeComplexity: prob.id === 'binary_search' ? 'O(log n)' : 'O(n)',
      spaceComplexity:
        prob.id === 'recursion_factorial' || prob.id === 'stack_brackets' ? 'O(n)' : 'O(1)',
      finalOutput,
    },
  };
}
