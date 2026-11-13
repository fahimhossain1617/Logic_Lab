import { ExtractedSymbol, IntelliSenseLanguage } from './types';

const KEYWORDS_BY_LANG: Record<IntelliSenseLanguage, Set<string>> = {
  java: new Set([
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
    'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'false',
    'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof',
    'int', 'interface', 'long', 'native', 'new', 'null', 'package', 'private', 'protected',
    'public', 'record', 'return', 'short', 'static', 'strictfp', 'super', 'switch',
    'synchronized', 'this', 'throw', 'throws', 'transient', 'true', 'try', 'var', 'void',
    'volatile', 'while', 'String', 'Integer', 'Double', 'Boolean', 'Object', 'System',
  ]),
  cpp: new Set([
    'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool', 'break',
    'case', 'catch', 'char', 'char8_t', 'char16_t', 'char32_t', 'class', 'compl', 'concept',
    'const', 'consteval', 'constexpr', 'constinit', 'const_cast', 'continue', 'co_await',
    'co_return', 'co_yield', 'decltype', 'default', 'delete', 'do', 'double', 'dynamic_cast',
    'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto',
    'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'not', 'not_eq',
    'nullptr', 'operator', 'or', 'or_eq', 'private', 'protected', 'public', 'register',
    'reinterpret_cast', 'requires', 'return', 'short', 'signed', 'sizeof', 'static',
    'static_assert', 'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local',
    'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using',
    'virtual', 'void', 'volatile', 'wchar_t', 'while', 'xor', 'xor_eq', 'std', 'cout', 'cin',
    'endl', 'vector', 'string', 'map', 'unordered_map', 'set', 'pair', 'queue', 'stack',
  ]),
  python: new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
    'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
    'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return',
    'try', 'while', 'with', 'yield', 'self', 'cls', 'print', 'len', 'range', 'int', 'str',
    'float', 'list', 'dict', 'set', 'tuple', 'bool',
  ]),
  javascript: new Set([
    'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function',
    'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null',
    'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch',
    'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while', 'with',
    'yield', 'async', 'of', 'console', 'Math', 'JSON', 'Object', 'Array', 'Promise',
  ]),
};

/**
 * Strips comments and string literals while preserving newlines so line numbers
 * stay exact. Runs in O(n) single pass (< 1ms for typical editor files).
 */
export function stripCommentsAndStrings(
  source: string,
  language: IntelliSenseLanguage
): string {
  const len = source.length;
  const out: string[] = [];
  let i = 0;

  while (i < len) {
    const ch = source[i];
    const next = i + 1 < len ? source[i + 1] : '';

    // Python comments and triple-quoted strings
    if (language === 'python') {
      if (ch === '#') {
        while (i < len && source[i] !== '\n') {
          out.push(' ');
          i++;
        }
        continue;
      }
      if ((ch === '"' || ch === "'") && source.slice(i, i + 3) === ch.repeat(3)) {
        const quote3 = ch.repeat(3);
        out.push('   ');
        i += 3;
        while (i < len && source.slice(i, i + 3) !== quote3) {
          if (source[i] === '\\' && i + 1 < len) {
            out.push(source[i + 1] === '\n' ? '\n' : ' ');
            out.push(' ');
            i += 2;
          } else {
            out.push(source[i] === '\n' ? '\n' : ' ');
            i++;
          }
        }
        if (i < len) {
          out.push('   ');
          i += 3;
        }
        continue;
      }
    } else {
      // C-style line comment //
      if (ch === '/' && next === '/') {
        while (i < len && source[i] !== '\n') {
          out.push(' ');
          i++;
        }
        continue;
      }
      // C-style block comment /* ... */
      if (ch === '/' && next === '*') {
        out.push('  ');
        i += 2;
        while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
          out.push(source[i] === '\n' ? '\n' : ' ');
          i++;
        }
        if (i < len) {
          out.push('  ');
          i += 2;
        }
        continue;
      }
    }

    // Single-line strings ("...", '...') and JS template literals (`...`)
    if (
      ch === '"' ||
      ch === "'" ||
      (language === 'javascript' && ch === '`')
    ) {
      const quote = ch;
      out.push(' ');
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < len) {
          out.push(source[i + 1] === '\n' ? '\n' : ' ');
          out.push(' ');
          i += 2;
        } else if (source[i] === '\n' && quote !== '`') {
          break;
        } else {
          out.push(source[i] === '\n' ? '\n' : ' ');
          i++;
        }
      }
      if (i < len && source[i] === quote) {
        out.push(' ');
        i++;
      }
      continue;
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}

