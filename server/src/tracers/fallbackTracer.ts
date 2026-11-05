import vm from 'node:vm';
import {
  AnalogyType,
  CompilationErrorType,
  ExecutionTrace,
  ExplainLanguage,
  ExplanationDepth,
  LineNote,
  LineRole,
  MemoryDelta,
  RuntimeActionType,
  StepAction,
  StepStructure,
  SupportedLanguage,
  TraceErrorDetails,
  TraceSource,
  TraceStep,
  VariableChange,
} from '../../../shared/types';
import { SAMPLE_PROGRAMS } from '../../../src/data/sampleTraces';
import {
  RecordedJsStep,
  matchCuratedLibraryProblemTrace,
  runDeterministicMultiLanguage,
  stripCommentsPreservingLines,
} from './realExecutionRunner';

const VALID_CODE_KEYWORDS =
  /\b(let|const|var|int|float|double|long|short|char|bool|boolean|void|string|String|auto|for|while|do|if|else|elif|switch|case|default|break|continue|pass|return|function|def|class|struct|public|private|protected|static|import|from|export|include|using|namespace|std|try|catch|except|finally|throw|throws|raise|console|print|printf|cout|cin|System|FileReader|Scanner|File|main|new|true|false|True|False|null|None|nullptr)\b/;

