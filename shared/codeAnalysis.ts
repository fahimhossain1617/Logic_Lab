import { ExplainLanguage, SupportedLanguage, TraceStep } from './types';

export type ScopeKind =
  | 'if'
  | 'else_if'
  | 'else'
  | 'for'
  | 'while'
  | 'do'
  | 'switch'
  | 'try'
  | 'catch'
  | 'finally'
  | 'class'
  | 'main'
  | 'function'
  | 'block';

export interface BlockScopeInfo {
  openLine: number;
  closeLine: number;
  kind: ScopeKind;
  headerText: string;
  wasBlockExecuted: boolean;
}

export interface PythonBlockEndInfo {
  openLine: number;
  endLine: number;
  kind: ScopeKind;
  wasBlockExecuted: boolean;
}

export interface ComplexityAnalysisResult {
  time: string;
  space: string;
  noteBn: string;
  noteEn: string;
}

/**
 * Strips comments and string/char literals while preserving exact 1-based line breaks
 * so static control-flow and complexity scanning never misreads strings or comments.
 */
export function stripCommentsAndLiterals(
  code: string,
  language: SupportedLanguage
): string {
  let out = '';
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
        out += '  ';
        i += 2;
        inBlockComment = false;
      } else {
        out += ch === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }

    if (inSingle) {
      if (ch === '\\' && i + 1 < len) {
        out += code[i + 1] === '\n' ? '\n' : '  ';
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '\n') {
        inSingle = false;
        out += ch === '\n' ? '\n' : "'";
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === '\\' && i + 1 < len) {
        out += code[i + 1] === '\n' ? '\n' : '  ';
        i += 2;
        continue;
      }
      if (ch === '"' || ch === '\n') {
        inDouble = false;
        out += ch === '\n' ? '\n' : '"';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (inBacktick) {
      if (ch === '\\' && i + 1 < len) {
        out += code[i + 1] === '\n' ? '\n' : '  ';
        i += 2;
        continue;
      }
      if (ch === '`') {
        inBacktick = false;
        out += '`';
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
      i++;
      continue;
    }

    if (ch === '/' && next === '*' && language !== 'python') {
      inBlockComment = true;
      out += '  ';
      i += 2;
      continue;
    }

    if (ch === '/' && next === '/' && language !== 'python') {
      while (i < len && code[i] !== '\n') i++;
      continue;
    }

    if (ch === '#' && language === 'python') {
      while (i < len && code[i] !== '\n') i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      out += "'";
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += '"';
      i++;
      continue;
    }
    if (ch === '`' && language === 'javascript') {
      inBacktick = true;
      out += '`';
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function classifyScopeHeader(headerLine: string, language: SupportedLanguage): ScopeKind {
  const t = headerLine.trim();
  if (/^(?:\}?\s*)?(?:else\s+if|elif)\b/.test(t)) return 'else_if';
  if (/^(?:\}?\s*)?else\b/.test(t)) return 'else';
  if (/^if\b/.test(t)) return 'if';
  if (/^for\b/.test(t)) return 'for';
  if (/^(?:\}?\s*)?while\b/.test(t)) return 'while';
  if (/^do\b/.test(t)) return 'do';
  if (/^switch\b/.test(t)) return 'switch';
  if (/^try\b/.test(t)) return 'try';
  if (/^(?:\}?\s*)?(?:catch|except)\b/.test(t)) return 'catch';
  if (/^(?:\}?\s*)?finally\b/.test(t)) return 'finally';
  if (/\bmain\s*\(/.test(t)) return 'main';
  if (/^(?:public|private|protected|final|abstract|\s)*class\b/.test(t)) return 'class';
  if (
    language === 'python'
      ? /^def\b/.test(t)
      : /\b(?:function|void|int|long|double|float|boolean|bool|String|string)\s+[A-Za-z_$][\w$]*\s*\(/.test(t) ||
        /=>\s*\{/.test(t)
  ) {
    return 'function';
  }
  return 'block';
}

function getScopeLabel(kind: ScopeKind, explainLanguage: ExplainLanguage): string {
  const isBn = explainLanguage === 'bn';
  switch (kind) {
    case 'if':
      return '`if`';
    case 'else_if':
      return '`else if` / `elif`';
    case 'else':
      return '`else`';
    case 'for':
      return '`for` লুপ';
    case 'while':
      return '`while` লুপ';
    case 'do':
      return '`do-while` লুপ';
    case 'switch':
      return '`switch`';
    case 'try':
      return '`try`';
    case 'catch':
      return '`catch` / `except`';
    case 'finally':
      return '`finally`';
    case 'class':
      return isBn ? 'ক্লাস (`class`)' : '`class`';
    case 'main':
      return '`main` মেথড';
    case 'function':
      return isBn ? 'ফাংশন / মেথড' : 'function / method';
    default:
      return isBn ? 'কোড ব্লক' : 'code block';
  }
}

/**
 * Maps every curly-brace block (Java/C++/JS) and indentation block (Python)
 * and determines from actual executed step lines whether that block ran or was skipped.
 */
export function analyzeBlockExecution(
  code: string,
  language: SupportedLanguage,
  executedLines: Set<number>
): {
  braceByCloseLine: Map<number, BlockScopeInfo>;
  pythonEndsByLine: Map<number, PythonBlockEndInfo>;
  skippedBlockLines: Set<number>;
} {
  const clean = stripCommentsAndLiterals(code, language);
  const cleanLines = clean.split('\n');
  const rawLines = code.split('\n');

  const braceByCloseLine = new Map<number, BlockScopeInfo>();
  const pythonEndsByLine = new Map<number, PythonBlockEndInfo>();
  const skippedBlockLines = new Set<number>();

  if (language === 'python') {
    interface PyFrame {
      indent: number;
      openLine: number;
      kind: ScopeKind;
      lastBodyLine: number;
      bodyLines: number[];
    }
    const stack: PyFrame[] = [];

    for (let i = 0; i < cleanLines.length; i++) {
      const lineNum = i + 1;
      const trimmed = cleanLines[i].trim();
      if (!trimmed) continue;

      const indent = (rawLines[i].match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;

      while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
        const closed = stack.pop()!;
        if (closed.lastBodyLine > 0) {
          const wasExecuted = closed.bodyLines.some((ln) => executedLines.has(ln));
          pythonEndsByLine.set(closed.lastBodyLine, {
            openLine: closed.openLine,
            endLine: closed.lastBodyLine,
            kind: closed.kind,
            wasBlockExecuted: wasExecuted,
          });
          if (!wasExecuted && (closed.kind === 'if' || closed.kind === 'else_if' || closed.kind === 'else' || closed.kind === 'catch')) {
            for (const ln of closed.bodyLines) skippedBlockLines.add(ln);
          }
        }
      }

      if (stack.length > 0) {
        const top = stack[stack.length - 1];
        top.lastBodyLine = lineNum;
        top.bodyLines.push(lineNum);
      }

      if (trimmed.endsWith(':')) {
        stack.push({
          indent,
          openLine: lineNum,
          kind: classifyScopeHeader(trimmed, language),
          lastBodyLine: -1,
          bodyLines: [],
        });
      }
    }

    while (stack.length > 0) {
      const closed = stack.pop()!;
      if (closed.lastBodyLine > 0) {
        const wasExecuted = closed.bodyLines.some((ln) => executedLines.has(ln));
        pythonEndsByLine.set(closed.lastBodyLine, {
          openLine: closed.openLine,
          endLine: closed.lastBodyLine,
          kind: closed.kind,
          wasBlockExecuted: wasExecuted,
        });
        if (!wasExecuted && (closed.kind === 'if' || closed.kind === 'else_if' || closed.kind === 'else' || closed.kind === 'catch')) {
          for (const ln of closed.bodyLines) skippedBlockLines.add(ln);
        }
      }
    }

    return { braceByCloseLine, pythonEndsByLine, skippedBlockLines };
  }

  // Curly-brace languages: Java, C++, JavaScript
  interface BraceFrame {
    openLine: number;
    kind: ScopeKind;
    headerText: string;
    directBodyLines: number[];
    allInnerLines: number[];
  }
  const stack: BraceFrame[] = [];

  for (let i = 0; i < cleanLines.length; i++) {
    const lineNum = i + 1;
    const lineText = cleanLines[i];
    const trimmed = lineText.trim();
    if (!trimmed) continue;

    // Assign non-standalone lines to the innermost active block before handling braces
    const isStandaloneBrace = trimmed === '{' || trimmed === '}' || trimmed === '};';
    if (!isStandaloneBrace && stack.length > 0 && !trimmed.startsWith('}') && !trimmed.includes('{')) {
      const top = stack[stack.length - 1];
      top.directBodyLines.push(lineNum);
      top.allInnerLines.push(lineNum);
    }

    // Walk braces in order on this line (`} else {` has close then open)
    for (let c = 0; c < lineText.length; c++) {
      const ch = lineText[c];
      if (ch === '{') {
        let headerSource = trimmed;
        if (trimmed === '{' && i > 0) {
          // Look up to 1 non-empty line above for Allman-style `{`
          for (let prev = i - 1; prev >= 0; prev--) {
            if (cleanLines[prev].trim()) {
              headerSource = cleanLines[prev].trim();
              break;
            }
          }
        }
        const kind = classifyScopeHeader(headerSource, language);
        stack.push({
          openLine: lineNum,
          kind,
          headerText: rawLines[i]?.trim() || trimmed,
          directBodyLines: [],
          allInnerLines: [],
        });
      } else if (ch === '}') {
        const closed = stack.pop();
        if (closed) {
          const isConditionalOrCatch =
            closed.kind === 'if' ||
            closed.kind === 'else_if' ||
            closed.kind === 'else' ||
            closed.kind === 'catch';
          const directHit = closed.directBodyLines.some((ln) => executedLines.has(ln));
          const anyInnerHit = closed.allInnerLines.some((ln) => executedLines.has(ln));

          // A closing brace was reached only if the close line itself appears in trace steps
          // OR for non-conditional blocks (loops, main, func, switch, try) its body ran,
          // OR for conditional/catch blocks a direct body statement inside that block executed.
          const wasBlockExecuted =
            closed.kind === 'class'
              ? false
              : executedLines.has(lineNum) ||
                (isConditionalOrCatch ? directHit : anyInnerHit);

          // Propagate inner lines up to parent block so outer `main`/`if` sees inner activity
          if (stack.length > 0) {
            const parent = stack[stack.length - 1];
            parent.allInnerLines.push(...closed.allInnerLines);
            if (wasBlockExecuted && parent.kind !== 'class') {
              parent.directBodyLines.push(...closed.directBodyLines);
            }
          }

          if (!wasBlockExecuted && isConditionalOrCatch) {
            for (const ln of closed.directBodyLines) skippedBlockLines.add(ln);
          }

          // Only record closeLine metadata if the line ends with a closing brace (not `} else {`)
          if (trimmed === '}' || trimmed === '};' || (trimmed.startsWith('}') && !trimmed.includes('{'))) {
            braceByCloseLine.set(lineNum, {
              openLine: closed.openLine,
              closeLine: lineNum,
              kind: closed.kind,
              headerText: closed.headerText,
              wasBlockExecuted,
            });
          }
        }
      }
    }
  }

  return { braceByCloseLine, pythonEndsByLine, skippedBlockLines };
}

/**
 * Generates an accurate, execution-aware explanation for a closing brace (`}`)
 * or skipped/inactive line across Java, C++, Python, and JavaScript.
 */
export function buildExecutionAwareLineNote(params: {
  lineNumber: number;
  trimmed: string;
  language: SupportedLanguage;
  explainLanguage: ExplainLanguage;
  executedLines: Set<number>;
  braceInfo?: BlockScopeInfo;
  pythonEndInfo?: PythonBlockEndInfo;
}): { text: string; why: string; wasExecuted: boolean } {
  const {
    lineNumber,
    trimmed,
    language,
    explainLanguage,
    executedLines,
    braceInfo,
    pythonEndInfo,
  } = params;
  const isBn = explainLanguage === 'bn';
  const lineExecuted = executedLines.has(lineNumber);

  // Comments
  if (
    trimmed.startsWith('//') ||
    (trimmed.startsWith('#') && !trimmed.startsWith('#include')) ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*')
  ) {
    return isBn
      ? {
          text: 'এটি একটি কোড কমেন্ট (মন্তব্য), যা কম্পাইলার বা রানটাইম এক্সিকিউট করে না।',
          why: 'কোডের উদ্দেশ্য ও লজিক মানুষের বোঝার সুবিধার্থে কমেন্ট লেখা হয়।',
          wasExecuted: false,
        }
      : {
          text: 'This is a comment ignored during runtime execution.',
          why: 'Comments document developer intent for readers without affecting state.',
          wasExecuted: false,
        };
  }

  // Imports / headers / packages
  if (
    /^import\s+/.test(trimmed) ||
    /^from\s+\S+\s+import\b/.test(trimmed) ||
    /^#include\s+/.test(trimmed) ||
    /^using\s+namespace\b/.test(trimmed) ||
    /^package\s+/.test(trimmed)
  ) {
    return isBn
      ? {
          text: `বাহ্যিক লাইব্রেরি বা নেমস্পেস (\`${trimmed}\`) কম্পাইলেশনের শুরুতে যুক্ত করা হয়েছে।`,
          why: 'ইনপুট-আউটপুট ও স্ট্যান্ডার্ড লাইব্রেরি ফাংশন ব্যবহারের জন্য এগুলো আগেভাগেই চিনিয়ে দিতে হয়।',
          wasExecuted: true,
        }
      : {
          text: `Links library or namespace declaration \`${trimmed}\` before execution begins.`,
          why: 'Makes standard library classes, I/O helpers, or namespaces available in this file.',
          wasExecuted: true,
        };
  }

  // Opening brace only `{`
  if (trimmed === '{') {
    return isBn
      ? {
          text: 'নতুন একটি কোড ব্লকের শুরু (`{`) নির্দেশ করে।',
          why: 'সেকেন্ড ব্র্যাকেট কোডের স্কোপ ও কোন স্টেটমেন্টগুলো কোন ব্লকের অধীনে রয়েছে তা নির্ধারণ করে।',
          wasExecuted: lineExecuted,
        }
      : {
          text: 'Marks the opening (`{`) of a lexical code block.',
          why: 'Curly braces group statements under their enclosing control-flow or method scope.',
          wasExecuted: lineExecuted,
        };
  }

  // Closing brace `}` or `};`
  if (trimmed === '}' || trimmed === '};') {
    const scopeLabel = braceInfo
      ? getScopeLabel(braceInfo.kind, explainLanguage)
      : isBn
      ? 'কোড ব্লক'
      : 'code block';

    if (braceInfo?.kind === 'class') {
      return isBn
        ? {
            text: `এটি ${scopeLabel} ডেফিনিশনের সমাপ্তি নির্দেশ করে (\`${trimmed}\`)।`,
            why: 'ক্লাসের ভেতরের সব মেথড ও প্রোপার্টির সীমা এখানে শেষ হয়।',
            wasExecuted: false,
          }
        : {
            text: `Marks the structural end of the ${scopeLabel} definition (\`${trimmed}\`).`,
            why: 'Encloses all fields and methods defined in the class.',
            wasExecuted: false,
          };
    }

    const reachedAtRuntime = Boolean(braceInfo ? braceInfo.wasBlockExecuted : lineExecuted);
    if (reachedAtRuntime) {
      return isBn
        ? {
            text: `${scopeLabel} ব্লকের সব কার্যকর ধাপ সম্পন্ন হওয়ায় নিয়ন্ত্রণ এখান থেকে বাইরের স্তরে ফিরে আসছে।`,
            why: 'ব্লকটি সক্রিয়ভাবে রান শেষ করায় স্কোপের কাজ সমাপ্ত হয়ে পরবর্তী স্টেটমেন্টে নিয়ন্ত্রণ স্থানান্তরিত হয়।',
            wasExecuted: true,
          }
        : {
            text: `All active statements inside the ${scopeLabel} block finished, returning control to the outer scope.`,
            why: 'Closing the executed block ends its scope and resumes outer control flow.',
            wasExecuted: true,
          };
    }

    return isBn
      ? {
          text: `এটি ${scopeLabel} ব্লকের সমাপ্তি নির্দেশ করে (\`${trimmed}\`)—বর্তমান ইনপুটের পথে এই ব্লকটি স্কিপ হওয়ায় কন্ট্রোল এর ভেতরে প্রবেশ করেনি।`,
          why: 'গঠনগতভাবে ব্লকের সীমানা শেষ করলেও শর্ত অনুযায়ী ব্লকটি সক্রিয় না হওয়ায় এখানে কোনো রানটাইম ফ্লো পৌঁছেনি।',
          wasExecuted: false,
        }
      : {
          text: `Marks the structural end of the ${scopeLabel} block (\`${trimmed}\`); skipped during this run because control never entered it.`,
          why: 'Defines the block boundary statically, though no runtime control flow passed through it on this input.',
          wasExecuted: false,
        };
  }

  // Class / Main header
  if (/^(?:public|private|protected|final|abstract|\s)*class\s+/.test(trimmed)) {
    return isBn
      ? {
          text: `প্রোগ্রামের মূল ক্লাস কাঠামো (\`${trimmed.replace(/\{$/, '').trim()}\`) সংজ্ঞায়িত করা হয়েছে।`,
          why: 'Java/C++-এ মেথড ও লজিকগুলো একটি ক্লাসের ভেতরে সংগঠিত থাকে।',
          wasExecuted: true,
        }
      : {
          text: `Defines the class container (\`${trimmed.replace(/\{$/, '').trim()}\`).`,
          why: 'Classes encapsulate the program entry point, methods, and state.',
          wasExecuted: true,
        };
  }

  if (/\bmain\s*\(/.test(trimmed)) {
    return isBn
      ? {
          text: 'প্রোগ্রামের মূল এন্ট্রি পয়েন্ট (`main`) মেথড এখান থেকে শুরু হয়েছে।',
          why: 'প্রোগ্রাম চালু হলে রানটাইম সবার প্রথমে `main` থেকেই এক্সিকিউশন শুরু করে।',
          wasExecuted: true,
        }
      : {
          text: 'Program execution starts from this `main` entry point.',
          why: 'The runtime always invokes `main` first when launching the program.',
          wasExecuted: true,
        };
  }

  // Unexecuted branches or skipped statements
  if (!lineExecuted) {
    const pySuffixBn =
      language === 'python' && pythonEndInfo
        ? ` (একই সাথে এটি ওই \`${pythonEndInfo.kind}\` ইন্ডেন্টেশন ব্লকের শেষ লাইন)`
        : '';
    const pySuffixEn =
      language === 'python' && pythonEndInfo
        ? ` (also marks the structural end of this Python \`${pythonEndInfo.kind}\` block)`
        : '';

    if (/^(?:\}?\s*)?(?:else\s+if|elif)\b/.test(trimmed)) {
      const condLabel = trimmed.replace(/^[\}\s]*(?:else\s+if|elif)\s*/, '').replace(/[{}:]/g, '').trim();
      return isBn
        ? {
            text: `বর্তমান ইনপুটের পথে এই বিকল্প শর্ত (\`${condLabel}\`) সক্রিয়ভাবে পরীক্ষা করার প্রয়োজন হয়নি—আগের একটি শর্ত ইতোমধ্যে সত্য হওয়ায় এটি স্কিপ হয়েছে।`,
            why: '`if / else if` চেইনে প্রথম সত্য শর্তটি মিললেই পরবর্তী বিকল্প শর্তগুলো বাদ পড়ে যায়।',
            wasExecuted: false,
          }
        : {
            text: `Skipped in the current execution path: \`${condLabel}\` was bypassed because an earlier branch already matched.`,
            why: 'In an `if / else if` chain, evaluation stops at the first matching condition.',
            wasExecuted: false,
          };
    }

    if (/^(?:\}?\s*)?else\b/.test(trimmed)) {
      return isBn
        ? {
            text: 'বর্তমান ইনপুটের পথে এই `else` শাখাটি সক্রিয়ভাবে চলেনি—পূর্ববর্তী একটি `if` বা `else if` শর্ত সত্য হওয়ায় এটি স্কিপ হয়েছে।',
            why: 'গঠনগতভাবে এটি ফলব্যাক শাখা হিসেবে রয়েছে, যা কেবল উপরের সব শর্ত মিথ্যা হলেই চালু হতো।',
            wasExecuted: false,
          }
        : {
            text: 'Skipped in the current execution path: this `else` fallback branch was not taken because an earlier condition evaluated to `true`.',
            why: 'Structurally acts as the catch-all branch when every preceding condition fails.',
            wasExecuted: false,
          };
    }

    if (/^(?:\}?\s*)?(?:catch|except)\b/.test(trimmed)) {
      return isBn
        ? {
            text: 'বর্তমান ইনপুটের পথে এই এক্সেপশন হ্যান্ডলার (`catch`/`except`) ব্লকটি চলেনি—কারণ `try` ব্লকে কোনো ত্রুটি ঘটেনি।',
            why: 'রানটাইমে কোনো এক্সেপশন ছোড়া হলেই কেবল প্রোগ্রামকে নিরাপদ রাখতে এই ব্লকটি সক্রিয় হয়।',
            wasExecuted: false,
          }
        : {
            text: 'Skipped in the current execution path: this exception handler was not triggered because no matching runtime error occurred.',
            why: 'Structurally guards against runtime exceptions thrown inside the `try` block.',
            wasExecuted: false,
          };
    }

    if (/^(?:case\b|default\s*:)/.test(trimmed)) {
      return isBn
        ? {
            text: `বর্তমান ইনপুটের পথে \`${trimmed.replace(/:$/, '').trim()}\` শাখাটি ম্যাচ না হওয়ায় এটি স্কিপ হয়েছে।`,
            why: '`switch` স্টেটমেন্ট কেবল ম্যাচিং মানের শাখাটিই রান করে।',
            wasExecuted: false,
          }
        : {
            text: `Skipped in the current execution path because \`${trimmed.replace(/:$/, '').trim()}\` did not match the switch value.`,
            why: '`switch` executes only the matching case branch.',
            wasExecuted: false,
          };
    }

    if (/^if\b/.test(trimmed)) {
      return isBn
        ? {
            text: `বর্তমান ইনপুটের পথে এই \`if\` শর্তটি (\`${trimmed}\`) সক্রিয়ভাবে চলেনি—বাইরের একটি শর্ত মিথ্যা হওয়ায় বা আগে রিটার্ন হওয়ায় এটি স্কিপ হয়েছে।`,
            why: 'নেস্টেড শর্ত কেবল তার বাইরের ব্লকে প্রবেশ করলেই যাচাই হয়।',
            wasExecuted: false,
          }
        : {
            text: `Skipped in the current execution path: this \`if\` check was never reached.`,
            why: 'Control flow bypassed its enclosing scope on this input.',
            wasExecuted: false,
          };
    }

    if (/\.close\s*\(\s*\)/.test(trimmed)) {
      return isBn
        ? {
            text: `বর্তমান ইনপুটের পথে রিসোর্স ক্লোজ লাইন (\`${trimmed}\`) পর্যন্ত এক্সিকিউশন পৌঁছেনি।`,
            why: 'আগেই প্রোগ্রাম শেষ হয়ে যাওয়া বা এক্সেপশন ঘটার কারণে এই ক্লিনআপ লাইনটি স্কিপ হয়েছে।',
            wasExecuted: false,
          }
        : {
            text: `Skipped in the current execution path: execution did not reach resource cleanup (\`${trimmed}\`).`,
            why: 'An earlier exit or exception bypassed this cleanup statement.',
            wasExecuted: false,
          };
    }

    return isBn
      ? {
          text: `বর্তমান ইনপুটের পথে এই অংশটি (\`${trimmed}\`) সক্রিয়ভাবে চলেনি${pySuffixBn}; এটি একটি অপ্রবেশকৃত শাখা বা ব্লকের ভেতরে অবস্থিত।`,
          why: 'প্রোগ্রাম কেবল সক্রিয়ভাবে নির্বাচিত পথের স্টেটমেন্টগুলোই কার্যকর করে এবং বাকি শাখাগুলো নিরাপদে এড়িয়ে চলে।',
          wasExecuted: false,
        }
      : {
          text: `Skipped in the current execution path: \`${trimmed}\` sits inside an unentered branch${pySuffixEn}.`,
          why: 'Control flow executes only statements along active branches for the given input.',
          wasExecuted: false,
        };
  }

  // Executed Python indentation block-end annotation if called directly
  if (language === 'python' && pythonEndInfo?.wasBlockExecuted) {
    const scopeLabel = getScopeLabel(pythonEndInfo.kind, explainLanguage);
    return isBn
      ? {
          text: `লাইন ${lineNumber} (\`${trimmed}\`) সফলভাবে চলেছে এবং এখানে ${scopeLabel} ব্লকের ইন্ডেন্টেশন শেষ হয়ে নিয়ন্ত্রণ বাইরের স্তরে ফিরছে।`,
          why: 'Python-এ ইন্ডেন্টেশন কমে গেলে চলমান ব্লক সমাপ্ত হয়ে পরের ধাপে নিয়ন্ত্রণ চলে যায়।',
          wasExecuted: true,
        }
      : {
          text: `Line ${lineNumber} (\`${trimmed}\`) executed as the final line of this ${scopeLabel} indentation block, returning control outward.`,
          why: 'Dedenting in Python marks the end of the enclosing block scope.',
          wasExecuted: true,
        };
  }

  return isBn
    ? {
        text: `লাইন ${lineNumber}-এর স্টেটমেন্টটি সক্রিয়ভাবে এক্সিকিউট হয়ে প্রোগ্রামের স্টেট এগিয়ে নিয়েছে।`,
        why: 'ধাপে ধাপে এক্সিকিউশনের মাধ্যমে এটি ফলাফল নির্ধারণে ভূমিকা রেখেছে।',
        wasExecuted: true,
      }
    : {
        text: `Statement on line ${lineNumber} executed actively along the runtime path.`,
        why: 'Contributes directly to the computed runtime state.',
        wasExecuted: true,
      };
}