function splitTopLevelCommas(raw: string): string[] {
  const parts: string[] = [];
  let depthAngle = 0;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let start = 0;

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '<') depthAngle++;
    else if (c === '>' && depthAngle > 0) depthAngle--;
    else if (c === '(') depthParen++;
    else if (c === ')' && depthParen > 0) depthParen--;
    else if (c === '[') depthBracket++;
    else if (c === ']' && depthBracket > 0) depthBracket--;
    else if (c === '{') depthBrace++;
    else if (c === '}' && depthBrace > 0) depthBrace--;
    else if (
      c === ',' &&
      depthAngle === 0 &&
      depthParen === 0 &&
      depthBracket === 0 &&
      depthBrace === 0
    ) {
      parts.push(raw.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function extractParamNames(rawParams: string, language: IntelliSenseLanguage): string[] {
  if (!rawParams.trim()) return [];
  const params = splitTopLevelCommas(rawParams);
  const names: string[] = [];

  for (const param of params) {
    let cleaned = param.trim();
    if (!cleaned) continue;

    // Strip default value (= ...)
    const eqIdx = cleaned.indexOf('=');
    if (eqIdx !== -1) cleaned = cleaned.slice(0, eqIdx).trim();

    if (language === 'python') {
      // Strip type hint (: int) and * / **
      const colonIdx = cleaned.indexOf(':');
      if (colonIdx !== -1) cleaned = cleaned.slice(0, colonIdx).trim();
      cleaned = cleaned.replace(/^\*+/, '').trim();
      if (/^[A-Za-z_]\w*$/.test(cleaned)) names.push(cleaned);
    } else if (language === 'javascript') {
      // Handle rest ...args and simple identifiers (skip complex destructuring)
      cleaned = cleaned.replace(/^\.{3}/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(cleaned)) {
        names.push(cleaned);
      } else if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
        const inner = cleaned.replace(/[{}[\]]/g, '');
        for (const token of inner.split(',')) {
          const id = token.split(':')[1]?.trim() || token.trim();
          const cleanId = id.replace(/^\.{3}/, '').trim();
          if (/^[A-Za-z_$][\w$]*$/.test(cleanId)) names.push(cleanId);
        }
      }
    } else {
      // Java & C++: last identifier before optional []
      const withoutBrackets = cleaned.replace(/\[\s*\]/g, '').trim();
      const match = withoutBrackets.match(/([A-Za-z_]\w*)$/);
      if (match) names.push(match[1]);
    }
  }

  return names;
}

/**
 * Extracts user-defined symbols (classes, structs, functions, methods, variables,
 * constants, parameters, and imports) from the active document in real time.
 */
export function extractDocumentSymbols(
  source: string,
  language: IntelliSenseLanguage,
  cursorLine?: number,
  currentWord?: string
): ExtractedSymbol[] {
  if (!source.trim()) return [];

  const sanitized = stripCommentsAndStrings(source, language);
  const lines = sanitized.split('\n');
  const keywords = KEYWORDS_BY_LANG[language];
  const seen = new Map<string, ExtractedSymbol>();

  const addSymbol = (
    name: string,
    kind: ExtractedSymbol['kind'],
    detail: string,
    lineNumber: number
  ) => {
    if (!name || keywords.has(name)) return;
    // Avoid suggesting the exact word currently being typed if it only exists at cursor line
    if (
      currentWord &&
      name === currentWord &&
      cursorLine === lineNumber &&
      !seen.has(name)
    ) {
      return;
    }
    const existing = seen.get(name);
    // Prefer higher-level declarations (Class/Function/Method) over Variable
    if (!existing || (existing.kind === 'Variable' && kind !== 'Variable')) {
      seen.set(name, { name, kind, detail, lineNumber });
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNum = idx + 1;
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (language === 'java') {
      const classMatch = line.match(/\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/);
      if (classMatch) {
        addSymbol(classMatch[1], 'Class', `Java Class (Ln ${lineNum})`, lineNum);
      }

      const methodMatch = line.match(
        /^\s*(?:(?:public|private|protected|static|final|synchronized|abstract|default)\s+)*(?:[\w<>\[\], ?]+)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws\s+[\w,\s]+)?\{?/
      );
      if (
        methodMatch &&
        !['if', 'for', 'while', 'switch', 'catch', 'synchronized'].includes(methodMatch[1]) &&
        (line.includes('{') || trimmed.endsWith(')'))
      ) {
        const methodName = methodMatch[1];
        const params = methodMatch[2].trim();
        addSymbol(
          methodName,
          'Method',
          `Method • ${methodName}(${params}) (Ln ${lineNum})`,
          lineNum
        );
        for (const p of extractParamNames(params, 'java')) {
          addSymbol(p, 'Variable', `Parameter in ${methodName}() (Ln ${lineNum})`, lineNum);
        }
      }

      // Variable / field / constant declarations
      const varRegex =
        /\b(?:final\s+)?(?:int|long|double|float|boolean|char|byte|short|String|var|Object|Integer|Double|Boolean|Character|Long|Scanner|Random|ArrayList|HashMap|HashSet|LinkedList|List|Map|Set|Queue|Stack|PriorityQueue|StringBuilder|[A-Z][A-Za-z0-9_]*(?:<[^>;=]+>)?)(?:\s*\[\s*\])*\s+([a-zA-Z_]\w*)\s*(?=[=;,:\)])/g;
      let m: RegExpExecArray | null;
      while ((m = varRegex.exec(line)) !== null) {
        const varName = m[1];
        const isConst = /\bfinal\b/.test(line) && /^[A-Z0-9_]+$/.test(varName);
        addSymbol(
          varName,
          isConst ? 'Constant' : 'Variable',
          `${isConst ? 'Constant' : 'Local variable'} (Ln ${lineNum})`,
          lineNum
        );
      }
    } else if (language === 'cpp') {
      const structMatch = line.match(/\b(class|struct|enum(?:\s+class)?)\s+([A-Za-z_]\w*)/);
      if (structMatch) {
        const isStruct = structMatch[1].startsWith('struct');
        addSymbol(
          structMatch[2],
          isStruct ? 'Struct' : 'Class',
          `C++ ${isStruct ? 'Struct' : 'Class'} (Ln ${lineNum})`,
          lineNum
        );
      }

      const defineMatch = line.match(/^\s*#define\s+([A-Za-z_]\w*)/);
      if (defineMatch) {
        addSymbol(defineMatch[1], 'Constant', `Macro #define (Ln ${lineNum})`, lineNum);
      }

      const fnMatch = line.match(
        /^\s*(?:inline\s+|static\s+|virtual\s+|constexpr\s+)*(?:[\w:*&<> ]+?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:const\s*)?(?:override\s*)?(?:\{|;)/
      );
      if (
        fnMatch &&
        !['if', 'for', 'while', 'switch', 'catch'].includes(fnMatch[1])
      ) {
        const fnName = fnMatch[1];
        const params = fnMatch[2].trim();
        addSymbol(
          fnName,
          'Function',
          `Function • ${fnName}(${params}) (Ln ${lineNum})`,
          lineNum
        );
        for (const p of extractParamNames(params, 'cpp')) {
          addSymbol(p, 'Variable', `Parameter in ${fnName}() (Ln ${lineNum})`, lineNum);
        }
      }

      const varRegex =
        /\b(?:const\s+|static\s+|unsigned\s+|long\s+)*(?:auto|int|long(?:\s+long)?|double|float|bool|char|size_t|string|std::string|vector|std::vector|map|std::map|unordered_map|std::unordered_map|set|std::set|pair|std::pair|queue|std::queue|stack|std::stack|deque|priority_queue)(?:<[^>;=]+>)?\s*[*&]*\s*([A-Za-z_]\w*)\s*(?=[=;,:\(\[])/g;
      let m: RegExpExecArray | null;
      while ((m = varRegex.exec(line)) !== null) {
        const varName = m[1];
        const isConst = /\b(?:const|constexpr)\b/.test(line) && /^[A-Z0-9_]+$/.test(varName);
        addSymbol(
          varName,
          isConst ? 'Constant' : 'Variable',
          `${isConst ? 'Constant' : 'Variable'} (Ln ${lineNum})`,
          lineNum
        );
      }
    } else if (language === 'python') {
      const classMatch = line.match(/^\s*class\s+([A-Za-z_]\w*)/);
      if (classMatch) {
        addSymbol(classMatch[1], 'Class', `Python Class (Ln ${lineNum})`, lineNum);
      }

      const defMatch = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
      if (defMatch) {
        const fnName = defMatch[1];
        const params = defMatch[2].trim();
        addSymbol(
          fnName,
          'Function',
          `Function • def ${fnName}(${params}) (Ln ${lineNum})`,
          lineNum
        );
        for (const p of extractParamNames(params, 'python')) {
          addSymbol(p, 'Variable', `Parameter in ${fnName}() (Ln ${lineNum})`, lineNum);
        }
      }

      const assignMatch = line.match(/^\s*([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*(?::[^=]+)?=\s*(?!=)/);
      if (assignMatch) {
        for (const rawName of assignMatch[1].split(',')) {
          const varName = rawName.trim();
          const isConst = /^[A-Z][A-Z0-9_]*$/.test(varName);
          addSymbol(
            varName,
            isConst ? 'Constant' : 'Variable',
            `${isConst ? 'Constant' : 'Variable'} (Ln ${lineNum})`,
            lineNum
          );
        }
      }

      const forMatch = line.match(/\bfor\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\b/);
      if (forMatch) {
        for (const rawName of forMatch[1].split(',')) {
          addSymbol(rawName.trim(), 'Variable', `Loop variable (Ln ${lineNum})`, lineNum);
        }
      }

      const importMatch = line.match(/^\s*(?:from\s+[\w.]+\s+)?import\s+(.+)$/);
      if (importMatch) {
        for (const part of importMatch[1].split(',')) {
          const aliasMatch = part.trim().match(/(?:[\w.]+\s+as\s+)?([A-Za-z_]\w*)$/);
          if (aliasMatch) {
            addSymbol(aliasMatch[1], 'Module', `Imported module (Ln ${lineNum})`, lineNum);
          }
        }
      }
    } else if (language === 'javascript') {
      const classMatch = line.match(/\bclass\s+([A-Za-z_$][\w$]*)/);
      if (classMatch) {
        addSymbol(classMatch[1], 'Class', `JS Class (Ln ${lineNum})`, lineNum);
      }

      const fnMatch = line.match(/\b(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
      if (fnMatch) {
        const fnName = fnMatch[1];
        const params = fnMatch[2].trim();
        addSymbol(
          fnName,
          'Function',
          `Function • ${fnName}(${params}) (Ln ${lineNum})`,
          lineNum
        );
        for (const p of extractParamNames(params, 'javascript')) {
          addSymbol(p, 'Variable', `Parameter in ${fnName}() (Ln ${lineNum})`, lineNum);
        }
      }

      const arrowMatch = line.match(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\(([^)]*)\)|([A-Za-z_$][\w$]*))\s*=>/
      );
      if (arrowMatch) {
        const fnName = arrowMatch[1];
        const params = (arrowMatch[2] ?? arrowMatch[3] ?? '').trim();
        addSymbol(
          fnName,
          'Function',
          `Arrow Function • ${fnName}(${params}) (Ln ${lineNum})`,
          lineNum
        );
        for (const p of extractParamNames(params, 'javascript')) {
          addSymbol(p, 'Variable', `Parameter in ${fnName}() (Ln ${lineNum})`, lineNum);
        }
      }

      const varRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
      let m: RegExpExecArray | null;
      while ((m = varRegex.exec(line)) !== null) {
        const varName = m[1];
        const isConst = /\bconst\b/.test(line) && /^[A-Z][A-Z0-9_]*$/.test(varName);
        addSymbol(
          varName,
          isConst ? 'Constant' : 'Variable',
          `${isConst ? 'Constant' : 'Variable'} (Ln ${lineNum})`,
          lineNum
        );
      }

      const catchMatch = line.match(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
      if (catchMatch) {
        addSymbol(catchMatch[1], 'Variable', `Catch binding (Ln ${lineNum})`, lineNum);
      }
    }
  }

  return Array.from(seen.values());
}