const COMMON_TYPO_PATTERNS: {
  regex: RegExp;
  errorType: CompilationErrorType;
  msgBn: string;
  solBn: string;
  msgEn: string;
}[] = [
  {
    regex: /\bpublik\s+class\b/,
    errorType: 'SYNTAX_ERROR',
    msgBn: '`publik` একটি ভুল কিওয়ার্ড (Invalid keyword)।',
    solBn: '`publik`-এর পরিবর্তে সঠিক কিওয়ার্ড `public` লিখুন।',
    msgEn: 'Invalid keyword `publik`. Use `public` instead.',
  },
  {
    regex: /\b(?:statik|stati)\s+void\b/,
    errorType: 'SYNTAX_ERROR',
    msgBn: '`static` কিওয়ার্ডের বানান ভুল লেখা হয়েছে।',
    solBn: 'সঠিক বানান `static void` লিখুন।',
    msgEn: 'Misspelled keyword `static`.',
  },
  {
    regex: /\bvoide\s+main\b/,
    errorType: 'SYNTAX_ERROR',
    msgBn: '`voide` একটি ভুল রিটার্ন টাইপ।',
    solBn: '`voide`-এর পরিবর্তে `void` লিখুন।',
    msgEn: 'Invalid return type `voide`. Use `void`.',
  },
  {
    regex: /^(?:public|private|protected|static|\s)*\binte\s+[A-Za-z_$]/,
    errorType: 'COMPILATION_ERROR',
    msgBn: '`inte` কোনো বৈধ ডেটা টাইপ নয় (Unknown type)।',
    solBn: 'পূর্ণসংখ্যার জন্য `int` ডেটা টাইপ ব্যবহার করুন।',
    msgEn: 'Unknown type `inte`. Did you mean `int`?',
  },
  {
    regex: /^(?:public|private|protected|static|\s)*\bbooleen\s+[A-Za-z_$]/,
    errorType: 'COMPILATION_ERROR',
    msgBn: '`booleen` কোনো বৈধ ডেটা টাইপ নয়।',
    solBn: '`booleen`-এর পরিবর্তে `boolean` লিখুন।',
    msgEn: 'Unknown type `booleen`. Did you mean `boolean`?',
  },
  {
    regex: /\bsystem\.out\.print/,
    errorType: 'COMPILATION_ERROR',
    msgBn: 'জাভা কেস-সেনসিটিভ (case-sensitive); ছোট হাতের `system` ক্লাস খুঁজে পাওয়া যায়নি।',
    solBn: '`system.out`-এর পরিবর্তে বড় হাতের `S` দিয়ে `System.out.println(...)` লিখুন।',
    msgEn: 'Package `system` does not exist. Use uppercase `System.out.println(...)`.',
  },
  {
    regex: /\bSystem\.out\.(?:printl|prinln|printfn|pirnt|pritnln)\s*\(/,
    errorType: 'COMPILATION_ERROR',
    msgBn: '`System.out`-এর মেথডের নাম ভুল লেখা হয়েছে (cannot find symbol)।',
    solBn: 'সঠিকভাবে `System.out.println(...)` অথবা `System.out.print(...)` লিখুন।',
    msgEn: 'Cannot find method on `System.out`. Use `System.out.println(...)`.',
  },
  {
    regex: /\bconsol\.log\s*\(/,
    errorType: 'COMPILATION_ERROR',
    msgBn: '`consol` অবজেক্টটি সঠিক নয়।',
    solBn: '`consol.log`-এর পরিবর্তে `console.log(...)` লিখুন।',
    msgEn: '`consol` is not defined. Use `console.log(...)`.',
  },
  {
    regex: /^\s*pirnt\s*\(/,
    errorType: 'COMPILATION_ERROR',
    msgBn: '`pirnt` ফাংশনটি সঠিক নয় (NameError)।',
    solBn: '`pirnt(...)`-এর পরিবর্তে `print(...)` লিখুন।',
    msgEn: '`pirnt` is not defined. Use `print(...)`.',
  },
  {
    regex: /^\s*(?:iff|whille|fore|retun|retrun)\b/,
    errorType: 'SYNTAX_ERROR',
    msgBn: 'কন্ট্রোল কিওয়ার্ডের বানান ভুল হয়েছে (`iff`/`whille`/`fore`/`retun`)।',
    solBn: 'সঠিক কিওয়ার্ড (`if`, `while`, `for`, বা `return`) ব্যবহার করুন।',
    msgEn: 'Invalid control keyword spelling.',
  },
];

const BUILTIN_IDENTIFIERS = new Set([
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
  'interface',
  'enum',
  'extends',
  'implements',
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
  'new',
  'true',
  'false',
  'True',
  'False',
  'null',
  'None',
  'nullptr',
  'this',
  'super',
  'System',
  'out',
  'err',
  'in',
  'println',
  'print',
  'printf',
  'cout',
  'cin',
  'endl',
  'std',
  'swap',
  'max',
  'min',
  'abs',
  'main',
  'args',
  'Math',
  'Array',
  'Arrays',
  'Collections',
  'List',
  'ArrayList',
  'LinkedList',
  'Map',
  'HashMap',
  'Set',
  'HashSet',
  'Stack',
  'Queue',
  'Integer',
  'Long',
  'Double',
  'Float',
  'Boolean',
  'Character',
  'Object',
  'StringBuilder',
  'StringBuffer',
  'File',
  'FileReader',
  'FileInputStream',
  'BufferedReader',
  'Scanner',
  'Files',
  'Paths',
  'Exception',
  'RuntimeException',
  'ArithmeticException',
  'FileNotFoundException',
  'IOException',
  'NullPointerException',
  'ArrayIndexOutOfBoundsException',
  'IndexOutOfBoundsException',
  'NumberFormatException',
  'IllegalArgumentException',
  'Throwable',
  'MAX_VALUE',
  'MIN_VALUE',
  'INT_MAX',
  'INT_MIN',
  'length',
  'size',
]);

function makeErrorDetails(params: {
  errorType: CompilationErrorType;
  lineNumber: number;
  lineCode: string;
  messageBn: string;
  solutionBn: string;
  messageEn: string;
  explainLanguage: ExplainLanguage;
}): TraceErrorDetails {
  const {
    errorType,
    lineNumber,
    lineCode,
    messageBn,
    solutionBn,
    messageEn,
    explainLanguage,
  } = params;
  const formattedMessage =
    explainLanguage === 'bn'
      ? `[${errorType}] লাইন ${lineNumber}: ${messageBn} সমাধান: ${solutionBn}`
      : `[${errorType}] Line ${lineNumber}: ${messageEn}`;

  return {
    errorType,
    lineNumber,
    lineCode: lineCode.trim(),
    messageBn,
    solutionBn,
    line: lineNumber,
    message: formattedMessage,
  };
}

/**
 * Strips string and char literals from a line (replacing their contents with spaces)
 * so static token analysis doesn't confuse words inside quotes with variable names.
 */
function stripStringLiteralsFromLine(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

/**
 * Performs strict pre-execution static analysis and Java compilation (`javac` simulation) checks:
 * 1. File Name vs Public Class Name Check (`FILE_NAME_MISMATCH`)
 * 2. Bracket/brace/parenthesis & string literal checks (`SYNTAX_ERROR`)
 * 3. Missing semicolons in Java and C++ (`SYNTAX_ERROR`)
 * 4. Invalid keywords, typos, and malformed statements (`SYNTAX_ERROR` / `COMPILATION_ERROR`)
 * 5. Type mismatch validation in Java and C++ (`COMPILATION_ERROR`)
 * 6. Undeclared variable detection in Java and C++ (`COMPILATION_ERROR`)
 */
export function detectSyntaxError(
  code: string,
  explainLanguage: ExplainLanguage,
  language: SupportedLanguage = 'javascript',
  fileName?: string
): TraceErrorDetails | null {
  const rawLines = code.split('\n');
  const trimmedCode = code.trim();
  if (!trimmedCode) {
    return makeErrorDetails({
      errorType: 'SYNTAX_ERROR',
      lineNumber: 1,
      lineCode: '',
      messageBn: 'এডিটর খালি আছে। রান করার জন্য বৈধ কোড লিখুন।',
      solutionBn: 'এডিটরে একটি বৈধ প্রোগ্রাম লিখে আবার রান করুন।',
      messageEn: 'Editor is empty. Please write valid code before running.',
      explainLanguage,
    });
  }

  // Extract any file name implied in comments (e.g. `// Test.java` or `// File: Test.java`)
  let impliedCommentFileName: string | undefined;
  for (let i = 0; i < Math.min(rawLines.length, 6); i++) {
    const m = rawLines[i]
      .trim()
      .match(/^(?:\/\/|\/\*+|\*)\s*(?:file(?:\s*name)?\s*:\s*)?([A-Za-z_$][\w$]*\.java)\b/i);
    if (m) {
      impliedCommentFileName = m[1];
      break;
    }
  }

  // Strip comments first while preserving 1-based line numbers
  const commentFree = stripCommentsPreservingLines(code, language);
  const lines = commentFree.split('\n');

  // Auto-detect if code is clearly Java
  const isJavaCode =
    language === 'java' ||
    /\bpublic\s+class\s+[A-Za-z_$]/.test(commentFree) ||
    /\bSystem\.out\.print/.test(commentFree);
  const effectiveLang: SupportedLanguage = isJavaCode ? 'java' : language;

  // 1. FILE NAME VS PUBLIC CLASS NAME CHECK (Java `javac` rule)
  if (effectiveLang === 'java') {
    let publicClassCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const cleaned = lines[i].trim();
      const pubClassMatch = cleaned.match(
        /\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/
      );
      if (pubClassMatch) {
        publicClassCount++;
        const publicClassName = pubClassMatch[1];
        const rawLineCode = rawLines[i]?.trim() || cleaned;

        if (publicClassCount > 1) {
          return makeErrorDetails({
            errorType: 'COMPILATION_ERROR',
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `একই ফাইলে একাধিক পাবলিক ক্লাস (\`public class ${publicClassName}\`) ঘোষণা করা যায় না।`,
            solutionBn: `শুধুমাত্র মূল ক্লাসটিকে \`public class\` রাখুন এবং অন্য ক্লাসগুলো থেকে \`public\` কিওয়ার্ড সরিয়ে দিন।`,
            messageEn: `Multiple public classes in a single file are not allowed in Java.`,
            explainLanguage,
          });
        }

        // Determine the file name to validate against
        const providedFile = impliedCommentFileName || fileName?.trim().split('/').pop();
        if (providedFile) {
          const isExplicitJavaFile = /\.java$/i.test(providedFile);
          // Validate whenever a .java file name is provided or when language is explicitly java and fileName isn't a stale non-java default
          const shouldValidateFileName =
            isExplicitJavaFile ||
            (language === 'java' &&
              !['main.js', 'main.py', 'main.cpp'].includes(providedFile.toLowerCase()));

          if (shouldValidateFileName) {
            const expectedClassName = providedFile.replace(/\.[a-z0-9]+$/i, '');
            if (expectedClassName !== publicClassName) {
              const displayFile = isExplicitJavaFile ? providedFile : `${expectedClassName}.java`;
              return makeErrorDetails({
                errorType: 'FILE_NAME_MISMATCH',
                lineNumber: lineNum,
                lineCode: rawLineCode,
                messageBn: `ফাইলের নাম (\`${displayFile}\`) এবং পাবলিক ক্লাসের নাম (\`${publicClassName}\`) এক নয়। জাভাতে \`public class ${publicClassName}\` অবশ্যই \`${publicClassName}.java\` নামের ফাইলে থাকতে হবে।`,
                solutionBn: `ফাইলের নাম পরিবর্তন করে \`${publicClassName}.java\` করুন অথবা লাইন ${lineNum}-এ ক্লাসের নাম পরিবর্তন করে \`public class ${expectedClassName}\` লিখুন।`,
                messageEn: `Class \`${publicClassName}\` is public, should be declared in a file named \`${publicClassName}.java\` (current file: \`${displayFile}\`).`,
                explainLanguage,
              });
            }
          }
        }
      }
    }
  }

  // 2. QUOTE & BRACKET / BRACE / PARENTHESIS BALANCE + BASIC LINE CHECKS
  const stack: { char: string; line: number; lineCode: string }[] = [];
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const closingToOpening: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
  let meaningfulCodeLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const cleaned = lines[i].trim();
    const rawLineCode = rawLines[i]?.trim() || cleaned;
    if (!cleaned) continue;

    // Check common keyword/method typos first
    for (const typo of COMMON_TYPO_PATTERNS) {
      if (typo.regex.test(cleaned)) {
        return makeErrorDetails({
          errorType: typo.errorType,
          lineNumber: lineNum,
          lineCode: rawLineCode,
          messageBn: `লাইন ${lineNum}-এ কম্পাইল/সিনট্যাক্স ত্রুটি: ${typo.msgBn}`,
          solutionBn: typo.solBn,
          messageEn: typo.msgEn,
          explainLanguage,
        });
      }
    }

    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    for (let c = 0; c < cleaned.length; c++) {
      const ch = cleaned[c];
      const prev = c > 0 ? cleaned[c - 1] : '';
      if (ch === "'" && prev !== '\\' && !inDouble && !inBacktick) inSingle = !inSingle;
      if (ch === '"' && prev !== '\\' && !inSingle && !inBacktick) inDouble = !inDouble;
      if (ch === '`' && prev !== '\\' && !inSingle && !inDouble) inBacktick = !inBacktick;
      if (!inSingle && !inDouble && !inBacktick) {
        if (pairs[ch]) {
          stack.push({ char: ch, line: lineNum, lineCode: rawLineCode });
        } else if (closingToOpening[ch]) {
          const last = stack.pop();
          if (!last || last.char !== closingToOpening[ch]) {
            return makeErrorDetails({
              errorType: 'SYNTAX_ERROR',
              lineNumber: lineNum,
              lineCode: rawLineCode,
              messageBn: `লাইন ${lineNum}-এ অমিল ব্র্যাকেট বা ব্রেস '${ch}' পাওয়া গেছে যার কোনো শুরুর '${closingToOpening[ch]}' নেই।`,
              solutionBn: `লাইন ${lineNum}-এ অতিরিক্ত '${ch}' সরিয়ে ফেলুন অথবা সঠিক স্থানে শুরুর '${closingToOpening[ch]}' ব্র্যাকেট দিন।`,
              messageEn: `Unmatched closing bracket '${ch}' on line ${lineNum}.`,
              explainLanguage,
            });
          }
        }
      }
    }

    if (inSingle || inDouble) {
      return makeErrorDetails({
        errorType: 'SYNTAX_ERROR',
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `লাইন ${lineNum}-এ স্ট্রিং বা ক্যারেক্টার কোটেশন (${inDouble ? '"' : "'"}) শেষ করা হয়নি।`,
        solutionBn: `লাইন ${lineNum}-এ স্ট্রিংয়ের শেষে সমাপনী কোটেশন (${inDouble ? '"' : "'"}) যুক্ত করুন।`,
        messageEn: `Unterminated string literal on line ${lineNum}.`,
        explainLanguage,
      });
    }

    // Check `int a == 5;` (using `==` instead of `=` in declaration)
    if (
      /^(?:let|const|var|int|long|short|byte|float|double|boolean|bool|String|string|char)\s+[A-Za-z_$][\w$]*\s*==/.test(
        cleaned
      )
    ) {
      return makeErrorDetails({
        errorType: 'SYNTAX_ERROR',
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `লাইন ${lineNum}-এ ভ্যারিয়েবল ডিক্লেয়ার করার সময় অ্যাসাইনমেন্ট অপারেটর \`=\`-এর পরিবর্তে তুলনা অপারেটর \`==\` ব্যবহার করা হয়েছে।`,
        solutionBn: `মান অ্যাসাইন করার জন্য \`==\`-এর বদলে একটি \`=\` চিহ্ন ব্যবহার করুন।`,
        messageEn: `Invalid '==' in variable declaration on line ${lineNum}. Use '=' for assignment.`,
        explainLanguage,
      });
    }

    // Check `x = ;`
    if (/=(?!=)\s*;/.test(cleaned)) {
      return makeErrorDetails({
        errorType: 'SYNTAX_ERROR',
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `লাইন ${lineNum}-এ সমান চিহ্নের (\`=\`) পরে কোনো মান বা এক্সপ্রেশন দেওয়া হয়নি।`,
        solutionBn: `\`=\` চিহ্নের ডানপাশে একটি বৈধ মান বা ভ্যারিয়েবল লিখুন।`,
        messageEn: `Missing expression after '=' on line ${lineNum}.`,
        explainLanguage,
      });
    }

    // Check invalid `===` or `!==` in Java / C++ / Python
    const noStrings = stripStringLiteralsFromLine(cleaned);
    if (
      (effectiveLang === 'java' || effectiveLang === 'cpp' || effectiveLang === 'python') &&
      /(?:===|!==)/.test(noStrings)
    ) {
      return makeErrorDetails({
        errorType: 'SYNTAX_ERROR',
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `লাইন ${lineNum}-এ \`===\` বা \`!==\` অপারেটর ব্যবহার করা হয়েছে যা ${effectiveLang.toUpperCase()} ভাষায় বৈধ নয়।`,
        solutionBn: `তুলনা করার জন্য \`==\` অথবা \`!=\` অপারেটর ব্যবহার করুন।`,
        messageEn: `'===' and '!==' are not valid operators in ${effectiveLang}. Use '==' or '!='.`,
        explainLanguage,
      });
    }

    const hasCodePunctuation = /[=(){}\[\];:+\-*/%<>!&|,.]/.test(cleaned);
    const hasKeyword = VALID_CODE_KEYWORDS.test(cleaned);

    if (!hasCodePunctuation && !hasKeyword) {
      return makeErrorDetails({
        errorType: 'SYNTAX_ERROR',
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `লাইন ${lineNum} (\`${cleaned.slice(0, 40)}\`) কোনো বৈধ প্রোগ্রামিং স্টেটমেন্ট বা সিনট্যাক্স নয়।`,
        solutionBn: `লাইন ${lineNum}-এর অপ্রয়োজনীয় টেক্সট মুছে বৈধ ${effectiveLang} কোড লিখুন।`,
        messageEn: `Line ${lineNum} (\`${cleaned.slice(0, 40)}\`) is not valid ${effectiveLang} syntax.`,
        explainLanguage,
      });
    }

    meaningfulCodeLines++;
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    const expectedClose = pairs[unclosed.char] || '}';
    return makeErrorDetails({
      errorType: 'SYNTAX_ERROR',
      lineNumber: unclosed.line,
      lineCode: unclosed.lineCode,
      messageBn: `লাইন ${unclosed.line}-এ খোলা '${unclosed.char}' ব্র্যাকেট/ব্রেসটি প্রোগ্রামের শেষেও বন্ধ ('${expectedClose}') করা হয়নি।`,
      solutionBn: `ব্লক বা এক্সপ্রেশনটি সম্পূর্ণ করতে উপযুক্ত স্থানে '${expectedClose}' যুক্ত করুন।`,
      messageEn: `Unclosed '${unclosed.char}' opened on line ${unclosed.line}. Expected '${expectedClose}'.`,
      explainLanguage,
    });
  }

  if (meaningfulCodeLines === 0) {
    return makeErrorDetails({
      errorType: 'SYNTAX_ERROR',
      lineNumber: 1,
      lineCode: rawLines[0] || '',
      messageBn: 'কোডে কোনো কার্যকর স্টেটমেন্ট পাওয়া যায়নি।',
      solutionBn: 'কমেন্টের পাশাপাশি অন্তত একটি কার্যকর কোড লাইন লিখুন।',
      messageEn: 'No executable code statements found.',
      explainLanguage,
    });
  }

  // 3. JAVASCRIPT VM COMPILATION CHECK
  if (effectiveLang === 'javascript') {
    try {
      new vm.Script(commentFree);
    } catch (err: any) {
      const stackStr = String(err?.stack || '');
      const lineMatch = stackStr.match(/evalmachine\.<anonymous>:(\d+)/);
      const errLine = lineMatch ? Number(lineMatch[1]) : 1;
      const rawMsg = String(err?.message || 'SyntaxError');
      const rawLineCode = rawLines[errLine - 1]?.trim() || '';
      return makeErrorDetails({
        errorType: 'SYNTAX_ERROR',
        lineNumber: errLine,
        lineCode: rawLineCode,
        messageBn: `লাইন ${errLine}-এ জাভাস্ক্রিপ্ট সিনট্যাক্স ত্রুটি: \`${rawMsg}\`।`,
        solutionBn: `লাইন ${errLine} (\`${rawLineCode}\`)-এর ব্র্যাকেট, অপারেটর বা কিওয়ার্ড পরীক্ষা করে সিনট্যাক্স ঠিক করুন।`,
        messageEn: `Syntax Error on line ${errLine}: ${rawMsg}`,
        explainLanguage,
      });
    }
  }

  // 4. STRICT JAVA & C++ STATIC COMPILER (`javac` / `g++`) VALIDATION
  if (effectiveLang === 'java' || effectiveLang === 'cpp') {
    // 4A. Missing semicolon check on every executable statement line
    let openParenDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const cleaned = lines[i].trim();
      const rawLineCode = rawLines[i]?.trim() || cleaned;
      if (!cleaned) continue;

      const strippedQuotes = stripStringLiteralsFromLine(cleaned);
      for (const ch of strippedQuotes) {
        if (ch === '(') openParenDepth++;
        else if (ch === ')') openParenDepth = Math.max(0, openParenDepth - 1);
      }

      // Skip preprocessor directives or annotations
      if (cleaned.startsWith('#') || cleaned.startsWith('@')) continue;

      // Skip lines ending with `{`, `}`, `,`, `:` or while multi-line parentheses are open
      if (
        cleaned.endsWith('{') ||
        cleaned.endsWith('}') ||
        cleaned.endsWith(',') ||
        cleaned.endsWith(':') ||
        openParenDepth > 0
      ) {
        continue;
      }

      // Skip control/declaration headers whose `{` is on a following line
      const isHeaderWithoutBrace =
        /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*(?:class|interface|enum|struct)\b/.test(
          cleaned
        ) ||
        /^(?:\}?\s*)?(?:if|else\s+if|for|while|switch|catch)\s*\(.*\)\s*$/.test(cleaned) ||
        /^(?:\}?\s*)?(?:else|try|finally|do)\s*$/.test(cleaned) ||
        /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|synchronized\s+)*(?:void|int|long|short|byte|double|float|boolean|bool|char|String|string|auto)\s+[A-Za-z_$][\w$]*\s*\([^;]*\)(?:\s*throws\s+[A-Za-z0-9_.,\s]+)?\s*$/.test(
          cleaned
        );

      if (isHeaderWithoutBrace) {
        continue;
      }

      // Skip multi-line expression continuations (line ends with binary operator or next line starts with `.` or `<<` or `+`)
      if (/[+\-*/%&|^=<>?:]$/.test(cleaned)) {
        continue;
      }
      let nextNonEmpty = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) {
          nextNonEmpty = lines[j].trim();
          break;
        }
      }
      if (/^(?:\.|<<|>>|\+|\?|:|&&|\|\|)/.test(nextNonEmpty)) {
        continue;
      }

      // Every other statement in Java / C++ MUST end with `;`
      if (!cleaned.endsWith(';')) {
        return makeErrorDetails({
          errorType: 'SYNTAX_ERROR',
          lineNumber: lineNum,
          lineCode: rawLineCode,
          messageBn: `লাইন ${lineNum}-এ স্টেটমেন্টের শেষে সেমিকোলন (\`;\`) দেওয়া হয়নি।`,
          solutionBn: `লাইন ${lineNum}-এর শেষে একটি সেমিকোলন যুক্ত করুন: \`${rawLineCode};\``,
          messageEn: `';' expected at the end of line ${lineNum}: \`${rawLineCode}\`.`,
          explainLanguage,
        });
      }
    }

    // 4B. Static Type Checking & Undeclared Variable (`cannot find symbol`) Checking
    type StaticVarType = 'int' | 'float' | 'boolean' | 'String' | 'char' | 'array' | 'object';
    const declaredVars = new Map<string, StaticVarType>();
    const declaredFunctions = new Set<string>(['main']);

    // Pre-pass: collect method names and their parameter names
    for (let i = 0; i < lines.length; i++) {
      const cleaned = lines[i].trim();
      const fnHeader = cleaned.match(
        /^(?:(?:public|private|protected|static|final)\s+)*(?:void|int|long|short|byte|double|float|boolean|bool|String|string|char)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/
      );
      if (fnHeader) {
        declaredFunctions.add(fnHeader[1]);
        const params = fnHeader[2]
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of params) {
          const cleanP = p.replace(/\[\s*\]/g, '').trim();
          const parts = cleanP.split(/\s+/);
          const paramName = parts[parts.length - 1];
          const paramTypeRaw = parts[0] || '';
          if (paramName && /^[A-Za-z_$][\w$]*$/.test(paramName)) {
            declaredVars.set(
              paramName,
              /^(?:int|long|short|byte)$/.test(paramTypeRaw)
                ? 'int'
                : /^(?:double|float)$/.test(paramTypeRaw)
                ? 'float'
                : /^(?:boolean|bool)$/.test(paramTypeRaw)
                ? 'boolean'
                : /^(?:String|string)$/.test(paramTypeRaw)
                ? 'String'
                : 'object'
            );
          }
        }
      }
    }

    const inferLiteralOrVarType = (rhsRaw: string): StaticVarType | null => {
      const rhs = rhsRaw.trim().replace(/;$/, '').trim();
      if (!rhs) return null;
      if (/^"(?:\\.|[^"\\])*"$/.test(rhs)) return 'String';
      if (/^'(?:\\.|[^'\\])*'$/.test(rhs)) return 'char';
      if (rhs === 'true' || rhs === 'false') return 'boolean';
      if (/^-?\d+\.\d+[fFdD]?$/.test(rhs)) return 'float';
      if (/^-?\d+[lL]?$/.test(rhs)) return 'int';
      if (declaredVars.has(rhs)) return declaredVars.get(rhs)!;
      return null;
    };

    const mapTypeKeyword = (typeKw: string, isArrayDecl: boolean): StaticVarType => {
      if (isArrayDecl) return 'array';
      if (/^(?:int|long|short|byte|size_t)$/.test(typeKw)) return 'int';
      if (/^(?:double|float)$/.test(typeKw)) return 'float';
      if (/^(?:boolean|bool)$/.test(typeKw)) return 'boolean';
      if (/^(?:String|string)$/.test(typeKw)) return 'String';
      if (typeKw === 'char') return 'char';
      return 'object';
    };

    const checkTypeCompatibility = (
      varName: string,
      expectedType: StaticVarType,
      rhsExpr: string,
      lineNum: number,
      rawLineCode: string
    ): TraceErrorDetails | null => {
      const rhsType = inferLiteralOrVarType(rhsExpr);
      if (!rhsType) return null;

      if (expectedType === 'int') {
        if (rhsType === 'String') {
          return makeErrorDetails({
            errorType: 'COMPILATION_ERROR',
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `লাইন ${lineNum}-এ টাইপ অমিল (Incompatible types): \`String\` মান (${rhsExpr}) পূর্ণসংখ্যা (\`int\`) ভ্যারিয়েবল \`${varName}\`-এ রাখা যাবে না।`,
            solutionBn: `\`${varName}\`-এ পূর্ণসংখ্যা মান দিন (কোটেশন ছাড়া) অথবা ভ্যারিয়েবলটির টাইপ \`String\` হিসেবে ডিক্লেয়ার করুন।`,
            messageEn: `Incompatible types on line ${lineNum}: String cannot be converted to int.`,
            explainLanguage,
          });
        }
        if (rhsType === 'boolean' && effectiveLang === 'java') {
          return makeErrorDetails({
            errorType: 'COMPILATION_ERROR',
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `লাইন ${lineNum}-এ টাইপ অমিল (Incompatible types): \`boolean\` মান (\`${rhsExpr}\`) \`int\` ভ্যারিয়েবল \`${varName}\`-এ রাখা যাবে না।`,
            solutionBn: `\`${varName}\`-এ পূর্ণসংখ্যা মান দিন অথবা ভ্যারিয়েবলটির টাইপ \`boolean\` করুন।`,
            messageEn: `Incompatible types on line ${lineNum}: boolean cannot be converted to int.`,
            explainLanguage,
          });
        }
        if (rhsType === 'float' && effectiveLang === 'java') {
          return makeErrorDetails({
            errorType: 'COMPILATION_ERROR',
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `লাইন ${lineNum}-এ টাইপ অমিল (Possible lossy conversion): দশমিক সংখ্যা (\`${rhsExpr}\`) সরাসরি \`int\` ভ্যারিয়েবল \`${varName}\`-এ রাখা যাবে না।`,
            solutionBn: `ভ্যারিয়েবলটির টাইপ \`double\` করুন অথবা \`(int) ${rhsExpr}\` দিয়ে টাইপ কাস্ট করুন।`,
            messageEn: `Incompatible types on line ${lineNum}: possible lossy conversion from double to int.`,
            explainLanguage,
          });
        }
      }

      if (expectedType === 'float' && rhsType === 'String') {
        return makeErrorDetails({
          errorType: 'COMPILATION_ERROR',
          lineNumber: lineNum,
          lineCode: rawLineCode,
          messageBn: `লাইন ${lineNum}-এ টাইপ অমিল (Incompatible types): \`String\` মান (\`${rhsExpr}\`) দশমিক (\`double/float\`) ভ্যারিয়েবল \`${varName}\`-এ রাখা যাবে না।`,
          solutionBn: `\`${varName}\`-এ সংখ্যাসূচক মান দিন অথবা টাইপ \`String\` করুন।`,
          messageEn: `Incompatible types on line ${lineNum}: String cannot be converted to double.`,
          explainLanguage,
        });
      }

      if (expectedType === 'boolean' && effectiveLang === 'java') {
        if (rhsType === 'int' || rhsType === 'float' || rhsType === 'String') {
          return makeErrorDetails({
            errorType: 'COMPILATION_ERROR',
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `লাইন ${lineNum}-এ টাইপ অমিল (Incompatible types): \`${rhsType}\` মান (\`${rhsExpr}\`) বুলিয়ান (\`boolean\`) ভ্যারিয়েবল \`${varName}\`-এ রাখা যাবে না।`,
            solutionBn: `\`boolean ${varName}\`-এ শুধুমাত্র \`true\`, \`false\`, অথবা কোনো তুলনামূলক শর্ত (যেমন \`a > b\`) রাখুন।`,
            messageEn: `Incompatible types on line ${lineNum}: ${rhsType} cannot be converted to boolean.`,
            explainLanguage,
          });
        }
      }

      if (expectedType === 'String') {
        if (rhsType === 'int' || rhsType === 'float' || rhsType === 'boolean') {
          return makeErrorDetails({
            errorType: 'COMPILATION_ERROR',
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `লাইন ${lineNum}-এ টাইপ অমিল (Incompatible types): \`${rhsType}\` মান (\`${rhsExpr}\`) সরাসরি \`String\` ভ্যারিয়েবল \`${varName}\`-এ রাখা যাবে না।`,
            solutionBn: `মানটিকে ডাবল কোটেশনের ভেতরে (\`"${rhsExpr}"\`) লিখুন অথবা ভ্যারিয়েবলটির টাইপ পরিবর্তন করুন।`,
            messageEn: `Incompatible types on line ${lineNum}: ${rhsType} cannot be converted to String.`,
            explainLanguage,
          });
        }
      }

      return null;
    };

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const cleaned = lines[i].trim();
      const rawLineCode = rawLines[i]?.trim() || cleaned;
      if (!cleaned) continue;

      if (
        cleaned.startsWith('#') ||
        cleaned.startsWith('@') ||
        cleaned.startsWith('package ') ||
        cleaned.startsWith('import ') ||
        cleaned.startsWith('using namespace')
      ) {
        continue;
      }

      // Check `catch (ExceptionType e)` declaration
      const catchDecl = cleaned.match(
        /^(?:\}?\s*)?catch\s*\(\s*(?:final\s+)?(?:[A-Za-z0-9_.$|&\s]+\s+)?([A-Za-z_$][\w$]*)\s*\)/
      );
      if (catchDecl && catchDecl[1]) {
        declaredVars.set(catchDecl[1], 'object');
        continue;
      }

      // Check `for (int i = 0; ...)` declaration
      const forDecl = cleaned.match(
        /^for\s*\(\s*(?:final\s+)?(int|long|short|byte|double|float|auto|size_t)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/
      );
      if (forDecl) {
        const vType = mapTypeKeyword(forDecl[1], false);
        const vName = forDecl[2];
        const rhs = forDecl[3].trim();
        const typeErr = checkTypeCompatibility(vName, vType, rhs, lineNum, rawLineCode);
        if (typeErr) return typeErr;
        declaredVars.set(vName, vType);
      }

      // Enhanced for-each loop `for (int x : arr)`
      const forEachDecl = cleaned.match(
        /^for\s*\(\s*(?:final\s+)?(int|long|short|byte|double|float|boolean|bool|String|string|char|auto)\s+([A-Za-z_$][\w$]*)\s*:/
      );
      if (forEachDecl) {
        declaredVars.set(forEachDecl[2], mapTypeKeyword(forEachDecl[1], false));
      }

      // Skip class / method headers
      if (
        /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*class\b/.test(
          cleaned
        ) ||
        /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+)*(?:void|int|long|short|byte|double|float|boolean|bool|String|string|char)\s+[A-Za-z_$][\w$]*\s*\(/.test(
          cleaned
        )
      ) {
        continue;
      }

      // Check typed declarations on this line: e.g. `int a = 5, b = 10;` or `int[] arr = {1, 2};`
      const declHeaderMatch = cleaned.match(
        /^(?:final\s+|static\s+)*(int|long|short|byte|double|float|boolean|bool|String|string|char|auto|FileReader|FileInputStream|BufferedReader|Scanner|File|Object|Integer|Double|vector\s*<[^>]+>)(\s*\[\s*\])?\s+(.+?);?\s*$/
      );
      if (declHeaderMatch) {
        const baseTypeKw = declHeaderMatch[1];
        const isArrBrack = Boolean(declHeaderMatch[2]);
        const restDecls = declHeaderMatch[3];

        // Split top-level comma declarations (ignoring commas inside `{...}` or `(...)`)
        const declParts: string[] = [];
        let cur = '';
        let depth = 0;
        let inQuotes = false;
        for (let c = 0; c < restDecls.length; c++) {
          const ch = restDecls[c];
          if ((ch === '"' || ch === "'") && restDecls[c - 1] !== '\\') inQuotes = !inQuotes;
          if (!inQuotes) {
            if (ch === '(' || ch === '{' || ch === '[') depth++;
            else if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
            else if (ch === ',' && depth === 0) {
              declParts.push(cur.trim());
              cur = '';
              continue;
            }
          }
          cur += ch;
        }
        if (cur.trim()) declParts.push(cur.trim());

        for (const part of declParts) {
          const eqIdx = part.indexOf('=');
          const lhsPart = (eqIdx >= 0 ? part.slice(0, eqIdx) : part).trim();
          const rhsPart = eqIdx >= 0 ? part.slice(eqIdx + 1).trim() : '';
          const hasVarArr = isArrBrack || /\[\s*\]/.test(lhsPart);
          const varName = lhsPart.replace(/\[\s*\]/g, '').trim();
          const vType = mapTypeKeyword(baseTypeKw, hasVarArr);

          if (varName && /^[A-Za-z_$][\w$]*$/.test(varName)) {
            if (rhsPart) {
              const typeErr = checkTypeCompatibility(
                varName,
                vType,
                rhsPart,
                lineNum,
                rawLineCode
              );
              if (typeErr) return typeErr;

              // Check identifiers used on the RHS of the declaration
              const strippedRhs = stripStringLiteralsFromLine(rhsPart);
              const tokens = strippedRhs.match(/\b[A-Za-z_$][\w$]*\b/g) || [];
              for (const tok of tokens) {
                if (
                  !BUILTIN_IDENTIFIERS.has(tok) &&
                  !declaredVars.has(tok) &&
                  !declaredFunctions.has(tok) &&
                  !/^[0-9]/.test(tok)
                ) {
                  // Ignore method calls `.tok(` or `tok(` if defined
                  const isMethodOrProp = new RegExp(`(?:\\.|::)\\s*${tok}\\b`).test(strippedRhs);
                  if (!isMethodOrProp) {
                    return makeErrorDetails({
                      errorType: 'COMPILATION_ERROR',
                      lineNumber: lineNum,
                      lineCode: rawLineCode,
                      messageBn: `লাইন ${lineNum}-এ \`${tok}\` ভ্যারিয়েবলটি ডিক্লেয়ার না করেই ব্যবহার করা হয়েছে (cannot find symbol: variable \`${tok}\`)।`,
                      solutionBn: `\`${tok}\` ব্যবহারের আগে সঠিক ডেটা টাইপসহ ডিক্লেয়ার করুন (যেমন: \`int ${tok} = ...;\`)।`,
                      messageEn: `Cannot find symbol on line ${lineNum}: variable \`${tok}\` is undeclared.`,
                      explainLanguage,
                    });
                  }
                }
              }
            }
            declaredVars.set(varName, vType);
          }
        }
        continue;
      }

      // Check plain assignment `varName = rhs;` or `varName += rhs;`
      const assignMatch = cleaned.match(
        /^([A-Za-z_$][\w$]*)\s*(?:\[\s*([^\]]+)\s*\])?\s*(=|\+=|-=|\*=|\/=|%=)\s*(.+?);?\s*$/
      );
      if (assignMatch && !cleaned.startsWith('if') && !cleaned.startsWith('while')) {
        const [, targetVar, idxExpr, op, rhsPart] = assignMatch;
        if (!declaredVars.has(targetVar) && !BUILTIN_IDENTIFIERS.has(targetVar)) {
          return makeErrorDetails({
            errorType: 'COMPILATION_ERROR',
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `লাইন ${lineNum}-এ \`${targetVar}\` ভ্যারিয়েবলটি আগে ডিক্লেয়ার করা হয়নি (cannot find symbol: variable \`${targetVar}\`)।`,
            solutionBn: `লাইন ${lineNum}-এ \`${targetVar}\`-এ মান রাখার আগে ডেটা টাইপ উল্লেখ করে ডিক্লেয়ার করুন (যেমন: \`int ${targetVar} = ${rhsPart};\`)।`,
            messageEn: `Cannot find symbol on line ${lineNum}: variable \`${targetVar}\` has not been declared.`,
            explainLanguage,
          });
        }

        const targetType = declaredVars.get(targetVar);
        if (targetType && !idxExpr && op === '=') {
          const typeErr = checkTypeCompatibility(
            targetVar,
            targetType,
            rhsPart,
            lineNum,
            rawLineCode
          );
          if (typeErr) return typeErr;
        }
      }

      // Check all identifier tokens referenced on this line (in conditions, print statements, expressions, increments)
      const strippedLine = stripStringLiteralsFromLine(cleaned);
      const idRegex = /\b([A-Za-z_$][\w$]*)\b/g;
      let idMatch: RegExpExecArray | null;
      while ((idMatch = idRegex.exec(strippedLine)) !== null) {
        const tok = idMatch[1];
        const idxInLine = idMatch.index;
        const beforeSlice = strippedLine.slice(0, idxInLine);

        // Skip if preceded by `.` or `::` (member access like `arr.length` or `std::cout`)
        if (/(?:\.|::)\s*$/.test(beforeSlice)) continue;

        if (
          !BUILTIN_IDENTIFIERS.has(tok) &&
          !declaredVars.has(tok) &&
          !declaredFunctions.has(tok)
        ) {
          return makeErrorDetails({
            errorType: 'COMPILATION_ERROR',
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `লাইন ${lineNum}-এ অজ্ঞাত ভ্যারিয়েবল বা সিম্বল \`${tok}\` ব্যবহার করা হয়েছে যা ডিক্লেয়ার করা হয়নি (cannot find symbol: \`${tok}\`)।`,
            solutionBn: `\`${tok}\` ব্যবহারের আগে এটি ডিক্লেয়ার করুন অথবা ভ্যারিয়েবলের নামের বানান পরীক্ষা করুন।`,
            messageEn: `Cannot find symbol \`${tok}\` on line ${lineNum}.`,
            explainLanguage,
          });
        }
      }
    }
  }

  return null;
}

