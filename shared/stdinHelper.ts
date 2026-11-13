import type { SupportedLanguage } from './types';

export type InputHintType =
  | 'int'
  | 'float'
  | 'char'
  | 'operator'
  | 'boolean'
  | 'string'
  | 'count';

export interface DetectedInputCall {
  line: number;
  targetVar?: string;
  hintType: InputHintType;
  rawCall: string;
  promptText?: string;
}

function stripCommentsPreserveLines(code: string, language: SupportedLanguage): string {
  if (language === 'python') {
    return code
      .split(/\r?\n/)
      .map((line) => {
        // Strip trailing # comments outside quotes (best-effort)
        let inSingle = false;
        let inDouble = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          const prev = i > 0 ? line[i - 1] : '';
          if (ch === "'" && !inDouble && prev !== '\\') inSingle = !inSingle;
          else if (ch === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
          else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
        }
        return line;
      })
      .join('\n');
  }

  // Strip /* ... */ while preserving newline count, then // ...
  const withoutBlock = code.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\r\n]/g, ' ')
  );
  return withoutBlock
    .split(/\r?\n/)
    .map((line) => {
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length - 1; i++) {
        const ch = line[i];
        const prev = i > 0 ? line[i - 1] : '';
        if (ch === "'" && !inDouble && prev !== '\\') inSingle = !inSingle;
        else if (ch === '"' && !inSingle && prev !== '\\') inDouble = !inDouble;
        else if (ch === '/' && line[i + 1] === '/' && !inSingle && !inDouble) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

function inferHintTypeFromContext(
  varName: string | undefined,
  explicitType: InputHintType,
  fullCode: string,
  prevPrompt?: string
): InputHintType {
  const combined = `${varName || ''} ${prevPrompt || ''}`.toLowerCase();
  if (
    explicitType === 'char' ||
    /\b(op|operator|sign|choice|cmd|action)\b/.test(combined) ||
    /operator|অপারেটর|যোগ|বিয়োগ|\+\s*,\s*-/.test(combined)
  ) {
    if (explicitType === 'int' && /\b(choice|option|menu)\b/.test(combined)) {
      return 'int';
    }
    if (
      explicitType === 'char' ||
      explicitType === 'string' ||
      /operator|অপারেটর/.test(combined)
    ) {
      if (
        /switch\s*\(/.test(fullCode) ||
        /['"][+\-*/%]['"]/.test(fullCode) ||
        /operator/.test(combined)
      ) {
        return 'operator';
      }
    }
    if (explicitType === 'char') return 'char';
  }

  if (/\b(n|count|size|len|length|limit|times|rows|cols|num_items)\b/.test(combined)) {
    if (explicitType === 'int' || explicitType === 'string') return 'count';
  }
  if (/\b(name|user|username|city|country|word|text|str|sentence|msg|message)\b/.test(combined)) {
    if (explicitType === 'string') return 'string';
  }
  return explicitType;
}

/**
 * Detects STDIN input calls in source code in execution/appearance order.
 * Avoids false positives for Java `new Scanner("hardcoded")` when `System.in` is absent.
 */
export function detectInputCalls(
  code: string,
  language: SupportedLanguage
): DetectedInputCall[] {
  if (!code || !code.trim()) return [];
  const cleaned = stripCommentsPreserveLines(code, language);
  const lines = cleaned.split(/\r?\n/);
  const calls: DetectedInputCall[] = [];

  if (language === 'java') {
    const usesSystemIn =
      /System\.in/.test(cleaned) ||
      /System\.console\s*\(/.test(cleaned) ||
      !/new\s+Scanner\s*\(\s*"/.test(cleaned);
    if (!usesSystemIn) return [];

    // Find scanner variable names if declared
    const scannerVars = new Set<string>(['scanner', 'sc', 'in', 'input', 'scan', 'reader', 'kb']);
    const declRegex = /Scanner\s+([A-Za-z_]\w*)\s*=\s*new\s+Scanner\s*\(\s*System\.in\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = declRegex.exec(cleaned)) !== null) {
      scannerVars.add(m[1]);
    }
    // If new Scanner("...") exists without System.in for a var, remove it
    const literalScannerRegex = /Scanner\s+([A-Za-z_]\w*)\s*=\s*new\s+Scanner\s*\(\s*"/g;
    while ((m = literalScannerRegex.exec(cleaned)) !== null) {
      scannerVars.delete(m[1]);
    }

    let lastPrompt = '';
    lines.forEach((line, idx) => {
      const promptMatch = line.match(/System\.out\.print(?:ln)?\s*\(\s*"([^"]*)"\s*\)/);
      if (promptMatch) lastPrompt = promptMatch[1];

      const nextRegex =
        /(?:([A-Za-z_]\w*(?:\[\])?)\s+)?([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\.(nextDouble|nextInt|nextLong|nextFloat|nextBoolean|nextLine|next)\s*\(\s*\)(?:\s*\.charAt\s*\(\s*0\s*\))?/g;
      let match: RegExpExecArray | null;
      let foundOnLine = false;
      while ((match = nextRegex.exec(line)) !== null) {
        const declType = (match[1] || '').toLowerCase();
        const targetVar = match[2];
        const receiver = match[3];
        const method = match[4];
        if (!scannerVars.has(receiver) && !/System\.in/.test(cleaned)) continue;

        foundOnLine = true;
        let explicitType: InputHintType = 'string';
        if (method === 'nextInt' || method === 'nextLong' || declType === 'int' || declType === 'long') {
          explicitType = 'int';
        } else if (
          method === 'nextDouble' ||
          method === 'nextFloat' ||
          declType === 'double' ||
          declType === 'float'
        ) {
          explicitType = 'float';
        } else if (method === 'nextBoolean' || declType === 'boolean') {
          explicitType = 'boolean';
        } else if (declType === 'char' || /\.charAt\s*\(/.test(line)) {
          explicitType = 'char';
        }

        calls.push({
          line: idx + 1,
          targetVar,
          hintType: inferHintTypeFromContext(targetVar, explicitType, cleaned, lastPrompt),
          rawCall: match[0],
          promptText: lastPrompt || undefined,
        });
      }

      if (!foundOnLine) {
        const bareRegex =
          /([A-Za-z_]\w*)\.(nextDouble|nextInt|nextLong|nextFloat|nextBoolean|nextLine|next)\s*\(\s*\)|\.readLine\s*\(\s*\)/g;
        while ((match = bareRegex.exec(line)) !== null) {
          const receiver = match[1] || '';
          const method = match[2] || 'readLine';
          if (receiver && !scannerVars.has(receiver) && !/System\.in/.test(cleaned)) continue;
          let explicitType: InputHintType = 'string';
          if (method === 'nextInt' || method === 'nextLong') explicitType = 'int';
          else if (method === 'nextDouble' || method === 'nextFloat') explicitType = 'float';
          else if (method === 'nextBoolean') explicitType = 'boolean';
          else if (/\.charAt\s*\(/.test(line)) explicitType = 'char';
          calls.push({
            line: idx + 1,
            hintType: inferHintTypeFromContext(undefined, explicitType, cleaned, lastPrompt),
            rawCall: match[0],
            promptText: lastPrompt || undefined,
          });
        }
      }
    });
    return calls;
  }

  if (language === 'python') {
    lines.forEach((line, idx) => {
      const assignInput = line.match(
        /^\s*([A-Za-z_]\w*)\s*=\s*(?:(int|float|eval)\s*\(\s*)?(?:input|sys\.stdin\.readline)\s*\(\s*(?:["']([^"']*)["'])?/
      );
      if (assignInput) {
        const targetVar = assignInput[1];
        const castFn = assignInput[2];
        const promptText = assignInput[3];
        let explicitType: InputHintType = 'string';
        if (castFn === 'int') explicitType = 'int';
        else if (castFn === 'float') explicitType = 'float';
        calls.push({
          line: idx + 1,
          targetVar,
          hintType: inferHintTypeFromContext(targetVar, explicitType, cleaned, promptText),
          rawCall: assignInput[0].trim(),
          promptText: promptText || undefined,
        });
        return;
      }

      const rawInput = line.match(
        /(?:(int|float)\s*\(\s*)?\b(?:input|sys\.stdin\.readline|sys\.stdin\.read)\s*\(\s*(?:["']([^"']*)["'])?/
      );
      if (rawInput) {
        const castFn = rawInput[1];
        const promptText = rawInput[2];
        let explicitType: InputHintType = 'string';
        if (castFn === 'int') explicitType = 'int';
        else if (castFn === 'float') explicitType = 'float';
        calls.push({
          line: idx + 1,
          hintType: inferHintTypeFromContext(undefined, explicitType, cleaned, promptText),
          rawCall: rawInput[0].trim(),
          promptText: promptText || undefined,
        });
      }
    });
    return calls;
  }

  if (language === 'cpp') {
    // Track declared C++ variable types so `cin >> a >> b` knows types
    const varTypes = new Map<string, InputHintType>();
    const declMatches = cleaned.matchAll(
      /\b(int|long(?:\s+long)?|short|size_t|float|double|char|bool|string|std::string)\s+([^;]+);/g
    );
    for (const dm of declMatches) {
      const rawType = dm[1];
      let hType: InputHintType = 'string';
      if (/float|double/.test(rawType)) hType = 'float';
      else if (/char/.test(rawType)) hType = 'char';
      else if (/bool/.test(rawType)) hType = 'boolean';
      else if (/int|long|short|size_t/.test(rawType)) hType = 'int';
      const names = dm[2].split(',');
      for (const n of names) {
        const vMatch = n.trim().match(/^([A-Za-z_]\w*)/);
        if (vMatch) varTypes.set(vMatch[1], hType);
      }
    }

    let lastPrompt = '';
    lines.forEach((line, idx) => {
      const coutMatch = line.match(/cout\s*<<\s*"([^"]*)"/);
      if (coutMatch) lastPrompt = coutMatch[1];

      const getlineMatch = line.match(/(?:std::)?getline\s*\(\s*(?:std::)?cin\s*,\s*([A-Za-z_]\w*)\s*\)/);
      if (getlineMatch) {
        calls.push({
          line: idx + 1,
          targetVar: getlineMatch[1],
          hintType: inferHintTypeFromContext(getlineMatch[1], 'string', cleaned, lastPrompt),
          rawCall: getlineMatch[0],
          promptText: lastPrompt || undefined,
        });
        return;
      }

      if (/\b(?:std::)?cin\s*>>/.test(line)) {
        const afterCin = line.split(/cin\s*>>/)[1] || '';
        const parts = afterCin.split('>>').map((p) => p.replace(/;.*/, '').trim()).filter(Boolean);
        for (const targetVar of parts) {
          const cleanVar = targetVar.replace(/[^A-Za-z0-9_]/g, '');
          const explicitType = varTypes.get(cleanVar) || 'int';
          calls.push({
            line: idx + 1,
            targetVar: cleanVar || undefined,
            hintType: inferHintTypeFromContext(cleanVar, explicitType, cleaned, lastPrompt),
            rawCall: `cin >> ${targetVar}`,
            promptText: lastPrompt || undefined,
          });
        }
        return;
      }

      const scanfMatch = line.match(/\bscanf\s*\(\s*"([^"]+)"([^)]*)\)/);
      if (scanfMatch) {
        const fmt = scanfMatch[1];
        const args = scanfMatch[2]
          .split(',')
          .slice(1)
          .map((a) => a.trim().replace(/^&/, ''));
        const specs = Array.from(fmt.matchAll(/%([0-9.]*(?:ll|l)?[dfcs]|lf)/g));
        specs.forEach((sp, i) => {
          const s = sp[1];
          const targetVar = args[i];
          let explicitType: InputHintType = 'string';
          if (s.endsWith('f')) explicitType = 'float';
          else if (s === 'c') explicitType = 'char';
          else if (s.endsWith('d') || s.endsWith('i') || s.endsWith('u')) explicitType = 'int';
          calls.push({
            line: idx + 1,
            targetVar,
            hintType: inferHintTypeFromContext(targetVar, explicitType, cleaned, lastPrompt),
            rawCall: scanfMatch[0],
            promptText: lastPrompt || undefined,
          });
        });
      }
    });
    return calls;
  }

  // JavaScript
  lines.forEach((line, idx) => {
    const jsMatch = line.match(
      /(?:(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*)?(?:Number\s*\(\s*|parseInt\s*\(\s*|parseFloat\s*\(\s*)?\b(prompt|readline)\s*\(/
    );
    if (jsMatch) {
      const targetVar = jsMatch[1];
      let explicitType: InputHintType = 'string';
      if (/parseInt/.test(line)) explicitType = 'int';
      else if (/Number|parseFloat/.test(line)) explicitType = 'float';
      calls.push({
        line: idx + 1,
        targetVar,
        hintType: inferHintTypeFromContext(targetVar, explicitType, cleaned),
        rawCall: jsMatch[0],
      });
    }
  });
  return calls;
}

/**
 * Generates realistic, context-aware sample STDIN values matching each detected read.
 * Avoids division-by-zero and prefers safe operator tokens when switch cases are present.
 */
export function generateSampleStdin(code: string, language: SupportedLanguage): string {
  const calls = detectInputCalls(code, language);
  if (calls.length === 0) return '';

  // Detect preferred operator from switch/if cases in source code
  const preferredOps = ['*', '+', '-', '/'];
  let sampleOp = '*';
  const matchedOps = preferredOps.filter((op) => {
    const escaped = op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`case\\s+['"]${escaped}['"]|==\\s*['"]${escaped}['"]`).test(code);
  });
  if (matchedOps.length > 0) {
    sampleOp = matchedOps.includes('*') ? '*' : matchedOps[0];
  }

  const numericSeeds = [25, 5, 12, 8, 4, 15];
  let numIdx = 0;
  const stringSeeds = ['Rahim', 'LogicLab', 'Dhaka', 'hello'];
  let strIdx = 0;

  const tokens: string[] = [];
  for (const call of calls) {
    switch (call.hintType) {
      case 'operator':
        tokens.push(sampleOp);
        break;
      case 'char': {
        // Check if switch cases have single letters like 'a', 'A', '+'
        const charCase = code.match(/case\s+['"]([^'"])['"]/);
        tokens.push(charCase ? charCase[1] : 'A');
        break;
      }
      case 'boolean':
        tokens.push('true');
        break;
      case 'count':
        tokens.push('5');
        break;
      case 'int':
      case 'float': {
        const val = numericSeeds[numIdx % numericSeeds.length];
        numIdx++;
        tokens.push(String(val));
        break;
      }
      case 'string':
      default: {
        // If Python input() without cast has arithmetic context on same var, give numeric string
        if (
          call.targetVar &&
          new RegExp(`\\b(?:int|float|Number|parseInt)\\s*\\(\\s*${call.targetVar}\\b`).test(code)
        ) {
          const val = numericSeeds[numIdx % numericSeeds.length];
          numIdx++;
          tokens.push(String(val));
        } else {
          tokens.push(stringSeeds[strIdx % stringSeeds.length]);
          strIdx++;
        }
        break;
      }
    }
  }

  return tokens.join('\n');
}

/**
 * Splits STDIN text into whitespace-delimited tokens for queue/buffer visualization.
 */
export function tokenizeStdin(stdin: string): string[] {
  if (!stdin) return [];
  return stdin
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Distinguishes true compilation/syntax errors from runtime/input errors.
 */
export function classifyErrorCategory(
  message: string,
  hasCompileFailure: boolean
): 'compile_error' | 'runtime_error' | 'input_error' {
  if (hasCompileFailure) return 'compile_error';
  if (
    /NoSuchElementException|EOFError|InputMismatchException|EOF when reading a line|insufficient input|missing stdin/i.test(
      message
    )
  ) {
    return 'input_error';
  }
  return 'runtime_error';
}

