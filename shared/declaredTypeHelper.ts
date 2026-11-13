import { SupportedLanguage } from './types';

const JAVA_TYPE_RE =
  /\b(ArrayList\s*<[^;=>]+>|LinkedList\s*<[^;=>]+>|HashMap\s*<[^;=>]+>|HashSet\s*<[^;=>]+>|List\s*<[^;=>]+>|Map\s*<[^;=>]+>|Set\s*<[^;=>]+>|Integer|Double|Float|Long|Boolean|Character|Byte|Short|String|Object|Scanner|StringBuilder|int\[\]|long\[\]|double\[\]|boolean\[\]|char\[\]|String\[\]|Integer\[\]|int|long|double|float|boolean|char|byte|short|var)\s+([A-Za-z_$][\w$]*(?:\s*=\s*[^,;]+)?(?:\s*,\s*[A-Za-z_$][\w$]*(?:\s*=\s*[^,;]+)?)*)/g;

const CPP_TYPE_RE =
  /\b(std::(?:vector|string|unordered_map|map|unordered_set|set|pair|stack|queue)\s*<[^;=>{]+>|std::string|unsigned\s+long\s+long|unsigned\s+int|long\s+long|long\s+double|int|long|double|float|bool|char|short|auto)\s*([*&]*)\s*([A-Za-z_]\w*)/g;

const PY_HINT_RE = /^([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w\[\], ]*)\s*(?:=|$)/;

const NON_VAR_KEYWORDS = new Set([
  'return',
  'new',
  'public',
  'private',
  'protected',
  'static',
  'final',
  'void',
  'class',
  'interface',
  'if',
  'else',
  'for',
  'while',
  'import',
  'package',
  'using',
  'namespace',
  'main',
  'args',
]);

/**
 * Extracts exact declared variable types dynamically from user source code
 * (preserving wrapper classes like Java `Integer` vs `int`, generics, and C++ pointers).
 */
export function extractDeclaredVariableTypes(
  code: string,
  lang: SupportedLanguage
): Map<string, string> {
  const result = new Map<string, string>();
  if (!code) return result;

  const lines = code.split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) {
      continue;
    }

    if (lang === 'java') {
      // Skip method/class header declarations except parameters inside (...)
      const clean = trimmed.replace(/\b(?:public|private|protected|static|final)\b/g, ' ');
      let match: RegExpExecArray | null;
      JAVA_TYPE_RE.lastIndex = 0;
      while ((match = JAVA_TYPE_RE.exec(clean)) !== null) {
        const declaredType = match[1].replace(/\s+/g, ' ').trim();
        const tail = match[2];
        // Skip method signatures like `void foo(` or `int add(`
        const afterMatchIdx = match.index + match[0].length;
        if (clean.slice(afterMatchIdx).trimStart().startsWith('(')) continue;

        const parts = tail.split(',');
        for (const part of parts) {
          const nameMatch = part.trim().match(/^([A-Za-z_$][\w$]*)/);
          if (nameMatch) {
            const varName = nameMatch[1];
            if (!NON_VAR_KEYWORDS.has(varName) && declaredType !== 'var') {
              result.set(varName, declaredType);
            }
          }
        }
      }
    } else if (lang === 'cpp') {
      let match: RegExpExecArray | null;
      CPP_TYPE_RE.lastIndex = 0;
      while ((match = CPP_TYPE_RE.exec(trimmed)) !== null) {
        const baseType = match[1].replace(/\s+/g, ' ').trim();
        const ptrSuffix = match[2] || '';
        const varName = match[3];
        const afterMatchIdx = match.index + match[0].length;
        if (trimmed.slice(afterMatchIdx).trimStart().startsWith('(')) continue;
        if (!NON_VAR_KEYWORDS.has(varName) && baseType !== 'auto') {
          result.set(varName, `${baseType}${ptrSuffix}`);
        }
      }
    } else if (lang === 'python') {
      const m = trimmed.match(PY_HINT_RE);
      if (m && !NON_VAR_KEYWORDS.has(m[1])) {
        result.set(m[1], m[2].trim());
      }
    }
  }

  return result;
}

export function inferRuntimeTypeForLang(val: any, lang: SupportedLanguage): string {
  if (val === null || val === undefined) {
    if (lang === 'python') return 'NoneType';
    if (lang === 'cpp') return 'nullptr_t';
    return 'null';
  }
  if (Array.isArray(val)) {
    if (lang === 'python') return 'list';
    if (lang === 'cpp') return 'std::vector';
    if (lang === 'java') return 'ArrayList';
    return 'Array';
  }
  if (typeof val === 'boolean') {
    return lang === 'python' || lang === 'cpp' ? 'bool' : 'boolean';
  }
  if (typeof val === 'number') {
    if (lang === 'javascript') return 'number';
    if (lang === 'python') return Number.isInteger(val) ? 'int' : 'float';
    return Number.isInteger(val) ? 'int' : 'double';
  }
  if (typeof val === 'string') {
    if (lang === 'python') return 'str';
    if (lang === 'java') return 'String';
    if (lang === 'cpp') return 'std::string';
    return 'string';
  }
  if (typeof val === 'object') {
    if (lang === 'python') return 'dict';
    if (lang === 'cpp') return 'struct';
    return 'Object';
  }
  return typeof val;
}

/**
 * Resolves the display type badge for a variable snapshot, ensuring static/declared
 * wrapper or generic types from code (e.g., `Integer` vs `int`) are never downgraded.
 */
export function resolveAccurateVariableType(
  candidateType: string | null | undefined,
  val: any,
  lang: SupportedLanguage,
  varName: string,
  declaredMap: Map<string, string>
): string {
  const declared = declaredMap.get(varName);
  if (declared) return declared;

  const trimmed = candidateType ? candidateType.trim() : '';
  if (trimmed) {
    // Guard against JS type names leaking into Java/C++/Python
    if (lang !== 'javascript' && trimmed.toLowerCase() === 'number') {
      return inferRuntimeTypeForLang(val, lang);
    }
    return trimmed;
  }

  return inferRuntimeTypeForLang(val, lang);
}