export function inferLineRole(trimmed: string): LineRole {
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) {
    return 'comment';
  }
  if (/^(?:\}?\s*)?(?:if|else if|elif|else|switch|case|catch)\b/.test(trimmed)) return 'condition';
  if (/^(?:for|while|do)\b/.test(trimmed)) return 'loop';
  if (/^(?:return)\b/.test(trimmed)) return 'return';
  if (/\b(?:console\.log|print|cout|System\.out\.print|System\.err\.print|printf)\b/.test(trimmed))
    return 'output';
  if (
    /^(?:final\s+|static\s+)*(?:let|const|var|int|float|double|long|short|byte|string|String|bool|boolean|char|auto|vector|FileReader|Scanner|File)\b/.test(
      trimmed
    )
  ) {
    return 'declare';
  }
  if (trimmed === '}' || trimmed === '};' || trimmed === '{') return 'block_end';
  if (trimmed.includes('=')) return 'assign';
  return 'call';
}

export function buildStructureFromVariables(
  analogyType: AnalogyType,
  variables: Record<string, any>,
  activeLineText = ''
): StepStructure | null {
  const entries = Object.entries(variables || {});
  const arrayEntry = entries.find(([, v]) => Array.isArray(v));

  if (
    analogyType === 'sort_blocks' ||
    analogyType === 'pointer_arrows' ||
    analogyType === 'binary_search_cards'
  ) {
    if (arrayEntry) {
      const arrVals = (arrayEntry[1] as any[]).map((x) =>
        typeof x === 'number' || typeof x === 'string' ? x : String(x)
      );
      const pointers: Record<string, number> = {};
      for (const [k, v] of entries) {
        if (
          typeof v === 'number' &&
          Number.isInteger(v) &&
          ['i', 'j', 'k', 'left', 'right', 'low', 'high', 'mid', 'idx', 'minIdx'].includes(k)
        ) {
          pointers[k] = v;
        }
      }
      const highlight = Object.values(pointers).filter(
        (idx) => idx >= 0 && idx < arrVals.length
      );
      return {
        kind: 'array',
        values: arrVals,
        pointers,
        highlight,
      };
    }
  }

  if (analogyType === 'stack_plates' || analogyType === 'recursion_tower') {
    const stackArr =
      variables.callStack ||
      variables.st ||
      variables.stack ||
      (arrayEntry ? arrayEntry[1] : null);
    if (Array.isArray(stackArr)) {
      return {
        kind: 'stack',
        values: stackArr.map((x) =>
          typeof x === 'number' || typeof x === 'string' ? x : String(x)
        ),
      };
    }
  }

  if (analogyType === 'queue_line') {
    const qArr =
      variables.q || variables.queue || (arrayEntry ? arrayEntry[1] : null);
    if (Array.isArray(qArr)) {
      return {
        kind: 'queue',
        values: qArr.map((x) =>
          typeof x === 'number' || typeof x === 'string' ? x : String(x)
        ),
      };
    }
  }

  if (analogyType === 'linked_list_train') {
    const listArr =
      variables.nodes || variables.list || (arrayEntry ? arrayEntry[1] : null);
    if (Array.isArray(listArr)) {
      return {
        kind: 'list',
        values: listArr.map((x) =>
          typeof x === 'number' || typeof x === 'string' ? x : String(x)
        ),
      };
    }
  }

  if (analogyType === 'loop_gauge') {
    const firstNumericEntry = entries.find(([, v]) => typeof v === 'number');
    const loopVar =
      typeof variables.i === 'number'
        ? variables.i
        : typeof variables.count === 'number'
        ? variables.count
        : typeof variables.temp === 'number'
        ? variables.temp
        : firstNumericEntry
        ? firstNumericEntry[1]
        : 1;
    const condMatch = activeLineText.match(/(?:while|for)\s*\(([^)]+)\)/);
    return {
      kind: 'loop',
      lap: Math.max(1, Math.abs(Number(loopVar)) || 1),
      maxLaps: 10,
      conditionText: condMatch ? condMatch[1].trim() : undefined,
    };
  }

  if (arrayEntry) {
    return {
      kind: 'array',
      values: (arrayEntry[1] as any[]).map((x) =>
        typeof x === 'number' || typeof x === 'string' ? x : String(x)
      ),
    };
  }

  return null;
}

