import { ExecutionDiagnostic, SupportedLanguage } from '../../../shared/types';

export interface PreprocessResult {
  code: string;
  originalCode: string;
  injectedImports: string[];
  injectedPrefixLines: number;
  diagnostics: ExecutionDiagnostic[];
}

/**
 * Strips comments and strings to safely inspect code identifiers without false positives
 */
function stripCommentsAndStrings(code: string, language: SupportedLanguage): string {
  const lines = code.split('\n');
  return lines
    .map((line) => {
      // Single-line comments
      let clean = line;
      if (language === 'python') {
        const hashIdx = clean.indexOf('#');
        if (hashIdx >= 0) clean = clean.slice(0, hashIdx);
      } else {
        const slashIdx = clean.indexOf('//');
        if (slashIdx >= 0) clean = clean.slice(0, slashIdx);
      }
      // Replace strings with empty quotes
      clean = clean
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/`(?:\\.|[^`\\])*`/g, '``');
      return clean;
    })
    .join('\n');
}

/**
 * Detects unused variables across supported languages and returns non-blocking warnings
 */
function detectUnusedVariables(
  code: string,
  language: SupportedLanguage
): ExecutionDiagnostic[] {
  const diagnostics: ExecutionDiagnostic[] = [];
  const lines = code.split('\n');
  const cleanCode = stripCommentsAndStrings(code, language);
  const cleanLines = cleanCode.split('\n');

  // Track declared variables: { name: string, line: number }
  const declared: { name: string; line: number }[] = [];

  for (let i = 0; i < cleanLines.length; i++) {
    const lineNum = i + 1;
    const line = cleanLines[i].trim();
    if (!line) continue;

    if (language === 'javascript') {
      const declMatches = line.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g);
      for (const m of declMatches) {
        if (m[1]) declared.push({ name: m[1], line: lineNum });
      }
    } else if (language === 'python') {
      // Python top-level assignment: var = ...
      const assignMatch = line.match(/^([a-zA-Z_]\w*)\s*=(?!=)/);
      if (assignMatch && !['self', 'cls', 'True', 'False', 'None'].includes(assignMatch[1])) {
        declared.push({ name: assignMatch[1], line: lineNum });
      }
    } else if (language === 'java' || language === 'cpp') {
      // Java/C++ typed declarations
      const typedMatches = line.matchAll(
        /\b(?:int|long|short|byte|float|double|boolean|bool|char|String|string|auto|Scanner|List|ArrayList|Map|HashMap|Set|HashSet|vector\s*<[^>]+>)\s*(?:\[\s*\])?\s+([A-Za-z_$][\w$]*)/g
      );
      for (const m of typedMatches) {
        if (m[1] && !['main', 'args', 'override'].includes(m[1])) {
          declared.push({ name: m[1], line: lineNum });
        }
      }
    }
  }

  // Check how many times each declared identifier appears in cleanCode
  for (const { name, line } of declared) {
    const idRegex = new RegExp(`\\b${name}\\b`, 'g');
    const matches = cleanCode.match(idRegex);
    // If it only occurs once (its own declaration) and is not printed/used
    if (matches && matches.length === 1) {
      diagnostics.push({
        line,
        severity: 'warning',
        message: `Variable '${name}' is declared/assigned but never read (unused variable).`,
      });
    }
  }

  return diagnostics;
}

/**
 * Detects redundant / duplicate imports
 */
function detectRedundantImports(
  code: string,
  language: SupportedLanguage
): ExecutionDiagnostic[] {
  const diagnostics: ExecutionDiagnostic[] = [];
  const lines = code.split('\n');
  const cleanCode = stripCommentsAndStrings(code, language);

  const seenImports = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const trimmed = lines[i].trim();

    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('from ') ||
      trimmed.startsWith('#include')
    ) {
      if (seenImports.has(trimmed)) {
        diagnostics.push({
          line: lineNum,
          severity: 'warning',
          message: `Redundant duplicate import: '${trimmed}'.`,
        });
      } else {
        seenImports.add(trimmed);
      }

      // Check if specific named import symbol is used in code
      if (language === 'java') {
        const specificImport = trimmed.match(/^import\s+java\.[a-z0-9_.]+\.([A-Za-z_$][\w$]*)\s*;$/);
        if (specificImport && specificImport[1]) {
          const sym = specificImport[1];
          const symRegex = new RegExp(`\\b${sym}\\b`, 'g');
          const occurrences = (cleanCode.match(symRegex) || []).length;
          // Only occurrence is the import statement itself
          if (occurrences <= 1) {
            diagnostics.push({
              line: lineNum,
              severity: 'warning',
              message: `Unused import '${trimmed}' - symbol '${sym}' is never used.`,
            });
          }
        }
      } else if (language === 'python') {
        const pyImport = trimmed.match(/^import\s+([a-zA-Z_]\w*)$/);
        if (pyImport && pyImport[1]) {
          const mod = pyImport[1];
          const modRegex = new RegExp(`\\b${mod}\\b`, 'g');
          const occurrences = (cleanCode.match(modRegex) || []).length;
          if (occurrences <= 1) {
            diagnostics.push({
              line: lineNum,
              severity: 'warning',
              message: `Unused import '${mod}' - module is never referenced.`,
            });
          }
        }
      }
    }

    // Check breakpoint statement in JavaScript
    if (language === 'javascript' && /^\s*debugger\s*;?$/.test(trimmed)) {
      diagnostics.push({
        line: lineNum,
        severity: 'warning',
        message: `Breakpoint statement 'debugger' detected (minor non-blocker).`,
      });
    }
  }

  return diagnostics;
}

/**
 * Preprocesses source code before feeding it to compilers or Gemini:
 * 1. Automatically injects missing Java/C++ standard library imports/headers without altering user code lines
 * 2. Collects minor non-blocking warnings (unused variables, redundant imports, breakpoint statements)
 * 3. Tolerates Python/JS lint quirks
 */
export function preprocessCode(
  code: string,
  language: SupportedLanguage
): PreprocessResult {
  const originalCode = code;
  const diagnostics: ExecutionDiagnostic[] = [];
  const injectedImports: string[] = [];

  let processedCode = code;
  let injectedPrefixLines = 0;

  // 1. JAVA AUTOMATIC IMPORT INJECTION
  if (language === 'java') {
    const cleanCode = stripCommentsAndStrings(code, 'java');

    // Detect common util structures
    const needsJavaUtil =
      /\b(Scanner|Random|ArrayList|LinkedList|HashMap|HashSet|TreeMap|TreeSet|List|Map|Set|Queue|Deque|Stack|Arrays|Collections|PriorityQueue|Iterator|Date|Calendar|UUID|Objects|Optional)\b/.test(
        cleanCode
      );
    const hasJavaUtilImport =
      /import\s+java\.util\./.test(cleanCode) || /import\s+java\.util\s*\.\s*\*/.test(cleanCode);

    // Detect common io structures
    const needsJavaIo =
      /\b(BufferedReader|InputStreamReader|FileReader|FileInputStream|File|IOException)\b/.test(
        cleanCode
      );
    const hasJavaIoImport =
      /import\s+java\.io\./.test(cleanCode) || /import\s+java\.io\s*\.\s*\*/.test(cleanCode);

    const importsToInject: string[] = [];
    if (needsJavaUtil && !hasJavaUtilImport) {
      importsToInject.push('import java.util.*;');
      diagnostics.push({
        line: 1,
        severity: 'warning',
        message: "Auto-injected missing import: 'import java.util.*;'",
      });
    }
    if (needsJavaIo && !hasJavaIoImport) {
      importsToInject.push('import java.io.*;');
      diagnostics.push({
        line: 1,
        severity: 'warning',
        message: "Auto-injected missing import: 'import java.io.*;'",
      });
    }

    if (importsToInject.length > 0) {
      injectedImports.push(...importsToInject);
      const lines = code.split('\n');
      const pkgIdx = lines.findIndex((l) => /^\s*package\s+/.test(l));

      if (pkgIdx >= 0) {
        lines.splice(pkgIdx + 1, 0, ...importsToInject);
        processedCode = lines.join('\n');
      } else {
        processedCode = `${importsToInject.join('\n')}\n${code}`;
        injectedPrefixLines += importsToInject.length;
      }
    }
  }

  // 2. C++ AUTOMATIC HEADER & NAMESPACE RESOLVER
  if (language === 'cpp') {
    const cleanCode = stripCommentsAndStrings(code, 'cpp');
    const headersToInject: string[] = [];

    // <iostream>
    if (
      /\b(cout|cin|endl)\b/.test(cleanCode) &&
      !/#include\s*<iostream>/.test(cleanCode)
    ) {
      headersToInject.push('#include <iostream>');
      diagnostics.push({
        line: 1,
        severity: 'warning',
        message: 'Auto-included missing header: <iostream>',
      });
    }

    // <vector>
    if (
      /\bvector\s*</.test(cleanCode) &&
      !/#include\s*<vector>/.test(cleanCode)
    ) {
      headersToInject.push('#include <vector>');
      diagnostics.push({
        line: 1,
        severity: 'warning',
        message: 'Auto-included missing header: <vector>',
      });
    }

    // <string>
    if (
      /\bstring\b/.test(cleanCode) &&
      !/#include\s*<string>/.test(cleanCode)
    ) {
      headersToInject.push('#include <string>');
      diagnostics.push({
        line: 1,
        severity: 'warning',
        message: 'Auto-included missing header: <string>',
      });
    }

    // <algorithm>
    if (
      /\b(sort|reverse)\s*\(/.test(cleanCode) &&
      !/#include\s*<algorithm>/.test(cleanCode)
    ) {
      headersToInject.push('#include <algorithm>');
      diagnostics.push({
        line: 1,
        severity: 'warning',
        message: 'Auto-included missing header: <algorithm>',
      });
    }

    // using namespace std;
    const hasStdQualifier = /std::(?:cout|cin|endl|vector|string)/.test(cleanCode);
    const hasNamespaceStd = /using\s+namespace\s+std\s*;/.test(cleanCode);
    const usesStdSymbols = /\b(cout|cin|endl|vector|string)\b/.test(cleanCode);

    if (usesStdSymbols && !hasNamespaceStd && !hasStdQualifier) {
      headersToInject.push('using namespace std;');
      diagnostics.push({
        line: 1,
        severity: 'warning',
        message: "Auto-injected 'using namespace std;'",
      });
    }

    if (headersToInject.length > 0) {
      injectedImports.push(...headersToInject);
      processedCode = `${headersToInject.join('\n')}\n${code}`;
      injectedPrefixLines += headersToInject.length;
    }
  }

  // 3. MINOR WARNINGS & LINT DIAGNOSTICS (Unused variables, redundant imports)
  const unusedVars = detectUnusedVariables(code, language);
  diagnostics.push(...unusedVars);

  const redundant = detectRedundantImports(code, language);
  diagnostics.push(...redundant);

  return {
    code: processedCode,
    originalCode,
    injectedImports,
    injectedPrefixLines,
    diagnostics,
  };
}