/**
 * Dynamically analyzes static + runtime Time & Space complexity across Java, C++, Python, and JS.
 */
export function analyzeCodeComplexity(
  code: string,
  language: SupportedLanguage,
  steps: TraceStep[] = []
): ComplexityAnalysisResult {
  const clean = stripCommentsAndLiterals(code, language);
  const lines = clean.split('\n');
  const rawLines = code.split('\n');

  let maxLoopDepth = 0;
  let hasAnyLoop = false;
  let hasLogLoop = false;
  let hasSortCall = /\b(?:Collections\.sort|Arrays\.sort|std::sort|sorted\s*\(|\.sort\s*\()/.test(clean);

  if (language === 'python') {
    const loopIndents: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      const indent = (rawLines[i].match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
      while (loopIndents.length > 0 && indent <= loopIndents[loopIndents.length - 1]) {
        loopIndents.pop();
      }
      if (/^(?:for|while)\b.*:\s*$/.test(t)) {
        hasAnyLoop = true;
        loopIndents.push(indent);
        if (loopIndents.length > maxLoopDepth) maxLoopDepth = loopIndents.length;
      }
      if (/\b\w+\s*(?:\*=|\/\/=|\/=|>>=|<<=)\s*2\b|\bmid\s*=\s*\(?\s*(?:low|left|l|start)\s*\+/.test(t)) {
        hasLogLoop = true;
      }
    }
  } else {
    const scopeIsLoop: boolean[] = [];
    let currentLoopDepth = 0;
    let pendingLoopHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      const isLoopHdr = /^(?:for|while)\s*\(|^do\b/.test(t);
      if (isLoopHdr) {
        hasAnyLoop = true;
        if (
          /\*=\s*2\b|\/=\s*2\b|>>=\s*1\b|<<=\s*1\b|\bmid\s*=\s*/.test(t) ||
          /(?:low|left|start)\s*<=\s*(?:high|right|end)/.test(t)
        ) {
          hasLogLoop = true;
        }
      }
      if (/\b\w+\s*(?:\*=|\/=|>>=|<<=)\s*2\b|\bmid\s*=\s*\(?\s*(?:low|left|l|start)\s*\+/.test(t)) {
        hasLogLoop = true;
      }

      if (t.includes('{')) {
        for (const ch of t) {
          if (ch === '{') {
            const countsAsLoop = isLoopHdr || pendingLoopHeader;
            pendingLoopHeader = false;
            scopeIsLoop.push(countsAsLoop);
            if (countsAsLoop) {
              currentLoopDepth++;
              if (currentLoopDepth > maxLoopDepth) maxLoopDepth = currentLoopDepth;
            }
          } else if (ch === '}') {
            const popped = scopeIsLoop.pop();
            if (popped) currentLoopDepth = Math.max(0, currentLoopDepth - 1);
          }
        }
      } else if (t.includes('}')) {
        for (const ch of t) {
          if (ch === '}') {
            const popped = scopeIsLoop.pop();
            if (popped) currentLoopDepth = Math.max(0, currentLoopDepth - 1);
          }
        }
      } else if (isLoopHdr && !t.endsWith(';')) {
        pendingLoopHeader = true;
        if (currentLoopDepth + 1 > maxLoopDepth) maxLoopDepth = currentLoopDepth + 1;
      } else if (pendingLoopHeader && t.endsWith(';')) {
        pendingLoopHeader = false;
      }
    }
  }

  // Higher-order JS/Python array iteration methods (count as loop if present)
  if (!hasAnyLoop && /\.(?:forEach|map|reduce|filter|stream\s*\()/.test(clean)) {
    hasAnyLoop = true;
    maxLoopDepth = Math.max(maxLoopDepth, 1);
  }
  if (!hasAnyLoop && steps.some((s) => s.actionType === 'LOOP_CHECK' || s.actionType === 'LOOP')) {
    hasAnyLoop = true;
    maxLoopDepth = Math.max(maxLoopDepth, 1);
  }

  // Detect recursion (function name called inside its own body)
  let recursionKind: 'none' | 'linear' | 'branching' | 'log' = 'none';
  const fnDefs: { name: string; startLine: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const m =
      language === 'python'
        ? t.match(/^def\s+([A-Za-z_]\w*)\s*\(/)
        : t.match(
            /^(?:(?:public|private|protected|static|final|inline)\s+)*(?:function|void|int|long|double|float|boolean|bool|String|string|auto)\s+([A-Za-z_]\w*)\s*\(/
          );
    if (m && m[1] !== 'main') {
      fnDefs.push({ name: m[1], startLine: i });
    }
  }

  for (let f = 0; f < fnDefs.length; f++) {
    const fn = fnDefs[f];
    const endIdx = f + 1 < fnDefs.length ? fnDefs[f + 1].startLine : lines.length;
    const bodyText = lines.slice(fn.startLine + 1, endIdx).join('\n');
    const selfCalls = bodyText.match(new RegExp(`\\b${fn.name}\\s*\\(`, 'g')) || [];
    if (selfCalls.length >= 2) {
      recursionKind = /\bmid\b|\/\s*2|\/\/\s*2/.test(bodyText) ? 'log' : 'branching';
    } else if (selfCalls.length === 1) {
      recursionKind = /\bmid\b|\/\s*2|\/\/\s*2/.test(bodyText) ? 'log' : 'linear';
    }
  }

  // Detect auxiliary space allocations
  const has2DAlloc =
    /\[\s*[^\]]+\s*\]\s*\[\s*[^\]]+\s*\]|vector\s*<\s*vector\s*</.test(clean);
  const hasAuxCollection =
    /\bnew\s+(?:ArrayList|LinkedList|HashMap|TreeMap|HashSet|TreeSet|Stack|Queue|ArrayDeque)\b/.test(clean) ||
    /\bnew\s+(?:int|long|double|float|boolean|char|String|Array)\s*\[/.test(clean) ||
    /\b(?:vector|unordered_map|map|unordered_set|set|stack|queue|deque)\s*</.test(clean) ||
    /\[\s*[^\]]+\s*for\s+\w+\s+in\b/.test(clean) ||
    /=\s*(?:\[\s*\]|\{\s*\}|set\s*\(|dict\s*\()/.test(clean) ||
    (hasAnyLoop && /\.(?:push|push_back|add|append|put|insert)\s*\(/.test(clean));
  const hasScalarArrayRuntime = steps.some((s) =>
    Object.values(s.variables || {}).some((v) => Array.isArray(v) && v.length > 0)
  );

  // Compute Time Complexity
  let time = 'O(1)';
  if (recursionKind === 'branching') {
    time = 'O(2^n)';
  } else if (recursionKind === 'log' && hasSortCall) {
    time = 'O(n log n)';
  } else if (hasSortCall || (maxLoopDepth === 1 && hasLogLoop && /\bfor\b.*\bfor\b/.test(clean))) {
    time = maxLoopDepth >= 2 ? 'O(n^2)' : 'O(n log n)';
  } else if (maxLoopDepth >= 3) {
    time = 'O(n^3)';
  } else if (maxLoopDepth === 2) {
    time = 'O(n^2)';
  } else if (recursionKind === 'log' || (maxLoopDepth === 1 && hasLogLoop)) {
    time = 'O(log n)';
  } else if (maxLoopDepth === 1 || hasAnyLoop || recursionKind === 'linear') {
    time = 'O(n)';
  }

  // Compute Space Complexity
  let space = 'O(1)';
  if (has2DAlloc) {
    space = 'O(n^2)';
  } else if (hasAuxCollection || recursionKind === 'linear' || recursionKind === 'branching' || hasScalarArrayRuntime) {
    space = 'O(n)';
  } else if (recursionKind === 'log') {
    space = 'O(log n)';
  }

  const noteBn =
    time === 'O(1)' && space === 'O(1)'
      ? 'কোনো লুপ বা ডায়নামিক রিকার্শন না থাকায় ধ্রুব সময় O(1) ও স্থির মেমোরি O(1) ব্যবহৃত হয়েছে।'
      : time === 'O(n^2)'
      ? `নেস্টেড লুপের কারণে সময় জটিলতা ${time} এবং মেমোরি ব্যবহার ${space}।`
      : time === 'O(log n)'
      ? `প্রতি ধাপে সার্চ স্পেস অর্ধেক হয়ে যাওয়ায় সময় জটিলতা ${time} ও মেমোরি ${space}।`
      : time === 'O(n log n)'
      ? `সর্টিং বা ডিভাইড-অ্যান্ড-কনকার লজিকের কারণে সময় জটিলতা ${time} ও মেমোরি ${space}।`
      : time === 'O(2^n)'
      ? `একাধিক ব্রাঞ্চিং রিকার্সিভ কলের কারণে সময় জটিলতা ${time} এবং কল স্ট্যাকের জন্য মেমোরি ${space}।`
      : `একক লুপ বা লিনিয়ার প্রবাহের কারণে সময় জটিলতা ${time} এবং অতিরিক্ত মেমোরি ${space}।`;

  const noteEn =
    time === 'O(1)' && space === 'O(1)'
      ? 'No loops or recursion are present, yielding constant O(1) time and O(1) auxiliary space.'
      : `Analyzed control flow and allocations give ${time} time complexity and ${space} auxiliary space.`;

  return { time, space, noteBn, noteEn };
}

/**
 * Generates language-specific, code-grounded common pitfalls in Bangla or English.
 */
export function generateLanguagePitfalls(
  code: string,
  language: SupportedLanguage,
  explainLanguage: ExplainLanguage
): string[] {
  const clean = stripCommentsAndLiterals(code, language);
  const isBn = explainLanguage === 'bn';
  const tips: string[] = [];

  const pushTip = (bn: string, en: string) => {
    const val = isBn ? bn : en;
    if (!tips.includes(val) && tips.length < 4) tips.push(val);
  };

  if (language === 'java') {
    if (/\bScanner\b/.test(clean)) {
      if (/\.(?:nextInt|nextDouble|nextFloat|nextLong)\s*\(/.test(clean) && /\.nextLine\s*\(/.test(clean)) {
        pushTip(
          'Java-তে `nextInt()` বা `nextDouble()`-এর পরে সরাসরি `nextLine()` ব্যবহার করলে বাফারে থাকা নিউলাইন (`\\n`) পড়ে যেতে পারে—তাই মাঝে একটি বাড়তি `scanner.nextLine()` কল করা নিরাপদ।',
          'In Java, calling `nextLine()` right after `nextInt()`/`nextDouble()` reads the leftover newline; add an extra `scanner.nextLine()` to flush the buffer.'
        );
      } else {
        pushTip(
          'Java `Scanner` ব্যবহার করার সময় ভুল টাইপের ইনপুট দিলে `InputMismatchException` এবং পর্যাপ্ত STDIN না থাকলে `NoSuchElementException` হতে পারে; কাজ শেষে `scanner.close()` করা ভালো অভ্যাস।',
          'Reading mismatched or missing STDIN tokens with Java `Scanner` throws `InputMismatchException` or `NoSuchElementException`; always close resources cleanly.'
        );
      }
    }
    if (/\bint\b/.test(clean) && /\/(?!=)/.test(clean)) {
      pushTip(
        'Java-তে দুটি পূর্ণসংখ্যার (`int / int`) ভাগ করলে দশমিক অংশ স্বয়ংক্রিয়ভাবে বাদ পড়ে যায় (যেমন `5 / 2 = 2`); দশমিক ফলাফল চাইলে `(double)` কাস্ট করুন।',
        'Integer division (`int / int`) in Java truncates decimals (e.g., `5 / 2 == 2`); cast an operand with `(double)` when fractional precision is required.'
      );
    }
    if (/\bString\b/.test(clean) && /==/.test(clean)) {
      pushTip(
        'Java-তে দুটি `String`-এর লেখা তুলনা করতে `==` এর পরিবর্তে `.equals()` ব্যবহার করুন, কারণ `==` রেফারেন্স (মেমোরির ঠিকানা) তুলনা করে।',
        'Use `.equals()` instead of `==` to compare Java `String` contents, because `==` compares object references.'
      );
    }
    if (/\[[^\]]+\]|\b(?:ArrayList|charAt|get)\b/.test(clean)) {
      pushTip(
        'অ্যারে বা `ArrayList`-এ ইনডেক্স সবসময় `0` থেকে `length - 1` (বা `size() - 1`) পর্যন্ত হয়; সীমার বাইরে এক্সেস করলে `IndexOutOfBoundsException` ঘটবে।',
        'Array and `ArrayList` indices run from `0` to `length - 1`; accessing outside that range throws `IndexOutOfBoundsException`.'
      );
    }
    if (/\bswitch\b/.test(clean)) {
      pushTip(
        'Java `switch` ব্লকে প্রতিটি `case`-এর শেষে `break;` দিতে না ভুললে পরের কেসগুলোতেও এক্সিকিউশন নেমে যেতে পারে (Fall-through)।',
        'Remember `break;` at the end of each Java `switch` case to avoid unintended fall-through.'
      );
    }
    if (/\bif\s*\(/.test(clean)) {
      pushTip(
        '`if / else if` শর্তে সীমারেখা (`>=` বনাম `>`) ও `&&` / `||` অপারেটরের অগ্রাধিকার সতর্কতার সাথে দিন যাতে কোনো ইনপুট রেঞ্জ বাদ না পড়ে।',
        'Double-check boundary operators (`>=` vs `>`) and `&&`/`||` conditions in `if / else if` ladders so edge values are handled.'
      );
    }
  } else if (language === 'cpp') {
    if (/\b(?:int|double|float|long|char|bool)\s+[A-Za-z_]\w*\s*;/.test(clean)) {
      pushTip(
        'C++-এ মান না দিয়ে শুধু ভ্যারিয়েবল ডিক্লেয়ার করলে (যেমন `int x;`) তাতে গার্বেজ ভ্যালু (অজানা মান) থাকতে পারে—তাই ডিক্লেয়ারের সময়ই `= 0` বা প্রাথমিক মান দিন।',
        'Uninitialized local variables in C++ (e.g. `int x;`) contain indeterminate garbage values; always initialize them explicitly.'
      );
    }
    if (/\[[^\]]+\]|\bvector\s*</.test(clean)) {
      pushTip(
        'C++ অ্যারে বা `vector`-এ `[]` দিয়ে সীমার বাইরের ইনডেক্স এক্সেস করলে বাউন্ডস চেক হয় না এবং Undefined Behavior ঘটে; নিরাপদ এক্সেসের জন্য `.at(i)` বা সীমা যাচাই করুন।',
        'Bracket indexing `arr[i]` on C++ arrays and `vector` performs no bounds checking and causes undefined behavior out of range; validate bounds or use `.at(i)`.'
      );
    }
    if (/\bcin\s*>>/.test(clean) && /\bgetline\b/.test(clean)) {
      pushTip(
        'C++-এ `cin >>` ব্যবহারের পর `getline(cin, str)` চালালে বাফারে থাকা নিউলাইন পড়ে ফাঁকা স্ট্রিং আসতে পারে; মাঝে `cin.ignore()` ব্যবহার করুন।',
        'Mixing `cin >>` with `getline(cin, ...)` leaves a trailing newline in the buffer; call `cin.ignore()` in between.'
      );
    }
    if (/\bint\b/.test(clean) && /\/(?!=)/.test(clean)) {
      pushTip(
        'C++-এ দুটি `int` সংখ্যা ভাগ করলে পূর্ণসংখ্যার ভাগফল পাওয়া যায়; দশমিক মান পেতে `static_cast<double>(a) / b` বা `1.0 * a / b` ব্যবহার করুন।',
        'Dividing two `int` values in C++ truncates the fractional part; multiply by `1.0` or cast to `double` for floating-point division.'
      );
    }
    if (/\bif\s*\(/.test(clean)) {
      pushTip(
        'শর্তের ভেতরে সমতা যাচাই করতে অবশ্যই `==` লিখুন; ভুলে `=` লিখে ফেললে তা অ্যাসাইনমেন্ট হয়ে অপ্রত্যাশিত ফলাফল দেবে।',
        'Ensure equality checks inside C++ `if` conditions use `==` rather than assignment `=`.'
      );
    }
  } else if (language === 'python') {
    if (/\binput\s*\(/.test(clean)) {
      pushTip(
        'Python-এ `input()` সবসময় স্ট্রিং (`str`) রিটার্ন করে; গাণিতিক হিসাবের আগে অবশ্যই `int(...)` বা `float(...)` দিয়ে টাইপ কনভার্ট করতে হবে, নইলে `TypeError` বা ভুল স্ট্রিং যোগ ঘটবে।',
        'In Python, `input()` always returns a `str`; convert it with `int()` or `float()` before arithmetic to prevent `TypeError` or string concatenation.'
      );
    }
    if (/\/(?!=)/.test(clean)) {
      pushTip(
        'Python-এ `/` অপারেটর সবসময় দশমিক (`float`) ফল দেয়, আর `//` পূর্ণসংখ্যার ফ্লোর ভাগ দেয় (ঋণাত্মক সংখ্যার ক্ষেত্রে আরও ছোট পূর্ণসংখ্যায় নামে)।',
        'Python `/` always produces a `float`, whereas `//` performs floor division (rounding negative results downward).'
      );
    }
    if (/\brange\s*\(/.test(clean)) {
      pushTip(
        'Python-এর `range(start, stop)` ফাংশনে শেষ মান `stop` অন্তর্ভুক্ত থাকে না (`stop - 1` পর্যন্ত চলে)—লুপের সীমা নির্ধারণে এই অফ-বাই-ওয়ান বিষয়টি মাথায় রাখুন।',
        'Python `range(start, stop)` stops at `stop - 1` (the upper bound is exclusive), which is a common off-by-one pitfall.'
      );
    }
    pushTip(
      'Python ব্লকগুলো সম্পূর্ণ ইন্ডেন্টেশনের (সাধারণত ৪টি স্পেস) ওপর নির্ভর করে; স্পেস ও ট্যাব মেশালে `IndentationError` বা লজিক ব্লকের ভুল ঘটে।',
      'Python blocks rely strictly on consistent indentation (4 spaces); mixing spaces and tabs triggers `IndentationError`.'
    );
  } else {
    // JavaScript
    if (/==(?!=)|!=(?!=)/.test(clean)) {
      pushTip(
        'JavaScript-এ `==` স্বয়ংক্রিয় টাইপ কনভার্সন করে (যেমন `"5" == 5` true হয়); নিরাপদ ও নির্ভুল তুলনার জন্য সবসময় স্ট্রিক্ট `===` ও `!==` ব্যবহার করুন।',
        'JavaScript `==` performs implicit type coercion (e.g. `"5" == 5`); prefer strict equality `===` and `!==`.'
      );
    }
    if (/\b(?:Number|parseInt|parseFloat|prompt)\s*\(/.test(clean) || /\+/.test(clean)) {
      pushTip(
        'JavaScript-এ স্ট্রিং ও সংখ্যা `+` দিয়ে যোগ করলে স্ট্রিং কনক্যাটেনেশন (`"10" + 5 === "105"`) হয়ে যেতে পারে এবং অকার্যকর সংখ্যা কনভার্ট করলে `NaN` তৈরি হয়—তাই ইনপুট সংখ্যার আগে `Number()` ও `Number.isNaN()` যাচাই করুন।',
        'In JavaScript, `+` with a string concatenates instead of adding (`"10" + 5 === "105"`), and invalid numeric parses yield `NaN`; validate with `Number()` and `Number.isNaN()`.'
      );
    }
    if (/\bvar\b/.test(clean)) {
      pushTip(
        'JavaScript-এ `var` ফাংশন-স্কোপড ও হোয়েস্টেড হওয়ায় ব্লকের বাইরেও লিক হতে পারে; আধুনিক ও নিরাপদ কোডের জন্য `let` বা `const` ব্যবহার করুন।',
        'Avoid `var` in JavaScript because it is function-scoped and hoisted; prefer block-scoped `let` and `const`.'
      );
    }
    if (/\[[^\]]+\]/.test(clean)) {
      pushTip(
        'JavaScript অ্যারেতে সীমার বাইরের ইনডেক্স এক্সেস করলে এরর না দিয়ে `undefined` রিটার্ন করে, যা পরবর্তীতে `NaN` বা `TypeError` তৈরি করতে পারে।',
        'Out-of-bounds array indexing in JavaScript silently returns `undefined` instead of throwing, which can propagate as `NaN` or `TypeError`.'
      );
    }
  }

  // Fallback language-specific safeguard if fewer than 2 tips matched
  if (tips.length < 2) {
    if (language === 'java' || language === 'cpp') {
      pushTip(
        `${language === 'java' ? 'Java' : 'C++'}-এ প্রতিটি স্টেটমেন্টের শেষে সেমিকোলন (\`;\`) এবং ব্লকের প্রতিটি খোলা ব্র্যাকেটের (\`{\`) বিপরীতে সমাপ্তি ব্র্যাকেট (\`}\`) সঠিকভাবে মেলানো আছে কি না নিশ্চিত করুন।`,
        `Ensure every statement ends with a semicolon (\`;\`) and every opening brace has a matching closing brace in ${language.toUpperCase()}.`
      );
    } else if (language === 'python') {
      pushTip(
        'Python একটি ডায়নামিকভাবে টাইপকৃত ভাষা, তাই একই ভ্যারিয়েবলে ভিন্ন টাইপের মান রাখলে পরের অপারেশনে `TypeError` হতে পারে।',
        'Because Python is dynamically typed, reassigning variables to incompatible types can trigger `TypeError` downstream.'
      );
    } else {
      pushTip(
        'JavaScript-এ স্কোপ সীমাবদ্ধ রাখতে `const` ও `let` ব্যবহার করুন এবং `===` দিয়ে মান ও টাইপ একসাথে যাচাই করুন।',
        'Use `const`/`let` for predictable block scope and `===` for type-safe comparisons in JavaScript.'
      );
    }
  }

  return tips;
}