function formatVal(val: any): string {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'string') return JSON.stringify(val);
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/**
 * Substitutes current variable values into an expression string so the student can see
 * the exact numbers being calculated (e.g. `temp % 10` -> `121 % 10`, `number == reversed` -> `121 == 121`).
 */
function substituteExpressionValues(
  expr: string,
  varsBeforeOrCurrent: Record<string, any>
): string {
  if (!expr) return '';
  return expr.replace(/\b([A-Za-z_]\w*)\b/g, (token) => {
    if (token in varsBeforeOrCurrent && varsBeforeOrCurrent[token] !== undefined) {
      const v = varsBeforeOrCurrent[token];
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return token;
  });
}

/**
 * Generates technically accurate, non-generic Bengali (`whatHappenedBn`, `logicBuildingBn`)
 * and English (`whatHappenedEn`, `logicBuildingEn`) explanations for a runtime step.
 */
function buildStepPedagogy(
  rec: RecordedJsStep,
  prevVars: Record<string, any>
): {
  whatHappenedBn: string;
  logicBuildingBn: string;
  whatHappenedEn: string;
  logicBuildingEn: string;
  uiAction: StepAction;
} {
  const { line, actionType, codeSnippet, variables, memoryDelta, consoleOutput, meta } = rec;

  // 1. Class, Method, Try, or Finally Entry (`METHOD_ENTRY`)
  if (actionType === 'METHOD_ENTRY') {
    if (meta?.subKind === 'TRY_BLOCK') {
      return {
        whatHappenedBn:
          '`try` ব্লকে প্রবেশ করা হলো—এই ব্লকের ভেতরের কোড চালানোর সময় কোনো রানটাইম এক্সেপশন (Exception) ঘটে কি না তা পর্যবেক্ষণ করা হবে।',
        logicBuildingBn:
          'যেসব অপারেশনে রানটাইম ত্রুটি হওয়ার সম্ভাবনা থাকে (যেমন ফাইল পড়া বা শূন্য দিয়ে ভাগ), সেগুলো `try` ব্লকের ভেতরে নিরাপদে রাখা হয়।',
        whatHappenedEn:
          'Entered the `try` block to monitor statements for potential runtime exceptions.',
        logicBuildingEn:
          'Risky operations like file I/O or division are placed inside `try` so exceptions can be caught gracefully.',
        uiAction: 'call',
      };
    }

    if (meta?.subKind === 'FINALLY_BLOCK') {
      return {
        whatHappenedBn:
          '`try/catch` পর্ব শেষে এখন নিয়ন্ত্রণ `finally` ব্লকে প্রবেশ করল—এক্সেপশন ঘটুক বা না ঘটুক, এই ব্লকটি সর্বদা এক্সিকিউট হয়।',
        logicBuildingBn:
          'ফাইল ক্লোজ করা বা রিসোর্স মুক্ত করার মতো আবশ্যকীয় সমাপ্তি কাজ নিশ্চিত করতে `finally` ব্লক ব্যবহৃত হয়।',
        whatHappenedEn:
          'Entered the `finally` block, which always executes regardless of whether an exception was thrown or caught.',
        logicBuildingEn:
          '`finally` guarantees that cleanup logic runs after `try` and `catch` complete.',
        uiAction: 'call',
      };
    }

    if (meta?.subKind === 'CLASS_DEF') {
      const className = meta.fnName || 'Main';
      return {
        whatHappenedBn: `\`${className}\` ক্লাসের ডেফিনিশন শুরু হলো, যা এই প্রোগ্রামের মেথড ও লজিক ধারণ করে।`,
        logicBuildingBn:
          'অবজেক্ট-ওরিয়েন্টেড প্রোগ্রামিংয়ে (যেমন Java বা C++) প্রোগ্রামের সব কার্যকর মেথড একটি ক্লাসের কাঠামোর ভেতরে সংজ্ঞায়িত করতে হয়।',
        whatHappenedEn: `Entered class definition \`${className}\`, which encapsulates the program's methods and logic.`,
        logicBuildingEn:
          'In class-based languages like Java, executable methods must be organized inside a class container.',
        uiAction: 'call',
      };
    }

    if (meta?.subKind === 'MAIN_ENTRY' || meta?.fnName === 'main') {
      return {
        whatHappenedBn:
          '`main` মেথড থেকে প্রোগ্রামের মূল রানটাইম এক্সিকিউশন (execution) শুরু হলো।',
        logicBuildingBn:
          '`main` হলো প্রোগ্রামের এন্ট্রি পয়েন্ট—রানটাইম ইঞ্জিন সবার আগে এখান থেকেই লাইন বাই লাইন কোড চালানো শুরু করে।',
        whatHappenedEn:
          'Program execution started at the `main` entry point method.',
        logicBuildingEn:
          '`main` serves as the entry point where the runtime begins executing statements sequentially.',
        uiAction: 'call',
      };
    }

    const fnName = meta?.fnName || 'function';
    return {
      whatHappenedBn: `\`${fnName}\` ফাংশনে প্রবেশ করে এর ভেতরের নির্দেশাবলি চালানো শুরু হলো।`,
      logicBuildingBn:
        'নির্দিষ্ট লজিক বা গণনা আলাদাভাবে সম্পন্ন করার জন্য এই ফাংশনটি কল করা হয়েছে।',
      whatHappenedEn: `Entered function \`${fnName}\` and initialized its local parameters.`,
      logicBuildingEn:
        'Modular functions encapsulate reusable logic and maintain their own stack frame.',
      uiAction: 'call',
    };
  }

  // 2. Loop Condition Check (`LOOP_CHECK`)
  if (actionType === 'LOOP_CHECK') {
    const condExpr = meta?.conditionExpr || codeSnippet;
    const resolved = substituteExpressionValues(condExpr, variables);
    const isTrue = Boolean(meta?.conditionResult);
    const iter = meta?.iteration || 1;
    const showResolved = resolved !== condExpr ? ` (\`${resolved}\`)` : '';

    if (isTrue) {
      return {
        whatHappenedBn: `লুপের শর্ত \`${condExpr}\`${showResolved} যাচাই করা হলো—শর্তটি সত্য (\`true\`), তাই লুপের ${iter}ম আবর্তন (Iteration ${iter}) শুরু হচ্ছে।`,
        logicBuildingBn: `যতক্ষণ \`${condExpr}\` শর্তটি সত্য (\`true\`) থাকবে, ততক্ষণ লুপের ভেতরের কোড ব্লকটি পুনরায় চলে প্রতিটি ধাপের হিসাব সম্পন্ন করবে।`,
        whatHappenedEn: `Checked loop condition \`${condExpr}\`${showResolved} — evaluated to \`true\`, entering Iteration ${iter}.`,
        logicBuildingEn: `The loop continues executing its body on each iteration while \`${condExpr}\` remains \`true\`.`,
        uiAction: 'loop_check',
      };
    } else {
      return {
        whatHappenedBn: `লুপের শর্ত \`${condExpr}\`${showResolved} যাচাই করা হলো—এখন শর্তটি মিথ্যা (\`false\`), তাই লুপের কাজ সমাপ্ত করে নিয়ন্ত্রণ লুপের পরের লাইনে চলে যাচ্ছে।`,
        logicBuildingBn: `লুপের সমাপ্তি শর্তে পৌঁছে যাওয়ায় পুনরাবৃত্তি বন্ধ হলো, যা অসীম লুপ (Infinite Loop) প্রতিরোধ করে এবং চূড়ান্ত ফলাফল ব্যবহারের সুযোগ দেয়।`,
        whatHappenedEn: `Checked loop condition \`${condExpr}\`${showResolved} — evaluated to \`false\`, terminating the loop.`,
        logicBuildingEn: `Exiting the loop once \`${condExpr}\` becomes \`false\` prevents an infinite loop and moves control to the next phase.`,
        uiAction: 'loop_check',
      };
    }
  }

  // 3. Branching Condition Check OR Exception Throw/Catch (`CONDITION_CHECK`)
  if (actionType === 'CONDITION_CHECK') {
    if (meta?.subKind === 'EXCEPTION_THROWN') {
      const excType = meta.exceptionType || 'Exception';
      const excMsg = meta.exceptionMessage || '';
      return {
        whatHappenedBn: `এই লাইনে রানটাইম এক্সেপশন \`${excType}\` (${excMsg ? `\`${excMsg}\`` : ''}) ঘটেছে! ফলে \`try\` ব্লকের বাকি লাইনগুলো স্কিপ করে নিয়ন্ত্রণ সরাসরি \`catch\` ব্লকে চলে যাচ্ছে।`,
        logicBuildingBn: `\`try\` ব্লকের ভেতরে কোনো রানটাইম ত্রুটি ঘটলে পরের লাইনগুলো আর এক্সিকিউট না হয়ে সাথে সাথে মেচিং \`catch\` ব্লকে জাম্প করে।`,
        whatHappenedEn: `Runtime exception \`${excType}\` (${excMsg}) occurred on this line, jumping directly to the matching \`catch\` block.`,
        logicBuildingEn: `When an exception is thrown inside a \`try\` block, remaining statements in \`try\` are bypassed and control transfers to \`catch\`.`,
        uiAction: 'compare',
      };
    }

    if (meta?.subKind === 'CATCH_BLOCK') {
      const excType = meta.exceptionType || 'Exception';
      const targetVar = meta.targetVar || 'e';
      const excVal = variables[targetVar] ?? excType;
      return {
        whatHappenedBn: `\`try\` ব্লক থেকে আসা \`${excType}\` এক্সেপশনটি এই \`catch\` ব্লকে ধরা পড়েছে (\`${targetVar} = ${formatVal(
          excVal
        )}\`) এবং এখন \`catch\` ব্লকের ভেতরের কোড এক্সিকিউট হবে।`,
        logicBuildingBn: `\`catch (${excType} ${targetVar})\` ব্লকটি নির্দিষ্ট এক্সেপশনটি গ্রহণ করে প্রোগ্রামকে ক্র্যাশ হওয়া থেকে বাঁচায় এবং এরর হ্যান্ডলিং সম্পন্ন করে।`,
        whatHappenedEn: `Caught \`${excType}\` in \`catch\` block (\`${targetVar} = ${formatVal(
          excVal
        )}\`) and began executing the handler body.`,
        logicBuildingEn: `The matching \`catch\` block intercepts the runtime exception so the program can handle the error cleanly.`,
        uiAction: 'compare',
      };
    }

    const condExpr = meta?.conditionExpr || codeSnippet;
    const resolved = substituteExpressionValues(condExpr, variables);
    const isTrue = Boolean(meta?.conditionResult);
    const showResolved = resolved !== condExpr ? ` (\`${resolved}\`)` : '';

    if (isTrue) {
      return {
        whatHappenedBn: `শর্ত \`${condExpr}\`${showResolved} যাচাই করা হলো—শর্তটি সত্য (\`true\`), তাই এই \`if\` ব্লকের ভেতরের অংশটি এখন এক্সিকিউট হবে।`,
        logicBuildingBn: `\`${condExpr}\` সত্য হওয়ায় প্রোগ্রামটি শুধুমাত্র এই শাখাটি (true branch) চালাবে এবং বিকল্প \`else\` শাখা সম্পূর্ণ স্কিপ করবে।`,
        whatHappenedEn: `Evaluated condition \`${condExpr}\`${showResolved} — result is \`true\`, entering the true branch.`,
        logicBuildingEn: `Because \`${condExpr}\` is \`true\`, only this branch executes while any \`else\` branch is skipped.`,
        uiAction: 'compare',
      };
    } else {
      return {
        whatHappenedBn: `শর্ত \`${condExpr}\`${showResolved} যাচাই করা হলো—শর্তটি মিথ্যা (\`false\`), তাই এই \`if\` ব্লকটি স্কিপ করে বিকল্প (\`else\` বা পরবর্তী) অংশে যাচ্ছে।`,
        logicBuildingBn: `\`${condExpr}\` মিথ্যা হওয়ায় এই ব্লকের কোড কখনোই চলবে না, বরং নিয়ন্ত্রণ সরাসরি পরবর্তী শর্ত বা \`else\` ব্লকে স্থানান্তরিত হবে।`,
        whatHappenedEn: `Evaluated condition \`${condExpr}\`${showResolved} — result is \`false\`, skipping this branch.`,
        logicBuildingEn: `When an \`if\` condition evaluates to \`false\`, execution bypasses its body and proceeds to the \`else\` branch.`,
        uiAction: 'compare',
      };
    }
  }

  // 4. Console Output (`OUTPUT`)
  if (actionType === 'OUTPUT') {
    const outText = consoleOutput ?? meta?.printedText ?? '';
    return {
      whatHappenedBn: `কনসোলে আউটপুট হিসেবে \`${formatVal(outText)}\` প্রিন্ট করা হলো।`,
      logicBuildingBn: `মেমোরিতে হিসাব ও শর্ত যাচাই শেষে প্রাপ্ত ফলাফল \`${formatVal(outText)}\` প্রদর্শনের জন্য এই আউটপুট স্টেটমেন্টটি চালানো হয়েছে।`,
      whatHappenedEn: `Printed \`${formatVal(outText)}\` to standard output (console).`,
      logicBuildingEn: `Outputs the computed result \`${formatVal(outText)}\` after completing state evaluation.`,
      uiAction: 'call',
    };
  }

  // 5. Return / Block End (`BLOCK_END`)
  if (actionType === 'BLOCK_END') {
    if (meta?.subKind === 'RETURN') {
      const rv = meta.returnVal !== undefined ? ` \`${formatVal(meta.returnVal)}\`` : '';
      return {
        whatHappenedBn: `ফাংশন থেকে${rv} রিটার্ন করে বর্তমান মেথডের কাজ সমাপ্ত করা হলো।`,
        logicBuildingBn:
          'হিসাবকৃত মান কলকারী অংশে ফেরত পাঠাতে বা মেথড সমাপ্ত করতে `return` ব্যবহৃত হয়।',
        whatHappenedEn: `Returned${rv} and exited the current function scope.`,
        logicBuildingEn:
          '`return` hands the computed result back to the caller and terminates the method.',
        uiAction: 'return',
      };
    }
    return {
      whatHappenedBn: `লাইন ${line} (\`${codeSnippet}\`) সম্পন্ন হয়েছে।`,
      logicBuildingBn: 'ব্লকের কাজ শেষ করে প্রোগ্রামের নিয়ন্ত্রণ পরবর্তী ধাপে নিয়ে যাওয়া হলো।',
      whatHappenedEn: `Completed block at line ${line}.`,
      logicBuildingEn: 'Closes the current execution block.',
      uiAction: 'return',
    };
  }

  // 6. Variable Declaration (`DECLARE`) & Assignment (`ASSIGN`)
  const varName = memoryDelta?.variable || meta?.targetVar || 'variable';
  const oldVal = memoryDelta?.oldValue ?? null;
  const newVal =
    memoryDelta?.newValue !== undefined ? memoryDelta.newValue : variables[varName];
  const rhsExpr = meta?.rhsExpr || '';
  const varsForSubst = { ...prevVars };
  for (const [k, v] of Object.entries(variables)) {
    if (!(k in varsForSubst)) varsForSubst[k] = v;
  }
  const resolvedRhs = rhsExpr ? substituteExpressionValues(rhsExpr, prevVars) : '';
  const hasMathOp = /[+\-*/%]/.test(rhsExpr);
  const mathDetail =
    rhsExpr && hasMathOp && resolvedRhs !== String(newVal)
      ? ` (\`${rhsExpr}\` = \`${resolvedRhs}\` = \`${formatVal(newVal)}\`)`
      : rhsExpr && resolvedRhs !== rhsExpr && resolvedRhs !== String(newVal)
      ? ` (\`${rhsExpr}\` → \`${formatVal(newVal)}\`)`
      : '';

  let logicBn = '';
  let logicEn = '';
  if (/%\s*10\b/.test(rhsExpr)) {
    logicBn = `যেকোনো পূর্ণসংখ্যাকে \`10\` দিয়ে মডুলাস (\`% 10\`) করলে সংখ্যাটির একদম শেষের ডিজিট (\`${formatVal(
      newVal
    )}\`) আলাদা হয়ে বেরিয়ে আসে।`;
    logicEn = `Taking modulo \`10\` (\`% 10\`) extracts the last digit (\`${formatVal(
      newVal
    )}\`) of the integer.`;
  } else if (/\*\s*10\s*\+/.test(rhsExpr)) {
    logicBn = `আগের উল্টো সংখ্যার সাথে \`10\` গুণ করে অঙ্কগুলোকে এক ঘর বামে সরানো হলো এবং নতুন ডিজিট যোগ করে \`${formatVal(
      newVal
    )}\` গঠন করা হলো।`;
    logicEn = `Multiplying by \`10\` shifts existing digits left so the extracted digit can be appended to form \`${formatVal(
      newVal
    )}\`.`;
  } else if (/(\/|\/\/)\s*10\b/.test(rhsExpr)) {
    logicBn = `সংখ্যাটিকে \`10\` দিয়ে পূর্ণসংখ্যার ভাগ (integer division) করে ব্যবহৃত শেষ ডিজিটটি বাদ দেওয়া হলো, ফলে বাকি থাকল \`${formatVal(
      newVal
    )}\`।`;
    logicEn = `Integer division by \`10\` removes the rightmost digit that was just processed, leaving \`${formatVal(
      newVal
    )}\`.`;
  } else if (/^[A-Za-z_]\w*$/.test(rhsExpr) && rhsExpr in prevVars) {
    logicBn = `পরবর্তী ধাপে বা লুপে মান পরিবর্তন করার সময় মূল ভ্যারিয়েবল \`${rhsExpr}\`-এর মান (\`${formatVal(
      newVal
    )}\`) যেন অক্ষত থাকে, তাই \`${varName}\`-এ কপি করে রাখা হলো।`;
    logicEn = `Copied \`${rhsExpr}\` (\`${formatVal(
      newVal
    )}\`) into \`${varName}\` so the original value is preserved during subsequent mutations.`;
  } else if (/\+\+|--|\+=\s*1|-=\s*1/.test(rhsExpr)) {
    logicBn = `লুপ বা ইনডেক্স পরবর্তী ধাপে এগিয়ে নেওয়ার জন্য \`${varName}\`-এর মান \`${formatVal(
      oldVal
    )}\` থেকে আপডেট করে \`${formatVal(newVal)}\` করা হলো।`;
    logicEn = `Updated loop/index counter \`${varName}\` from \`${formatVal(
      oldVal
    )}\` to \`${formatVal(newVal)}\` to advance toward termination.`;
  } else if (actionType === 'DECLARE' && newVal === 0) {
    logicBn = `পরবর্তী ধাপে গণনার ফলাফল জমা রাখার জন্য \`${varName}\` ভ্যারিয়েবলকে শুরুতে \`0\` দিয়ে ইনিশিয়ালাইজ করা হলো।`;
    logicEn = `Initialized accumulator \`${varName}\` to \`0\` before starting the iterative computation.`;
  } else if (actionType === 'DECLARE') {
    logicBn = `প্রোগ্রামের পরবর্তী গাণিতিক হিসাব ও শর্ত যাচাইয়ে ব্যবহারের জন্য \`${varName}\` ভ্যারিয়েবলে \`${formatVal(
      newVal
    )}\` মানটি মেমোরিতে সংরক্ষণ করা হলো।`;
    logicEn = `Stored initial value \`${formatVal(
      newVal
    )}\` in \`${varName}\` for use in subsequent expressions and conditions.`;
  } else {
    logicBn = `\`${rhsExpr || codeSnippet}\` হিসাব করে \`${varName}\`-এর পুরনো মান \`${formatVal(
      oldVal
    )}\` পরিবর্তন করে নতুন মান \`${formatVal(newVal)}\` মেমোরিতে সংরক্ষণ করা হলো।`;
    logicEn = `Evaluated \`${rhsExpr || codeSnippet}\` and updated \`${varName}\` from \`${formatVal(
      oldVal
    )}\` to \`${formatVal(newVal)}\`.`;
  }

  if (actionType === 'DECLARE' && oldVal === null) {
    return {
      whatHappenedBn: `নতুন ভ্যারিয়েবল \`${varName}\` ডিক্লেয়ার করে মেমোরিতে তার মান \`${formatVal(
        newVal
      )}\` সেট করা হলো${mathDetail}।`,
      logicBuildingBn: logicBn,
      whatHappenedEn: `Declared variable \`${varName}\` and initialized it to \`${formatVal(
        newVal
      )}\`${mathDetail}.`,
      logicBuildingEn: logicEn,
      uiAction: 'declare',
    };
  }

  return {
    whatHappenedBn: `\`${varName}\` ভ্যারিয়েবলের মান \`${formatVal(
      oldVal
    )}\` থেকে আপডেট হয়ে \`${formatVal(newVal)}\` হলো${mathDetail}।`,
    logicBuildingBn: logicBn,
    whatHappenedEn: `Updated \`${varName}\` from \`${formatVal(
      oldVal
    )}\` to \`${formatVal(newVal)}\`${mathDetail}.`,
    logicBuildingEn: logicEn,
    uiAction: /^[A-Za-z_]\w*$/.test(rhsExpr) ? 'transfer' : 'assign',
  };
}

export function buildFallbackTrace(params: {
  code: string;
  language: SupportedLanguage;
  explainLanguage: ExplainLanguage;
  depth: ExplanationDepth;
  fileName?: string;
}): ExecutionTrace {
  const { code, language, explainLanguage, depth, fileName } = params;
  const traceSource: TraceSource =
    language === 'cpp' || language === 'java' ? 'ai_predicted' : 'real_execution';

  // 1. Check for syntax / compile / file-name-mismatch errors BEFORE any execution
  const syntaxErr = detectSyntaxError(code, explainLanguage, language, fileName);
  if (syntaxErr) {
    const lines = code.split('\n');
    const lineNotes: LineNote[] = [];
    lines.forEach((raw, idx) => {
      const t = raw.trim();
      if (!t) return;
      const ln = idx + 1;
      lineNotes.push({
        line: ln,
        role: inferLineRole(t),
        text:
          ln === syntaxErr.lineNumber
            ? syntaxErr.message
            : explainLanguage === 'bn'
            ? `লাইন ${ln}: \`${t.slice(0, 36)}\` — কম্পাইল/সিনট্যাক্স ত্রুটির কারণে কোডটি এক্সিকিউট করা হয়নি।`
            : `Line ${ln}: \`${t.slice(0, 36)}\` — not executed due to compilation error.`,
        why: ln === syntaxErr.lineNumber ? (syntaxErr.solutionBn ?? '') : undefined,
      });
    });

    return {
      hasError: true,
      isValidLogic: false,
      errorDetails: syntaxErr,
      language,
      analogyType: 'generic_memory',
      traceSource,
      logicSummary: {
        title:
          explainLanguage === 'bn'
            ? `ত্রুটি শনাক্ত হয়েছে (${syntaxErr.errorType ?? 'SYNTAX_ERROR'})`
            : `Compilation / Syntax Error (${syntaxErr.errorType ?? 'SYNTAX_ERROR'})`,
        goal: syntaxErr.messageBn ?? syntaxErr.message,
        idea: syntaxErr.solutionBn ?? '',
        keyPoints: [
          explainLanguage === 'bn'
            ? `ত্রুটির ধরন: ${syntaxErr.errorType ?? 'ERROR'} (লাইন ${syntaxErr.lineNumber ?? 1})`
            : `Error Type: ${syntaxErr.errorType ?? 'ERROR'} (Line ${syntaxErr.lineNumber ?? 1})`,
          explainLanguage === 'bn'
            ? `ত্রুটিপূর্ণ লাইন: \`${syntaxErr.lineCode ?? ''}\``
            : `Problematic Line: \`${syntaxErr.lineCode ?? ''}\``,
          syntaxErr.solutionBn ?? '',
        ],
        analogyStory: syntaxErr.messageBn ?? syntaxErr.message,
        complexity: {
          time: 'N/A',
          space: 'N/A',
          note: syntaxErr.solutionBn ?? '',
        },
        commonMistakes: [syntaxErr.messageBn ?? syntaxErr.message],
      },
      lineNotes,
      steps: [],
      finalOutput: '',
      outputExplanation: syntaxErr.message,
      verdict: {
        status: 'compile_error',
        message: syntaxErr.message,
      },
      programSummary: null,
    };
  }

  const normalized = code.replace(/\s+/g, ' ').trim();

  // 2. Match built-in sample programs ONLY if the user's code is an EXACT match
  for (const sample of SAMPLE_PROGRAMS) {
    for (const langKey of ['javascript', 'python', 'cpp', 'java'] as const) {
      if (sample.codes[langKey].replace(/\s+/g, ' ').trim() === normalized) {
        const baseTrace = sample.traces[explainLanguage][depth];
        return {
          ...baseTrace,
          hasError: false,
          errorDetails: null,
          language,
          traceSource,
          programSummary: {
            totalExecutionSteps: baseTrace.steps.length,
            timeComplexity: baseTrace.logicSummary.complexity.time,
            spaceComplexity: baseTrace.logicSummary.complexity.space,
            finalOutput: baseTrace.finalOutput,
          },
        };
      }
    }
  }

  // 2b. Match curated library problem ONLY on exact code match
  const curatedMatch = matchCuratedLibraryProblemTrace(params);
  if (curatedMatch) {
    return curatedMatch;
  }

  // 3. Universal Deterministic Runtime Execution for ALL 4 languages (JS, Python, C++, Java)
  const sandboxRun = runDeterministicMultiLanguage(code, language, '', 1200);

  // If an unhandled ReferenceError / NameError / SyntaxError or uncaught exception occurred with no steps
  if (
    sandboxRun.runtimeError &&
    (sandboxRun.recordedSteps.length === 0 ||
      /is not defined|SyntaxError|ReferenceError/.test(sandboxRun.runtimeError))
  ) {
    const rawLines = code.split('\n');
    let errLine = sandboxRun.runtimeErrorLine || 1;
    const undefMatch = sandboxRun.runtimeError.match(/([A-Za-z_$][\w$]*)\s+is not defined/);
    if (undefMatch) {
      const sym = undefMatch[1];
      const foundIdx = rawLines.findIndex((l) => new RegExp(`\\b${sym}\\b`).test(l));
      if (foundIdx >= 0) errLine = foundIdx + 1;
    }
    const lineCode = rawLines[errLine - 1]?.trim() || '';
    const errDetails = makeErrorDetails({
      errorType: 'COMPILATION_ERROR',
      lineNumber: errLine,
      lineCode,
      messageBn: undefMatch
        ? `লাইন ${errLine}-এ \`${undefMatch[1]}\` ভ্যারিয়েবল বা ফাংশনটি ডিক্লেয়ার না করেই ব্যবহার করা হয়েছে (${sandboxRun.runtimeError})।`
        : `লাইন ${errLine}-এ ত্রুটি ঘটেছে: \`${sandboxRun.runtimeError}\`।`,
      solutionBn: undefMatch
        ? `\`${undefMatch[1]}\` ব্যবহারের আগে এটি ডিক্লেয়ার করুন অথবা নামের বানান ঠিক করুন।`
        : `লাইন ${errLine} (\`${lineCode}\`) সংশোধন করে আবার রান করুন।`,
      messageEn: sandboxRun.runtimeError,
      explainLanguage,
    });

    return {
      hasError: true,
      isValidLogic: false,
      errorDetails: errDetails,
      language,
      analogyType: 'generic_memory',
      traceSource,
      logicSummary: {
        title:
          explainLanguage === 'bn'
            ? `কম্পাইল বা রানটাইম ত্রুটি (${errDetails.errorType ?? 'ERROR'})`
            : 'Compilation / Runtime Error',
        goal: errDetails.messageBn ?? errDetails.message,
        idea: errDetails.solutionBn ?? '',
        keyPoints: [errDetails.messageBn ?? errDetails.message, errDetails.solutionBn ?? ''],
        analogyStory: errDetails.messageBn ?? errDetails.message,
        complexity: { time: 'N/A', space: 'N/A', note: errDetails.solutionBn ?? '' },
        commonMistakes: [errDetails.messageBn ?? errDetails.message],
      },
      lineNotes: [
        {
          line: errLine,
          role: 'call',
          text: errDetails.message,
          why: errDetails.solutionBn ?? '',
        },
      ],
      steps: [],
      finalOutput: '',
      outputExplanation: errDetails.message,
      verdict: {
        status: 'compile_error',
        message: errDetails.message,
      },
      programSummary: null,
    };
  }

  const cleanLines = sandboxRun.cleanLines;

  if (sandboxRun.recordedSteps.length > 0) {
    const recorded = sandboxRun.recordedSteps;
    const lastVars = recorded[recorded.length - 1].variables || {};
    const hasArray = Object.values(lastVars).some((v) => Array.isArray(v));
    const hasLoopInCode = recorded.some((r) => r.actionType === 'LOOP_CHECK');
    const varKeys = Object.keys(lastVars);
    const isSimpleSwap =
      !hasArray &&
      !hasLoopInCode &&
      varKeys.length >= 2 &&
      varKeys.length <= 3 &&
      /\btemp\b/i.test(code);

    const detectedAnalogy: AnalogyType = isSimpleSwap
      ? 'swap_buckets'
      : hasArray
      ? 'pointer_arrows'
      : hasLoopInCode
      ? 'loop_gauge'
      : 'generic_memory';

    const steps: TraceStep[] = [];
    let prevVars: Record<string, any> = {};

    recorded.slice(0, 100).forEach((rec, idx) => {
      const snippet = rec.codeSnippet || cleanLines[rec.line - 1] || '';
      const pedagogy = buildStepPedagogy(rec, prevVars);

      const changes: VariableChange[] = [];
      if (rec.memoryDelta && rec.memoryDelta.variable) {
        changes.push({
          name: rec.memoryDelta.variable,
          from:
            rec.memoryDelta.oldValue === null || rec.memoryDelta.oldValue === undefined
              ? null
              : typeof rec.memoryDelta.oldValue === 'object'
              ? JSON.stringify(rec.memoryDelta.oldValue)
              : rec.memoryDelta.oldValue,
          to:
            rec.memoryDelta.newValue === null || rec.memoryDelta.newValue === undefined
              ? null
              : typeof rec.memoryDelta.newValue === 'object'
              ? JSON.stringify(rec.memoryDelta.newValue)
              : rec.memoryDelta.newValue,
        });
      }

      const explanationText =
        explainLanguage === 'bn' ? pedagogy.whatHappenedBn : pedagogy.whatHappenedEn;
      const whyText =
        explainLanguage === 'bn' ? pedagogy.logicBuildingBn : pedagogy.logicBuildingEn;

      steps.push({
        stepIndex: idx + 1,
        activeLine: rec.line,
        analogyType: detectedAnalogy,
        action: pedagogy.uiAction,
        from:
          pedagogy.uiAction === 'transfer' && rec.meta?.rhsExpr
            ? rec.meta.rhsExpr
            : null,
        to: rec.memoryDelta?.variable || null,
        explanation: explanationText,
        why: whyText,
        stdout: rec.consoleOutput ?? (rec.stdoutSoFar || null),
        changes,
        variables: { ...rec.variables },
        fault:
          sandboxRun.timedOut && idx === recorded.length - 1
            ? {
                type: 'infinite_loop',
                message:
                  explainLanguage === 'bn'
                    ? 'লুপের শর্ত কখনোই মিথ্যা (false) না হওয়ায় অসীম লুপ (Infinite Loop) তৈরি হয়েছে।'
                    : 'Infinite loop detected because the termination condition was never reached.',
                fixHint:
                  explainLanguage === 'bn'
                    ? 'লুপের ভেতরে কাউন্টার বা শর্তের ভ্যারিয়েবল আপডেট করুন।'
                    : 'Ensure the loop variable moves toward the termination condition in each iteration.',
              }
            : null,
        structure: buildStructureFromVariables(detectedAnalogy, rec.variables, snippet),
        step: idx + 1,
        lineNumber: rec.line,
        codeSnippet: snippet,
        actionType: rec.actionType,
        memoryState: { ...rec.variables },
        memoryDelta: rec.memoryDelta || {
          variable: null,
          oldValue: null,
          newValue: null,
        },
        consoleOutput: rec.consoleOutput,
        whatHappenedBn: pedagogy.whatHappenedBn,
        logicBuildingBn: pedagogy.logicBuildingBn,
      });

      prevVars = { ...rec.variables };
    });

    const lineNotes: LineNote[] = [];
    cleanLines.forEach((trimmed, idx) => {
      if (!trimmed) return;
      const lineNum = idx + 1;
      const role = inferLineRole(trimmed);
      const matchingSteps = steps.filter((s) => s.activeLine === lineNum);
      const firstMatch = matchingSteps[0];
      const lastMatch = matchingSteps[matchingSteps.length - 1];

      let noteText = firstMatch?.explanation || '';
      if (matchingSteps.length > 1 && lastMatch) {
        noteText =
          explainLanguage === 'bn'
            ? `${firstMatch.explanation} (এই লাইনটি মোট ${matchingSteps.length} বার এক্সিকিউট হয়েছে; সর্বশেষ ধাপে: ${lastMatch.explanation})`
            : `${firstMatch.explanation} (Executed ${matchingSteps.length} times; final pass: ${lastMatch.explanation})`;
      } else if (!noteText) {
        if (role === 'block_end') {
          noteText =
            explainLanguage === 'bn'
              ? `লাইন ${lineNum} (\`${trimmed}\`): বর্তমান কোড ব্লকের সমাপ্তি নির্দেশ করে।`
              : `Line ${lineNum} (\`${trimmed}\`): Marks the end of the current code block.`;
        } else if (/^(?:\}?\s*)?else\b/.test(trimmed)) {
          noteText =
            explainLanguage === 'bn'
              ? `লাইন ${lineNum} (\`${trimmed}\`): \`if\` শর্তটি মিথ্যা (\`false\`) হলে এই \`else\` শাখাটি কাজ করে।`
              : `Line ${lineNum} (\`${trimmed}\`): Fallback \`else\` branch executed only when the \`if\` condition is \`false\`.`;
        } else {
          noteText =
            explainLanguage === 'bn'
              ? `লাইন ${lineNum} (\`${trimmed}\`): এই অংশটি বর্তমান রানটাইম প্রবাহে স্কিপ হয়েছে (শর্ত মিথ্যা হওয়ায় বা এক্সেপশন জাম্পের কারণে)।`
              : `Line ${lineNum} (\`${trimmed}\`): Skipped during this runtime execution path.`;
        }
      }

      lineNotes.push({
        line: lineNum,
        role,
        text: noteText,
        why:
          firstMatch?.why ||
          (explainLanguage === 'bn'
            ? 'প্রোগ্রামের শর্ত ও ব্লক কাঠামো সঠিকভাবে বজায় রাখার জন্য এই লাইনটি ব্যবহৃত হয়েছে।'
            : 'Maintains the structural control flow of the program.'),
      });
    });

    const finalOut =
      sandboxRun.stdout.trim() ||
      Object.entries(lastVars)
        .map(([k, v]) => `${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(', ');

    const timeComp = hasLoopInCode ? 'O(n)' : 'O(1)';
    const spaceComp = hasArray ? 'O(n)' : 'O(1)';

    return {
      hasError: false,
      isValidLogic: !sandboxRun.timedOut && !sandboxRun.runtimeError,
      errorDetails: null,
      language,
      analogyType: detectedAnalogy,
      traceSource,
      logicSummary: {
        title:
          explainLanguage === 'bn'
            ? 'রানটাইম কোড এক্সিকিউশন ও মেমোরি স্টেট বিশ্লেষণ'
            : 'Runtime Code Execution & Memory State Analysis',
        goal:
          explainLanguage === 'bn'
            ? `আপনার কোডটি প্রকৃত রানটাইমে মোট ${steps.length}টি ধাপে এক্সিকিউট হয়ে চূড়ান্ত আউটপুট \`${finalOut || 'সম্পন্ন'}\` তৈরি করেছে।`
            : `Executed your code deterministically across ${steps.length} runtime steps to produce \`${finalOut || 'completed state'}\`.`,
        idea:
          explainLanguage === 'bn'
            ? `প্রোগ্রামটি মেমোরিতে ভ্যারিয়েবল (${Object.keys(lastVars).join(', ') || 'state'}) ব্যবহার করে প্রতিটি লুপ, শর্ত এবং এক্সেপশন প্রবাহ যাচাই করে চূড়ান্ত সিদ্ধান্তে পৌঁছেছে।`
            : `The program evaluates (${Object.keys(lastVars).join(', ') || 'state'}) across each iteration and branch condition to compute the final result.`,
        keyPoints: [
          explainLanguage === 'bn'
            ? `মোট কার্যকর ধাপ (Total Steps): ${steps.length}টি`
            : `Total execution steps: ${steps.length}`,
          explainLanguage === 'bn'
            ? `মেমোরির চূড়ান্ত অবস্থা: ${Object.entries(lastVars)
                .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
                .join(', ')}`
            : `Final memory state: ${Object.entries(lastVars)
                .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
                .join(', ')}`,
          explainLanguage === 'bn'
            ? `চূড়ান্ত কনসোল আউটপুট: \`${finalOut || 'N/A'}\``
            : `Final console output: \`${finalOut || 'N/A'}\``,
        ],
        analogyStory:
          explainLanguage === 'bn'
            ? 'প্রতিটি ধাপে প্রোগ্রাম কাউন্টার যে লাইনে যায়, সেই লাইনের গাণিতিক হিসাব শেষে ভ্যারিয়েবলের আগের মান ও নতুন মান মেমোরি কন্টেইনারে সরাসরি আপডেট হয়।'
            : 'At each step, the active program counter evaluates expressions mathematically and updates the 3D memory containers.',
        complexity: {
          time: timeComp,
          space: spaceComp,
          note:
            explainLanguage === 'bn'
              ? hasLoopInCode
                ? `লুপের প্রতিটি আবর্তন ধাপে ধাপে সম্পন্ন হওয়ায় সময় জটিলতা ${timeComp} এবং অতিরিক্ত মেমোরি ${spaceComp}।`
                : `নির্দিষ্ট সংখ্যক ধাপে কাজ সম্পন্ন হওয়ায় সময় ও মেমোরি জটিলতা ${timeComp}।`
              : `Time complexity is ${timeComp} and auxiliary space complexity is ${spaceComp}.`,
        },
        commonMistakes: [
          explainLanguage === 'bn'
            ? 'পূর্ণসংখ্যার ভাগে (Integer Division) দশমিক অংশ স্বয়ংক্রিয়ভাবে বাদ পড়ে যায়—এটি খেয়াল রাখা জরুরি।'
            : 'Remember that integer division truncates any fractional remainder.',
        ],
      },
      lineNotes,
      steps,
      finalOutput: finalOut,
      outputExplanation:
        explainLanguage === 'bn'
          ? `প্রোগ্রামটি মোট ${steps.length}টি রানটাইম ধাপ সম্পন্ন করে চূড়ান্ত আউটপুট \`${finalOut}\` তৈরি করেছে।`
          : `Program completed ${steps.length} runtime steps and produced final output \`${finalOut}\`.`,
      verdict: {
        status: sandboxRun.timedOut ? 'infinite_loop' : 'ok',
        message: sandboxRun.timedOut
          ? explainLanguage === 'bn'
            ? 'অসীম লুপ (Infinite Loop) শনাক্ত হয়েছে।'
            : 'Infinite loop detected.'
          : explainLanguage === 'bn'
          ? 'কোডটি সফলভাবে রান ও ভিজ্যুয়ালাইজ করা হয়েছে।'
          : 'Code executed and visualized accurately.',
      },
      programSummary: {
        totalExecutionSteps: steps.length,
        timeComplexity: timeComp,
        spaceComplexity: spaceComp,
        finalOutput: finalOut,
      },
    };
  }

  // Fallback if no steps were recorded
  return {
    hasError: false,
    isValidLogic: true,
    errorDetails: null,
    language,
    analogyType: 'generic_memory',
    traceSource,
    logicSummary: {
      title: explainLanguage === 'bn' ? 'কোড বিশ্লেষণ' : 'Code Analysis',
      goal: explainLanguage === 'bn' ? 'কোডটি রান করা হয়েছে।' : 'Executed program.',
      idea: '',
      keyPoints: [],
      analogyStory: '',
      complexity: { time: 'O(1)', space: 'O(1)', note: '' },
      commonMistakes: [],
    },
    lineNotes: [],
    steps: [],
    finalOutput: sandboxRun.stdout.trim(),
    outputExplanation: '',
    verdict: {
      status: 'ok',
      message: explainLanguage === 'bn' ? 'সম্পন্ন।' : 'Completed.',
    },
    programSummary: {
      totalExecutionSteps: 0,
      timeComplexity: 'O(1)',
      spaceComplexity: 'O(1)',
      finalOutput: sandboxRun.stdout.trim(),
    },
  };
}
