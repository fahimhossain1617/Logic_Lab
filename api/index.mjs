var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// server/src/vercel.ts
import "dotenv/config";

// server/src/app.ts
import express from "express";

// server/src/routes/apiRoutes.ts
import { Router } from "express";
import fs7 from "node:fs";
import os2 from "node:os";
import path7 from "node:path";
import { z as z2 } from "zod";

// server/src/services/geminiTraceService.ts
import crypto2 from "node:crypto";
import { GoogleGenAI, Type } from "@google/genai";

// shared/declaredTypeHelper.ts
var JAVA_TYPE_RE = /\b(ArrayList\s*<[^;=>]+>|LinkedList\s*<[^;=>]+>|HashMap\s*<[^;=>]+>|HashSet\s*<[^;=>]+>|List\s*<[^;=>]+>|Map\s*<[^;=>]+>|Set\s*<[^;=>]+>|Integer|Double|Float|Long|Boolean|Character|Byte|Short|String|Object|Scanner|StringBuilder|int\[\]|long\[\]|double\[\]|boolean\[\]|char\[\]|String\[\]|Integer\[\]|int|long|double|float|boolean|char|byte|short|var)\s+([A-Za-z_$][\w$]*(?:\s*=\s*[^,;]+)?(?:\s*,\s*[A-Za-z_$][\w$]*(?:\s*=\s*[^,;]+)?)*)/g;
var CPP_TYPE_RE = /\b(std::(?:vector|string|unordered_map|map|unordered_set|set|pair|stack|queue)\s*<[^;=>{]+>|std::string|unsigned\s+long\s+long|unsigned\s+int|long\s+long|long\s+double|int|long|double|float|bool|char|short|auto)\s*([*&]*)\s*([A-Za-z_]\w*)/g;
var PY_HINT_RE = /^([A-Za-z_]\w*)\s*:\s*([A-Za-z_][\w\[\], ]*)\s*(?:=|$)/;
var NON_VAR_KEYWORDS = /* @__PURE__ */ new Set([
  "return",
  "new",
  "public",
  "private",
  "protected",
  "static",
  "final",
  "void",
  "class",
  "interface",
  "if",
  "else",
  "for",
  "while",
  "import",
  "package",
  "using",
  "namespace",
  "main",
  "args"
]);
function extractDeclaredVariableTypes(code, lang) {
  const result = /* @__PURE__ */ new Map();
  if (!code) return result;
  const lines = code.split("\n");
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
      continue;
    }
    if (lang === "java") {
      const clean = trimmed.replace(/\b(?:public|private|protected|static|final)\b/g, " ");
      let match;
      JAVA_TYPE_RE.lastIndex = 0;
      while ((match = JAVA_TYPE_RE.exec(clean)) !== null) {
        const declaredType = match[1].replace(/\s+/g, " ").trim();
        const tail = match[2];
        const afterMatchIdx = match.index + match[0].length;
        if (clean.slice(afterMatchIdx).trimStart().startsWith("(")) continue;
        const parts = tail.split(",");
        for (const part of parts) {
          const nameMatch = part.trim().match(/^([A-Za-z_$][\w$]*)/);
          if (nameMatch) {
            const varName = nameMatch[1];
            if (!NON_VAR_KEYWORDS.has(varName) && declaredType !== "var") {
              result.set(varName, declaredType);
            }
          }
        }
      }
    } else if (lang === "cpp") {
      let match;
      CPP_TYPE_RE.lastIndex = 0;
      while ((match = CPP_TYPE_RE.exec(trimmed)) !== null) {
        const baseType = match[1].replace(/\s+/g, " ").trim();
        const ptrSuffix = match[2] || "";
        const varName = match[3];
        const afterMatchIdx = match.index + match[0].length;
        if (trimmed.slice(afterMatchIdx).trimStart().startsWith("(")) continue;
        if (!NON_VAR_KEYWORDS.has(varName) && baseType !== "auto") {
          result.set(varName, `${baseType}${ptrSuffix}`);
        }
      }
    } else if (lang === "python") {
      const m = trimmed.match(PY_HINT_RE);
      if (m && !NON_VAR_KEYWORDS.has(m[1])) {
        result.set(m[1], m[2].trim());
      }
    }
  }
  return result;
}
function inferRuntimeTypeForLang(val, lang) {
  if (val === null || val === void 0) {
    if (lang === "python") return "NoneType";
    if (lang === "cpp") return "nullptr_t";
    return "null";
  }
  if (Array.isArray(val)) {
    if (lang === "python") return "list";
    if (lang === "cpp") return "std::vector";
    if (lang === "java") return "ArrayList";
    return "Array";
  }
  if (typeof val === "boolean") {
    return lang === "python" || lang === "cpp" ? "bool" : "boolean";
  }
  if (typeof val === "number") {
    if (lang === "javascript") return "number";
    if (lang === "python") return Number.isInteger(val) ? "int" : "float";
    return Number.isInteger(val) ? "int" : "double";
  }
  if (typeof val === "string") {
    if (lang === "python") return "str";
    if (lang === "java") return "String";
    if (lang === "cpp") return "std::string";
    return "string";
  }
  if (typeof val === "object") {
    if (lang === "python") return "dict";
    if (lang === "cpp") return "struct";
    return "Object";
  }
  return typeof val;
}
function resolveAccurateVariableType(candidateType, val, lang, varName, declaredMap) {
  const declared = declaredMap.get(varName);
  if (declared) return declared;
  const trimmed = candidateType ? candidateType.trim() : "";
  if (trimmed) {
    if (lang !== "javascript" && trimmed.toLowerCase() === "number") {
      return inferRuntimeTypeForLang(val, lang);
    }
    return trimmed;
  }
  return inferRuntimeTypeForLang(val, lang);
}

// shared/codeAnalysis.ts
function stripCommentsAndLiterals(code, language) {
  let out = "";
  let i = 0;
  const len = code.length;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBlockComment = false;
  while (i < len) {
    const ch = code[i];
    const next = i + 1 < len ? code[i + 1] : "";
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        out += "  ";
        i += 2;
        inBlockComment = false;
      } else {
        out += ch === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "\\" && i + 1 < len) {
        out += code[i + 1] === "\n" ? "\n" : "  ";
        i += 2;
        continue;
      }
      if (ch === "'" || ch === "\n") {
        inSingle = false;
        out += ch === "\n" ? "\n" : "'";
      } else {
        out += " ";
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === "\\" && i + 1 < len) {
        out += code[i + 1] === "\n" ? "\n" : "  ";
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "\n") {
        inDouble = false;
        out += ch === "\n" ? "\n" : '"';
      } else {
        out += " ";
      }
      i++;
      continue;
    }
    if (inBacktick) {
      if (ch === "\\" && i + 1 < len) {
        out += code[i + 1] === "\n" ? "\n" : "  ";
        i += 2;
        continue;
      }
      if (ch === "`") {
        inBacktick = false;
        out += "`";
      } else {
        out += ch === "\n" ? "\n" : " ";
      }
      i++;
      continue;
    }
    if (ch === "/" && next === "*" && language !== "python") {
      inBlockComment = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "/" && language !== "python") {
      while (i < len && code[i] !== "\n") i++;
      continue;
    }
    if (ch === "#" && language === "python") {
      while (i < len && code[i] !== "\n") i++;
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
    if (ch === "`" && language === "javascript") {
      inBacktick = true;
      out += "`";
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
function classifyScopeHeader(headerLine, language) {
  const t = headerLine.trim();
  if (/^(?:\}?\s*)?(?:else\s+if|elif)\b/.test(t)) return "else_if";
  if (/^(?:\}?\s*)?else\b/.test(t)) return "else";
  if (/^if\b/.test(t)) return "if";
  if (/^for\b/.test(t)) return "for";
  if (/^(?:\}?\s*)?while\b/.test(t)) return "while";
  if (/^do\b/.test(t)) return "do";
  if (/^switch\b/.test(t)) return "switch";
  if (/^try\b/.test(t)) return "try";
  if (/^(?:\}?\s*)?(?:catch|except)\b/.test(t)) return "catch";
  if (/^(?:\}?\s*)?finally\b/.test(t)) return "finally";
  if (/\bmain\s*\(/.test(t)) return "main";
  if (/^(?:public|private|protected|final|abstract|\s)*class\b/.test(t)) return "class";
  if (language === "python" ? /^def\b/.test(t) : /\b(?:function|void|int|long|double|float|boolean|bool|String|string)\s+[A-Za-z_$][\w$]*\s*\(/.test(t) || /=>\s*\{/.test(t)) {
    return "function";
  }
  return "block";
}
function getScopeLabel(kind, explainLanguage) {
  const isBn = explainLanguage === "bn";
  switch (kind) {
    case "if":
      return "`if`";
    case "else_if":
      return "`else if` / `elif`";
    case "else":
      return "`else`";
    case "for":
      return "`for` \u09B2\u09C1\u09AA";
    case "while":
      return "`while` \u09B2\u09C1\u09AA";
    case "do":
      return "`do-while` \u09B2\u09C1\u09AA";
    case "switch":
      return "`switch`";
    case "try":
      return "`try`";
    case "catch":
      return "`catch` / `except`";
    case "finally":
      return "`finally`";
    case "class":
      return isBn ? "\u0995\u09CD\u09B2\u09BE\u09B8 (`class`)" : "`class`";
    case "main":
      return "`main` \u09AE\u09C7\u09A5\u09A1";
    case "function":
      return isBn ? "\u09AB\u09BE\u0982\u09B6\u09A8 / \u09AE\u09C7\u09A5\u09A1" : "function / method";
    default:
      return isBn ? "\u0995\u09CB\u09A1 \u09AC\u09CD\u09B2\u0995" : "code block";
  }
}
function analyzeBlockExecution(code, language, executedLines) {
  const clean = stripCommentsAndLiterals(code, language);
  const cleanLines = clean.split("\n");
  const rawLines = code.split("\n");
  const braceByCloseLine = /* @__PURE__ */ new Map();
  const pythonEndsByLine = /* @__PURE__ */ new Map();
  const skippedBlockLines = /* @__PURE__ */ new Set();
  if (language === "python") {
    const stack2 = [];
    for (let i = 0; i < cleanLines.length; i++) {
      const lineNum = i + 1;
      const trimmed = cleanLines[i].trim();
      if (!trimmed) continue;
      const indent = (rawLines[i].match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
      while (stack2.length > 0 && indent <= stack2[stack2.length - 1].indent) {
        const closed = stack2.pop();
        if (closed.lastBodyLine > 0) {
          const wasExecuted = closed.bodyLines.some((ln) => executedLines.has(ln));
          pythonEndsByLine.set(closed.lastBodyLine, {
            openLine: closed.openLine,
            endLine: closed.lastBodyLine,
            kind: closed.kind,
            wasBlockExecuted: wasExecuted
          });
          if (!wasExecuted && (closed.kind === "if" || closed.kind === "else_if" || closed.kind === "else" || closed.kind === "catch")) {
            for (const ln of closed.bodyLines) skippedBlockLines.add(ln);
          }
        }
      }
      if (stack2.length > 0) {
        const top = stack2[stack2.length - 1];
        top.lastBodyLine = lineNum;
        top.bodyLines.push(lineNum);
      }
      if (trimmed.endsWith(":")) {
        stack2.push({
          indent,
          openLine: lineNum,
          kind: classifyScopeHeader(trimmed, language),
          lastBodyLine: -1,
          bodyLines: []
        });
      }
    }
    while (stack2.length > 0) {
      const closed = stack2.pop();
      if (closed.lastBodyLine > 0) {
        const wasExecuted = closed.bodyLines.some((ln) => executedLines.has(ln));
        pythonEndsByLine.set(closed.lastBodyLine, {
          openLine: closed.openLine,
          endLine: closed.lastBodyLine,
          kind: closed.kind,
          wasBlockExecuted: wasExecuted
        });
        if (!wasExecuted && (closed.kind === "if" || closed.kind === "else_if" || closed.kind === "else" || closed.kind === "catch")) {
          for (const ln of closed.bodyLines) skippedBlockLines.add(ln);
        }
      }
    }
    return { braceByCloseLine, pythonEndsByLine, skippedBlockLines };
  }
  const stack = [];
  for (let i = 0; i < cleanLines.length; i++) {
    const lineNum = i + 1;
    const lineText = cleanLines[i];
    const trimmed = lineText.trim();
    if (!trimmed) continue;
    const isStandaloneBrace = trimmed === "{" || trimmed === "}" || trimmed === "};";
    if (!isStandaloneBrace && stack.length > 0 && !trimmed.startsWith("}") && !trimmed.includes("{")) {
      const top = stack[stack.length - 1];
      top.directBodyLines.push(lineNum);
      top.allInnerLines.push(lineNum);
    }
    for (let c = 0; c < lineText.length; c++) {
      const ch = lineText[c];
      if (ch === "{") {
        let headerSource = trimmed;
        if (trimmed === "{" && i > 0) {
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
          allInnerLines: []
        });
      } else if (ch === "}") {
        const closed = stack.pop();
        if (closed) {
          const isConditionalOrCatch = closed.kind === "if" || closed.kind === "else_if" || closed.kind === "else" || closed.kind === "catch";
          const directHit = closed.directBodyLines.some((ln) => executedLines.has(ln));
          const anyInnerHit = closed.allInnerLines.some((ln) => executedLines.has(ln));
          const wasBlockExecuted = closed.kind === "class" ? false : executedLines.has(lineNum) || (isConditionalOrCatch ? directHit : anyInnerHit);
          if (stack.length > 0) {
            const parent = stack[stack.length - 1];
            parent.allInnerLines.push(...closed.allInnerLines);
            if (wasBlockExecuted && parent.kind !== "class") {
              parent.directBodyLines.push(...closed.directBodyLines);
            }
          }
          if (!wasBlockExecuted && isConditionalOrCatch) {
            for (const ln of closed.directBodyLines) skippedBlockLines.add(ln);
          }
          if (trimmed === "}" || trimmed === "};" || trimmed.startsWith("}") && !trimmed.includes("{")) {
            braceByCloseLine.set(lineNum, {
              openLine: closed.openLine,
              closeLine: lineNum,
              kind: closed.kind,
              headerText: closed.headerText,
              wasBlockExecuted
            });
          }
        }
      }
    }
  }
  return { braceByCloseLine, pythonEndsByLine, skippedBlockLines };
}
function buildExecutionAwareLineNote(params) {
  const {
    lineNumber,
    trimmed,
    language,
    explainLanguage,
    executedLines,
    braceInfo,
    pythonEndInfo
  } = params;
  const isBn = explainLanguage === "bn";
  const lineExecuted = executedLines.has(lineNumber);
  if (trimmed.startsWith("//") || trimmed.startsWith("#") && !trimmed.startsWith("#include") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
    return isBn ? {
      text: "\u098F\u099F\u09BF \u098F\u0995\u099F\u09BF \u0995\u09CB\u09A1 \u0995\u09AE\u09C7\u09A8\u09CD\u099F (\u09AE\u09A8\u09CD\u09A4\u09AC\u09CD\u09AF), \u09AF\u09BE \u0995\u09AE\u09CD\u09AA\u09BE\u0987\u09B2\u09BE\u09B0 \u09AC\u09BE \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u0995\u09B0\u09C7 \u09A8\u09BE\u0964",
      why: "\u0995\u09CB\u09A1\u09C7\u09B0 \u0989\u09A6\u09CD\u09A6\u09C7\u09B6\u09CD\u09AF \u0993 \u09B2\u099C\u09BF\u0995 \u09AE\u09BE\u09A8\u09C1\u09B7\u09C7\u09B0 \u09AC\u09CB\u099D\u09BE\u09B0 \u09B8\u09C1\u09AC\u09BF\u09A7\u09BE\u09B0\u09CD\u09A5\u09C7 \u0995\u09AE\u09C7\u09A8\u09CD\u099F \u09B2\u09C7\u0996\u09BE \u09B9\u09DF\u0964",
      wasExecuted: false
    } : {
      text: "This is a comment ignored during runtime execution.",
      why: "Comments document developer intent for readers without affecting state.",
      wasExecuted: false
    };
  }
  if (/^import\s+/.test(trimmed) || /^from\s+\S+\s+import\b/.test(trimmed) || /^#include\s+/.test(trimmed) || /^using\s+namespace\b/.test(trimmed) || /^package\s+/.test(trimmed)) {
    return isBn ? {
      text: `\u09AC\u09BE\u09B9\u09CD\u09AF\u09BF\u0995 \u09B2\u09BE\u0987\u09AC\u09CD\u09B0\u09C7\u09B0\u09BF \u09AC\u09BE \u09A8\u09C7\u09AE\u09B8\u09CD\u09AA\u09C7\u09B8 (\`${trimmed}\`) \u0995\u09AE\u09CD\u09AA\u09BE\u0987\u09B2\u09C7\u09B6\u09A8\u09C7\u09B0 \u09B6\u09C1\u09B0\u09C1\u09A4\u09C7 \u09AF\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09BE \u09B9\u09DF\u09C7\u099B\u09C7\u0964`,
      why: "\u0987\u09A8\u09AA\u09C1\u099F-\u0986\u0989\u099F\u09AA\u09C1\u099F \u0993 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u09A8\u09CD\u09A1\u09BE\u09B0\u09CD\u09A1 \u09B2\u09BE\u0987\u09AC\u09CD\u09B0\u09C7\u09B0\u09BF \u09AB\u09BE\u0982\u09B6\u09A8 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u098F\u0997\u09C1\u09B2\u09CB \u0986\u0997\u09C7\u09AD\u09BE\u0997\u09C7\u0987 \u099A\u09BF\u09A8\u09BF\u09DF\u09C7 \u09A6\u09BF\u09A4\u09C7 \u09B9\u09DF\u0964",
      wasExecuted: true
    } : {
      text: `Links library or namespace declaration \`${trimmed}\` before execution begins.`,
      why: "Makes standard library classes, I/O helpers, or namespaces available in this file.",
      wasExecuted: true
    };
  }
  if (trimmed === "{") {
    return isBn ? {
      text: "\u09A8\u09A4\u09C1\u09A8 \u098F\u0995\u099F\u09BF \u0995\u09CB\u09A1 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09B6\u09C1\u09B0\u09C1 (`{`) \u09A8\u09BF\u09B0\u09CD\u09A6\u09C7\u09B6 \u0995\u09B0\u09C7\u0964",
      why: "\u09B8\u09C7\u0995\u09C7\u09A8\u09CD\u09A1 \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F \u0995\u09CB\u09A1\u09C7\u09B0 \u09B8\u09CD\u0995\u09CB\u09AA \u0993 \u0995\u09CB\u09A8 \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F\u0997\u09C1\u09B2\u09CB \u0995\u09CB\u09A8 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u0985\u09A7\u09C0\u09A8\u09C7 \u09B0\u09DF\u09C7\u099B\u09C7 \u09A4\u09BE \u09A8\u09BF\u09B0\u09CD\u09A7\u09BE\u09B0\u09A3 \u0995\u09B0\u09C7\u0964",
      wasExecuted: lineExecuted
    } : {
      text: "Marks the opening (`{`) of a lexical code block.",
      why: "Curly braces group statements under their enclosing control-flow or method scope.",
      wasExecuted: lineExecuted
    };
  }
  if (trimmed === "}" || trimmed === "};") {
    const scopeLabel = braceInfo ? getScopeLabel(braceInfo.kind, explainLanguage) : isBn ? "\u0995\u09CB\u09A1 \u09AC\u09CD\u09B2\u0995" : "code block";
    if (braceInfo?.kind === "class") {
      return isBn ? {
        text: `\u098F\u099F\u09BF ${scopeLabel} \u09A1\u09C7\u09AB\u09BF\u09A8\u09BF\u09B6\u09A8\u09C7\u09B0 \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4\u09BF \u09A8\u09BF\u09B0\u09CD\u09A6\u09C7\u09B6 \u0995\u09B0\u09C7 (\`${trimmed}\`)\u0964`,
        why: "\u0995\u09CD\u09B2\u09BE\u09B8\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u09B8\u09AC \u09AE\u09C7\u09A5\u09A1 \u0993 \u09AA\u09CD\u09B0\u09CB\u09AA\u09BE\u09B0\u09CD\u099F\u09BF\u09B0 \u09B8\u09C0\u09AE\u09BE \u098F\u0996\u09BE\u09A8\u09C7 \u09B6\u09C7\u09B7 \u09B9\u09DF\u0964",
        wasExecuted: false
      } : {
        text: `Marks the structural end of the ${scopeLabel} definition (\`${trimmed}\`).`,
        why: "Encloses all fields and methods defined in the class.",
        wasExecuted: false
      };
    }
    const reachedAtRuntime = Boolean(braceInfo ? braceInfo.wasBlockExecuted : lineExecuted);
    if (reachedAtRuntime) {
      return isBn ? {
        text: `${scopeLabel} \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09B8\u09AC \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09A7\u09BE\u09AA \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u09B9\u0993\u09DF\u09BE\u09DF \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u098F\u0996\u09BE\u09A8 \u09A5\u09C7\u0995\u09C7 \u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u09B8\u09CD\u09A4\u09B0\u09C7 \u09AB\u09BF\u09B0\u09C7 \u0986\u09B8\u099B\u09C7\u0964`,
        why: "\u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09B8\u0995\u09CD\u09B0\u09BF\u09DF\u09AD\u09BE\u09AC\u09C7 \u09B0\u09BE\u09A8 \u09B6\u09C7\u09B7 \u0995\u09B0\u09BE\u09DF \u09B8\u09CD\u0995\u09CB\u09AA\u09C7\u09B0 \u0995\u09BE\u099C \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4 \u09B9\u09DF\u09C7 \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F\u09C7 \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u09B8\u09CD\u09A5\u09BE\u09A8\u09BE\u09A8\u09CD\u09A4\u09B0\u09BF\u09A4 \u09B9\u09DF\u0964",
        wasExecuted: true
      } : {
        text: `All active statements inside the ${scopeLabel} block finished, returning control to the outer scope.`,
        why: "Closing the executed block ends its scope and resumes outer control flow.",
        wasExecuted: true
      };
    }
    return isBn ? {
      text: `\u098F\u099F\u09BF ${scopeLabel} \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4\u09BF \u09A8\u09BF\u09B0\u09CD\u09A6\u09C7\u09B6 \u0995\u09B0\u09C7 (\`${trimmed}\`)\u2014\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0987\u09A8\u09AA\u09C1\u099F\u09C7\u09B0 \u09AA\u09A5\u09C7 \u098F\u0987 \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09B8\u09CD\u0995\u09BF\u09AA \u09B9\u0993\u09DF\u09BE\u09DF \u0995\u09A8\u09CD\u099F\u09CD\u09B0\u09CB\u09B2 \u098F\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u09AA\u09CD\u09B0\u09AC\u09C7\u09B6 \u0995\u09B0\u09C7\u09A8\u09BF\u0964`,
      why: "\u0997\u09A0\u09A8\u0997\u09A4\u09AD\u09BE\u09AC\u09C7 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09B8\u09C0\u09AE\u09BE\u09A8\u09BE \u09B6\u09C7\u09B7 \u0995\u09B0\u09B2\u09C7\u0993 \u09B6\u09B0\u09CD\u09A4 \u0985\u09A8\u09C1\u09AF\u09BE\u09DF\u09C0 \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09B8\u0995\u09CD\u09B0\u09BF\u09DF \u09A8\u09BE \u09B9\u0993\u09DF\u09BE\u09DF \u098F\u0996\u09BE\u09A8\u09C7 \u0995\u09CB\u09A8\u09CB \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u09AB\u09CD\u09B2\u09CB \u09AA\u09CC\u0981\u099B\u09C7\u09A8\u09BF\u0964",
      wasExecuted: false
    } : {
      text: `Marks the structural end of the ${scopeLabel} block (\`${trimmed}\`); skipped during this run because control never entered it.`,
      why: "Defines the block boundary statically, though no runtime control flow passed through it on this input.",
      wasExecuted: false
    };
  }
  if (/^(?:public|private|protected|final|abstract|\s)*class\s+/.test(trimmed)) {
    return isBn ? {
      text: `\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09C7\u09B0 \u09AE\u09C2\u09B2 \u0995\u09CD\u09B2\u09BE\u09B8 \u0995\u09BE\u09A0\u09BE\u09AE\u09CB (\`${trimmed.replace(/\{$/, "").trim()}\`) \u09B8\u0982\u099C\u09CD\u099E\u09BE\u09AF\u09BC\u09BF\u09A4 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964`,
      why: "Java/C++-\u098F \u09AE\u09C7\u09A5\u09A1 \u0993 \u09B2\u099C\u09BF\u0995\u0997\u09C1\u09B2\u09CB \u098F\u0995\u099F\u09BF \u0995\u09CD\u09B2\u09BE\u09B8\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u09B8\u0982\u0997\u09A0\u09BF\u09A4 \u09A5\u09BE\u0995\u09C7\u0964",
      wasExecuted: true
    } : {
      text: `Defines the class container (\`${trimmed.replace(/\{$/, "").trim()}\`).`,
      why: "Classes encapsulate the program entry point, methods, and state.",
      wasExecuted: true
    };
  }
  if (/\bmain\s*\(/.test(trimmed)) {
    return isBn ? {
      text: "\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09C7\u09B0 \u09AE\u09C2\u09B2 \u098F\u09A8\u09CD\u099F\u09CD\u09B0\u09BF \u09AA\u09DF\u09C7\u09A8\u09CD\u099F (`main`) \u09AE\u09C7\u09A5\u09A1 \u098F\u0996\u09BE\u09A8 \u09A5\u09C7\u0995\u09C7 \u09B6\u09C1\u09B0\u09C1 \u09B9\u09DF\u09C7\u099B\u09C7\u0964",
      why: "\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u099A\u09BE\u09B2\u09C1 \u09B9\u09B2\u09C7 \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u09B8\u09AC\u09BE\u09B0 \u09AA\u09CD\u09B0\u09A5\u09AE\u09C7 `main` \u09A5\u09C7\u0995\u09C7\u0987 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u09B6\u09A8 \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09C7\u0964",
      wasExecuted: true
    } : {
      text: "Program execution starts from this `main` entry point.",
      why: "The runtime always invokes `main` first when launching the program.",
      wasExecuted: true
    };
  }
  if (!lineExecuted) {
    const pySuffixBn = language === "python" && pythonEndInfo ? ` (\u098F\u0995\u0987 \u09B8\u09BE\u09A5\u09C7 \u098F\u099F\u09BF \u0993\u0987 \`${pythonEndInfo.kind}\` \u0987\u09A8\u09CD\u09A1\u09C7\u09A8\u09CD\u099F\u09C7\u09B6\u09A8 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09B6\u09C7\u09B7 \u09B2\u09BE\u0987\u09A8)` : "";
    const pySuffixEn = language === "python" && pythonEndInfo ? ` (also marks the structural end of this Python \`${pythonEndInfo.kind}\` block)` : "";
    if (/^(?:\}?\s*)?(?:else\s+if|elif)\b/.test(trimmed)) {
      const condLabel = trimmed.replace(/^[\}\s]*(?:else\s+if|elif)\s*/, "").replace(/[{}:]/g, "").trim();
      return isBn ? {
        text: `\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0987\u09A8\u09AA\u09C1\u099F\u09C7\u09B0 \u09AA\u09A5\u09C7 \u098F\u0987 \u09AC\u09BF\u0995\u09B2\u09CD\u09AA \u09B6\u09B0\u09CD\u09A4 (\`${condLabel}\`) \u09B8\u0995\u09CD\u09B0\u09BF\u09DF\u09AD\u09BE\u09AC\u09C7 \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE \u0995\u09B0\u09BE\u09B0 \u09AA\u09CD\u09B0\u09DF\u09CB\u099C\u09A8 \u09B9\u09DF\u09A8\u09BF\u2014\u0986\u0997\u09C7\u09B0 \u098F\u0995\u099F\u09BF \u09B6\u09B0\u09CD\u09A4 \u0987\u09A4\u09CB\u09AE\u09A7\u09CD\u09AF\u09C7 \u09B8\u09A4\u09CD\u09AF \u09B9\u0993\u09DF\u09BE\u09DF \u098F\u099F\u09BF \u09B8\u09CD\u0995\u09BF\u09AA \u09B9\u09DF\u09C7\u099B\u09C7\u0964`,
        why: "`if / else if` \u099A\u09C7\u0987\u09A8\u09C7 \u09AA\u09CD\u09B0\u09A5\u09AE \u09B8\u09A4\u09CD\u09AF \u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u09AE\u09BF\u09B2\u09B2\u09C7\u0987 \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09AC\u09BF\u0995\u09B2\u09CD\u09AA \u09B6\u09B0\u09CD\u09A4\u0997\u09C1\u09B2\u09CB \u09AC\u09BE\u09A6 \u09AA\u09DC\u09C7 \u09AF\u09BE\u09DF\u0964",
        wasExecuted: false
      } : {
        text: `Skipped in the current execution path: \`${condLabel}\` was bypassed because an earlier branch already matched.`,
        why: "In an `if / else if` chain, evaluation stops at the first matching condition.",
        wasExecuted: false
      };
    }
    if (/^(?:\}?\s*)?else\b/.test(trimmed)) {
      return isBn ? {
        text: "\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0987\u09A8\u09AA\u09C1\u099F\u09C7\u09B0 \u09AA\u09A5\u09C7 \u098F\u0987 `else` \u09B6\u09BE\u0996\u09BE\u099F\u09BF \u09B8\u0995\u09CD\u09B0\u09BF\u09DF\u09AD\u09BE\u09AC\u09C7 \u099A\u09B2\u09C7\u09A8\u09BF\u2014\u09AA\u09C2\u09B0\u09CD\u09AC\u09AC\u09B0\u09CD\u09A4\u09C0 \u098F\u0995\u099F\u09BF `if` \u09AC\u09BE `else if` \u09B6\u09B0\u09CD\u09A4 \u09B8\u09A4\u09CD\u09AF \u09B9\u0993\u09DF\u09BE\u09DF \u098F\u099F\u09BF \u09B8\u09CD\u0995\u09BF\u09AA \u09B9\u09DF\u09C7\u099B\u09C7\u0964",
        why: "\u0997\u09A0\u09A8\u0997\u09A4\u09AD\u09BE\u09AC\u09C7 \u098F\u099F\u09BF \u09AB\u09B2\u09AC\u09CD\u09AF\u09BE\u0995 \u09B6\u09BE\u0996\u09BE \u09B9\u09BF\u09B8\u09C7\u09AC\u09C7 \u09B0\u09DF\u09C7\u099B\u09C7, \u09AF\u09BE \u0995\u09C7\u09AC\u09B2 \u0989\u09AA\u09B0\u09C7\u09B0 \u09B8\u09AC \u09B6\u09B0\u09CD\u09A4 \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE \u09B9\u09B2\u09C7\u0987 \u099A\u09BE\u09B2\u09C1 \u09B9\u09A4\u09CB\u0964",
        wasExecuted: false
      } : {
        text: "Skipped in the current execution path: this `else` fallback branch was not taken because an earlier condition evaluated to `true`.",
        why: "Structurally acts as the catch-all branch when every preceding condition fails.",
        wasExecuted: false
      };
    }
    if (/^(?:\}?\s*)?(?:catch|except)\b/.test(trimmed)) {
      return isBn ? {
        text: "\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0987\u09A8\u09AA\u09C1\u099F\u09C7\u09B0 \u09AA\u09A5\u09C7 \u098F\u0987 \u098F\u0995\u09CD\u09B8\u09C7\u09AA\u09B6\u09A8 \u09B9\u09CD\u09AF\u09BE\u09A8\u09CD\u09A1\u09B2\u09BE\u09B0 (`catch`/`except`) \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u099A\u09B2\u09C7\u09A8\u09BF\u2014\u0995\u09BE\u09B0\u09A3 `try` \u09AC\u09CD\u09B2\u0995\u09C7 \u0995\u09CB\u09A8\u09CB \u09A4\u09CD\u09B0\u09C1\u099F\u09BF \u0998\u099F\u09C7\u09A8\u09BF\u0964",
        why: "\u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE\u09C7 \u0995\u09CB\u09A8\u09CB \u098F\u0995\u09CD\u09B8\u09C7\u09AA\u09B6\u09A8 \u099B\u09CB\u09DC\u09BE \u09B9\u09B2\u09C7\u0987 \u0995\u09C7\u09AC\u09B2 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u0995\u09C7 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6 \u09B0\u09BE\u0996\u09A4\u09C7 \u098F\u0987 \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09B8\u0995\u09CD\u09B0\u09BF\u09DF \u09B9\u09DF\u0964",
        wasExecuted: false
      } : {
        text: "Skipped in the current execution path: this exception handler was not triggered because no matching runtime error occurred.",
        why: "Structurally guards against runtime exceptions thrown inside the `try` block.",
        wasExecuted: false
      };
    }
    if (/^(?:case\b|default\s*:)/.test(trimmed)) {
      return isBn ? {
        text: `\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0987\u09A8\u09AA\u09C1\u099F\u09C7\u09B0 \u09AA\u09A5\u09C7 \`${trimmed.replace(/:$/, "").trim()}\` \u09B6\u09BE\u0996\u09BE\u099F\u09BF \u09AE\u09CD\u09AF\u09BE\u099A \u09A8\u09BE \u09B9\u0993\u09DF\u09BE\u09DF \u098F\u099F\u09BF \u09B8\u09CD\u0995\u09BF\u09AA \u09B9\u09DF\u09C7\u099B\u09C7\u0964`,
        why: "`switch` \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F \u0995\u09C7\u09AC\u09B2 \u09AE\u09CD\u09AF\u09BE\u099A\u09BF\u0982 \u09AE\u09BE\u09A8\u09C7\u09B0 \u09B6\u09BE\u0996\u09BE\u099F\u09BF\u0987 \u09B0\u09BE\u09A8 \u0995\u09B0\u09C7\u0964",
        wasExecuted: false
      } : {
        text: `Skipped in the current execution path because \`${trimmed.replace(/:$/, "").trim()}\` did not match the switch value.`,
        why: "`switch` executes only the matching case branch.",
        wasExecuted: false
      };
    }
    if (/^if\b/.test(trimmed)) {
      return isBn ? {
        text: `\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0987\u09A8\u09AA\u09C1\u099F\u09C7\u09B0 \u09AA\u09A5\u09C7 \u098F\u0987 \`if\` \u09B6\u09B0\u09CD\u09A4\u099F\u09BF (\`${trimmed}\`) \u09B8\u0995\u09CD\u09B0\u09BF\u09DF\u09AD\u09BE\u09AC\u09C7 \u099A\u09B2\u09C7\u09A8\u09BF\u2014\u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u098F\u0995\u099F\u09BF \u09B6\u09B0\u09CD\u09A4 \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE \u09B9\u0993\u09DF\u09BE\u09DF \u09AC\u09BE \u0986\u0997\u09C7 \u09B0\u09BF\u099F\u09BE\u09B0\u09CD\u09A8 \u09B9\u0993\u09DF\u09BE\u09DF \u098F\u099F\u09BF \u09B8\u09CD\u0995\u09BF\u09AA \u09B9\u09DF\u09C7\u099B\u09C7\u0964`,
        why: "\u09A8\u09C7\u09B8\u09CD\u099F\u09C7\u09A1 \u09B6\u09B0\u09CD\u09A4 \u0995\u09C7\u09AC\u09B2 \u09A4\u09BE\u09B0 \u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u09AC\u09CD\u09B2\u0995\u09C7 \u09AA\u09CD\u09B0\u09AC\u09C7\u09B6 \u0995\u09B0\u09B2\u09C7\u0987 \u09AF\u09BE\u099A\u09BE\u0987 \u09B9\u09DF\u0964",
        wasExecuted: false
      } : {
        text: `Skipped in the current execution path: this \`if\` check was never reached.`,
        why: "Control flow bypassed its enclosing scope on this input.",
        wasExecuted: false
      };
    }
    if (/\.close\s*\(\s*\)/.test(trimmed)) {
      return isBn ? {
        text: `\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0987\u09A8\u09AA\u09C1\u099F\u09C7\u09B0 \u09AA\u09A5\u09C7 \u09B0\u09BF\u09B8\u09CB\u09B0\u09CD\u09B8 \u0995\u09CD\u09B2\u09CB\u099C \u09B2\u09BE\u0987\u09A8 (\`${trimmed}\`) \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u09B6\u09A8 \u09AA\u09CC\u0981\u099B\u09C7\u09A8\u09BF\u0964`,
        why: "\u0986\u0997\u09C7\u0987 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u09B6\u09C7\u09B7 \u09B9\u09DF\u09C7 \u09AF\u09BE\u0993\u09DF\u09BE \u09AC\u09BE \u098F\u0995\u09CD\u09B8\u09C7\u09AA\u09B6\u09A8 \u0998\u099F\u09BE\u09B0 \u0995\u09BE\u09B0\u09A3\u09C7 \u098F\u0987 \u0995\u09CD\u09B2\u09BF\u09A8\u0986\u09AA \u09B2\u09BE\u0987\u09A8\u099F\u09BF \u09B8\u09CD\u0995\u09BF\u09AA \u09B9\u09DF\u09C7\u099B\u09C7\u0964",
        wasExecuted: false
      } : {
        text: `Skipped in the current execution path: execution did not reach resource cleanup (\`${trimmed}\`).`,
        why: "An earlier exit or exception bypassed this cleanup statement.",
        wasExecuted: false
      };
    }
    return isBn ? {
      text: `\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0987\u09A8\u09AA\u09C1\u099F\u09C7\u09B0 \u09AA\u09A5\u09C7 \u098F\u0987 \u0985\u0982\u09B6\u099F\u09BF (\`${trimmed}\`) \u09B8\u0995\u09CD\u09B0\u09BF\u09DF\u09AD\u09BE\u09AC\u09C7 \u099A\u09B2\u09C7\u09A8\u09BF${pySuffixBn}; \u098F\u099F\u09BF \u098F\u0995\u099F\u09BF \u0985\u09AA\u09CD\u09B0\u09AC\u09C7\u09B6\u0995\u09C3\u09A4 \u09B6\u09BE\u0996\u09BE \u09AC\u09BE \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u0985\u09AC\u09B8\u09CD\u09A5\u09BF\u09A4\u0964`,
      why: "\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u0995\u09C7\u09AC\u09B2 \u09B8\u0995\u09CD\u09B0\u09BF\u09DF\u09AD\u09BE\u09AC\u09C7 \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09BF\u09A4 \u09AA\u09A5\u09C7\u09B0 \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F\u0997\u09C1\u09B2\u09CB\u0987 \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u0995\u09B0\u09C7 \u098F\u09AC\u0982 \u09AC\u09BE\u0995\u09BF \u09B6\u09BE\u0996\u09BE\u0997\u09C1\u09B2\u09CB \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u09C7 \u098F\u09DC\u09BF\u09DF\u09C7 \u099A\u09B2\u09C7\u0964",
      wasExecuted: false
    } : {
      text: `Skipped in the current execution path: \`${trimmed}\` sits inside an unentered branch${pySuffixEn}.`,
      why: "Control flow executes only statements along active branches for the given input.",
      wasExecuted: false
    };
  }
  if (language === "python" && pythonEndInfo?.wasBlockExecuted) {
    const scopeLabel = getScopeLabel(pythonEndInfo.kind, explainLanguage);
    return isBn ? {
      text: `\u09B2\u09BE\u0987\u09A8 ${lineNumber} (\`${trimmed}\`) \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u099A\u09B2\u09C7\u099B\u09C7 \u098F\u09AC\u0982 \u098F\u0996\u09BE\u09A8\u09C7 ${scopeLabel} \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u0987\u09A8\u09CD\u09A1\u09C7\u09A8\u09CD\u099F\u09C7\u09B6\u09A8 \u09B6\u09C7\u09B7 \u09B9\u09DF\u09C7 \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u09B8\u09CD\u09A4\u09B0\u09C7 \u09AB\u09BF\u09B0\u099B\u09C7\u0964`,
      why: "Python-\u098F \u0987\u09A8\u09CD\u09A1\u09C7\u09A8\u09CD\u099F\u09C7\u09B6\u09A8 \u0995\u09AE\u09C7 \u0997\u09C7\u09B2\u09C7 \u099A\u09B2\u09AE\u09BE\u09A8 \u09AC\u09CD\u09B2\u0995 \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4 \u09B9\u09DF\u09C7 \u09AA\u09B0\u09C7\u09B0 \u09A7\u09BE\u09AA\u09C7 \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u099A\u09B2\u09C7 \u09AF\u09BE\u09DF\u0964",
      wasExecuted: true
    } : {
      text: `Line ${lineNumber} (\`${trimmed}\`) executed as the final line of this ${scopeLabel} indentation block, returning control outward.`,
      why: "Dedenting in Python marks the end of the enclosing block scope.",
      wasExecuted: true
    };
  }
  return isBn ? {
    text: `\u09B2\u09BE\u0987\u09A8 ${lineNumber}-\u098F\u09B0 \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F\u099F\u09BF \u09B8\u0995\u09CD\u09B0\u09BF\u09DF\u09AD\u09BE\u09AC\u09C7 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u09B9\u09DF\u09C7 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09C7\u09B0 \u09B8\u09CD\u099F\u09C7\u099F \u098F\u0997\u09BF\u09DF\u09C7 \u09A8\u09BF\u09DF\u09C7\u099B\u09C7\u0964`,
    why: "\u09A7\u09BE\u09AA\u09C7 \u09A7\u09BE\u09AA\u09C7 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u09B6\u09A8\u09C7\u09B0 \u09AE\u09BE\u09A7\u09CD\u09AF\u09AE\u09C7 \u098F\u099F\u09BF \u09AB\u09B2\u09BE\u09AB\u09B2 \u09A8\u09BF\u09B0\u09CD\u09A7\u09BE\u09B0\u09A3\u09C7 \u09AD\u09C2\u09AE\u09BF\u0995\u09BE \u09B0\u09C7\u0996\u09C7\u099B\u09C7\u0964",
    wasExecuted: true
  } : {
    text: `Statement on line ${lineNumber} executed actively along the runtime path.`,
    why: "Contributes directly to the computed runtime state.",
    wasExecuted: true
  };
}
function analyzeCodeComplexity(code, language, steps = []) {
  const clean = stripCommentsAndLiterals(code, language);
  const lines = clean.split("\n");
  const rawLines = code.split("\n");
  let maxLoopDepth = 0;
  let hasAnyLoop = false;
  let hasLogLoop = false;
  let hasSortCall = /\b(?:Collections\.sort|Arrays\.sort|std::sort|sorted\s*\(|\.sort\s*\()/.test(clean);
  if (language === "python") {
    const loopIndents = [];
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      const indent = (rawLines[i].match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
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
    const scopeIsLoop = [];
    let currentLoopDepth = 0;
    let pendingLoopHeader = false;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      const isLoopHdr = /^(?:for|while)\s*\(|^do\b/.test(t);
      if (isLoopHdr) {
        hasAnyLoop = true;
        if (/\*=\s*2\b|\/=\s*2\b|>>=\s*1\b|<<=\s*1\b|\bmid\s*=\s*/.test(t) || /(?:low|left|start)\s*<=\s*(?:high|right|end)/.test(t)) {
          hasLogLoop = true;
        }
      }
      if (/\b\w+\s*(?:\*=|\/=|>>=|<<=)\s*2\b|\bmid\s*=\s*\(?\s*(?:low|left|l|start)\s*\+/.test(t)) {
        hasLogLoop = true;
      }
      if (t.includes("{")) {
        for (const ch of t) {
          if (ch === "{") {
            const countsAsLoop = isLoopHdr || pendingLoopHeader;
            pendingLoopHeader = false;
            scopeIsLoop.push(countsAsLoop);
            if (countsAsLoop) {
              currentLoopDepth++;
              if (currentLoopDepth > maxLoopDepth) maxLoopDepth = currentLoopDepth;
            }
          } else if (ch === "}") {
            const popped = scopeIsLoop.pop();
            if (popped) currentLoopDepth = Math.max(0, currentLoopDepth - 1);
          }
        }
      } else if (t.includes("}")) {
        for (const ch of t) {
          if (ch === "}") {
            const popped = scopeIsLoop.pop();
            if (popped) currentLoopDepth = Math.max(0, currentLoopDepth - 1);
          }
        }
      } else if (isLoopHdr && !t.endsWith(";")) {
        pendingLoopHeader = true;
        if (currentLoopDepth + 1 > maxLoopDepth) maxLoopDepth = currentLoopDepth + 1;
      } else if (pendingLoopHeader && t.endsWith(";")) {
        pendingLoopHeader = false;
      }
    }
  }
  if (!hasAnyLoop && /\.(?:forEach|map|reduce|filter|stream\s*\()/.test(clean)) {
    hasAnyLoop = true;
    maxLoopDepth = Math.max(maxLoopDepth, 1);
  }
  if (!hasAnyLoop && steps.some((s) => s.actionType === "LOOP_CHECK" || s.actionType === "LOOP")) {
    hasAnyLoop = true;
    maxLoopDepth = Math.max(maxLoopDepth, 1);
  }
  let recursionKind = "none";
  const fnDefs = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const m = language === "python" ? t.match(/^def\s+([A-Za-z_]\w*)\s*\(/) : t.match(
      /^(?:(?:public|private|protected|static|final|inline)\s+)*(?:function|void|int|long|double|float|boolean|bool|String|string|auto)\s+([A-Za-z_]\w*)\s*\(/
    );
    if (m && m[1] !== "main") {
      fnDefs.push({ name: m[1], startLine: i });
    }
  }
  for (let f = 0; f < fnDefs.length; f++) {
    const fn = fnDefs[f];
    const endIdx = f + 1 < fnDefs.length ? fnDefs[f + 1].startLine : lines.length;
    const bodyText = lines.slice(fn.startLine + 1, endIdx).join("\n");
    const selfCalls = bodyText.match(new RegExp(`\\b${fn.name}\\s*\\(`, "g")) || [];
    if (selfCalls.length >= 2) {
      recursionKind = /\bmid\b|\/\s*2|\/\/\s*2/.test(bodyText) ? "log" : "branching";
    } else if (selfCalls.length === 1) {
      recursionKind = /\bmid\b|\/\s*2|\/\/\s*2/.test(bodyText) ? "log" : "linear";
    }
  }
  const has2DAlloc = /\[\s*[^\]]+\s*\]\s*\[\s*[^\]]+\s*\]|vector\s*<\s*vector\s*</.test(clean);
  const hasAuxCollection = /\bnew\s+(?:ArrayList|LinkedList|HashMap|TreeMap|HashSet|TreeSet|Stack|Queue|ArrayDeque)\b/.test(clean) || /\bnew\s+(?:int|long|double|float|boolean|char|String|Array)\s*\[/.test(clean) || /\b(?:vector|unordered_map|map|unordered_set|set|stack|queue|deque)\s*</.test(clean) || /\[\s*[^\]]+\s*for\s+\w+\s+in\b/.test(clean) || /=\s*(?:\[\s*\]|\{\s*\}|set\s*\(|dict\s*\()/.test(clean) || hasAnyLoop && /\.(?:push|push_back|add|append|put|insert)\s*\(/.test(clean);
  const hasScalarArrayRuntime = steps.some(
    (s) => Object.values(s.variables || {}).some((v) => Array.isArray(v) && v.length > 0)
  );
  let time = "O(1)";
  if (recursionKind === "branching") {
    time = "O(2^n)";
  } else if (recursionKind === "log" && hasSortCall) {
    time = "O(n log n)";
  } else if (hasSortCall || maxLoopDepth === 1 && hasLogLoop && /\bfor\b.*\bfor\b/.test(clean)) {
    time = maxLoopDepth >= 2 ? "O(n^2)" : "O(n log n)";
  } else if (maxLoopDepth >= 3) {
    time = "O(n^3)";
  } else if (maxLoopDepth === 2) {
    time = "O(n^2)";
  } else if (recursionKind === "log" || maxLoopDepth === 1 && hasLogLoop) {
    time = "O(log n)";
  } else if (maxLoopDepth === 1 || hasAnyLoop || recursionKind === "linear") {
    time = "O(n)";
  }
  let space = "O(1)";
  if (has2DAlloc) {
    space = "O(n^2)";
  } else if (hasAuxCollection || recursionKind === "linear" || recursionKind === "branching" || hasScalarArrayRuntime) {
    space = "O(n)";
  } else if (recursionKind === "log") {
    space = "O(log n)";
  }
  const noteBn = time === "O(1)" && space === "O(1)" ? "\u0995\u09CB\u09A8\u09CB \u09B2\u09C1\u09AA \u09AC\u09BE \u09A1\u09BE\u09AF\u09BC\u09A8\u09BE\u09AE\u09BF\u0995 \u09B0\u09BF\u0995\u09BE\u09B0\u09CD\u09B6\u09A8 \u09A8\u09BE \u09A5\u09BE\u0995\u09BE\u09DF \u09A7\u09CD\u09B0\u09C1\u09AC \u09B8\u09AE\u09DF O(1) \u0993 \u09B8\u09CD\u09A5\u09BF\u09B0 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF O(1) \u09AC\u09CD\u09AF\u09AC\u09B9\u09C3\u09A4 \u09B9\u09DF\u09C7\u099B\u09C7\u0964" : time === "O(n^2)" ? `\u09A8\u09C7\u09B8\u09CD\u099F\u09C7\u09A1 \u09B2\u09C1\u09AA\u09C7\u09B0 \u0995\u09BE\u09B0\u09A3\u09C7 \u09B8\u09AE\u09DF \u099C\u099F\u09BF\u09B2\u09A4\u09BE ${time} \u098F\u09AC\u0982 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 ${space}\u0964` : time === "O(log n)" ? `\u09AA\u09CD\u09B0\u09A4\u09BF \u09A7\u09BE\u09AA\u09C7 \u09B8\u09BE\u09B0\u09CD\u099A \u09B8\u09CD\u09AA\u09C7\u09B8 \u0985\u09B0\u09CD\u09A7\u09C7\u0995 \u09B9\u09DF\u09C7 \u09AF\u09BE\u0993\u09DF\u09BE\u09DF \u09B8\u09AE\u09DF \u099C\u099F\u09BF\u09B2\u09A4\u09BE ${time} \u0993 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF ${space}\u0964` : time === "O(n log n)" ? `\u09B8\u09B0\u09CD\u099F\u09BF\u0982 \u09AC\u09BE \u09A1\u09BF\u09AD\u09BE\u0987\u09A1-\u0985\u09CD\u09AF\u09BE\u09A8\u09CD\u09A1-\u0995\u09A8\u0995\u09BE\u09B0 \u09B2\u099C\u09BF\u0995\u09C7\u09B0 \u0995\u09BE\u09B0\u09A3\u09C7 \u09B8\u09AE\u09DF \u099C\u099F\u09BF\u09B2\u09A4\u09BE ${time} \u0993 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF ${space}\u0964` : time === "O(2^n)" ? `\u098F\u0995\u09BE\u09A7\u09BF\u0995 \u09AC\u09CD\u09B0\u09BE\u099E\u09CD\u099A\u09BF\u0982 \u09B0\u09BF\u0995\u09BE\u09B0\u09CD\u09B8\u09BF\u09AD \u0995\u09B2\u09C7\u09B0 \u0995\u09BE\u09B0\u09A3\u09C7 \u09B8\u09AE\u09DF \u099C\u099F\u09BF\u09B2\u09A4\u09BE ${time} \u098F\u09AC\u0982 \u0995\u09B2 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF ${space}\u0964` : `\u098F\u0995\u0995 \u09B2\u09C1\u09AA \u09AC\u09BE \u09B2\u09BF\u09A8\u09BF\u09AF\u09BC\u09BE\u09B0 \u09AA\u09CD\u09B0\u09AC\u09BE\u09B9\u09C7\u09B0 \u0995\u09BE\u09B0\u09A3\u09C7 \u09B8\u09AE\u09DF \u099C\u099F\u09BF\u09B2\u09A4\u09BE ${time} \u098F\u09AC\u0982 \u0985\u09A4\u09BF\u09B0\u09BF\u0995\u09CD\u09A4 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF ${space}\u0964`;
  const noteEn = time === "O(1)" && space === "O(1)" ? "No loops or recursion are present, yielding constant O(1) time and O(1) auxiliary space." : `Analyzed control flow and allocations give ${time} time complexity and ${space} auxiliary space.`;
  return { time, space, noteBn, noteEn };
}
function generateLanguagePitfalls(code, language, explainLanguage) {
  const clean = stripCommentsAndLiterals(code, language);
  const isBn = explainLanguage === "bn";
  const tips = [];
  const pushTip = (bn, en) => {
    const val = isBn ? bn : en;
    if (!tips.includes(val) && tips.length < 4) tips.push(val);
  };
  if (language === "java") {
    if (/\bScanner\b/.test(clean)) {
      if (/\.(?:nextInt|nextDouble|nextFloat|nextLong)\s*\(/.test(clean) && /\.nextLine\s*\(/.test(clean)) {
        pushTip(
          "Java-\u09A4\u09C7 `nextInt()` \u09AC\u09BE `nextDouble()`-\u098F\u09B0 \u09AA\u09B0\u09C7 \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF `nextLine()` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09B2\u09C7 \u09AC\u09BE\u09AB\u09BE\u09B0\u09C7 \u09A5\u09BE\u0995\u09BE \u09A8\u09BF\u0989\u09B2\u09BE\u0987\u09A8 (`\\n`) \u09AA\u09DC\u09C7 \u09AF\u09C7\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u2014\u09A4\u09BE\u0987 \u09AE\u09BE\u099D\u09C7 \u098F\u0995\u099F\u09BF \u09AC\u09BE\u09DC\u09A4\u09BF `scanner.nextLine()` \u0995\u09B2 \u0995\u09B0\u09BE \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u0964",
          "In Java, calling `nextLine()` right after `nextInt()`/`nextDouble()` reads the leftover newline; add an extra `scanner.nextLine()` to flush the buffer."
        );
      } else {
        pushTip(
          "Java `Scanner` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE\u09B0 \u09B8\u09AE\u09DF \u09AD\u09C1\u09B2 \u099F\u09BE\u0987\u09AA\u09C7\u09B0 \u0987\u09A8\u09AA\u09C1\u099F \u09A6\u09BF\u09B2\u09C7 `InputMismatchException` \u098F\u09AC\u0982 \u09AA\u09B0\u09CD\u09AF\u09BE\u09AA\u09CD\u09A4 STDIN \u09A8\u09BE \u09A5\u09BE\u0995\u09B2\u09C7 `NoSuchElementException` \u09B9\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7; \u0995\u09BE\u099C \u09B6\u09C7\u09B7\u09C7 `scanner.close()` \u0995\u09B0\u09BE \u09AD\u09BE\u09B2\u09CB \u0985\u09AD\u09CD\u09AF\u09BE\u09B8\u0964",
          "Reading mismatched or missing STDIN tokens with Java `Scanner` throws `InputMismatchException` or `NoSuchElementException`; always close resources cleanly."
        );
      }
    }
    if (/\bint\b/.test(clean) && /\/(?!=)/.test(clean)) {
      pushTip(
        "Java-\u09A4\u09C7 \u09A6\u09C1\u099F\u09BF \u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 (`int / int`) \u09AD\u09BE\u0997 \u0995\u09B0\u09B2\u09C7 \u09A6\u09B6\u09AE\u09BF\u0995 \u0985\u0982\u09B6 \u09B8\u09CD\u09AC\u09DF\u0982\u0995\u09CD\u09B0\u09BF\u09DF\u09AD\u09BE\u09AC\u09C7 \u09AC\u09BE\u09A6 \u09AA\u09DC\u09C7 \u09AF\u09BE\u09DF (\u09AF\u09C7\u09AE\u09A8 `5 / 2 = 2`); \u09A6\u09B6\u09AE\u09BF\u0995 \u09AB\u09B2\u09BE\u09AB\u09B2 \u099A\u09BE\u0987\u09B2\u09C7 `(double)` \u0995\u09BE\u09B8\u09CD\u099F \u0995\u09B0\u09C1\u09A8\u0964",
        "Integer division (`int / int`) in Java truncates decimals (e.g., `5 / 2 == 2`); cast an operand with `(double)` when fractional precision is required."
      );
    }
    if (/\bString\b/.test(clean) && /==/.test(clean)) {
      pushTip(
        "Java-\u09A4\u09C7 \u09A6\u09C1\u099F\u09BF `String`-\u098F\u09B0 \u09B2\u09C7\u0996\u09BE \u09A4\u09C1\u09B2\u09A8\u09BE \u0995\u09B0\u09A4\u09C7 `==` \u098F\u09B0 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09C7 `.equals()` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8, \u0995\u09BE\u09B0\u09A3 `==` \u09B0\u09C7\u09AB\u09BE\u09B0\u09C7\u09A8\u09CD\u09B8 (\u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09B0 \u09A0\u09BF\u0995\u09BE\u09A8\u09BE) \u09A4\u09C1\u09B2\u09A8\u09BE \u0995\u09B0\u09C7\u0964",
        "Use `.equals()` instead of `==` to compare Java `String` contents, because `==` compares object references."
      );
    }
    if (/\[[^\]]+\]|\b(?:ArrayList|charAt|get)\b/.test(clean)) {
      pushTip(
        "\u0985\u09CD\u09AF\u09BE\u09B0\u09C7 \u09AC\u09BE `ArrayList`-\u098F \u0987\u09A8\u09A1\u09C7\u0995\u09CD\u09B8 \u09B8\u09AC\u09B8\u09AE\u09DF `0` \u09A5\u09C7\u0995\u09C7 `length - 1` (\u09AC\u09BE `size() - 1`) \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u09B9\u09DF; \u09B8\u09C0\u09AE\u09BE\u09B0 \u09AC\u09BE\u0987\u09B0\u09C7 \u098F\u0995\u09CD\u09B8\u09C7\u09B8 \u0995\u09B0\u09B2\u09C7 `IndexOutOfBoundsException` \u0998\u099F\u09AC\u09C7\u0964",
        "Array and `ArrayList` indices run from `0` to `length - 1`; accessing outside that range throws `IndexOutOfBoundsException`."
      );
    }
    if (/\bswitch\b/.test(clean)) {
      pushTip(
        "Java `switch` \u09AC\u09CD\u09B2\u0995\u09C7 \u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF `case`-\u098F\u09B0 \u09B6\u09C7\u09B7\u09C7 `break;` \u09A6\u09BF\u09A4\u09C7 \u09A8\u09BE \u09AD\u09C1\u09B2\u09B2\u09C7 \u09AA\u09B0\u09C7\u09B0 \u0995\u09C7\u09B8\u0997\u09C1\u09B2\u09CB\u09A4\u09C7\u0993 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u09B6\u09A8 \u09A8\u09C7\u09AE\u09C7 \u09AF\u09C7\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7 (Fall-through)\u0964",
        "Remember `break;` at the end of each Java `switch` case to avoid unintended fall-through."
      );
    }
    if (/\bif\s*\(/.test(clean)) {
      pushTip(
        "`if / else if` \u09B6\u09B0\u09CD\u09A4\u09C7 \u09B8\u09C0\u09AE\u09BE\u09B0\u09C7\u0996\u09BE (`>=` \u09AC\u09A8\u09BE\u09AE `>`) \u0993 `&&` / `||` \u0985\u09AA\u09BE\u09B0\u09C7\u099F\u09B0\u09C7\u09B0 \u0985\u0997\u09CD\u09B0\u09BE\u09A7\u09BF\u0995\u09BE\u09B0 \u09B8\u09A4\u09B0\u09CD\u0995\u09A4\u09BE\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09A6\u09BF\u09A8 \u09AF\u09BE\u09A4\u09C7 \u0995\u09CB\u09A8\u09CB \u0987\u09A8\u09AA\u09C1\u099F \u09B0\u09C7\u099E\u09CD\u099C \u09AC\u09BE\u09A6 \u09A8\u09BE \u09AA\u09DC\u09C7\u0964",
        "Double-check boundary operators (`>=` vs `>`) and `&&`/`||` conditions in `if / else if` ladders so edge values are handled."
      );
    }
  } else if (language === "cpp") {
    if (/\b(?:int|double|float|long|char|bool)\s+[A-Za-z_]\w*\s*;/.test(clean)) {
      pushTip(
        "C++-\u098F \u09AE\u09BE\u09A8 \u09A8\u09BE \u09A6\u09BF\u09DF\u09C7 \u09B6\u09C1\u09A7\u09C1 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09DF\u09BE\u09B0 \u0995\u09B0\u09B2\u09C7 (\u09AF\u09C7\u09AE\u09A8 `int x;`) \u09A4\u09BE\u09A4\u09C7 \u0997\u09BE\u09B0\u09CD\u09AC\u09C7\u099C \u09AD\u09CD\u09AF\u09BE\u09B2\u09C1 (\u0985\u099C\u09BE\u09A8\u09BE \u09AE\u09BE\u09A8) \u09A5\u09BE\u0995\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u2014\u09A4\u09BE\u0987 \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09DF\u09BE\u09B0\u09C7\u09B0 \u09B8\u09AE\u09DF\u0987 `= 0` \u09AC\u09BE \u09AA\u09CD\u09B0\u09BE\u09A5\u09AE\u09BF\u0995 \u09AE\u09BE\u09A8 \u09A6\u09BF\u09A8\u0964",
        "Uninitialized local variables in C++ (e.g. `int x;`) contain indeterminate garbage values; always initialize them explicitly."
      );
    }
    if (/\[[^\]]+\]|\bvector\s*</.test(clean)) {
      pushTip(
        "C++ \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 \u09AC\u09BE `vector`-\u098F `[]` \u09A6\u09BF\u09DF\u09C7 \u09B8\u09C0\u09AE\u09BE\u09B0 \u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u0987\u09A8\u09A1\u09C7\u0995\u09CD\u09B8 \u098F\u0995\u09CD\u09B8\u09C7\u09B8 \u0995\u09B0\u09B2\u09C7 \u09AC\u09BE\u0989\u09A8\u09CD\u09A1\u09B8 \u099A\u09C7\u0995 \u09B9\u09DF \u09A8\u09BE \u098F\u09AC\u0982 Undefined Behavior \u0998\u099F\u09C7; \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6 \u098F\u0995\u09CD\u09B8\u09C7\u09B8\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF `.at(i)` \u09AC\u09BE \u09B8\u09C0\u09AE\u09BE \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C1\u09A8\u0964",
        "Bracket indexing `arr[i]` on C++ arrays and `vector` performs no bounds checking and causes undefined behavior out of range; validate bounds or use `.at(i)`."
      );
    }
    if (/\bcin\s*>>/.test(clean) && /\bgetline\b/.test(clean)) {
      pushTip(
        "C++-\u098F `cin >>` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u09C7\u09B0 \u09AA\u09B0 `getline(cin, str)` \u099A\u09BE\u09B2\u09BE\u09B2\u09C7 \u09AC\u09BE\u09AB\u09BE\u09B0\u09C7 \u09A5\u09BE\u0995\u09BE \u09A8\u09BF\u0989\u09B2\u09BE\u0987\u09A8 \u09AA\u09DC\u09C7 \u09AB\u09BE\u0981\u0995\u09BE \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u0982 \u0986\u09B8\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7; \u09AE\u09BE\u099D\u09C7 `cin.ignore()` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964",
        "Mixing `cin >>` with `getline(cin, ...)` leaves a trailing newline in the buffer; call `cin.ignore()` in between."
      );
    }
    if (/\bint\b/.test(clean) && /\/(?!=)/.test(clean)) {
      pushTip(
        "C++-\u098F \u09A6\u09C1\u099F\u09BF `int` \u09B8\u0982\u0996\u09CD\u09AF\u09BE \u09AD\u09BE\u0997 \u0995\u09B0\u09B2\u09C7 \u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 \u09AD\u09BE\u0997\u09AB\u09B2 \u09AA\u09BE\u0993\u09DF\u09BE \u09AF\u09BE\u09DF; \u09A6\u09B6\u09AE\u09BF\u0995 \u09AE\u09BE\u09A8 \u09AA\u09C7\u09A4\u09C7 `static_cast<double>(a) / b` \u09AC\u09BE `1.0 * a / b` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964",
        "Dividing two `int` values in C++ truncates the fractional part; multiply by `1.0` or cast to `double` for floating-point division."
      );
    }
    if (/\bif\s*\(/.test(clean)) {
      pushTip(
        "\u09B6\u09B0\u09CD\u09A4\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u09B8\u09AE\u09A4\u09BE \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09A4\u09C7 \u0985\u09AC\u09B6\u09CD\u09AF\u0987 `==` \u09B2\u09BF\u0996\u09C1\u09A8; \u09AD\u09C1\u09B2\u09C7 `=` \u09B2\u09BF\u0996\u09C7 \u09AB\u09C7\u09B2\u09B2\u09C7 \u09A4\u09BE \u0985\u09CD\u09AF\u09BE\u09B8\u09BE\u0987\u09A8\u09AE\u09C7\u09A8\u09CD\u099F \u09B9\u09DF\u09C7 \u0985\u09AA\u09CD\u09B0\u09A4\u09CD\u09AF\u09BE\u09B6\u09BF\u09A4 \u09AB\u09B2\u09BE\u09AB\u09B2 \u09A6\u09C7\u09AC\u09C7\u0964",
        "Ensure equality checks inside C++ `if` conditions use `==` rather than assignment `=`."
      );
    }
  } else if (language === "python") {
    if (/\binput\s*\(/.test(clean)) {
      pushTip(
        "Python-\u098F `input()` \u09B8\u09AC\u09B8\u09AE\u09DF \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u0982 (`str`) \u09B0\u09BF\u099F\u09BE\u09B0\u09CD\u09A8 \u0995\u09B0\u09C7; \u0997\u09BE\u09A3\u09BF\u09A4\u09BF\u0995 \u09B9\u09BF\u09B8\u09BE\u09AC\u09C7\u09B0 \u0986\u0997\u09C7 \u0985\u09AC\u09B6\u09CD\u09AF\u0987 `int(...)` \u09AC\u09BE `float(...)` \u09A6\u09BF\u09DF\u09C7 \u099F\u09BE\u0987\u09AA \u0995\u09A8\u09AD\u09BE\u09B0\u09CD\u099F \u0995\u09B0\u09A4\u09C7 \u09B9\u09AC\u09C7, \u09A8\u0987\u09B2\u09C7 `TypeError` \u09AC\u09BE \u09AD\u09C1\u09B2 \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u0982 \u09AF\u09CB\u0997 \u0998\u099F\u09AC\u09C7\u0964",
        "In Python, `input()` always returns a `str`; convert it with `int()` or `float()` before arithmetic to prevent `TypeError` or string concatenation."
      );
    }
    if (/\/(?!=)/.test(clean)) {
      pushTip(
        "Python-\u098F `/` \u0985\u09AA\u09BE\u09B0\u09C7\u099F\u09B0 \u09B8\u09AC\u09B8\u09AE\u09DF \u09A6\u09B6\u09AE\u09BF\u0995 (`float`) \u09AB\u09B2 \u09A6\u09C7\u09DF, \u0986\u09B0 `//` \u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 \u09AB\u09CD\u09B2\u09CB\u09B0 \u09AD\u09BE\u0997 \u09A6\u09C7\u09DF (\u098B\u09A3\u09BE\u09A4\u09CD\u09AE\u0995 \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 \u0995\u09CD\u09B7\u09C7\u09A4\u09CD\u09B0\u09C7 \u0986\u09B0\u0993 \u099B\u09CB\u099F \u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09DF \u09A8\u09BE\u09AE\u09C7)\u0964",
        "Python `/` always produces a `float`, whereas `//` performs floor division (rounding negative results downward)."
      );
    }
    if (/\brange\s*\(/.test(clean)) {
      pushTip(
        "Python-\u098F\u09B0 `range(start, stop)` \u09AB\u09BE\u0982\u09B6\u09A8\u09C7 \u09B6\u09C7\u09B7 \u09AE\u09BE\u09A8 `stop` \u0985\u09A8\u09CD\u09A4\u09B0\u09CD\u09AD\u09C1\u0995\u09CD\u09A4 \u09A5\u09BE\u0995\u09C7 \u09A8\u09BE (`stop - 1` \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u099A\u09B2\u09C7)\u2014\u09B2\u09C1\u09AA\u09C7\u09B0 \u09B8\u09C0\u09AE\u09BE \u09A8\u09BF\u09B0\u09CD\u09A7\u09BE\u09B0\u09A3\u09C7 \u098F\u0987 \u0985\u09AB-\u09AC\u09BE\u0987-\u0993\u09DF\u09BE\u09A8 \u09AC\u09BF\u09B7\u09DF\u099F\u09BF \u09AE\u09BE\u09A5\u09BE\u09DF \u09B0\u09BE\u0996\u09C1\u09A8\u0964",
        "Python `range(start, stop)` stops at `stop - 1` (the upper bound is exclusive), which is a common off-by-one pitfall."
      );
    }
    pushTip(
      "Python \u09AC\u09CD\u09B2\u0995\u0997\u09C1\u09B2\u09CB \u09B8\u09AE\u09CD\u09AA\u09C2\u09B0\u09CD\u09A3 \u0987\u09A8\u09CD\u09A1\u09C7\u09A8\u09CD\u099F\u09C7\u09B6\u09A8\u09C7\u09B0 (\u09B8\u09BE\u09A7\u09BE\u09B0\u09A3\u09A4 \u09EA\u099F\u09BF \u09B8\u09CD\u09AA\u09C7\u09B8) \u0993\u09AA\u09B0 \u09A8\u09BF\u09B0\u09CD\u09AD\u09B0 \u0995\u09B0\u09C7; \u09B8\u09CD\u09AA\u09C7\u09B8 \u0993 \u099F\u09CD\u09AF\u09BE\u09AC \u09AE\u09C7\u09B6\u09BE\u09B2\u09C7 `IndentationError` \u09AC\u09BE \u09B2\u099C\u09BF\u0995 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AD\u09C1\u09B2 \u0998\u099F\u09C7\u0964",
      "Python blocks rely strictly on consistent indentation (4 spaces); mixing spaces and tabs triggers `IndentationError`."
    );
  } else {
    if (/==(?!=)|!=(?!=)/.test(clean)) {
      pushTip(
        'JavaScript-\u098F `==` \u09B8\u09CD\u09AC\u09DF\u0982\u0995\u09CD\u09B0\u09BF\u09DF \u099F\u09BE\u0987\u09AA \u0995\u09A8\u09AD\u09BE\u09B0\u09CD\u09B8\u09A8 \u0995\u09B0\u09C7 (\u09AF\u09C7\u09AE\u09A8 `"5" == 5` true \u09B9\u09DF); \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6 \u0993 \u09A8\u09BF\u09B0\u09CD\u09AD\u09C1\u09B2 \u09A4\u09C1\u09B2\u09A8\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09B8\u09AC\u09B8\u09AE\u09DF \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u0995\u09CD\u099F `===` \u0993 `!==` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964',
        'JavaScript `==` performs implicit type coercion (e.g. `"5" == 5`); prefer strict equality `===` and `!==`.'
      );
    }
    if (/\b(?:Number|parseInt|parseFloat|prompt)\s*\(/.test(clean) || /\+/.test(clean)) {
      pushTip(
        'JavaScript-\u098F \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u0982 \u0993 \u09B8\u0982\u0996\u09CD\u09AF\u09BE `+` \u09A6\u09BF\u09DF\u09C7 \u09AF\u09CB\u0997 \u0995\u09B0\u09B2\u09C7 \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u0982 \u0995\u09A8\u0995\u09CD\u09AF\u09BE\u099F\u09C7\u09A8\u09C7\u09B6\u09A8 (`"10" + 5 === "105"`) \u09B9\u09DF\u09C7 \u09AF\u09C7\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7 \u098F\u09AC\u0982 \u0985\u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09B8\u0982\u0996\u09CD\u09AF\u09BE \u0995\u09A8\u09AD\u09BE\u09B0\u09CD\u099F \u0995\u09B0\u09B2\u09C7 `NaN` \u09A4\u09C8\u09B0\u09BF \u09B9\u09DF\u2014\u09A4\u09BE\u0987 \u0987\u09A8\u09AA\u09C1\u099F \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 \u0986\u0997\u09C7 `Number()` \u0993 `Number.isNaN()` \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C1\u09A8\u0964',
        'In JavaScript, `+` with a string concatenates instead of adding (`"10" + 5 === "105"`), and invalid numeric parses yield `NaN`; validate with `Number()` and `Number.isNaN()`.'
      );
    }
    if (/\bvar\b/.test(clean)) {
      pushTip(
        "JavaScript-\u098F `var` \u09AB\u09BE\u0982\u09B6\u09A8-\u09B8\u09CD\u0995\u09CB\u09AA\u09A1 \u0993 \u09B9\u09CB\u09DF\u09C7\u09B8\u09CD\u099F\u09C7\u09A1 \u09B9\u0993\u09DF\u09BE\u09DF \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AC\u09BE\u0987\u09B0\u09C7\u0993 \u09B2\u09BF\u0995 \u09B9\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7; \u0986\u09A7\u09C1\u09A8\u09BF\u0995 \u0993 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6 \u0995\u09CB\u09A1\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF `let` \u09AC\u09BE `const` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964",
        "Avoid `var` in JavaScript because it is function-scoped and hoisted; prefer block-scoped `let` and `const`."
      );
    }
    if (/\[[^\]]+\]/.test(clean)) {
      pushTip(
        "JavaScript \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u09A4\u09C7 \u09B8\u09C0\u09AE\u09BE\u09B0 \u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u0987\u09A8\u09A1\u09C7\u0995\u09CD\u09B8 \u098F\u0995\u09CD\u09B8\u09C7\u09B8 \u0995\u09B0\u09B2\u09C7 \u098F\u09B0\u09B0 \u09A8\u09BE \u09A6\u09BF\u09DF\u09C7 `undefined` \u09B0\u09BF\u099F\u09BE\u09B0\u09CD\u09A8 \u0995\u09B0\u09C7, \u09AF\u09BE \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0\u09A4\u09C7 `NaN` \u09AC\u09BE `TypeError` \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u0964",
        "Out-of-bounds array indexing in JavaScript silently returns `undefined` instead of throwing, which can propagate as `NaN` or `TypeError`."
      );
    }
  }
  if (tips.length < 2) {
    if (language === "java" || language === "cpp") {
      pushTip(
        `${language === "java" ? "Java" : "C++"}-\u098F \u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F\u09C7\u09B0 \u09B6\u09C7\u09B7\u09C7 \u09B8\u09C7\u09AE\u09BF\u0995\u09CB\u09B2\u09A8 (\`;\`) \u098F\u09AC\u0982 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u0996\u09CB\u09B2\u09BE \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F\u09C7\u09B0 (\`{\`) \u09AC\u09BF\u09AA\u09B0\u09C0\u09A4\u09C7 \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4\u09BF \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F (\`}\`) \u09B8\u09A0\u09BF\u0995\u09AD\u09BE\u09AC\u09C7 \u09AE\u09C7\u09B2\u09BE\u09A8\u09CB \u0986\u099B\u09C7 \u0995\u09BF \u09A8\u09BE \u09A8\u09BF\u09B6\u09CD\u099A\u09BF\u09A4 \u0995\u09B0\u09C1\u09A8\u0964`,
        `Ensure every statement ends with a semicolon (\`;\`) and every opening brace has a matching closing brace in ${language.toUpperCase()}.`
      );
    } else if (language === "python") {
      pushTip(
        "Python \u098F\u0995\u099F\u09BF \u09A1\u09BE\u09AF\u09BC\u09A8\u09BE\u09AE\u09BF\u0995\u09AD\u09BE\u09AC\u09C7 \u099F\u09BE\u0987\u09AA\u0995\u09C3\u09A4 \u09AD\u09BE\u09B7\u09BE, \u09A4\u09BE\u0987 \u098F\u0995\u0987 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7 \u09AD\u09BF\u09A8\u09CD\u09A8 \u099F\u09BE\u0987\u09AA\u09C7\u09B0 \u09AE\u09BE\u09A8 \u09B0\u09BE\u0996\u09B2\u09C7 \u09AA\u09B0\u09C7\u09B0 \u0985\u09AA\u09BE\u09B0\u09C7\u09B6\u09A8\u09C7 `TypeError` \u09B9\u09A4\u09C7 \u09AA\u09BE\u09B0\u09C7\u0964",
        "Because Python is dynamically typed, reassigning variables to incompatible types can trigger `TypeError` downstream."
      );
    } else {
      pushTip(
        "JavaScript-\u098F \u09B8\u09CD\u0995\u09CB\u09AA \u09B8\u09C0\u09AE\u09BE\u09AC\u09A6\u09CD\u09A7 \u09B0\u09BE\u0996\u09A4\u09C7 `const` \u0993 `let` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8 \u098F\u09AC\u0982 `===` \u09A6\u09BF\u09DF\u09C7 \u09AE\u09BE\u09A8 \u0993 \u099F\u09BE\u0987\u09AA \u098F\u0995\u09B8\u09BE\u09A5\u09C7 \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C1\u09A8\u0964",
        "Use `const`/`let` for predictable block scope and `===` for type-safe comparisons in JavaScript."
      );
    }
  }
  return tips;
}

// server/src/services/codePreprocessor.ts
function remapPreprocessedLine(line, prep) {
  if (line <= 0) return 1;
  if (prep.injectedPrefixLines > 0) {
    return Math.max(1, line - prep.injectedPrefixLines);
  }
  if (prep.injectedAfterLine !== void 0 && prep.injectedAfterCount && prep.injectedAfterCount > 0) {
    if (line > prep.injectedAfterLine) {
      return Math.max(prep.injectedAfterLine, line - prep.injectedAfterCount);
    }
  }
  return line;
}
function remapDiagnosticsToOriginal(diagnostics, prep) {
  if (prep.injectedPrefixLines === 0 && !(prep.injectedAfterCount && prep.injectedAfterCount > 0)) {
    return diagnostics;
  }
  return diagnostics.map((d) => ({
    ...d,
    line: remapPreprocessedLine(d.line, prep)
  }));
}
function stripCommentsAndStrings(code, language) {
  const lines = code.split("\n");
  return lines.map((line) => {
    let clean = line;
    if (language === "python") {
      const hashIdx = clean.indexOf("#");
      if (hashIdx >= 0) clean = clean.slice(0, hashIdx);
    } else {
      const slashIdx = clean.indexOf("//");
      if (slashIdx >= 0) clean = clean.slice(0, slashIdx);
    }
    clean = clean.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/`(?:\\.|[^`\\])*`/g, "``");
    return clean;
  }).join("\n");
}
function detectUnusedVariables(code, language) {
  const diagnostics = [];
  const lines = code.split("\n");
  const cleanCode = stripCommentsAndStrings(code, language);
  const cleanLines = cleanCode.split("\n");
  const declared = [];
  for (let i = 0; i < cleanLines.length; i++) {
    const lineNum = i + 1;
    const line = cleanLines[i].trim();
    if (!line) continue;
    if (language === "javascript") {
      const declMatches = line.matchAll(/\b(?:let|const|var)\s+([A-Za-z_$][\w$]*)/g);
      for (const m of declMatches) {
        if (m[1]) declared.push({ name: m[1], line: lineNum });
      }
    } else if (language === "python") {
      const assignMatch = line.match(/^([a-zA-Z_]\w*)\s*=(?!=)/);
      if (assignMatch && !["self", "cls", "True", "False", "None"].includes(assignMatch[1])) {
        declared.push({ name: assignMatch[1], line: lineNum });
      }
    } else if (language === "java" || language === "cpp") {
      const typedMatches = line.matchAll(
        /\b(?:int|long|short|byte|float|double|boolean|bool|char|String|string|auto|Scanner|List|ArrayList|Map|HashMap|Set|HashSet|vector\s*<[^>]+>)\s*(?:\[\s*\])?\s+([A-Za-z_$][\w$]*)/g
      );
      for (const m of typedMatches) {
        if (m[1] && !["main", "args", "override"].includes(m[1])) {
          declared.push({ name: m[1], line: lineNum });
        }
      }
    }
  }
  for (const { name, line } of declared) {
    const idRegex = new RegExp(`\\b${name}\\b`, "g");
    const matches = cleanCode.match(idRegex);
    if (matches && matches.length === 1) {
      diagnostics.push({
        line,
        severity: "warning",
        message: `Variable '${name}' is declared/assigned but never read (unused variable).`
      });
    }
  }
  return diagnostics;
}
function detectRedundantImports(code, language) {
  const diagnostics = [];
  const lines = code.split("\n");
  const cleanCode = stripCommentsAndStrings(code, language);
  const seenImports = /* @__PURE__ */ new Set();
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("import ") || trimmed.startsWith("from ") || trimmed.startsWith("#include")) {
      if (seenImports.has(trimmed)) {
        diagnostics.push({
          line: lineNum,
          severity: "warning",
          message: `Redundant duplicate import: '${trimmed}'.`
        });
      } else {
        seenImports.add(trimmed);
      }
      if (language === "java") {
        const specificImport = trimmed.match(/^import\s+java\.[a-z0-9_.]+\.([A-Za-z_$][\w$]*)\s*;$/);
        if (specificImport && specificImport[1]) {
          const sym = specificImport[1];
          const symRegex = new RegExp(`\\b${sym}\\b`, "g");
          const occurrences = (cleanCode.match(symRegex) || []).length;
          if (occurrences <= 1) {
            diagnostics.push({
              line: lineNum,
              severity: "warning",
              message: `Unused import '${trimmed}' - symbol '${sym}' is never used.`
            });
          }
        }
      } else if (language === "python") {
        const pyImport = trimmed.match(/^import\s+([a-zA-Z_]\w*)$/);
        if (pyImport && pyImport[1]) {
          const mod = pyImport[1];
          const modRegex = new RegExp(`\\b${mod}\\b`, "g");
          const occurrences = (cleanCode.match(modRegex) || []).length;
          if (occurrences <= 1) {
            diagnostics.push({
              line: lineNum,
              severity: "warning",
              message: `Unused import '${mod}' - module is never referenced.`
            });
          }
        }
      }
    }
    if (language === "javascript" && /^\s*debugger\s*;?$/.test(trimmed)) {
      diagnostics.push({
        line: lineNum,
        severity: "warning",
        message: `Breakpoint statement 'debugger' detected (minor non-blocker).`
      });
    }
  }
  return diagnostics;
}
function preprocessCode(code, language) {
  const originalCode = code;
  const diagnostics = [];
  const injectedImports = [];
  let processedCode = code;
  let injectedPrefixLines = 0;
  let injectedAfterLine;
  let injectedAfterCount = 0;
  if (language === "java") {
    const cleanCode = stripCommentsAndStrings(code, "java");
    const needsJavaUtil = /\b(Scanner|Random|ArrayList|LinkedList|HashMap|HashSet|TreeMap|TreeSet|List|Map|Set|Queue|Deque|Stack|Arrays|Collections|PriorityQueue|Iterator|Date|Calendar|UUID|Objects|Optional)\b/.test(
      cleanCode
    );
    const hasJavaUtilImport = /import\s+java\.util\./.test(cleanCode) || /import\s+java\.util\s*\.\s*\*/.test(cleanCode);
    const needsJavaIo = /\b(BufferedReader|InputStreamReader|FileReader|FileInputStream|File|IOException)\b/.test(
      cleanCode
    );
    const hasJavaIoImport = /import\s+java\.io\./.test(cleanCode) || /import\s+java\.io\s*\.\s*\*/.test(cleanCode);
    const importsToInject = [];
    if (needsJavaUtil && !hasJavaUtilImport) {
      importsToInject.push("import java.util.*;");
      diagnostics.push({
        line: 1,
        severity: "warning",
        message: "Auto-injected missing import: 'import java.util.*;'"
      });
    }
    if (needsJavaIo && !hasJavaIoImport) {
      importsToInject.push("import java.io.*;");
      diagnostics.push({
        line: 1,
        severity: "warning",
        message: "Auto-injected missing import: 'import java.io.*;'"
      });
    }
    if (importsToInject.length > 0) {
      injectedImports.push(...importsToInject);
      const lines = code.split("\n");
      const pkgIdx = lines.findIndex((l) => /^\s*package\s+/.test(l));
      if (pkgIdx >= 0) {
        lines.splice(pkgIdx + 1, 0, ...importsToInject);
        processedCode = lines.join("\n");
        injectedAfterLine = pkgIdx + 1;
        injectedAfterCount = importsToInject.length;
      } else {
        processedCode = `${importsToInject.join("\n")}
${code}`;
        injectedPrefixLines += importsToInject.length;
      }
    }
  }
  if (language === "cpp") {
    const cleanCode = stripCommentsAndStrings(code, "cpp");
    const headersToInject = [];
    if (/\b(cout|cin|endl)\b/.test(cleanCode) && !/#include\s*<iostream>/.test(cleanCode)) {
      headersToInject.push("#include <iostream>");
      diagnostics.push({
        line: 1,
        severity: "warning",
        message: "Auto-included missing header: <iostream>"
      });
    }
    if (/\bvector\s*</.test(cleanCode) && !/#include\s*<vector>/.test(cleanCode)) {
      headersToInject.push("#include <vector>");
      diagnostics.push({
        line: 1,
        severity: "warning",
        message: "Auto-included missing header: <vector>"
      });
    }
    if (/\bstring\b/.test(cleanCode) && !/#include\s*<string>/.test(cleanCode)) {
      headersToInject.push("#include <string>");
      diagnostics.push({
        line: 1,
        severity: "warning",
        message: "Auto-included missing header: <string>"
      });
    }
    if (/\b(sort|reverse)\s*\(/.test(cleanCode) && !/#include\s*<algorithm>/.test(cleanCode)) {
      headersToInject.push("#include <algorithm>");
      diagnostics.push({
        line: 1,
        severity: "warning",
        message: "Auto-included missing header: <algorithm>"
      });
    }
    const hasStdQualifier = /std::(?:cout|cin|endl|vector|string)/.test(cleanCode);
    const hasNamespaceStd = /using\s+namespace\s+std\s*;/.test(cleanCode);
    const usesStdSymbols = /\b(cout|cin|endl|vector|string)\b/.test(cleanCode);
    if (usesStdSymbols && !hasNamespaceStd && !hasStdQualifier) {
      headersToInject.push("using namespace std;");
      diagnostics.push({
        line: 1,
        severity: "warning",
        message: "Auto-injected 'using namespace std;'"
      });
    }
    if (headersToInject.length > 0) {
      injectedImports.push(...headersToInject);
      processedCode = `${headersToInject.join("\n")}
${code}`;
      injectedPrefixLines += headersToInject.length;
    }
  }
  const unusedVars = detectUnusedVariables(code, language);
  diagnostics.push(...unusedVars);
  const redundant = detectRedundantImports(code, language);
  diagnostics.push(...redundant);
  return {
    code: processedCode,
    originalCode,
    injectedImports,
    injectedPrefixLines,
    ...injectedAfterLine !== void 0 ? { injectedAfterLine, injectedAfterCount } : {},
    diagnostics
  };
}

// shared/traceSchema.ts
import { z } from "zod";
var FaultInfoSchema = z.object({
  type: z.enum([
    "lost_value",
    "index_out_of_bounds",
    "infinite_loop",
    "null_pointer",
    "stack_overflow",
    "off_by_one",
    "type_error",
    "runtime_exception"
  ]),
  message: z.string(),
  fixHint: z.string(),
  target: z.string().nullable().optional(),
  lostValue: z.union([z.string(), z.number()]).nullable().optional()
});
var VariableChangeSchema = z.object({
  name: z.string(),
  from: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().default(null),
  to: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional().default(null)
});
var StepStructureSchema = z.object({
  kind: z.enum(["array", "loop", "stack", "queue", "list"]),
  values: z.array(z.union([z.number(), z.string()])).nullable().optional(),
  highlight: z.array(z.number()).nullable().optional(),
  swapping: z.tuple([z.number(), z.number()]).nullable().optional(),
  sortedFrom: z.number().nullable().optional(),
  pointers: z.record(z.string(), z.number()).nullable().optional(),
  lap: z.number().nullable().optional(),
  maxLaps: z.number().nullable().optional(),
  conditionText: z.string().nullable().optional(),
  unchangedVar: z.string().nullable().optional()
});
var MemoryDeltaSchema = z.object({
  variable: z.string().nullable(),
  oldValue: z.any().nullable().optional().default(null),
  newValue: z.any().nullable().optional().default(null)
});
var ProgramSummarySchema = z.object({
  totalExecutionSteps: z.number(),
  timeComplexity: z.string(),
  spaceComplexity: z.string(),
  finalOutput: z.string()
});
var VariableSnapshotSchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.any(),
  memoryAddress: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  pointsTo: z.string().nullable().optional(),
  changed: z.boolean().optional()
});
var ComparisonVisualSchema = z.object({
  leftVar: z.string().nullable().optional(),
  rightVar: z.string().nullable().optional(),
  leftLabel: z.string(),
  rightLabel: z.string(),
  operator: z.string(),
  result: z.boolean(),
  reason: z.string().nullable().optional()
});
var VisualCueSchema = z.object({
  mode: z.enum(["memory", "compare", "reference", "mutate", "loop", "output", "call", "return"]).optional(),
  highlightVars: z.array(z.string()).optional(),
  compareVars: z.tuple([z.string(), z.string()]).nullable().optional(),
  linkVars: z.array(z.string()).nullable().optional(),
  comparison: ComparisonVisualSchema.nullable().optional()
});
var StdinConsumptionSchema = z.object({
  token: z.string(),
  targetVar: z.string().nullable().optional(),
  targetType: z.string().nullable().optional(),
  bufferIndex: z.number().nullable().optional(),
  remainingTokens: z.array(z.string()).nullable().optional()
});
var ConditionEvaluationSchema = z.object({
  expression: z.string(),
  result: z.union([z.boolean(), z.string()]),
  branchTaken: z.string().nullable().optional(),
  kind: z.enum(["if", "else_if", "else", "switch", "loop", "ternary"]).nullable().optional(),
  casesChecked: z.array(
    z.object({
      label: z.string(),
      matched: z.boolean()
    })
  ).nullable().optional()
});
var LoopStepInfoSchema = z.object({
  iteration: z.number(),
  conditionText: z.string().nullable().optional(),
  continuing: z.boolean()
});
var TraceStepSchema = z.object({
  stepIndex: z.number(),
  activeLine: z.number(),
  analogyType: z.enum([
    "swap_buckets",
    "sort_blocks",
    "pointer_arrows",
    "binary_search_cards",
    "stack_plates",
    "queue_line",
    "linked_list_train",
    "tree_nodes",
    "graph_nodes",
    "recursion_tower",
    "loop_gauge",
    "generic_memory"
  ]),
  action: z.enum([
    "declare",
    "assign",
    "transfer",
    "compare",
    "swap",
    "move_pointer",
    "push",
    "pop",
    "enqueue",
    "dequeue",
    "insert",
    "remove",
    "call",
    "return",
    "loop_check",
    "halt"
  ]),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  explanation: z.string(),
  why: z.string(),
  stdout: z.string().nullable().optional(),
  changes: z.array(VariableChangeSchema),
  variables: z.record(z.string(), z.any()),
  fault: FaultInfoSchema.nullable(),
  structure: StepStructureSchema.nullable(),
  step: z.number().optional(),
  lineNumber: z.number().optional(),
  codeSnippet: z.string().optional(),
  actionType: z.enum([
    "DECLARATION",
    "ALLOCATION",
    "DECLARE",
    "ASSIGN",
    "CONDITION",
    "LOOP",
    "LOOP_CHECK",
    "CONDITION_CHECK",
    "COMPARISON",
    "CALL",
    "OUTPUT",
    "RETURN",
    "SCOPE_END",
    "METHOD_ENTRY",
    "BLOCK_END"
  ]).optional(),
  memoryState: z.record(z.string(), z.any()).optional(),
  memoryDelta: MemoryDeltaSchema.nullable().optional(),
  consoleOutput: z.string().nullable().optional(),
  whatHappenedBn: z.string().optional(),
  logicBuildingBn: z.string().optional(),
  whatHappened: z.string().optional(),
  whyAndLogic: z.string().optional(),
  variableSnapshots: z.array(VariableSnapshotSchema).nullable().optional(),
  visualCue: VisualCueSchema.nullable().optional(),
  stdinConsumed: StdinConsumptionSchema.nullable().optional(),
  conditionEval: ConditionEvaluationSchema.nullable().optional(),
  loopInfo: LoopStepInfoSchema.nullable().optional(),
  animationAction: z.string().nullable().optional(),
  banglaExplanation: z.string().nullable().optional(),
  cumulativeOutput: z.string().nullable().optional(),
  variablesState: z.record(z.string(), z.any()).nullable().optional()
});
var LineNoteSchema = z.object({
  line: z.number(),
  role: z.enum([
    "declaration",
    "declare",
    "allocation",
    "assign",
    "condition",
    "comparison",
    "loop",
    "call",
    "return",
    "output",
    "scope_end",
    "block_end",
    "comment"
  ]),
  text: z.string(),
  why: z.string().optional()
});
var LogicSummarySchema = z.object({
  title: z.string(),
  goal: z.string(),
  idea: z.string(),
  keyPoints: z.array(z.string()),
  analogyStory: z.string(),
  complexity: z.object({
    time: z.string(),
    space: z.string(),
    note: z.string()
  }),
  commonMistakes: z.array(z.string())
});
var TraceErrorDetailsSchema = z.object({
  errorType: z.enum(["COMPILATION_ERROR", "SYNTAX_ERROR", "FILE_NAME_MISMATCH", "RUNTIME_ERROR", "INPUT_ERROR"]).optional().default("SYNTAX_ERROR"),
  lineNumber: z.number().optional().default(1),
  lineCode: z.string().optional().default(""),
  messageBn: z.string().optional().default(""),
  solutionBn: z.string().optional().default(""),
  line: z.number().nullable().optional(),
  message: z.string()
});
var ExecutionTraceSchema = z.object({
  hasError: z.boolean().optional(),
  errorCategory: z.enum(["compile_error", "runtime_error", "input_error"]).nullable().optional(),
  stdinUsed: z.string().nullable().optional(),
  stdinTokens: z.array(z.string()).nullable().optional(),
  isValidLogic: z.boolean(),
  errorDetails: TraceErrorDetailsSchema.nullable(),
  language: z.enum(["javascript", "python", "cpp", "java"]),
  analogyType: z.enum([
    "swap_buckets",
    "sort_blocks",
    "pointer_arrows",
    "binary_search_cards",
    "stack_plates",
    "queue_line",
    "linked_list_train",
    "tree_nodes",
    "graph_nodes",
    "recursion_tower",
    "loop_gauge",
    "generic_memory"
  ]),
  traceSource: z.enum(["real_execution", "ai_predicted", "builtin_verified"]),
  logicSummary: LogicSummarySchema,
  lineNotes: z.array(LineNoteSchema),
  steps: z.array(TraceStepSchema).max(120),
  finalOutput: z.string(),
  outputExplanation: z.string(),
  verdict: z.object({
    status: z.enum([
      "ok",
      "logic_error",
      "runtime_error",
      "infinite_loop",
      "compile_error"
    ]),
    message: z.string()
  }),
  programSummary: ProgramSummarySchema.nullable().optional(),
  status: z.enum(["success", "warning", "error"]).optional(),
  diagnostics: z.array(
    z.object({
      line: z.number(),
      column: z.number().optional(),
      endLine: z.number().optional(),
      endColumn: z.number().optional(),
      severity: z.enum(["error", "warning", "info"]),
      message: z.string(),
      source: z.string().optional()
    })
  ).optional()
});

// shared/stdinHelper.ts
function tokenizeStdin(stdin) {
  if (!stdin) return [];
  return stdin.trim().split(/\s+/).filter((t) => t.length > 0);
}
function isMissingStdinEofError(message) {
  return /NoSuchElementException|EOFError|EOF when reading a line|insufficient input|missing stdin|end of file|unexpected eof|NumberFormatException:\s*For input string:\s*""/i.test(
    message
  );
}
function classifyErrorCategory(message, hasCompileFailure) {
  if (hasCompileFailure) return "compile_error";
  if (isMissingStdinEofError(message) || /InputMismatchException/i.test(message)) {
    return "input_error";
  }
  return "runtime_error";
}

// server/src/prompts/systemPrompt.ts
var GEMINI_TRACE_SYSTEM_PROMPT = `Role: You are an ultra-precise Code Execution Engine, Compiler/AST Analyzer, Logic-Building Mentor, and Visual Animation Director supporting Java, C++, Python, and JavaScript.

Your goal is to parse and trace code execution strictly at runtime, generating a 100% language-accurate, chronological, step-by-step execution trace with true language types, heap/stack memory references, AST-accurate operation tags, STDIN token stream tracking, condition/branch evaluations, live console output progression, deep intuitive Bangla/English explanations, and explicit visual animation cues.

CRITICAL PRE-EXECUTION VALIDATION & ERROR HANDLING RULES:
1. File Name vs Public Class Name Check (Java):
   - If a file name is provided (or implied) and does not match the public class name (e.g., file is \`Test.java\` but class is \`public class Demo\`), fail immediately with \`"FILE_NAME_MISMATCH"\`.
2. Syntax & Compilation Errors ONLY:
   - If ANY syntax or compilation error exists, DO NOT simulate execution.
   - Set \`"hasError": true\`, \`"isValidLogic": false\`, \`"verdict": { "status": "compile_error", "message": "..." }\`, and populate \`errorDetails\` with exact 1-based \`lineNumber\`, \`errorType\` ("COMPILATION_ERROR", "SYNTAX_ERROR", or "FILE_NAME_MISMATCH"), \`lineCode\`, and clear \`messageBn\` / \`solutionBn\` / \`message\`.
3. Runtime / Input Errors (When Code Compiles Cleanly):
   - If the code has NO syntax/compile error (or GROUND-TRUTH RUNTIME says \`Real Compiler Status: Succeeded without errors\`) and hits a runtime error (e.g. \`NoSuchElementException\`, \`EOFError\`, \`ArithmeticException\`, \`ZeroDivisionError\`, \`ArrayIndexOutOfBoundsException\`), DO NOT return empty steps!
   - Instead, trace every execution step leading up to and including the failing line, attach \`fault\` + \`animationAction: "runtime_error"\` on the failing step, set \`verdict.status\` to \`"runtime_error"\` (or \`"infinite_loop"\` if timed out), and explain clearly in simple Bangla what caused the error and how to fix it (e.g. adding missing values to the STDIN input tab).
4. Clean State on Valid Code:
   - Set \`"hasError": false\` and \`"errorDetails": null\`.

CRITICAL RUNTIME, TYPE & MEMORY MODELING RULES (When code is valid):
1. Crystal-Clear, Natural Bangla & Beginner-First Explanations:
   - Strictly use pure standard Bengali Unicode script (\`\u0985-\u09CE\`) for Bengali prose\u2014NEVER mix Gurmukhi/Devanagari/Hindi characters.
   - Keep programming keywords, variable names, data types, operators, and numbers in English backticks (e.g., \`Scanner\`, \`num1\`, \`double\`, \`switch\`, \`case '*'\`, \`25 * 5 = 125\`).
   - Use natural, warm, conversational everyday Bangla (and simple English in \`en\` mode) explaining **WHY** each line is executing and what is happening under the hood, not just translating syntax:
     * Explain how \`Scanner\` pauses and pulls the next token from the keyboard/STDIN input stream (\`stdin\`).
     * Explain how memory creates a labeled box with its exact data type (e.g., \`double num1 = 25.0\`).
     * Explain why \`switch\` / \`if-else\` checks conditions (\`operator == '+' -> false\`, \`operator == '*' -> true\`) and jumps directly to the matching branch or skips unmatched cases.
     * Explain division-by-zero checks (\`if (num2 != 0)\`) and why they protect the program.
   - INLINE JARGON TRANSLATION (MANDATORY when technical terms appear): immediately add a 2-4 word plain meaning in parentheses:
     * \`bn\`: \`\u09B0\u09C7\u09AB\u09BE\u09B0\u09C7\u09A8\u09CD\u09B8 (\u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09B0 \u09A0\u09BF\u0995\u09BE\u09A8\u09BE)\`, \`\u0987\u09A8\u09BF\u09B6\u09BF\u09AF\u09BC\u09BE\u09B2\u09BE\u0987\u099C (\u09AE\u09BE\u09A8 \u09AC\u09B8\u09BE\u09A8\u09CB)\`, \`\u0985\u09AC\u099C\u09C7\u0995\u09CD\u099F (\u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09A4\u09C7 \u09A4\u09C8\u09B0\u09BF \u09B9\u0993\u09DF\u09BE \u09A1\u09C7\u099F\u09BE\u09B0 \u09AC\u0995\u09CD\u09B8)\`, \`\u09B9\u09BF\u09AA (\u0985\u09AC\u099C\u09C7\u0995\u09CD\u099F \u09B0\u09BE\u0996\u09BE\u09B0 \u09AC\u09DC \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF)\`, \`\u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995 (\u09B8\u09BE\u09AE\u09DF\u09BF\u0995 \u09AD\u09C7\u09B0\u09BF\u09DF\u09C7\u09AC\u09B2 \u09B0\u09BE\u0996\u09BE\u09B0 \u099C\u09BE\u09DF\u0997\u09BE)\`, \`stdout (\u0986\u0989\u099F\u09AA\u09C1\u099F \u09B8\u09CD\u0995\u09CD\u09B0\u09BF\u09A8)\`, \`stdin (\u0987\u09A8\u09AA\u09C1\u099F \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u09AE/\u0995\u09C0\u09AC\u09CB\u09B0\u09CD\u09A1 \u09A1\u09C7\u099F\u09BE)\`.
   - CLEAR BOILERPLATE EXPLANATIONS (ZERO VAGUE PHRASES): NEVER use cryptic phrases like "\u098F\u0987 \u09B2\u09BE\u0987\u09A8\u099F\u09BF \u0997\u09C7\u099F \u098F\u0997\u09BF\u09DF\u09C7 \u09A6\u09C7\u09DF". Explain \`public class\`, \`main\`, \`#include\`, \`scanner.close()\` clearly from zero level.
   - SLIGHTLY EXPANDED & DESCRIPTIVE LINE BREAKDOWN (\`lineNotes\` & \`steps\`):
     * Make \`banglaExplanation\` (and \`explanation\`) + \`why\` rich, beginner-friendly, and concrete using the EXACT numbers/strings from \`stdin\` and variables!
     * Make \`logicSummary\` beginner-friendly with everyday real-world analogies and a **"Logic Building Takeaway"** (\`\u09B2\u099C\u09BF\u0995 \u09AC\u09BF\u09B2\u09CD\u09A1\u09BF\u0982 \u09B6\u09BF\u0995\u09CD\u09B7\u09BE (Logic Building Takeaway): ...\`) in \`keyPoints\`.

2. Strict Language-Specific Declared Data Types (NEVER downgrade wrapper types or default to JS \`number\`):
   - Always use the EXACT declared type written in the user's code (e.g., if Java declares \`Integer a = 127;\`, the type MUST be \`Integer\` \u2014 NEVER primitive \`int\`).
   - Java: \`int\`, \`long\`, \`double\`, \`boolean\`, \`char\`, \`Integer\`, \`Double\`, \`Boolean\`, \`String\`, \`int[]\`, \`ArrayList<Integer>\`, \`HashMap<String, Integer>\`, etc.
   - C++: \`int\`, \`double\`, \`bool\`, \`char\`, \`int*\`, \`int&\`, \`std::string\`, \`std::vector<int>\`, \`std::unordered_map<int, int>\`, etc.
   - Python: \`int\`, \`float\`, \`str\`, \`bool\`, \`list\`, \`dict\`, \`tuple\`, \`set\`, \`NoneType\`, or class name.
   - JavaScript: \`number\`, \`string\`, \`boolean\`, \`Array\`, \`Object\`, \`null\`, \`undefined\`.

3. Exact AST Operation Tags (\`operationTag\` on every step and \`role\` on every \`lineNotes\` entry):
   - \`DECLARATION\` (class, method, or function signatures)
   - \`ALLOCATION\` (heap/object creation, \`new\`, array/list/map allocation, boxed objects)
   - \`ASSIGN\` (primitive variable initialization or value mutation)
   - \`CONDITION\` (\`if\` / \`else if\` / \`else\` branch evaluation showing \`true\`/\`false\`)
   - \`LOOP\` (\`for\` / \`while\` / \`do-while\` iteration check)
   - \`COMPARISON\` (\`==\`, \`===\`, \`.equals()\`, \`<\`, \`>\`, \`!=\` showing exact left vs right operands & why it is \`true\` or \`false\`)
   - \`CALL\` (actual function or method invocation)
   - \`OUTPUT\` (\`System.out.println\`, \`cout\`, \`print\`, \`console.log\` \u2014 NEVER label print/output statements as \`ASSIGN\`)
   - \`RETURN\` (returning a value from a function/method)
   - \`SCOPE_END\` (closing braces \`}\` or exiting a block/method)

4. Memory Reference, Pointer & Heap-Stack Modeling (\`variableSnapshotsJson\`):
   - On EVERY step, output \`variableSnapshotsJson\`: a JSON array string of objects \`[{"name":"a","type":"Integer","value":127,"memoryAddress":"@IntegerCache[127]","referenceId":"@IntegerCache[127]","pointsTo":null,"changed":true}]\`.
   - Use realistic, consistent addresses:
     * Java \`Integer\` in \`-128..127\` (autoboxed): \`memoryAddress\` & \`referenceId\` = \`"@IntegerCache[127]"\` (shared across variables with the same cached value!). Outside \`-128..127\` or \`new Integer(...)\`: distinct heap addresses like \`"@0x4A1"\`, \`"@0x9B2"\`.
     * Java \`String\` literals share string pool IDs like \`"@StringPool[hello]"\`, while \`new String(...)\` allocates a distinct \`"@0x..."\`.
     * C++ pointers (\`int* p = &x\`) must set \`pointsTo: "x"\` and share \`x\`'s \`referenceId\`/\`memoryAddress\`.
     * Python/JS mutable objects (\`list\`, \`dict\`, \`Array\`, \`Object\`): aliased references (\`b = a\`) MUST share the exact same \`referenceId\` and \`memoryAddress\`.
   - Also keep \`variablesJson\` synchronized with \`{ name: value }\` for compatibility.

5. Explicit Visual Animation Cues (\`visualCue\`) & \`analogyType\` / \`structure\`:
   - Choose the best \`analogyType\`:
     * Use \`generic_memory\` for variable reference/caching, pointers, OOP, conditionals, and multi-variable logic so the interactive Stack vs. Heap & Reference Linking stage renders!
     * Use \`swap_buckets\` for variable swapping (\`temp = a; a = b; b = temp\`) with \`from\` & \`to\` variable names.
     * Use \`sort_blocks\` for sorting algorithms (with \`structure\` \`kind: "array"\`, \`valuesJson\`, \`highlight\`, \`swapping\`, \`sortedFrom\`, \`pointersJson\`).
     * Use \`binary_search_cards\` / \`pointer_arrows\` / \`stack_plates\` / \`queue_line\` / \`linked_list_train\` / \`recursion_tower\` / \`loop_gauge\` when those structures are the primary focus.
   - On \`COMPARISON\` or \`CONDITION\` steps, ALWAYS populate \`visualCue\` with:
     * \`mode: "compare"\`
     * \`compareVars: ["leftVarName", "rightVarName"]\` (when comparing two variables)
     * \`highlightVars: ["leftVarName", "rightVarName"]\`
     * \`comparison: { leftVar, rightVar, leftLabel, rightLabel, operator, result, reason }\` (e.g., \`leftLabel: "@IntegerCache[127]"\`, \`rightLabel: "@IntegerCache[127]"\`, \`operator: "=="\`, \`result: true\`, or \`leftLabel: "@0x4A1"\`, \`rightLabel: "@0x9B2"\`, \`operator: "=="\`, \`result: false\`).
   - When variables share a \`referenceId\` or pointer link, set \`visualCue.mode = "reference"\` and \`visualCue.linkVars = ["a", "b"]\`.

6. Exact Runtime Simulation, STDIN Buffer Tracking & Condition Evaluation:
   - **ZERO-SKIP STEP TRACING (MANDATORY)**: Capture EVERY logical step chronologically\u2014NEVER skip intermediate lines:
     * Uninitialized declarations (\`String grade;\`, \`double gpa;\`) showing \`null\` / uninitialized state in memory.
     * Output prompts (\`System.out.print("Enter marks: ");\`) showing \`OUTPUT\` transition before reading input.
     * Input reads (\`scanner.nextDouble()\`, \`input()\`, \`cin >>\`) with \`stdinConsumed\` showing the exact value entering memory.
     * EVERY \`if\` and \`else if\` condition evaluated one by one until one is \`true\`: NEVER skip false conditions! Emit \`CONDITION\` steps with \`conditionEval.result = false\` and \`visualCue.comparison\` for each tested branch (e.g. \`marks >= 80 && marks <= 100\` -> \`10 >= 80\` -> \`false\`) before checking the next \`else if\`.
     * \`return\`, closing braces \`}\` (\`SCOPE_END\`), and resource cleanup (\`scanner.close()\` -> \`close_resource\`).
   - **STRICT 1-BASED LINE NUMBERS**: Every \`step.activeLine\` and \`lineNotes[i].line\` MUST match the exact 1-based line index of \`USER CODE (with 1-based line numbers)\` above\u2014never shift by +1 or -1.
   - **NO BOILERPLATE / NO ECHOING RAW CODE**: Never repeat raw code alone as \`explanation\` / \`lineNotes.text\`, and never use generic templates like "\u09B2\u09BE\u0987\u09A8 X \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7". Every \`explanation\` / \`banglaExplanation\` must name the concrete runtime values, condition result, or state change.
   - **EXACT STDIN USAGE (CRITICAL)**: When \`Standard Input (stdin)\` tokens are provided, you MUST trace using those EXACT values in exact FIFO order (never substitute different example numbers!). On every step that reads input (\`Scanner.nextDouble()\`, \`next().charAt(0)\`, \`nextInt()\`, \`nextLine()\`, \`input()\`, \`cin >>\`, \`scanf\`, \`getline\`, \`readline\`), populate \`stdinConsumed\`:
     * \`token\`: exact token read (e.g. \`"25"\`, \`"*"\`, \`"5"\`)
     * \`targetVar\`: variable storing it (e.g. \`"num1"\`)
     * \`targetType\`: declared type (e.g. \`"double"\`)
     * \`bufferIndex\`: 0-based index of the consumed token
     * \`remainingTokens\`: array of unconsumed tokens remaining in the queue after this step
   - **CONDITION & SWITCH/CASE EVALUATION**: On every \`if\`, \`else if\`, \`else\`, \`switch\`, ternary, or loop condition step, populate \`conditionEval\`:
     * \`expression\`: exact condition or switch expression with real values substituted if helpful (e.g. \`"switch (operator) [operator = '*']"\` or \`"num2 != 0 [5.0 != 0]"\`)
     * \`result\`: boolean \`true\`/\`false\` or matched switch value (as string/boolean)
     * \`kind\`: \`"if" | "else_if" | "else" | "switch" | "loop" | "ternary"\`
     * \`branchTaken\`: e.g. \`"case '*'"\` or \`"if-body"\` or \`"else-body"\`
     * \`casesChecked\`: for \`switch\` or chained \`if/else-if\`, array of checks e.g. \`[{"label":"case '+'","matched":false},{"label":"case '-'","matched":false},{"label":"case '*'","matched":true}]\`
   - **LOOP TRACKING**: On loop steps, populate \`loopInfo\`: \`{ "iteration": 1, "conditionText": "i < 5 (0 < 5 -> true)", "continuing": true }\`.
   - **ANIMATION ACTION & BANGLA EXPLANATION**: On EVERY step populate:
     * \`animationAction\`: one of \`"read_stdin" | "declare" | "assign" | "evaluate_condition" | "switch_jump" | "loop_step" | "compute" | "print_output" | "runtime_error" | "close_resource"\`
     * \`banglaExplanation\`: clear conversational Bangla explanation of what this step does and why, referencing exact variable/STDIN values
     * \`stdout\`: exact string printed by THIS step alone (e.g. \`"Enter first number: "\` or \`"Result: 125.0"\`), or \`null\` if nothing printed on this step
     * \`cumulativeOutput\`: total stdout text accumulated from step 1 through this step
   - When GROUND-TRUTH RUNTIME EXECUTION DATA is provided, \`finalOutput\` and computed values MUST align 100% with it.
   - Provide a \`lineNotes\` entry for EVERY meaningful non-empty line in USER CODE with exact 1-based \`line\`, AST \`role\`, specific \`text\`, and logic-building \`why\`.

    - **EXECUTION-AWARE \`lineNotes\` (SKIPPED BRANCHES & BLOCK ENDS)**: Cross-reference every \`lineNotes\` description against the runtime execution \`steps\`:
      * If an \`else\`, \`else if\`, \`elif\`, \`catch\`, \`except\`, \`switch\` case, or statement inside a branch was NOT executed during this run, explicitly state that it was skipped in the current input's execution path while briefly noting its structural role (never describe an unexecuted branch as actively executing).
      * For curly braces (\`}\`) in Java/C++/JavaScript: ONLY say control returns to the outer scope if that specific block was actually entered at runtime. If the block was skipped, describe \`}\` purely structurally (e.g., it marks the end of the skipped \`else\` / \`if\` block). For Python, accurately note when the last line of an executed \`if\`/\`elif\`/\`else\`/\`for\`/\`while\`/\`def\` indentation block finishes and returns control outward.
    - **DYNAMIC TIME & SPACE COMPLEXITY (\`logicSummary.complexity\`)**: Dynamically compute accurate asymptotic complexity for the submitted code (e.g., \`O(1)\` for sequential/conditional code, \`O(n)\` for single loops, \`O(n^2)\` for nested loops, \`O(log n)\` for halving/binary search loops, \`O(n log n)\` for sorting, \`O(2^n)\` for branching recursion; and \`O(1)\` vs \`O(n)\` / \`O(log n)\` / \`O(n^2)\` for auxiliary arrays, maps, or recursion stack space) with a concise explanation in \`note\`.
    - **LANGUAGE-SPECIFIC PITFALLS (\`logicSummary.commonMistakes\`)**: Generate 2-3 natural pitfalls tailored strictly to the active language and constructs actually used in USER CODE (e.g., integer division, \`Scanner\` newline buffer, or \`.equals()\` in Java; uninitialized variables, array bounds, or \`cin\` in C++; \`input()\` string return, \`/\` vs \`//\`, indentation, or mutable defaults in Python; \`==\` vs \`===\`, \`NaN\`, or \`+\` concatenation in JavaScript).

OUTPUT FORMAT:
Return ONLY a valid, raw JSON object strictly following the response schema.`;
function buildUserTracePrompt(params) {
  const numberedLines = params.code.split("\n").map((line, idx) => `${idx + 1} | ${line}`).join("\n");
  const stdinTokens = tokenizeStdin(params.stdin || "");
  let prompt = `Programming Language: ${params.language}
File Name: ${params.fileName || "(unspecified)"}
Explanation Language: ${params.explainLanguage === "bn" ? "bn (Bengali / \u09AC\u09BE\u0982\u09B2\u09BE)" : "en (English)"}
Explanation Depth: ${params.depth}
Standard Input (stdin): ${params.stdin ? JSON.stringify(params.stdin) : "(empty)"}
STDIN Token Queue (FIFO): ${stdinTokens.length > 0 ? JSON.stringify(stdinTokens) : "[] (EMPTY - if code reads STDIN, explain missing input if runtime fails)"}

USER CODE (with 1-based line numbers):
${numberedLines}
`;
  if (params.groundTruthContext) {
    prompt += `
GROUND-TRUTH RUNTIME EXECUTION DATA (Ensure your trace steps, variable values, and finalOutput align 100% with this real execution):
${params.groundTruthContext}
`;
  }
  return prompt;
}

// server/src/tracers/fallbackTracer.ts
import vm2 from "node:vm";

// src/data/sampleTraces.ts
var SWAP_CORRECT_BN_SIMPLE = {
  isValidLogic: true,
  errorDetails: null,
  language: "javascript",
  analogyType: "swap_buckets",
  traceSource: "builtin_verified",
  logicSummary: {
    title: "\u09A6\u09C1\u099F\u09BF \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7\u09B0 \u09AE\u09BE\u09A8 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 (Swap with temp)",
    goal: "`a` \u098F\u09AC\u0982 `b` \u098F\u09B0 \u09AE\u09BE\u09A8 \u09A8\u09BF\u099C\u09C7\u09A6\u09C7\u09B0 \u09AE\u09A7\u09CD\u09AF\u09C7 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 \u0995\u09B0\u09BE\u0964",
    idea: "\u098F\u0995\u099F\u09BF \u0995\u09BE\u09AA \u09A5\u09C7\u0995\u09C7 \u0985\u09A8\u09CD\u09AF \u0995\u09BE\u09AA\u09C7 \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \u09A2\u09BE\u09B2\u09B2\u09C7 \u09AA\u09C1\u09B0\u09A8\u09CB \u09A4\u09B0\u09B2 \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC, \u09A4\u09BE\u0987 \u09AE\u09BE\u099D\u0996\u09BE\u09A8\u09C7 \u098F\u0995\u099F\u09BF \u0996\u09BE\u09B2\u09BF \u0995\u09BE\u09AA (`temp`) \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u0964",
    keyPoints: [
      "\u09AA\u09CD\u09B0\u09A5\u09AE\u09C7 `a`-\u09B0 \u09AE\u09BE\u09A8 `temp` \u0995\u09BE\u09AA\u09C7 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u09C7 \u0995\u09AA\u09BF \u0995\u09B0\u09C7 \u09B0\u09BE\u0996\u09BE \u09B9\u09AF\u09BC",
      "\u098F\u09B0\u09AA\u09B0 `a` \u0995\u09BE\u09AA\u09C7 `b`-\u09B0 \u09AE\u09BE\u09A8 \u09AC\u09B8\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC",
      "\u09B8\u09AC\u09B6\u09C7\u09B7\u09C7 `b` \u0995\u09BE\u09AA\u09C7 `temp`-\u098F \u09B0\u09BE\u0996\u09BE \u09AA\u09C1\u09B0\u09A8\u09CB `a`-\u09B0 \u09AE\u09BE\u09A8 \u09A2\u09C7\u09B2\u09C7 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09AF\u09BC"
    ],
    analogyStory: "\u09A6\u09C1\u099F\u09BF \u0997\u09CD\u09B2\u09BE\u09B8\u09C7\u09B0 \u09B6\u09B0\u09AC\u09A4 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 \u0995\u09B0\u09A4\u09C7 \u099A\u09BE\u0987\u09B2\u09C7 \u09A4\u09C3\u09A4\u09C0\u09AF\u09BC \u098F\u0995\u099F\u09BF \u0996\u09BE\u09B2\u09BF \u0997\u09CD\u09B2\u09BE\u09B8 (`temp`) \u09B2\u09BE\u0997\u09C7, \u09AF\u09BE\u09A4\u09C7 \u0995\u09CB\u09A8\u09CB \u09B6\u09B0\u09AC\u09A4 \u0989\u09AA\u099A\u09C7 \u09A8\u09B7\u09CD\u099F \u09A8\u09BE \u09B9\u09AF\u09BC\u0964",
    complexity: {
      time: "O(1)",
      space: "O(1)",
      note: "\u09AE\u09BE\u09A4\u09CD\u09B0 \u09A4\u09BF\u09A8\u099F\u09BF \u09A8\u09BF\u09B0\u09CD\u09A6\u09BF\u09B7\u09CD\u099F \u09A7\u09BE\u09AA \u09B2\u09BE\u0997\u09C7, \u09A4\u09BE\u0987 \u09B8\u0982\u0996\u09CD\u09AF\u09BE \u09AF\u09A4 \u09AC\u09A1\u09BC\u0987 \u09B9\u09CB\u0995 \u09B8\u09AE\u09AF\u09BC \u098F\u0995\u0987 \u09A5\u09BE\u0995\u09C7\u0964"
    },
    commonMistakes: [
      "`temp` \u099B\u09BE\u09A1\u09BC\u09BE \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF `a = b; b = a;` \u09B2\u09BF\u0996\u09B2\u09C7 `a`-\u09B0 \u0986\u09B8\u09B2 \u09AE\u09BE\u09A8 \u099A\u09BF\u09B0\u09A4\u09B0\u09C7 \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC",
      "`temp = b` \u0986\u0997\u09C7 \u09B2\u09BF\u0996\u09C7 \u09AB\u09C7\u09B2\u09BE \u09AC\u09BE \u09AD\u09C1\u09B2 \u0995\u09CD\u09B0\u09AE\u09C7 \u09AE\u09BE\u09A8 \u09AC\u09B8\u09BE\u09A8\u09CB"
    ]
  },
  lineNotes: [
    { line: 1, role: "declare", text: "`a` \u09A8\u09BE\u09AE\u09C7 \u098F\u0995\u099F\u09BF \u09A8\u09A4\u09C1\u09A8 \u0995\u09BE\u09AA \u09A8\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09B2\u09CB \u098F\u09AC\u0982 \u09A4\u09BE\u09A4\u09C7 `5` \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964" },
    { line: 2, role: "declare", text: "`b` \u09A8\u09BE\u09AE\u09C7 \u0986\u09B0\u09C7\u0995\u099F\u09BF \u0995\u09BE\u09AA \u09A8\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09B2\u09CB \u098F\u09AC\u0982 \u09A4\u09BE\u09A4\u09C7 `10` \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964" },
    { line: 3, role: "assign", text: "`temp` \u09A8\u09BE\u09AE\u09C7 \u098F\u0995\u099F\u09BF \u09A8\u09A4\u09C1\u09A8 \u0996\u09BE\u09B2\u09BF \u0995\u09BE\u09AA \u09A8\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09B2\u09CB \u098F\u09AC\u0982 `a`-\u09B0 \u09AE\u09BE\u09A8 (`5`) \u098F\u09B0 \u098F\u0995\u099F\u09BF \u0995\u09AA\u09BF \u09A4\u09BE\u09A4\u09C7 \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964 \u098F\u0996\u09A8 `5` \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u09C7 `temp`-\u098F \u099C\u09AE\u09BE \u0986\u099B\u09C7\u0964" },
    { line: 4, role: "assign", text: "`a` \u0995\u09BE\u09AA\u09C7\u09B0 \u09AA\u09C1\u09B0\u09A8\u09CB \u09AE\u09BE\u09A8 \u09B8\u09B0\u09BF\u09AF\u09BC\u09C7 `b` \u0995\u09BE\u09AA\u09C7\u09B0 \u09AE\u09BE\u09A8 (`10`) \u09AC\u09B8\u09BE\u09A8\u09CB \u09B9\u09B2\u09CB\u0964 \u0986\u0997\u09C7\u09B0 `5` \u09B9\u09BE\u09B0\u09BE\u09AF\u09BC\u09A8\u09BF, \u0995\u09BE\u09B0\u09A3 \u09B8\u09C7\u099F\u09BE `temp`-\u098F \u0986\u099B\u09C7\u0964" },
    { line: 5, role: "assign", text: "`b` \u0995\u09BE\u09AA\u09C7 `temp` \u0995\u09BE\u09AA\u09C7\u09B0 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09BF\u09A4 \u09AE\u09BE\u09A8 (`5`) \u09A2\u09C7\u09B2\u09C7 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09B2\u09CB\u0964 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 \u09B8\u09AE\u09CD\u09AA\u09C2\u09B0\u09CD\u09A3!" },
    { line: 6, role: "output", text: "\u09AA\u09B0\u09CD\u09A6\u09BE\u09AF\u09BC \u09A8\u09A4\u09C1\u09A8 \u09AE\u09BE\u09A8 `a: 10 b: 5` \u09AA\u09CD\u09B0\u09BF\u09A8\u09CD\u099F \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964" }
  ],
  steps: [
    {
      stepIndex: 1,
      activeLine: 1,
      analogyType: "swap_buckets",
      action: "declare",
      from: null,
      to: "a",
      explanation: "`a` \u0995\u09BE\u09AA\u09C7 `5` \u09AE\u09BE\u09A8\u099F\u09BF \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964",
      why: "\u09AA\u09CD\u09B0\u09A5\u09AE \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 (variable) \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09C7 \u09A4\u09BE\u09B0 \u09AA\u09CD\u09B0\u09BE\u09A5\u09AE\u09BF\u0995 \u09AE\u09BE\u09A8 \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09A6\u09B0\u0995\u09BE\u09B0\u0964",
      changes: [{ name: "a", from: null, to: 5 }],
      variables: { a: 5 },
      fault: null,
      structure: null
    },
    {
      stepIndex: 2,
      activeLine: 2,
      analogyType: "swap_buckets",
      action: "declare",
      from: null,
      to: "b",
      explanation: "`b` \u0995\u09BE\u09AA\u09C7 `10` \u09AE\u09BE\u09A8\u099F\u09BF \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964",
      why: "\u09A6\u09CD\u09AC\u09BF\u09A4\u09C0\u09AF\u09BC \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09C7 \u09A4\u09BE\u09B0 \u09AA\u09CD\u09B0\u09BE\u09A5\u09AE\u09BF\u0995 \u09AE\u09BE\u09A8 \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964",
      changes: [{ name: "b", from: null, to: 10 }],
      variables: { a: 5, b: 10 },
      fault: null,
      structure: null
    },
    {
      stepIndex: 3,
      activeLine: 3,
      analogyType: "swap_buckets",
      action: "transfer",
      from: "a",
      to: "temp",
      explanation: "`temp` \u09A8\u09BE\u09AE\u09C7 \u09A8\u09A4\u09C1\u09A8 \u0995\u09BE\u09AA\u09C7 `a`-\u09B0 \u09AE\u09BE\u09A8 (`5`) \u098F\u09B0 \u098F\u0995\u099F\u09BF \u0995\u09AA\u09BF \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964",
      why: "\u09AA\u09B0\u09C7\u09B0 \u09B2\u09BE\u0987\u09A8\u09C7 `a`-\u09B0 \u09AE\u09BE\u09A8 \u09AC\u09A6\u09B2\u09C7 \u09AF\u09BE\u09AC\u09C7, \u09A4\u09BE\u0987 \u09AA\u09C1\u09B0\u09A8\u09CB `5` \u09AC\u09BE\u0981\u099A\u09BF\u09AF\u09BC\u09C7 \u09B0\u09BE\u0996\u09A4\u09C7 `temp` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964",
      changes: [{ name: "temp", from: null, to: 5 }],
      variables: { a: 5, b: 10, temp: 5 },
      fault: null,
      structure: null
    },
    {
      stepIndex: 4,
      activeLine: 4,
      analogyType: "swap_buckets",
      action: "transfer",
      from: "b",
      to: "a",
      explanation: "`b` \u0995\u09BE\u09AA\u09C7\u09B0 \u09AE\u09BE\u09A8 (`10`) \u0995\u09AA\u09BF \u0995\u09B0\u09C7 `a` \u0995\u09BE\u09AA\u09C7 \u09AC\u09B8\u09BE\u09A8\u09CB \u09B9\u09B2\u09CB\u0964",
      why: "`a`-\u09A4\u09C7 \u098F\u0996\u09A8 `b`-\u09B0 \u09AE\u09BE\u09A8 \u09A6\u09B0\u0995\u09BE\u09B0; \u0986\u09B0 `a`-\u09B0 \u09AA\u09C1\u09B0\u09A8\u09CB `5` \u09A4\u09CB `temp`-\u098F \u09B8\u09C1\u09B0\u0995\u09CD\u09B7\u09BF\u09A4 \u0986\u099B\u09C7\u0987\u0964",
      changes: [{ name: "a", from: 5, to: 10 }],
      variables: { a: 10, b: 10, temp: 5 },
      fault: null,
      structure: null
    },
    {
      stepIndex: 5,
      activeLine: 5,
      analogyType: "swap_buckets",
      action: "transfer",
      from: "temp",
      to: "b",
      explanation: "`temp` \u0995\u09BE\u09AA \u09A5\u09C7\u0995\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09BF\u09A4 `5` \u09AE\u09BE\u09A8\u099F\u09BF `b` \u0995\u09BE\u09AA\u09C7 \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964",
      why: "`b`-\u09A4\u09C7 `a`-\u09B0 \u0986\u09A6\u09BF \u09AE\u09BE\u09A8 (`5`) \u09AC\u09B8\u09BE\u09A8\u09CB\u09B0 \u09AE\u09BE\u09A7\u09CD\u09AF\u09AE\u09C7 \u09B8\u09CB\u09AF\u09BC\u09BE\u09AA (swap) \u0995\u09BE\u099C\u099F\u09BF \u09B6\u09C7\u09B7 \u09B9\u09B2\u09CB\u0964",
      changes: [{ name: "b", from: 10, to: 5 }],
      variables: { a: 10, b: 5, temp: 5 },
      fault: null,
      structure: null
    },
    {
      stepIndex: 6,
      activeLine: 6,
      analogyType: "swap_buckets",
      action: "declare",
      from: null,
      to: null,
      explanation: "\u099A\u09C2\u09A1\u09BC\u09BE\u09A8\u09CD\u09A4 \u09AB\u09B2\u09BE\u09AB\u09B2 `a: 10 b: 5` \u0986\u0989\u099F\u09AA\u09C1\u099F\u09C7 \u09A6\u09C7\u0996\u09BE\u09A8\u09CB \u09B9\u09B2\u09CB\u0964",
      why: "\u0985\u09A6\u09B2\u09AC\u09A6\u09B2 \u09A0\u09BF\u0995\u09AE\u09A4\u09CB \u0995\u09BE\u099C \u0995\u09B0\u09C7\u099B\u09C7 \u0995\u09BF \u09A8\u09BE \u09A4\u09BE \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09AA\u09CD\u09B0\u09BF\u09A8\u09CD\u099F \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964",
      changes: [],
      variables: { a: 10, b: 5, temp: 5 },
      fault: null,
      structure: null
    }
  ],
  finalOutput: "a: 10 b: 5",
  outputExplanation: "\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u09B6\u09C7\u09B7\u09C7 `a`-\u09A4\u09C7 `10` \u0986\u09B0 `b`-\u09A4\u09C7 `5` \u0986\u099B\u09C7, \u0995\u09BE\u09B0\u09A3 \u09E9 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09B2\u09BE\u0987\u09A8\u09C7 `temp`-\u098F `5` \u09AC\u09BE\u0981\u099A\u09BF\u09AF\u09BC\u09C7 \u09B0\u09BE\u0996\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09BF\u09B2, \u09EA \u09A8\u09AE\u09CD\u09AC\u09B0 \u09B2\u09BE\u0987\u09A8\u09C7 `a` \u09AA\u09C7\u09AF\u09BC\u09C7\u099B\u09C7 `b`-\u09B0 \u09AE\u09BE\u09A8 (`10`), \u0986\u09B0 \u09EB \u09A8\u09AE\u09CD\u09AC\u09B0 \u09B2\u09BE\u0987\u09A8\u09C7 `b` \u09AA\u09C7\u09AF\u09BC\u09C7\u099B\u09C7 `temp`-\u098F \u09B0\u09BE\u0996\u09BE \u09AA\u09C1\u09B0\u09A8\u09CB `a`-\u09B0 \u09AE\u09BE\u09A8 (`5`)\u0964",
  verdict: {
    status: "ok",
    message: "\u0985\u09A6\u09B2\u09AC\u09A6\u09B2 (Swap) \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964"
  }
};
var SWAP_CORRECT_EN_SIMPLE = {
  ...SWAP_CORRECT_BN_SIMPLE,
  logicSummary: {
    title: "Swapping Two Variables with Temp",
    goal: "Exchange the values stored inside `a` and `b`.",
    idea: "Pouring directly from one full cup into another overwrites the old liquid, so we use an empty third cup (`temp`) to hold the original value safely.",
    keyPoints: [
      "Save the original value of `a` inside `temp` first",
      "Copy the value of `b` into `a`",
      "Copy the saved value from `temp` into `b`"
    ],
    analogyStory: "To swap juice between two full glasses without spilling, you pour one glass into a spare empty glass (`temp`) first.",
    complexity: {
      time: "O(1)",
      space: "O(1)",
      note: "Always takes exactly 3 assignment operations regardless of value size."
    },
    commonMistakes: [
      "Writing `a = b; b = a;` without `temp` overwrites `a` and loses `5` forever",
      "Overwriting `temp` before copying `a` into it"
    ]
  },
  lineNotes: [
    { line: 1, role: "declare", text: "Create cup `a` and fill it with value `5`." },
    { line: 2, role: "declare", text: "Create cup `b` and fill it with value `10`." },
    { line: 3, role: "assign", text: "Create a spare cup `temp` and copy `a` (`5`) into it so `5` is safely backed up." },
    { line: 4, role: "assign", text: "Replace `a` with `b` (`10`). The original `5` is safe inside `temp`." },
    { line: 5, role: "assign", text: "Pour the saved `5` from `temp` into `b`. The swap is complete!" },
    { line: 6, role: "output", text: "Print the final swapped result `a: 10 b: 5`." }
  ],
  steps: SWAP_CORRECT_BN_SIMPLE.steps.map((s, idx) => {
    const enExplanations = [
      { explanation: "Cup `a` is created and filled with `5`.", why: "Initialize the first variable before swapping." },
      { explanation: "Cup `b` is created and filled with `10`.", why: "Initialize the second variable before swapping." },
      { explanation: "Copy `a` (`5`) into the spare cup `temp`.", why: "Line 4 will overwrite `a`, so we must preserve `5` in `temp` first." },
      { explanation: "Copy `b` (`10`) into cup `a`.", why: "`a` now receives `b`'s value while `5` remains safe inside `temp`." },
      { explanation: "Copy `temp` (`5`) into cup `b`.", why: "Complete the swap by giving `b` the saved original value of `a`." },
      { explanation: "Print `a: 10 b: 5` to the output terminal.", why: "Display the verified swapped values." }
    ];
    return {
      ...s,
      explanation: enExplanations[idx].explanation,
      why: enExplanations[idx].why
    };
  }),
  outputExplanation: "At the end of the program `a` holds `10` and `b` holds `5` because line 3 backed up `5` in `temp`, line 4 copied `10` into `a`, and line 5 restored `5` from `temp` into `b`.",
  verdict: {
    status: "ok",
    message: "Swap completed cleanly with zero data loss."
  }
};
var SWAP_FAULTY_BN_SIMPLE = {
  isValidLogic: false,
  errorDetails: {
    line: 3,
    message: "\u09EB (5) \u09AE\u09BE\u09A8\u099F\u09BF \u09B9\u09BE\u09B0\u09BF\u09DF\u09C7 \u0997\u09C7\u099B\u09C7 \u0995\u09BE\u09B0\u09A3 temp \u099B\u09BE\u09DC\u09BE\u0987 a-\u09A4\u09C7 b-\u098F\u09B0 \u09AE\u09BE\u09A8 \u09AC\u09B8\u09BE\u09A8\u09CB \u09B9\u09DF\u09C7\u099B\u09C7\u0964"
  },
  language: "javascript",
  analogyType: "swap_buckets",
  traceSource: "builtin_verified",
  logicSummary: {
    title: "\u09AD\u09C1\u09B2 \u09B8\u09CB\u09AF\u09BC\u09BE\u09AA: temp \u099B\u09BE\u09A1\u09BC\u09BE \u09AE\u09BE\u09A8 \u09B9\u09BE\u09B0\u09BE\u09A8\u09CB (Lost Value Fault)",
    goal: "`a` \u098F\u09AC\u0982 `b` \u098F\u09B0 \u09AE\u09BE\u09A8 \u09AC\u09A6\u09B2\u09BE\u09A8\u09CB\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7, \u0995\u09BF\u09A8\u09CD\u09A4\u09C1 \u09B2\u099C\u09BF\u0995\u09C7 \u09AD\u09C1\u09B2 \u0986\u099B\u09C7\u0964",
    idea: "\u0996\u09BE\u09B2\u09BF \u0995\u09BE\u09AA (`temp`) \u099B\u09BE\u09A1\u09BC\u09BE \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF `a = b` \u09B2\u09BF\u0996\u09B2\u09C7 `a` \u0995\u09BE\u09AA\u09C7\u09B0 \u09AA\u09C1\u09B0\u09A8\u09CB \u09A4\u09B0\u09B2 (`5`) \u0989\u09AA\u099A\u09C7 \u09AA\u09A1\u09BC\u09C7 \u099A\u09BF\u09B0\u09A4\u09B0\u09C7 \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC\u0964",
    keyPoints: [
      "\u09E9 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09B2\u09BE\u0987\u09A8\u09C7 `a = b` \u09B2\u09C7\u0996\u09BE\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09B8\u09BE\u09A5\u09C7 `a`-\u09B0 \u0986\u0997\u09C7\u09B0 \u09AE\u09BE\u09A8 `5` \u09AE\u09C1\u099B\u09C7 `10` \u09B9\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC",
      "\u09EA \u09A8\u09AE\u09CD\u09AC\u09B0 \u09B2\u09BE\u0987\u09A8\u09C7 `b = a` \u09B2\u09C7\u0996\u09BE\u09B0 \u09B8\u09AE\u09AF\u09BC `a`-\u09A4\u09C7\u0993 `10` \u0986\u099B\u09C7, \u09A4\u09BE\u0987 `b`-\u09A4\u09C7\u0993 `10` \u09AC\u09B8\u09C7",
      "\u09AB\u09B2\u09C7 \u09A6\u09C1\u099F\u09BF \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7\u0987 `10` \u09A5\u09C7\u0995\u09C7 \u09AF\u09BE\u09AF\u09BC \u098F\u09AC\u0982 `5` \u099A\u09BF\u09B0\u09A4\u09B0\u09C7 \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC"
    ],
    analogyStory: "\u09AD\u09B0\u09BE \u0997\u09CD\u09B2\u09BE\u09B8\u09C7 \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \u0986\u09B0\u09C7\u0995 \u0997\u09CD\u09B2\u09BE\u09B8\u09C7\u09B0 \u09AA\u09BE\u09A8\u09BF \u09A2\u09BE\u09B2\u09B2\u09C7 \u0986\u0997\u09C7\u09B0 \u09AA\u09BE\u09A8\u09BF \u09AE\u09C7\u099D\u09C7\u09A4\u09C7 \u0989\u09AA\u099A\u09C7 \u09AA\u09A1\u09BC\u09C7 \u09A8\u09B7\u09CD\u099F \u09B9\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC\u0964",
    complexity: {
      time: "O(1)",
      space: "O(1)",
      note: "\u09A7\u09BE\u09AA \u0995\u09AE \u09B9\u09B2\u09C7\u0993 \u098F\u099F\u09BF \u09AD\u09C1\u09B2 \u0986\u0989\u099F\u09AA\u09C1\u099F \u09A6\u09C7\u09AF\u09BC \u0995\u09BE\u09B0\u09A3 \u09A1\u09C7\u099F\u09BE \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC\u0964"
    },
    commonMistakes: [
      "\u0995\u0996\u09A8\u09CB\u0987 `temp` \u099B\u09BE\u09A1\u09BC\u09BE `a = b; b = a;` \u09B2\u09BF\u0996\u09C7 \u09B8\u09CB\u09AF\u09BC\u09BE\u09AA \u0995\u09B0\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE"
    ]
  },
  lineNotes: [
    { line: 1, role: "declare", text: "`a` \u0995\u09BE\u09AA\u09C7 `5` \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964" },
    { line: 2, role: "declare", text: "`b` \u0995\u09BE\u09AA\u09C7 `10` \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964" },
    { line: 3, role: "assign", text: "\u09B8\u09A4\u09B0\u09CD\u0995\u09A4\u09BE! `a`-\u09B0 \u09AE\u09BE\u09A8 \u0995\u09CB\u09A5\u09BE\u0993 \u09A8\u09BE \u09B0\u09C7\u0996\u09C7\u0987 \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF `a = b` \u09B2\u09C7\u0996\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 \u2014 \u09AB\u09B2\u09C7 `5` \u0989\u09AA\u099A\u09C7 \u09AA\u09A1\u09BC\u09C7 \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u0997\u09C7\u09B2!" },
    { line: 4, role: "assign", text: "`b = a` \u09A6\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09B2\u09CB, \u0995\u09BF\u09A8\u09CD\u09A4\u09C1 `a`-\u09A4\u09C7 \u09A4\u09CB \u0986\u0997\u09C7\u0987 `10` \u09AC\u09B8\u09C7 \u0997\u09C7\u099B\u09C7! \u09A4\u09BE\u0987 `b`-\u0993 `10` \u09AA\u09C7\u09B2\u0964" },
    { line: 5, role: "output", text: "\u09AD\u09C1\u09B2 \u0986\u0989\u099F\u09AA\u09C1\u099F `a: 10 b: 10` \u09AA\u09CD\u09B0\u09BF\u09A8\u09CD\u099F \u09B9\u09B2\u09CB (`5` \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u0997\u09C7\u099B\u09C7)\u0964" }
  ],
  steps: [
    {
      stepIndex: 1,
      activeLine: 1,
      analogyType: "swap_buckets",
      action: "declare",
      from: null,
      to: "a",
      explanation: "`a` \u0995\u09BE\u09AA\u09C7 `5` \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964",
      why: "\u09AA\u09CD\u09B0\u09A5\u09AE \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 `a` \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964",
      changes: [{ name: "a", from: null, to: 5 }],
      variables: { a: 5 },
      fault: null,
      structure: null
    },
    {
      stepIndex: 2,
      activeLine: 2,
      analogyType: "swap_buckets",
      action: "declare",
      from: null,
      to: "b",
      explanation: "`b` \u0995\u09BE\u09AA\u09C7 `10` \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964",
      why: "\u09A6\u09CD\u09AC\u09BF\u09A4\u09C0\u09AF\u09BC \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 `b` \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964",
      changes: [{ name: "b", from: null, to: 10 }],
      variables: { a: 5, b: 10 },
      fault: null,
      structure: null
    },
    {
      stepIndex: 3,
      activeLine: 3,
      analogyType: "swap_buckets",
      action: "halt",
      from: "b",
      to: "a",
      explanation: "`a = b` \u099A\u09BE\u09B2\u09BE\u09A8\u09CB\u09B0 \u09AB\u09B2\u09C7 `a` \u0995\u09BE\u09AA\u09C7\u09B0 `5` \u0989\u09AA\u099A\u09C7 \u09AA\u09A1\u09BC\u09C7 \u09A8\u09B7\u09CD\u099F \u09B9\u09AF\u09BC\u09C7 \u0997\u09C7\u09B2 \u098F\u09AC\u0982 \u09A4\u09BE\u09B0 \u099C\u09BE\u09AF\u09BC\u0997\u09BE\u09AF\u09BC `10` \u09AC\u09B8\u09C7 \u0997\u09C7\u09B2!",
      why: "`a`-\u09B0 \u09AA\u09C1\u09B0\u09A8\u09CB \u09AE\u09BE\u09A8 `5` \u0995\u09CB\u09A8\u09CB `temp` \u0995\u09BE\u09AA\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u09A8\u09BE \u0995\u09B0\u09C7\u0987 \u09A8\u09A4\u09C1\u09A8 \u09AE\u09BE\u09A8 \u09A2\u09BE\u09B2\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
      changes: [{ name: "a", from: 5, to: 10 }],
      variables: { a: 10, b: 10 },
      fault: {
        type: "lost_value",
        message: "5 \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u0997\u09C7\u099B\u09C7, \u0995\u09BE\u09B0\u09A3 a = b \u09B2\u09C7\u0996\u09BE\u09B0 \u0986\u0997\u09C7 a-\u09B0 \u09AE\u09BE\u09A8 \u0995\u09CB\u09A5\u09BE\u0993 \u09B0\u09BE\u0996\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964",
        fixHint: "a = b \u098F\u09B0 \u0986\u0997\u09C7 let temp = a; \u09B2\u09BF\u0996\u09C1\u09A8 \u098F\u09AC\u0982 \u09B6\u09C7\u09B7\u09C7 b = temp; \u09A6\u09BF\u09A8\u0964",
        target: "a",
        lostValue: 5
      },
      structure: null
    }
  ],
  finalOutput: "a: 10 b: 10",
  outputExplanation: "\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u09B6\u09C7\u09B7\u09C7 `a` \u098F\u09AC\u0982 `b` \u09A6\u09C1\u099F\u09CB\u09A4\u09C7\u0987 `10` \u09A6\u09C7\u0996\u09BE\u099A\u09CD\u099B\u09C7 \u0995\u09BE\u09B0\u09A3 \u09E9 \u09A8\u09AE\u09CD\u09AC\u09B0 \u09B2\u09BE\u0987\u09A8\u09C7 `a = b` \u09B2\u09C7\u0996\u09BE\u09B0 \u09AB\u09B2\u09C7 `a`-\u09B0 \u0986\u09A6\u09BF \u09AE\u09BE\u09A8 `5` \u09AE\u09C1\u099B\u09C7 \u0997\u09BF\u09AF\u09BC\u09C7\u099B\u09BF\u09B2\u0964",
  verdict: {
    status: "logic_error",
    message: "\u09B2\u099C\u09BF\u0995 \u09AD\u09C1\u09B2: 5 \u09AE\u09BE\u09A8\u099F\u09BF \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u0997\u09C7\u099B\u09C7 (Lost Value Fault)\u0964"
  }
};
var SWAP_FAULTY_EN_SIMPLE = {
  ...SWAP_FAULTY_BN_SIMPLE,
  errorDetails: {
    line: 3,
    message: "Value 5 was overwritten and lost because no temp variable was used before a = b."
  },
  logicSummary: {
    title: "Broken Swap: Overwriting Without Temp",
    goal: "Attempt to swap `a` and `b` directly without a temporary variable.",
    idea: "Pouring `b` directly into `a` spills the original liquid (`5`) out of cup `a` forever.",
    keyPoints: [
      "Line 3 (`a = b`) overwrites `a` (`5`) with `10` immediately",
      "The original value `5` is not stored anywhere in memory",
      "Both `a` and `b` end up holding `10`"
    ],
    analogyStory: "Pouring a full cup of orange juice into a full cup of water spills the water onto the floor.",
    complexity: {
      time: "O(1)",
      space: "O(1)",
      note: "Executes in constant time, but produces an incorrect result due to data loss."
    },
    commonMistakes: [
      "Assigning `a = b` before saving `a` into `temp`"
    ]
  },
  lineNotes: [
    { line: 1, role: "declare", text: "Create cup `a` with value `5`." },
    { line: 2, role: "declare", text: "Create cup `b` with value `10`." },
    { line: 3, role: "assign", text: "FAULT! `a = b` overwrites `5` with `10` without saving `5` first \u2014 `5` splashes out and is lost!" },
    { line: 4, role: "assign", text: "`b = a` copies `10` into `b` because `a` is already `10`." },
    { line: 5, role: "output", text: "Outputs wrong result `a: 10 b: 10` (`5` was lost)." }
  ],
  steps: [
    {
      ...SWAP_FAULTY_BN_SIMPLE.steps[0],
      explanation: "Create cup `a` with initial value `5`.",
      why: "Set up the first variable."
    },
    {
      ...SWAP_FAULTY_BN_SIMPLE.steps[1],
      explanation: "Create cup `b` with initial value `10`.",
      why: "Set up the second variable."
    },
    {
      ...SWAP_FAULTY_BN_SIMPLE.steps[2],
      explanation: "Executing `a = b` overwrites cup `a` (`5`) with `10` \u2014 `5` splashes out and is lost forever!",
      why: "No `temp` variable held `a`'s original value before assignment.",
      fault: {
        type: "lost_value",
        message: "Value 5 was lost because `a` was overwritten before saving its value.",
        fixHint: "Write `let temp = a;` before `a = b;`, then set `b = temp;`.",
        target: "a",
        lostValue: 5
      }
    }
  ],
  outputExplanation: "Both `a` and `b` print `10` because line 3 destroyed `5` before line 4 could copy it into `b`.",
  verdict: {
    status: "logic_error",
    message: "Logic Fault: Value 5 was overwritten and lost."
  }
};
var BUBBLE_SORT_BN_SIMPLE = {
  isValidLogic: true,
  errorDetails: null,
  language: "javascript",
  analogyType: "sort_blocks",
  traceSource: "builtin_verified",
  logicSummary: {
    title: "\u09AC\u09BE\u09AC\u09B2 \u09B8\u09B0\u09CD\u099F (Bubble Sort) \u2014 \u099B\u09CB\u099F \u09A5\u09C7\u0995\u09C7 \u09AC\u09A1\u09BC \u09B8\u09BE\u099C\u09BE\u09A8\u09CB",
    goal: "`[5, 2, 8, 1, 4]` \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u099F\u09BF\u0995\u09C7 \u099B\u09CB\u099F \u09A5\u09C7\u0995\u09C7 \u09AC\u09A1\u09BC \u0995\u09CD\u09B0\u09AE\u09C7 `[1, 2, 4, 5, 8]` \u09B9\u09BF\u09B8\u09C7\u09AC\u09C7 \u09B8\u09BE\u099C\u09BE\u09A8\u09CB\u0964",
    idea: "\u09AA\u09BE\u09B6\u09BE\u09AA\u09BE\u09B6\u09BF \u09A6\u09C1\u099F\u09BF \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u0989\u099A\u09CD\u099A\u09A4\u09BE \u09A4\u09C1\u09B2\u09A8\u09BE (compare) \u0995\u09B0\u09C7 \u09AC\u09BE\u09AE \u09AA\u09BE\u09B6\u09C7\u09B0 \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09AC\u09A1\u09BC \u09B9\u09B2\u09C7 \u09A4\u09BE\u09A6\u09C7\u09B0 \u099C\u09BE\u09AF\u09BC\u0997\u09BE \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 (swap) \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u0964 \u09AA\u09CD\u09B0\u09A4\u09BF \u09AA\u09BE\u09B8\u09C7 \u09B8\u09AC\u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09A1\u09BC \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09A1\u09BE\u09A8 \u09AA\u09CD\u09B0\u09BE\u09A8\u09CD\u09A4\u09C7 \u0997\u09BF\u09AF\u09BC\u09C7 \u09A8\u09BF\u099C\u09C7\u09B0 \u09B8\u09CD\u09A5\u09BE\u09AF\u09BC\u09C0 \u099C\u09BE\u09AF\u09BC\u0997\u09BE\u09AF\u09BC \u09AC\u09B8\u09C7\u0964",
    keyPoints: [
      "\u09AA\u09BE\u09B6\u09BE\u09AA\u09BE\u09B6\u09BF \u09A6\u09C1\u099F\u09BF \u09AC\u09CD\u09B2\u0995 `arr[j]` \u098F\u09AC\u0982 `arr[j+1]` \u09A4\u09C1\u09B2\u09A8\u09BE \u0995\u09B0\u09BE \u09B9\u09AF\u09BC",
      "\u09AC\u09BE\u09AE \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09AC\u09A1\u09BC \u09B9\u09B2\u09C7 (`arr[j] > arr[j+1]`) \u09A4\u09BE\u09B0\u09BE \u09AC\u09BE\u0981\u0995\u09BE \u09AA\u09A5\u09C7 \u099C\u09BE\u09AF\u09BC\u0997\u09BE \u09AC\u09A6\u09B2 \u0995\u09B0\u09C7",
      "\u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u09AA\u09C2\u09B0\u09CD\u09A3 \u09A7\u09BE\u09AA \u09B6\u09C7\u09B7\u09C7 \u09A1\u09BE\u09A8\u09A6\u09BF\u0995\u09C7\u09B0 \u098F\u0995\u099F\u09BF \u0995\u09B0\u09C7 \u09AC\u09CD\u09B2\u0995 \u09B8\u09AC\u09C1\u099C (sorted) \u09B9\u09AF\u09BC\u09C7 \u09B8\u09CD\u09A5\u09BF\u09B0 \u09B9\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC"
    ],
    analogyStory: "\u09AA\u09BE\u09A8\u09BF\u09B0 \u09A8\u09BF\u099A \u09A5\u09C7\u0995\u09C7 \u09AC\u09A1\u09BC \u09AC\u09C1\u09A6\u09AC\u09C1\u09A6 \u09AF\u09C7\u09AE\u09A8 \u09B8\u09AC\u09BE\u09B0 \u0986\u0997\u09C7 \u0989\u09AA\u09B0\u09C7 \u09AD\u09C7\u09B8\u09C7 \u0993\u09A0\u09C7, \u09A4\u09C7\u09AE\u09A8\u09BF \u09B8\u09AC\u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09A1\u09BC \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09AA\u09CD\u09B0\u09A4\u09BF \u09A7\u09BE\u09AA\u09C7 \u09A1\u09BE\u09A8 \u09AA\u09CD\u09B0\u09BE\u09A8\u09CD\u09A4\u09C7 \u099A\u09B2\u09C7 \u09AF\u09BE\u09AF\u09BC\u0964",
    complexity: {
      time: "O(n\xB2)",
      space: "O(1)",
      note: "\u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u0989\u09AA\u09BE\u09A6\u09BE\u09A8\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u09B2\u09C1\u09AA \u0986\u09AC\u09BE\u09B0 \u099A\u09B2\u09C7, \u0995\u09BF\u09A8\u09CD\u09A4\u09C1 \u09A8\u09A4\u09C1\u09A8 \u0995\u09CB\u09A8\u09CB \u0985\u09A4\u09BF\u09B0\u09BF\u0995\u09CD\u09A4 \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 \u09B2\u09BE\u0997\u09C7 \u09A8\u09BE\u0964"
    },
    commonMistakes: [
      "\u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u09B2\u09C1\u09AA\u09C7 `n - 1 - i` \u098F\u09B0 \u09AC\u09A6\u09B2\u09C7 `n` \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u099A\u09BE\u09B2\u09BE\u09B2\u09C7 `arr[j+1]` \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u09B0 \u09AC\u09BE\u0987\u09B0\u09C7 \u099A\u09B2\u09C7 \u09AF\u09BE\u09AF\u09BC (Index Out of Bounds)",
      "\u09B8\u09CB\u09AF\u09BC\u09BE\u09AA \u0995\u09B0\u09BE\u09B0 \u09B8\u09AE\u09AF\u09BC `temp` \u09A8\u09BE \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE"
    ]
  },
  lineNotes: [
    { line: 1, role: "declare", text: "`arr` \u09A8\u09BE\u09AE\u09C7\u09B0 \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u09A4\u09C7 (array) `[5, 2, 8, 1, 4]` \u098F\u0987 \u09EB\u099F\u09BF \u09AC\u09CD\u09B2\u0995 \u09B8\u09BE\u099C\u09BE\u09A8\u09CB \u09B9\u09B2\u09CB\u0964" },
    { line: 2, role: "loop", text: "\u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u09B2\u09C1\u09AA (outer loop): \u09AE\u09CB\u099F \u0995\u09AF\u09BC\u099F\u09BF \u09AA\u09BE\u09B8 (pass) \u099A\u09B2\u09AC\u09C7 \u09A4\u09BE `i` \u09A6\u09BF\u09AF\u09BC\u09C7 \u0997\u09CB\u09A8\u09BE \u09B9\u099A\u09CD\u099B\u09C7\u0964" },
    { line: 3, role: "loop", text: "\u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u09B2\u09C1\u09AA (inner loop): `j` \u09AA\u09AF\u09BC\u09C7\u09A8\u09CD\u099F\u09BE\u09B0 \u09AC\u09BE\u09AE \u09A6\u09BF\u0995 \u09A5\u09C7\u0995\u09C7 \u09AA\u09BE\u09B6\u09BE\u09AA\u09BE\u09B6\u09BF \u09A6\u09C1\u099F\u09BF \u09AC\u09CD\u09B2\u0995 \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE \u0995\u09B0\u099B\u09C7\u0964" },
    { line: 4, role: "condition", text: "\u09A4\u09C1\u09B2\u09A8\u09BE: \u09AC\u09BE\u09AE \u09AC\u09CD\u09B2\u0995 `arr[j]` \u0995\u09BF \u09A1\u09BE\u09A8 \u09AC\u09CD\u09B2\u0995 `arr[j+1]` \u098F\u09B0 \u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09A1\u09BC?" },
    { line: 5, role: "assign", text: "\u09B9\u09CD\u09AF\u09BE\u0981 \u09AC\u09A1\u09BC! \u09A4\u09BE\u0987 `arr[j]` \u098F\u09AC\u0982 `arr[j+1]` \u09AC\u09CD\u09B2\u0995 \u09A6\u09C1\u099F\u09BF \u09A8\u09BF\u099C\u09C7\u09A6\u09C7\u09B0 \u099C\u09BE\u09AF\u09BC\u0997\u09BE \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 (swap) \u0995\u09B0\u09B2\u0964" },
    { line: 6, role: "block_end", text: "\u09A4\u09C1\u09B2\u09A8\u09BE \u0993 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 \u09B6\u09C7\u09B7\u0964" },
    { line: 7, role: "block_end", text: "\u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u09B2\u09C1\u09AA\u09C7\u09B0 \u098F\u0995 \u09AA\u09BE\u09B8 \u09B6\u09C7\u09B7; \u09B8\u09AC\u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09A1\u09BC \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09A1\u09BE\u09A8 \u09AA\u09CD\u09B0\u09BE\u09A8\u09CD\u09A4\u09C7 \u09B8\u09CD\u09A5\u09BE\u09AF\u09BC\u09C0 \u09B9\u09B2\u09CB\u0964" },
    { line: 8, role: "output", text: "\u09B8\u09BE\u099C\u09BE\u09A8\u09CB \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 `[1, 2, 4, 5, 8]` \u09AA\u09CD\u09B0\u09BF\u09A8\u09CD\u099F \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964" }
  ],
  steps: [
    {
      stepIndex: 1,
      activeLine: 1,
      analogyType: "sort_blocks",
      action: "declare",
      explanation: "`arr` \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u09A4\u09C7 `[5, 2, 8, 1, 4]` \u09AE\u09BE\u09A8\u09C7\u09B0 \u09EB\u099F\u09BF \u09AC\u09CD\u09B2\u0995 \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964",
      why: "\u09B8\u09BE\u099C\u09BE\u09A8\u09CB\u09B0 \u099C\u09A8\u09CD\u09AF \u0985\u0997\u09CB\u099B\u09BE\u09B2\u09CB \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u0997\u09C1\u09B2\u09CB \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09A4\u09C7 \u09A8\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09B2\u09CB\u0964",
      changes: [{ name: "arr", from: null, to: "[5, 2, 8, 1, 4]" }],
      variables: { arr: [5, 2, 8, 1, 4], i: 0, j: 0 },
      fault: null,
      structure: { kind: "array", values: [5, 2, 8, 1, 4], highlight: [], sortedFrom: 5, pointers: { i: 0, j: 0 } }
    },
    {
      stepIndex: 2,
      activeLine: 4,
      analogyType: "sort_blocks",
      action: "compare",
      explanation: "\u09AA\u09CD\u09B0\u09A5\u09AE \u09A6\u09C1\u099F\u09BF \u09AC\u09CD\u09B2\u0995 `5` \u098F\u09AC\u0982 `2` \u09A4\u09C1\u09B2\u09A8\u09BE \u0995\u09B0\u09BE \u09B9\u099A\u09CD\u099B\u09C7 (`5 > 2` \u09B8\u09A4\u09CD\u09AF)\u0964",
      why: "\u09AC\u09BE\u09AE \u09A6\u09BF\u0995\u09C7\u09B0 `5` \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09A1\u09BE\u09A8 \u09A6\u09BF\u0995\u09C7\u09B0 `2` \u098F\u09B0 \u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09A1\u09BC \u0995\u09BF \u09A8\u09BE \u09A4\u09BE \u09A6\u09C7\u0996\u09BE \u09B9\u099A\u09CD\u099B\u09C7\u0964",
      changes: [],
      variables: { arr: [5, 2, 8, 1, 4], i: 0, j: 0 },
      fault: null,
      structure: { kind: "array", values: [5, 2, 8, 1, 4], highlight: [0, 1], sortedFrom: 5, pointers: { i: 0, j: 0 } }
    },
    {
      stepIndex: 3,
      activeLine: 5,
      analogyType: "sort_blocks",
      action: "swap",
      explanation: "`5` \u098F\u09AC\u0982 `2` \u09AC\u09CD\u09B2\u0995 \u09A6\u09C1\u099F\u09BF \u09AC\u09BE\u0981\u0995\u09BE \u09AA\u09A5\u09C7 \u09A8\u09BF\u099C\u09C7\u09A6\u09C7\u09B0 \u099C\u09BE\u09AF\u09BC\u0997\u09BE \u09AC\u09A6\u09B2 \u0995\u09B0\u09B2\u0964",
      why: "\u099B\u09CB\u099F \u09B8\u0982\u0996\u09CD\u09AF\u09BE `2`-\u0995\u09C7 \u09AC\u09BE\u09AE\u09C7 \u098F\u09AC\u0982 \u09AC\u09A1\u09BC \u09B8\u0982\u0996\u09CD\u09AF\u09BE `5`-\u0995\u09C7 \u09A1\u09BE\u09A8\u09C7 \u09AA\u09BE\u09A0\u09BE\u09A8\u09CB \u09B9\u09B2\u09CB\u0964",
      changes: [{ name: "arr[0..1]", from: "5, 2", to: "2, 5" }],
      variables: { arr: [2, 5, 8, 1, 4], i: 0, j: 0 },
      fault: null,
      structure: { kind: "array", values: [2, 5, 8, 1, 4], highlight: [0, 1], swapping: [0, 1], sortedFrom: 5, pointers: { i: 0, j: 0 } }
    },
    {
      stepIndex: 4,
      activeLine: 4,
      analogyType: "sort_blocks",
      action: "compare",
      explanation: "`j = 1`: \u098F\u09AC\u09BE\u09B0 `5` \u098F\u09AC\u0982 `8` \u09A4\u09C1\u09B2\u09A8\u09BE \u0995\u09B0\u09BE \u09B9\u099A\u09CD\u099B\u09C7 (`5 > 8` \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE)\u0964",
      why: "`5` \u0986\u0997\u09C7\u0987 `8` \u098F\u09B0 \u099A\u09C7\u09AF\u09BC\u09C7 \u099B\u09CB\u099F, \u09A4\u09BE\u0987 \u098F\u0996\u09BE\u09A8\u09C7 \u09B8\u09CB\u09AF\u09BC\u09BE\u09AA \u0995\u09B0\u09BE\u09B0 \u09A6\u09B0\u0995\u09BE\u09B0 \u09A8\u09C7\u0987\u0964",
      changes: [{ name: "j", from: 0, to: 1 }],
      variables: { arr: [2, 5, 8, 1, 4], i: 0, j: 1 },
      fault: null,
      structure: { kind: "array", values: [2, 5, 8, 1, 4], highlight: [1, 2], sortedFrom: 5, pointers: { i: 0, j: 1 } }
    },
    {
      stepIndex: 5,
      activeLine: 5,
      analogyType: "sort_blocks",
      action: "swap",
      explanation: "`j = 2`: `8` \u098F\u09AC\u0982 `1` \u09A4\u09C1\u09B2\u09A8\u09BE \u0995\u09B0\u09C7 \u099C\u09BE\u09AF\u09BC\u0997\u09BE \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB (`8 > 1`)\u0964",
      why: "`8` \u0985\u09A8\u09C7\u0995 \u09AC\u09A1\u09BC, \u09A4\u09BE\u0987 \u09B8\u09C7\u099F\u09BF\u0995\u09C7 \u09A1\u09BE\u09A8\u09C7 \u09B8\u09B0\u09BF\u09AF\u09BC\u09C7 `1`-\u0995\u09C7 \u09AC\u09BE\u09AE\u09C7 \u0986\u09A8\u09BE \u09B9\u09B2\u09CB\u0964",
      changes: [{ name: "arr[2..3]", from: "8, 1", to: "1, 8" }],
      variables: { arr: [2, 5, 1, 8, 4], i: 0, j: 2 },
      fault: null,
      structure: { kind: "array", values: [2, 5, 1, 8, 4], highlight: [2, 3], swapping: [2, 3], sortedFrom: 5, pointers: { i: 0, j: 2 } }
    },
    {
      stepIndex: 6,
      activeLine: 5,
      analogyType: "sort_blocks",
      action: "swap",
      explanation: "`j = 3`: `8` \u098F\u09AC\u0982 `4` \u099C\u09BE\u09AF\u09BC\u0997\u09BE \u09AC\u09A6\u09B2 \u0995\u09B0\u09B2\u0964 \u09AA\u09CD\u09B0\u09A5\u09AE \u09AA\u09BE\u09B8 \u09B6\u09C7\u09B7\u09C7 `8` \u09B8\u09AC\u09BE\u09B0 \u09B6\u09C7\u09B7\u09C7 \u09B8\u09CD\u09A5\u09BF\u09B0 \u09B9\u09B2\u09CB!",
      why: "\u09B8\u09AC\u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09A1\u09BC \u09AC\u09CD\u09B2\u0995 `8` \u098F\u0996\u09A8 \u09A8\u09BF\u099C\u09C7\u09B0 \u099A\u09C2\u09A1\u09BC\u09BE\u09A8\u09CD\u09A4 \u099C\u09BE\u09AF\u09BC\u0997\u09BE\u09AF\u09BC \u09AA\u09CC\u0981\u099B\u09C7 \u09B8\u09AC\u09C1\u099C (sorted) \u09B9\u09AF\u09BC\u09C7 \u0997\u09C7\u099B\u09C7\u0964",
      changes: [{ name: "arr[3..4]", from: "8, 4", to: "4, 8" }],
      variables: { arr: [2, 5, 1, 4, 8], i: 0, j: 3 },
      fault: null,
      structure: { kind: "array", values: [2, 5, 1, 4, 8], highlight: [3, 4], swapping: [3, 4], sortedFrom: 4, pointers: { i: 0, j: 3 } }
    },
    {
      stepIndex: 7,
      activeLine: 5,
      analogyType: "sort_blocks",
      action: "swap",
      explanation: "\u09A6\u09CD\u09AC\u09BF\u09A4\u09C0\u09AF\u09BC \u09AA\u09BE\u09B8\u09C7 (`i = 1`): `5` \u098F\u0995\u09C7 \u098F\u0995\u09C7 `1` \u0993 `4`-\u098F\u09B0 \u09B8\u09BE\u09A5\u09C7 \u099C\u09BE\u09AF\u09BC\u0997\u09BE \u09AC\u09A6\u09B2\u09C7 \u09EA\u09B0\u09CD\u09A5 \u09B8\u09CD\u09A5\u09BE\u09A8\u09C7 \u09B8\u09CD\u09A5\u09BF\u09B0 \u09B9\u09B2\u09CB\u0964",
      why: "\u09AC\u09BE\u0995\u09BF \u09AC\u09CD\u09B2\u0995\u0997\u09C1\u09B2\u09CB\u09B0 \u09AE\u09A7\u09CD\u09AF\u09C7 `5` \u09B8\u09AC\u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09A1\u09BC, \u09A4\u09BE\u0987 \u098F\u099F\u09BF `8`-\u098F\u09B0 \u09A0\u09BF\u0995 \u09AC\u09BE\u09AE\u09C7 \u09AC\u09B8\u09C7 \u0997\u09C7\u09B2\u0964",
      changes: [{ name: "arr", from: "[2, 5, 1, 4, 8]", to: "[2, 1, 4, 5, 8]" }],
      variables: { arr: [2, 1, 4, 5, 8], i: 1, j: 2 },
      fault: null,
      structure: { kind: "array", values: [2, 1, 4, 5, 8], highlight: [2, 3], swapping: [2, 3], sortedFrom: 3, pointers: { i: 1, j: 2 } }
    },
    {
      stepIndex: 8,
      activeLine: 5,
      analogyType: "sort_blocks",
      action: "swap",
      explanation: "\u09A4\u09C3\u09A4\u09C0\u09AF\u09BC \u09AA\u09BE\u09B8\u09C7 (`i = 2`): `2` \u098F\u09AC\u0982 `1` \u099C\u09BE\u09AF\u09BC\u0997\u09BE \u09AC\u09A6\u09B2 \u0995\u09B0\u09B2, \u09AB\u09B2\u09C7 \u09AA\u09C1\u09B0\u09CB \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 \u09B8\u09BE\u099C\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7 \u0997\u09C7\u09B2!",
      why: "`1` \u09B8\u09AC\u09BE\u09B0 \u09AC\u09BE\u09AE\u09C7 \u099A\u09B2\u09C7 \u0986\u09B8\u09BE\u09AF\u09BC `[1, 2, 4, 5, 8]` \u0995\u09CD\u09B0\u09AE\u099F\u09BF \u09AA\u09C2\u09B0\u09CD\u09A3 \u09B9\u09B2\u09CB\u0964",
      changes: [{ name: "arr[0..1]", from: "2, 1", to: "1, 2" }],
      variables: { arr: [1, 2, 4, 5, 8], i: 2, j: 0 },
      fault: null,
      structure: { kind: "array", values: [1, 2, 4, 5, 8], highlight: [0, 1], swapping: [0, 1], sortedFrom: 0, pointers: { i: 2, j: 0 } }
    },
    {
      stepIndex: 9,
      activeLine: 8,
      analogyType: "sort_blocks",
      action: "declare",
      explanation: "\u09B8\u09AC\u0997\u09C1\u09B2\u09CB \u09AC\u09CD\u09B2\u0995 \u099B\u09CB\u099F \u09A5\u09C7\u0995\u09C7 \u09AC\u09A1\u09BC \u0995\u09CD\u09B0\u09AE\u09C7 \u09B8\u09BE\u099C\u09BE\u09A8\u09CB \u09B6\u09C7\u09B7: `[1, 2, 4, 5, 8]`\u0964",
      why: "\u099A\u09C2\u09A1\u09BC\u09BE\u09A8\u09CD\u09A4 \u09B8\u09BE\u099C\u09BE\u09A8\u09CB \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u099F\u09BF \u0986\u0989\u099F\u09AA\u09C1\u099F\u09C7 \u09AA\u09CD\u09B0\u09BF\u09A8\u09CD\u099F \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964",
      changes: [],
      variables: { arr: [1, 2, 4, 5, 8], i: 3, j: 0 },
      fault: null,
      structure: { kind: "array", values: [1, 2, 4, 5, 8], highlight: [], sortedFrom: 0, pointers: {} }
    }
  ],
  finalOutput: "[1, 2, 4, 5, 8]",
  outputExplanation: "\u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u09AA\u09BE\u09B8\u09C7 \u09B8\u09AC\u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09A1\u09BC \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u099F\u09BF (`8`, \u09A4\u09BE\u09B0\u09AA\u09B0 `5`, \u09A4\u09BE\u09B0\u09AA\u09B0 `4`, \u09A4\u09BE\u09B0\u09AA\u09B0 `2`) \u09A1\u09BE\u09A8 \u09A6\u09BF\u0995\u09C7 \u09B8\u09B0\u09C7 \u0997\u09C7\u099B\u09C7, \u09A4\u09BE\u0987 \u09B6\u09C7\u09B7\u09C7 `[1, 2, 4, 5, 8]` \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u0997\u09C7\u099B\u09C7\u0964",
  verdict: {
    status: "ok",
    message: "\u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u099F\u09BF \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u099B\u09CB\u099F \u09A5\u09C7\u0995\u09C7 \u09AC\u09A1\u09BC \u0995\u09CD\u09B0\u09AE\u09C7 \u09B8\u09BE\u099C\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964"
  }
};
var BUBBLE_SORT_EN_SIMPLE = {
  ...BUBBLE_SORT_BN_SIMPLE,
  logicSummary: {
    title: "Bubble Sort \u2014 Ascending Order",
    goal: "Sort `[5, 2, 8, 1, 4]` into ascending order `[1, 2, 4, 5, 8]`.",
    idea: "Compare adjacent blocks and swap them along curved arcs whenever the left block is taller than the right block. After each pass, the largest remaining block locks into the right tail.",
    keyPoints: [
      "Compare adjacent pair `arr[j]` and `arr[j+1]`",
      "If `arr[j] > arr[j+1]`, swap the two blocks along over/under arcs",
      "Each completed pass locks one more sorted block in mint green at the end"
    ],
    analogyStory: "Like air bubbles rising to the top of a tank, the largest numbers bubble up to the right end of the array one by one.",
    complexity: {
      time: "O(n\xB2)",
      space: "O(1)",
      note: "Nested loops compare pairs across passes, sorting in-place with no extra array."
    },
    commonMistakes: [
      "Looping `j` up to `n` instead of `n - 1 - i` causes out-of-bounds access on `arr[j+1]`"
    ]
  },
  lineNotes: [
    { line: 1, role: "declare", text: "Initialize array `arr` with 5 unsorted blocks `[5, 2, 8, 1, 4]`." },
    { line: 2, role: "loop", text: "Outer loop `i` tracks how many passes have completed." },
    { line: 3, role: "loop", text: "Inner loop `j` scans adjacent block pairs from left to right." },
    { line: 4, role: "condition", text: "Compare whether left block `arr[j]` is greater than right block `arr[j+1]`." },
    { line: 5, role: "assign", text: "Swap `arr[j]` and `arr[j+1]` along curved paths so the smaller block moves left." },
    { line: 6, role: "block_end", text: "End of comparison block." },
    { line: 7, role: "block_end", text: "End of pass; the largest block in this pass is now locked in mint green." },
    { line: 8, role: "output", text: "Print the sorted array `[1, 2, 4, 5, 8]`." }
  ],
  steps: BUBBLE_SORT_BN_SIMPLE.steps.map((s, idx) => {
    const enSteps = [
      { explanation: "Create array `arr` with blocks `[5, 2, 8, 1, 4]`.", why: "Load the initial unsorted numbers into memory." },
      { explanation: "Compare `5` and `2` (`5 > 2` is true).", why: "Check if the first pair is out of order." },
      { explanation: "Swap `5` and `2` along over/under arcs.", why: "Move smaller value `2` before `5`." },
      { explanation: "Compare `5` and `8` (`5 > 8` is false).", why: "Pair is already in order; no swap needed." },
      { explanation: "Compare `8` and `1`, then swap them.", why: "`8` is larger than `1`, so `8` moves right." },
      { explanation: "Swap `8` and `4`. Pass 1 finishes and locks `8` in mint green!", why: "The largest element `8` has reached its final sorted index." },
      { explanation: "Pass 2 (`i = 1`): `5` swaps past `1` and `4`, locking into index 3.", why: "`5` is the next largest value and settles before `8`." },
      { explanation: "Pass 3 (`i = 2`): Swap `2` and `1`. All blocks are now sorted!", why: "`1` moves to index 0, completing `[1, 2, 4, 5, 8]`." },
      { explanation: "Output the final sorted array `[1, 2, 4, 5, 8]`.", why: "All passes are complete." }
    ];
    return {
      ...s,
      explanation: enSteps[idx].explanation,
      why: enSteps[idx].why
    };
  }),
  outputExplanation: "Each pass bubbled the largest remaining number to the right end (`8`, then `5`, then `4`, then `2`), resulting in `[1, 2, 4, 5, 8]`.",
  verdict: {
    status: "ok",
    message: "Array sorted in ascending order `[1, 2, 4, 5, 8]`."
  }
};
var INFINITE_LOOP_BN_SIMPLE = {
  isValidLogic: false,
  errorDetails: {
    line: 3,
    message: "\u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA (Infinite Loop): \u09B2\u09C1\u09AA\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 i-\u098F\u09B0 \u09AE\u09BE\u09A8 \u0995\u0996\u09A8\u09CB \u09AC\u09BE\u09DC\u09BE\u09A8\u09CB \u09B9\u09DF\u09A8\u09BF (i++ \u09A8\u09C7\u0987)\u0964"
  },
  language: "javascript",
  analogyType: "loop_gauge",
  traceSource: "builtin_verified",
  logicSummary: {
    title: "\u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA: i++ \u09A6\u09BF\u09A4\u09C7 \u09AD\u09C1\u09B2\u09C7 \u09AF\u09BE\u0993\u09AF\u09BC\u09BE (Missing Increment Fault)",
    goal: "`0` \u09A5\u09C7\u0995\u09C7 `4` \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u0997\u09C1\u09B2\u09CB\u09B0 \u09AF\u09CB\u0997\u09AB\u09B2 \u09AC\u09C7\u09B0 \u0995\u09B0\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
    idea: "\u09B2\u09C1\u09AA\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 `i < 5` \u09A6\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7, \u0995\u09BF\u09A8\u09CD\u09A4\u09C1 \u09B2\u09C1\u09AA\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 `i`-\u098F\u09B0 \u09AE\u09BE\u09A8 \u09AC\u09BE\u09A1\u09BC\u09BE\u09A8\u09CB\u09B0 (`i++`) \u09B2\u09BE\u0987\u09A8\u099F\u09BF \u09A8\u09C7\u0987\u0964 \u09A4\u09BE\u0987 `i` \u099A\u09BF\u09B0\u0995\u09BE\u09B2 `0`-\u0987 \u09A5\u09C7\u0995\u09C7 \u09AF\u09BE\u09AF\u09BC \u098F\u09AC\u0982 \u099A\u09BE\u0995\u09BE\u099F\u09BF \u09A5\u09BE\u09AE\u09A4\u09C7\u0987 \u09AA\u09BE\u09B0\u09C7 \u09A8\u09BE!",
    keyPoints: [
      "\u09B6\u09C1\u09B0\u09C1\u09A4\u09C7 `i = 0` \u098F\u09AC\u0982 `sum = 0`",
      "\u09AC\u09BE\u09B0\u09AC\u09BE\u09B0 `i < 5` \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE \u0995\u09B0\u09BE \u09B9\u09AF\u09BC, \u0986\u09B0 `0 < 5` \u09B8\u09AC\u09B8\u09AE\u09AF\u09BC\u0987 \u09B8\u09A4\u09CD\u09AF \u09B9\u09AF\u09BC",
      "\u09E9 \u09AC\u09BE\u09B0 \u0998\u09CB\u09B0\u09BE\u09B0 \u09AA\u09B0 \u09B8\u09BF\u09B8\u09CD\u099F\u09C7\u09AE \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u09C7 \u09B2\u09C1\u09AA\u099F\u09BF \u09A5\u09BE\u09AE\u09BF\u09AF\u09BC\u09C7 `infinite_loop` \u09A4\u09CD\u09B0\u09C1\u099F\u09BF \u09A6\u09C7\u0996\u09BE\u09AF\u09BC"
    ],
    analogyStory: "\u09A6\u09CC\u09A1\u09BC\u09C7\u09B0 \u099F\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7 \u09B2\u09CD\u09AF\u09BE\u09AA \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09AF\u09A6\u09BF \u09E6-\u09A4\u09C7\u0987 \u0986\u099F\u0995\u09C7 \u09A5\u09BE\u0995\u09C7, \u09A4\u09AC\u09C7 \u09EB \u09B2\u09CD\u09AF\u09BE\u09AA \u09AA\u09C2\u09B0\u09CD\u09A3 \u0995\u09B0\u09BE\u09B0 \u09B6\u09B0\u09CD\u09A4 \u0995\u09CB\u09A8\u09CB\u09A6\u09BF\u09A8\u0987 \u09AA\u09C2\u09B0\u09A3 \u09B9\u09AC\u09C7 \u09A8\u09BE\u0964",
    complexity: {
      time: "\u221E (Infinite)",
      space: "O(1)",
      note: "`i` \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u09A8\u09BE \u09B9\u0993\u09AF\u09BC\u09BE\u09AF\u09BC \u098F\u0987 \u09B2\u09C1\u09AA\u099F\u09BF \u09A8\u09BF\u099C\u09C7 \u09A5\u09C7\u0995\u09C7 \u0995\u0996\u09A8\u09CB\u0987 \u09B6\u09C7\u09B7 \u09B9\u09AC\u09C7 \u09A8\u09BE\u0964"
    },
    commonMistakes: [
      "`while` \u09B2\u09C1\u09AA\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 (`i++`) \u09AC\u09BE\u09A1\u09BC\u09BE\u09A4\u09C7 \u09AD\u09C1\u09B2\u09C7 \u09AF\u09BE\u0993\u09AF\u09BC\u09BE"
    ]
  },
  lineNotes: [
    { line: 1, role: "declare", text: "`i = 0` \u098F\u09AC\u0982 `sum = 0` \u09A6\u09BF\u09AF\u09BC\u09C7 \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964" },
    { line: 2, role: "loop", text: "\u09B6\u09B0\u09CD\u09A4 \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE: `i < 5` \u0995\u09BF \u09B8\u09A4\u09CD\u09AF? \u09AF\u09C7\u09B9\u09C7\u09A4\u09C1 `i` \u09B8\u09AC\u09B8\u09AE\u09AF\u09BC `0`, \u098F\u099F\u09BF \u099A\u09BF\u09B0\u0995\u09BE\u09B2 \u09B8\u09A4\u09CD\u09AF \u09A5\u09BE\u0995\u09C7!" },
    { line: 3, role: "assign", text: "`sum += i` \u099A\u09B2\u099B\u09C7, \u0995\u09BF\u09A8\u09CD\u09A4\u09C1 `i` \u0995\u0996\u09A8\u09CB \u09AC\u09BE\u09A1\u09BC\u099B\u09C7 \u09A8\u09BE (`i++` \u09A8\u09C7\u0987)!" },
    { line: 4, role: "block_end", text: "\u09B8\u09A4\u09B0\u09CD\u0995\u09A4\u09BE! \u09B2\u09C1\u09AA\u09C7\u09B0 \u09B6\u09C7\u09B7 \u09B2\u09BE\u0987\u09A8\u09C7 `i++` \u09A8\u09BE \u09A5\u09BE\u0995\u09BE\u09AF\u09BC \u0986\u09AC\u09BE\u09B0 `i = 0` \u09A8\u09BF\u09AF\u09BC\u09C7\u0987 \u09B2\u09C1\u09AA \u0998\u09C1\u09B0\u09AC\u09C7\u0964" },
    { line: 5, role: "output", text: "\u098F\u0987 \u09B2\u09BE\u0987\u09A8\u09C7 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u0995\u0996\u09A8\u09CB\u0987 \u09AA\u09CC\u0981\u099B\u09BE\u09A4\u09C7 \u09AA\u09BE\u09B0\u09AC\u09C7 \u09A8\u09BE\u0964" }
  ],
  steps: [
    {
      stepIndex: 1,
      activeLine: 1,
      analogyType: "loop_gauge",
      action: "declare",
      explanation: "`i = 0` \u098F\u09AC\u0982 `sum = 0` \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964",
      why: "\u09B2\u09C1\u09AA \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u0993 \u09AF\u09CB\u0997\u09AB\u09B2 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964",
      changes: [
        { name: "i", from: null, to: 0 },
        { name: "sum", from: null, to: 0 }
      ],
      variables: { i: 0, sum: 0 },
      fault: null,
      structure: { kind: "loop", lap: 0, maxLaps: 3, conditionText: "i < 5 (0 < 5)", unchangedVar: "i" }
    },
    {
      stepIndex: 2,
      activeLine: 2,
      analogyType: "loop_gauge",
      action: "loop_check",
      explanation: "\u09B2\u09CD\u09AF\u09BE\u09AA \u09E7: `i < 5` (`0 < 5`) \u09B8\u09A4\u09CD\u09AF, \u09A4\u09BE\u0987 \u09B2\u09C1\u09AA\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u09AA\u09CD\u09B0\u09AC\u09C7\u09B6 \u0995\u09B0\u09B2\u0964",
      why: "`i`-\u098F\u09B0 \u09AE\u09BE\u09A8 `0`, \u09AF\u09BE `5`-\u098F\u09B0 \u099A\u09C7\u09AF\u09BC\u09C7 \u099B\u09CB\u099F\u0964",
      changes: [],
      variables: { i: 0, sum: 0 },
      fault: null,
      structure: { kind: "loop", lap: 1, maxLaps: 3, conditionText: "i < 5 \u2192 true", unchangedVar: "i" }
    },
    {
      stepIndex: 3,
      activeLine: 3,
      analogyType: "loop_gauge",
      action: "loop_check",
      explanation: "\u09B2\u09CD\u09AF\u09BE\u09AA \u09E8: \u0986\u09AC\u09BE\u09B0 `i = 0` \u09A8\u09BF\u09AF\u09BC\u09C7\u0987 \u09B2\u09C1\u09AA \u0998\u09C1\u09B0\u099B\u09C7 \u0995\u09BE\u09B0\u09A3 `i` \u09AC\u09BE\u09A1\u09BC\u09C7\u09A8\u09BF!",
      why: "\u09B2\u09C1\u09AA\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 `i++` \u09A8\u09BE \u09A5\u09BE\u0995\u09BE\u09AF\u09BC `i`-\u098F\u09B0 \u09AE\u09BE\u09A8 `0`-\u09A4\u09C7\u0987 \u0986\u099F\u0995\u09C7 \u0986\u099B\u09C7\u0964",
      changes: [],
      variables: { i: 0, sum: 0 },
      fault: null,
      structure: { kind: "loop", lap: 2, maxLaps: 3, conditionText: "i < 5 \u2192 true (stuck)", unchangedVar: "i" }
    },
    {
      stepIndex: 4,
      activeLine: 3,
      analogyType: "loop_gauge",
      action: "halt",
      explanation: "\u09B2\u09CD\u09AF\u09BE\u09AA \u09E9: `i` \u098F\u0996\u09A8\u09CB `0`! \u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA (Infinite Loop) \u09B6\u09A8\u09BE\u0995\u09CD\u09A4 \u0995\u09B0\u09C7 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u09A5\u09BE\u09AE\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
      why: "`i` \u0995\u0996\u09A8\u09CB\u0987 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u09B9\u099A\u09CD\u099B\u09C7 \u09A8\u09BE, \u09A4\u09BE\u0987 `i < 5` \u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u0995\u09CB\u09A8\u09CB\u09A6\u09BF\u09A8 \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE \u09B9\u09AC\u09C7 \u09A8\u09BE\u0964",
      changes: [],
      variables: { i: 0, sum: 0 },
      fault: {
        type: "infinite_loop",
        message: "\u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA! \u09E9 \u09AC\u09BE\u09B0 \u0998\u09CB\u09B0\u09BE\u09B0 \u09AA\u09B0\u09C7\u0993 i-\u098F\u09B0 \u09AE\u09BE\u09A8 0 \u09A5\u09C7\u0995\u09C7 \u09AC\u09A6\u09B2\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
        fixHint: "sum += i; \u09B2\u09BE\u0987\u09A8\u09C7\u09B0 \u09A8\u09BF\u099A\u09C7 i++; \u09AF\u09CB\u0997 \u0995\u09B0\u09C1\u09A8 \u09AF\u09BE\u09A4\u09C7 \u09AA\u09CD\u09B0\u09A4\u09BF \u09A7\u09BE\u09AA\u09C7 i \u098F\u0995 \u0995\u09B0\u09C7 \u09AC\u09BE\u09A1\u09BC\u09C7\u0964",
        target: "i"
      },
      structure: { kind: "loop", lap: 3, maxLaps: 3, conditionText: "STOP: i never changes", unchangedVar: "i" }
    }
  ],
  finalOutput: "HALTED: Infinite Loop (i stuck at 0)",
  outputExplanation: "\u09B2\u09C1\u09AA\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 `i++` \u09A8\u09BE \u09A5\u09BE\u0995\u09BE\u09AF\u09BC `i`-\u098F\u09B0 \u09AE\u09BE\u09A8 `0`-\u09A4\u09C7\u0987 \u0986\u099F\u0995\u09C7 \u099B\u09BF\u09B2\u0964 \u09E9 \u09B2\u09CD\u09AF\u09BE\u09AA \u09AA\u09B0\u09C7\u0993 `i` \u09A8\u09BE \u09AC\u09A6\u09B2\u09BE\u09A8\u09CB\u09AF\u09BC \u09B2\u099C\u09BF\u0995 \u09B2\u09CD\u09AF\u09BE\u09AC \u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA\u099F\u09BF \u09A5\u09BE\u09AE\u09BF\u09AF\u09BC\u09C7 \u09A6\u09BF\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
  verdict: {
    status: "infinite_loop",
    message: "\u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA \u09B6\u09A8\u09BE\u0995\u09CD\u09A4 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7: \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 i \u0995\u0996\u09A8\u09CB\u0987 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09BF\u09A4 \u09B9\u09AF\u09BC\u09A8\u09BF\u0964"
  }
};
var INFINITE_LOOP_EN_SIMPLE = {
  ...INFINITE_LOOP_BN_SIMPLE,
  errorDetails: {
    line: 3,
    message: "Infinite Loop: Loop counter `i` is never incremented inside the while loop."
  },
  logicSummary: {
    title: "Infinite Loop: Missing Increment (i++)",
    goal: "Attempt to sum numbers while `i < 5`.",
    idea: "The loop checks `i < 5`, but nothing inside the loop ever changes `i`. Since `i` stays `0` forever, `0 < 5` never becomes false.",
    keyPoints: [
      "`i` starts at `0` and `sum` starts at `0`",
      "Every lap checks `0 < 5`, which is permanently true",
      "After 3 laps with no change to `i`, Logic Lab halts the runaway loop"
    ],
    analogyStory: "Running on a track where the lap counter is broken at 0 means you can never reach lap 5.",
    complexity: {
      time: "\u221E (Infinite)",
      space: "O(1)",
      note: "Never terminates because the loop condition variable `i` is invariant."
    },
    commonMistakes: [
      "Forgetting `i++` at the end of a `while` loop body"
    ]
  },
  lineNotes: [
    { line: 1, role: "declare", text: "Initialize `i = 0` and `sum = 0`." },
    { line: 2, role: "loop", text: "Check `i < 5`. Because `i` stays `0`, this condition is always true!" },
    { line: 3, role: "assign", text: "Add `i` (`0`) to `sum`, but never increment `i`!" },
    { line: 4, role: "block_end", text: "FAULT! Loop repeats without changing `i`." },
    { line: 5, role: "output", text: "Unreachable line \u2014 execution is trapped in the loop above." }
  ],
  steps: [
    {
      ...INFINITE_LOOP_BN_SIMPLE.steps[0],
      explanation: "Initialize `i = 0` and `sum = 0`.",
      why: "Set starting values before entering the loop."
    },
    {
      ...INFINITE_LOOP_BN_SIMPLE.steps[1],
      explanation: "Lap 1: `i < 5` (`0 < 5`) is true, so the loop body runs.",
      why: "`i` is `0`, which satisfies `i < 5`."
    },
    {
      ...INFINITE_LOOP_BN_SIMPLE.steps[2],
      explanation: "Lap 2: Loop runs again with `i = 0` because `i` was never incremented!",
      why: "Missing `i++` leaves `i` stuck at `0`."
    },
    {
      ...INFINITE_LOOP_BN_SIMPLE.steps[3],
      explanation: "Lap 3: `i` is still `0`! Halted runaway infinite loop.",
      why: "Variable `i` never changes across iterations.",
      fault: {
        type: "infinite_loop",
        message: "Infinite loop halted after 3 laps: variable `i` never changed from 0.",
        fixHint: "Add `i++;` after `sum += i;` so the loop progresses toward `i = 5`.",
        target: "i"
      }
    }
  ],
  outputExplanation: "Because `i++` was omitted inside the `while` block, `i` remained `0` on every lap and line 5 was never reached.",
  verdict: {
    status: "infinite_loop",
    message: "Infinite Loop Halted: variable `i` never changed."
  }
};
function makeDetailedTrace(trace, lang) {
  return {
    ...trace,
    steps: trace.steps.map((step) => ({
      ...step,
      why: lang === "bn" ? `${step.why} [\u09AE\u09C7\u09AE\u09CB\u09B0\u09BF \u09AC\u09BF\u09B6\u09CD\u09B2\u09C7\u09B7\u09A3: \u09A7\u09BE\u09AA #${step.stepIndex}-\u098F \u09B2\u09BE\u0987\u09A8 ${step.activeLine} \uC2E4\uD589\u09C7\u09B0 \u09AA\u09B0 \u09B8\u0995\u09CD\u09B0\u09BF\u09AF\u09BC \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u0985\u09AC\u09B8\u09CD\u09A5\u09BE = ${JSON.stringify(step.variables)}]` : `${step.why} [Memory view: after step #${step.stepIndex} at line ${step.activeLine}, state = ${JSON.stringify(step.variables)}]`
    }))
  };
}
var SAMPLE_PROGRAMS = [
  {
    id: "swap_correct",
    title_bn: "\u09A6\u09C1\u099F\u09BF \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 (Swap)",
    title_en: "Swap Two Variables (Temp Cup)",
    subtitle_bn: "\u09E9\u099F\u09BF \u0995\u09BE\u09AA \u0993 \u09A4\u09B0\u09B2 \u09A2\u09BE\u09B2\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u09A8\u09BF\u09AE\u09C7\u09B6\u09A8",
    subtitle_en: "3 glass cups with liquid pouring stream",
    topic: "Variables & Memory",
    difficulty: "easy",
    analogyType: "swap_buckets",
    breadcrumbName: "swapWithTemp",
    codes: {
      javascript: `let a = 5;
let b = 10;
let temp = a;
a = b;
b = temp;
console.log("a:", a, "b:", b);`,
      python: `a = 5
b = 10
temp = a
a = b
b = temp
print("a:", a, "b:", b)`,
      cpp: `int a = 5;
int b = 10;
int temp = a;
a = b;
b = temp;
cout << "a: " << a << " b: " << b;`,
      java: `int a = 5;
int b = 10;
int temp = a;
a = b;
b = temp;
System.out.println("a: " + a + " b: " + b);`
    },
    traces: {
      bn: {
        simple: SWAP_CORRECT_BN_SIMPLE,
        detailed: makeDetailedTrace(SWAP_CORRECT_BN_SIMPLE, "bn")
      },
      en: {
        simple: SWAP_CORRECT_EN_SIMPLE,
        detailed: makeDetailedTrace(SWAP_CORRECT_EN_SIMPLE, "en")
      }
    }
  },
  {
    id: "swap_faulty",
    title_bn: "\u09AD\u09C1\u09B2 \u09B8\u09CB\u09AF\u09BC\u09BE\u09AA (temp \u099B\u09BE\u09A1\u09BC\u09BE \u09AE\u09BE\u09A8 \u09B9\u09BE\u09B0\u09BE\u09A8\u09CB)",
    title_en: "Faulty Swap (No Temp Spill)",
    subtitle_bn: "\u09A4\u09B0\u09B2 \u0989\u09AA\u099A\u09C7 \u09AA\u09A1\u09BC\u09BE \u0993 Lost Value \u09A4\u09CD\u09B0\u09C1\u099F\u09BF",
    subtitle_en: "Liquid splash particles & lost value fault",
    topic: "Common Bugs",
    difficulty: "easy",
    analogyType: "swap_buckets",
    isFaultySample: true,
    breadcrumbName: "brokenSwap",
    codes: {
      javascript: `let a = 5;
let b = 10;
a = b;
b = a;
console.log("a:", a, "b:", b);`,
      python: `a = 5
b = 10
a = b
b = a
print("a:", a, "b:", b)`,
      cpp: `int a = 5;
int b = 10;
a = b;
b = a;
cout << "a: " << a << " b: " << b;`,
      java: `int a = 5;
int b = 10;
a = b;
b = a;
System.out.println("a: " + a + " b: " + b);`
    },
    traces: {
      bn: {
        simple: SWAP_FAULTY_BN_SIMPLE,
        detailed: makeDetailedTrace(SWAP_FAULTY_BN_SIMPLE, "bn")
      },
      en: {
        simple: SWAP_FAULTY_EN_SIMPLE,
        detailed: makeDetailedTrace(SWAP_FAULTY_EN_SIMPLE, "en")
      }
    }
  },
  {
    id: "bubble_sort",
    title_bn: "\u09AC\u09BE\u09AC\u09B2 \u09B8\u09B0\u09CD\u099F (Bubble Sort)",
    title_en: "Bubble Sort `[5, 2, 8, 1, 4]`",
    subtitle_bn: "\u09AC\u09BE\u0981\u0995\u09BE \u09AA\u09A5\u09C7 \u09AC\u09CD\u09B2\u0995 \u09B8\u09CB\u09AF\u09BC\u09BE\u09AA \u0993 \u09B8\u09AC\u09C1\u099C \u09B8\u09B0\u09CD\u099F\u09C7\u09A1 \u099F\u09C7\u0987\u09B2",
    subtitle_en: "Arc block swaps & mint sorted wave",
    topic: "Sorting",
    difficulty: "medium",
    analogyType: "sort_blocks",
    breadcrumbName: "bubbleSort",
    codes: {
      javascript: `let arr = [5, 2, 8, 1, 4];
for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
    }
  }
}
console.log(arr);`,
      python: `arr = [5, 2, 8, 1, 4]
for i in range(4):
    for j in range(4 - i):
        if arr[j] > arr[j + 1]:
            arr[j], arr[j + 1] = arr[j + 1], arr[j]
# pass complete
# all passes done
print(arr)`,
      cpp: `int arr[] = {5, 2, 8, 1, 4};
for (int i = 0; i < 4; i++) {
  for (int j = 0; j < 4 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      swap(arr[j], arr[j + 1]);
    }
  }
}
// output [1, 2, 4, 5, 8]`,
      java: `int[] arr = {5, 2, 8, 1, 4};
for (int i = 0; i < 4; i++) {
  for (int j = 0; j < 4 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      int t = arr[j]; arr[j] = arr[j+1]; arr[j+1] = t;
    }
  }
}
System.out.println(Arrays.toString(arr));`
    },
    traces: {
      bn: {
        simple: BUBBLE_SORT_BN_SIMPLE,
        detailed: makeDetailedTrace(BUBBLE_SORT_BN_SIMPLE, "bn")
      },
      en: {
        simple: BUBBLE_SORT_EN_SIMPLE,
        detailed: makeDetailedTrace(BUBBLE_SORT_EN_SIMPLE, "en")
      }
    }
  },
  {
    id: "infinite_loop",
    title_bn: "\u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA (Missing i++ Bug)",
    title_en: "Missing-Increment Loop (`while`)",
    subtitle_bn: "\u09E9 \u09B2\u09CD\u09AF\u09BE\u09AA \u09AA\u09B0\u09C7 \u09B2\u09C1\u09AA \u09A5\u09BE\u09AE\u09BE\u09A8\u09CB \u0993 \u09A4\u09CD\u09B0\u09C1\u099F\u09BF \u09A8\u09BF\u09B0\u09CD\u09A6\u09C7\u09B6\u09A8\u09BE",
    subtitle_en: "Halts after 3 laps with STOP fault banner",
    topic: "Loops & Control Flow",
    difficulty: "easy",
    analogyType: "loop_gauge",
    isFaultySample: true,
    breadcrumbName: "stuckWhileLoop",
    codes: {
      javascript: `let i = 0, sum = 0;
while (i < 5) {
  sum += i;
}
console.log(sum);`,
      python: `i = 0
sum = 0
while i < 5:
    sum += i
print(sum)`,
      cpp: `int i = 0, sum = 0;
while (i < 5) {
  sum += i;
}
cout << sum;`,
      java: `int i = 0, sum = 0;
while (i < 5) {
  sum += i;
}
System.out.println(sum);`
    },
    traces: {
      bn: {
        simple: INFINITE_LOOP_BN_SIMPLE,
        detailed: makeDetailedTrace(INFINITE_LOOP_BN_SIMPLE, "bn")
      },
      en: {
        simple: INFINITE_LOOP_EN_SIMPLE,
        detailed: makeDetailedTrace(INFINITE_LOOP_EN_SIMPLE, "en")
      }
    }
  }
];

// server/src/tracers/realExecutionRunner.ts
import vm from "node:vm";

// src/data/problemLibrary.ts
var PROBLEM_LIBRARY = [
  {
    id: "swap_variables",
    title_bn: "\u09E7. \u09A6\u09C1\u099F\u09BF \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7\u09B0 \u09AE\u09BE\u09A8 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 (Swap Two Variables)",
    title_en: "1. Swap Two Variables",
    topic: "Variables & Memory",
    difficulty: "easy",
    analogyType: "swap_buckets",
    concept_bn: "\u09A4\u09C3\u09A4\u09C0\u09AF\u09BC \u098F\u0995\u099F\u09BF \u0996\u09BE\u09B2\u09BF \u0995\u09BE\u09AA (`temp`) \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C7 \u09A6\u09C1\u099F\u09BF \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7\u09B0 \u09AE\u09BE\u09A8 \u09B9\u09BE\u09B0\u09BE\u09A8\u09CB \u099B\u09BE\u09A1\u09BC\u09BE\u0987 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 \u0995\u09B0\u09BE\u0964",
    concept_en: "Use a temporary third cup (`temp`) to exchange two values without overwriting either.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 `temp` \u099B\u09BE\u09A1\u09BC\u09BE \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF `a = b` \u09B2\u09C7\u0996\u09BE\u09AF\u09BC `a`-\u09B0 \u0986\u09A6\u09BF \u09AE\u09BE\u09A8 `5` \u099A\u09BF\u09B0\u09A4\u09B0\u09C7 \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC\u0964",
    bugHint_en: "In the faulty code, `a = b` overwrites `a` before saving `5` into `temp`.",
    previewValues: [5, 10],
    codes: {
      javascript: `let a = 5;
let b = 10;
let temp = a;
a = b;
b = temp;
console.log("a:", a, "b:", b);`,
      python: `a = 5
b = 10
temp = a
a = b
b = temp
print("a:", a, "b:", b)`,
      cpp: `int a = 5;
int b = 10;
int temp = a;
a = b;
b = temp;
cout << "a: " << a << " b: " << b;`,
      java: `int a = 5;
int b = 10;
int temp = a;
a = b;
b = temp;
System.out.println("a: " + a + " b: " + b);`
    },
    faultyCodes: {
      javascript: `let a = 5;
let b = 10;
a = b;
b = a;
console.log("a:", a, "b:", b);`,
      python: `a = 5
b = 10
a = b
b = a
print("a:", a, "b:", b)`,
      cpp: `int a = 5;
int b = 10;
a = b;
b = a;
cout << "a: " << a << " b: " << b;`,
      java: `int a = 5;
int b = 10;
a = b;
b = a;
System.out.println("a: " + a + " b: " + b);`
    }
  },
  {
    id: "reverse_array",
    title_bn: "\u09E8. \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 \u0989\u09B2\u09CD\u099F\u09C7 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE (Reverse an Array)",
    title_en: "2. Reverse an Array",
    topic: "Arrays & Pointers",
    difficulty: "easy",
    analogyType: "pointer_arrows",
    concept_bn: "\u09A6\u09C1\u0987 \u09AA\u09CD\u09B0\u09BE\u09A8\u09CD\u09A4\u09C7 \u09A6\u09C1\u099F\u09BF \u09AA\u09AF\u09BC\u09C7\u09A8\u09CD\u099F\u09BE\u09B0 (`left` \u0993 `right`) \u09B0\u09C7\u0996\u09C7 \u09AE\u09BE\u099D\u0996\u09BE\u09A8 \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u09AE\u09BE\u09A8 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 \u0995\u09B0\u09BE\u0964",
    concept_en: "Place `left` and `right` pointers at opposite ends and swap inward until they meet.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 \u09AA\u09C1\u09B0\u09CB \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 \u099C\u09C1\u09A1\u09BC\u09C7 (`i < n`) \u09B8\u09CB\u09AF\u09BC\u09BE\u09AA \u0995\u09B0\u09BE\u09AF\u09BC \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 \u09A6\u09C1\u09AC\u09BE\u09B0 \u0989\u09B2\u09CD\u099F\u09C7 \u0986\u09AC\u09BE\u09B0 \u0986\u0997\u09C7\u09B0 \u0985\u09AC\u09B8\u09CD\u09A5\u09BE\u09AF\u09BC \u09AB\u09BF\u09B0\u09C7 \u0986\u09B8\u09C7!",
    bugHint_en: "Faulty code loops all the way to `n` instead of `n / 2`, swapping elements twice back to original order.",
    previewValues: [10, 20, 30, 40],
    codes: {
      javascript: `let arr = [10, 20, 30, 40];
let left = 0, right = 3;
while (left < right) {
  let temp = arr[left];
  arr[left] = arr[right];
  arr[right] = temp;
  left++; right--;
}
console.log(arr);`,
      python: `arr = [10, 20, 30, 40]
left, right = 0, 3
while left < right:
    arr[left], arr[right] = arr[right], arr[left]
    left += 1
    right -= 1
print(arr)`,
      cpp: `int arr[] = {10, 20, 30, 40};
int left = 0, right = 3;
while (left < right) {
  swap(arr[left], arr[right]);
  left++; right--;
}`,
      java: `int[] arr = {10, 20, 30, 40};
int left = 0, right = 3;
while (left < right) {
  int t = arr[left]; arr[left] = arr[right]; arr[right] = t;
  left++; right--;
}`
    },
    faultyCodes: {
      javascript: `let arr = [10, 20, 30, 40];
for (let i = 0; i < 4; i++) {
  let t = arr[i]; arr[i] = arr[3 - i]; arr[3 - i] = t;
}
console.log("Double reversed:", arr);`,
      python: `arr = [10, 20, 30, 40]
for i in range(4):
    arr[i], arr[3 - i] = arr[3 - i], arr[i]
print(arr)`,
      cpp: `int arr[] = {10, 20, 30, 40};
for (int i = 0; i < 4; i++) {
  swap(arr[i], arr[3 - i]);
}`,
      java: `int[] arr = {10, 20, 30, 40};
for (int i = 0; i < 4; i++) {
  int t = arr[i]; arr[i] = arr[3 - i]; arr[3 - i] = t;
}`
    }
  },
  {
    id: "bubble_sort",
    title_bn: "\u09E9. \u09AC\u09BE\u09AC\u09B2 \u09B8\u09B0\u09CD\u099F (Bubble Sort)",
    title_en: "3. Bubble Sort",
    topic: "Sorting",
    difficulty: "medium",
    analogyType: "sort_blocks",
    concept_bn: "\u09AA\u09BE\u09B6\u09BE\u09AA\u09BE\u09B6\u09BF \u09A6\u09C1\u099F\u09BF \u09AC\u09CD\u09B2\u0995 \u09A4\u09C1\u09B2\u09A8\u09BE \u0995\u09B0\u09C7 \u09AC\u09A1\u09BC \u09AC\u09CD\u09B2\u0995\u099F\u09BF\u0995\u09C7 \u09A1\u09BE\u09A8\u09C7 \u09AA\u09BE\u09A0\u09BF\u09AF\u09BC\u09C7 \u09A7\u09BE\u09AA\u09C7 \u09A7\u09BE\u09AA\u09C7 \u09AA\u09C1\u09B0\u09CB \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 \u09B8\u09BE\u099C\u09BE\u09A8\u09CB\u0964",
    concept_en: "Repeatedly compare adjacent blocks and swap them along arcs so the largest values bubble right.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 \u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u09B2\u09C1\u09AA `j <= 4` \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u099A\u09B2\u09BE\u09AF\u09BC `arr[j + 1]` \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u09B0 \u09B8\u09C0\u09AE\u09BE\u09A8\u09BE \u099B\u09BE\u09A1\u09BC\u09BF\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC\u0964",
    bugHint_en: "Faulty code runs `j` up to the last index, causing `arr[j + 1]` to read out of bounds.",
    previewValues: [5, 2, 8, 1, 4],
    codes: {
      javascript: `let arr = [5, 2, 8, 1, 4];
for (let i = 0; i < 4; i++) {
  for (let j = 0; j < 4 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
    }
  }
}
console.log(arr);`,
      python: `arr = [5, 2, 8, 1, 4]
for i in range(4):
    for j in range(4 - i):
        if arr[j] > arr[j + 1]:
            arr[j], arr[j + 1] = arr[j + 1], arr[j]
print(arr)`,
      cpp: `int arr[] = {5, 2, 8, 1, 4};
for (int i = 0; i < 4; i++) {
  for (int j = 0; j < 4 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      swap(arr[j], arr[j + 1]);
    }
  }
}`,
      java: `int[] arr = {5, 2, 8, 1, 4};
for (int i = 0; i < 4; i++) {
  for (int j = 0; j < 4 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      int t = arr[j]; arr[j] = arr[j+1]; arr[j+1] = t;
    }
  }
}`
    },
    faultyCodes: {
      javascript: `let i = 0, sum = 0;
while (i < 5) {
  sum += i;
}
console.log(sum);`,
      python: `i = 0
sum = 0
while i < 5:
    sum += i
print(sum)`,
      cpp: `int i = 0, sum = 0;
while (i < 5) {
  sum += i;
}
cout << sum;`,
      java: `int i = 0, sum = 0;
while (i < 5) {
  sum += i;
}
System.out.println(sum);`
    }
  },
  {
    id: "selection_sort",
    title_bn: "\u09EA. \u09B8\u09BF\u09B2\u09C7\u0995\u09B6\u09A8 \u09B8\u09B0\u09CD\u099F (Selection Sort)",
    title_en: "4. Selection Sort",
    topic: "Sorting",
    difficulty: "medium",
    analogyType: "sort_blocks",
    concept_bn: "\u09AA\u09CD\u09B0\u09A4\u09BF \u09AA\u09BE\u09B8\u09C7 \u09B8\u09AC\u099A\u09C7\u09AF\u09BC\u09C7 \u099B\u09CB\u099F \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u0996\u09C1\u0981\u099C\u09C7 \u09AC\u09C7\u09B0 \u0995\u09B0\u09C7 \u09AC\u09BE\u09AE \u09A6\u09BF\u0995\u09C7\u09B0 \u09B8\u09A0\u09BF\u0995 \u099C\u09BE\u09AF\u09BC\u0997\u09BE\u09AF\u09BC \u09AC\u09B8\u09BE\u09A8\u09CB\u0964",
    concept_en: "Find the minimum block in the unsorted region and swap it into the front of the pass.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 `minVal` \u0986\u09AA\u09A1\u09C7\u099F \u0995\u09B0\u09B2\u09C7\u0993 \u09A4\u09BE\u09B0 \u0987\u09A8\u09A1\u09C7\u0995\u09CD\u09B8 `minIdx` \u0986\u09AA\u09A1\u09C7\u099F \u0995\u09B0\u09A4\u09C7 \u09AD\u09C1\u09B2\u09C7 \u09AF\u09BE\u0993\u09AF\u09BC\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
    bugHint_en: "Faulty code updates `minVal` without updating `minIdx`, swapping the wrong position.",
    previewValues: [7, 3, 9, 2],
    codes: {
      javascript: `let minVal = 7;
let second = 3;
let temp = minVal;
minVal = second;
second = temp;
console.log(minVal, second);`,
      python: `minVal = 7
second = 3
temp = minVal
minVal = second
second = temp
print(minVal, second)`,
      cpp: `int minVal = 7;
int second = 3;
int temp = minVal;
minVal = second;
second = temp;
cout << minVal << " " << second;`,
      java: `int minVal = 7;
int second = 3;
int temp = minVal;
minVal = second;
second = temp;
System.out.println(minVal + " " + second);`
    },
    faultyCodes: {
      javascript: `let a = 7;
let b = 3;
a = b;
b = a;
console.log(a, b);`,
      python: `a = 7
b = 3
a = b
b = a
print(a, b)`,
      cpp: `int a = 7;
int b = 3;
a = b;
b = a;
cout << a << b;`,
      java: `int a = 7;
int b = 3;
a = b;
b = a;
System.out.println(a + " " + b);`
    }
  },
  {
    id: "insertion_sort",
    title_bn: "\u09EB. \u0987\u09A8\u09B8\u09BE\u09B0\u09CD\u09B6\u09A8 \u09B8\u09B0\u09CD\u099F (Insertion Sort)",
    title_en: "5. Insertion Sort",
    topic: "Sorting",
    difficulty: "medium",
    analogyType: "sort_blocks",
    concept_bn: "\u09B9\u09BE\u09A4\u09C7 \u09A4\u09BE\u09B8 \u09B8\u09BE\u099C\u09BE\u09A8\u09CB\u09B0 \u09AE\u09A4\u09CB \u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u09A8\u09A4\u09C1\u09A8 \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u0995\u09C7 \u09A4\u09BE\u09B0 \u09AC\u09BE\u09AE \u09AA\u09BE\u09B6\u09C7\u09B0 \u09AC\u09A1\u09BC \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u0997\u09C1\u09B2\u09CB\u09B0 \u0986\u0997\u09C7 \u09A2\u09C1\u0995\u09BF\u09AF\u09BC\u09C7 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE\u0964",
    concept_en: "Like sorting playing cards in your hand, slide each key left past larger elements.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 `key` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7 \u09AE\u09BE\u09A8 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u09A8\u09BE \u0995\u09B0\u09BE\u09AF\u09BC \u09A1\u09BE\u09A8\u09A6\u09BF\u0995\u09C7 \u09B6\u09BF\u09AB\u099F \u0995\u09B0\u09BE\u09B0 \u09B8\u09AE\u09AF\u09BC \u09AE\u09BE\u09A8\u099F\u09BF \u09AE\u09C1\u099B\u09C7 \u09AF\u09BE\u09AF\u09BC\u0964",
    bugHint_en: "Faulty code shifts elements right without saving `key` first, overwriting the target card.",
    previewValues: [6, 4, 9, 1],
    codes: {
      javascript: `let c0 = 6;
let c1 = 4;
let key = c1;
c1 = c0;
c0 = key;
console.log(c0, c1);`,
      python: `c0 = 6
c1 = 4
key = c1
c1 = c0
c0 = key
print(c0, c1)`,
      cpp: `int c0 = 6;
int c1 = 4;
int key = c1;
c1 = c0;
c0 = key;
cout << c0 << " " << c1;`,
      java: `int c0 = 6;
int c1 = 4;
int key = c1;
c1 = c0;
c0 = key;
System.out.println(c0 + " " + c1);`
    },
    faultyCodes: {
      javascript: `let a = 6;
let b = 4;
a = b;
b = a;
console.log(a, b);`,
      python: `a = 6
b = 4
a = b
b = a
print(a, b)`,
      cpp: `int a = 6;
int b = 4;
a = b;
b = a;
cout << a << b;`,
      java: `int a = 6;
int b = 4;
a = b;
b = a;
System.out.println(a + " " + b);`
    }
  },
  {
    id: "linear_search",
    title_bn: "\u09EC. \u09B2\u09BF\u09A8\u09BF\u09AF\u09BC\u09BE\u09B0 \u09B8\u09BE\u09B0\u09CD\u099A (Linear Search)",
    title_en: "6. Linear Search",
    topic: "Searching",
    difficulty: "easy",
    analogyType: "pointer_arrows",
    concept_bn: "\u09B6\u09C1\u09B0\u09C1 \u09A5\u09C7\u0995\u09C7 \u09B6\u09C7\u09B7 \u09AA\u09B0\u09CD\u09AF\u09A8\u09CD\u09A4 \u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u0998\u09B0 \u098F\u0995\u09C7 \u098F\u0995\u09C7 \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE \u0995\u09B0\u09C7 \u0995\u09BE\u0999\u09CD\u0995\u09CD\u09B7\u09BF\u09A4 \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u099F\u09BF \u0996\u09C1\u0981\u099C\u09C7 \u09AC\u09C7\u09B0 \u0995\u09B0\u09BE\u0964",
    concept_en: "Scan each element sequentially from index 0 until the target value is found.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 \u09AA\u09CD\u09B0\u09A5\u09AE \u0998\u09B0\u09C7 \u09A8\u09BE \u09AE\u09BF\u09B2\u09B2\u09C7\u0987 \u09B8\u09BE\u09A5\u09C7 \u09B8\u09BE\u09A5\u09C7 `else return -1` \u09A6\u09C7\u0993\u09AF\u09BC\u09BE\u09AF\u09BC \u09AA\u09B0\u09C7\u09B0 \u0998\u09B0\u0997\u09C1\u09B2\u09CB \u0986\u09B0 \u0996\u09CB\u0981\u099C\u09BE \u09B9\u09AF\u09BC \u09A8\u09BE!",
    bugHint_en: "Faulty code puts `return -1` inside the `else` branch on the very first iteration.",
    previewValues: [12, 45, 7, 23],
    codes: {
      javascript: `let target = 7;
let item0 = 12;
let item1 = 7;
let foundIdx = 1;
console.log("Found at:", foundIdx);`,
      python: `target = 7
item0 = 12
item1 = 7
foundIdx = 1
print("Found at:", foundIdx)`,
      cpp: `int target = 7;
int item0 = 12;
int item1 = 7;
int foundIdx = 1;
cout << foundIdx;`,
      java: `int target = 7;
int item0 = 12;
int item1 = 7;
int foundIdx = 1;
System.out.println(foundIdx);`
    },
    faultyCodes: {
      javascript: `let i = 0, target = 7;
while (i < 4) {
  let check = i;
}
console.log(target);`,
      python: `i = 0
while i < 4:
    check = i
print(i)`,
      cpp: `int i = 0;
while (i < 4) {
  int check = i;
}`,
      java: `int i = 0;
while (i < 4) {
  int check = i;
}`
    }
  },
  {
    id: "binary_search",
    title_bn: "\u09ED. \u09AC\u09BE\u0987\u09A8\u09BE\u09B0\u09BF \u09B8\u09BE\u09B0\u09CD\u099A (Binary Search)",
    title_en: "7. Binary Search",
    topic: "Searching",
    difficulty: "medium",
    analogyType: "binary_search_cards",
    concept_bn: "\u09B8\u09BE\u099C\u09BE\u09A8\u09CB \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u09B0 \u09AE\u09BE\u099D\u0996\u09BE\u09A8\u09C7\u09B0 \u0995\u09BE\u09B0\u09CD\u09A1 (`mid`) \u09A6\u09C7\u0996\u09C7 \u09AA\u09CD\u09B0\u09A4\u09BF \u09A7\u09BE\u09AA\u09C7 \u0985\u09B0\u09CD\u09A7\u09C7\u0995 \u0985\u0982\u09B6 \u09AC\u09BE\u09A6 \u09A6\u09BF\u09AF\u09BC\u09C7 \u09A6\u09CD\u09B0\u09C1\u09A4 \u0996\u09CB\u0981\u099C\u09BE\u0964",
    concept_en: "Check the middle card (`mid`) of a sorted array and discard half the search space each step.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 `low = mid + 1` \u098F\u09B0 \u09AC\u09A6\u09B2\u09C7 \u09B2\u09C1\u09AA\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 \u0985\u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09BF\u09A4 \u09A5\u09BE\u0995\u09BE\u09AF\u09BC \u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA \u09A4\u09C8\u09B0\u09BF \u09B9\u09AF\u09BC\u0964",
    bugHint_en: "Faulty code fails to advance `low` or `high`, trapping `mid` in an infinite loop.",
    previewValues: [2, 5, 8, 12, 16, 23, 38],
    codes: {
      javascript: `let low = 0;
let high = 6;
let mid = 3;
let foundVal = 12;
console.log("Found:", foundVal, "at", mid);`,
      python: `low = 0
high = 6
mid = 3
foundVal = 12
print("Found:", foundVal, "at", mid)`,
      cpp: `int low = 0;
int high = 6;
int mid = 3;
int foundVal = 12;
cout << foundVal << " at " << mid;`,
      java: `int low = 0;
int high = 6;
int mid = 3;
int foundVal = 12;
System.out.println(foundVal + " at " + mid);`
    },
    faultyCodes: {
      javascript: `let i = 0, mid = 3;
while (i < 6) {
  mid = 3;
}
console.log(mid);`,
      python: `i = 0
while i < 6:
    mid = 3
print(mid)`,
      cpp: `int i = 0, mid = 3;
while (i < 6) {
  mid = 3;
}`,
      java: `int i = 0, mid = 3;
while (i < 6) {
  mid = 3;
}`
    }
  },
  {
    id: "array_maximum",
    title_bn: "\u09EE. \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u09B0 \u09B8\u09B0\u09CD\u09AC\u09CB\u099A\u09CD\u099A \u09AE\u09BE\u09A8 (Maximum of an Array)",
    title_en: "8. Maximum of an Array",
    topic: "Arrays & Pointers",
    difficulty: "easy",
    analogyType: "generic_memory",
    concept_bn: "\u09AA\u09CD\u09B0\u09A5\u09AE \u0989\u09AA\u09BE\u09A6\u09BE\u09A8\u0995\u09C7 `maxVal` \u09A7\u09B0\u09C7 \u09AC\u09BE\u0995\u09BF \u09B8\u09AC \u0989\u09AA\u09BE\u09A6\u09BE\u09A8\u09C7\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09A4\u09C1\u09B2\u09A8\u09BE \u0995\u09B0\u09C7 \u09B8\u09AC\u099A\u09C7\u09AF\u09BC\u09C7 \u09AC\u09A1\u09BC \u09AE\u09BE\u09A8\u099F\u09BF \u09B0\u09BE\u0996\u09BE\u0964",
    concept_en: "Initialize `maxVal` with the first element and update it whenever a larger value is seen.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 \u098B\u09A3\u09BE\u09A4\u09CD\u09AE\u0995 \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 \u0985\u09CD\u09AF\u09BE\u09B0\u09C7\u09A4\u09C7 `maxVal = 0` \u09A7\u09B0\u09BE\u09AF\u09BC \u09AD\u09C1\u09B2 \u0989\u09A4\u09CD\u09A4\u09B0 `0` \u0986\u09B8\u09C7!",
    bugHint_en: "Initializing `maxVal = 0` fails when all numbers in the array are negative.",
    previewValues: [14, 28, 9, 42],
    codes: {
      javascript: `let maxVal = 14;
let next1 = 28;
maxVal = next1;
let next2 = 42;
maxVal = next2;
console.log("Max:", maxVal);`,
      python: `maxVal = 14
next1 = 28
maxVal = next1
next2 = 42
maxVal = next2
print("Max:", maxVal)`,
      cpp: `int maxVal = 14;
int next1 = 28;
maxVal = next1;
int next2 = 42;
maxVal = next2;
cout << "Max: " << maxVal;`,
      java: `int maxVal = 14;
int next1 = 28;
maxVal = next1;
int next2 = 42;
maxVal = next2;
System.out.println("Max: " + maxVal);`
    },
    faultyCodes: {
      javascript: `let a = 14;
let b = 42;
a = b;
b = a;
console.log(a, b);`,
      python: `a = 14
b = 42
a = b
b = a
print(a, b)`,
      cpp: `int a = 14;
int b = 42;
a = b;
b = a;
cout << a << b;`,
      java: `int a = 14;
int b = 42;
a = b;
b = a;
System.out.println(a + " " + b);`
    }
  },
  {
    id: "stack_brackets",
    title_bn: "\u09EF. \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995 \u0993 \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F \u09AE\u09BF\u09B2\u09BE\u09A8\u09CB (Stack: Balanced Brackets)",
    title_en: "9. Stack: Balanced Brackets",
    topic: "Stacks & Queues",
    difficulty: "medium",
    analogyType: "stack_plates",
    concept_bn: "\u0996\u09CB\u09B2\u09BE \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995\u09C7 \u09AA\u09C1\u09B6 (`push`) \u0995\u09B0\u09BE \u098F\u09AC\u0982 \u09AC\u09A8\u09CD\u09A7 \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F \u09AA\u09C7\u09B2\u09C7 \u0989\u09AA\u09B0 \u09A5\u09C7\u0995\u09C7 \u09AA\u09AA (`pop`) \u0995\u09B0\u09C7 \u09AE\u09BF\u09B2\u09BE\u09A8\u09CB\u0964",
    concept_en: "Push opening brackets onto a plate stack and pop the top plate when a matching closing bracket arrives.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 \u0996\u09BE\u09B2\u09BF \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995 \u09A5\u09C7\u0995\u09C7 \u09AA\u09AA \u0995\u09B0\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u09AC\u09BE \u09B6\u09C7\u09B7\u09C7 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995 \u0996\u09BE\u09B2\u09BF \u0995\u09BF \u09A8\u09BE \u09A4\u09BE \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE \u09A8\u09BE \u0995\u09B0\u09BE\u0964",
    bugHint_en: "Faulty code forgets to check if the stack is empty after scanning all characters.",
    previewValues: ["(", "[", "]", ")"],
    codes: {
      javascript: `let stackSize = 0;
stackSize += 1;
stackSize += 1;
stackSize -= 1;
stackSize -= 1;
console.log("Balanced, size:", stackSize);`,
      python: `stackSize = 0
stackSize += 1
stackSize += 1
stackSize -= 1
stackSize -= 1
print("Balanced, size:", stackSize)`,
      cpp: `int stackSize = 0;
stackSize += 1;
stackSize += 1;
stackSize -= 1;
stackSize -= 1;
cout << "Balanced, size: " << stackSize;`,
      java: `int stackSize = 0;
stackSize += 1;
stackSize += 1;
stackSize -= 1;
stackSize -= 1;
System.out.println("Balanced, size: " + stackSize);`
    },
    faultyCodes: {
      javascript: `let stackSize = 1;
while (stackSize < 5) {
  let top = stackSize;
}
console.log(stackSize);`,
      python: `stackSize = 1
while stackSize < 5:
    top = stackSize
print(stackSize)`,
      cpp: `int stackSize = 1;
while (stackSize < 5) {
  int top = stackSize;
}`,
      java: `int stackSize = 1;
while (stackSize < 5) {
  int top = stackSize;
}`
    }
  },
  {
    id: "queue_bfs",
    title_bn: "\u09E7\u09E6. \u0995\u09BF\u0989 \u0993 \u0997\u09CD\u09B0\u09BE\u09AB BFS (Queue: BFS on Small Graph)",
    title_en: "10. Queue: BFS on Small Graph",
    topic: "Stacks & Queues",
    difficulty: "medium",
    analogyType: "queue_line",
    concept_bn: "\u09B2\u09BE\u0987\u09A8\u09C7\u09B0 \u09AA\u09C7\u099B\u09A8\u09C7 \u09A8\u09A4\u09C1\u09A8 \u09A8\u09CB\u09A1 \u09AF\u09C1\u0995\u09CD\u09A4 (`enqueue`) \u0995\u09B0\u09BE \u098F\u09AC\u0982 \u09B8\u09BE\u09AE\u09A8\u09C7 \u09A5\u09C7\u0995\u09C7 \u098F\u0995\u09C7 \u098F\u0995\u09C7 \u09AC\u09C7\u09B0 (`dequeue`) \u0995\u09B0\u09C7 \u09B8\u09CD\u09A4\u09B0\u09C7 \u09B8\u09CD\u09A4\u09B0\u09C7 \u09AD\u09BF\u099C\u09BF\u099F \u0995\u09B0\u09BE\u0964",
    concept_en: "Enqueue neighbor nodes at the back of the line and dequeue from the front to explore level by level.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 \u09A8\u09CB\u09A1 `visited` \u09B9\u09BF\u09B8\u09C7\u09AC\u09C7 \u099A\u09BF\u09B9\u09CD\u09A8\u09BF\u09A4 \u09A8\u09BE \u0995\u09B0\u09BE\u09AF\u09BC \u098F\u0995\u0987 \u09A8\u09CB\u09A1 \u09AC\u09BE\u09B0\u09AC\u09BE\u09B0 \u0995\u09BF\u0989\u09A4\u09C7 \u09A2\u09C1\u0995\u09C7 \u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09C7\u0964",
    bugHint_en: "Forgetting to mark nodes as `visited` enqueues cycles infinitely.",
    previewValues: ["A", "B", "C", "D"],
    codes: {
      javascript: `let queued = 1;
let visited = 1;
queued += 2;
queued -= 1;
visited += 2;
console.log("Visited nodes:", visited);`,
      python: `queued = 1
visited = 1
queued += 2
queued -= 1
visited += 2
print("Visited nodes:", visited)`,
      cpp: `int queued = 1;
int visited = 1;
queued += 2;
queued -= 1;
visited += 2;
cout << "Visited nodes: " << visited;`,
      java: `int queued = 1;
int visited = 1;
queued += 2;
queued -= 1;
visited += 2;
System.out.println("Visited nodes: " + visited);`
    },
    faultyCodes: {
      javascript: `let i = 0, queued = 1;
while (i < 5) {
  queued += 1;
}
console.log(queued);`,
      python: `i = 0
queued = 1
while i < 5:
    queued += 1
print(queued)`,
      cpp: `int i = 0, queued = 1;
while (i < 5) {
  queued += 1;
}`,
      java: `int i = 0, queued = 1;
while (i < 5) {
  queued += 1;
}`
    }
  },
  {
    id: "linked_list_reverse",
    title_bn: "\u09E7\u09E7. \u09B2\u09BF\u0982\u0995\u09A1 \u09B2\u09BF\u09B8\u09CD\u099F \u0989\u09B2\u09CD\u099F\u09C7 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE (Linked List Reversal)",
    title_en: "11. Linked List Reversal",
    topic: "Linked Lists",
    difficulty: "hard",
    analogyType: "linked_list_train",
    concept_bn: "\u099F\u09CD\u09B0\u09C7\u09A8\u09C7\u09B0 \u09AC\u0997\u09BF\u09B0 \u0995\u09BE\u09AA\u09B2\u09BF\u0982 (`next` \u09AA\u09AF\u09BC\u09C7\u09A8\u09CD\u099F\u09BE\u09B0) \u0998\u09C1\u09B0\u09BF\u09AF\u09BC\u09C7 \u09A6\u09C7\u0993\u09DF\u09BE\u09B0 \u0986\u0997\u09C7 \u09AA\u09B0\u09C7\u09B0 \u09AC\u0997\u09BF\u09B0 \u09A0\u09BF\u0995\u09BE\u09A8\u09BE `nextTemp`-\u098F \u09AC\u09BE\u0981\u099A\u09BF\u09AF\u09BC\u09C7 \u09B0\u09BE\u0996\u09BE\u0964",
    concept_en: "Save `curr.next` in `nextTemp` before reversing the coach coupling to point at `prev`.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 `nextTemp` \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u09A8\u09BE \u0995\u09B0\u09C7\u0987 `curr.next = prev` \u0995\u09B0\u09BE\u09AF\u09BC \u09AC\u09BE\u0995\u09BF \u099F\u09CD\u09B0\u09C7\u09A8\u09C7\u09B0 \u09AC\u0997\u09BF\u0997\u09C1\u09B2\u09CB \u09AC\u09BF\u099A\u09CD\u099B\u09BF\u09A8\u09CD\u09A8 \u09B9\u09AF\u09BC\u09C7 \u09B9\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7 \u09AF\u09BE\u09AF\u09BC!",
    bugHint_en: "Overwriting `curr.next` before saving `nextTemp` detaches and loses the rest of the train.",
    previewValues: ["10\u2192", "20\u2192", "30"],
    codes: {
      javascript: `let prev = 0;
let curr = 10;
let nextTemp = 20;
prev = curr;
curr = nextTemp;
console.log("New head:", curr, "prev:", prev);`,
      python: `prev = 0
curr = 10
nextTemp = 20
prev = curr
curr = nextTemp
print("New head:", curr, "prev:", prev)`,
      cpp: `int prev = 0;
int curr = 10;
int nextTemp = 20;
prev = curr;
curr = nextTemp;
cout << "New head: " << curr;`,
      java: `int prev = 0;
int curr = 10;
int nextTemp = 20;
prev = curr;
curr = nextTemp;
System.out.println("New head: " + curr);`
    },
    faultyCodes: {
      javascript: `let prev = 0;
let curr = 10;
// Forgot nextTemp = 20!
curr = prev;
console.log("Lost next nodes, curr:", curr);`,
      python: `prev = 0
curr = 10
# Forgot nextTemp!
curr = prev
print("Lost next nodes, curr:", curr)`,
      cpp: `int prev = 0;
int curr = 10;
curr = prev;
cout << curr;`,
      java: `int prev = 0;
int curr = 10;
curr = prev;
System.out.println(curr);`
    }
  },
  {
    id: "recursion_factorial",
    title_bn: "\u09E7\u09E8. \u09B0\u09BF\u0995\u09BE\u09B0\u09CD\u09B8\u09A8: \u09AB\u09CD\u09AF\u09BE\u0995\u09CD\u099F\u09CB\u09B0\u09BF\u09AF\u09BC\u09BE\u09B2 \u0993 \u09AC\u09C7\u09B8 \u0995\u09C7\u09B8 (Recursion: Factorial)",
    title_en: "12. Recursion: Factorial & Base Case",
    topic: "Recursion",
    difficulty: "medium",
    analogyType: "recursion_tower",
    concept_bn: "`n == 1` \u09AC\u09C7\u09B8 \u0995\u09C7\u09B8\u09C7 \u09A5\u09C7\u09AE\u09C7 \u0995\u09B2-\u09AB\u09CD\u09B0\u09C7\u09AE\u0997\u09C1\u09B2\u09CB\u09B0 \u09AE\u09BE\u09A8 \u098F\u0995\u09C7 \u098F\u0995\u09C7 \u09A8\u09BF\u099A\u09C7 \u09AB\u09BF\u09B0\u09BF\u09AF\u09BC\u09C7 \u098F\u09A8\u09C7 \u0997\u09C1\u09A3\u09AB\u09B2 \u09AC\u09C7\u09B0 \u0995\u09B0\u09BE\u0964",
    concept_en: "Stack call frames down to base case `n == 1`, then multiply return values back up the tower.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 \u09AC\u09C7\u09B8 \u0995\u09C7\u09B8 (`if (n <= 1) return 1`) \u09A8\u09BE \u09A5\u09BE\u0995\u09BE\u09AF\u09BC \u0995\u09B2 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995 \u0989\u09AA\u099A\u09C7 \u09AA\u09A1\u09BC\u09C7 (`stack_overflow`)!",
    bugHint_en: "Missing base case causes unbounded recursive calls until the call stack overflows.",
    previewValues: ["3!", "2!", "1!"],
    codes: {
      javascript: `let n = 3;
let f1 = 1;
let f2 = 2 * f1;
let f3 = 3 * f2;
console.log("3! =", f3);`,
      python: `n = 3
f1 = 1
f2 = 2 * f1
f3 = 3 * f2
print("3! =", f3)`,
      cpp: `int n = 3;
int f1 = 1;
int f2 = 2 * f1;
int f3 = 3 * f2;
cout << "3! = " << f3;`,
      java: `int n = 3;
int f1 = 1;
int f2 = 2 * f1;
int f3 = 3 * f2;
System.out.println("3! = " + f3);`
    },
    faultyCodes: {
      javascript: `let i = 0, depth = 1;
while (i < 5) {
  depth += 1;
}
console.log(depth);`,
      python: `i = 0
depth = 1
while i < 5:
    depth += 1
print(depth)`,
      cpp: `int i = 0, depth = 1;
while (i < 5) {
  depth += 1;
}`,
      java: `int i = 0, depth = 1;
while (i < 5) {
  depth += 1;
}`
    }
  },
  {
    id: "while_missing_increment",
    title_bn: "\u09E7\u09E9. \u09B9\u09CB\u09AF\u09BC\u09BE\u0987\u09B2 \u09B2\u09C1\u09AA \u0993 \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09AC\u09C3\u09A6\u09CD\u09A7\u09BF (While Loop Increment)",
    title_en: "13. While Loop & Missing Increment",
    topic: "Loops & Control Flow",
    difficulty: "easy",
    analogyType: "loop_gauge",
    concept_bn: "\u09B2\u09C1\u09AA\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 \u09AF\u09C7\u09A8 \u098F\u0995\u09B8\u09AE\u09AF\u09BC \u09B6\u09C7\u09B7 \u09B9\u09AF\u09BC \u09B8\u09C7\u099C\u09A8\u09CD\u09AF \u09AA\u09CD\u09B0\u09A4\u09BF \u09A7\u09BE\u09AA\u09C7 \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 (`i++`) \u09AC\u09BE\u09A1\u09BC\u09BE\u09A8\u09CB \u0986\u09AC\u09B6\u09CD\u09AF\u0995\u0964",
    concept_en: "Increment the loop counter (`i++`) on every iteration so the loop condition eventually terminates.",
    bugHint_bn: "\u09AD\u09C1\u09B2 \u0995\u09CB\u09A1\u09C7 `i++` \u09A8\u09BE \u09A5\u09BE\u0995\u09BE\u09AF\u09BC `i` \u099A\u09BF\u09B0\u0995\u09BE\u09B2 `0` \u09A5\u09C7\u0995\u09C7 \u09AF\u09BE\u09AF\u09BC \u098F\u09AC\u0982 \u09E9 \u09B2\u09CD\u09AF\u09BE\u09AA \u09AA\u09B0\u09C7 \u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA \u09B9\u09BF\u09B8\u09C7\u09AC\u09C7 \u09A5\u09BE\u09AE\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u0964",
    bugHint_en: "Omitting `i++` leaves `i` stuck at `0`, triggering an infinite loop halt after 3 laps.",
    previewValues: ["Lap 1", "Lap 2", "Lap 3"],
    codes: {
      javascript: `let i = 0;
let sum = 0;
sum = sum + 1;
sum = sum + 2;
sum = sum + 3;
console.log("Sum:", sum);`,
      python: `i = 0
sum = 0
sum = sum + 1
sum = sum + 2
sum = sum + 3
print("Sum:", sum)`,
      cpp: `int i = 0;
int sum = 0;
sum = sum + 1;
sum = sum + 2;
sum = sum + 3;
cout << "Sum: " << sum;`,
      java: `int i = 0;
int sum = 0;
sum = sum + 1;
sum = sum + 2;
sum = sum + 3;
System.out.println("Sum: " + sum);`
    },
    faultyCodes: {
      javascript: `let i = 0, sum = 0;
while (i < 5) {
  sum += i;
}
console.log(sum);`,
      python: `i = 0
sum = 0
while i < 5:
    sum += i
print(sum)`,
      cpp: `int i = 0, sum = 0;
while (i < 5) {
  sum += i;
}
cout << sum;`,
      java: `int i = 0, sum = 0;
while (i < 5) {
  sum += i;
}
System.out.println(sum);`
    }
  }
];

// server/src/tracers/realExecutionRunner.ts
var IGNORED_SANDBOX_KEYS = /* @__PURE__ */ new Set([
  "console",
  "prompt",
  "input",
  "Math",
  "Number",
  "String",
  "Boolean",
  "Array",
  "Object",
  "JSON",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "Map",
  "Set",
  "Random",
  "Scanner",
  "System",
  "__traceStep",
  "__traceLoopCheck",
  "__traceCondCheck",
  "__printLine",
  "__print",
  "__toInt",
  "__checkNum",
  "__openFile",
  "__parseIntJava",
  "__parseDoubleJava",
  "__throwException",
  "__matchException",
  "__fmtException",
  "__fmtOut",
  "__cinRead",
  "__cap"
]);
var LANGUAGE_KEYWORDS = /* @__PURE__ */ new Set([
  "let",
  "const",
  "var",
  "int",
  "long",
  "short",
  "byte",
  "float",
  "double",
  "boolean",
  "bool",
  "char",
  "string",
  "String",
  "void",
  "auto",
  "final",
  "static",
  "public",
  "private",
  "protected",
  "class",
  "struct",
  "if",
  "else",
  "elif",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "return",
  "require",
  "module",
  "exports",
  "crypto",
  "Buffer",
  "try",
  "catch",
  "except",
  "finally",
  "throw",
  "throws",
  "raise",
  "function",
  "def",
  "true",
  "false",
  "True",
  "False",
  "null",
  "None",
  "nullptr",
  "new",
  "System",
  "out",
  "println",
  "print",
  "printf",
  "cout",
  "cin",
  "endl",
  "std",
  "main",
  "args",
  "Math",
  "Array",
  "Integer",
  "Double",
  "Character",
  "File",
  "FileReader",
  "FileInputStream",
  "BufferedReader",
  "Scanner",
  "Random",
  "Collections",
  "ArrayList",
  "HashMap",
  "Exception",
  "RuntimeException",
  "ArithmeticException",
  "FileNotFoundException",
  "IOException",
  "NullPointerException",
  "ArrayIndexOutOfBoundsException",
  "NumberFormatException"
]);
function cloneSafeValue(val) {
  if (val === null || val === void 0) return val;
  if (typeof val === "number") {
    return Number.isFinite(val) ? val : String(val);
  }
  if (typeof val === "string" || typeof val === "boolean") {
    return val;
  }
  if (Array.isArray(val)) {
    return val.slice(0, 35).map((item) => cloneSafeValue(item));
  }
  if (typeof val === "object") {
    try {
      return JSON.parse(JSON.stringify(val));
    } catch {
      return String(val);
    }
  }
  return void 0;
}
function stripCommentsPreservingLines(code, language) {
  let result = "";
  let i = 0;
  const len = code.length;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBlockComment = false;
  while (i < len) {
    const ch = code[i];
    const next = i + 1 < len ? code[i + 1] : "";
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        result += "  ";
        i += 2;
        inBlockComment = false;
      } else if (ch === "\n") {
        result += "\n";
        i++;
      } else {
        result += " ";
        i++;
      }
      continue;
    }
    if (inSingle) {
      result += ch;
      if (ch === "\\" && i + 1 < len) {
        result += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === "'" || ch === "\n") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      result += ch;
      if (ch === "\\" && i + 1 < len) {
        result += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"' || ch === "\n") inDouble = false;
      i++;
      continue;
    }
    if (inBacktick) {
      result += ch;
      if (ch === "\\" && i + 1 < len) {
        result += code[i + 1];
        i += 2;
        continue;
      }
      if (ch === "`") inBacktick = false;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      result += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && next === "/" && language !== "python") {
      while (i < len && code[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (ch === "#" && language === "python") {
      while (i < len && code[i] !== "\n") {
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
    if (ch === "`") {
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
function extractVariablesAndTypes(cleanCode, language) {
  const names = /* @__PURE__ */ new Set();
  const intVars = /* @__PURE__ */ new Set();
  const hasFloatType = /\b(?:float|double)\b/.test(cleanCode);
  const lines = cleanCode.split("\n");
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const catchVarMatch = language === "python" ? trimmed.match(/^except(?:\s+[A-Za-z0-9_.,\s()]+?\s+as\s+([A-Za-z_]\w*))?\s*:/) : trimmed.match(/^(?:\}?\s*)?catch\s*\(\s*(?:final\s+)?(?:[A-Za-z0-9_.$|&\s]+\s+)?([A-Za-z_$][\w$]*)\s*\)/);
    if (catchVarMatch && catchVarMatch[1] && !LANGUAGE_KEYWORDS.has(catchVarMatch[1])) {
      names.add(catchVarMatch[1]);
      continue;
    }
    if (/\bclass\s+[A-Za-z_]\w*/.test(trimmed) || /\bmain\s*\(/.test(trimmed) || /^(?:public|private|protected|static|\s)*(?:void|int|long|double|float|boolean|bool|String|string)\s+[A-Za-z_]\w*\s*\(/.test(
      trimmed
    )) {
      continue;
    }
    if (language === "java" || language === "cpp") {
      const intDeclRegex = /\b(?:int|long|short|byte)\s+(?!\[\s*\])([^;()]+)/g;
      let m;
      while ((m = intDeclRegex.exec(trimmed)) !== null) {
        const declPart = m[1];
        const segments = declPart.split(",");
        for (const seg of segments) {
          const lhs = seg.split("=")[0].trim();
          const idMatch = lhs.match(/^([a-zA-Z_$][\w$]*)$/);
          if (idMatch && !LANGUAGE_KEYWORDS.has(idMatch[1])) {
            intVars.add(idMatch[1]);
            names.add(idMatch[1]);
          }
        }
      }
    }
    const multiTypedMatch = trimmed.match(
      /^(?:final\s+|static\s+)*(?:let|const|var|int|long|short|byte|float|double|boolean|bool|String|string|char|auto)\s+(?!\[\s*\])([^;()]+)/
    );
    if (multiTypedMatch) {
      const declPart = multiTypedMatch[1];
      for (const seg of declPart.split(",")) {
        const lhs = seg.split("=")[0].trim().replace(/\[\s*\]/g, "").trim();
        const idMatch = lhs.match(/^([a-zA-Z_$][\w$]*)$/);
        if (idMatch && !LANGUAGE_KEYWORDS.has(idMatch[1]) && !IGNORED_SANDBOX_KEYS.has(idMatch[1])) {
          names.add(idMatch[1]);
        }
      }
    }
    const typedDeclRegex = /\b(?:let|const|var|int|long|short|byte|float|double|boolean|bool|String|string|char|auto|FileReader|FileInputStream|BufferedReader|Scanner|Random|File|Object|Integer|Double|List|ArrayList|LinkedList|Map|HashMap|TreeMap|Set|HashSet|TreeSet|Queue|Deque|Stack|PriorityQueue|vector\s*<[^>]+>|(?:[A-Za-z_$][\w$]*\s*<[^>]+>)|(?:[A-Z][A-Za-z0-9_$]*))\s*(?:\[\s*\])?\s+([a-zA-Z_$][\w$]*)/g;
    let tm;
    while ((tm = typedDeclRegex.exec(trimmed)) !== null) {
      const v = tm[1];
      if (v && !LANGUAGE_KEYWORDS.has(v) && !IGNORED_SANDBOX_KEYS.has(v)) {
        names.add(v);
      }
    }
    if (language === "python") {
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
    const assignRegex = /(?:^|[;\s({,])([a-zA-Z_$][\w$]*)\s*(?:=(?!=)|(\+=|-=|\*=|\/=|%=|\+\+|--))/g;
    let am;
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
    hasFloatType
  };
}
function splitCoutStream(expr) {
  const parts = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    const next = i + 1 < expr.length ? expr[i + 1] : "";
    const prev = i > 0 ? expr[i - 1] : "";
    if (ch === "'" && prev !== "\\" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && prev !== "\\" && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      else if (ch === "<" && next === "<" && depth === 0) {
        parts.push(current.trim());
        current = "";
        i++;
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  let hasNewline = false;
  const filtered = [];
  for (const p of parts) {
    if (p === "endl" || p === "std::endl" || p === '"\\n"' || p === "'\\n'") {
      hasNewline = true;
    } else if (p) {
      filtered.push(p);
    }
  }
  return { parts: filtered, hasNewline };
}
function normalizeExpressionToJs(expr, language, isIntegerContext, lineNum = 1) {
  let out = expr.trim();
  if (language === "python") {
    out = out.replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false").replace(/\bNone\b/g, "null").replace(/\band\b/g, "&&").replace(/\bor\b/g, "||").replace(/\bnot\s+/g, "!").replace(/\blen\s*\(([^)]+)\)/g, "($1).length").replace(/\.append\s*\(/g, ".push(").replace(/\bopen\s*\(([^)]+)\)/g, `__openFile(${lineNum}, $1, () => __cap())`);
    while (/([a-zA-Z0-9_)\]]+)\s*\/\/\s*([a-zA-Z0-9_(\[]+)/.test(out)) {
      out = out.replace(
        /([a-zA-Z0-9_)\]]+)\s*\/\/\s*([a-zA-Z0-9_(\[]+)/g,
        `__toInt(($1) / ($2), ${lineNum}, () => __cap())`
      );
    }
  }
  if (language === "java" || language === "cpp") {
    out = out.replace(
      /new\s+Scanner\s*\(\s*new\s+File\s*\(([^)]*)\)\s*\)/g,
      `__openFile(${lineNum}, $1, () => __cap())`
    ).replace(
      /new\s+(?:FileReader|FileInputStream)\s*\(([^)]*)\)/g,
      `__openFile(${lineNum}, $1, () => __cap())`
    ).replace(/new\s+File\s*\(([^)]*)\)/g, "($1)").replace(
      /Integer\.parseInt\s*\(([^)]+)\)/g,
      `__parseIntJava(${lineNum}, $1, () => __cap())`
    ).replace(
      /Double\.parseDouble\s*\(([^)]+)\)/g,
      `__parseDoubleJava(${lineNum}, $1, () => __cap())`
    );
    out = out.replace(
      /new\s+(?:int|long|double|float|boolean|String|char)\s*\[\s*\]\s*\{([^}]*)\}/g,
      "[$1]"
    );
    out = out.replace(
      /new\s+(?:int|long|double|float)\s*\[\s*([^\]]+)\s*\]/g,
      "new Array($1).fill(0)"
    );
    out = out.replace(/new\s+(?:ArrayList|LinkedList)(?:\s*<[^>]*>)?\s*\(\s*\)/g, "new ArrayList()").replace(/new\s+(?:HashMap|TreeMap)(?:\s*<[^>]*>)?\s*\(\s*\)/g, "new HashMap()").replace(/new\s+(?:HashSet|TreeSet)(?:\s*<[^>]*>)?\s*\(\s*\)/g, "new Set()");
    out = out.replace(/\((?:double|float)\)\s*([a-zA-Z0-9_(\[]+)/g, "Number($1)");
    out = out.replace(/\((?:int|long|short|byte)\)\s*([a-zA-Z0-9_(\[]+)/g, "Math.trunc($1)");
    if (out.startsWith("{") && out.endsWith("}")) {
      out = `[${out.slice(1, -1)}]`;
    }
    out = out.replace(/\.getMessage\s*\(\s*\)/g, ".toString()").replace(/\.length\s*\(\s*\)/g, ".length").replace(/\.size\s*\(\s*\)/g, ".length").replace(/\.charAt\s*\(([^)]+)\)/g, "[($1)]").replace(/\.push_back\s*\(/g, ".push(").replace(/\.pop_back\s*\(\s*\)/g, ".pop()").replace(/\.add\s*\(/g, ".push(").replace(/\.equals\s*\(([^)]+)\)/g, "=== ($1)").replace(/\bInteger\.MAX_VALUE\b/g, "2147483647").replace(/\bInteger\.MIN_VALUE\b/g, "-2147483648").replace(/\bINT_MAX\b/g, "2147483647").replace(/\bINT_MIN\b/g, "-2147483648");
  }
  if (isIntegerContext) {
    return `__toInt(${out}, ${lineNum}, () => __cap())`;
  }
  return out;
}
function buildInstrumentedMultiLangScript(cleanCode, language, varNames, intVars, hasFloatType) {
  const captureEntries = varNames.map(
    (v) => `...(typeof ${v} !== "undefined" && typeof ${v} !== "function" ? { ${JSON.stringify(
      v
    )}: ${v} } : {})`
  ).join(", ");
  const rawLines = cleanCode.split("\n");
  const processedLines = [];
  const pyIndentStack = [0];
  const seenVars = /* @__PURE__ */ new Set();
  const braceStack = [];
  let inCatchChain = false;
  const isNextNonEmptyLineAnotherCatch = (fromIdx) => {
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
    let pyClosingPrefix = "";
    if (language === "python" && trimmed.length > 0) {
      const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
      while (pyIndentStack.length > 1 && indentSpaces < pyIndentStack[pyIndentStack.length - 1]) {
        pyIndentStack.pop();
        pyClosingPrefix += "} ";
      }
    }
    if (!trimmed) {
      processedLines.push("");
      continue;
    }
    if (trimmed.startsWith("#include") || trimmed.startsWith("#pragma") || trimmed.startsWith("using namespace") || trimmed.startsWith("import ") || trimmed.startsWith("from ") || trimmed.startsWith("package ")) {
      processedLines.push(pyClosingPrefix);
      continue;
    }
    if (trimmed === "{" || trimmed === "}" || trimmed === "};") {
      if (trimmed === "{") {
        braceStack.push("OTHER");
        processedLines.push(`${pyClosingPrefix}{`);
      } else if (inCatchChain && !isNextNonEmptyLineAnotherCatch(idx)) {
        inCatchChain = false;
        braceStack.pop();
        processedLines.push(`${pyClosingPrefix}} else { throw __rawErr; } }`);
      } else {
        const closedScope = braceStack.pop();
        const prevNonEmpty = idx > 0 ? rawLines[idx - 1].trim() : "";
        const prevWasJump = /^(?:return|break|continue|throw|raise)\b/.test(prevNonEmpty);
        const shouldTraceClose = !prevWasJump && (closedScope === "MAIN" || closedScope === "COND" || closedScope === "TRY" || closedScope === "CATCH" || closedScope === "FINALLY");
        const closeStepJs = shouldTraceClose ? `__traceStep(${lineNum}, "BLOCK_END", __cap(), { subKind: "SCOPE_END" }); ` : "";
        processedLines.push(
          `${pyClosingPrefix}${closeStepJs}${trimmed === "};" ? "}" : trimmed}`
        );
      }
      continue;
    }
    const tryMatch = language === "python" ? trimmed.match(/^try\s*:\s*$/) : trimmed.match(/^try\s*(\{)?\s*$/);
    if (tryMatch) {
      if (language === "python") {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}try { __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "TRY_BLOCK" });`
        );
      } else {
        const hasOpen = Boolean(tryMatch[1]);
        if (hasOpen) braceStack.push("TRY");
        processedLines.push(
          `${pyClosingPrefix}try ${hasOpen ? "{" : ""} __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "TRY_BLOCK" });`
        );
      }
      continue;
    }
    const catchMatch = language === "python" ? trimmed.match(/^except(?:\s+([A-Za-z0-9_]+)(?:\s+as\s+([A-Za-z_]\w*))?)?\s*:\s*$/) : trimmed.match(
      /^(\}?\s*)catch\s*\(\s*(?:final\s+)?(?:([A-Za-z0-9_.$|&\s]+)\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)|(\.\.\.))\s*\)\s*(\{)?\s*$/
    );
    if (catchMatch) {
      if (language === "python") {
        const excType = catchMatch[1]?.trim() || "Exception";
        const excVar = catchMatch[2]?.trim() || "__exc";
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
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
        const hasLeadCloseBrace = Boolean(catchMatch[1] && catchMatch[1].includes("}"));
        if (hasLeadCloseBrace) braceStack.pop();
        const excType = (catchMatch[2] || "Exception").trim();
        const excVar = (catchMatch[3] || catchMatch[4] || "__exc").trim();
        const hasTrailOpenBrace = Boolean(catchMatch[6]);
        if (hasTrailOpenBrace) braceStack.push("CATCH");
        seenVars.add(excVar);
        if (!inCatchChain) {
          inCatchChain = true;
          const prefixClose = hasLeadCloseBrace ? "}" : "";
          processedLines.push(
            `${pyClosingPrefix}${prefixClose} catch (__rawErr) ${hasTrailOpenBrace ? "{" : ""} if (__matchException(__rawErr, ${JSON.stringify(
              excType
            )})) { ${excVar} = __fmtException(__rawErr); __traceStep(${lineNum}, "CONDITION_CHECK", __cap({ ${JSON.stringify(
              excVar
            )}: ${excVar} }), { subKind: "CATCH_BLOCK", exceptionType: ${JSON.stringify(
              excType
            )}, targetVar: ${JSON.stringify(excVar)} });`
          );
        } else {
          const prefixClose = hasLeadCloseBrace ? "}" : "";
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
    const finallyMatch = language === "python" ? trimmed.match(/^finally\s*:\s*$/) : trimmed.match(/^(\}?\s*)finally\s*(\{)?\s*$/);
    if (finallyMatch) {
      if (language === "python") {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}finally { __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "FINALLY_BLOCK" });`
        );
      } else {
        const hasLeadCloseBrace = Boolean(finallyMatch[1] && finallyMatch[1].includes("}"));
        if (hasLeadCloseBrace) braceStack.pop();
        const hasTrailOpenBrace = Boolean(finallyMatch[2]);
        if (hasTrailOpenBrace) braceStack.push("FINALLY");
        let prefix = "";
        if (inCatchChain) {
          inCatchChain = false;
          prefix = hasLeadCloseBrace ? "} else { throw __rawErr; } }" : "";
        } else if (hasLeadCloseBrace) {
          prefix = "}";
        }
        processedLines.push(
          `${pyClosingPrefix}${prefix} finally ${hasTrailOpenBrace ? "{" : ""} __traceStep(${lineNum}, "METHOD_ENTRY", __cap(), { subKind: "FINALLY_BLOCK" });`
        );
      }
      continue;
    }
    const throwMatch = language === "python" ? trimmed.match(/^raise\s+([A-Za-z0-9_]+)\s*(?:\((.*)\))?\s*$/) : trimmed.match(/^throw\s+(?:new\s+)?([A-Za-z0-9_.$]+)\s*(?:\((.*)\))?\s*;?\s*$/);
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
    const classMatch = trimmed.match(
      /^(?:public\s+|private\s+|protected\s+|final\s+|abstract\s+)*class\s+([A-Za-z_]\w*)(?:[^{:;]*)(\{|:\s*)?$/
    );
    if (classMatch) {
      const hasOpen = Boolean(classMatch[2]);
      if (language === "python" && classMatch[2]?.includes(":")) {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
        pyIndentStack.push(indentSpaces + 4);
      } else if (hasOpen) {
        braceStack.push("CLASS");
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
    const mainMatch = trimmed.match(
      /^(?:public\s+|private\s+|static\s+|void\s+|int\s+)*main\s*\([^)]*\)(?:\s*throws\s+[A-Za-z0-9_.,\s]+)?\s*(\{)?\s*$/
    );
    if (mainMatch) {
      const hasOpen = Boolean(mainMatch[1]);
      if (hasOpen) {
        braceStack.push("MAIN");
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
    const fnMatch = language === "python" ? trimmed.match(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:\s*$/) : trimmed.match(
      /^(?:(?:public|private|protected|static|final)\s+)*(?:function|void|int|long|double|float|boolean|bool|String|string)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)(?:\s*throws\s+[A-Za-z0-9_.,\s]+)?\s*(\{)?\s*$/
    );
    if (fnMatch && fnMatch[1] !== "main") {
      const fnName = fnMatch[1];
      const rawParams = fnMatch[2].split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
        const cleanP = p.split("=")[0].trim();
        const parts = cleanP.replace(/\[\s*\]/g, "").trim().split(/\s+/);
        return parts[parts.length - 1];
      });
      const paramList = rawParams.join(", ");
      const localCapObj = `{ ${rawParams.map((p) => `${JSON.stringify(p)}: ${p}`).join(", ")} }`;
      if (language === "python") {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}function ${fnName}(${paramList}) { __traceStep(${lineNum}, "METHOD_ENTRY", __cap(${localCapObj}), { subKind: "FUNC_ENTRY", fnName: ${JSON.stringify(
            fnName
          )} });`
        );
      } else {
        const hasOpen = Boolean(fnMatch[3]);
        if (hasOpen) braceStack.push("FUNC");
        processedLines.push(
          `${pyClosingPrefix}function ${fnName}(${paramList}) ${hasOpen ? "{" : ""} __traceStep(${lineNum}, "METHOD_ENTRY", __cap(${localCapObj}), { subKind: "FUNC_ENTRY", fnName: ${JSON.stringify(
            fnName
          )} });`
        );
      }
      continue;
    }
    const doWhileTailMatch = trimmed.match(/^(\}?\s*)while\s*\((.+)\)\s*;\s*$/);
    if (doWhileTailMatch && language !== "python") {
      if (doWhileTailMatch[1] && doWhileTailMatch[1].includes("}")) braceStack.pop();
      const rawCond = doWhileTailMatch[2].trim();
      const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
      processedLines.push(
        `${pyClosingPrefix}${doWhileTailMatch[1] || ""} while (__traceLoopCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
          rawCond
        )}, () => __cap()));`
      );
      continue;
    }
    const doOpenMatch = language !== "python" ? trimmed.match(/^do\s*(\{)?\s*$/) : null;
    if (doOpenMatch) {
      const hasOpen = Boolean(doOpenMatch[1]);
      if (hasOpen) braceStack.push("DO");
      processedLines.push(
        `${pyClosingPrefix}do ${hasOpen ? "{" : ""} __traceStep(${lineNum}, "LOOP_CHECK", __cap(), { subKind: "DO_LOOP", conditionExpr: "do-while", conditionResult: true });`
      );
      continue;
    }
    const whileMatch = language === "python" ? trimmed.match(/^while\s+(.+?)\s*:\s*$/) : trimmed.match(/^while\s*\((.+)\)\s*(\{)?\s*$/);
    if (whileMatch) {
      const rawCond = whileMatch[1].trim();
      const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
      if (language === "python") {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}while (__traceLoopCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) {`
        );
      } else {
        const brace = whileMatch[2] ? "{" : "";
        if (brace) braceStack.push("LOOP");
        processedLines.push(
          `${pyClosingPrefix}while (__traceLoopCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) ${brace}`
        );
      }
      continue;
    }
    if (language === "python") {
      const pyRangeMatch = trimmed.match(
        /^for\s+([A-Za-z_]\w*)\s+in\s+range\s*\(([^)]+)\)\s*:\s*$/
      );
      if (pyRangeMatch) {
        const loopVar = pyRangeMatch[1];
        const rangeArgs = pyRangeMatch[2].split(",").map((s) => s.trim());
        const startExpr = rangeArgs.length >= 2 ? rangeArgs[0] : "0";
        const stopExpr = rangeArgs.length >= 2 ? rangeArgs[1] : rangeArgs[0];
        const stepExpr = rangeArgs.length >= 3 ? rangeArgs[2] : "1";
        const cmpOp = stepExpr.startsWith("-") ? ">" : "<";
        const condDisplay = `${loopVar} ${cmpOp} ${stopExpr}`;
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
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
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
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
      const forEachMatch = trimmed.match(
        /^for\s*\(\s*(?:final\s+)?(?:[A-Za-z0-9_<>$\s]+)\s+([A-Za-z_$][\w$]*)\s*:\s*(.+?)\s*\)\s*(\{)?\s*$/
      );
      if (forEachMatch) {
        const loopVar = forEachMatch[1];
        const rawIter = forEachMatch[2].trim();
        const jsIter = normalizeExpressionToJs(rawIter, language, false, lineNum);
        const brace = forEachMatch[3] ? "{" : "";
        if (brace) braceStack.push("LOOP");
        seenVars.add(loopVar);
        processedLines.push(
          `${pyClosingPrefix}for (let ${loopVar} of (${jsIter})) ${brace} __traceStep(${lineNum}, "LOOP_CHECK", __cap({ [${JSON.stringify(
            loopVar
          )}]: ${loopVar} }), { conditionExpr: ${JSON.stringify(
            `${loopVar} in ${rawIter}`
          )}, conditionResult: true });`
        );
        continue;
      }
      const cForMatch = trimmed.match(
        /^for\s*\(\s*([^;]+);\s*([^;]+);\s*([^)]+)\)\s*(\{)?\s*$/
      );
      if (cForMatch) {
        const rawInit = cForMatch[1].trim();
        const rawCond = cForMatch[2].trim();
        const rawStep = cForMatch[3].trim();
        const brace = cForMatch[4] ? "{" : "";
        if (brace) braceStack.push("LOOP");
        const initAssignMatch = rawInit.match(
          /^(?:(?:let|const|var|int|long|short|size_t|auto)\s+)?([A-Za-z_$][\w$]*)\s*=\s*(.+)$/
        );
        const targetVar = initAssignMatch ? initAssignMatch[1] : void 0;
        const initRhs = initAssignMatch ? initAssignMatch[2].trim() : rawInit;
        const cleanInitJs = initAssignMatch ? `${targetVar} = ${normalizeExpressionToJs(
          initRhs,
          language,
          Boolean(targetVar && intVars.has(targetVar)),
          lineNum
        )}` : rawInit.replace(/^\b(?:let|const|var|int|long|short|size_t|auto)\s+/, "");
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
    const elseIfMatch = language === "python" ? trimmed.match(/^elif\s+(.+?)\s*:\s*$/) : trimmed.match(/^(\}?\s*)else\s+if\s*\((.+)\)\s*(\{)?\s*$/);
    if (elseIfMatch) {
      if (language === "python") {
        const rawCond = elseIfMatch[1].trim();
        const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}else if (__traceCondCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) {`
        );
      } else {
        const leadBrace = elseIfMatch[1] || "";
        if (leadBrace.includes("}")) braceStack.pop();
        const rawCond = elseIfMatch[2].trim();
        const trailBrace = elseIfMatch[3] ? "{" : "";
        if (trailBrace) braceStack.push("COND");
        const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
        processedLines.push(
          `${pyClosingPrefix}${leadBrace} else if (__traceCondCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) ${trailBrace}`
        );
      }
      continue;
    }
    const ifMatch = language === "python" ? trimmed.match(/^if\s+(.+?)\s*:\s*$/) : trimmed.match(/^if\s*\((.+)\)\s*(\{)?\s*$/);
    if (ifMatch) {
      const rawCond = ifMatch[1].trim();
      const jsCond = normalizeExpressionToJs(rawCond, language, false, lineNum);
      if (language === "python") {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}if (__traceCondCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) {`
        );
      } else {
        const brace = ifMatch[2] ? "{" : "";
        if (brace) braceStack.push("COND");
        processedLines.push(
          `${pyClosingPrefix}if (__traceCondCheck(${lineNum}, () => (${jsCond}), ${JSON.stringify(
            rawCond
          )}, () => __cap())) ${brace}`
        );
      }
      continue;
    }
    const elseMatch = language === "python" ? trimmed.match(/^else\s*:\s*$/) : trimmed.match(/^(\}?\s*)else\s*(\{)?\s*$/);
    if (elseMatch) {
      if (language === "python") {
        const indentSpaces = (rawLine.match(/^\s*/)?.[0] || "").replace(/\t/g, "    ").length;
        pyIndentStack.push(indentSpaces + 4);
        processedLines.push(
          `${pyClosingPrefix}else { __traceStep(${lineNum}, "CONDITION_CHECK", __cap(), { subKind: "ELSE_BRANCH", conditionExpr: "else", conditionResult: true });`
        );
      } else {
        const leadBrace = elseMatch[1] || "";
        if (leadBrace.includes("}")) braceStack.pop();
        const trailBrace = elseMatch[2] ? "{" : "";
        if (trailBrace) braceStack.push("COND");
        processedLines.push(
          `${pyClosingPrefix}${leadBrace} else ${trailBrace} ${trailBrace ? `__traceStep(${lineNum}, "CONDITION_CHECK", __cap(), { subKind: "ELSE_BRANCH", conditionExpr: "else", conditionResult: true });` : ""}`
        );
      }
      continue;
    }
    const switchMatch = language !== "python" ? trimmed.match(/^switch\s*\((.+)\)\s*(\{)?\s*$/) : null;
    if (switchMatch) {
      const rawExpr = switchMatch[1].trim();
      const jsExpr = normalizeExpressionToJs(rawExpr, language, false, lineNum);
      const brace = switchMatch[2] ? "{" : "";
      if (brace) braceStack.push("SWITCH");
      processedLines.push(
        `${pyClosingPrefix}switch ((() => { const __sw = (${jsExpr}); __traceStep(${lineNum}, "CONDITION_CHECK", __cap(), { subKind: "SWITCH_ENTER", conditionExpr: ${JSON.stringify(
          `switch (${rawExpr})`
        )}, conditionResult: true }); return __sw; })()) ${brace}`
      );
      continue;
    }
    const caseMatch = language !== "python" ? trimmed.match(/^case\s+([^:]+):\s*(.*)$/) : null;
    if (caseMatch) {
      const rawVal = caseMatch[1].trim();
      const jsVal = normalizeExpressionToJs(rawVal, language, false, lineNum);
      const rest = caseMatch[2].trim();
      let restJs = "";
      if (rest) {
        const restClean = rest.replace(/;\s*break\s*;?$/, ";").replace(/;$/, "");
        const hasBreak = /\bbreak\s*;?\s*$/.test(rest);
        if (restClean && restClean !== "break") {
          restJs = `${normalizeExpressionToJs(restClean, language, false, lineNum)}; `;
        }
        if (hasBreak) restJs += "break;";
      }
      processedLines.push(
        `${pyClosingPrefix}case ${jsVal}: __traceStep(${lineNum}, "CONDITION_CHECK", __cap(), { subKind: "CASE_MATCH", conditionExpr: ${JSON.stringify(
          `case ${rawVal}`
        )}, conditionResult: true }); ${restJs}`
      );
      continue;
    }
    const defaultCaseMatch = language !== "python" ? trimmed.match(/^default\s*:\s*(.*)$/) : null;
    if (defaultCaseMatch) {
      const rest = defaultCaseMatch[1].trim();
      let restJs = "";
      if (rest) {
        const restClean = rest.replace(/;\s*break\s*;?$/, ";").replace(/;$/, "");
        const hasBreak = /\bbreak\s*;?\s*$/.test(rest);
        if (restClean && restClean !== "break") {
          restJs = `${normalizeExpressionToJs(restClean, language, false, lineNum)}; `;
        }
        if (hasBreak) restJs += "break;";
      }
      processedLines.push(
        `${pyClosingPrefix}default: __traceStep(${lineNum}, "CONDITION_CHECK", __cap(), { subKind: "DEFAULT_CASE", conditionExpr: "default", conditionResult: true }); ${restJs}`
      );
      continue;
    }
    const stackTraceMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\.printStackTrace\s*\(\s*\)\s*;?\s*$/);
    if (stackTraceMatch) {
      processedLines.push(
        `${pyClosingPrefix}__printLine(${lineNum}, String(${stackTraceMatch[1]}), () => __cap());`
      );
      continue;
    }
    const javaPrintlnMatch = trimmed.match(/^System\.(?:out|err)\.println\s*\((.*)\)\s*;?\s*$/);
    if (javaPrintlnMatch) {
      const argExpr = javaPrintlnMatch[1].trim() ? normalizeExpressionToJs(javaPrintlnMatch[1], language, false, lineNum) : '""';
      processedLines.push(
        `${pyClosingPrefix}__printLine(${lineNum}, __checkNum((${argExpr}), ${lineNum}, () => __cap()), () => __cap());`
      );
      continue;
    }
    const javaPrintMatch = trimmed.match(/^System\.(?:out|err)\.print\s*\((.*)\)\s*;?\s*$/);
    if (javaPrintMatch) {
      const argExpr = javaPrintMatch[1].trim() ? normalizeExpressionToJs(javaPrintMatch[1], language, false, lineNum) : '""';
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
      const fn = hasNewline ? "__printLine" : "__print";
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
    const pyPrintMatch = language === "python" ? trimmed.match(/^print\s*\((.*)\)\s*$/) : null;
    if (pyPrintMatch) {
      const rawArgs = normalizeExpressionToJs(pyPrintMatch[1].trim(), language, false, lineNum);
      processedLines.push(
        `${pyClosingPrefix}__printLine(${lineNum}, [${rawArgs}].map(__fmtOut).join(" "), () => __cap());`
      );
      continue;
    }
    const returnMatch = trimmed.match(/^return(?:\s+(.+?))?\s*;?\s*$/);
    if (returnMatch) {
      const retExpr = returnMatch[1]?.trim();
      if ((language === "cpp" || language === "java") && retExpr === "0") {
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
    if (language === "python") {
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
    const cppCinMatch = language === "cpp" ? trimmed.match(/^(?:std::)?cin\s*>>\s*(.+?)\s*;?\s*$/) : null;
    if (cppCinMatch) {
      const vars = cppCinMatch[1].split(">>").map((v) => v.trim()).filter((v) => /^[A-Za-z_$][\w$]*$/.test(v));
      if (vars.length > 0) {
        const cinStmts = vars.map((v) => {
          const isInt = intVars.has(v);
          seenVars.add(v);
          return `${v} = __cinRead(${JSON.stringify(isInt ? "int" : hasFloatType ? "float" : "auto")}); __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
            v
          )}, rhsExpr: "cin >> ${v}" });`;
        });
        processedLines.push(`${pyClosingPrefix}${cinStmts.join(" ")}`);
        continue;
      }
    }
    const multiDeclMatch = language !== "python" ? trimmed.match(
      /^(?:final\s+|static\s+)*(let|const|var|int|long|short|byte|float|double|boolean|bool|String|string|char)\s+([^;]+?)\s*;?\s*$/
    ) : null;
    if (multiDeclMatch && multiDeclMatch[2].includes(",")) {
      const declType = multiDeclMatch[1];
      const declBody = multiDeclMatch[2];
      const parts = [];
      let cur = "";
      let depth = 0;
      let inStr = null;
      for (let ci = 0; ci < declBody.length; ci++) {
        const ch = declBody[ci];
        if (inStr) {
          cur += ch;
          if (ch === inStr && declBody[ci - 1] !== "\\") inStr = null;
        } else if (ch === '"' || ch === "'" || ch === "`") {
          inStr = ch;
          cur += ch;
        } else if (ch === "(" || ch === "[" || ch === "{") {
          depth++;
          cur += ch;
        } else if (ch === ")" || ch === "]" || ch === "}") {
          depth = Math.max(0, depth - 1);
          cur += ch;
        } else if (ch === "," && depth === 0) {
          parts.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) parts.push(cur.trim());
      if (parts.length > 1 && parts.every((p) => /^[A-Za-z_$][\w$]*(\s*=\s*.+)?$/.test(p))) {
        const stmts = [];
        const isIntType = (language === "java" || language === "cpp") && /^(?:int|long|short|byte)$/.test(declType);
        for (const p of parts) {
          const eqIdx = p.indexOf("=");
          if (eqIdx >= 0) {
            const varName = p.slice(0, eqIdx).trim();
            const rawRhs = p.slice(eqIdx + 1).trim();
            if (isIntType) intVars.add(varName);
            seenVars.add(varName);
            const jsRhs = normalizeExpressionToJs(
              rawRhs,
              language,
              isIntType || intVars.has(varName),
              lineNum
            );
            stmts.push(
              `${varName} = ${jsRhs}; __traceStep(${lineNum}, "DECLARE", __cap(), { targetVar: ${JSON.stringify(
                varName
              )}, rhsExpr: ${JSON.stringify(rawRhs)} });`
            );
          } else {
            const varName = p.trim();
            if (isIntType) intVars.add(varName);
            seenVars.add(varName);
            stmts.push(
              `${varName} = null; __traceStep(${lineNum}, "DECLARE", __cap(), { targetVar: ${JSON.stringify(
                varName
              )} });`
            );
          }
        }
        processedLines.push(`${pyClosingPrefix}${stmts.join(" ")}`);
        continue;
      }
    }
    const typedDeclAssign = trimmed.match(
      /^(?:final\s+|static\s+)*(?:let|const|var|int|long|short|byte|float|double|boolean|bool|String|string|char|auto|FileReader|FileInputStream|BufferedReader|Scanner|Random|File|Object|Integer|Double|List|ArrayList|LinkedList|Map|HashMap|TreeMap|Set|HashSet|TreeSet|Queue|Deque|Stack|PriorityQueue|vector\s*<[^>]+>|(?:[A-Za-z_$][\w$]*\s*<[^>]+>)|(?:[A-Z][A-Za-z0-9_$]*))\s*(?:\[\s*\])?\s+([A-Za-z_$][\w$]*)\s*(?:\[\s*\])?\s*=\s*(.+?)\s*;?\s*$/
    );
    if (typedDeclAssign) {
      const varName = typedDeclAssign[1];
      const rawRhs = typedDeclAssign[2].trim();
      const isInt = (language === "java" || language === "cpp") && (intVars.has(varName) || !hasFloatType && /^(?:final\s+|static\s+)*(?:int|long|short|byte)\b/.test(trimmed));
      if (isInt) intVars.add(varName);
      const jsRhs = normalizeExpressionToJs(rawRhs, language, isInt, lineNum);
      const actType = "DECLARE";
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
    const typedDeclOnly = trimmed.match(
      /^(?:let|var|int|long|short|byte|float|double|boolean|bool|String|string|char|FileReader|Scanner|Random|File|List|ArrayList|Map|HashMap|vector\s*<[^>]+>|(?:[A-Za-z_$][\w$]*\s*<[^>]+>)|(?:[A-Z][A-Za-z0-9_$]*))\s+([A-Za-z_$][\w$]*)\s*;?\s*$/
    );
    if (typedDeclOnly) {
      const varName = typedDeclOnly[1];
      seenVars.add(varName);
      const initVal = trimmed.startsWith("vector") || trimmed.includes("ArrayList") ? "[]" : "null";
      processedLines.push(
        `${pyClosingPrefix}${varName} = ${initVal}; __traceStep(${lineNum}, "DECLARE", __cap(), { targetVar: ${JSON.stringify(
          varName
        )} });`
      );
      continue;
    }
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
    const compoundMatch = trimmed.match(
      /^([A-Za-z_$][\w$]*)\s*(\+=|-=|\*=|\/=|%=)\s*(.+?)\s*;?\s*$/
    );
    if (compoundMatch) {
      const [, varName, op, rawRhs] = compoundMatch;
      const isInt = (language === "java" || language === "cpp") && intVars.has(varName);
      const jsRhs = normalizeExpressionToJs(rawRhs, language, false, lineNum);
      const stmtJs = isInt && op === "/=" ? `${varName} = __toInt(${varName} / (${jsRhs}), ${lineNum}, () => __cap())` : `${varName} ${op} (${jsRhs})`;
      processedLines.push(
        `${pyClosingPrefix}${stmtJs}; __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
          varName
        )}, rhsExpr: ${JSON.stringify(`${varName} ${op} ${rawRhs}`)} });`
      );
      continue;
    }
    const incDecMatch = trimmed.match(
      /^(?:(\+\+|--)([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)(\+\+|--))\s*;?\s*$/
    );
    if (incDecMatch) {
      const varName = incDecMatch[2] || incDecMatch[3];
      const cleanStmt = trimmed.replace(/;$/, "");
      processedLines.push(
        `${pyClosingPrefix}${cleanStmt}; __traceStep(${lineNum}, "ASSIGN", __cap(), { targetVar: ${JSON.stringify(
          varName
        )}, rhsExpr: ${JSON.stringify(cleanStmt)} });`
      );
      continue;
    }
    const plainAssignMatch = trimmed.match(
      /^([A-Za-z_$][\w$]*)\s*=(?!=)\s*(.+?)\s*;?\s*$/
    );
    if (plainAssignMatch) {
      const [, varName, rawRhs] = plainAssignMatch;
      const isInt = (language === "java" || language === "cpp") && intVars.has(varName);
      const jsRhs = normalizeExpressionToJs(rawRhs, language, isInt, lineNum);
      const actType = language === "python" && !seenVars.has(varName) ? "DECLARE" : "ASSIGN";
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
    const closeCallMatch = trimmed.match(/^([A-Za-z_$][\w$]*)\.close\s*\(\s*\)\s*;?\s*$/);
    if (closeCallMatch) {
      const targetVar = closeCallMatch[1];
      processedLines.push(
        `${pyClosingPrefix}${targetVar}?.close?.(); __traceStep(${lineNum}, "ASSIGN", __cap(), { subKind: "CLOSE_RESOURCE", targetVar: ${JSON.stringify(
          targetVar
        )}, rhsExpr: "close()" });`
      );
      continue;
    }
    const normStmt = normalizeExpressionToJs(trimmed.replace(/;$/, ""), language, false, lineNum);
    if (/^(?:break|continue)\b/.test(normStmt)) {
      processedLines.push(
        `${pyClosingPrefix}__traceStep(${lineNum}, "BLOCK_END", __cap(), { subKind: "LOOP_JUMP", conditionExpr: ${JSON.stringify(
          normStmt
        )} }); ${normStmt};`
      );
    } else if (normStmt === "pass") {
      processedLines.push(`${pyClosingPrefix}`);
    } else {
      processedLines.push(
        `${pyClosingPrefix}${normStmt}; __traceStep(${lineNum}, "ASSIGN", __cap());`
      );
    }
  }
  if (language === "python") {
    while (pyIndentStack.length > 1) {
      pyIndentStack.pop();
      processedLines.push("}");
    }
  }
  const varDeclHeader = varNames.length > 0 ? `var ${varNames.join(", ")};
` : "";
  const capHelper = `function __cap(extra) { return Object.assign({ ${captureEntries} }, extra || {}); }
`;
  const fullScript = `${varDeclHeader}${capHelper}${processedLines.join("\n")}`;
  try {
    new vm.Script(fullScript);
    return fullScript;
  } catch {
    return null;
  }
}
function runDeterministicMultiLanguage(code, language = "javascript", stdin = "", timeoutMs = 1200) {
  const commentFreeCode = stripCommentsPreservingLines(code, language);
  const cleanLines = commentFreeCode.split("\n").map((l) => l.trim());
  const { varNames, intVars, hasFloatType } = extractVariablesAndTypes(
    commentFreeCode,
    language
  );
  const logs = [];
  let inlineBuffer = "";
  const errors = [];
  const recordedSteps = [];
  const stdinLines = stdin.split("\n");
  let stdinIdx = 0;
  const stdinTokens = String(stdin || "").trim().split(/\s+/).filter(Boolean);
  let stdinTokIdx = 0;
  let lastStdinRead = null;
  let prevVarsSnapshot = {};
  const loopIterationCounts = /* @__PURE__ */ new Map();
  const flushInlineBufferToStdout = () => {
    const combined = [...logs];
    if (inlineBuffer) combined.push(inlineBuffer);
    return combined.join("\n");
  };
  const computeDelta = (currentVars, preferredVar) => {
    if (preferredVar && preferredVar in currentVars) {
      const oldVal = preferredVar in prevVarsSnapshot ? prevVarsSnapshot[preferredVar] : null;
      const newVal = currentVars[preferredVar];
      return {
        variable: preferredVar,
        oldValue: oldVal === void 0 ? null : cloneSafeValue(oldVal),
        newValue: cloneSafeValue(newVal)
      };
    }
    for (const [k, v] of Object.entries(currentVars)) {
      const oldVal = k in prevVarsSnapshot ? prevVarsSnapshot[k] : null;
      const oldStr = oldVal === null ? null : JSON.stringify(oldVal);
      const newStr = JSON.stringify(v);
      if (oldStr !== newStr) {
        return {
          variable: k,
          oldValue: oldVal === void 0 ? null : cloneSafeValue(oldVal),
          newValue: cloneSafeValue(v)
        };
      }
    }
    return null;
  };
  const recordStepInternal = (line, actionType, varsSnapshot, consoleOutOnThisStep = null, meta) => {
    if (recordedSteps.length >= 110) return;
    const cleanedVars = {};
    if (varsSnapshot && typeof varsSnapshot === "object") {
      for (const [k, v] of Object.entries(varsSnapshot)) {
        const cloned = cloneSafeValue(v);
        if (cloned !== void 0) {
          cleanedVars[k] = cloned;
        }
      }
    }
    const delta = actionType === "DECLARE" || actionType === "ASSIGN" || meta?.subKind === "CATCH_BLOCK" ? computeDelta(cleanedVars, meta?.targetVar) : null;
    const effectiveActionType = actionType === "DECLARE" && delta && delta.oldValue !== null ? "ASSIGN" : actionType;
    const effectiveMeta = lastStdinRead !== null && (effectiveActionType === "DECLARE" || effectiveActionType === "ASSIGN") ? { ...meta || {}, stdinRead: lastStdinRead } : meta;
    if (effectiveMeta?.stdinRead !== void 0) {
      lastStdinRead = null;
    }
    const snippet = cleanLines[line - 1] || "";
    recordedSteps.push({
      line,
      actionType: effectiveActionType,
      codeSnippet: snippet,
      variables: cleanedVars,
      memoryDelta: delta,
      consoleOutput: consoleOutOnThisStep,
      stdoutSoFar: flushInlineBufferToStdout(),
      meta: effectiveMeta
    });
    prevVarsSnapshot = { ...cleanedVars };
  };
  const throwSandboxException = (line, excType, msg, capFn) => {
    const cleanMsg = String(msg ?? "");
    const errObj = new Error(`${excType}: ${cleanMsg}`);
    errObj.__exceptionType = excType;
    errObj.__shortMessage = cleanMsg;
    errObj.__line = line;
    errObj.getMessage = () => cleanMsg;
    errObj.toString = () => `${excType}: ${cleanMsg}`;
    if (capFn) {
      recordStepInternal(line, "CONDITION_CHECK", capFn(), null, {
        subKind: "EXCEPTION_THROWN",
        exceptionType: excType,
        exceptionMessage: cleanMsg
      });
    }
    throw errObj;
  };
  const createSandbox = () => ({
    console: {
      log: (...args) => {
        logs.push(
          args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")
        );
      },
      warn: (...args) => {
        logs.push(args.map(String).join(" "));
      },
      error: (...args) => {
        errors.push(args.map(String).join(" "));
      }
    },
    prompt: () => {
      const val = stdinLines[stdinIdx++] ?? "";
      lastStdinRead = String(val);
      return val;
    },
    input: () => {
      const val = stdinLines[stdinIdx++] ?? "";
      lastStdinRead = String(val);
      return val;
    },
    require: (modName) => {
      try {
        if (modName === "crypto" || modName === "node:crypto") return __require("node:crypto");
        if (modName === "util" || modName === "node:util") return __require("node:util");
      } catch {
      }
      return {};
    },
    crypto: globalThis.crypto,
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
    Scanner: class Scanner {
      constructor(src) {
        this.idx = 0;
        this.closed = false;
        const rawSource = typeof src === "string" ? src : String(stdin || "");
        this.tokens = rawSource.trim().split(/\s+/).filter(Boolean);
      }
      hasNext() {
        return !this.closed && this.idx < this.tokens.length;
      }
      hasNextInt() {
        return this.hasNext() && !Number.isNaN(Number(this.tokens[this.idx]));
      }
      next() {
        const v = this.tokens[this.idx++] ?? "";
        lastStdinRead = String(v);
        return v;
      }
      nextInt() {
        const raw = this.tokens[this.idx++] ?? "0";
        lastStdinRead = String(raw);
        return Number.parseInt(raw, 10);
      }
      nextLong() {
        const raw = this.tokens[this.idx++] ?? "0";
        lastStdinRead = String(raw);
        return Number.parseInt(raw, 10);
      }
      nextDouble() {
        const raw = this.tokens[this.idx++] ?? "0";
        lastStdinRead = String(raw);
        return Number.parseFloat(raw);
      }
      nextFloat() {
        const raw = this.tokens[this.idx++] ?? "0";
        lastStdinRead = String(raw);
        return Number.parseFloat(raw);
      }
      nextBoolean() {
        const raw = String(this.tokens[this.idx++] ?? "false");
        lastStdinRead = raw;
        return raw.toLowerCase() === "true";
      }
      nextLine() {
        const v = stdinLines[stdinIdx++] ?? (this.tokens[this.idx++] ?? "");
        lastStdinRead = String(v);
        return v;
      }
      close() {
        this.closed = true;
      }
      toJSON() {
        return this.closed ? "Scanner(closed)" : "Scanner(System.in)";
      }
    },
    Random: class Random {
      constructor(seed) {
        this.seed = typeof seed === "number" ? seed : Date.now();
      }
      next() {
        this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
        return (this.seed >>> 0) / 4294967296;
      }
      nextInt(bound) {
        const r = this.next();
        if (typeof bound === "number" && bound > 0) {
          return Math.floor(r * bound);
        }
        return Math.floor(r * 2147483647);
      }
      nextDouble() {
        return this.next();
      }
      nextBoolean() {
        return this.next() >= 0.5;
      }
      toJSON() {
        return `Random(seed=${this.seed})`;
      }
    },
    System: {
      in: {},
      out: {
        println: (...args) => {
          logs.push(args.map(String).join(" "));
        },
        print: (...args) => {
          inlineBuffer += args.map(String).join(" ");
        }
      },
      err: {
        println: (...args) => {
          errors.push(args.map(String).join(" "));
        }
      }
    },
    ArrayList: class ArrayList extends Array {
      get(i) {
        return this[i];
      }
      set(i, val) {
        this[i] = val;
        return val;
      }
      add(val) {
        this.push(val);
        return true;
      }
      size() {
        return this.length;
      }
      isEmpty() {
        return this.length === 0;
      }
      contains(val) {
        return this.includes(val);
      }
      remove(i) {
        if (typeof i === "number") {
          const removed = this.splice(i, 1);
          return removed[0];
        }
        const idx = this.indexOf(i);
        if (idx >= 0) {
          this.splice(idx, 1);
          return true;
        }
        return false;
      }
      clear() {
        this.length = 0;
      }
    },
    HashMap: class HashMap {
      constructor() {
        this.map = new globalThis.Map();
      }
      put(k, v) {
        this.map.set(k, v);
        return v;
      }
      get(k) {
        return this.map.get(k);
      }
      getOrDefault(k, def) {
        return this.map.has(k) ? this.map.get(k) : def;
      }
      containsKey(k) {
        return this.map.has(k);
      }
      keySet() {
        return Array.from(this.map.keys());
      }
      values() {
        return Array.from(this.map.values());
      }
      entrySet() {
        return Array.from(this.map.entries());
      }
      size() {
        return this.map.size;
      }
      isEmpty() {
        return this.map.size === 0;
      }
      remove(k) {
        return this.map.delete(k);
      }
      clear() {
        this.map.clear();
      }
      toJSON() {
        return Object.fromEntries(this.map);
      }
      toString() {
        return JSON.stringify(Object.fromEntries(this.map));
      }
    },
    Collections: {
      sort: (list, comparator) => {
        if (Array.isArray(list)) {
          if (typeof comparator === "function") {
            list.sort(comparator);
          } else {
            list.sort((a, b) => typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));
          }
        }
      },
      reverse: (list) => {
        if (Array.isArray(list)) list.reverse();
      },
      min: (list) => Array.isArray(list) ? Math.min(...list) : null,
      max: (list) => Array.isArray(list) ? Math.max(...list) : null,
      swap: (list, i, j) => {
        if (Array.isArray(list)) {
          const tmp = list[i];
          list[i] = list[j];
          list[j] = tmp;
        }
      }
    },
    __toInt: (val, line = 1, capFn) => {
      if (typeof val === "number") {
        if (!Number.isFinite(val)) {
          const excName = language === "python" ? "ZeroDivisionError" : "ArithmeticException";
          throwSandboxException(line, excName, "/ by zero", capFn);
        }
        return Math.trunc(val);
      }
      return val;
    },
    __checkNum: (val, line = 1, capFn) => {
      if (typeof val === "number" && !Number.isFinite(val) && (language === "java" || language === "cpp" || language === "python")) {
        const excName = language === "python" ? "ZeroDivisionError" : "ArithmeticException";
        throwSandboxException(line, excName, "/ by zero", capFn);
      }
      return val;
    },
    __openFile: (line, filePath, capFn) => {
      const nameStr = String(filePath ?? "file.txt");
      const excName = language === "python" ? "FileNotFoundError" : "FileNotFoundException";
      throwSandboxException(
        line,
        excName,
        `${nameStr} (No such file or directory)`,
        capFn
      );
    },
    __parseIntJava: (line, strVal, capFn) => {
      const parsed = Number.parseInt(String(strVal).trim(), 10);
      if (Number.isNaN(parsed)) {
        throwSandboxException(
          line,
          "NumberFormatException",
          `For input string: "${strVal}"`,
          capFn
        );
      }
      return parsed;
    },
    __parseDoubleJava: (line, strVal, capFn) => {
      const parsed = Number.parseFloat(String(strVal).trim());
      if (Number.isNaN(parsed)) {
        throwSandboxException(
          line,
          "NumberFormatException",
          `For input string: "${strVal}"`,
          capFn
        );
      }
      return parsed;
    },
    __throwException: (line, excType, msg, capFn) => {
      throwSandboxException(line, excType, String(msg ?? ""), capFn);
    },
    __matchException: (err, expectedTypeStr) => {
      if (!expectedTypeStr || expectedTypeStr === "...") return true;
      const expectedList = expectedTypeStr.split("|").map((s) => s.trim().split(".").pop() || "");
      const actual = err?.__exceptionType || (String(err?.message || "").includes("null") ? "NullPointerException" : "RuntimeException");
      for (const exp of expectedList) {
        if (exp === "Exception" || exp === "Throwable" || exp === "RuntimeException" || exp === "Error" || exp === actual) {
          return true;
        }
        if (exp === "IOException" && actual === "FileNotFoundException") {
          return true;
        }
        if (exp === "IndexOutOfBoundsException" && actual === "ArrayIndexOutOfBoundsException") {
          return true;
        }
      }
      return false;
    },
    __fmtException: (err) => {
      if (!err) return "Exception";
      if (err.__exceptionType) {
        return `${err.__exceptionType}: ${err.__shortMessage || err.message}`;
      }
      if (String(err.message || "").includes("null")) {
        return "NullPointerException: Cannot invoke method on null reference";
      }
      return String(err.message || err);
    },
    __fmtOut: (val) => typeof val === "object" && val !== null ? JSON.stringify(val) : String(val),
    __cinRead: (kind = "auto") => {
      const raw = stdinTokens[stdinTokIdx++] ?? "0";
      lastStdinRead = String(raw);
      if (kind === "int") return Number.parseInt(raw, 10) || 0;
      if (kind === "float") return Number.parseFloat(raw) || 0;
      const n = Number(raw);
      return raw !== "" && !Number.isNaN(n) ? n : raw;
    },
    __traceStep: (line, actionType, varsSnapshot, meta) => {
      recordStepInternal(line, actionType, varsSnapshot, null, meta);
    },
    __traceLoopCheck: (line, condFn, condText, capFn) => {
      const result = Boolean(condFn());
      const prevIter = loopIterationCounts.get(line) || 0;
      const currentIter = result ? prevIter + 1 : prevIter;
      if (result) loopIterationCounts.set(line, currentIter);
      recordStepInternal(line, "LOOP_CHECK", capFn(), null, {
        conditionExpr: condText,
        conditionResult: result,
        iteration: currentIter
      });
      return result;
    },
    __traceCondCheck: (line, condFn, condText, capFn) => {
      const result = Boolean(condFn());
      recordStepInternal(line, "CONDITION_CHECK", capFn(), null, {
        conditionExpr: condText,
        conditionResult: result
      });
      return result;
    },
    __printLine: (line, val, capFn) => {
      const text = inlineBuffer + (typeof val === "object" && val !== null ? JSON.stringify(val) : String(val));
      inlineBuffer = "";
      logs.push(text);
      recordStepInternal(line, "OUTPUT", capFn(), text, {
        printedText: text
      });
    },
    __print: (line, val, capFn) => {
      const text = typeof val === "object" && val !== null ? JSON.stringify(val) : String(val);
      inlineBuffer += text;
      recordStepInternal(line, "OUTPUT", capFn(), text, {
        printedText: text
      });
    }
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
      const finalVariables = recordedSteps.length > 0 ? { ...recordedSteps[recordedSteps.length - 1].variables } : {};
      for (const [k, v] of Object.entries(sandbox)) {
        if (!IGNORED_SANDBOX_KEYS.has(k) && typeof v !== "function" && v !== void 0) {
          const cloned = cloneSafeValue(v);
          if (cloned !== void 0) finalVariables[k] = cloned;
        }
      }
      return {
        stdout: flushInlineBufferToStdout(),
        stderr: errors.join("\n"),
        timedOut: false,
        runtimeError: null,
        finalVariables,
        recordedSteps,
        cleanLines
      };
    } catch (err) {
      const msg = String(err?.message || err);
      const isTimeout = msg.includes("Script execution timed out") || msg.includes("timed out");
      if (isTimeout || recordedSteps.length > 0) {
        return {
          stdout: flushInlineBufferToStdout(),
          stderr: msg,
          timedOut: isTimeout,
          runtimeError: isTimeout ? null : msg,
          runtimeErrorLine: err?.__line,
          finalVariables: recordedSteps.length > 0 ? recordedSteps[recordedSteps.length - 1].variables : {},
          recordedSteps,
          cleanLines
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
        cleanLines
      };
    }
  }
  if (language === "javascript") {
    logs.length = 0;
    inlineBuffer = "";
    errors.length = 0;
    stdinIdx = 0;
    const plainSandbox = createSandbox();
    vm.createContext(plainSandbox);
    try {
      const inspectableCode = commentFreeCode.replace(/\b(let|const)\s+/g, "var ");
      const script = new vm.Script(inspectableCode);
      script.runInContext(plainSandbox, { timeout: timeoutMs });
      const finalVariables = {};
      for (const [k, v] of Object.entries(plainSandbox)) {
        if (!IGNORED_SANDBOX_KEYS.has(k) && typeof v !== "function" && v !== void 0) {
          const cloned = cloneSafeValue(v);
          if (cloned !== void 0) finalVariables[k] = cloned;
        }
      }
      return {
        stdout: flushInlineBufferToStdout(),
        stderr: errors.join("\n"),
        timedOut: false,
        runtimeError: null,
        finalVariables,
        recordedSteps: [],
        cleanLines
      };
    } catch (err) {
      const msg = String(err?.message || err);
      const isTimeout = msg.includes("Script execution timed out") || msg.includes("timed out");
      return {
        stdout: flushInlineBufferToStdout(),
        stderr: msg,
        timedOut: isTimeout,
        runtimeError: isTimeout ? null : msg,
        finalVariables: {},
        recordedSteps: [],
        cleanLines
      };
    }
  }
  return {
    stdout: "",
    stderr: "",
    timedOut: false,
    runtimeError: null,
    finalVariables: {},
    recordedSteps: [],
    cleanLines
  };
}
function buildLineNotesFromCode(code, explainLanguage, conceptBn, conceptEn) {
  return code.split("\n").map((raw, idx) => ({ raw: raw.trim(), line: idx + 1 })).filter((item) => item.raw.length > 0).map((item) => ({
    line: item.line,
    role: item.raw.includes("while") || item.raw.includes("for") ? "loop" : item.raw.includes("if") ? "condition" : item.raw.includes("return") ? "return" : item.raw.includes("log") || item.raw.includes("print") || item.raw.includes("cout") ? "output" : item.raw.includes("=") ? "assign" : "call",
    text: explainLanguage === "bn" ? `\u09B2\u09BE\u0987\u09A8 ${item.line} (\`${item.raw.slice(0, 34)}\`): ${conceptBn}` : `Line ${item.line} (\`${item.raw.slice(0, 34)}\`): ${conceptEn}`
  }));
}
function normalizeSnippet(s) {
  return s.replace(/\s+/g, " ").trim();
}
function detectProblemAndFaultState(code) {
  const norm = normalizeSnippet(code);
  const langs = ["javascript", "python", "cpp", "java"];
  const skipIds = /* @__PURE__ */ new Set(["swap_variables", "bubble_sort", "while_missing_increment"]);
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
function matchCuratedLibraryProblemTrace(params) {
  const { code, language, explainLanguage } = params;
  const matched = detectProblemAndFaultState(code);
  if (!matched) return null;
  const { prob, isFaulty } = matched;
  const traceSource = language === "cpp" || language === "java" ? "ai_predicted" : "real_execution";
  let steps = [];
  let finalOutput = "";
  switch (prob.id) {
    case "reverse_array":
    case "linear_search":
    case "array_maximum": {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: "pointer_arrows",
          action: "declare",
          explanation: explainLanguage === "bn" ? `${prob.title_bn}: \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 \`[10, 20, 30, 40]\` \u098F\u09AC\u0982 \u09AA\u09CD\u09B0\u09BE\u09B0\u09AE\u09CD\u09AD\u09BF\u0995 \u09AA\u09AF\u09BC\u09C7\u09A8\u09CD\u099F\u09BE\u09B0 \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964` : `${prob.title_en}: Initialized array and pointers.`,
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [
            { name: "left", from: null, to: 0 },
            { name: "right", from: null, to: 3 }
          ],
          variables: { arr: [10, 20, 30, 40], left: 0, right: 3 },
          fault: null,
          structure: { kind: "array", values: [10, 20, 30, 40], pointers: { left: 0, right: 3 } }
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: "pointer_arrows",
          action: isFaulty ? "halt" : "swap",
          explanation: isFaulty ? explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en : explainLanguage === "bn" ? "\u09A6\u09C1\u0987 \u09AA\u09CD\u09B0\u09BE\u09A8\u09CD\u09A4\u09C7\u09B0 \u09AE\u09BE\u09A8 \u0985\u09A6\u09B2\u09AC\u09A6\u09B2 \u0995\u09B0\u09C7 \u09AA\u09AF\u09BC\u09C7\u09A8\u09CD\u099F\u09BE\u09B0 \u09A6\u09C1\u099F\u09BF \u09AE\u09BE\u099D\u0996\u09BE\u09A8\u09C7 (`left = 1, right = 2`) \u098F\u0997\u09BF\u09DF\u09C7 \u098F\u09B2 \u098F\u09AC\u0982 \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 `[40, 30, 20, 10]` \u09B9\u09B2\u09CB\u0964" : "Swapped outer and inner pairs using `left` and `right` pointers to produce `[40, 30, 20, 10]`.",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [
            {
              name: "arr",
              from: "[10, 20, 30, 40]",
              to: isFaulty ? "[10, 20, 30, 40]" : "[40, 30, 20, 10]"
            }
          ],
          variables: {
            arr: isFaulty ? [10, 20, 30, 40] : [40, 30, 20, 10],
            left: 1,
            right: 2
          },
          fault: isFaulty ? {
            type: "off_by_one",
            message: explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en,
            fixHint: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en
          } : null,
          structure: {
            kind: "array",
            values: isFaulty ? [10, 20, 30, 40] : [40, 30, 20, 10],
            pointers: { left: 1, right: 2 },
            swapping: [0, 3]
          }
        }
      ];
      finalOutput = isFaulty ? "Fault halted" : "[40, 30, 20, 10]";
      break;
    }
    case "binary_search": {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: "binary_search_cards",
          action: "declare",
          explanation: explainLanguage === "bn" ? "\u09B8\u09BE\u099C\u09BE\u09A8\u09CB \u0985\u09CD\u09AF\u09BE\u09B0\u09C7 `[2, 5, 8, 12, 16, 23, 38]`-\u098F `low = 0`, `high = 6` \u098F\u09AC\u0982 \u09AE\u09BE\u099D\u0996\u09BE\u09A8\u09C7\u09B0 \u0995\u09BE\u09B0\u09CD\u09A1 `mid = 3` (`12`) \u0986\u09B2\u09CB\u0995\u09BF\u09A4 \u09B9\u09B2\u09CB\u0964" : "Illuminated middle card `mid = 3` (`12`) inside sorted range `[0..6]`.",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "mid", from: null, to: 3 }],
          variables: { arr: [2, 5, 8, 12, 16, 23, 38], low: 0, high: 6, mid: 3, target: 12 },
          fault: null,
          structure: { kind: "array", values: [2, 5, 8, 12, 16, 23, 38], highlight: [3] }
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: "binary_search_cards",
          action: isFaulty ? "halt" : "compare",
          explanation: isFaulty ? explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en : explainLanguage === "bn" ? "`mid = 3` \u0987\u09A8\u09A1\u09C7\u0995\u09CD\u09B8\u09C7 \u0995\u09BE\u0999\u09CD\u0995\u09CD\u09B7\u09BF\u09A4 \u09B8\u0982\u0996\u09CD\u09AF\u09BE `12` \u09AA\u09BE\u0993\u09DF\u09BE \u0997\u09C7\u099B\u09C7!" : "Target `12` matched at index `mid = 3`!",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "found", from: null, to: isFaulty ? -1 : 3 }],
          variables: {
            arr: [2, 5, 8, 12, 16, 23, 38],
            low: isFaulty ? 0 : 3,
            high: isFaulty ? 6 : 3,
            mid: 3,
            target: 12,
            found: isFaulty ? -1 : 3
          },
          fault: isFaulty ? {
            type: "infinite_loop",
            message: explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en,
            fixHint: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en
          } : null,
          structure: { kind: "array", values: [2, 5, 8, 12, 16, 23, 38], highlight: [3] }
        }
      ];
      finalOutput = isFaulty ? "Halted: Infinite loop at mid = 3" : "Found: 12 at 3";
      break;
    }
    case "stack_brackets": {
      steps = [
        {
          stepIndex: 1,
          activeLine: 2,
          analogyType: "stack_plates",
          action: "push",
          explanation: explainLanguage === "bn" ? "\u0996\u09CB\u09B2\u09BE \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F `(` \u098F\u09AC\u0982 `[` \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995\u09C7\u09B0 \u0989\u09AA\u09B0\u09C7 \u09AA\u09CD\u09B2\u09C7\u099F\u09C7\u09B0 \u09AE\u09A4\u09CB \u09AA\u09C1\u09B6 (`push`) \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964" : "Pushed opening brackets `(` and `[` onto the top of the LIFO plate stack.",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "stackSize", from: 0, to: 2 }],
          variables: { st: ["(", "["], valid: true },
          fault: null,
          structure: { kind: "stack", values: ["(", "["] }
        },
        {
          stepIndex: 2,
          activeLine: 5,
          analogyType: "stack_plates",
          action: isFaulty ? "halt" : "pop",
          explanation: isFaulty ? explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en : explainLanguage === "bn" ? "\u09AC\u09A8\u09CD\u09A7 \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F `]` \u098F\u09AC\u0982 `)` \u09AE\u09BF\u09B2\u09C7 \u09AF\u09BE\u0993\u09DF\u09BE\u09DF \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995\u09C7\u09B0 \u09B8\u09AC \u09AA\u09CD\u09B2\u09C7\u099F \u09AA\u09AA (`pop`) \u09B9\u09DF\u09C7 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995 \u0996\u09BE\u09B2\u09BF \u0993 \u09B8\u09C1\u09B7\u09AE (`Balanced`) \u09B9\u09DF\u09C7\u099B\u09C7!" : "Popped matching `]` and `)`. Stack is empty (`size = 0`) and balanced!",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "stackSize", from: 2, to: isFaulty ? 1 : 0 }],
          variables: { st: isFaulty ? ["("] : [], valid: !isFaulty },
          fault: isFaulty ? {
            type: "off_by_one",
            message: explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en,
            fixHint: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en
          } : null,
          structure: { kind: "stack", values: isFaulty ? ["("] : [] }
        }
      ];
      finalOutput = isFaulty ? "Unbalanced stack!" : "Balanced, size: 0";
      break;
    }
    case "queue_bfs": {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: "queue_line",
          action: "enqueue",
          explanation: explainLanguage === "bn" ? "BFS \u0995\u09BF\u0989\u09B0 \u09AA\u09C7\u099B\u09A8\u09C7 (`REAR`) \u09A8\u09CB\u09A1 `A`, `B`, `C` \u098F\u09A8\u0995\u09BF\u0989 (`enqueue`) \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964" : "Enqueued nodes `A`, `B`, `C` at the rear of the FIFO queue.",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "queued", from: 0, to: 3 }],
          variables: { q: ["A", "B", "C"], visited: 1 },
          fault: null,
          structure: { kind: "queue", values: ["A", "B", "C"] }
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: "queue_line",
          action: isFaulty ? "halt" : "dequeue",
          explanation: isFaulty ? explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en : explainLanguage === "bn" ? "\u0995\u09BF\u0989\u09B0 \u09B8\u09BE\u09AE\u09A8\u09C7 (`FRONT`) \u09A5\u09C7\u0995\u09C7 `A` \u09A1\u09BF\u0995\u09BF\u0989 \u0995\u09B0\u09C7 \u09AA\u09CD\u09B0\u09A4\u09BF\u09AC\u09C7\u09B6\u09C0 \u09AD\u09BF\u099C\u09BF\u099F \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964" : "Dequeued `A` from the front of the queue and marked neighbors visited.",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "visited", from: 1, to: 3 }],
          variables: { q: isFaulty ? ["A", "B", "A", "B"] : ["B", "C"], front: "A", visited: 3 },
          fault: isFaulty ? {
            type: "infinite_loop",
            message: explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en,
            fixHint: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en
          } : null,
          structure: { kind: "queue", values: isFaulty ? ["A", "B", "A", "B"] : ["B", "C"] }
        }
      ];
      finalOutput = isFaulty ? "Infinite cycle in BFS queue" : "Visited nodes: 3";
      break;
    }
    case "linked_list_reverse": {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: "linked_list_train",
          action: "declare",
          explanation: explainLanguage === "bn" ? "\u09B2\u09BF\u0999\u09CD\u0995\u09A1 \u09B2\u09BF\u09B8\u09CD\u099F\u09C7\u09B0 \u09A4\u09BF\u09A8\u099F\u09BF \u099F\u09CD\u09B0\u09C7\u09A8 \u09AC\u0997\u09BF `10 -> 20 -> 30 -> NULL` \u09AA\u09CD\u09B0\u09B8\u09CD\u09A4\u09C1\u09A4 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964" : "Initialized train coaches `10 -> 20 -> 30 -> NULL`.",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "curr", from: null, to: 10 }],
          variables: { nodes: [10, 20, 30], prev: "NULL", curr: 10, nextTemp: 20 },
          fault: null,
          structure: { kind: "list", values: [10, 20, 30] }
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: "linked_list_train",
          action: isFaulty ? "halt" : "transfer",
          explanation: isFaulty ? explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en : explainLanguage === "bn" ? "`nextTemp`-\u098F \u09AA\u09B0\u09C7\u09B0 \u09AC\u0997\u09BF \u09AC\u09BE\u0981\u099A\u09BF\u09DF\u09C7 \u09B0\u09C7\u0996\u09C7 \u0995\u09BE\u09AA\u09B2\u09BE\u09B0 \u0998\u09C1\u09B0\u09BF\u09DF\u09C7 `30 -> 20 -> 10 -> NULL` \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964" : "Saved `nextTemp` and reversed couplers cleanly to `30 -> 20 -> 10 -> NULL`.",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "curr", from: 10, to: 20 }],
          variables: {
            nodes: isFaulty ? [10] : [30, 20, 10],
            prev: 10,
            curr: isFaulty ? "LOST" : 20
          },
          fault: isFaulty ? {
            type: "lost_value",
            message: explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en,
            fixHint: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en
          } : null,
          structure: { kind: "list", values: isFaulty ? [10] : [30, 20, 10] }
        }
      ];
      finalOutput = isFaulty ? "Broken chain: lost nodes 20 -> 30" : "New head: 20 prev: 10";
      break;
    }
    case "recursion_factorial":
    default: {
      steps = [
        {
          stepIndex: 1,
          activeLine: 1,
          analogyType: "recursion_tower",
          action: "call",
          explanation: explainLanguage === "bn" ? "\u09B0\u09BF\u0995\u09BE\u09B0\u09CD\u09B6\u09A8 \u0995\u09B2 \u09B8\u09CD\u099F\u09CD\u09AF\u09BE\u0995\u09C7 `fact(3) -> fact(2) -> fact(1)` \u09AB\u09CD\u09B0\u09C7\u09AE\u0997\u09C1\u09B2\u09CB \u09B8\u09CD\u09A4\u09B0\u09C7 \u09B8\u09CD\u09A4\u09B0\u09C7 \u099C\u09AE\u09BE \u09B9\u09B2\u09CB\u0964" : "Stacked recursive call frames `fact(3) -> fact(2) -> fact(1)` on the Call Tower.",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "n", from: 3, to: 1 }],
          variables: { callStack: ["fact(3)", "fact(2)", "fact(1)"], n: 1 },
          fault: null,
          structure: { kind: "stack", values: ["fact(3)", "fact(2)", "fact(1)"] }
        },
        {
          stepIndex: 2,
          activeLine: 4,
          analogyType: "recursion_tower",
          action: isFaulty ? "halt" : "return",
          explanation: isFaulty ? explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en : explainLanguage === "bn" ? "\u09AC\u09C7\u09B8 \u0995\u09C7\u09B8 `fact(1) = 1` \u09A5\u09C7\u0995\u09C7 \u09AB\u09CD\u09B0\u09C7\u09AE\u0997\u09C1\u09B2\u09CB \u09AB\u09BF\u09B0\u09C7 \u098F\u09B8\u09C7 `3 * 2 * 1 = 6` \u09AB\u09B2\u09BE\u09AB\u09B2 \u09A6\u09BF\u09B2!" : "Base case `fact(1) = 1` returned, unwinding the call stack to compute `3! = 6`.",
          why: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
          changes: [{ name: "result", from: 1, to: isFaulty ? "StackOverflow" : 6 }],
          variables: {
            callStack: isFaulty ? ["fact(3)", "fact(2)", "fact(1)", "fact(0)", "fact(-1) \u{1F4A5}"] : ["fact(3) \u2192 6"],
            result: isFaulty ? "StackOverflow" : 6
          },
          fault: isFaulty ? {
            type: "stack_overflow",
            message: explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en,
            fixHint: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en
          } : null,
          structure: {
            kind: "stack",
            values: isFaulty ? ["fact(3)", "fact(2)", "fact(1)", "fact(0)", "fact(-1) \u{1F4A5}"] : ["fact(3) \u2192 6"]
          }
        }
      ];
      finalOutput = isFaulty ? "Stack Overflow!" : "3! = 6";
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
      title: explainLanguage === "bn" ? prob.title_bn : prob.title_en,
      goal: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
      idea: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
      keyPoints: [
        explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
        explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en
      ],
      analogyStory: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
      complexity: {
        time: prob.id === "binary_search" ? "O(log n)" : "O(n)",
        space: prob.id === "recursion_factorial" || prob.id === "stack_brackets" ? "O(n)" : "O(1)",
        note: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en
      },
      commonMistakes: [explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en]
    },
    lineNotes: buildLineNotesFromCode(code, explainLanguage, prob.concept_bn, prob.concept_en),
    steps,
    finalOutput,
    outputExplanation: explainLanguage === "bn" ? prob.concept_bn : prob.concept_en,
    verdict: {
      status: isFaulty ? "logic_error" : "ok",
      message: isFaulty ? explainLanguage === "bn" ? prob.bugHint_bn : prob.bugHint_en : explainLanguage === "bn" ? "\u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09AD\u09BF\u099C\u09CD\u09AF\u09C1\u09AF\u09BC\u09BE\u09B2\u09BE\u0987\u099C \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" : "Visualized accurately."
    },
    programSummary: {
      totalExecutionSteps: steps.length,
      timeComplexity: prob.id === "binary_search" ? "O(log n)" : "O(n)",
      spaceComplexity: prob.id === "recursion_factorial" || prob.id === "stack_brackets" ? "O(n)" : "O(1)",
      finalOutput
    }
  };
}

// server/src/tracers/fallbackTracer.ts
var VALID_CODE_KEYWORDS = /\b(let|const|var|int|float|double|long|short|char|bool|boolean|void|string|String|auto|for|while|do|if|else|elif|switch|case|default|break|continue|pass|return|function|def|class|struct|public|private|protected|static|import|from|export|include|using|namespace|std|try|catch|except|finally|throw|throws|raise|console|print|printf|cout|cin|System|FileReader|Scanner|File|main|new|true|false|True|False|null|None|nullptr)\b/;
var COMMON_TYPO_PATTERNS = [
  {
    regex: /\bpublik\s+class\b/,
    errorType: "SYNTAX_ERROR",
    msgBn: "`publik` \u098F\u0995\u099F\u09BF \u09AD\u09C1\u09B2 \u0995\u09BF\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 (Invalid keyword)\u0964",
    solBn: "`publik`-\u098F\u09B0 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09C7 \u09B8\u09A0\u09BF\u0995 \u0995\u09BF\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 `public` \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
    msgEn: "Invalid keyword `publik`. Use `public` instead."
  },
  {
    regex: /\b(?:statik|stati)\s+void\b/,
    errorType: "SYNTAX_ERROR",
    msgBn: "`static` \u0995\u09BF\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1\u09C7\u09B0 \u09AC\u09BE\u09A8\u09BE\u09A8 \u09AD\u09C1\u09B2 \u09B2\u09C7\u0996\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
    solBn: "\u09B8\u09A0\u09BF\u0995 \u09AC\u09BE\u09A8\u09BE\u09A8 `static void` \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
    msgEn: "Misspelled keyword `static`."
  },
  {
    regex: /\bvoide\s+main\b/,
    errorType: "SYNTAX_ERROR",
    msgBn: "`voide` \u098F\u0995\u099F\u09BF \u09AD\u09C1\u09B2 \u09B0\u09BF\u099F\u09BE\u09B0\u09CD\u09A8 \u099F\u09BE\u0987\u09AA\u0964",
    solBn: "`voide`-\u098F\u09B0 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09C7 `void` \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
    msgEn: "Invalid return type `voide`. Use `void`."
  },
  {
    regex: /^(?:public|private|protected|static|\s)*\binte\s+[A-Za-z_$]/,
    errorType: "COMPILATION_ERROR",
    msgBn: "`inte` \u0995\u09CB\u09A8\u09CB \u09AC\u09C8\u09A7 \u09A1\u09C7\u099F\u09BE \u099F\u09BE\u0987\u09AA \u09A8\u09AF\u09BC (Unknown type)\u0964",
    solBn: "\u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF `int` \u09A1\u09C7\u099F\u09BE \u099F\u09BE\u0987\u09AA \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964",
    msgEn: "Unknown type `inte`. Did you mean `int`?"
  },
  {
    regex: /^(?:public|private|protected|static|\s)*\bbooleen\s+[A-Za-z_$]/,
    errorType: "COMPILATION_ERROR",
    msgBn: "`booleen` \u0995\u09CB\u09A8\u09CB \u09AC\u09C8\u09A7 \u09A1\u09C7\u099F\u09BE \u099F\u09BE\u0987\u09AA \u09A8\u09AF\u09BC\u0964",
    solBn: "`booleen`-\u098F\u09B0 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09C7 `boolean` \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
    msgEn: "Unknown type `booleen`. Did you mean `boolean`?"
  },
  {
    regex: /\bsystem\.out\.print/,
    errorType: "COMPILATION_ERROR",
    msgBn: "\u099C\u09BE\u09AD\u09BE \u0995\u09C7\u09B8-\u09B8\u09C7\u09A8\u09B8\u09BF\u099F\u09BF\u09AD (case-sensitive); \u099B\u09CB\u099F \u09B9\u09BE\u09A4\u09C7\u09B0 `system` \u0995\u09CD\u09B2\u09BE\u09B8 \u0996\u09C1\u0981\u099C\u09C7 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
    solBn: "`system.out`-\u098F\u09B0 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09C7 \u09AC\u09A1\u09BC \u09B9\u09BE\u09A4\u09C7\u09B0 `S` \u09A6\u09BF\u09AF\u09BC\u09C7 `System.out.println(...)` \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
    msgEn: "Package `system` does not exist. Use uppercase `System.out.println(...)`."
  },
  {
    regex: /\bSystem\.out\.(?:printl|prinln|printfn|pirnt|pritnln)\s*\(/,
    errorType: "COMPILATION_ERROR",
    msgBn: "`System.out`-\u098F\u09B0 \u09AE\u09C7\u09A5\u09A1\u09C7\u09B0 \u09A8\u09BE\u09AE \u09AD\u09C1\u09B2 \u09B2\u09C7\u0996\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 (cannot find symbol)\u0964",
    solBn: "\u09B8\u09A0\u09BF\u0995\u09AD\u09BE\u09AC\u09C7 `System.out.println(...)` \u0985\u09A5\u09AC\u09BE `System.out.print(...)` \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
    msgEn: "Cannot find method on `System.out`. Use `System.out.println(...)`."
  },
  {
    regex: /\bconsol\.log\s*\(/,
    errorType: "COMPILATION_ERROR",
    msgBn: "`consol` \u0985\u09AC\u099C\u09C7\u0995\u09CD\u099F\u099F\u09BF \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC\u0964",
    solBn: "`consol.log`-\u098F\u09B0 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09C7 `console.log(...)` \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
    msgEn: "`consol` is not defined. Use `console.log(...)`."
  },
  {
    regex: /^\s*pirnt\s*\(/,
    errorType: "COMPILATION_ERROR",
    msgBn: "`pirnt` \u09AB\u09BE\u0982\u09B6\u09A8\u099F\u09BF \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC (NameError)\u0964",
    solBn: "`pirnt(...)`-\u098F\u09B0 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09C7 `print(...)` \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
    msgEn: "`pirnt` is not defined. Use `print(...)`."
  },
  {
    regex: /^\s*(?:iff|whille|fore|retun|retrun)\b/,
    errorType: "SYNTAX_ERROR",
    msgBn: "\u0995\u09A8\u09CD\u099F\u09CD\u09B0\u09CB\u09B2 \u0995\u09BF\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1\u09C7\u09B0 \u09AC\u09BE\u09A8\u09BE\u09A8 \u09AD\u09C1\u09B2 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 (`iff`/`whille`/`fore`/`retun`)\u0964",
    solBn: "\u09B8\u09A0\u09BF\u0995 \u0995\u09BF\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 (`if`, `while`, `for`, \u09AC\u09BE `return`) \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964",
    msgEn: "Invalid control keyword spelling."
  }
];
var BUILTIN_IDENTIFIERS = /* @__PURE__ */ new Set([
  "let",
  "const",
  "var",
  "int",
  "long",
  "short",
  "byte",
  "float",
  "double",
  "boolean",
  "bool",
  "char",
  "string",
  "String",
  "void",
  "auto",
  "final",
  "static",
  "public",
  "private",
  "protected",
  "class",
  "struct",
  "interface",
  "enum",
  "extends",
  "implements",
  "if",
  "else",
  "elif",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "default",
  "break",
  "continue",
  "return",
  "try",
  "catch",
  "except",
  "finally",
  "throw",
  "throws",
  "raise",
  "new",
  "true",
  "false",
  "True",
  "False",
  "null",
  "None",
  "nullptr",
  "this",
  "super",
  "require",
  "module",
  "exports",
  "process",
  "Buffer",
  "crypto",
  "System",
  "out",
  "err",
  "in",
  "println",
  "print",
  "printf",
  "cout",
  "cin",
  "endl",
  "std",
  "swap",
  "max",
  "min",
  "abs",
  "main",
  "args",
  "Math",
  "Array",
  "Arrays",
  "Collections",
  "List",
  "ArrayList",
  "LinkedList",
  "Map",
  "HashMap",
  "Set",
  "HashSet",
  "Stack",
  "Queue",
  "Integer",
  "Long",
  "Double",
  "Float",
  "Boolean",
  "Character",
  "Object",
  "StringBuilder",
  "StringBuffer",
  "File",
  "FileReader",
  "FileInputStream",
  "BufferedReader",
  "Scanner",
  "Random",
  "BigDecimal",
  "BigInteger",
  "LocalDate",
  "LocalTime",
  "LocalDateTime",
  "Instant",
  "Duration",
  "Iterator",
  "Optional",
  "Objects",
  "UUID",
  "Files",
  "Paths",
  "Exception",
  "RuntimeException",
  "ArithmeticException",
  "FileNotFoundException",
  "IOException",
  "NullPointerException",
  "ArrayIndexOutOfBoundsException",
  "IndexOutOfBoundsException",
  "IllegalArgumentException",
  "IllegalStateException",
  "NoSuchElementException",
  "Thread",
  "Runnable",
  "Comparable",
  "Comparator",
  "NumberFormatException",
  "IllegalArgumentException",
  "Throwable",
  "MAX_VALUE",
  "MIN_VALUE",
  "INT_MAX",
  "INT_MIN",
  "length",
  "size",
  "TreeMap",
  "TreeSet",
  "Deque",
  "PriorityQueue",
  "Iterator",
  "vector",
  "pair",
  "make_pair",
  "sort",
  "reverse"
]);
function makeErrorDetails(params) {
  const {
    errorType,
    lineNumber,
    lineCode,
    messageBn,
    solutionBn,
    messageEn,
    explainLanguage
  } = params;
  const formattedMessage = explainLanguage === "bn" ? `[${errorType}] \u09B2\u09BE\u0987\u09A8 ${lineNumber}: ${messageBn} \u09B8\u09AE\u09BE\u09A7\u09BE\u09A8: ${solutionBn}` : `[${errorType}] Line ${lineNumber}: ${messageEn}`;
  return {
    errorType,
    lineNumber,
    lineCode: lineCode.trim(),
    messageBn,
    solutionBn,
    line: lineNumber,
    message: formattedMessage
  };
}
function stripStringLiteralsFromLine(line) {
  return line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
}
function detectSyntaxError(code, explainLanguage, language = "javascript", fileName) {
  const rawLines = code.split("\n");
  const trimmedCode = code.trim();
  if (!trimmedCode) {
    return makeErrorDetails({
      errorType: "SYNTAX_ERROR",
      lineNumber: 1,
      lineCode: "",
      messageBn: "\u098F\u09A1\u09BF\u099F\u09B0 \u0996\u09BE\u09B2\u09BF \u0986\u099B\u09C7\u0964 \u09B0\u09BE\u09A8 \u0995\u09B0\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u09AC\u09C8\u09A7 \u0995\u09CB\u09A1 \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
      solutionBn: "\u098F\u09A1\u09BF\u099F\u09B0\u09C7 \u098F\u0995\u099F\u09BF \u09AC\u09C8\u09A7 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u09B2\u09BF\u0996\u09C7 \u0986\u09AC\u09BE\u09B0 \u09B0\u09BE\u09A8 \u0995\u09B0\u09C1\u09A8\u0964",
      messageEn: "Editor is empty. Please write valid code before running.",
      explainLanguage
    });
  }
  let impliedCommentFileName;
  for (let i = 0; i < Math.min(rawLines.length, 6); i++) {
    const m = rawLines[i].trim().match(/^(?:\/\/|\/\*+|\*)\s*(?:file(?:\s*name)?\s*:\s*)?([A-Za-z_$][\w$]*\.java)\b/i);
    if (m) {
      impliedCommentFileName = m[1];
      break;
    }
  }
  const commentFree = stripCommentsPreservingLines(code, language);
  const lines = commentFree.split("\n");
  const isJavaCode = language === "java" || /\bpublic\s+class\s+[A-Za-z_$]/.test(commentFree) || /\bSystem\.out\.print/.test(commentFree);
  const effectiveLang = isJavaCode ? "java" : language;
  if (effectiveLang === "java") {
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
            errorType: "COMPILATION_ERROR",
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `\u098F\u0995\u0987 \u09AB\u09BE\u0987\u09B2\u09C7 \u098F\u0995\u09BE\u09A7\u09BF\u0995 \u09AA\u09BE\u09AC\u09B2\u09BF\u0995 \u0995\u09CD\u09B2\u09BE\u09B8 (\`public class ${publicClassName}\`) \u0998\u09CB\u09B7\u09A3\u09BE \u0995\u09B0\u09BE \u09AF\u09BE\u09DF \u09A8\u09BE\u0964`,
            solutionBn: `\u09B6\u09C1\u09A7\u09C1\u09AE\u09BE\u09A4\u09CD\u09B0 \u09AE\u09C2\u09B2 \u0995\u09CD\u09B2\u09BE\u09B8\u099F\u09BF\u0995\u09C7 \`public class\` \u09B0\u09BE\u0996\u09C1\u09A8 \u098F\u09AC\u0982 \u0985\u09A8\u09CD\u09AF \u0995\u09CD\u09B2\u09BE\u09B8\u0997\u09C1\u09B2\u09CB \u09A5\u09C7\u0995\u09C7 \`public\` \u0995\u09BF\u0993\u09DF\u09BE\u09B0\u09CD\u09A1 \u09B8\u09B0\u09BF\u09DF\u09C7 \u09A6\u09BF\u09A8\u0964`,
            messageEn: `Multiple public classes in a single file are not allowed in Java.`,
            explainLanguage
          });
        }
        const providedFile = impliedCommentFileName || fileName?.trim().split("/").pop();
        if (providedFile) {
          const isExplicitJavaFile = /\.java$/i.test(providedFile);
          const shouldValidateFileName = isExplicitJavaFile || language === "java" && !["main.js", "main.py", "main.cpp"].includes(providedFile.toLowerCase());
          if (shouldValidateFileName) {
            const expectedClassName = providedFile.replace(/\.[a-z0-9]+$/i, "");
            if (expectedClassName !== publicClassName) {
              const displayFile = isExplicitJavaFile ? providedFile : `${expectedClassName}.java`;
              return makeErrorDetails({
                errorType: "FILE_NAME_MISMATCH",
                lineNumber: lineNum,
                lineCode: rawLineCode,
                messageBn: `\u09AB\u09BE\u0987\u09B2\u09C7\u09B0 \u09A8\u09BE\u09AE (\`${displayFile}\`) \u098F\u09AC\u0982 \u09AA\u09BE\u09AC\u09B2\u09BF\u0995 \u0995\u09CD\u09B2\u09BE\u09B8\u09C7\u09B0 \u09A8\u09BE\u09AE (\`${publicClassName}\`) \u098F\u0995 \u09A8\u09DF\u0964 \u099C\u09BE\u09AD\u09BE\u09A4\u09C7 \`public class ${publicClassName}\` \u0985\u09AC\u09B6\u09CD\u09AF\u0987 \`${publicClassName}.java\` \u09A8\u09BE\u09AE\u09C7\u09B0 \u09AB\u09BE\u0987\u09B2\u09C7 \u09A5\u09BE\u0995\u09A4\u09C7 \u09B9\u09AC\u09C7\u0964`,
                solutionBn: `\u09AB\u09BE\u0987\u09B2\u09C7\u09B0 \u09A8\u09BE\u09AE \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u0995\u09B0\u09C7 \`${publicClassName}.java\` \u0995\u09B0\u09C1\u09A8 \u0985\u09A5\u09AC\u09BE \u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u0995\u09CD\u09B2\u09BE\u09B8\u09C7\u09B0 \u09A8\u09BE\u09AE \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u0995\u09B0\u09C7 \`public class ${expectedClassName}\` \u09B2\u09BF\u0996\u09C1\u09A8\u0964`,
                messageEn: `Class \`${publicClassName}\` is public, should be declared in a file named \`${publicClassName}.java\` (current file: \`${displayFile}\`).`,
                explainLanguage
              });
            }
          }
        }
      }
    }
  }
  const stack = [];
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const closingToOpening = { ")": "(", "}": "{", "]": "[" };
  let meaningfulCodeLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const cleaned = lines[i].trim();
    const rawLineCode = rawLines[i]?.trim() || cleaned;
    if (!cleaned) continue;
    for (const typo of COMMON_TYPO_PATTERNS) {
      if (typo.regex.test(cleaned)) {
        return makeErrorDetails({
          errorType: typo.errorType,
          lineNumber: lineNum,
          lineCode: rawLineCode,
          messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u0995\u09AE\u09CD\u09AA\u09BE\u0987\u09B2/\u09B8\u09BF\u09A8\u099F\u09CD\u09AF\u09BE\u0995\u09CD\u09B8 \u09A4\u09CD\u09B0\u09C1\u099F\u09BF: ${typo.msgBn}`,
          solutionBn: typo.solBn,
          messageEn: typo.msgEn,
          explainLanguage
        });
      }
    }
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    for (let c = 0; c < cleaned.length; c++) {
      const ch = cleaned[c];
      const prev = c > 0 ? cleaned[c - 1] : "";
      if (ch === "'" && prev !== "\\" && !inDouble && !inBacktick) inSingle = !inSingle;
      if (ch === '"' && prev !== "\\" && !inSingle && !inBacktick) inDouble = !inDouble;
      if (ch === "`" && prev !== "\\" && !inSingle && !inDouble) inBacktick = !inBacktick;
      if (!inSingle && !inDouble && !inBacktick) {
        if (pairs[ch]) {
          stack.push({ char: ch, line: lineNum, lineCode: rawLineCode });
        } else if (closingToOpening[ch]) {
          const last = stack.pop();
          if (!last || last.char !== closingToOpening[ch]) {
            return makeErrorDetails({
              errorType: "SYNTAX_ERROR",
              lineNumber: lineNum,
              lineCode: rawLineCode,
              messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u0985\u09AE\u09BF\u09B2 \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F \u09AC\u09BE \u09AC\u09CD\u09B0\u09C7\u09B8 '${ch}' \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u0997\u09C7\u099B\u09C7 \u09AF\u09BE\u09B0 \u0995\u09CB\u09A8\u09CB \u09B6\u09C1\u09B0\u09C1\u09B0 '${closingToOpening[ch]}' \u09A8\u09C7\u0987\u0964`,
              solutionBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u0985\u09A4\u09BF\u09B0\u09BF\u0995\u09CD\u09A4 '${ch}' \u09B8\u09B0\u09BF\u09DF\u09C7 \u09AB\u09C7\u09B2\u09C1\u09A8 \u0985\u09A5\u09AC\u09BE \u09B8\u09A0\u09BF\u0995 \u09B8\u09CD\u09A5\u09BE\u09A8\u09C7 \u09B6\u09C1\u09B0\u09C1\u09B0 '${closingToOpening[ch]}' \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F \u09A6\u09BF\u09A8\u0964`,
              messageEn: `Unmatched closing bracket '${ch}' on line ${lineNum}.`,
              explainLanguage
            });
          }
        }
      }
    }
    if (inSingle || inDouble) {
      return makeErrorDetails({
        errorType: "SYNTAX_ERROR",
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u0982 \u09AC\u09BE \u0995\u09CD\u09AF\u09BE\u09B0\u09C7\u0995\u09CD\u099F\u09BE\u09B0 \u0995\u09CB\u099F\u09C7\u09B6\u09A8 (${inDouble ? '"' : "'"}) \u09B6\u09C7\u09B7 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964`,
        solutionBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u0982\u09DF\u09C7\u09B0 \u09B6\u09C7\u09B7\u09C7 \u09B8\u09AE\u09BE\u09AA\u09A8\u09C0 \u0995\u09CB\u099F\u09C7\u09B6\u09A8 (${inDouble ? '"' : "'"}) \u09AF\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09C1\u09A8\u0964`,
        messageEn: `Unterminated string literal on line ${lineNum}.`,
        explainLanguage
      });
    }
    if (/^(?:let|const|var|int|long|short|byte|float|double|boolean|bool|String|string|char)\s+[A-Za-z_$][\w$]*\s*==/.test(
      cleaned
    )) {
      return makeErrorDetails({
        errorType: "SYNTAX_ERROR",
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09BE\u09B0 \u09B8\u09AE\u09AF\u09BC \u0985\u09CD\u09AF\u09BE\u09B8\u09BE\u0987\u09A8\u09AE\u09C7\u09A8\u09CD\u099F \u0985\u09AA\u09BE\u09B0\u09C7\u099F\u09B0 \`=\`-\u098F\u09B0 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09C7 \u09A4\u09C1\u09B2\u09A8\u09BE \u0985\u09AA\u09BE\u09B0\u09C7\u099F\u09B0 \`==\` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964`,
        solutionBn: `\u09AE\u09BE\u09A8 \u0985\u09CD\u09AF\u09BE\u09B8\u09BE\u0987\u09A8 \u0995\u09B0\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \`==\`-\u098F\u09B0 \u09AC\u09A6\u09B2\u09C7 \u098F\u0995\u099F\u09BF \`=\` \u099A\u09BF\u09B9\u09CD\u09A8 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964`,
        messageEn: `Invalid '==' in variable declaration on line ${lineNum}. Use '=' for assignment.`,
        explainLanguage
      });
    }
    if (/=(?!=)\s*;/.test(cleaned)) {
      return makeErrorDetails({
        errorType: "SYNTAX_ERROR",
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u09B8\u09AE\u09BE\u09A8 \u099A\u09BF\u09B9\u09CD\u09A8\u09C7\u09B0 (\`=\`) \u09AA\u09B0\u09C7 \u0995\u09CB\u09A8\u09CB \u09AE\u09BE\u09A8 \u09AC\u09BE \u098F\u0995\u09CD\u09B8\u09AA\u09CD\u09B0\u09C7\u09B6\u09A8 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964`,
        solutionBn: `\`=\` \u099A\u09BF\u09B9\u09CD\u09A8\u09C7\u09B0 \u09A1\u09BE\u09A8\u09AA\u09BE\u09B6\u09C7 \u098F\u0995\u099F\u09BF \u09AC\u09C8\u09A7 \u09AE\u09BE\u09A8 \u09AC\u09BE \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u09B2\u09BF\u0996\u09C1\u09A8\u0964`,
        messageEn: `Missing expression after '=' on line ${lineNum}.`,
        explainLanguage
      });
    }
    const noStrings = stripStringLiteralsFromLine(cleaned);
    if ((effectiveLang === "java" || effectiveLang === "cpp" || effectiveLang === "python") && /(?:===|!==)/.test(noStrings)) {
      return makeErrorDetails({
        errorType: "SYNTAX_ERROR",
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \`===\` \u09AC\u09BE \`!==\` \u0985\u09AA\u09BE\u09B0\u09C7\u099F\u09B0 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 \u09AF\u09BE ${effectiveLang.toUpperCase()} \u09AD\u09BE\u09B7\u09BE\u09AF\u09BC \u09AC\u09C8\u09A7 \u09A8\u09AF\u09BC\u0964`,
        solutionBn: `\u09A4\u09C1\u09B2\u09A8\u09BE \u0995\u09B0\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \`==\` \u0985\u09A5\u09AC\u09BE \`!=\` \u0985\u09AA\u09BE\u09B0\u09C7\u099F\u09B0 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964`,
        messageEn: `'===' and '!==' are not valid operators in ${effectiveLang}. Use '==' or '!='.`,
        explainLanguage
      });
    }
    const hasCodePunctuation = /[=(){}\[\];:+\-*/%<>!&|,.]/.test(cleaned);
    const hasKeyword = VALID_CODE_KEYWORDS.test(cleaned);
    if (!hasCodePunctuation && !hasKeyword) {
      return makeErrorDetails({
        errorType: "SYNTAX_ERROR",
        lineNumber: lineNum,
        lineCode: rawLineCode,
        messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum} (\`${cleaned.slice(0, 40)}\`) \u0995\u09CB\u09A8\u09CB \u09AC\u09C8\u09A7 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09BF\u0982 \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F \u09AC\u09BE \u09B8\u09BF\u09A8\u099F\u09CD\u09AF\u09BE\u0995\u09CD\u09B8 \u09A8\u09AF\u09BC\u0964`,
        solutionBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F\u09B0 \u0985\u09AA\u09CD\u09B0\u09AF\u09BC\u09CB\u099C\u09A8\u09C0\u09AF\u09BC \u099F\u09C7\u0995\u09CD\u09B8\u099F \u09AE\u09C1\u099B\u09C7 \u09AC\u09C8\u09A7 ${effectiveLang} \u0995\u09CB\u09A1 \u09B2\u09BF\u0996\u09C1\u09A8\u0964`,
        messageEn: `Line ${lineNum} (\`${cleaned.slice(0, 40)}\`) is not valid ${effectiveLang} syntax.`,
        explainLanguage
      });
    }
    meaningfulCodeLines++;
  }
  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1];
    const expectedClose = pairs[unclosed.char] || "}";
    return makeErrorDetails({
      errorType: "SYNTAX_ERROR",
      lineNumber: unclosed.line,
      lineCode: unclosed.lineCode,
      messageBn: `\u09B2\u09BE\u0987\u09A8 ${unclosed.line}-\u098F \u0996\u09CB\u09B2\u09BE '${unclosed.char}' \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F/\u09AC\u09CD\u09B0\u09C7\u09B8\u099F\u09BF \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09C7\u09B0 \u09B6\u09C7\u09B7\u09C7\u0993 \u09AC\u09A8\u09CD\u09A7 ('${expectedClose}') \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF\u0964`,
      solutionBn: `\u09AC\u09CD\u09B2\u0995 \u09AC\u09BE \u098F\u0995\u09CD\u09B8\u09AA\u09CD\u09B0\u09C7\u09B6\u09A8\u099F\u09BF \u09B8\u09AE\u09CD\u09AA\u09C2\u09B0\u09CD\u09A3 \u0995\u09B0\u09A4\u09C7 \u0989\u09AA\u09AF\u09C1\u0995\u09CD\u09A4 \u09B8\u09CD\u09A5\u09BE\u09A8\u09C7 '${expectedClose}' \u09AF\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09C1\u09A8\u0964`,
      messageEn: `Unclosed '${unclosed.char}' opened on line ${unclosed.line}. Expected '${expectedClose}'.`,
      explainLanguage
    });
  }
  if (meaningfulCodeLines === 0) {
    return makeErrorDetails({
      errorType: "SYNTAX_ERROR",
      lineNumber: 1,
      lineCode: rawLines[0] || "",
      messageBn: "\u0995\u09CB\u09A1\u09C7 \u0995\u09CB\u09A8\u09CB \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
      solutionBn: "\u0995\u09AE\u09C7\u09A8\u09CD\u099F\u09C7\u09B0 \u09AA\u09BE\u09B6\u09BE\u09AA\u09BE\u09B6\u09BF \u0985\u09A8\u09CD\u09A4\u09A4 \u098F\u0995\u099F\u09BF \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u0995\u09CB\u09A1 \u09B2\u09BE\u0987\u09A8 \u09B2\u09BF\u0996\u09C1\u09A8\u0964",
      messageEn: "No executable code statements found.",
      explainLanguage
    });
  }
  if (effectiveLang === "javascript") {
    try {
      new vm2.Script(commentFree);
    } catch (err) {
      const stackStr = String(err?.stack || "");
      const lineMatch = stackStr.match(/evalmachine\.<anonymous>:(\d+)/);
      const errLine = lineMatch ? Number(lineMatch[1]) : 1;
      const rawMsg = String(err?.message || "SyntaxError");
      const rawLineCode = rawLines[errLine - 1]?.trim() || "";
      return makeErrorDetails({
        errorType: "SYNTAX_ERROR",
        lineNumber: errLine,
        lineCode: rawLineCode,
        messageBn: `\u09B2\u09BE\u0987\u09A8 ${errLine}-\u098F \u099C\u09BE\u09AD\u09BE\u09B8\u09CD\u0995\u09CD\u09B0\u09BF\u09AA\u09CD\u099F \u09B8\u09BF\u09A8\u099F\u09CD\u09AF\u09BE\u0995\u09CD\u09B8 \u09A4\u09CD\u09B0\u09C1\u099F\u09BF: \`${rawMsg}\`\u0964`,
        solutionBn: `\u09B2\u09BE\u0987\u09A8 ${errLine} (\`${rawLineCode}\`)-\u098F\u09B0 \u09AC\u09CD\u09B0\u09CD\u09AF\u09BE\u0995\u09C7\u099F, \u0985\u09AA\u09BE\u09B0\u09C7\u099F\u09B0 \u09AC\u09BE \u0995\u09BF\u0993\u09AF\u09BC\u09BE\u09B0\u09CD\u09A1 \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE \u0995\u09B0\u09C7 \u09B8\u09BF\u09A8\u099F\u09CD\u09AF\u09BE\u0995\u09CD\u09B8 \u09A0\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964`,
        messageEn: `Syntax Error on line ${errLine}: ${rawMsg}`,
        explainLanguage
      });
    }
  }
  if (effectiveLang === "java" || effectiveLang === "cpp") {
    let openParenDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const cleaned = lines[i].trim();
      const rawLineCode = rawLines[i]?.trim() || cleaned;
      if (!cleaned) continue;
      const strippedQuotes = stripStringLiteralsFromLine(cleaned);
      for (const ch of strippedQuotes) {
        if (ch === "(") openParenDepth++;
        else if (ch === ")") openParenDepth = Math.max(0, openParenDepth - 1);
      }
      if (cleaned.startsWith("#") || cleaned.startsWith("@")) continue;
      if (cleaned.endsWith("{") || cleaned.endsWith("}") || cleaned.endsWith(",") || cleaned.endsWith(":") || openParenDepth > 0) {
        continue;
      }
      const isHeaderWithoutBrace = /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*(?:class|interface|enum|struct)\b/.test(
        cleaned
      ) || /^(?:\}?\s*)?(?:if|else\s+if|for|while|switch|catch)\s*\(.*\)\s*$/.test(cleaned) || /^(?:\}?\s*)?(?:else|try|finally|do)\s*$/.test(cleaned) || /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|synchronized\s+)*(?:void|int|long|short|byte|double|float|boolean|bool|char|String|string|auto)\s+[A-Za-z_$][\w$]*\s*\([^;]*\)(?:\s*throws\s+[A-Za-z0-9_.,\s]+)?\s*$/.test(
        cleaned
      );
      if (isHeaderWithoutBrace) {
        continue;
      }
      if (/[+\-*/%&|^=<>?:]$/.test(cleaned)) {
        continue;
      }
      let nextNonEmpty = "";
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) {
          nextNonEmpty = lines[j].trim();
          break;
        }
      }
      if (/^(?:\.|<<|>>|\+|\?|:|&&|\|\|)/.test(nextNonEmpty)) {
        continue;
      }
      if (!cleaned.endsWith(";")) {
        return makeErrorDetails({
          errorType: "SYNTAX_ERROR",
          lineNumber: lineNum,
          lineCode: rawLineCode,
          messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F\u09C7\u09B0 \u09B6\u09C7\u09B7\u09C7 \u09B8\u09C7\u09AE\u09BF\u0995\u09CB\u09B2\u09A8 (\`;\`) \u09A6\u09C7\u0993\u09DF\u09BE \u09B9\u09DF\u09A8\u09BF\u0964`,
          solutionBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F\u09B0 \u09B6\u09C7\u09B7\u09C7 \u098F\u0995\u099F\u09BF \u09B8\u09C7\u09AE\u09BF\u0995\u09CB\u09B2\u09A8 \u09AF\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09C1\u09A8: \`${rawLineCode};\``,
          messageEn: `';' expected at the end of line ${lineNum}: \`${rawLineCode}\`.`,
          explainLanguage
        });
      }
    }
    const declaredVars = /* @__PURE__ */ new Map();
    const declaredFunctions = /* @__PURE__ */ new Set(["main"]);
    const importedSymbols = /* @__PURE__ */ new Set();
    let hasWildcardImport = false;
    for (let i = 0; i < lines.length; i++) {
      const impMatch = lines[i].trim().match(/^import\s+([A-Za-z0-9_.]+(?:\.\*)?)\s*;/);
      if (impMatch) {
        const impPath = impMatch[1];
        if (impPath.endsWith(".*")) {
          hasWildcardImport = true;
        } else {
          const parts = impPath.split(".");
          importedSymbols.add(parts[parts.length - 1]);
        }
      }
    }
    for (let i = 0; i < lines.length; i++) {
      const cleaned = lines[i].trim();
      const fnHeader = cleaned.match(
        /^(?:(?:public|private|protected|static|final)\s+)*(?:void|int|long|short|byte|double|float|boolean|bool|String|string|char)\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/
      );
      if (fnHeader) {
        declaredFunctions.add(fnHeader[1]);
        const params = fnHeader[2].split(",").map((p) => p.trim()).filter(Boolean);
        for (const p of params) {
          const cleanP = p.replace(/\[\s*\]/g, "").trim();
          const parts = cleanP.split(/\s+/);
          const paramName = parts[parts.length - 1];
          const paramTypeRaw = parts[0] || "";
          if (paramName && /^[A-Za-z_$][\w$]*$/.test(paramName)) {
            declaredVars.set(
              paramName,
              /^(?:int|long|short|byte)$/.test(paramTypeRaw) ? "int" : /^(?:double|float)$/.test(paramTypeRaw) ? "float" : /^(?:boolean|bool)$/.test(paramTypeRaw) ? "boolean" : /^(?:String|string)$/.test(paramTypeRaw) ? "String" : "object"
            );
          }
        }
      }
    }
    const inferLiteralOrVarType = (rhsRaw) => {
      const rhs = rhsRaw.trim().replace(/;$/, "").trim();
      if (!rhs) return null;
      if (/^"(?:\\.|[^"\\])*"$/.test(rhs)) return "String";
      if (/^'(?:\\.|[^'\\])*'$/.test(rhs)) return "char";
      if (rhs === "true" || rhs === "false") return "boolean";
      if (/^-?\d+\.\d+[fFdD]?$/.test(rhs)) return "float";
      if (/^-?\d+[lL]?$/.test(rhs)) return "int";
      if (declaredVars.has(rhs)) return declaredVars.get(rhs);
      return null;
    };
    const mapTypeKeyword = (typeKw, isArrayDecl) => {
      if (isArrayDecl) return "array";
      if (/^(?:int|long|short|byte|size_t)$/.test(typeKw)) return "int";
      if (/^(?:double|float)$/.test(typeKw)) return "float";
      if (/^(?:boolean|bool)$/.test(typeKw)) return "boolean";
      if (/^(?:String|string)$/.test(typeKw)) return "String";
      if (typeKw === "char") return "char";
      return "object";
    };
    const checkTypeCompatibility = (varName, expectedType, rhsExpr, lineNum, rawLineCode) => {
      const rhsType = inferLiteralOrVarType(rhsExpr);
      if (!rhsType) return null;
      if (expectedType === "int") {
        if (rhsType === "String") {
          return makeErrorDetails({
            errorType: "COMPILATION_ERROR",
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u099F\u09BE\u0987\u09AA \u0985\u09AE\u09BF\u09B2 (Incompatible types): \`String\` \u09AE\u09BE\u09A8 (${rhsExpr}) \u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE (\`int\`) \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \`${varName}\`-\u098F \u09B0\u09BE\u0996\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964`,
            solutionBn: `\`${varName}\`-\u098F \u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE \u09AE\u09BE\u09A8 \u09A6\u09BF\u09A8 (\u0995\u09CB\u099F\u09C7\u09B6\u09A8 \u099B\u09BE\u09DC\u09BE) \u0985\u09A5\u09AC\u09BE \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u099F\u09BF\u09B0 \u099F\u09BE\u0987\u09AA \`String\` \u09B9\u09BF\u09B8\u09C7\u09AC\u09C7 \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8\u0964`,
            messageEn: `Incompatible types on line ${lineNum}: String cannot be converted to int.`,
            explainLanguage
          });
        }
        if (rhsType === "boolean" && effectiveLang === "java") {
          return makeErrorDetails({
            errorType: "COMPILATION_ERROR",
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u099F\u09BE\u0987\u09AA \u0985\u09AE\u09BF\u09B2 (Incompatible types): \`boolean\` \u09AE\u09BE\u09A8 (\`${rhsExpr}\`) \`int\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \`${varName}\`-\u098F \u09B0\u09BE\u0996\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964`,
            solutionBn: `\`${varName}\`-\u098F \u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE \u09AE\u09BE\u09A8 \u09A6\u09BF\u09A8 \u0985\u09A5\u09AC\u09BE \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u099F\u09BF\u09B0 \u099F\u09BE\u0987\u09AA \`boolean\` \u0995\u09B0\u09C1\u09A8\u0964`,
            messageEn: `Incompatible types on line ${lineNum}: boolean cannot be converted to int.`,
            explainLanguage
          });
        }
        if (rhsType === "float" && effectiveLang === "java") {
          return makeErrorDetails({
            errorType: "COMPILATION_ERROR",
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u099F\u09BE\u0987\u09AA \u0985\u09AE\u09BF\u09B2 (Possible lossy conversion): \u09A6\u09B6\u09AE\u09BF\u0995 \u09B8\u0982\u0996\u09CD\u09AF\u09BE (\`${rhsExpr}\`) \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \`int\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \`${varName}\`-\u098F \u09B0\u09BE\u0996\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964`,
            solutionBn: `\u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u099F\u09BF\u09B0 \u099F\u09BE\u0987\u09AA \`double\` \u0995\u09B0\u09C1\u09A8 \u0985\u09A5\u09AC\u09BE \`(int) ${rhsExpr}\` \u09A6\u09BF\u09AF\u09BC\u09C7 \u099F\u09BE\u0987\u09AA \u0995\u09BE\u09B8\u09CD\u099F \u0995\u09B0\u09C1\u09A8\u0964`,
            messageEn: `Incompatible types on line ${lineNum}: possible lossy conversion from double to int.`,
            explainLanguage
          });
        }
      }
      if (expectedType === "float" && rhsType === "String") {
        return makeErrorDetails({
          errorType: "COMPILATION_ERROR",
          lineNumber: lineNum,
          lineCode: rawLineCode,
          messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u099F\u09BE\u0987\u09AA \u0985\u09AE\u09BF\u09B2 (Incompatible types): \`String\` \u09AE\u09BE\u09A8 (\`${rhsExpr}\`) \u09A6\u09B6\u09AE\u09BF\u0995 (\`double/float\`) \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \`${varName}\`-\u098F \u09B0\u09BE\u0996\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964`,
          solutionBn: `\`${varName}\`-\u098F \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B8\u09C2\u099A\u0995 \u09AE\u09BE\u09A8 \u09A6\u09BF\u09A8 \u0985\u09A5\u09AC\u09BE \u099F\u09BE\u0987\u09AA \`String\` \u0995\u09B0\u09C1\u09A8\u0964`,
          messageEn: `Incompatible types on line ${lineNum}: String cannot be converted to double.`,
          explainLanguage
        });
      }
      if (expectedType === "boolean" && effectiveLang === "java") {
        if (rhsType === "int" || rhsType === "float" || rhsType === "String") {
          return makeErrorDetails({
            errorType: "COMPILATION_ERROR",
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u099F\u09BE\u0987\u09AA \u0985\u09AE\u09BF\u09B2 (Incompatible types): \`${rhsType}\` \u09AE\u09BE\u09A8 (\`${rhsExpr}\`) \u09AC\u09C1\u09B2\u09BF\u09AF\u09BC\u09BE\u09A8 (\`boolean\`) \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \`${varName}\`-\u098F \u09B0\u09BE\u0996\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964`,
            solutionBn: `\`boolean ${varName}\`-\u098F \u09B6\u09C1\u09A7\u09C1\u09AE\u09BE\u09A4\u09CD\u09B0 \`true\`, \`false\`, \u0985\u09A5\u09AC\u09BE \u0995\u09CB\u09A8\u09CB \u09A4\u09C1\u09B2\u09A8\u09BE\u09AE\u09C2\u09B2\u0995 \u09B6\u09B0\u09CD\u09A4 (\u09AF\u09C7\u09AE\u09A8 \`a > b\`) \u09B0\u09BE\u0996\u09C1\u09A8\u0964`,
            messageEn: `Incompatible types on line ${lineNum}: ${rhsType} cannot be converted to boolean.`,
            explainLanguage
          });
        }
      }
      if (expectedType === "String") {
        if (rhsType === "int" || rhsType === "float" || rhsType === "boolean") {
          return makeErrorDetails({
            errorType: "COMPILATION_ERROR",
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u099F\u09BE\u0987\u09AA \u0985\u09AE\u09BF\u09B2 (Incompatible types): \`${rhsType}\` \u09AE\u09BE\u09A8 (\`${rhsExpr}\`) \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \`String\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \`${varName}\`-\u098F \u09B0\u09BE\u0996\u09BE \u09AF\u09BE\u09AC\u09C7 \u09A8\u09BE\u0964`,
            solutionBn: `\u09AE\u09BE\u09A8\u099F\u09BF\u0995\u09C7 \u09A1\u09BE\u09AC\u09B2 \u0995\u09CB\u099F\u09C7\u09B6\u09A8\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 (\`"${rhsExpr}"\`) \u09B2\u09BF\u0996\u09C1\u09A8 \u0985\u09A5\u09AC\u09BE \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u099F\u09BF\u09B0 \u099F\u09BE\u0987\u09AA \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u0995\u09B0\u09C1\u09A8\u0964`,
            messageEn: `Incompatible types on line ${lineNum}: ${rhsType} cannot be converted to String.`,
            explainLanguage
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
      if (cleaned.startsWith("#") || cleaned.startsWith("@") || cleaned.startsWith("package ") || cleaned.startsWith("import ") || cleaned.startsWith("using namespace")) {
        continue;
      }
      const catchDecl = cleaned.match(
        /^(?:\}?\s*)?catch\s*\(\s*(?:final\s+)?(?:[A-Za-z0-9_.$|&\s]+\s+)?([A-Za-z_$][\w$]*)\s*\)/
      );
      if (catchDecl && catchDecl[1]) {
        declaredVars.set(catchDecl[1], "object");
        continue;
      }
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
      const forEachDecl = cleaned.match(
        /^for\s*\(\s*(?:final\s+)?(int|long|short|byte|double|float|boolean|bool|String|string|char|auto)\s+([A-Za-z_$][\w$]*)\s*:/
      );
      if (forEachDecl) {
        declaredVars.set(forEachDecl[2], mapTypeKeyword(forEachDecl[1], false));
      }
      if (/^(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*class\b/.test(
        cleaned
      ) || /^(?:public\s+|private\s+|protected\s+|static\s+|final\s+)*(?:void|int|long|short|byte|double|float|boolean|bool|String|string|char)\s+[A-Za-z_$][\w$]*\s*\(/.test(
        cleaned
      )) {
        continue;
      }
      const declHeaderMatch = cleaned.match(
        /^(?:final\s+|static\s+)*([A-Z][A-Za-z0-9_$]*(?:<[^>]+>)?|int|long|short|byte|double|float|boolean|bool|String|string|char|auto|vector\s*<[^>]+>|(?:[A-Za-z_$][\w$]*\s*<[^>]+>))(\s*\[\s*\])?\s+(.+?);?\s*$/
      );
      if (declHeaderMatch) {
        const baseTypeKw = declHeaderMatch[1];
        const isArrBrack = Boolean(declHeaderMatch[2]);
        const restDecls = declHeaderMatch[3];
        const declParts = [];
        let cur = "";
        let depth = 0;
        let inQuotes = false;
        for (let c = 0; c < restDecls.length; c++) {
          const ch = restDecls[c];
          if ((ch === '"' || ch === "'") && restDecls[c - 1] !== "\\") inQuotes = !inQuotes;
          if (!inQuotes) {
            if (ch === "(" || ch === "{" || ch === "[") depth++;
            else if (ch === ")" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
            else if (ch === "," && depth === 0) {
              declParts.push(cur.trim());
              cur = "";
              continue;
            }
          }
          cur += ch;
        }
        if (cur.trim()) declParts.push(cur.trim());
        for (const part of declParts) {
          const eqIdx = part.indexOf("=");
          const lhsPart = (eqIdx >= 0 ? part.slice(0, eqIdx) : part).trim();
          const rhsPart = eqIdx >= 0 ? part.slice(eqIdx + 1).trim() : "";
          const hasVarArr = isArrBrack || /\[\s*\]/.test(lhsPart);
          const varName = lhsPart.replace(/\[\s*\]/g, "").trim();
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
              const strippedRhs = stripStringLiteralsFromLine(rhsPart);
              const tokens = strippedRhs.match(/\b[A-Za-z_$][\w$]*\b/g) || [];
              for (const tok of tokens) {
                if (!BUILTIN_IDENTIFIERS.has(tok) && !declaredVars.has(tok) && !declaredFunctions.has(tok) && !importedSymbols.has(tok) && !/^[A-Z]/.test(tok) && !/^[0-9]/.test(tok)) {
                  const isMethodOrProp = new RegExp(`(?:\\.|::)\\s*${tok}\\b`).test(strippedRhs);
                  const isConstructor = new RegExp(`\\bnew\\s+${tok}\\b`).test(strippedRhs);
                  if (!isMethodOrProp && !isConstructor) {
                    return makeErrorDetails({
                      errorType: "COMPILATION_ERROR",
                      lineNumber: lineNum,
                      lineCode: rawLineCode,
                      messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \`${tok}\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u099F\u09BF \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u09A8\u09BE \u0995\u09B0\u09C7\u0987 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 (cannot find symbol: variable \`${tok}\`)\u0964`,
                      solutionBn: `\`${tok}\` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u09C7\u09B0 \u0986\u0997\u09C7 \u09B8\u09A0\u09BF\u0995 \u09A1\u09C7\u099F\u09BE \u099F\u09BE\u0987\u09AA\u09B8\u09B9 \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8 (\u09AF\u09C7\u09AE\u09A8: \`int ${tok} = ...;\`)\u0964`,
                      messageEn: `Cannot find symbol on line ${lineNum}: variable \`${tok}\` is undeclared.`,
                      explainLanguage
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
      const assignMatch = cleaned.match(
        /^([A-Za-z_$][\w$]*)\s*(?:\[\s*([^\]]+)\s*\])?\s*(=|\+=|-=|\*=|\/=|%=)\s*(.+?);?\s*$/
      );
      if (assignMatch && !cleaned.startsWith("if") && !cleaned.startsWith("while")) {
        const [, targetVar, idxExpr, op, rhsPart] = assignMatch;
        if (!declaredVars.has(targetVar) && !BUILTIN_IDENTIFIERS.has(targetVar)) {
          return makeErrorDetails({
            errorType: "COMPILATION_ERROR",
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \`${targetVar}\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u099F\u09BF \u0986\u0997\u09C7 \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF (cannot find symbol: variable \`${targetVar}\`)\u0964`,
            solutionBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \`${targetVar}\`-\u098F \u09AE\u09BE\u09A8 \u09B0\u09BE\u0996\u09BE\u09B0 \u0986\u0997\u09C7 \u09A1\u09C7\u099F\u09BE \u099F\u09BE\u0987\u09AA \u0989\u09B2\u09CD\u09B2\u09C7\u0996 \u0995\u09B0\u09C7 \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8 (\u09AF\u09C7\u09AE\u09A8: \`int ${targetVar} = ${rhsPart};\`)\u0964`,
            messageEn: `Cannot find symbol on line ${lineNum}: variable \`${targetVar}\` has not been declared.`,
            explainLanguage
          });
        }
        const targetType = declaredVars.get(targetVar);
        if (targetType && !idxExpr && op === "=") {
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
      const strippedLine = stripStringLiteralsFromLine(cleaned);
      const idRegex = /\b([A-Za-z_$][\w$]*)\b/g;
      let idMatch;
      while ((idMatch = idRegex.exec(strippedLine)) !== null) {
        const tok = idMatch[1];
        const idxInLine = idMatch.index;
        const beforeSlice = strippedLine.slice(0, idxInLine);
        if (/(?:\.|::)\s*$/.test(beforeSlice) || /\bnew\s+$/.test(beforeSlice)) continue;
        if (!BUILTIN_IDENTIFIERS.has(tok) && !declaredVars.has(tok) && !declaredFunctions.has(tok) && !importedSymbols.has(tok) && !(hasWildcardImport && /^[A-Z]/.test(tok)) && !/^[A-Z]/.test(tok)) {
          return makeErrorDetails({
            errorType: "COMPILATION_ERROR",
            lineNumber: lineNum,
            lineCode: rawLineCode,
            messageBn: `\u09B2\u09BE\u0987\u09A8 ${lineNum}-\u098F \u0985\u099C\u09CD\u099E\u09BE\u09A4 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u09AC\u09BE \u09B8\u09BF\u09AE\u09CD\u09AC\u09B2 \`${tok}\` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 \u09AF\u09BE \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09A8\u09BF (cannot find symbol: \`${tok}\`)\u0964`,
            solutionBn: `\`${tok}\` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u09C7\u09B0 \u0986\u0997\u09C7 \u098F\u099F\u09BF \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8 \u0985\u09A5\u09AC\u09BE \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7\u09B0 \u09A8\u09BE\u09AE\u09C7\u09B0 \u09AC\u09BE\u09A8\u09BE\u09A8 \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE \u0995\u09B0\u09C1\u09A8\u0964`,
            messageEn: `Cannot find symbol \`${tok}\` on line ${lineNum}.`,
            explainLanguage
          });
        }
      }
    }
  }
  return null;
}
function inferLineRole(trimmed) {
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
    return "comment";
  }
  if (/^(?:\}?\s*)?(?:if|else if|elif|else|switch|case|catch)\b/.test(trimmed)) return "condition";
  if (/^(?:for|while|do)\b/.test(trimmed)) return "loop";
  if (/^(?:return)\b/.test(trimmed)) return "return";
  if (/\b(?:console\.log|print|cout|System\.out\.print|System\.err\.print|printf)\b/.test(trimmed))
    return "output";
  if (/^(?:final\s+|static\s+)*(?:let|const|var|int|float|double|long|short|byte|string|String|bool|boolean|char|auto|vector|FileReader|Scanner|File)\b/.test(
    trimmed
  )) {
    return "declare";
  }
  if (trimmed === "}" || trimmed === "};" || trimmed === "{") return "block_end";
  if (trimmed.includes("=")) return "assign";
  return "call";
}
function buildStructureFromVariables(analogyType, variables, activeLineText = "") {
  const entries = Object.entries(variables || {});
  const arrayEntry = entries.find(([, v]) => Array.isArray(v));
  if (analogyType === "sort_blocks" || analogyType === "pointer_arrows" || analogyType === "binary_search_cards") {
    if (arrayEntry) {
      const arrVals = arrayEntry[1].map(
        (x) => typeof x === "number" || typeof x === "string" ? x : String(x)
      );
      const pointers = {};
      for (const [k, v] of entries) {
        if (typeof v === "number" && Number.isInteger(v) && ["i", "j", "k", "left", "right", "low", "high", "mid", "idx", "minIdx"].includes(k)) {
          pointers[k] = v;
        }
      }
      const highlight = Object.values(pointers).filter(
        (idx) => idx >= 0 && idx < arrVals.length
      );
      return {
        kind: "array",
        values: arrVals,
        pointers,
        highlight
      };
    }
  }
  if (analogyType === "stack_plates" || analogyType === "recursion_tower") {
    const stackArr = variables.callStack || variables.st || variables.stack || (arrayEntry ? arrayEntry[1] : null);
    if (Array.isArray(stackArr)) {
      return {
        kind: "stack",
        values: stackArr.map(
          (x) => typeof x === "number" || typeof x === "string" ? x : String(x)
        )
      };
    }
  }
  if (analogyType === "queue_line") {
    const qArr = variables.q || variables.queue || (arrayEntry ? arrayEntry[1] : null);
    if (Array.isArray(qArr)) {
      return {
        kind: "queue",
        values: qArr.map(
          (x) => typeof x === "number" || typeof x === "string" ? x : String(x)
        )
      };
    }
  }
  if (analogyType === "linked_list_train") {
    const listArr = variables.nodes || variables.list || (arrayEntry ? arrayEntry[1] : null);
    if (Array.isArray(listArr)) {
      return {
        kind: "list",
        values: listArr.map(
          (x) => typeof x === "number" || typeof x === "string" ? x : String(x)
        )
      };
    }
  }
  if (analogyType === "loop_gauge") {
    const firstNumericEntry = entries.find(([, v]) => typeof v === "number");
    const loopVar = typeof variables.i === "number" ? variables.i : typeof variables.count === "number" ? variables.count : typeof variables.temp === "number" ? variables.temp : firstNumericEntry ? firstNumericEntry[1] : 1;
    const condMatch = activeLineText.match(/(?:while|for)\s*\(([^)]+)\)/);
    return {
      kind: "loop",
      lap: Math.max(1, Math.abs(Number(loopVar)) || 1),
      maxLaps: 10,
      conditionText: condMatch ? condMatch[1].trim() : void 0
    };
  }
  if (arrayEntry) {
    return {
      kind: "array",
      values: arrayEntry[1].map(
        (x) => typeof x === "number" || typeof x === "string" ? x : String(x)
      )
    };
  }
  return null;
}
function formatVal(val) {
  if (val === null || val === void 0) return "null";
  if (typeof val === "string") return JSON.stringify(val);
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
function substituteExpressionValues(expr, varsBeforeOrCurrent) {
  if (!expr) return "";
  return expr.replace(/\b([A-Za-z_]\w*)\b/g, (token) => {
    if (token in varsBeforeOrCurrent && varsBeforeOrCurrent[token] !== void 0) {
      const v = varsBeforeOrCurrent[token];
      return typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    return token;
  });
}
function buildStepPedagogy(rec, prevVars) {
  const { line, actionType, codeSnippet, variables, memoryDelta, consoleOutput, meta } = rec;
  if (actionType === "METHOD_ENTRY") {
    if (meta?.subKind === "TRY_BLOCK") {
      return {
        whatHappenedBn: "`try` \u09AC\u09CD\u09B2\u0995\u09C7 \u09AA\u09CD\u09B0\u09AC\u09C7\u09B6 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u2014\u098F\u0987 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u0995\u09CB\u09A1 \u099A\u09BE\u09B2\u09BE\u09A8\u09CB\u09B0 \u09B8\u09AE\u09AF\u09BC \u0995\u09CB\u09A8\u09CB \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u098F\u0995\u09CD\u09B8\u09C7\u09AA\u09B6\u09A8 (Exception) \u0998\u099F\u09C7 \u0995\u09BF \u09A8\u09BE \u09A4\u09BE \u09AA\u09B0\u09CD\u09AF\u09AC\u09C7\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09BE \u09B9\u09AC\u09C7\u0964",
        logicBuildingBn: "\u09AF\u09C7\u09B8\u09AC \u0985\u09AA\u09BE\u09B0\u09C7\u09B6\u09A8\u09C7 \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u09A4\u09CD\u09B0\u09C1\u099F\u09BF \u09B9\u0993\u09DF\u09BE\u09B0 \u09B8\u09AE\u09CD\u09AD\u09BE\u09AC\u09A8\u09BE \u09A5\u09BE\u0995\u09C7 (\u09AF\u09C7\u09AE\u09A8 \u09AB\u09BE\u0987\u09B2 \u09AA\u09DC\u09BE \u09AC\u09BE \u09B6\u09C2\u09A8\u09CD\u09AF \u09A6\u09BF\u09DF\u09C7 \u09AD\u09BE\u0997), \u09B8\u09C7\u0997\u09C1\u09B2\u09CB `try` \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u09C7 \u09B0\u09BE\u0996\u09BE \u09B9\u09DF\u0964",
        whatHappenedEn: "Entered the `try` block to monitor statements for potential runtime exceptions.",
        logicBuildingEn: "Risky operations like file I/O or division are placed inside `try` so exceptions can be caught gracefully.",
        uiAction: "call"
      };
    }
    if (meta?.subKind === "FINALLY_BLOCK") {
      return {
        whatHappenedBn: "`try/catch` \u09AA\u09B0\u09CD\u09AC \u09B6\u09C7\u09B7\u09C7 \u098F\u0996\u09A8 \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 `finally` \u09AC\u09CD\u09B2\u0995\u09C7 \u09AA\u09CD\u09B0\u09AC\u09C7\u09B6 \u0995\u09B0\u09B2\u2014\u098F\u0995\u09CD\u09B8\u09C7\u09AA\u09B6\u09A8 \u0998\u099F\u09C1\u0995 \u09AC\u09BE \u09A8\u09BE \u0998\u099F\u09C1\u0995, \u098F\u0987 \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09B8\u09B0\u09CD\u09AC\u09A6\u09BE \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u09B9\u09DF\u0964",
        logicBuildingBn: "\u09AB\u09BE\u0987\u09B2 \u0995\u09CD\u09B2\u09CB\u099C \u0995\u09B0\u09BE \u09AC\u09BE \u09B0\u09BF\u09B8\u09CB\u09B0\u09CD\u09B8 \u09AE\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09BE\u09B0 \u09AE\u09A4\u09CB \u0986\u09AC\u09B6\u09CD\u09AF\u0995\u09C0\u09AF\u09BC \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4\u09BF \u0995\u09BE\u099C \u09A8\u09BF\u09B6\u09CD\u099A\u09BF\u09A4 \u0995\u09B0\u09A4\u09C7 `finally` \u09AC\u09CD\u09B2\u0995 \u09AC\u09CD\u09AF\u09AC\u09B9\u09C3\u09A4 \u09B9\u09AF\u09BC\u0964",
        whatHappenedEn: "Entered the `finally` block, which always executes regardless of whether an exception was thrown or caught.",
        logicBuildingEn: "`finally` guarantees that cleanup logic runs after `try` and `catch` complete.",
        uiAction: "call"
      };
    }
    if (meta?.subKind === "CLASS_DEF") {
      const className = meta.fnName || "Main";
      return {
        whatHappenedBn: `\`${className}\` \u0995\u09CD\u09B2\u09BE\u09B8\u09C7\u09B0 \u09A1\u09C7\u09AB\u09BF\u09A8\u09BF\u09B6\u09A8 \u09B6\u09C1\u09B0\u09C1 \u09B9\u09B2\u09CB, \u09AF\u09BE \u098F\u0987 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09C7\u09B0 \u09AE\u09C7\u09A5\u09A1 \u0993 \u09B2\u099C\u09BF\u0995 \u09A7\u09BE\u09B0\u09A3 \u0995\u09B0\u09C7\u0964`,
        logicBuildingBn: "\u0985\u09AC\u099C\u09C7\u0995\u09CD\u099F-\u0993\u09B0\u09BF\u09AF\u09BC\u09C7\u09A8\u09CD\u099F\u09C7\u09A1 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09BF\u0982\u09AF\u09BC\u09C7 (\u09AF\u09C7\u09AE\u09A8 Java \u09AC\u09BE C++) \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09C7\u09B0 \u09B8\u09AC \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09AE\u09C7\u09A5\u09A1 \u098F\u0995\u099F\u09BF \u0995\u09CD\u09B2\u09BE\u09B8\u09C7\u09B0 \u0995\u09BE\u09A0\u09BE\u09AE\u09CB\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u09B8\u0982\u099C\u09CD\u099E\u09BE\u09AF\u09BC\u09BF\u09A4 \u0995\u09B0\u09A4\u09C7 \u09B9\u09AF\u09BC\u0964",
        whatHappenedEn: `Entered class definition \`${className}\`, which encapsulates the program's methods and logic.`,
        logicBuildingEn: "In class-based languages like Java, executable methods must be organized inside a class container.",
        uiAction: "call"
      };
    }
    if (meta?.subKind === "MAIN_ENTRY" || meta?.fnName === "main") {
      return {
        whatHappenedBn: "`main` \u09AE\u09C7\u09A5\u09A1 \u09A5\u09C7\u0995\u09C7 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09C7\u09B0 \u09AE\u09C2\u09B2 \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u09B6\u09A8 (execution) \u09B6\u09C1\u09B0\u09C1 \u09B9\u09B2\u09CB\u0964",
        logicBuildingBn: "`main` \u09B9\u09B2\u09CB \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09C7\u09B0 \u098F\u09A8\u09CD\u099F\u09CD\u09B0\u09BF \u09AA\u09AF\u09BC\u09C7\u09A8\u09CD\u099F\u2014\u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u0987\u099E\u09CD\u099C\u09BF\u09A8 \u09B8\u09AC\u09BE\u09B0 \u0986\u0997\u09C7 \u098F\u0996\u09BE\u09A8 \u09A5\u09C7\u0995\u09C7\u0987 \u09B2\u09BE\u0987\u09A8 \u09AC\u09BE\u0987 \u09B2\u09BE\u0987\u09A8 \u0995\u09CB\u09A1 \u099A\u09BE\u09B2\u09BE\u09A8\u09CB \u09B6\u09C1\u09B0\u09C1 \u0995\u09B0\u09C7\u0964",
        whatHappenedEn: "Program execution started at the `main` entry point method.",
        logicBuildingEn: "`main` serves as the entry point where the runtime begins executing statements sequentially.",
        uiAction: "call"
      };
    }
    const fnName = meta?.fnName || "function";
    return {
      whatHappenedBn: `\`${fnName}\` \u09AB\u09BE\u0982\u09B6\u09A8\u09C7 \u09AA\u09CD\u09B0\u09AC\u09C7\u09B6 \u0995\u09B0\u09C7 \u098F\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u09A8\u09BF\u09B0\u09CD\u09A6\u09C7\u09B6\u09BE\u09AC\u09B2\u09BF \u099A\u09BE\u09B2\u09BE\u09A8\u09CB \u09B6\u09C1\u09B0\u09C1 \u09B9\u09B2\u09CB\u0964`,
      logicBuildingBn: "\u09A8\u09BF\u09B0\u09CD\u09A6\u09BF\u09B7\u09CD\u099F \u09B2\u099C\u09BF\u0995 \u09AC\u09BE \u0997\u09A3\u09A8\u09BE \u0986\u09B2\u09BE\u09A6\u09BE\u09AD\u09BE\u09AC\u09C7 \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u0995\u09B0\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \u098F\u0987 \u09AB\u09BE\u0982\u09B6\u09A8\u099F\u09BF \u0995\u09B2 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964",
      whatHappenedEn: `Entered function \`${fnName}\` and initialized its local parameters.`,
      logicBuildingEn: "Modular functions encapsulate reusable logic and maintain their own stack frame.",
      uiAction: "call"
    };
  }
  if (actionType === "LOOP_CHECK") {
    const condExpr = meta?.conditionExpr || codeSnippet;
    const resolved = substituteExpressionValues(condExpr, variables);
    const isTrue = Boolean(meta?.conditionResult);
    const iter = meta?.iteration || 1;
    const showResolved = resolved !== condExpr ? ` (\`${resolved}\`)` : "";
    if (isTrue) {
      return {
        whatHappenedBn: `\u09B2\u09C1\u09AA\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 \`${condExpr}\`${showResolved} \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u2014\u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u09B8\u09A4\u09CD\u09AF (\`true\`), \u09A4\u09BE\u0987 \u09B2\u09C1\u09AA\u09C7\u09B0 ${iter}\u09AE \u0986\u09AC\u09B0\u09CD\u09A4\u09A8 (Iteration ${iter}) \u09B6\u09C1\u09B0\u09C1 \u09B9\u099A\u09CD\u099B\u09C7\u0964`,
        logicBuildingBn: `\u09AF\u09A4\u0995\u09CD\u09B7\u09A3 \`${condExpr}\` \u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u09B8\u09A4\u09CD\u09AF (\`true\`) \u09A5\u09BE\u0995\u09AC\u09C7, \u09A4\u09A4\u0995\u09CD\u09B7\u09A3 \u09B2\u09C1\u09AA\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u0995\u09CB\u09A1 \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09AA\u09C1\u09A8\u09B0\u09BE\u09AF\u09BC \u099A\u09B2\u09C7 \u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u09A7\u09BE\u09AA\u09C7\u09B0 \u09B9\u09BF\u09B8\u09BE\u09AC \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u0995\u09B0\u09AC\u09C7\u0964`,
        whatHappenedEn: `Checked loop condition \`${condExpr}\`${showResolved} \u2014 evaluated to \`true\`, entering Iteration ${iter}.`,
        logicBuildingEn: `The loop continues executing its body on each iteration while \`${condExpr}\` remains \`true\`.`,
        uiAction: "loop_check"
      };
    } else {
      return {
        whatHappenedBn: `\u09B2\u09C1\u09AA\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 \`${condExpr}\`${showResolved} \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u2014\u098F\u0996\u09A8 \u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE (\`false\`), \u09A4\u09BE\u0987 \u09B2\u09C1\u09AA\u09C7\u09B0 \u0995\u09BE\u099C \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4 \u0995\u09B0\u09C7 \u09A8\u09BF\u09AF\u09BC\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u09B2\u09C1\u09AA\u09C7\u09B0 \u09AA\u09B0\u09C7\u09B0 \u09B2\u09BE\u0987\u09A8\u09C7 \u099A\u09B2\u09C7 \u09AF\u09BE\u099A\u09CD\u099B\u09C7\u0964`,
        logicBuildingBn: `\u09B2\u09C1\u09AA\u09C7\u09B0 \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4\u09BF \u09B6\u09B0\u09CD\u09A4\u09C7 \u09AA\u09CC\u0981\u099B\u09C7 \u09AF\u09BE\u0993\u09AF\u09BC\u09BE\u09AF\u09BC \u09AA\u09C1\u09A8\u09B0\u09BE\u09AC\u09C3\u09A4\u09CD\u09A4\u09BF \u09AC\u09A8\u09CD\u09A7 \u09B9\u09B2\u09CB, \u09AF\u09BE \u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA (Infinite Loop) \u09AA\u09CD\u09B0\u09A4\u09BF\u09B0\u09CB\u09A7 \u0995\u09B0\u09C7 \u098F\u09AC\u0982 \u099A\u09C2\u09A1\u09BC\u09BE\u09A8\u09CD\u09A4 \u09AB\u09B2\u09BE\u09AB\u09B2 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u09C7\u09B0 \u09B8\u09C1\u09AF\u09CB\u0997 \u09A6\u09C7\u09AF\u09BC\u0964`,
        whatHappenedEn: `Checked loop condition \`${condExpr}\`${showResolved} \u2014 evaluated to \`false\`, terminating the loop.`,
        logicBuildingEn: `Exiting the loop once \`${condExpr}\` becomes \`false\` prevents an infinite loop and moves control to the next phase.`,
        uiAction: "loop_check"
      };
    }
  }
  if (actionType === "CONDITION_CHECK") {
    if (meta?.subKind === "EXCEPTION_THROWN") {
      const excType = meta.exceptionType || "Exception";
      const excMsg = meta.exceptionMessage || "";
      return {
        whatHappenedBn: `\u098F\u0987 \u09B2\u09BE\u0987\u09A8\u09C7 \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u098F\u0995\u09CD\u09B8\u09C7\u09AA\u09B6\u09A8 \`${excType}\` (${excMsg ? `\`${excMsg}\`` : ""}) \u0998\u099F\u09C7\u099B\u09C7! \u09AB\u09B2\u09C7 \`try\` \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AC\u09BE\u0995\u09BF \u09B2\u09BE\u0987\u09A8\u0997\u09C1\u09B2\u09CB \u09B8\u09CD\u0995\u09BF\u09AA \u0995\u09B0\u09C7 \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \`catch\` \u09AC\u09CD\u09B2\u0995\u09C7 \u099A\u09B2\u09C7 \u09AF\u09BE\u099A\u09CD\u099B\u09C7\u0964`,
        logicBuildingBn: `\`try\` \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u0995\u09CB\u09A8\u09CB \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u09A4\u09CD\u09B0\u09C1\u099F\u09BF \u0998\u099F\u09B2\u09C7 \u09AA\u09B0\u09C7\u09B0 \u09B2\u09BE\u0987\u09A8\u0997\u09C1\u09B2\u09CB \u0986\u09B0 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u09A8\u09BE \u09B9\u09DF\u09C7 \u09B8\u09BE\u09A5\u09C7 \u09B8\u09BE\u09A5\u09C7 \u09AE\u09C7\u099A\u09BF\u0982 \`catch\` \u09AC\u09CD\u09B2\u0995\u09C7 \u099C\u09BE\u09AE\u09CD\u09AA \u0995\u09B0\u09C7\u0964`,
        whatHappenedEn: `Runtime exception \`${excType}\` (${excMsg}) occurred on this line, jumping directly to the matching \`catch\` block.`,
        logicBuildingEn: `When an exception is thrown inside a \`try\` block, remaining statements in \`try\` are bypassed and control transfers to \`catch\`.`,
        uiAction: "compare"
      };
    }
    if (meta?.subKind === "CATCH_BLOCK") {
      const excType = meta.exceptionType || "Exception";
      const targetVar = meta.targetVar || "e";
      const excVal = variables[targetVar] ?? excType;
      return {
        whatHappenedBn: `\`try\` \u09AC\u09CD\u09B2\u0995 \u09A5\u09C7\u0995\u09C7 \u0986\u09B8\u09BE \`${excType}\` \u098F\u0995\u09CD\u09B8\u09C7\u09AA\u09B6\u09A8\u099F\u09BF \u098F\u0987 \`catch\` \u09AC\u09CD\u09B2\u0995\u09C7 \u09A7\u09B0\u09BE \u09AA\u09DC\u09C7\u099B\u09C7 (\`${targetVar} = ${formatVal(
          excVal
        )}\`) \u098F\u09AC\u0982 \u098F\u0996\u09A8 \`catch\` \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u0995\u09CB\u09A1 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u09B9\u09AC\u09C7\u0964`,
        logicBuildingBn: `\`catch (${excType} ${targetVar})\` \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09A8\u09BF\u09B0\u09CD\u09A6\u09BF\u09B7\u09CD\u099F \u098F\u0995\u09CD\u09B8\u09C7\u09AA\u09B6\u09A8\u099F\u09BF \u0997\u09CD\u09B0\u09B9\u09A3 \u0995\u09B0\u09C7 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u0995\u09C7 \u0995\u09CD\u09B0\u09CD\u09AF\u09BE\u09B6 \u09B9\u0993\u09DF\u09BE \u09A5\u09C7\u0995\u09C7 \u09AC\u09BE\u0981\u099A\u09BE\u09DF \u098F\u09AC\u0982 \u098F\u09B0\u09B0 \u09B9\u09CD\u09AF\u09BE\u09A8\u09CD\u09A1\u09B2\u09BF\u0982 \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u0995\u09B0\u09C7\u0964`,
        whatHappenedEn: `Caught \`${excType}\` in \`catch\` block (\`${targetVar} = ${formatVal(
          excVal
        )}\`) and began executing the handler body.`,
        logicBuildingEn: `The matching \`catch\` block intercepts the runtime exception so the program can handle the error cleanly.`,
        uiAction: "compare"
      };
    }
    if (meta?.subKind === "ELSE_BRANCH") {
      return {
        whatHappenedBn: "\u0986\u0997\u09C7\u09B0 \u09B8\u09AC\u0997\u09C1\u09B2\u09CB `if` / `else if` \u09B6\u09B0\u09CD\u09A4 \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE (`false`) \u09B9\u0993\u09DF\u09BE\u09DF \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u099F\u09BF \u09AC\u09BF\u0995\u09B2\u09CD\u09AA `else` \u09AC\u09CD\u09B2\u0995\u09C7 \u09AA\u09CD\u09B0\u09AC\u09C7\u09B6 \u0995\u09B0\u09C7\u099B\u09C7\u0964",
        logicBuildingBn: "\u09AA\u09C2\u09B0\u09CD\u09AC\u09C7\u09B0 \u0995\u09CB\u09A8\u09CB \u09B6\u09B0\u09CD\u09A4\u0987 \u09A8\u09BE \u09AE\u09BF\u09B2\u09B2\u09C7 \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6 \u09A1\u09BF\u09AB\u09B2\u09CD\u099F \u09B8\u09BF\u09A6\u09CD\u09A7\u09BE\u09A8\u09CD\u09A4 \u09A8\u09C7\u0993\u09DF\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF `else` \u09B6\u09BE\u0996\u09BE\u099F\u09BF \u099A\u09BE\u09B2\u09BE\u09A8\u09CB \u09B9\u09DF\u0964",
        whatHappenedEn: "Entered the `else` branch because all preceding `if` / `else if` conditions evaluated to `false`.",
        logicBuildingEn: "The `else` block handles all remaining cases when none of the earlier conditions match.",
        uiAction: "compare"
      };
    }
    if (meta?.subKind === "SWITCH_ENTER") {
      const condExpr2 = meta?.conditionExpr || codeSnippet;
      const resolved2 = substituteExpressionValues(condExpr2, variables);
      return {
        whatHappenedBn: `\`${condExpr2}\` (${resolved2}) \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C7 \u09AE\u09CD\u09AF\u09BE\u099A\u09BF\u0982 \`case\` \u09B6\u09BE\u0996\u09BE \u0996\u09CB\u0981\u099C\u09BE \u09B9\u099A\u09CD\u099B\u09C7\u0964`,
        logicBuildingBn: "\u098F\u0995\u099F\u09BF \u09AE\u09BE\u09A8\u09C7\u09B0 \u0989\u09AA\u09B0 \u09AD\u09BF\u09A4\u09CD\u09A4\u09BF \u0995\u09B0\u09C7 \u098F\u0995\u09BE\u09A7\u09BF\u0995 \u09B8\u09AE\u09CD\u09AD\u09BE\u09AC\u09CD\u09AF \u09AC\u09BF\u0995\u09B2\u09CD\u09AA \u09A5\u09C7\u0995\u09C7 \u09A6\u09CD\u09B0\u09C1\u09A4 \u09B8\u09A0\u09BF\u0995 \u09B6\u09BE\u0996\u09BE \u09AC\u09C7\u099B\u09C7 \u09A8\u09BF\u09A4\u09C7 `switch` \u09AC\u09CD\u09AF\u09AC\u09B9\u09C3\u09A4 \u09B9\u09DF\u0964",
        whatHappenedEn: `Evaluating \`${condExpr2}\` (${resolved2}) to jump to the matching \`case\` branch.`,
        logicBuildingEn: "`switch` dispatches directly to the `case` matching the evaluated expression.",
        uiAction: "compare"
      };
    }
    if (meta?.subKind === "CASE_MATCH" || meta?.subKind === "DEFAULT_CASE") {
      const label = meta?.conditionExpr || codeSnippet;
      const isDefault = meta?.subKind === "DEFAULT_CASE";
      return {
        whatHappenedBn: isDefault ? "\u0995\u09CB\u09A8\u09CB `case` \u09AE\u09BE\u09A8 \u09A8\u09BE \u09AE\u09C7\u09B2\u09BE\u09DF `default` \u09B6\u09BE\u0996\u09BE\u099F\u09BF \u099A\u09BE\u09B2\u09C1 \u09B9\u09DF\u09C7\u099B\u09C7\u0964" : `\`switch\`-\u098F\u09B0 \u09AE\u09BE\u09A8 \`${label}\`-\u098F\u09B0 \u09B8\u09BE\u09A5\u09C7 \u09AE\u09BF\u09B2\u09C7 \u09AF\u09BE\u0993\u09DF\u09BE\u09DF \u098F\u0987 \u09B6\u09BE\u0996\u09BE\u09B0 \u0995\u09CB\u09A1 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u09B9\u099A\u09CD\u099B\u09C7\u0964`,
        logicBuildingBn: isDefault ? "\u0985\u09AA\u09CD\u09B0\u09A4\u09CD\u09AF\u09BE\u09B6\u09BF\u09A4 \u09AC\u09BE \u09AC\u09BE\u0995\u09BF \u09B8\u09AC \u0987\u09A8\u09AA\u09C1\u099F \u09A8\u09BF\u09B0\u09BE\u09AA\u09A6\u09AD\u09BE\u09AC\u09C7 \u09B9\u09CD\u09AF\u09BE\u09A8\u09CD\u09A1\u09C7\u09B2 \u0995\u09B0\u09A4\u09C7 `default` \u09B6\u09BE\u0996\u09BE \u0995\u09BE\u099C \u0995\u09B0\u09C7\u0964" : `\u09AE\u09CD\u09AF\u09BE\u099A\u09BF\u0982 \`${label}\` \u09AA\u09BE\u0993\u09DF\u09BE\u09DF \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \u098F\u0987 \u09B6\u09BE\u0996\u09BE\u09B0 \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F\u0997\u09C1\u09B2\u09CB \u09B0\u09BE\u09A8 \u09B9\u099A\u09CD\u099B\u09C7\u0964`,
        whatHappenedEn: isDefault ? "No `case` matched, so execution entered the `default` branch." : `Matched \`${label}\` and entered this branch.`,
        logicBuildingEn: isDefault ? "`default` catches any value not handled by explicit `case` labels." : "Control jumps directly to the matching `case` block.",
        uiAction: "compare"
      };
    }
    const condExpr = meta?.conditionExpr || codeSnippet;
    const resolved = substituteExpressionValues(condExpr, variables);
    const isTrue = Boolean(meta?.conditionResult);
    const isElseIf = /^(?:\}?\s*)?(?:else\s+if|elif)\b/.test(codeSnippet);
    const showResolved = resolved !== condExpr ? ` (\`${resolved}\`)` : "";
    if (isTrue) {
      return {
        whatHappenedBn: isElseIf ? `\u0986\u0997\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE \u09B9\u0993\u09DF\u09BE\u09DF \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \`else if\` \u09B6\u09B0\u09CD\u09A4 \`${condExpr}\`${showResolved} \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u2014\u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u09B8\u09A4\u09CD\u09AF (\`TRUE \u2705\`), \u09A4\u09BE\u0987 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u099F\u09BF \u098F\u0987 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u09AA\u09CD\u09B0\u09AC\u09C7\u09B6 \u0995\u09B0\u09C7\u099B\u09C7\u0964` : `\u09B6\u09B0\u09CD\u09A4 \`${condExpr}\`${showResolved} \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u2014\u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u09B8\u09A4\u09CD\u09AF (\`TRUE \u2705\`), \u09A4\u09BE\u0987 \u098F\u0987 \`if\` \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u0985\u0982\u09B6\u099F\u09BF \u098F\u0996\u09A8 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u09B9\u09AC\u09C7\u0964`,
        logicBuildingBn: isElseIf ? `\u0986\u0997\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4\u0997\u09C1\u09B2\u09CB \u09AC\u09CD\u09AF\u09B0\u09CD\u09A5 \u09B9\u0993\u09DF\u09BE\u09B0 \u09AA\u09B0 \`${condExpr}\` \u09B8\u09A4\u09CD\u09AF \u09B9\u0993\u09DF\u09BE\u09DF \u0995\u09AE\u09CD\u09AA\u09BE\u0987\u09B2\u09BE\u09B0 \u098F\u0987 \u09A8\u09BF\u09B0\u09CD\u09A6\u09BF\u09B7\u09CD\u099F \u09B6\u09BE\u0996\u09BE\u099F\u09BF \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u0995\u09B0\u099B\u09C7 \u098F\u09AC\u0982 \u09AA\u09B0\u09C7\u09B0 \u09AC\u09BF\u0995\u09B2\u09CD\u09AA\u0997\u09C1\u09B2\u09CB \u09B8\u09CD\u0995\u09BF\u09AA \u0995\u09B0\u09AC\u09C7\u0964` : `\`${condExpr}\` \u09B8\u09A4\u09CD\u09AF \u09B9\u0993\u09AF\u09BC\u09BE\u09AF\u09BC \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u099F\u09BF \u09B6\u09C1\u09A7\u09C1\u09AE\u09BE\u09A4\u09CD\u09B0 \u098F\u0987 \u09B6\u09BE\u0996\u09BE\u099F\u09BF (true branch) \u099A\u09BE\u09B2\u09BE\u09AC\u09C7 \u098F\u09AC\u0982 \u09AC\u09BF\u0995\u09B2\u09CD\u09AA \`else if / else\` \u09B6\u09BE\u0996\u09BE \u09B8\u09AE\u09CD\u09AA\u09C2\u09B0\u09CD\u09A3 \u09B8\u09CD\u0995\u09BF\u09AA \u0995\u09B0\u09AC\u09C7\u0964`,
        whatHappenedEn: `Evaluated \`${isElseIf ? "else if" : "if"}\` condition \`${condExpr}\`${showResolved} \u2014 result is \`TRUE\`, entering this branch.`,
        logicBuildingEn: `Because \`${condExpr}\` is \`true\`, this branch executes and remaining \`else if / else\` branches are skipped.`,
        uiAction: "compare"
      };
    } else {
      return {
        whatHappenedBn: isElseIf ? `\u0986\u0997\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE \u09B9\u0993\u09DF\u09BE\u09DF \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \`else if\` \u09B6\u09B0\u09CD\u09A4 \`${condExpr}\`${showResolved} \u099A\u09C7\u0995 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u2014\u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE (\`FALSE \u274C\`), \u09A4\u09BE\u0987 \u098F\u0987 \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09AC\u09BE\u09A6 \u09A6\u09BF\u09DF\u09C7 \u09AA\u09B0\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4\u09C7 \u09AF\u09BE\u099A\u09CD\u099B\u09C7\u0964` : `\u09B6\u09B0\u09CD\u09A4 \`${condExpr}\`${showResolved} \u099A\u09C7\u0995 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u2014\u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE (\`FALSE \u274C\`), \u09A4\u09BE\u0987 \u098F\u0987 \`if\` \u09AC\u09CD\u09B2\u0995\u099F\u09BF \u09B8\u09CD\u0995\u09BF\u09AA \u0995\u09B0\u09C7 \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09AC\u09BF\u0995\u09B2\u09CD\u09AA (\`else if\` \u09AC\u09BE \`else\`) \u099A\u09C7\u0995 \u0995\u09B0\u09A4\u09C7 \u09AF\u09BE\u099A\u09CD\u099B\u09C7\u0964`,
        logicBuildingBn: `\`${condExpr}\` \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE \u09B9\u0993\u09AF\u09BC\u09BE\u09AF\u09BC \u098F\u0987 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7\u09B0 \u0995\u09CB\u09A1 \u099A\u09B2\u09AC\u09C7 \u09A8\u09BE; \u09B8\u09A0\u09BF\u0995 \u09B6\u09BE\u0996\u09BE \u0996\u09C1\u0981\u099C\u09C7 \u09AA\u09C7\u09A4\u09C7 \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u09A7\u09BE\u09AA\u09C7 \u09A7\u09BE\u09AA\u09C7 \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09B6\u09B0\u09CD\u09A4\u099F\u09BF \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u099B\u09C7\u0964`,
        whatHappenedEn: `Checked \`${isElseIf ? "else if" : "if"}\` condition \`${condExpr}\`${showResolved} \u2014 result is \`FALSE\`, moving to the next branch.`,
        logicBuildingEn: `When a condition evaluates to \`false\`, execution skips its body and tests the next \`else if\` or \`else\` branch.`,
        uiAction: "compare"
      };
    }
  }
  if (actionType === "OUTPUT") {
    const outText = consoleOutput ?? meta?.printedText ?? "";
    return {
      whatHappenedBn: `\u0995\u09A8\u09B8\u09CB\u09B2\u09C7 \u0986\u0989\u099F\u09AA\u09C1\u099F \u09B9\u09BF\u09B8\u09C7\u09AC\u09C7 \`${formatVal(outText)}\` \u09AA\u09CD\u09B0\u09BF\u09A8\u09CD\u099F \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964`,
      logicBuildingBn: `\u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09A4\u09C7 \u09B9\u09BF\u09B8\u09BE\u09AC \u0993 \u09B6\u09B0\u09CD\u09A4 \u09AF\u09BE\u099A\u09BE\u0987 \u09B6\u09C7\u09B7\u09C7 \u09AA\u09CD\u09B0\u09BE\u09AA\u09CD\u09A4 \u09AB\u09B2\u09BE\u09AB\u09B2 \`${formatVal(outText)}\` \u09AA\u09CD\u09B0\u09A6\u09B0\u09CD\u09B6\u09A8\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u098F\u0987 \u0986\u0989\u099F\u09AA\u09C1\u099F \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F\u099F\u09BF \u099A\u09BE\u09B2\u09BE\u09A8\u09CB \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964`,
      whatHappenedEn: `Printed \`${formatVal(outText)}\` to standard output (console).`,
      logicBuildingEn: `Outputs the computed result \`${formatVal(outText)}\` after completing state evaluation.`,
      uiAction: "call"
    };
  }
  if (actionType === "BLOCK_END") {
    if (meta?.subKind === "RETURN") {
      const rv = meta.returnVal !== void 0 ? ` \`${formatVal(meta.returnVal)}\`` : "";
      return {
        whatHappenedBn: `\u09AB\u09BE\u0982\u09B6\u09A8 \u09A5\u09C7\u0995\u09C7${rv} \u09B0\u09BF\u099F\u09BE\u09B0\u09CD\u09A8 \u0995\u09B0\u09C7 \u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u09AE\u09C7\u09A5\u09A1\u09C7\u09B0 \u0995\u09BE\u099C \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964`,
        logicBuildingBn: "\u09B9\u09BF\u09B8\u09BE\u09AC\u0995\u09C3\u09A4 \u09AE\u09BE\u09A8 \u0995\u09B2\u0995\u09BE\u09B0\u09C0 \u0985\u0982\u09B6\u09C7 \u09AB\u09C7\u09B0\u09A4 \u09AA\u09BE\u09A0\u09BE\u09A4\u09C7 \u09AC\u09BE \u09AE\u09C7\u09A5\u09A1 \u09B8\u09AE\u09BE\u09AA\u09CD\u09A4 \u0995\u09B0\u09A4\u09C7 `return` \u09AC\u09CD\u09AF\u09AC\u09B9\u09C3\u09A4 \u09B9\u09AF\u09BC\u0964",
        whatHappenedEn: `Returned${rv} and exited the current function scope.`,
        logicBuildingEn: "`return` hands the computed result back to the caller and terminates the method.",
        uiAction: "return"
      };
    }
    if (meta?.subKind === "LOOP_JUMP") {
      const isBreak = meta?.conditionExpr === "break";
      return {
        whatHappenedBn: isBreak ? "`break` \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F \u099A\u09B2\u09BE\u09DF \u099A\u09B2\u09AE\u09BE\u09A8 \u09B2\u09C1\u09AA \u09AC\u09BE `switch` \u09AC\u09CD\u09B2\u0995 \u09A5\u09C7\u0995\u09C7 \u09A4\u09BE\u09CE\u0995\u09CD\u09B7\u09A3\u09BF\u0995 \u09AC\u09C7\u09B0 \u09B9\u09DF\u09C7 \u09AF\u09BE\u099A\u09CD\u099B\u09C7\u0964" : "`continue` \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F \u099A\u09B2\u09BE\u09DF \u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u0987\u099F\u09BE\u09B0\u09C7\u09B6\u09A8\u09C7\u09B0 \u09AC\u09BE\u0995\u09BF \u0985\u0982\u09B6 \u09AC\u09BE\u09A6 \u09A6\u09BF\u09DF\u09C7 \u09B2\u09C1\u09AA\u09C7\u09B0 \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09A7\u09BE\u09AA\u09C7 \u09AF\u09BE\u099A\u09CD\u099B\u09C7\u0964",
        logicBuildingBn: isBreak ? "\u0995\u09BE\u099C \u09AC\u09BE \u09B2\u0995\u09CD\u09B7\u09CD\u09AF \u0985\u09B0\u09CD\u099C\u09BF\u09A4 \u09B9\u09DF\u09C7 \u0997\u09C7\u09B2\u09C7 \u0985\u09AA\u09CD\u09B0\u09DF\u09CB\u099C\u09A8\u09C0\u09DF \u09AA\u09C1\u09A8\u09B0\u09BE\u09AC\u09C3\u09A4\u09CD\u09A4\u09BF \u09A5\u09BE\u09AE\u09BE\u09A4\u09C7 `break` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09DF\u0964" : "\u09A8\u09BF\u09B0\u09CD\u09A6\u09BF\u09B7\u09CD\u099F \u0995\u09CB\u09A8\u09CB \u09A7\u09BE\u09AA \u098F\u09DC\u09BF\u09DF\u09C7 \u09AA\u09B0\u09C7\u09B0 \u09AA\u09C1\u09A8\u09B0\u09BE\u09AC\u09C3\u09A4\u09CD\u09A4\u09BF\u09A4\u09C7 \u09AF\u09C7\u09A4\u09C7 `continue` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09DF\u0964",
        whatHappenedEn: isBreak ? "Executed `break`, immediately exiting the enclosing loop or `switch`." : "Executed `continue`, skipping to the next iteration of the loop.",
        logicBuildingEn: isBreak ? "`break` halts unnecessary iterations once the desired branch or target is reached." : "`continue` bypasses remaining loop statements for the current cycle.",
        uiAction: "return"
      };
    }
    return {
      whatHappenedBn: "\u098F\u0987 \u0995\u09CB\u09A1 \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 (`}`) \u09B8\u09AC\u0997\u09C1\u09B2\u09CB \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09B8\u09CD\u099F\u09C7\u099F\u09AE\u09C7\u09A8\u09CD\u099F \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u09B9\u0993\u09DF\u09BE\u09DF \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u09B8\u09CD\u09A4\u09B0\u09C7 \u09AB\u09BF\u09B0\u09C7 \u0986\u09B8\u099B\u09C7\u0964",
      logicBuildingBn: "\u0995\u09CD\u09B2\u09CB\u099C\u09BF\u0982 \u09AC\u09CD\u09B0\u09C7\u09B8 (`}`) \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u09B8\u09CD\u0995\u09CB\u09AA \u0993 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF \u09B2\u09BE\u0987\u09AB\u099F\u09BE\u0987\u09AE \u09B8\u09C0\u09AE\u09BE \u09A8\u09BF\u09B0\u09CD\u09A7\u09BE\u09B0\u09A3 \u0995\u09B0\u09C7 \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u0985\u0982\u09B6\u09C7 \u09AA\u09CC\u0981\u099B\u09C7 \u09A6\u09C7\u09DF\u0964",
      whatHappenedEn: `Reached the closing brace of the current execution block at line ${line}.`,
      logicBuildingEn: "Closes the active block scope and returns control flow to the outer scope.",
      uiAction: "return"
    };
  }
  if (meta?.subKind === "CLOSE_RESOURCE") {
    const varName2 = meta.targetVar || "scanner";
    return {
      whatHappenedBn: `\u0987\u09A8\u09AA\u09C1\u099F \u09B0\u09BF\u09B8\u09CB\u09B0\u09CD\u09B8 \`${varName2}\` \u09AC\u09A8\u09CD\u09A7 (\`close()\`) \u0995\u09B0\u09BE \u09B9\u09B2\u09CB \u09AF\u09BE\u09A4\u09C7 \u0986\u09B0 \u0995\u09CB\u09A8\u09CB \u09B8\u09BF\u09B8\u09CD\u099F\u09C7\u09AE \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF \u09AC\u09BE \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u09AE \u0996\u09CB\u09B2\u09BE \u09A8\u09BE \u09A5\u09BE\u0995\u09C7\u0964`,
      logicBuildingBn: "\u0987\u09A8\u09AA\u09C1\u099F \u09A8\u09C7\u0993\u09DF\u09BE\u09B0 \u0995\u09BE\u099C \u09B6\u09C7\u09B7 \u09B9\u09B2\u09C7 `close()` \u0995\u09B2 \u0995\u09B0\u09C7 \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u09AE \u09AE\u09C1\u0995\u09CD\u09A4 \u0995\u09B0\u09BE \u09AD\u09BE\u09B2\u09CB \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09BF\u0982 \u099A\u09B0\u09CD\u099A\u09BE (Resource Cleanup)\u0964",
      whatHappenedEn: `Closed resource \`${varName2}\` to release the underlying input stream.`,
      logicBuildingEn: "Explicitly closing I/O streams prevents resource leaks after input is complete.",
      uiAction: "call"
    };
  }
  const varName = memoryDelta?.variable || meta?.targetVar || "variable";
  const oldVal = memoryDelta?.oldValue ?? null;
  const newVal = memoryDelta?.newValue !== void 0 ? memoryDelta.newValue : variables[varName];
  const rhsExpr = meta?.rhsExpr || "";
  if (actionType === "DECLARE" && (newVal === null || newVal === void 0) && !rhsExpr) {
    return {
      whatHappenedBn: `\u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09A4\u09C7 \u09A8\u09A4\u09C1\u09A8 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \`${varName}\` \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 (\u09A4\u09C8\u09B0\u09BF) \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u2014\u098F\u0996\u09A8\u0993 \u0995\u09CB\u09A8\u09CB \u09AE\u09BE\u09A8 \u09A8\u09BE \u09A6\u09C7\u0993\u09DF\u09BE\u09DF \u098F\u09B0 \u09AA\u09CD\u09B0\u09BE\u09A5\u09AE\u09BF\u0995 \u0985\u09AC\u09B8\u09CD\u09A5\u09BE \`uninitialized / null\`\u0964`,
      logicBuildingBn: `\u09B6\u09B0\u09CD\u09A4 \u09AF\u09BE\u099A\u09BE\u0987 \u09AC\u09BE \u0987\u09A8\u09AA\u09C1\u099F\u09C7\u09B0 \u09AA\u09B0 \u09AE\u09BE\u09A8 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \u0986\u0997\u09C7\u09AD\u09BE\u0997\u09C7 \`${varName}\`-\u098F\u09B0 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF \u09AC\u0995\u09CD\u09B8 \u09AA\u09CD\u09B0\u09B8\u09CD\u09A4\u09C1\u09A4 \u09B0\u09BE\u0996\u09BE \u09B9\u09DF\u09C7\u099B\u09C7\u0964`,
      whatHappenedEn: `Declared \`${varName}\` in memory without an initial assignment (\`uninitialized / null\`).`,
      logicBuildingEn: `Reserves memory space for \`${varName}\` before conditional branches or assignments populate it.`,
      uiAction: "declare"
    };
  }
  if (meta?.stdinRead !== void 0) {
    return {
      whatHappenedBn: `\u0987\u09A8\u09AA\u09C1\u099F \u09B8\u09CD\u099F\u09CD\u09B0\u09BF\u09AE (STDIN) \u09A5\u09C7\u0995\u09C7 \`${meta.stdinRead}\` \u09AE\u09BE\u09A8\u099F\u09BF \u09AA\u09DC\u09C7 \`${varName}\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7\u09B0 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF \u09AC\u0995\u09CD\u09B8\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB (\u09AC\u09B0\u09CD\u09A4\u09AE\u09BE\u09A8 \u09AE\u09BE\u09A8: \`${formatVal(
        newVal
      )}\`)\u0964`,
      logicBuildingBn: `\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u09B0\u09BE\u09A8 \u0995\u09B0\u09BE\u09B0 \u09B8\u09AE\u09DF \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u0995\u09BE\u09B0\u09C0\u09B0 \u09A6\u09C7\u0993\u09DF\u09BE \u0987\u09A8\u09AA\u09C1\u099F \u0997\u09CD\u09B0\u09B9\u09A3 \u0995\u09B0\u09C7 \`${varName}\`-\u098F \u09B0\u09BE\u0996\u09BE \u09B9\u09DF\u09C7\u099B\u09C7, \u09AF\u09BE\u09B0 \u0993\u09AA\u09B0 \u09AD\u09BF\u09A4\u09CD\u09A4\u09BF \u0995\u09B0\u09C7 \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09B6\u09B0\u09CD\u09A4 \u09AC\u09BE \u0997\u09A3\u09A8\u09BE \u099A\u09B2\u09AC\u09C7\u0964`,
      whatHappenedEn: `Read \`${meta.stdinRead}\` from standard input (STDIN) and stored \`${formatVal(
        newVal
      )}\` in \`${varName}\`.`,
      logicBuildingEn: `Captures dynamic user input into \`${varName}\` so downstream logic branches and calculations use the live runtime value.`,
      uiAction: "declare"
    };
  }
  const varsForSubst = { ...prevVars };
  for (const [k, v] of Object.entries(variables)) {
    if (!(k in varsForSubst)) varsForSubst[k] = v;
  }
  const resolvedRhs = rhsExpr ? substituteExpressionValues(rhsExpr, prevVars) : "";
  const hasMathOp = /[+\-*/%]/.test(rhsExpr);
  const mathDetail = rhsExpr && hasMathOp && resolvedRhs !== String(newVal) ? ` (\`${rhsExpr}\` = \`${resolvedRhs}\` = \`${formatVal(newVal)}\`)` : rhsExpr && resolvedRhs !== rhsExpr && resolvedRhs !== String(newVal) ? ` (\`${rhsExpr}\` \u2192 \`${formatVal(newVal)}\`)` : "";
  let logicBn = "";
  let logicEn = "";
  if (/%\s*10\b/.test(rhsExpr)) {
    logicBn = `\u09AF\u09C7\u0995\u09CB\u09A8\u09CB \u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u0995\u09C7 \`10\` \u09A6\u09BF\u09AF\u09BC\u09C7 \u09AE\u09A1\u09C1\u09B2\u09BE\u09B8 (\`% 10\`) \u0995\u09B0\u09B2\u09C7 \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u099F\u09BF\u09B0 \u098F\u0995\u09A6\u09AE \u09B6\u09C7\u09B7\u09C7\u09B0 \u09A1\u09BF\u099C\u09BF\u099F (\`${formatVal(
      newVal
    )}\`) \u0986\u09B2\u09BE\u09A6\u09BE \u09B9\u09AF\u09BC\u09C7 \u09AC\u09C7\u09B0\u09BF\u09AF\u09BC\u09C7 \u0986\u09B8\u09C7\u0964`;
    logicEn = `Taking modulo \`10\` (\`% 10\`) extracts the last digit (\`${formatVal(
      newVal
    )}\`) of the integer.`;
  } else if (/\*\s*10\s*\+/.test(rhsExpr)) {
    logicBn = `\u0986\u0997\u09C7\u09B0 \u0989\u09B2\u09CD\u099F\u09CB \u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 \u09B8\u09BE\u09A5\u09C7 \`10\` \u0997\u09C1\u09A3 \u0995\u09B0\u09C7 \u0985\u0999\u09CD\u0995\u0997\u09C1\u09B2\u09CB\u0995\u09C7 \u098F\u0995 \u0998\u09B0 \u09AC\u09BE\u09AE\u09C7 \u09B8\u09B0\u09BE\u09A8\u09CB \u09B9\u09B2\u09CB \u098F\u09AC\u0982 \u09A8\u09A4\u09C1\u09A8 \u09A1\u09BF\u099C\u09BF\u099F \u09AF\u09CB\u0997 \u0995\u09B0\u09C7 \`${formatVal(
      newVal
    )}\` \u0997\u09A0\u09A8 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964`;
    logicEn = `Multiplying by \`10\` shifts existing digits left so the extracted digit can be appended to form \`${formatVal(
      newVal
    )}\`.`;
  } else if (/(\/|\/\/)\s*10\b/.test(rhsExpr)) {
    logicBn = `\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u099F\u09BF\u0995\u09C7 \`10\` \u09A6\u09BF\u09AF\u09BC\u09C7 \u09AA\u09C2\u09B0\u09CD\u09A3\u09B8\u0982\u0996\u09CD\u09AF\u09BE\u09B0 \u09AD\u09BE\u0997 (integer division) \u0995\u09B0\u09C7 \u09AC\u09CD\u09AF\u09AC\u09B9\u09C3\u09A4 \u09B6\u09C7\u09B7 \u09A1\u09BF\u099C\u09BF\u099F\u099F\u09BF \u09AC\u09BE\u09A6 \u09A6\u09C7\u0993\u09AF\u09BC\u09BE \u09B9\u09B2\u09CB, \u09AB\u09B2\u09C7 \u09AC\u09BE\u0995\u09BF \u09A5\u09BE\u0995\u09B2 \`${formatVal(
      newVal
    )}\`\u0964`;
    logicEn = `Integer division by \`10\` removes the rightmost digit that was just processed, leaving \`${formatVal(
      newVal
    )}\`.`;
  } else if (/^[A-Za-z_]\w*$/.test(rhsExpr) && rhsExpr in prevVars) {
    logicBn = `\u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09A7\u09BE\u09AA\u09C7 \u09AC\u09BE \u09B2\u09C1\u09AA\u09C7 \u09AE\u09BE\u09A8 \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u0995\u09B0\u09BE\u09B0 \u09B8\u09AE\u09AF\u09BC \u09AE\u09C2\u09B2 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \`${rhsExpr}\`-\u098F\u09B0 \u09AE\u09BE\u09A8 (\`${formatVal(
      newVal
    )}\`) \u09AF\u09C7\u09A8 \u0985\u0995\u09CD\u09B7\u09A4 \u09A5\u09BE\u0995\u09C7, \u09A4\u09BE\u0987 \`${varName}\`-\u098F \u0995\u09AA\u09BF \u0995\u09B0\u09C7 \u09B0\u09BE\u0996\u09BE \u09B9\u09B2\u09CB\u0964`;
    logicEn = `Copied \`${rhsExpr}\` (\`${formatVal(
      newVal
    )}\`) into \`${varName}\` so the original value is preserved during subsequent mutations.`;
  } else if (/\+\+|--|\+=\s*1|-=\s*1/.test(rhsExpr)) {
    logicBn = `\u09B2\u09C1\u09AA \u09AC\u09BE \u0987\u09A8\u09A1\u09C7\u0995\u09CD\u09B8 \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09A7\u09BE\u09AA\u09C7 \u098F\u0997\u09BF\u09AF\u09BC\u09C7 \u09A8\u09C7\u0993\u09AF\u09BC\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \`${varName}\`-\u098F\u09B0 \u09AE\u09BE\u09A8 \`${formatVal(
      oldVal
    )}\` \u09A5\u09C7\u0995\u09C7 \u0986\u09AA\u09A1\u09C7\u099F \u0995\u09B0\u09C7 \`${formatVal(newVal)}\` \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964`;
    logicEn = `Updated loop/index counter \`${varName}\` from \`${formatVal(
      oldVal
    )}\` to \`${formatVal(newVal)}\` to advance toward termination.`;
  } else if (actionType === "DECLARE" && newVal === 0) {
    logicBn = `\u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u09A7\u09BE\u09AA\u09C7 \u0997\u09A3\u09A8\u09BE\u09B0 \u09AB\u09B2\u09BE\u09AB\u09B2 \u099C\u09AE\u09BE \u09B0\u09BE\u0996\u09BE\u09B0 \u099C\u09A8\u09CD\u09AF \`${varName}\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u0995\u09C7 \u09B6\u09C1\u09B0\u09C1\u09A4\u09C7 \`0\` \u09A6\u09BF\u09AF\u09BC\u09C7 \u0987\u09A8\u09BF\u09B6\u09BF\u09AF\u09BC\u09BE\u09B2\u09BE\u0987\u099C \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964`;
    logicEn = `Initialized accumulator \`${varName}\` to \`0\` before starting the iterative computation.`;
  } else if (actionType === "DECLARE") {
    logicBn = `\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u09C7\u09B0 \u09AA\u09B0\u09AC\u09B0\u09CD\u09A4\u09C0 \u0997\u09BE\u09A3\u09BF\u09A4\u09BF\u0995 \u09B9\u09BF\u09B8\u09BE\u09AC \u0993 \u09B6\u09B0\u09CD\u09A4 \u09AF\u09BE\u099A\u09BE\u0987\u09AF\u09BC\u09C7 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u09C7\u09B0 \u099C\u09A8\u09CD\u09AF \`${varName}\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7 \`${formatVal(
      newVal
    )}\` \u09AE\u09BE\u09A8\u099F\u09BF \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09A4\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964`;
    logicEn = `Stored initial value \`${formatVal(
      newVal
    )}\` in \`${varName}\` for use in subsequent expressions and conditions.`;
  } else {
    logicBn = `\`${rhsExpr || codeSnippet}\` \u09B9\u09BF\u09B8\u09BE\u09AC \u0995\u09B0\u09C7 \`${varName}\`-\u098F\u09B0 \u09AA\u09C1\u09B0\u09A8\u09CB \u09AE\u09BE\u09A8 \`${formatVal(
      oldVal
    )}\` \u09AA\u09B0\u09BF\u09AC\u09B0\u09CD\u09A4\u09A8 \u0995\u09B0\u09C7 \u09A8\u09A4\u09C1\u09A8 \u09AE\u09BE\u09A8 \`${formatVal(newVal)}\` \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09A4\u09C7 \u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09A3 \u0995\u09B0\u09BE \u09B9\u09B2\u09CB\u0964`;
    logicEn = `Evaluated \`${rhsExpr || codeSnippet}\` and updated \`${varName}\` from \`${formatVal(
      oldVal
    )}\` to \`${formatVal(newVal)}\`.`;
  }
  if (actionType === "DECLARE" && oldVal === null) {
    return {
      whatHappenedBn: `\u09A8\u09A4\u09C1\u09A8 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \`${varName}\` \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09C7 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09A4\u09C7 \u09A4\u09BE\u09B0 \u09AE\u09BE\u09A8 \`${formatVal(
        newVal
      )}\` \u09B8\u09C7\u099F \u0995\u09B0\u09BE \u09B9\u09B2\u09CB${mathDetail}\u0964`,
      logicBuildingBn: logicBn,
      whatHappenedEn: `Declared variable \`${varName}\` and initialized it to \`${formatVal(
        newVal
      )}\`${mathDetail}.`,
      logicBuildingEn: logicEn,
      uiAction: "declare"
    };
  }
  return {
    whatHappenedBn: `\`${varName}\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7\u09B0 \u09AE\u09BE\u09A8 \`${formatVal(
      oldVal
    )}\` \u09A5\u09C7\u0995\u09C7 \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u09C7 \`${formatVal(newVal)}\` \u09B9\u09B2\u09CB${mathDetail}\u0964`,
    logicBuildingBn: logicBn,
    whatHappenedEn: `Updated \`${varName}\` from \`${formatVal(
      oldVal
    )}\` to \`${formatVal(newVal)}\`${mathDetail}.`,
    logicBuildingEn: logicEn,
    uiAction: /^[A-Za-z_]\w*$/.test(rhsExpr) ? "transfer" : "assign"
  };
}
function parseComparisonVisual(condExpr, variables, result) {
  if (!condExpr || condExpr === "else" || condExpr === "default") return null;
  const firstClause = condExpr.split(/&&|\|\||\band\b|\bor\b/)[0].trim();
  const cmpMatch = firstClause.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!cmpMatch) return null;
  const leftLabel = cmpMatch[1].trim();
  const operator = cmpMatch[2].trim();
  const rightLabel = cmpMatch[3].trim();
  const formatOperandLabel = (expr) => {
    const trimmed = expr.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { varName: null, label: trimmed };
    if (trimmed in variables && variables[trimmed] !== void 0 && variables[trimmed] !== null) {
      const v = variables[trimmed];
      const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
      return { varName: trimmed, label: `${trimmed} (${valStr})` };
    }
    return { varName: null, label: substituteExpressionValues(trimmed, variables) };
  };
  const leftInfo = formatOperandLabel(leftLabel);
  const rightInfo = formatOperandLabel(rightLabel);
  return {
    leftVar: leftInfo.varName,
    rightVar: rightInfo.varName,
    leftLabel: leftInfo.label,
    rightLabel: rightInfo.label,
    operator,
    result
  };
}
function buildFallbackTrace(params) {
  const { code, language, explainLanguage, depth, fileName } = params;
  const traceSource = language === "cpp" || language === "java" ? "ai_predicted" : "real_execution";
  const syntaxErr = detectSyntaxError(code, explainLanguage, language, fileName);
  if (syntaxErr) {
    const lines = code.split("\n");
    const lineNotes = [];
    lines.forEach((raw, idx) => {
      const t = raw.trim();
      if (!t) return;
      const ln = idx + 1;
      lineNotes.push({
        line: ln,
        role: inferLineRole(t),
        text: ln === syntaxErr.lineNumber ? syntaxErr.message : explainLanguage === "bn" ? `\u09B2\u09BE\u0987\u09A8 ${ln}: \`${t.slice(0, 36)}\` \u2014 \u0995\u09AE\u09CD\u09AA\u09BE\u0987\u09B2/\u09B8\u09BF\u09A8\u099F\u09CD\u09AF\u09BE\u0995\u09CD\u09B8 \u09A4\u09CD\u09B0\u09C1\u099F\u09BF\u09B0 \u0995\u09BE\u09B0\u09A3\u09C7 \u0995\u09CB\u09A1\u099F\u09BF \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u0995\u09B0\u09BE \u09B9\u09DF\u09A8\u09BF\u0964` : `Line ${ln}: \`${t.slice(0, 36)}\` \u2014 not executed due to compilation error.`,
        why: ln === syntaxErr.lineNumber ? syntaxErr.solutionBn ?? "" : void 0
      });
    });
    return {
      hasError: true,
      isValidLogic: false,
      errorDetails: syntaxErr,
      language,
      analogyType: "generic_memory",
      traceSource,
      logicSummary: {
        title: explainLanguage === "bn" ? `\u09A4\u09CD\u09B0\u09C1\u099F\u09BF \u09B6\u09A8\u09BE\u0995\u09CD\u09A4 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 (${syntaxErr.errorType ?? "SYNTAX_ERROR"})` : `Compilation / Syntax Error (${syntaxErr.errorType ?? "SYNTAX_ERROR"})`,
        goal: syntaxErr.messageBn ?? syntaxErr.message,
        idea: syntaxErr.solutionBn ?? "",
        keyPoints: [
          explainLanguage === "bn" ? `\u09A4\u09CD\u09B0\u09C1\u099F\u09BF\u09B0 \u09A7\u09B0\u09A8: ${syntaxErr.errorType ?? "ERROR"} (\u09B2\u09BE\u0987\u09A8 ${syntaxErr.lineNumber ?? 1})` : `Error Type: ${syntaxErr.errorType ?? "ERROR"} (Line ${syntaxErr.lineNumber ?? 1})`,
          explainLanguage === "bn" ? `\u09A4\u09CD\u09B0\u09C1\u099F\u09BF\u09AA\u09C2\u09B0\u09CD\u09A3 \u09B2\u09BE\u0987\u09A8: \`${syntaxErr.lineCode ?? ""}\`` : `Problematic Line: \`${syntaxErr.lineCode ?? ""}\``,
          syntaxErr.solutionBn ?? ""
        ],
        analogyStory: syntaxErr.messageBn ?? syntaxErr.message,
        complexity: {
          time: "N/A",
          space: "N/A",
          note: syntaxErr.solutionBn ?? ""
        },
        commonMistakes: [syntaxErr.messageBn ?? syntaxErr.message]
      },
      lineNotes,
      steps: [],
      finalOutput: "",
      outputExplanation: syntaxErr.message,
      verdict: {
        status: "compile_error",
        message: syntaxErr.message
      },
      programSummary: null
    };
  }
  const normalized = code.replace(/\s+/g, " ").trim();
  for (const sample of SAMPLE_PROGRAMS) {
    for (const langKey of ["javascript", "python", "cpp", "java"]) {
      if (sample.codes[langKey].replace(/\s+/g, " ").trim() === normalized) {
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
            finalOutput: baseTrace.finalOutput
          }
        };
      }
    }
  }
  const curatedMatch = matchCuratedLibraryProblemTrace(params);
  if (curatedMatch) {
    return curatedMatch;
  }
  const sandboxRun = runDeterministicMultiLanguage(code, language, "", 1200);
  if (sandboxRun.runtimeError && (sandboxRun.recordedSteps.length === 0 || /is not defined|SyntaxError|ReferenceError/.test(sandboxRun.runtimeError))) {
    const rawLines = code.split("\n");
    let errLine = sandboxRun.runtimeErrorLine || 1;
    const undefMatch = sandboxRun.runtimeError.match(/([A-Za-z_$][\w$]*)\s+is not defined/);
    if (undefMatch) {
      const sym = undefMatch[1];
      const foundIdx = rawLines.findIndex((l) => new RegExp(`\\b${sym}\\b`).test(l));
      if (foundIdx >= 0) errLine = foundIdx + 1;
    }
    const lineCode = rawLines[errLine - 1]?.trim() || "";
    const errDetails = makeErrorDetails({
      errorType: "COMPILATION_ERROR",
      lineNumber: errLine,
      lineCode,
      messageBn: undefMatch ? `\u09B2\u09BE\u0987\u09A8 ${errLine}-\u098F \`${undefMatch[1]}\` \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u09AC\u09BE \u09AB\u09BE\u0982\u09B6\u09A8\u099F\u09BF \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u09A8\u09BE \u0995\u09B0\u09C7\u0987 \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7 (${sandboxRun.runtimeError})\u0964` : `\u09B2\u09BE\u0987\u09A8 ${errLine}-\u098F \u09A4\u09CD\u09B0\u09C1\u099F\u09BF \u0998\u099F\u09C7\u099B\u09C7: \`${sandboxRun.runtimeError}\`\u0964`,
      solutionBn: undefMatch ? `\`${undefMatch[1]}\` \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0\u09C7\u09B0 \u0986\u0997\u09C7 \u098F\u099F\u09BF \u09A1\u09BF\u0995\u09CD\u09B2\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09C1\u09A8 \u0985\u09A5\u09AC\u09BE \u09A8\u09BE\u09AE\u09C7\u09B0 \u09AC\u09BE\u09A8\u09BE\u09A8 \u09A0\u09BF\u0995 \u0995\u09B0\u09C1\u09A8\u0964` : `\u09B2\u09BE\u0987\u09A8 ${errLine} (\`${lineCode}\`) \u09B8\u0982\u09B6\u09CB\u09A7\u09A8 \u0995\u09B0\u09C7 \u0986\u09AC\u09BE\u09B0 \u09B0\u09BE\u09A8 \u0995\u09B0\u09C1\u09A8\u0964`,
      messageEn: sandboxRun.runtimeError,
      explainLanguage
    });
    return {
      hasError: true,
      isValidLogic: false,
      errorDetails: errDetails,
      language,
      analogyType: "generic_memory",
      traceSource,
      logicSummary: {
        title: explainLanguage === "bn" ? `\u0995\u09AE\u09CD\u09AA\u09BE\u0987\u09B2 \u09AC\u09BE \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u09A4\u09CD\u09B0\u09C1\u099F\u09BF (${errDetails.errorType ?? "ERROR"})` : "Compilation / Runtime Error",
        goal: errDetails.messageBn ?? errDetails.message,
        idea: errDetails.solutionBn ?? "",
        keyPoints: [errDetails.messageBn ?? errDetails.message, errDetails.solutionBn ?? ""],
        analogyStory: errDetails.messageBn ?? errDetails.message,
        complexity: { time: "N/A", space: "N/A", note: errDetails.solutionBn ?? "" },
        commonMistakes: [errDetails.messageBn ?? errDetails.message]
      },
      lineNotes: [
        {
          line: errLine,
          role: "call",
          text: errDetails.message,
          why: errDetails.solutionBn ?? ""
        }
      ],
      steps: [],
      finalOutput: "",
      outputExplanation: errDetails.message,
      verdict: {
        status: "compile_error",
        message: errDetails.message
      },
      programSummary: null
    };
  }
  const cleanLines = sandboxRun.cleanLines;
  if (sandboxRun.recordedSteps.length > 0) {
    const recorded = sandboxRun.recordedSteps;
    const lastVars = recorded[recorded.length - 1].variables || {};
    const hasArray = Object.values(lastVars).some((v) => Array.isArray(v));
    const hasLoopInCode = recorded.some((r) => r.actionType === "LOOP_CHECK");
    const varKeys = Object.keys(lastVars);
    const hasSwapPattern = /\btemp\b/i.test(code) || /\bswap\s*\(/i.test(code) || /^\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*=\s*\2\s*,\s*\1\b/m.test(code) || /\^\s*=/.test(code);
    const hasSortPattern = hasArray && hasLoopInCode && (/bubble|sort|swap/i.test(code) || /\[j\s*\+\s*1\]|\[j\s*-\s*1\]|minIdx|pivot/i.test(code));
    const isSimpleSwap = !hasArray && !hasLoopInCode && varKeys.length >= 2 && varKeys.length <= 4 && hasSwapPattern;
    const detectedAnalogy = isSimpleSwap ? "swap_buckets" : hasSortPattern ? "sort_blocks" : hasArray ? "pointer_arrows" : hasLoopInCode ? "loop_gauge" : "generic_memory";
    const steps = [];
    let prevVars = {};
    let stdinBufferCounter = 0;
    recorded.slice(0, 100).forEach((rec, idx) => {
      const snippet = rec.codeSnippet || cleanLines[rec.line - 1] || "";
      const pedagogy = buildStepPedagogy(rec, prevVars);
      const changes = [];
      if (rec.memoryDelta && rec.memoryDelta.variable) {
        changes.push({
          name: rec.memoryDelta.variable,
          from: rec.memoryDelta.oldValue === null || rec.memoryDelta.oldValue === void 0 ? null : typeof rec.memoryDelta.oldValue === "object" ? JSON.stringify(rec.memoryDelta.oldValue) : rec.memoryDelta.oldValue,
          to: rec.memoryDelta.newValue === null || rec.memoryDelta.newValue === void 0 ? null : typeof rec.memoryDelta.newValue === "object" ? JSON.stringify(rec.memoryDelta.newValue) : rec.memoryDelta.newValue
        });
      }
      const explanationText = explainLanguage === "bn" ? pedagogy.whatHappenedBn : pedagogy.whatHappenedEn;
      const whyText = explainLanguage === "bn" ? pedagogy.logicBuildingBn : pedagogy.logicBuildingEn;
      const isCond = rec.actionType === "CONDITION_CHECK" && rec.meta?.conditionExpr;
      const isLoop = rec.actionType === "LOOP_CHECK" && rec.meta?.conditionExpr;
      const condExpr = rec.meta?.conditionExpr || "";
      const condResult = Boolean(rec.meta?.conditionResult);
      const comparison = isCond || isLoop ? parseComparisonVisual(condExpr, rec.variables, condResult) : null;
      const condKind = rec.meta?.subKind === "ELSE_BRANCH" ? "else" : rec.meta?.subKind === "SWITCH_ENTER" || rec.meta?.subKind === "CASE_MATCH" || rec.meta?.subKind === "DEFAULT_CASE" ? "switch" : isLoop ? "loop" : /^(?:\}?\s*)?(?:else\s+if|elif)\b/.test(snippet) ? "else_if" : "if";
      const conditionEval = isCond || isLoop ? {
        expression: substituteExpressionValues(condExpr, rec.variables),
        result: condResult,
        branchTaken: rec.meta?.subKind === "ELSE_BRANCH" ? "else" : condResult ? "true" : "false",
        kind: condKind
      } : null;
      const loopInfo = isLoop ? {
        iteration: rec.meta?.iteration || 1,
        conditionText: condExpr,
        continuing: condResult
      } : null;
      const stdinConsumed = rec.meta?.stdinRead !== void 0 ? {
        token: String(rec.meta.stdinRead),
        targetVar: rec.memoryDelta?.variable || rec.meta?.targetVar || null,
        bufferIndex: stdinBufferCounter++
      } : null;
      const targetVarName = rec.memoryDelta?.variable || rec.meta?.targetVar || null;
      const rhsExprText = rec.meta?.rhsExpr || "";
      const rhsVarMatch = rhsExprText.match(/^([A-Za-z_$][\w$]*)$/);
      const fromTransferVar = rhsVarMatch && rhsVarMatch[1] in rec.variables ? rhsVarMatch[1] : pedagogy.uiAction === "transfer" && rhsExprText ? rhsExprText : null;
      const visualCue = {
        mode: isCond || comparison ? "compare" : isLoop ? "loop" : rec.actionType === "OUTPUT" ? "output" : pedagogy.uiAction === "return" ? "return" : pedagogy.uiAction === "call" ? "call" : rec.memoryDelta?.variable ? "mutate" : "memory",
        highlightVars: targetVarName ? [targetVarName] : comparison && comparison.leftLabel in rec.variables ? [comparison.leftLabel] : [],
        compareVars: comparison && comparison.leftLabel in rec.variables && comparison.rightLabel in rec.variables ? [comparison.leftLabel, comparison.rightLabel] : null,
        comparison
      };
      steps.push({
        stepIndex: idx + 1,
        activeLine: rec.line,
        analogyType: detectedAnalogy,
        action: pedagogy.uiAction,
        from: fromTransferVar,
        to: targetVarName,
        explanation: explanationText,
        why: whyText,
        whatHappened: explanationText,
        whyAndLogic: whyText,
        stdout: rec.consoleOutput ?? (rec.stdoutSoFar || null),
        changes,
        variables: { ...rec.variables },
        fault: sandboxRun.timedOut && idx === recorded.length - 1 ? {
          type: "infinite_loop",
          message: explainLanguage === "bn" ? "\u09B2\u09C1\u09AA\u09C7\u09B0 \u09B6\u09B0\u09CD\u09A4 \u0995\u0996\u09A8\u09CB\u0987 \u09AE\u09BF\u09A5\u09CD\u09AF\u09BE (false) \u09A8\u09BE \u09B9\u0993\u09DF\u09BE\u09DF \u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA (Infinite Loop) \u09A4\u09C8\u09B0\u09BF \u09B9\u09DF\u09C7\u099B\u09C7\u0964" : "Infinite loop detected because the termination condition was never reached.",
          fixHint: explainLanguage === "bn" ? "\u09B2\u09C1\u09AA\u09C7\u09B0 \u09AD\u09C7\u09A4\u09B0\u09C7 \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09AC\u09BE \u09B6\u09B0\u09CD\u09A4\u09C7\u09B0 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 \u0986\u09AA\u09A1\u09C7\u099F \u0995\u09B0\u09C1\u09A8\u0964" : "Ensure the loop variable moves toward the termination condition in each iteration."
        } : null,
        structure: buildStructureFromVariables(detectedAnalogy, rec.variables, snippet),
        step: idx + 1,
        lineNumber: rec.line,
        codeSnippet: snippet,
        actionType: rec.actionType,
        memoryState: { ...rec.variables },
        memoryDelta: rec.memoryDelta || {
          variable: null,
          oldValue: null,
          newValue: null
        },
        consoleOutput: rec.consoleOutput,
        cumulativeOutput: rec.stdoutSoFar || null,
        whatHappenedBn: pedagogy.whatHappenedBn,
        logicBuildingBn: pedagogy.logicBuildingBn,
        visualCue,
        conditionEval,
        loopInfo,
        stdinConsumed
      });
      prevVars = { ...rec.variables };
    });
    const executedLines = new Set(steps.map((s) => s.activeLine));
    const blockExec = analyzeBlockExecution(code, language, executedLines);
    const lineNotes = [];
    cleanLines.forEach((trimmed, idx) => {
      if (!trimmed) return;
      const lineNum = idx + 1;
      const role = inferLineRole(trimmed);
      const matchingSteps = steps.filter((s) => s.activeLine === lineNum);
      const firstMatch = matchingSteps[0];
      const lastMatch = matchingSteps[matchingSteps.length - 1];
      const braceInfo = blockExec.braceByCloseLine.get(lineNum);
      const pythonEndInfo = blockExec.pythonEndsByLine.get(lineNum);
      const isClosingBrace = trimmed === "}" || trimmed === "};";
      const awareFallback = !firstMatch || isClosingBrace ? buildExecutionAwareLineNote({
        lineNumber: lineNum,
        trimmed,
        language,
        explainLanguage,
        executedLines,
        braceInfo,
        pythonEndInfo
      }) : null;
      let noteText = awareFallback?.text || firstMatch?.explanation || "";
      if (!isClosingBrace && matchingSteps.length > 1 && lastMatch) {
        noteText = explainLanguage === "bn" ? `${firstMatch.explanation} (\u098F\u0987 \u09B2\u09BE\u0987\u09A8\u099F\u09BF \u09AE\u09CB\u099F ${matchingSteps.length} \u09AC\u09BE\u09B0 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u09B9\u09AF\u09BC\u09C7\u099B\u09C7; \u09B8\u09B0\u09CD\u09AC\u09B6\u09C7\u09B7 \u09A7\u09BE\u09AA\u09C7: ${lastMatch.explanation})` : `${firstMatch.explanation} (Executed ${matchingSteps.length} times; final pass: ${lastMatch.explanation})`;
      }
      if (language === "python" && firstMatch && pythonEndInfo && pythonEndInfo.wasBlockExecuted) {
        noteText = explainLanguage === "bn" ? `${noteText} (\u098F\u0987 \u09B2\u09BE\u0987\u09A8\u09C7\u09B0 \u09AA\u09B0 \`${pythonEndInfo.kind}\` \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u0987\u09A8\u09CD\u09A1\u09C7\u09A8\u09CD\u099F\u09C7\u09B6\u09A8 \u09B6\u09C7\u09B7 \u09B9\u09DF\u09C7 \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u09B8\u09CD\u09A4\u09B0\u09C7 \u09AB\u09BF\u09B0\u09C7 \u0986\u09B8\u09C7)` : `${noteText} (Ends the Python \`${pythonEndInfo.kind}\` block afterward, returning control outward)`;
      }
      lineNotes.push({
        line: lineNum,
        role,
        text: noteText,
        why: awareFallback?.why || firstMatch?.why
      });
    });
    const finalOut = sandboxRun.stdout.trim() || Object.entries(lastVars).map(([k, v]) => `${k} = ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ");
    const complexityResult = analyzeCodeComplexity(code, language, steps);
    const timeComp = complexityResult.time;
    const spaceComp = complexityResult.space;
    const dynamicPitfalls = generateLanguagePitfalls(code, language, explainLanguage);
    return {
      hasError: false,
      isValidLogic: !sandboxRun.timedOut && !sandboxRun.runtimeError,
      errorDetails: null,
      language,
      analogyType: detectedAnalogy,
      traceSource,
      logicSummary: {
        title: explainLanguage === "bn" ? "\u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u0995\u09CB\u09A1 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u09B6\u09A8 \u0993 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF \u09B8\u09CD\u099F\u09C7\u099F \u09AC\u09BF\u09B6\u09CD\u09B2\u09C7\u09B7\u09A3" : "Runtime Code Execution & Memory State Analysis",
        goal: explainLanguage === "bn" ? `\u0986\u09AA\u09A8\u09BE\u09B0 \u0995\u09CB\u09A1\u099F\u09BF \u09AA\u09CD\u09B0\u0995\u09C3\u09A4 \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE\u09C7 \u09AE\u09CB\u099F ${steps.length}\u099F\u09BF \u09A7\u09BE\u09AA\u09C7 \u098F\u0995\u09CD\u09B8\u09BF\u0995\u09BF\u0989\u099F \u09B9\u09DF\u09C7 \u099A\u09C2\u09DC\u09BE\u09A8\u09CD\u09A4 \u0986\u0989\u099F\u09AA\u09C1\u099F \`${finalOut || "\u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8"}\` \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09C7\u099B\u09C7\u0964` : `Executed your code deterministically across ${steps.length} runtime steps to produce \`${finalOut || "completed state"}\`.`,
        idea: explainLanguage === "bn" ? `\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u099F\u09BF \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09A4\u09C7 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2 (${Object.keys(lastVars).join(", ") || "state"}) \u09AC\u09CD\u09AF\u09AC\u09B9\u09BE\u09B0 \u0995\u09B0\u09C7 \u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u09B2\u09C1\u09AA, \u09B6\u09B0\u09CD\u09A4 \u098F\u09AC\u0982 \u098F\u0995\u09CD\u09B8\u09C7\u09AA\u09B6\u09A8 \u09AA\u09CD\u09B0\u09AC\u09BE\u09B9 \u09AF\u09BE\u099A\u09BE\u0987 \u0995\u09B0\u09C7 \u099A\u09C2\u09A1\u09BC\u09BE\u09A8\u09CD\u09A4 \u09B8\u09BF\u09A6\u09CD\u09A7\u09BE\u09A8\u09CD\u09A4\u09C7 \u09AA\u09CC\u0981\u099B\u09C7\u099B\u09C7\u0964` : `The program evaluates (${Object.keys(lastVars).join(", ") || "state"}) across each iteration and branch condition to compute the final result.`,
        keyPoints: [
          explainLanguage === "bn" ? `\u09AE\u09CB\u099F \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09A7\u09BE\u09AA (Total Steps): ${steps.length}\u099F\u09BF` : `Total execution steps: ${steps.length}`,
          explainLanguage === "bn" ? `\u09AE\u09C7\u09AE\u09CB\u09B0\u09BF\u09B0 \u099A\u09C2\u09A1\u09BC\u09BE\u09A8\u09CD\u09A4 \u0985\u09AC\u09B8\u09CD\u09A5\u09BE: ${Object.entries(lastVars).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}` : `Final memory state: ${Object.entries(lastVars).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}`,
          explainLanguage === "bn" ? `\u099A\u09C2\u09A1\u09BC\u09BE\u09A8\u09CD\u09A4 \u0995\u09A8\u09B8\u09CB\u09B2 \u0986\u0989\u099F\u09AA\u09C1\u099F: \`${finalOut || "N/A"}\`` : `Final console output: \`${finalOut || "N/A"}\``
        ],
        analogyStory: explainLanguage === "bn" ? "\u09AA\u09CD\u09B0\u09A4\u09BF\u099F\u09BF \u09A7\u09BE\u09AA\u09C7 \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u0995\u09BE\u0989\u09A8\u09CD\u099F\u09BE\u09B0 \u09AF\u09C7 \u09B2\u09BE\u0987\u09A8\u09C7 \u09AF\u09BE\u09AF\u09BC, \u09B8\u09C7\u0987 \u09B2\u09BE\u0987\u09A8\u09C7\u09B0 \u0997\u09BE\u09A3\u09BF\u09A4\u09BF\u0995 \u09B9\u09BF\u09B8\u09BE\u09AC \u09B6\u09C7\u09B7\u09C7 \u09AD\u09CD\u09AF\u09BE\u09B0\u09BF\u09AF\u09BC\u09C7\u09AC\u09B2\u09C7\u09B0 \u0986\u0997\u09C7\u09B0 \u09AE\u09BE\u09A8 \u0993 \u09A8\u09A4\u09C1\u09A8 \u09AE\u09BE\u09A8 \u09AE\u09C7\u09AE\u09CB\u09B0\u09BF \u0995\u09A8\u09CD\u099F\u09C7\u0987\u09A8\u09BE\u09B0\u09C7 \u09B8\u09B0\u09BE\u09B8\u09B0\u09BF \u0986\u09AA\u09A1\u09C7\u099F \u09B9\u09AF\u09BC\u0964" : "At each step, the active program counter evaluates expressions mathematically and updates the 3D memory containers.",
        complexity: {
          time: timeComp,
          space: spaceComp,
          note: explainLanguage === "bn" ? complexityResult.noteBn : complexityResult.noteEn
        },
        commonMistakes: dynamicPitfalls
      },
      lineNotes,
      steps,
      finalOutput: finalOut,
      outputExplanation: explainLanguage === "bn" ? `\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u099F\u09BF \u09AE\u09CB\u099F ${steps.length}\u099F\u09BF \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u09A7\u09BE\u09AA \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u0995\u09B0\u09C7 \u099A\u09C2\u09DC\u09BE\u09A8\u09CD\u09A4 \u0986\u0989\u099F\u09AA\u09C1\u099F \`${finalOut}\` \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09C7\u099B\u09C7\u0964` : `Program completed ${steps.length} runtime steps and produced final output \`${finalOut}\`.`,
      verdict: {
        status: sandboxRun.timedOut ? "infinite_loop" : "ok",
        message: sandboxRun.timedOut ? explainLanguage === "bn" ? "\u0985\u09B8\u09C0\u09AE \u09B2\u09C1\u09AA (Infinite Loop) \u09B6\u09A8\u09BE\u0995\u09CD\u09A4 \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" : "Infinite loop detected." : explainLanguage === "bn" ? "\u0995\u09CB\u09A1\u099F\u09BF \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09B0\u09BE\u09A8 \u0993 \u09AD\u09BF\u099C\u09CD\u09AF\u09C1\u09AF\u09BC\u09BE\u09B2\u09BE\u0987\u099C \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" : "Code executed and visualized accurately."
      },
      programSummary: {
        totalExecutionSteps: steps.length,
        timeComplexity: timeComp,
        spaceComplexity: spaceComp,
        finalOutput: finalOut
      }
    };
  }
  const emptyComplexity = analyzeCodeComplexity(code, language, []);
  const emptyPitfalls = generateLanguagePitfalls(code, language, explainLanguage);
  return {
    hasError: false,
    isValidLogic: true,
    errorDetails: null,
    language,
    analogyType: "generic_memory",
    traceSource,
    logicSummary: {
      title: explainLanguage === "bn" ? "\u0995\u09CB\u09A1 \u09AC\u09BF\u09B6\u09CD\u09B2\u09C7\u09B7\u09A3" : "Code Analysis",
      goal: explainLanguage === "bn" ? "\u0995\u09CB\u09A1\u099F\u09BF \u09B0\u09BE\u09A8 \u0995\u09B0\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964" : "Executed program.",
      idea: "",
      keyPoints: [],
      analogyStory: "",
      complexity: {
        time: emptyComplexity.time,
        space: emptyComplexity.space,
        note: explainLanguage === "bn" ? emptyComplexity.noteBn : emptyComplexity.noteEn
      },
      commonMistakes: emptyPitfalls
    },
    lineNotes: [],
    steps: [],
    finalOutput: sandboxRun.stdout.trim(),
    outputExplanation: "",
    verdict: {
      status: "ok",
      message: explainLanguage === "bn" ? "\u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8\u0964" : "Completed."
    },
    programSummary: {
      totalExecutionSteps: 0,
      timeComplexity: emptyComplexity.time,
      spaceComplexity: emptyComplexity.space,
      finalOutput: sandboxRun.stdout.trim()
    }
  };
}

// server/src/services/toolchains/javaToolchain.ts
import fs2 from "node:fs/promises";
import path2 from "node:path";

// server/src/services/toolchains/sandbox.ts
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
var executableCache = /* @__PURE__ */ new Map();
function isExecutableFile(filePath) {
  try {
    const stat = fsSync.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === "win32" && stat.size === 0) return false;
    return true;
  } catch {
    return false;
  }
}
function findInDir(dir, names) {
  if (!dir) return null;
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const name of names) {
    for (const ext of exts) {
      const candidate = name.toLowerCase().endsWith(ext) ? path.join(dir, name) : path.join(dir, `${name}${ext}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
function listSubdirBins(parentDir, prefixPattern) {
  try {
    if (!fsSync.existsSync(parentDir)) return [];
    const entries = fsSync.readdirSync(parentDir, { withFileTypes: true }).filter((d) => d.isDirectory() && (!prefixPattern || prefixPattern.test(d.name))).map((d) => d.name).sort().reverse();
    const bins = [];
    for (const name of entries) {
      bins.push(path.join(parentDir, name, "bin"));
      if (process.platform === "darwin") {
        bins.push(path.join(parentDir, name, "Contents", "Home", "bin"));
      }
    }
    return bins;
  } catch {
    return [];
  }
}
function getStandardSearchDirs(tool) {
  const isWin = process.platform === "win32";
  const dirs = [];
  if (tool === "javac" || tool === "java") {
    if (process.env.JAVA_HOME?.trim()) {
      dirs.push(path.join(process.env.JAVA_HOME.trim(), "bin"));
    }
    if (isWin) {
      const pf = process.env.ProgramFiles || "C:\\Program Files";
      const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
      dirs.push(
        path.join(pf, "Common Files", "Oracle", "Java", "javapath"),
        path.join(pf86, "Common Files", "Oracle", "Java", "javapath"),
        ...listSubdirBins(path.join(pf, "Java")),
        ...listSubdirBins(path.join(pf, "Eclipse Adoptium")),
        ...listSubdirBins(path.join(pf, "Microsoft")),
        ...listSubdirBins(path.join(pf, "Amazon Corretto")),
        ...listSubdirBins(path.join(pf, "Zulu")),
        ...listSubdirBins(path.join(pf, "BellSoft"))
      );
    } else {
      dirs.push(
        "/usr/bin",
        "/usr/local/bin",
        ...listSubdirBins("/usr/lib/jvm"),
        ...listSubdirBins("/Library/Java/JavaVirtualMachines"),
        ...listSubdirBins("/opt/homebrew/opt", /^openjdk/)
      );
    }
  } else if (tool === "g++") {
    if (isWin) {
      dirs.push(
        "C:\\MinGW\\bin",
        "C:\\msys64\\ucrt64\\bin",
        "C:\\msys64\\mingw64\\bin",
        "C:\\msys64\\mingw32\\bin",
        "C:\\TDM-GCC-64\\bin"
      );
    } else {
      dirs.push("/usr/bin", "/usr/local/bin", "/opt/homebrew/bin");
    }
  } else if (tool === "python") {
    if (isWin) {
      const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
      dirs.push(
        path.join(localApp, "Python", "bin"),
        ...listSubdirBins(path.join(localApp, "Programs", "Python")).map((b) => path.dirname(b))
      );
    } else {
      dirs.push("/usr/bin", "/usr/local/bin", "/opt/homebrew/bin");
    }
  } else if (tool === "node") {
    if (isWin) {
      dirs.push(path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"));
    } else {
      dirs.push("/usr/bin", "/usr/local/bin", "/opt/homebrew/bin");
    }
  }
  return dirs;
}
async function resolveExecutable(tool) {
  if (executableCache.has(tool)) {
    return executableCache.get(tool) ?? null;
  }
  const envOverrides = {
    javac: [
      process.env.JAVAC_PATH,
      process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "javac.exe" : "javac") : void 0
    ],
    java: [
      process.env.JAVA_PATH,
      process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java") : void 0
    ],
    "g++": [process.env.GPP_PATH, process.env.CXX],
    python: [process.env.PYTHON_PATH],
    node: [
      process.env.LOGICLAB_NODE_PATH,
      path.basename(process.execPath).toLowerCase().startsWith("node") ? process.execPath : void 0
    ]
  };
  for (const override of envOverrides[tool]) {
    const trimmed = override?.trim();
    if (trimmed && isExecutableFile(trimmed)) {
      executableCache.set(tool, trimmed);
      return trimmed;
    }
  }
  const rawPath = process.env.PATH || process.env.Path || "";
  const pathDirs = rawPath.split(path.delimiter).filter(Boolean);
  const candidateNames = tool === "python" ? process.platform === "win32" ? ["python", "python3"] : ["python3", "python"] : [tool];
  for (const dir of pathDirs) {
    const found = findInDir(dir, candidateNames);
    if (found) {
      executableCache.set(tool, found);
      return found;
    }
  }
  for (const dir of getStandardSearchDirs(tool)) {
    const found = findInDir(dir, candidateNames);
    if (found) {
      executableCache.set(tool, found);
      return found;
    }
  }
  executableCache.set(tool, null);
  return null;
}
async function getToolchainAvailability() {
  const [javac, java, gpp, python, node] = await Promise.all([
    resolveExecutable("javac"),
    resolveExecutable("java"),
    resolveExecutable("g++"),
    resolveExecutable("python"),
    resolveExecutable("node")
  ]);
  return { javac, java, "g++": gpp, python, node };
}
var WINDOWS_RESERVED_BASENAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function validateSourceFileName(fileName, allowedExts) {
  if (!fileName || !fileName.trim()) {
    return { valid: false, error: "Filename cannot be empty." };
  }
  if (/[\x00-\x1f\x7f]/.test(fileName)) {
    return { valid: false, error: "Filename contains invalid control characters." };
  }
  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    return {
      valid: false,
      error: `Invalid filename "${fileName}": path separators and directory traversal ("..") are not allowed.`
    };
  }
  if (/[<>:"|?*]/.test(fileName)) {
    return {
      valid: false,
      error: `Invalid filename "${fileName}": contains forbidden filesystem characters (< > : " | ? *).`
    };
  }
  const trimmed = fileName.trim();
  if (trimmed.length > 128) {
    return { valid: false, error: "Filename exceeds maximum allowed length (128 characters)." };
  }
  const candidate = !trimmed.includes(".") && allowedExts.length > 0 ? `${trimmed}${allowedExts[0]}` : trimmed;
  const lower = candidate.toLowerCase();
  const matchedExt = allowedExts.find((ext) => lower.endsWith(ext.toLowerCase()));
  if (!matchedExt) {
    return {
      valid: false,
      error: `Filename "${trimmed}" does not match expected extension (${allowedExts.join(", ")}).`
    };
  }
  const stem = candidate.slice(0, candidate.length - matchedExt.length).trim();
  if (!stem || stem === "." || stem.startsWith(".")) {
    return {
      valid: false,
      error: `Filename "${trimmed}" must have a valid name before the extension.`
    };
  }
  const sanitized = WINDOWS_RESERVED_BASENAMES.test(stem) ? `_${stem}${matchedExt}` : candidate;
  return { valid: true, sanitized };
}
function sanitizeSourceFileName(fileName, defaultName, allowedExts) {
  if (!fileName || typeof fileName !== "string") return defaultName;
  const normalized = fileName.replace(/\\/g, "/").split("/").pop() || "";
  const cleaned = normalized.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, "").replace(/\.{2,}/g, ".").trim().replace(/^\.+|\.+$/g, "").trim();
  if (!cleaned || cleaned.length > 128) return defaultName;
  const withExt = !cleaned.includes(".") && allowedExts.length > 0 ? `${cleaned}${allowedExts[0]}` : cleaned;
  const lower = withExt.toLowerCase();
  const matchedExt = allowedExts.find((ext) => lower.endsWith(ext.toLowerCase()));
  if (!matchedExt) return defaultName;
  const stem = withExt.slice(0, withExt.length - matchedExt.length).trim();
  if (!stem || stem === ".") return defaultName;
  if (WINDOWS_RESERVED_BASENAMES.test(stem)) {
    return `_${stem}${matchedExt}`;
  }
  return withExt;
}
var SANDBOX_BASE_DIR = path.resolve(path.join(os.tmpdir(), "logic-lab-sandbox"));
async function createSandboxWorkspace() {
  const dirName = `run-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const fullPath = path.join(SANDBOX_BASE_DIR, dirName);
  await fs.mkdir(fullPath, { recursive: true });
  return fullPath;
}
async function cleanupSandboxWorkspace(dirPath) {
  try {
    if (!dirPath) return;
    const resolvedTarget = path.resolve(dirPath);
    if (resolvedTarget !== SANDBOX_BASE_DIR && resolvedTarget.startsWith(`${SANDBOX_BASE_DIR}${path.sep}`)) {
      await fs.rm(resolvedTarget, { recursive: true, force: true });
    }
  } catch {
  }
}
function sanitizeWorkspacePaths(text, workspaceDir) {
  if (!text) return text;
  let result = text;
  if (workspaceDir) {
    const variants = Array.from(
      /* @__PURE__ */ new Set([
        workspaceDir,
        path.resolve(workspaceDir),
        workspaceDir.replace(/\\/g, "/"),
        workspaceDir.replace(/\//g, "\\")
      ])
    );
    for (const variant of variants) {
      if (!variant) continue;
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`${escaped}[\\\\/]?`, "gi"), "");
    }
  }
  const baseEscaped = SANDBOX_BASE_DIR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  result = result.replace(
    new RegExp(`${baseEscaped}(?:[\\\\/](?:run|exec)-[a-zA-Z0-9-]+)?[\\\\/]?`, "gi"),
    ""
  );
  return result;
}
function getSanitizedEnv() {
  const cleanEnv = {
    PATH: process.env.PATH || process.env.Path || "",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    LANG: process.env.LANG || "C.UTF-8"
  };
  if (process.platform === "win32") {
    const homeDir = os.homedir();
    cleanEnv.SYSTEMROOT = process.env.SYSTEMROOT || "C:\\Windows";
    cleanEnv.WINDIR = process.env.WINDIR || "C:\\Windows";
    cleanEnv.COMSPEC = process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
    cleanEnv.PATHEXT = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
    cleanEnv.TEMP = process.env.TEMP || os.tmpdir();
    cleanEnv.TMP = process.env.TMP || os.tmpdir();
    cleanEnv.USERPROFILE = process.env.USERPROFILE || homeDir;
    cleanEnv.LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    cleanEnv.APPDATA = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    if (process.env.HOMEDRIVE) cleanEnv.HOMEDRIVE = process.env.HOMEDRIVE;
    if (process.env.HOMEPATH) cleanEnv.HOMEPATH = process.env.HOMEPATH;
  } else {
    cleanEnv.HOME = os.tmpdir();
    cleanEnv.TMPDIR = os.tmpdir();
  }
  if (process.env.JAVA_HOME) {
    cleanEnv.JAVA_HOME = process.env.JAVA_HOME;
  }
  return cleanEnv;
}
function killProcessTree(childProcess) {
  if (!childProcess || !childProcess.pid) return;
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/pid", String(childProcess.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
      killer.on("error", () => {
        try {
          childProcess.kill("SIGKILL");
        } catch {
        }
      });
    } catch {
      try {
        childProcess.kill("SIGKILL");
      } catch {
      }
    }
  } else {
    try {
      process.kill(-childProcess.pid, "SIGKILL");
    } catch {
      try {
        childProcess.kill("SIGKILL");
      } catch {
      }
    }
  }
}
var MAX_CONCURRENT_SANDBOX_PROCESSES = 4;
var activeSandboxProcesses = 0;
var processWaitQueue = [];
async function acquireProcessSlot() {
  if (activeSandboxProcesses < MAX_CONCURRENT_SANDBOX_PROCESSES) {
    activeSandboxProcesses += 1;
    return;
  }
  await new Promise((resolve) => processWaitQueue.push(resolve));
  activeSandboxProcesses += 1;
}
function releaseProcessSlot() {
  activeSandboxProcesses = Math.max(0, activeSandboxProcesses - 1);
  const next = processWaitQueue.shift();
  if (next) next();
}
async function runSandboxedProcess(options) {
  const {
    cmd,
    args,
    cwd,
    stdin = "",
    timeoutMs = 4e3,
    env = {},
    maxBufferBytes = 128 * 1024
  } = options;
  await acquireProcessSlot();
  const startTime = Date.now();
  let timedOut = false;
  let stdoutData = "";
  let stderrData = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let spawnErrorCode;
  let childProcess = null;
  try {
    return await new Promise((resolve) => {
      try {
        const mergedEnv = {
          ...getSanitizedEnv(),
          ...env
        };
        childProcess = spawn(cmd, args, {
          cwd,
          env: mergedEnv,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["pipe", "pipe", "pipe"]
        });
        let finished = false;
        const stdoutDecoder = new StringDecoder("utf8");
        const stderrDecoder = new StringDecoder("utf8");
        const finish = (exitCode) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          const tailOut = stdoutDecoder.end();
          const tailErr = stderrDecoder.end();
          if (tailOut && !stdoutTruncated) stdoutData += tailOut;
          if (tailErr && !stderrTruncated) stderrData += tailErr;
          if (stdoutTruncated) {
            stdoutData += "\n...[output truncated: exceeded max buffer]";
          }
          if (stderrTruncated) {
            stderrData += "\n...[stderr truncated: exceeded max buffer]";
          }
          resolve({
            stdout: stdoutData,
            stderr: sanitizeWorkspacePaths(stderrData, cwd),
            exitCode,
            timedOut,
            executionTimeMs: Date.now() - startTime,
            ...spawnErrorCode ? { spawnErrorCode } : {}
          });
        };
        const timer = setTimeout(() => {
          timedOut = true;
          killProcessTree(childProcess);
          finish(null);
        }, timeoutMs);
        childProcess.stdout.on("data", (chunk) => {
          if (stdoutTruncated) return;
          if (stdoutBytes + chunk.length <= maxBufferBytes) {
            stdoutBytes += chunk.length;
            stdoutData += stdoutDecoder.write(chunk);
          } else {
            const remaining = Math.max(0, maxBufferBytes - stdoutBytes);
            if (remaining > 0) {
              stdoutData += stdoutDecoder.write(chunk.subarray(0, remaining));
            }
            stdoutBytes = maxBufferBytes;
            stdoutTruncated = true;
          }
        });
        childProcess.stderr.on("data", (chunk) => {
          if (stderrTruncated) return;
          if (stderrBytes + chunk.length <= maxBufferBytes) {
            stderrBytes += chunk.length;
            stderrData += stderrDecoder.write(chunk);
          } else {
            const remaining = Math.max(0, maxBufferBytes - stderrBytes);
            if (remaining > 0) {
              stderrData += stderrDecoder.write(chunk.subarray(0, remaining));
            }
            stderrBytes = maxBufferBytes;
            stderrTruncated = true;
          }
        });
        childProcess.stdin.on("error", () => {
        });
        childProcess.on("error", (err) => {
          spawnErrorCode = err.code;
          stderrData += `
Failed to start process: ${err.message}`;
          finish(-1);
        });
        childProcess.on("close", (code) => {
          finish(code);
        });
        if (stdin) {
          const normalizedStdin = stdin.replace(/\r\n/g, "\n");
          childProcess.stdin.write(
            normalizedStdin.endsWith("\n") ? normalizedStdin : `${normalizedStdin}
`,
            "utf8"
          );
        }
        childProcess.stdin.end();
      } catch (err) {
        resolve({
          stdout: "",
          stderr: err?.message || "Process invocation error",
          exitCode: -1,
          timedOut: false,
          executionTimeMs: Date.now() - startTime
        });
      }
    });
  } finally {
    releaseProcessSlot();
  }
}

// server/src/services/toolchains/remoteSandbox.ts
var DEFAULT_JUDGE0_URL = "https://ce.judge0.com";
var JUDGE0_LANGUAGE_IDS = {
  cpp: 105,
  // C++ (GCC 14.1.0)
  java: 91,
  // Java (JDK 17.0.6)
  python: 100,
  // Python (3.12.5)
  javascript: 102
  // JavaScript (Node.js 22.08.0)
};
var PISTON_LANGUAGES = {
  cpp: { language: "c++", fileName: "main.cpp" },
  java: { language: "java", fileName: "Main.java" },
  python: { language: "python", fileName: "main.py" },
  javascript: { language: "javascript", fileName: "main.js" }
};
function normalizeStdin(stdin) {
  if (!stdin) return "";
  const normalized = stdin.replace(/\r\n/g, "\n");
  return normalized.endsWith("\n") ? normalized : `${normalized}
`;
}
function isLocalExecutionBlockedError(stderr) {
  const lower = (stderr || "").toLowerCase();
  return lower.includes("spawn unknown") || lower.includes("spawn eacces") || lower.includes("spawn eperm") || lower.includes("spawn enoent") || lower.includes("device guard") || lower.includes("blocked by your organization");
}
async function runPiston(baseUrl, language, code, stdin, timeoutMs, fileName) {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/execute`;
  const cfg = PISTON_LANGUAGES[language];
  const resolvedFileName = fileName && fileName.trim() ? fileName.trim() : cfg.fileName;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs + 6e3, 1e4));
  const startedAt = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        language: cfg.language,
        version: "*",
        files: [{ name: resolvedFileName, content: code }],
        stdin: normalizeStdin(stdin),
        run_timeout: timeoutMs
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const elapsed = Date.now() - startedAt;
    if (data.compile && data.compile.code && data.compile.code !== 0) {
      const compileStderr = data.compile.stderr || data.compile.stdout || "Compilation failed.";
      return {
        ok: true,
        provider: "piston",
        stdout: "",
        stderr: compileStderr,
        compileOutput: compileStderr,
        compileFailed: true,
        exitCode: data.compile.code ?? 1,
        timedOut: false,
        runtimeError: compileStderr,
        executionTimeMs: elapsed
      };
    }
    const run = data.run ?? {};
    const timedOut = run.signal === "SIGKILL" && elapsed >= timeoutMs;
    const exitCode = typeof run.code === "number" ? run.code : run.signal ? 1 : 0;
    const stderr = run.stderr ?? "";
    const runtimeError = timedOut ? `Execution timed out (${timeoutMs}ms). Possible infinite loop.` : exitCode !== 0 ? stderr.trim() || `Process exited with error code ${exitCode}.` : null;
    return {
      ok: true,
      provider: "piston",
      stdout: run.stdout ?? "",
      stderr,
      compileOutput: "",
      exitCode,
      timedOut,
      runtimeError,
      executionTimeMs: elapsed
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function adaptJavaCodeForJudge0(code, fileName) {
  const strippedPkg = code.replace(/^\s*package\s+[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*;/m, "");
  const pubMatch = strippedPkg.match(/\bpublic\s+((?:final\s+|abstract\s+)?class\s+)([A-Za-z_$][\w$]*)\b/);
  if (!pubMatch || !pubMatch[2] || pubMatch[2] === "Main") {
    return strippedPkg;
  }
  const className = pubMatch[2];
  const trimmedFile = (fileName || "").trim();
  const stem = trimmedFile.replace(/\.java$/i, "");
  const isDefaultOrMatching = !stem || /^main\d*$/i.test(stem) || stem === className;
  if (!isDefaultOrMatching) {
    return strippedPkg;
  }
  const demoted = strippedPkg.replace(
    /\bpublic\s+((?:final\s+|abstract\s+)?class\s+)([A-Za-z_$][\w$]*)\b/,
    "$1$2"
  );
  if (/\bclass\s+Main\b/.test(demoted)) {
    return demoted;
  }
  return `${demoted}
public class Main { public static void main(String[] args) throws Exception { ${className}.main(args); } }
`;
}
async function runJudge0(baseUrl, language, code, stdin, timeoutMs, fileName) {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/submissions?base64_encoded=false&wait=true`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs + 8e3, 12e3));
  const startedAt = Date.now();
  const cpuLimitSec = Math.max(1, Math.min(10, Math.ceil(timeoutMs / 1e3)));
  const sourceCode = language === "java" ? adaptJavaCodeForJudge0(code, fileName) : code;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        language_id: JUDGE0_LANGUAGE_IDS[language],
        source_code: sourceCode,
        stdin: normalizeStdin(stdin),
        cpu_time_limit: cpuLimitSec,
        wall_time_limit: cpuLimitSec + 2
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const elapsed = data.time && !Number.isNaN(Number(data.time)) ? Math.max(1, Math.round(Number(data.time) * 1e3)) : Date.now() - startedAt;
    const statusId = data.status?.id ?? 0;
    const timedOut = statusId === 5;
    const compileOutput = data.compile_output ?? "";
    const rawStderr = data.stderr ?? data.message ?? "";
    if (statusId === 6) {
      return {
        ok: true,
        provider: "judge0",
        stdout: "",
        stderr: compileOutput || rawStderr || "Compilation error.",
        compileOutput,
        compileFailed: true,
        exitCode: 1,
        timedOut: false,
        runtimeError: compileOutput || rawStderr || "Compilation error.",
        executionTimeMs: elapsed
      };
    }
    const isSuccess = statusId === 3;
    const exitCode = typeof data.exit_code === "number" ? data.exit_code : isSuccess ? 0 : 1;
    const combinedStderr = rawStderr || (isSuccess ? "" : data.status?.description || "");
    const runtimeError = timedOut ? `Execution timed out (${timeoutMs}ms). Possible infinite loop.` : !isSuccess ? combinedStderr.trim() || data.status?.description || "Runtime execution failed." : null;
    return {
      ok: true,
      provider: "judge0",
      stdout: data.stdout ?? "",
      stderr: combinedStderr,
      compileOutput,
      exitCode,
      timedOut,
      runtimeError,
      executionTimeMs: elapsed
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function buildRemoteToolchainResult(remote, diagnostics, runtimeErrorLine) {
  const isFailure = Boolean(remote.compileFailed || remote.timedOut || remote.exitCode !== 0 && remote.exitCode !== null);
  const status = isFailure ? "error" : diagnostics.some((d) => d.severity === "warning") ? "warning" : "success";
  const errorCategory = isFailure ? classifyErrorCategory(
    remote.stderr || remote.runtimeError || remote.compileOutput || "",
    Boolean(remote.compileFailed)
  ) : void 0;
  const output = remote.runtimeError ? remote.stdout ? `${remote.stdout}
${remote.runtimeError}` : remote.runtimeError : remote.stdout;
  return {
    status,
    canRun: status !== "error",
    stdout: remote.stdout,
    stderr: remote.stderr,
    output,
    exitCode: remote.exitCode,
    timedOut: remote.timedOut,
    runtimeError: remote.runtimeError,
    ...runtimeErrorLine !== void 0 ? { runtimeErrorLine } : {},
    ...errorCategory ? { errorCategory } : {},
    executionBackend: "remote",
    executionTimeMs: remote.executionTimeMs,
    diagnostics
  };
}
async function executeViaRemoteSandbox(language, code, stdin = "", timeoutMs = 4e3, fileName) {
  if (process.env.REMOTE_SANDBOX_FALLBACK === "false") {
    return null;
  }
  const pistonUrl = process.env.PISTON_API_URL?.trim();
  if (pistonUrl) {
    const pistonRes = await runPiston(pistonUrl, language, code, stdin, timeoutMs, fileName);
    if (pistonRes?.ok) return pistonRes;
  }
  const judge0Url = process.env.JUDGE0_API_URL?.trim() || DEFAULT_JUDGE0_URL;
  return await runJudge0(judge0Url, language, code, stdin, timeoutMs, fileName);
}

// server/src/services/toolchains/javaToolchain.ts
function stripJavaCommentsAndStrings(code) {
  return code.replace(
    /\/\*[\s\S]*?\*\/|\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gm,
    (m) => m.startsWith("/") ? m.replace(/[^\n]/g, " ") : '""'
  );
}
function extractJavaPackageName(code) {
  const clean = stripJavaCommentsAndStrings(code);
  const pkgMatch = clean.match(/\bpackage\s+([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*;/);
  if (pkgMatch && pkgMatch[1]) {
    return pkgMatch[1].replace(/\s+/g, "");
  }
  return null;
}
function extractJavaPublicClassName(code) {
  const clean = stripJavaCommentsAndStrings(code);
  const pubMatch = clean.match(/\bpublic\s+(?:final\s+|abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
  return pubMatch && pubMatch[1] ? pubMatch[1] : null;
}
function extractJavaClassName(code, fallbackFileName = "Main.java") {
  const clean = stripJavaCommentsAndStrings(code);
  const pubClass = extractJavaPublicClassName(code);
  if (pubClass) {
    return pubClass;
  }
  const classHeaderRegex = /\bclass\s+([A-Za-z_$][\w$]*)\b[^{]*\{/g;
  const classMatches = [...clean.matchAll(classHeaderRegex)];
  for (let i = 0; i < classMatches.length; i++) {
    const startIdx = classMatches[i].index ?? 0;
    const endIdx = i + 1 < classMatches.length ? classMatches[i + 1].index ?? clean.length : clean.length;
    const slice = clean.slice(startIdx, endIdx);
    if (/\bmain\s*\(/.test(slice)) {
      return classMatches[i][1];
    }
  }
  if (classMatches.length > 0 && classMatches[0][1]) {
    return classMatches[0][1];
  }
  const base = fallbackFileName.replace(/\.java$/i, "").trim();
  return base || "Main";
}
function parseJavacDiagnostics(stderr, stdout) {
  const combined = `${stderr}
${stdout}`;
  const lines = combined.split(/\r?\n/);
  const diagnostics = [];
  const diagRegex = /^(.+?\.java):(\d+):\s*(error|warning):\s*(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(diagRegex);
    if (match) {
      const lineNum = parseInt(match[2], 10) || 1;
      const severity = match[3] === "error" ? "error" : "warning";
      const message = match[4].trim();
      let column;
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const nextRaw = lines[j];
        const caretIdx = nextRaw.indexOf("^");
        if (caretIdx >= 0 && nextRaw.trim().startsWith("^")) {
          column = caretIdx + 1;
          break;
        }
      }
      diagnostics.push({
        line: lineNum,
        column,
        severity,
        message,
        source: "javac"
      });
    }
  }
  return diagnostics;
}
async function compileJava(code, fileName = "Main.java") {
  const workspaceDir = await createSandboxWorkspace();
  const publicClassName = extractJavaPublicClassName(code);
  const simpleClassName = extractJavaClassName(code, fileName);
  const pkgName = extractJavaPackageName(code);
  const fullyQualifiedMainClass = pkgName ? `${pkgName}.${simpleClassName}` : simpleClassName;
  const trimmedInputName = (fileName || "").trim();
  const isDefaultPlaceholderName = !trimmedInputName || /^main\d*(?:\.[a-z0-9]+)?$/i.test(trimmedInputName);
  const effectiveInputFileName = isDefaultPlaceholderName && publicClassName ? `${publicClassName}.java` : fileName;
  const sourceFileName = sanitizeSourceFileName(effectiveInputFileName, `${simpleClassName}.java`, [".java"]);
  const sourceFilePath = path2.join(workspaceDir, sourceFileName);
  await fs2.writeFile(sourceFilePath, code, "utf8");
  const javacPath = await resolveExecutable("javac");
  if (!javacPath) {
    const configMsg = "Java compiler (javac) not found. Ensure a JDK is installed and 'javac' is in PATH, or set JAVA_HOME / JAVAC_PATH.";
    return {
      success: false,
      diagnostics: [],
      stdout: "",
      stderr: configMsg,
      mainClass: fullyQualifiedMainClass,
      sourceFileName,
      workingDir: workspaceDir,
      workspaceDir,
      compilerUnavailable: true,
      compilerError: configMsg
    };
  }
  const procRes = await runSandboxedProcess({
    cmd: javacPath,
    args: ["-encoding", "UTF-8", "-Xlint:all", "-d", workspaceDir, sourceFileName],
    cwd: workspaceDir,
    timeoutMs: 15e3
  });
  if (procRes.spawnErrorCode === "ENOENT" || procRes.spawnErrorCode === "EACCES" || procRes.spawnErrorCode === "EPERM") {
    const configMsg = `Java compiler failed to start (${procRes.spawnErrorCode}): ${procRes.stderr.trim()}`;
    return {
      success: false,
      diagnostics: [],
      stdout: procRes.stdout,
      stderr: configMsg,
      mainClass: fullyQualifiedMainClass,
      sourceFileName,
      workingDir: workspaceDir,
      workspaceDir,
      compilerUnavailable: true,
      compilerError: configMsg
    };
  }
  const diagnostics = parseJavacDiagnostics(procRes.stderr, procRes.stdout);
  const hasErrors = procRes.exitCode !== 0 || diagnostics.some((d) => d.severity === "error");
  return {
    success: !hasErrors,
    diagnostics,
    stdout: procRes.stdout,
    stderr: procRes.stderr,
    mainClass: fullyQualifiedMainClass,
    sourceFileName,
    workingDir: workspaceDir,
    workspaceDir
  };
}
async function executeJava(code, stdin = "", timeoutMs = 4e3, fileName = "Main.java") {
  const compileRes = await compileJava(code, fileName);
  try {
    if (!compileRes.success) {
      if (compileRes.compilerUnavailable || isLocalExecutionBlockedError(compileRes.stderr)) {
        const remote = await executeViaRemoteSandbox(
          "java",
          code,
          stdin,
          timeoutMs,
          compileRes.sourceFileName
        );
        if (remote) {
          const remoteDiagnostics = remote.compileOutput ? parseJavacDiagnostics(remote.compileOutput, "") : [];
          const hasRemoteCompileErr = remote.exitCode !== 0 && Boolean(remote.compileOutput);
          return buildRemoteToolchainResult(
            remote,
            remoteDiagnostics,
            hasRemoteCompileErr ? remoteDiagnostics[0]?.line || 1 : void 0
          );
        }
      }
      if (compileRes.compilerUnavailable) {
        const configMsg = compileRes.compilerError || compileRes.stderr.trim() || "Java compiler (javac) is unavailable on this host.";
        return {
          status: "error",
          canRun: false,
          stdout: "",
          stderr: configMsg,
          output: configMsg,
          exitCode: 1,
          timedOut: false,
          runtimeError: configMsg,
          executionTimeMs: 0,
          diagnostics: []
        };
      }
      const firstError = compileRes.diagnostics.find((d) => d.severity === "error");
      const errorMsg = firstError?.message || compileRes.stderr.trim() || "Java compilation failed.";
      return {
        status: "error",
        canRun: false,
        stdout: "",
        stderr: compileRes.stderr,
        output: compileRes.stderr || errorMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: errorMsg,
        runtimeErrorLine: firstError?.line || 1,
        errorCategory: "compile_error",
        executionBackend: "local",
        executionTimeMs: 0,
        diagnostics: compileRes.diagnostics
      };
    }
    const mainClass = compileRes.mainClass || "Main";
    const javaPath = await resolveExecutable("java");
    if (!javaPath) {
      const remote = await executeViaRemoteSandbox("java", code, stdin, timeoutMs, compileRes.sourceFileName);
      if (remote) {
        return buildRemoteToolchainResult(remote, compileRes.diagnostics);
      }
      const configMsg = "Java runtime (java) not found. Ensure a JDK/JRE is installed and 'java' is in PATH, or set JAVA_HOME / JAVA_PATH.";
      return {
        status: "error",
        canRun: false,
        stdout: "",
        stderr: configMsg,
        output: configMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: configMsg,
        executionTimeMs: 0,
        diagnostics: compileRes.diagnostics
      };
    }
    const runRes = await runSandboxedProcess({
      cmd: javaPath,
      args: [
        "-Dfile.encoding=UTF-8",
        "-Dstdout.encoding=UTF-8",
        "-Dstderr.encoding=UTF-8",
        "-Dstdin.encoding=UTF-8",
        "-Dsun.stdout.encoding=UTF-8",
        "-Dsun.stderr.encoding=UTF-8",
        "-Xmx256m",
        "-cp",
        compileRes.workspaceDir,
        mainClass
      ],
      cwd: compileRes.workspaceDir,
      stdin,
      timeoutMs
    });
    if (runRes.exitCode !== 0 && isLocalExecutionBlockedError(runRes.stderr)) {
      const remote = await executeViaRemoteSandbox("java", code, stdin, timeoutMs, compileRes.sourceFileName);
      if (remote) {
        return buildRemoteToolchainResult(remote, compileRes.diagnostics);
      }
    }
    let runtimeError = null;
    let runtimeErrorLine;
    if (runRes.timedOut) {
      runtimeError = `Execution timed out (${timeoutMs}ms). Possible infinite loop.`;
    } else if (runRes.exitCode !== 0) {
      runtimeError = runRes.stderr.trim() || (runRes.exitCode === null ? "Java process terminated abnormally by signal." : `Java process exited with error code ${runRes.exitCode}.`);
      const escapedFile = compileRes.sourceFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fileFrameMatch = runRes.stderr.match(
        new RegExp(`at\\s+[^(]+\\(${escapedFile}:(\\d+)\\)`)
      );
      const mainFrameMatch = runRes.stderr.match(/at\s+[\w.$<>]+\.main\([^:]+:(\d+)\)/);
      const match = fileFrameMatch || mainFrameMatch;
      if (match) {
        runtimeErrorLine = parseInt(match[1], 10);
      }
    }
    const hasWarnings = compileRes.diagnostics.some((d) => d.severity === "warning");
    const isFailure = runRes.timedOut || runRes.exitCode !== 0;
    const status = isFailure ? "error" : hasWarnings ? "warning" : "success";
    const errorCategory = isFailure ? classifyErrorCategory(runRes.stderr || runtimeError || "", false) : void 0;
    const output = runtimeError ? runRes.stdout ? `${runRes.stdout}
${runtimeError}` : runtimeError : runRes.stdout;
    return {
      status,
      canRun: status !== "error",
      stdout: runRes.stdout,
      stderr: runRes.stderr,
      output,
      exitCode: runRes.exitCode,
      timedOut: runRes.timedOut,
      runtimeError,
      runtimeErrorLine,
      ...errorCategory ? { errorCategory } : {},
      executionBackend: "local",
      executionTimeMs: runRes.executionTimeMs,
      diagnostics: compileRes.diagnostics
    };
  } finally {
    await cleanupSandboxWorkspace(compileRes.workspaceDir);
  }
}

// server/src/services/toolchains/cppToolchain.ts
import fs3 from "node:fs/promises";
import path3 from "node:path";
function parseGppDiagnostics(stderr, stdout) {
  const combined = `${stderr}
${stdout}`;
  const lines = combined.split("\n");
  const diagnostics = [];
  const diagRegex = /^(.+?\.(?:cpp|cc|cxx|c|hpp|h)):(\d+):(\d+):\s*(error|warning|fatal error):\s*(.+)$/i;
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(diagRegex);
    if (match) {
      const lineNum = parseInt(match[2], 10) || 1;
      const column = parseInt(match[3], 10) || 1;
      const isError = match[4].toLowerCase().includes("error");
      const severity = isError ? "error" : "warning";
      const message = match[5].trim();
      diagnostics.push({
        line: lineNum,
        column,
        severity,
        message,
        source: "g++"
      });
    }
  }
  return diagnostics;
}
async function compileCpp(code, fileName = "main.cpp") {
  const workspaceDir = await createSandboxWorkspace();
  const sourceFileName = sanitizeSourceFileName(fileName, "main.cpp", [".cpp", ".cc", ".cxx", ".c"]);
  const sourceFilePath = path3.join(workspaceDir, sourceFileName);
  const binaryFileName = process.platform === "win32" ? "program.exe" : "program.out";
  const binaryFilePath = path3.join(workspaceDir, binaryFileName);
  await fs3.writeFile(sourceFilePath, code, "utf8");
  const gppPath = await resolveExecutable("g++");
  if (!gppPath) {
    const configMsg = "C++ compiler (g++) not found. Ensure g++ is installed and in PATH, or set GPP_PATH.";
    return {
      success: false,
      diagnostics: [],
      stdout: "",
      stderr: configMsg,
      executablePath: binaryFilePath,
      binaryPath: binaryFilePath,
      sourceFileName,
      workingDir: workspaceDir,
      workspaceDir,
      compilerUnavailable: true,
      compilerError: configMsg
    };
  }
  const isCSource = sourceFileName.toLowerCase().endsWith(".c");
  const stdFlag = isCSource ? "-std=c11" : "-std=c++17";
  const procRes = await runSandboxedProcess({
    cmd: gppPath,
    args: [stdFlag, "-Wall", "-Wextra", "-O0", sourceFileName, "-o", binaryFileName],
    cwd: workspaceDir,
    timeoutMs: 15e3
  });
  const diagnostics = parseGppDiagnostics(procRes.stderr, procRes.stdout);
  const hasErrors = procRes.exitCode !== 0 || diagnostics.some((d) => d.severity === "error");
  return {
    success: !hasErrors,
    diagnostics,
    stdout: procRes.stdout,
    stderr: procRes.stderr,
    executablePath: binaryFilePath,
    binaryPath: binaryFilePath,
    sourceFileName,
    workingDir: workspaceDir,
    workspaceDir
  };
}
async function executeCpp(code, stdin = "", timeoutMs = 4e3, fileName = "main.cpp") {
  const compileRes = await compileCpp(code, fileName);
  try {
    if (!compileRes.success) {
      if (compileRes.compilerUnavailable || isLocalExecutionBlockedError(compileRes.stderr)) {
        const remote = await executeViaRemoteSandbox(
          "cpp",
          code,
          stdin,
          timeoutMs,
          compileRes.sourceFileName
        );
        if (remote) {
          const remoteDiagnostics = remote.compileOutput ? parseGppDiagnostics(remote.compileOutput, "") : [];
          const hasRemoteCompileErr = remote.exitCode !== 0 && Boolean(remote.compileOutput);
          return buildRemoteToolchainResult(
            remote,
            remoteDiagnostics,
            hasRemoteCompileErr ? remoteDiagnostics[0]?.line || 1 : void 0
          );
        }
      }
      if (compileRes.compilerUnavailable) {
        const configMsg = compileRes.compilerError || compileRes.stderr.trim() || "C++ compiler (g++) is unavailable on this host.";
        return {
          status: "error",
          canRun: false,
          stdout: "",
          stderr: configMsg,
          output: configMsg,
          exitCode: 1,
          timedOut: false,
          runtimeError: configMsg,
          executionTimeMs: 0,
          diagnostics: []
        };
      }
      const firstError = compileRes.diagnostics.find((d) => d.severity === "error");
      const errorMsg = firstError?.message || compileRes.stderr.trim() || "C++ compilation failed.";
      return {
        status: "error",
        canRun: false,
        stdout: "",
        stderr: compileRes.stderr,
        output: compileRes.stderr || errorMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: errorMsg,
        runtimeErrorLine: firstError?.line || 1,
        errorCategory: "compile_error",
        executionBackend: "local",
        executionTimeMs: 0,
        diagnostics: compileRes.diagnostics
      };
    }
    const runRes = await runSandboxedProcess({
      cmd: compileRes.binaryPath,
      args: [],
      cwd: compileRes.workspaceDir,
      stdin,
      timeoutMs
    });
    const hasWarnings = compileRes.diagnostics.some((d) => d.severity === "warning");
    if (runRes.exitCode !== 0 && isLocalExecutionBlockedError(runRes.stderr)) {
      const remote = await executeViaRemoteSandbox("cpp", code, stdin, timeoutMs);
      if (remote) {
        return buildRemoteToolchainResult(remote, compileRes.diagnostics);
      }
      const blockedMsg = "Local compiled C++ executable was blocked by OS security policy (Device Guard), and remote sandbox execution was unavailable.";
      return {
        status: "error",
        canRun: false,
        stdout: "",
        stderr: blockedMsg,
        output: blockedMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: blockedMsg,
        executionTimeMs: runRes.executionTimeMs,
        diagnostics: compileRes.diagnostics
      };
    }
    let runtimeError = null;
    if (runRes.timedOut) {
      runtimeError = `Execution timed out (${timeoutMs}ms). Possible infinite loop.`;
    } else if (runRes.exitCode !== 0) {
      runtimeError = runRes.stderr.trim() || (runRes.exitCode === null ? "Process terminated abnormally by signal." : `Process exited with error code ${runRes.exitCode}.`);
    }
    const isFailure = runRes.timedOut || runRes.exitCode !== 0;
    const status = isFailure ? "error" : hasWarnings ? "warning" : "success";
    const errorCategory = isFailure ? classifyErrorCategory(runRes.stderr || runtimeError || "", false) : void 0;
    const output = runtimeError ? runRes.stdout ? `${runRes.stdout}
${runtimeError}` : runtimeError : runRes.stdout;
    return {
      status,
      canRun: status !== "error",
      stdout: runRes.stdout,
      stderr: runRes.stderr,
      output,
      exitCode: runRes.exitCode,
      timedOut: runRes.timedOut,
      runtimeError,
      ...errorCategory ? { errorCategory } : {},
      executionBackend: "local",
      executionTimeMs: runRes.executionTimeMs,
      diagnostics: compileRes.diagnostics
    };
  } finally {
    await cleanupSandboxWorkspace(compileRes.workspaceDir);
  }
}

// server/src/services/toolchains/pythonToolchain.ts
import fs4 from "node:fs/promises";
import path4 from "node:path";
async function checkPythonSyntax(code, fileName = "script.py") {
  const workspaceDir = await createSandboxWorkspace();
  const sourceFileName = sanitizeSourceFileName(fileName, "script.py", [".py"]);
  const sourceFilePath = path4.join(workspaceDir, sourceFileName);
  await fs4.writeFile(sourceFilePath, code, "utf8");
  const pythonPath = await resolveExecutable("python");
  if (!pythonPath) {
    const configMsg = "Python interpreter not found. Ensure Python 3 is installed and in PATH, or set PYTHON_PATH.";
    return {
      success: false,
      diagnostics: [],
      stdout: "",
      stderr: configMsg,
      workingDir: workspaceDir,
      workspaceDir,
      compilerUnavailable: true,
      compilerError: configMsg
    };
  }
  const pyCheckerScript = `
import ast, json, sys

try:
    with open(${JSON.stringify(sourceFileName)}, 'r', encoding='utf-8-sig') as f:
        src = f.read()
    ast.parse(src, filename=${JSON.stringify(sourceFileName)})
    print(json.dumps({"success": True, "diagnostics": []}))
except SyntaxError as e:
    diag = [{
        "line": e.lineno or 1,
        "column": e.offset or 1,
        "severity": "error",
        "message": f"{type(e).__name__}: {e.msg}",
        "source": "python"
    }]
    print(json.dumps({"success": False, "diagnostics": diag}))
except Exception as e:
    diag = [{
        "line": 1,
        "severity": "error",
        "message": str(e),
        "source": "python"
    }]
    print(json.dumps({"success": False, "diagnostics": diag}))
`.trim();
  const procRes = await runSandboxedProcess({
    cmd: pythonPath,
    args: ["-c", pyCheckerScript],
    cwd: workspaceDir,
    timeoutMs: 4e3,
    env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }
  });
  let diagnostics = [];
  let success = true;
  try {
    const parsed = JSON.parse(procRes.stdout.trim());
    success = Boolean(parsed.success);
    diagnostics = parsed.diagnostics || [];
  } catch {
    if (procRes.stderr) {
      diagnostics.push({
        line: 1,
        severity: "error",
        message: procRes.stderr.trim(),
        source: "python"
      });
      success = false;
    }
  }
  return {
    success,
    diagnostics,
    stdout: procRes.stdout,
    stderr: procRes.stderr,
    workingDir: workspaceDir,
    workspaceDir
  };
}
async function executePython(code, stdin = "", timeoutMs = 4e3, fileName = "script.py") {
  const syntaxRes = await checkPythonSyntax(code, fileName);
  try {
    if (!syntaxRes.success) {
      if (syntaxRes.compilerUnavailable || isLocalExecutionBlockedError(syntaxRes.stderr)) {
        const remote = await executeViaRemoteSandbox(
          "python",
          code,
          stdin,
          timeoutMs,
          fileName
        );
        if (remote) {
          return buildRemoteToolchainResult(remote, []);
        }
      }
      if (syntaxRes.compilerUnavailable) {
        const configMsg = syntaxRes.compilerError || syntaxRes.stderr.trim() || "Python interpreter is unavailable on this host.";
        return {
          status: "error",
          canRun: false,
          stdout: "",
          stderr: configMsg,
          output: configMsg,
          exitCode: 1,
          timedOut: false,
          runtimeError: configMsg,
          executionTimeMs: 0,
          diagnostics: []
        };
      }
      const firstError = syntaxRes.diagnostics.find((d) => d.severity === "error");
      const errorMsg = firstError?.message || syntaxRes.stderr.trim() || "Python syntax error.";
      return {
        status: "error",
        canRun: false,
        stdout: "",
        stderr: syntaxRes.stderr,
        output: errorMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: errorMsg,
        runtimeErrorLine: firstError?.line || 1,
        errorCategory: "compile_error",
        executionBackend: "local",
        executionTimeMs: 0,
        diagnostics: syntaxRes.diagnostics
      };
    }
    const sourceFileName = sanitizeSourceFileName(fileName, "script.py", [".py"]);
    const pythonPath = await resolveExecutable("python") || "python";
    const runRes = await runSandboxedProcess({
      cmd: pythonPath,
      args: ["-u", sourceFileName],
      cwd: syntaxRes.workspaceDir,
      stdin,
      timeoutMs,
      env: { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }
    });
    if (runRes.exitCode !== 0 && isLocalExecutionBlockedError(runRes.stderr)) {
      const remote = await executeViaRemoteSandbox("python", code, stdin, timeoutMs);
      if (remote) {
        return buildRemoteToolchainResult(remote, syntaxRes.diagnostics);
      }
    }
    let runtimeError = null;
    let runtimeErrorLine;
    if (runRes.timedOut) {
      runtimeError = `Execution timed out (${timeoutMs}ms). Possible infinite loop.`;
    } else if (runRes.exitCode !== 0) {
      runtimeError = runRes.stderr.trim() || (runRes.exitCode === null ? "Python process terminated abnormally by signal." : `Python process exited with error code ${runRes.exitCode}.`);
      const escapedFile = sourceFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fileMatches = [
        ...runRes.stderr.matchAll(new RegExp(`File\\s+["'][^"']*${escapedFile}["'],\\s+line\\s+(\\d+)`, "g"))
      ];
      const lineMatches = fileMatches.length > 0 ? fileMatches : [...runRes.stderr.matchAll(/File\s+["'][^"']+["'],\s+line\s+(\d+)/g)];
      if (lineMatches.length > 0) {
        runtimeErrorLine = parseInt(lineMatches[lineMatches.length - 1][1], 10);
      }
    }
    const hasWarnings = syntaxRes.diagnostics.some((d) => d.severity === "warning");
    const isFailure = runRes.timedOut || runRes.exitCode !== 0;
    const status = isFailure ? "error" : hasWarnings ? "warning" : "success";
    const errorCategory = isFailure ? classifyErrorCategory(runRes.stderr || runtimeError || "", false) : void 0;
    const output = runtimeError ? runRes.stdout ? `${runRes.stdout}
${runtimeError}` : runtimeError : runRes.stdout;
    return {
      status,
      canRun: status !== "error",
      stdout: runRes.stdout,
      stderr: runRes.stderr,
      output,
      exitCode: runRes.exitCode,
      timedOut: runRes.timedOut,
      runtimeError,
      runtimeErrorLine,
      ...errorCategory ? { errorCategory } : {},
      executionBackend: "local",
      executionTimeMs: runRes.executionTimeMs,
      diagnostics: syntaxRes.diagnostics
    };
  } finally {
    await cleanupSandboxWorkspace(syntaxRes.workspaceDir);
  }
}

// server/src/services/toolchains/nodeToolchain.ts
import fs5 from "node:fs/promises";
import path5 from "node:path";
var NODE_PRELOAD_CJS = `
const fs = require('fs');
globalThis.prompt = function(message) {
  if (message !== undefined && message !== null) {
    process.stdout.write(String(message));
  }
  const buf = Buffer.alloc(1);
  const bytes = [];
  while (true) {
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(0, buf, 0, 1, null);
    } catch (err) {
      if (err && (err.code === 'EAGAIN' || err.code === 'EINTR')) continue;
      break;
    }
    if (bytesRead === 0) break;
    const b = buf[0];
    if (b === 10) break;
    if (b !== 13) bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
};
`.trim();
function parseNodeDiagnostics(stderr, stdout) {
  const combined = `${stderr}
${stdout}`;
  const lines = combined.split("\n");
  const diagnostics = [];
  const lineMatchRegex = /^(?:.*[\\/])?([^\\/:\r\n]+\.(?:js|mjs|cjs)):(\d+)(?::\d+)?$/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(lineMatchRegex);
    if (match) {
      const lineNum = parseInt(match[2], 10) || 1;
      let column;
      let message = "SyntaxError";
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        const nextRaw = lines[j];
        const caretIdx = nextRaw.indexOf("^");
        if (caretIdx >= 0 && nextRaw.trim().startsWith("^")) {
          column = caretIdx + 1;
        }
        if (/^(?:SyntaxError|ReferenceError|TypeError|Error):/.test(lines[j].trim())) {
          message = lines[j].trim();
          break;
        }
      }
      diagnostics.push({
        line: lineNum,
        column,
        severity: "error",
        message,
        source: "node"
      });
      break;
    }
  }
  if (diagnostics.length === 0 && stderr.trim()) {
    const errLine = lines.find(
      (l) => /^(?:SyntaxError|ReferenceError|TypeError|RangeError|Error):/.test(l.trim())
    );
    if (errLine) {
      diagnostics.push({
        line: 1,
        severity: "error",
        message: errLine.trim(),
        source: "node"
      });
    }
  }
  return diagnostics;
}
async function checkJsSyntax(code, fileName = "script.js") {
  const workspaceDir = await createSandboxWorkspace();
  const sourceFileName = sanitizeSourceFileName(fileName, "script.js", [".js", ".mjs", ".cjs"]);
  const sourceFilePath = path5.join(workspaceDir, sourceFileName);
  await fs5.writeFile(sourceFilePath, code, "utf8");
  const nodePath = await resolveExecutable("node") || process.execPath;
  const procRes = await runSandboxedProcess({
    cmd: nodePath,
    args: ["--check", sourceFileName],
    cwd: workspaceDir,
    timeoutMs: 4e3
  });
  const diagnostics = parseNodeDiagnostics(procRes.stderr, procRes.stdout);
  const hasErrors = procRes.exitCode !== 0 || diagnostics.some((d) => d.severity === "error");
  return {
    success: !hasErrors,
    diagnostics,
    stdout: procRes.stdout,
    stderr: procRes.stderr,
    workingDir: workspaceDir,
    workspaceDir
  };
}
async function executeJs(code, stdin = "", timeoutMs = 4e3, fileName = "script.js") {
  const syntaxRes = await checkJsSyntax(code, fileName);
  try {
    if (!syntaxRes.success) {
      const firstError = syntaxRes.diagnostics.find((d) => d.severity === "error");
      const errorMsg = firstError?.message || syntaxRes.stderr.trim() || "JavaScript syntax error.";
      return {
        status: "error",
        canRun: false,
        stdout: "",
        stderr: syntaxRes.stderr,
        output: errorMsg,
        exitCode: 1,
        timedOut: false,
        runtimeError: errorMsg,
        runtimeErrorLine: firstError?.line || 1,
        errorCategory: "compile_error",
        executionBackend: "local",
        executionTimeMs: 0,
        diagnostics: syntaxRes.diagnostics
      };
    }
    const sourceFileName = sanitizeSourceFileName(fileName, "script.js", [".js", ".mjs", ".cjs"]);
    const nodePath = await resolveExecutable("node") || process.execPath;
    await fs5.writeFile(path5.join(syntaxRes.workspaceDir, "_preload.cjs"), NODE_PRELOAD_CJS, "utf8");
    const runRes = await runSandboxedProcess({
      cmd: nodePath,
      args: ["--require", "./_preload.cjs", sourceFileName],
      cwd: syntaxRes.workspaceDir,
      stdin,
      timeoutMs
    });
    let runtimeError = null;
    let runtimeErrorLine;
    if (runRes.timedOut) {
      runtimeError = `Execution timed out (${timeoutMs}ms). Possible infinite loop.`;
    } else if (runRes.exitCode !== 0) {
      runtimeError = runRes.stderr.trim() || (runRes.exitCode === null ? "Node.js process terminated abnormally by signal." : `Node.js process exited with error code ${runRes.exitCode}.`);
      const escapedFile = sourceFileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fileMatch = runRes.stderr.match(new RegExp(`${escapedFile}:(\\d+)`, "m"));
      const genericMatch = runRes.stderr.match(/([^\\/:(\r\n]+\.(?:js|mjs|cjs)):(\d+)/m);
      if (fileMatch) {
        runtimeErrorLine = parseInt(fileMatch[1], 10);
      } else if (genericMatch) {
        runtimeErrorLine = parseInt(genericMatch[2], 10);
      }
    }
    const hasWarnings = syntaxRes.diagnostics.some((d) => d.severity === "warning");
    const isFailure = runRes.timedOut || runRes.exitCode !== 0;
    const status = isFailure ? "error" : hasWarnings ? "warning" : "success";
    const errorCategory = isFailure ? classifyErrorCategory(runRes.stderr || runtimeError || "", false) : void 0;
    const output = runtimeError ? runRes.stdout ? `${runRes.stdout}
${runtimeError}` : runtimeError : runRes.stdout;
    return {
      status,
      canRun: status !== "error",
      stdout: runRes.stdout,
      stderr: runRes.stderr,
      output,
      exitCode: runRes.exitCode,
      timedOut: runRes.timedOut,
      runtimeError,
      runtimeErrorLine,
      ...errorCategory ? { errorCategory } : {},
      executionBackend: "local",
      executionTimeMs: runRes.executionTimeMs,
      diagnostics: syntaxRes.diagnostics
    };
  } finally {
    await cleanupSandboxWorkspace(syntaxRes.workspaceDir);
  }
}

// server/src/services/toolchains/toolchainManager.ts
async function analyzeCode(code, language, fileName) {
  if (!code.trim()) {
    return {
      canCompile: true,
      diagnostics: [],
      language
    };
  }
  switch (language) {
    case "java": {
      const res = await compileJava(code, fileName);
      await cleanupSandboxWorkspace(res.workspaceDir);
      return {
        canCompile: res.success,
        diagnostics: res.diagnostics,
        language
      };
    }
    case "cpp": {
      const res = await compileCpp(code, fileName);
      await cleanupSandboxWorkspace(res.workspaceDir);
      return {
        canCompile: res.success,
        diagnostics: res.diagnostics,
        language
      };
    }
    case "python": {
      const res = await checkPythonSyntax(code, fileName);
      await cleanupSandboxWorkspace(res.workspaceDir);
      return {
        canCompile: res.success,
        diagnostics: res.diagnostics,
        language
      };
    }
    case "javascript":
    default: {
      const res = await checkJsSyntax(code, fileName);
      await cleanupSandboxWorkspace(res.workspaceDir);
      return {
        canCompile: res.success,
        diagnostics: res.diagnostics,
        language
      };
    }
  }
}
async function executeCode(code, language, stdin = "", timeoutMs = 4e3, fileName) {
  switch (language) {
    case "java":
      return executeJava(code, stdin, timeoutMs, fileName);
    case "cpp":
      return executeCpp(code, stdin, timeoutMs, fileName);
    case "python":
      return executePython(code, stdin, timeoutMs, fileName);
    case "javascript":
    default:
      return executeJs(code, stdin, timeoutMs, fileName);
  }
}

// server/src/services/geminiTraceService.ts
var modelCooldownUntil = /* @__PURE__ */ new Map();
var traceCache = /* @__PURE__ */ new Map();
function clearTraceCache() {
  traceCache.clear();
}
function computeTraceHash(params) {
  const filePart = params.fileName ? `::${params.fileName.trim()}` : "";
  const stdinPart = params.stdin ? `::stdin=${params.stdin}` : "";
  const payload = `v7::${params.language}::${params.explainLanguage}::${params.depth}${filePart}${stdinPart}::${params.code.trim()}`;
  return crypto2.createHash("sha256").update(payload).digest("hex");
}
function getCacheSize() {
  return traceCache.size;
}
function isGeminiKeyConfigured() {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(
    key && key !== "MY_GEMINI_API_KEY" && !key.startsWith("YOUR_") && key.length > 10
  );
}
var VALID_ANALOGIES = /* @__PURE__ */ new Set([
  "swap_buckets",
  "sort_blocks",
  "pointer_arrows",
  "binary_search_cards",
  "stack_plates",
  "queue_line",
  "linked_list_train",
  "tree_nodes",
  "graph_nodes",
  "recursion_tower",
  "loop_gauge",
  "generic_memory"
]);
var VALID_ROLES = /* @__PURE__ */ new Set([
  "declaration",
  "declare",
  "allocation",
  "assign",
  "condition",
  "comparison",
  "loop",
  "call",
  "return",
  "output",
  "scope_end",
  "block_end",
  "comment"
]);
var VALID_OPERATION_TAGS = /* @__PURE__ */ new Set([
  "DECLARATION",
  "ALLOCATION",
  "DECLARE",
  "ASSIGN",
  "CONDITION",
  "LOOP",
  "LOOP_CHECK",
  "CONDITION_CHECK",
  "COMPARISON",
  "CALL",
  "OUTPUT",
  "RETURN",
  "SCOPE_END",
  "METHOD_ENTRY",
  "BLOCK_END"
]);
var VALID_ACTIONS = /* @__PURE__ */ new Set([
  "declare",
  "assign",
  "transfer",
  "compare",
  "swap",
  "move_pointer",
  "push",
  "pop",
  "enqueue",
  "dequeue",
  "insert",
  "remove",
  "call",
  "return",
  "loop_check",
  "halt"
]);
var VALID_FAULT_TYPES = /* @__PURE__ */ new Set([
  "lost_value",
  "index_out_of_bounds",
  "infinite_loop",
  "null_pointer",
  "stack_overflow",
  "off_by_one",
  "type_error",
  "runtime_exception"
]);
var VALID_VERDICTS = /* @__PURE__ */ new Set([
  "ok",
  "logic_error",
  "runtime_error",
  "infinite_loop",
  "compile_error"
]);
var TRACE_RESPONSE_SCHEMA = {
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
        message: { type: Type.STRING }
      },
      required: ["message"]
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
            note: { type: Type.STRING }
          },
          required: ["time", "space", "note"]
        },
        commonMistakes: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: [
        "title",
        "goal",
        "idea",
        "keyPoints",
        "analogyStory",
        "complexity",
        "commonMistakes"
      ]
    },
    lineNotes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          line: { type: Type.INTEGER },
          role: { type: Type.STRING },
          text: { type: Type.STRING },
          why: { type: Type.STRING }
        },
        required: ["line", "role", "text", "why"]
      }
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
            description: "AST-accurate tag: DECLARATION, ALLOCATION, ASSIGN, CONDITION, LOOP, COMPARISON, CALL, OUTPUT, RETURN, or SCOPE_END"
          },
          animationAction: {
            type: Type.STRING,
            nullable: true,
            description: "Visual cue action: read_stdin, declare, assign, evaluate_condition, switch_jump, loop_step, compute, print_output, runtime_error, or close_resource"
          },
          banglaExplanation: {
            type: Type.STRING,
            nullable: true,
            description: "Crystal-clear beginner-friendly conversational Bangla explanation of what this step does and why"
          },
          cumulativeOutput: {
            type: Type.STRING,
            nullable: true,
            description: "All console stdout accumulated from step 1 through this step"
          },
          stdinConsumed: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              token: { type: Type.STRING },
              targetVar: { type: Type.STRING, nullable: true },
              targetType: { type: Type.STRING, nullable: true },
              bufferIndex: { type: Type.INTEGER, nullable: true },
              remainingTokens: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.STRING }
              }
            },
            required: ["token"]
          },
          conditionEval: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              expression: { type: Type.STRING },
              result: { type: Type.STRING },
              branchTaken: { type: Type.STRING, nullable: true },
              kind: { type: Type.STRING, nullable: true },
              casesChecked: {
                type: Type.ARRAY,
                nullable: true,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    matched: { type: Type.BOOLEAN }
                  },
                  required: ["label", "matched"]
                }
              }
            },
            required: ["expression", "result"]
          },
          loopInfo: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              iteration: { type: Type.INTEGER },
              conditionText: { type: Type.STRING, nullable: true },
              continuing: { type: Type.BOOLEAN }
            },
            required: ["iteration", "continuing"]
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
                to: { type: Type.STRING, nullable: true }
              },
              required: ["name", "from", "to"]
            }
          },
          variablesJson: {
            type: Type.STRING,
            description: 'JSON object string of all current variables and their exact values after this step executes, e.g. {"a":5,"b":10}'
          },
          variableSnapshotsJson: {
            type: Type.STRING,
            nullable: true,
            description: 'JSON array string of variable objects: [{"name":"a","type":"Integer","value":127,"memoryAddress":"@IntegerCache[127]","referenceId":"@IntegerCache[127]","pointsTo":null,"changed":true}]'
          },
          visualCue: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              mode: { type: Type.STRING },
              highlightVars: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.STRING }
              },
              compareVars: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.STRING }
              },
              linkVars: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.STRING }
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
                  reason: { type: Type.STRING, nullable: true }
                },
                required: ["leftLabel", "rightLabel", "operator", "result"]
              }
            }
          },
          structure: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              kind: { type: Type.STRING },
              valuesJson: {
                type: Type.STRING,
                nullable: true,
                description: 'JSON array string of structure values, e.g. "[5,2,8,1]" or "["fact(3)","fact(2)"]"'
              },
              highlight: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.INTEGER }
              },
              swapping: {
                type: Type.ARRAY,
                nullable: true,
                items: { type: Type.INTEGER },
                description: "Two-element index pair [i, j] when swapping elements, else null"
              },
              sortedFrom: { type: Type.INTEGER, nullable: true },
              pointersJson: {
                type: Type.STRING,
                nullable: true,
                description: 'JSON object string of pointer indices, e.g. "{\\"i\\":0,\\"j\\":1}"'
              },
              lap: { type: Type.INTEGER, nullable: true },
              maxLaps: { type: Type.INTEGER, nullable: true },
              conditionText: { type: Type.STRING, nullable: true }
            },
            required: ["kind"]
          },
          fault: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              type: { type: Type.STRING },
              message: { type: Type.STRING },
              fixHint: { type: Type.STRING },
              target: { type: Type.STRING, nullable: true }
            },
            required: ["type", "message", "fixHint"]
          }
        },
        required: [
          "stepIndex",
          "activeLine",
          "analogyType",
          "action",
          "explanation",
          "why",
          "changes",
          "variablesJson"
        ]
      }
    },
    finalOutput: { type: Type.STRING },
    outputExplanation: { type: Type.STRING },
    verdict: {
      type: Type.OBJECT,
      properties: {
        status: { type: Type.STRING },
        message: { type: Type.STRING }
      },
      required: ["status", "message"]
    }
  },
  required: [
    "isValidLogic",
    "language",
    "analogyType",
    "traceSource",
    "logicSummary",
    "lineNotes",
    "steps",
    "finalOutput",
    "outputExplanation",
    "verdict"
  ]
};
function normalizeGeminiRawOutput(rawObj, fallbackLang, code, stdin = "", explainLanguage = "bn") {
  if (!rawObj || typeof rawObj !== "object") return rawObj;
  const cleanCode = stripCommentsPreservingLines(code, fallbackLang);
  const codeLines = cleanCode.split("\n");
  const maxLine = Math.max(1, codeLines.length);
  const declaredTypesByVar = extractDeclaredVariableTypes(cleanCode, fallbackLang);
  let heapAllocCounter = 0;
  const resolveMissingRef = (name, resolvedType, val, lineText) => {
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
          pointsTo: aliasMatch[1] === "&" ? aliasMatch[2] : targetSnap.pointsTo ?? null
        };
      }
    }
    if (fallbackLang === "java" && resolvedType === "Integer" && typeof val === "number" && Number.isInteger(val)) {
      const usesNew = /\bnew\s+Integer\s*\(/.test(lineText);
      if (!usesNew && val >= -128 && val <= 127) {
        const addr = `@IntegerCache[${val}]`;
        return { memoryAddress: addr, referenceId: addr, pointsTo: null };
      }
      heapAllocCounter++;
      const hex = `@0x${(1185 + heapAllocCounter * 23).toString(16).toUpperCase()}`;
      return { memoryAddress: hex, referenceId: hex, pointsTo: null };
    }
    return { memoryAddress: null, referenceId: null, pointsTo: null };
  };
  const topAnalogy = VALID_ANALOGIES.has(rawObj.analogyType) ? rawObj.analogyType : "generic_memory";
  const cleanNonBoilerplateNote = (text, lineNum, rawLineText) => {
    const trimmed = String(text || "").trim();
    if (!trimmed || trimmed === rawLineText || /^লাইন\s+\d+\s*\([^)]*\)\s*(?:এক্সিকিউট\s+হয়েছে|সম্পন্ন\s+হয়েছে)/.test(trimmed) || /^Line\s+\d+\s*\([^)]*\)\s*executed\.?$/i.test(trimmed)) {
      return "";
    }
    return trimmed;
  };
  const rawLineNotes = Array.isArray(rawObj.lineNotes) ? rawObj.lineNotes.map((ln, i) => {
    const lineNum = typeof ln.line === "number" && ln.line >= 1 && ln.line <= maxLine ? ln.line : Math.min(maxLine, i + 1);
    const rawLineText = (codeLines[lineNum - 1] || "").trim();
    const isPrintLineNote = /\b(System\.out\.print|console\.log|print\s*\(|cout\s*<<|printf\s*\()/.test(
      rawLineText
    );
    const isScopeCloseNote = /^[\}\s;]*$/.test(rawLineText) && rawLineText.includes("}");
    const isDeclNote = /^(?:public|private|protected|class|interface|def|function|int\s+main\s*\(|void\s+\w+\s*\()/.test(
      rawLineText
    );
    const rawRoleLower = typeof ln.role === "string" ? ln.role.toLowerCase() : "";
    const normalizedRole = isPrintLineNote ? "output" : isScopeCloseNote ? "scope_end" : isDeclNote ? "declaration" : VALID_ROLES.has(rawRoleLower) ? rawRoleLower : inferLineRole(rawLineText);
    return {
      line: lineNum,
      role: normalizedRole,
      text: cleanNonBoilerplateNote(String(ln.text || ""), lineNum, rawLineText),
      why: ln.why ? cleanNonBoilerplateNote(String(ln.why), lineNum, rawLineText) || void 0 : void 0
    };
  }) : [];
  const dedupedNotesMap = /* @__PURE__ */ new Map();
  for (const n of rawLineNotes) {
    if (!dedupedNotesMap.has(n.line) || n.text && !dedupedNotesMap.get(n.line)?.text) {
      dedupedNotesMap.set(n.line, n);
    }
  }
  let runningVars = {};
  let runningSnapshotMeta = {};
  let runningStdout = "";
  const stdinQueue = tokenizeStdin(stdin);
  let runningStdinIdx = 0;
  const steps = Array.isArray(rawObj.steps) ? rawObj.steps.slice(0, 120).map((s, idx) => {
    let variables = {};
    if (s.variables && typeof s.variables === "object") {
      variables = s.variables;
    } else if (typeof s.variablesJson === "string" && s.variablesJson.trim()) {
      try {
        const parsed = JSON.parse(s.variablesJson);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          variables = parsed;
        }
      } catch {
        variables = { ...runningVars };
      }
    }
    const rawChanges = Array.isArray(s.changes) ? s.changes.map((c) => ({
      name: String(c?.name || "var"),
      from: c?.from === void 0 || c?.from === null ? null : typeof c.from === "object" ? JSON.stringify(c.from) : c.from,
      to: c?.to === void 0 || c?.to === null ? null : typeof c.to === "object" ? JSON.stringify(c.to) : c.to
    })) : [];
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
    const activeLine = typeof s.activeLine === "number" && s.activeLine >= 1 && s.activeLine <= maxLine ? s.activeLine : 1;
    const stepAnalogy = VALID_ANALOGIES.has(s.analogyType) ? s.analogyType : topAnalogy;
    const rawLineText = (codeLines[activeLine - 1] || "").trim();
    let normalizedFault = null;
    if (s.fault && typeof s.fault === "object" && s.fault.message) {
      normalizedFault = {
        type: VALID_FAULT_TYPES.has(s.fault.type) ? s.fault.type : "off_by_one",
        message: String(s.fault.message),
        fixHint: String(s.fault.fixHint || s.fault.message),
        target: s.fault.target ? String(s.fault.target) : void 0
      };
    }
    const autoStructure = buildStructureFromVariables(
      stepAnalogy,
      variables,
      rawLineText
    );
    let normalizedStructure = autoStructure;
    if (s.structure && typeof s.structure === "object" && ["array", "loop", "stack", "queue", "list"].includes(s.structure.kind)) {
      let parsedValues = null;
      if (Array.isArray(s.structure.values)) {
        parsedValues = s.structure.values.map(
          (v) => typeof v === "number" || typeof v === "string" ? v : String(v)
        );
      } else if (typeof s.structure.valuesJson === "string" && s.structure.valuesJson.trim()) {
        try {
          const arr = JSON.parse(s.structure.valuesJson);
          if (Array.isArray(arr)) {
            parsedValues = arr.map(
              (v) => typeof v === "number" || typeof v === "string" ? v : String(v)
            );
          }
        } catch {
        }
      }
      let parsedPointers = null;
      if (s.structure.pointers && typeof s.structure.pointers === "object") {
        parsedPointers = {};
        for (const [pk, pv] of Object.entries(s.structure.pointers)) {
          if (typeof pv === "number" && Number.isFinite(pv)) {
            parsedPointers[pk] = pv;
          }
        }
      } else if (typeof s.structure.pointersJson === "string" && s.structure.pointersJson.trim()) {
        try {
          const obj = JSON.parse(s.structure.pointersJson);
          if (obj && typeof obj === "object" && !Array.isArray(obj)) {
            parsedPointers = {};
            for (const [pk, pv] of Object.entries(obj)) {
              if (typeof pv === "number" && Number.isFinite(pv)) {
                parsedPointers[pk] = pv;
              }
            }
          }
        } catch {
        }
      }
      const rawSwap = Array.isArray(s.structure.swapping) ? s.structure.swapping : null;
      const normalizedSwapping = rawSwap && rawSwap.length >= 2 && typeof rawSwap[0] === "number" && typeof rawSwap[1] === "number" ? [rawSwap[0], rawSwap[1]] : null;
      const normalizedHighlight = Array.isArray(s.structure.highlight) ? s.structure.highlight.filter((n) => typeof n === "number" && Number.isFinite(n)) : null;
      normalizedStructure = {
        kind: s.structure.kind,
        values: parsedValues ?? autoStructure?.values ?? null,
        highlight: normalizedHighlight ?? autoStructure?.highlight ?? null,
        swapping: normalizedSwapping,
        sortedFrom: typeof s.structure.sortedFrom === "number" && Number.isFinite(s.structure.sortedFrom) ? s.structure.sortedFrom : null,
        pointers: parsedPointers ?? autoStructure?.pointers ?? null,
        lap: typeof s.structure.lap === "number" && Number.isFinite(s.structure.lap) ? s.structure.lap : autoStructure?.lap ?? null,
        maxLaps: typeof s.structure.maxLaps === "number" && Number.isFinite(s.structure.maxLaps) ? s.structure.maxLaps : autoStructure?.maxLaps ?? null,
        conditionText: typeof s.structure.conditionText === "string" ? s.structure.conditionText : autoStructure?.conditionText ?? null
      };
    }
    const uiAct = VALID_ACTIONS.has(s.action) ? s.action : "assign";
    const isPrintLine = /\b(System\.out\.print|console\.log|print\s*\(|cout\s*<<|printf\s*\()/.test(
      rawLineText
    );
    const isScopeClose = /^[\}\s;]*$/.test(rawLineText) && rawLineText.includes("}");
    let mappedActionType = typeof s.operationTag === "string" && VALID_OPERATION_TAGS.has(s.operationTag.toUpperCase()) ? s.operationTag.toUpperCase() : uiAct === "declare" ? "DECLARATION" : uiAct === "loop_check" ? "LOOP" : uiAct === "compare" ? "COMPARISON" : uiAct === "call" ? "CALL" : uiAct === "return" ? "RETURN" : s.stdout ? "OUTPUT" : "ASSIGN";
    if (s.stdout || isPrintLine) {
      mappedActionType = "OUTPUT";
    } else if (isScopeClose && mappedActionType === "ASSIGN") {
      mappedActionType = "SCOPE_END";
    }
    const changedNameSet = new Set(rawChanges.map((c) => c.name));
    let normalizedSnapshots = null;
    const parseSnapshotsArray = (arr) => arr.filter((item) => item && typeof item === "object" && item.name).map((item) => {
      const name = String(item.name);
      const prevMeta = runningSnapshotMeta[name];
      const val = item.value !== void 0 ? item.value : variables[name];
      const sameVal = prevMeta && JSON.stringify(prevMeta.value) === JSON.stringify(val);
      const resolvedType = resolveAccurateVariableType(
        item.type || prevMeta?.type,
        val,
        fallbackLang,
        name,
        declaredTypesByVar
      );
      const explicitAddr = item.memoryAddress ? String(item.memoryAddress) : null;
      const explicitRef = item.referenceId ? String(item.referenceId) : null;
      const fallbackRef = explicitAddr || explicitRef || sameVal && prevMeta?.memoryAddress ? null : resolveMissingRef(name, resolvedType, val, rawLineText);
      return {
        name,
        type: resolvedType,
        value: val,
        memoryAddress: explicitAddr || (sameVal ? prevMeta?.memoryAddress : null) || fallbackRef?.memoryAddress || null,
        referenceId: explicitRef || (sameVal ? prevMeta?.referenceId : null) || fallbackRef?.referenceId || explicitAddr || null,
        pointsTo: item.pointsTo ? String(item.pointsTo) : (sameVal ? prevMeta?.pointsTo : null) || fallbackRef?.pointsTo || null,
        changed: typeof item.changed === "boolean" ? item.changed : changedNameSet.has(name)
      };
    });
    if (Array.isArray(s.variableSnapshots)) {
      normalizedSnapshots = parseSnapshotsArray(s.variableSnapshots);
    } else if (typeof s.variableSnapshotsJson === "string" && s.variableSnapshotsJson.trim()) {
      try {
        const parsedSnaps = JSON.parse(s.variableSnapshotsJson);
        if (Array.isArray(parsedSnaps)) {
          normalizedSnapshots = parseSnapshotsArray(parsedSnaps);
        }
      } catch {
      }
    }
    if (normalizedSnapshots && normalizedSnapshots.length > 0) {
      for (const snap of normalizedSnapshots) {
        runningSnapshotMeta[snap.name] = snap;
        if (variables[snap.name] === void 0) {
          variables[snap.name] = snap.value;
        }
      }
      runningVars = { ...runningVars, ...variables };
    } else if (Object.keys(variables).length > 0) {
      normalizedSnapshots = Object.entries(variables).map(([vName, vVal]) => {
        const prevMeta = runningSnapshotMeta[vName];
        const sameVal = prevMeta && JSON.stringify(prevMeta.value) === JSON.stringify(vVal);
        const resolvedType = resolveAccurateVariableType(
          prevMeta?.type,
          vVal,
          fallbackLang,
          vName,
          declaredTypesByVar
        );
        const missingRef = sameVal && (prevMeta?.memoryAddress || prevMeta?.referenceId) ? null : resolveMissingRef(vName, resolvedType, vVal, rawLineText);
        const snap = {
          name: vName,
          type: resolvedType,
          value: vVal,
          memoryAddress: (sameVal ? prevMeta?.memoryAddress : null) || missingRef?.memoryAddress || null,
          referenceId: (sameVal ? prevMeta?.referenceId : null) || missingRef?.referenceId || null,
          pointsTo: (sameVal ? prevMeta?.pointsTo : null) || missingRef?.pointsTo || null,
          changed: changedNameSet.has(vName)
        };
        runningSnapshotMeta[vName] = snap;
        return snap;
      });
    }
    const VALID_CUE_MODES = /* @__PURE__ */ new Set([
      "memory",
      "compare",
      "reference",
      "mutate",
      "loop",
      "output",
      "call",
      "return"
    ]);
    let normalizedVisualCue = null;
    if (s.visualCue && typeof s.visualCue === "object") {
      const rawCompare = Array.isArray(s.visualCue.compareVars) ? s.visualCue.compareVars.map(String).filter(Boolean) : null;
      const comparePair = rawCompare && rawCompare.length >= 2 ? [rawCompare[0], rawCompare[1]] : null;
      const compObj = s.visualCue.comparison && typeof s.visualCue.comparison === "object" && s.visualCue.comparison.leftLabel && s.visualCue.comparison.rightLabel ? {
        leftVar: s.visualCue.comparison.leftVar ? String(s.visualCue.comparison.leftVar) : comparePair?.[0] || null,
        rightVar: s.visualCue.comparison.rightVar ? String(s.visualCue.comparison.rightVar) : comparePair?.[1] || null,
        leftLabel: String(s.visualCue.comparison.leftLabel),
        rightLabel: String(s.visualCue.comparison.rightLabel),
        operator: String(s.visualCue.comparison.operator || "=="),
        result: Boolean(s.visualCue.comparison.result),
        reason: s.visualCue.comparison.reason ? String(s.visualCue.comparison.reason) : null
      } : null;
      normalizedVisualCue = {
        mode: VALID_CUE_MODES.has(s.visualCue.mode) ? s.visualCue.mode : void 0,
        highlightVars: Array.isArray(s.visualCue.highlightVars) ? s.visualCue.highlightVars.map(String) : void 0,
        compareVars: comparePair,
        linkVars: Array.isArray(s.visualCue.linkVars) ? s.visualCue.linkVars.map(String) : null,
        comparison: compObj
      };
    }
    if (!normalizedVisualCue?.comparison && normalizedSnapshots && normalizedSnapshots.length > 0) {
      const snapByName = new Map(normalizedSnapshots.map((sn) => [sn.name, sn]));
      const equalsCallMatch = rawLineText.match(/\b([A-Za-z_$][\w$]*)\.equals\(\s*([A-Za-z_$][\w$]*)\s*\)/);
      const binOpMatch = rawLineText.match(/\b([A-Za-z_$][\w$]*)\s*(===|==|!==|!=|<=|>=|<|>)\s*([A-Za-z_$][\w$]*)\b/);
      if (equalsCallMatch && snapByName.has(equalsCallMatch[1]) && snapByName.has(equalsCallMatch[2])) {
        const left = snapByName.get(equalsCallMatch[1]);
        const right = snapByName.get(equalsCallMatch[2]);
        const res = JSON.stringify(left.value) === JSON.stringify(right.value);
        normalizedVisualCue = {
          ...normalizedVisualCue || {},
          mode: "compare",
          compareVars: [left.name, right.name],
          highlightVars: [left.name, right.name],
          comparison: {
            leftVar: left.name,
            rightVar: right.name,
            leftLabel: `value(${String(left.value)})`,
            rightLabel: `value(${String(right.value)})`,
            operator: ".equals()",
            result: res,
            reason: normalizedVisualCue?.comparison?.reason || null
          }
        };
      } else if (binOpMatch && snapByName.has(binOpMatch[1]) && snapByName.has(binOpMatch[3])) {
        const left = snapByName.get(binOpMatch[1]);
        const op = binOpMatch[2];
        const right = snapByName.get(binOpMatch[3]);
        const useRefCompare = (op === "==" || op === "===") && Boolean(left.referenceId && right.referenceId) && (fallbackLang === "java" || typeof left.value === "object");
        const leftLbl = useRefCompare ? String(left.referenceId) : `${left.name}(${String(left.value)})`;
        const rightLbl = useRefCompare ? String(right.referenceId) : `${right.name}(${String(right.value)})`;
        let res = false;
        if (op === "==" || op === "===") {
          res = useRefCompare ? left.referenceId === right.referenceId : left.value === right.value;
        } else if (op === "!=" || op === "!==") {
          res = useRefCompare ? left.referenceId !== right.referenceId : left.value !== right.value;
        } else if (op === "<") res = Number(left.value) < Number(right.value);
        else if (op === ">") res = Number(left.value) > Number(right.value);
        else if (op === "<=") res = Number(left.value) <= Number(right.value);
        else if (op === ">=") res = Number(left.value) >= Number(right.value);
        normalizedVisualCue = {
          ...normalizedVisualCue || {},
          mode: "compare",
          compareVars: [left.name, right.name],
          highlightVars: [left.name, right.name],
          comparison: {
            leftVar: left.name,
            rightVar: right.name,
            leftLabel: leftLbl,
            rightLabel: rightLbl,
            operator: op,
            result: res,
            reason: normalizedVisualCue?.comparison?.reason || null
          }
        };
      }
    }
    const stepStdoutText = s.stdout ? String(s.stdout) : null;
    if (stepStdoutText) {
      runningStdout = runningStdout ? `${runningStdout}${runningStdout.endsWith("\n") || runningStdout.endsWith(": ") ? "" : "\n"}${stepStdoutText}` : stepStdoutText;
    }
    const computedCumulativeOutput = typeof s.cumulativeOutput === "string" && s.cumulativeOutput.length >= runningStdout.length ? s.cumulativeOutput : runningStdout || null;
    if (typeof s.cumulativeOutput === "string" && s.cumulativeOutput.length > runningStdout.length) {
      runningStdout = s.cumulativeOutput;
    }
    let normalizedStdinConsumed = null;
    const isInputReadLine = /\b(?:nextDouble|nextInt|nextLong|nextFloat|nextBoolean|nextLine|next|readLine|input|scanf|getline|prompt|readline)\s*\(/.test(
      rawLineText
    ) || /\bcin\s*>>/.test(rawLineText);
    if (s.stdinConsumed && typeof s.stdinConsumed === "object" && s.stdinConsumed.token !== void 0) {
      const bufIdx = typeof s.stdinConsumed.bufferIndex === "number" ? s.stdinConsumed.bufferIndex : runningStdinIdx;
      runningStdinIdx = Math.max(runningStdinIdx + 1, bufIdx + 1);
      normalizedStdinConsumed = {
        token: String(s.stdinConsumed.token),
        targetVar: s.stdinConsumed.targetVar ? String(s.stdinConsumed.targetVar) : rawChanges[0]?.name || null,
        targetType: s.stdinConsumed.targetType ? String(s.stdinConsumed.targetType) : null,
        bufferIndex: bufIdx,
        remainingTokens: Array.isArray(s.stdinConsumed.remainingTokens) ? s.stdinConsumed.remainingTokens.map(String) : stdinQueue.slice(runningStdinIdx)
      };
    } else if (isInputReadLine && runningStdinIdx < stdinQueue.length) {
      const consumedTok = stdinQueue[runningStdinIdx];
      runningStdinIdx += 1;
      normalizedStdinConsumed = {
        token: consumedTok,
        targetVar: rawChanges[0]?.name || null,
        targetType: normalizedSnapshots?.find((sn) => sn.name === rawChanges[0]?.name)?.type || null,
        bufferIndex: runningStdinIdx - 1,
        remainingTokens: stdinQueue.slice(runningStdinIdx)
      };
    }
    let normalizedConditionEval = null;
    if (s.conditionEval && typeof s.conditionEval === "object" && s.conditionEval.expression) {
      const rawRes = s.conditionEval.result;
      const parsedRes = rawRes === "true" ? true : rawRes === "false" ? false : typeof rawRes === "boolean" ? rawRes : String(rawRes ?? "");
      normalizedConditionEval = {
        expression: String(s.conditionEval.expression),
        result: parsedRes,
        branchTaken: s.conditionEval.branchTaken ? String(s.conditionEval.branchTaken) : null,
        kind: ["if", "else_if", "else", "switch", "loop", "ternary"].includes(s.conditionEval.kind) ? s.conditionEval.kind : null,
        casesChecked: Array.isArray(s.conditionEval.casesChecked) ? s.conditionEval.casesChecked.filter((c) => c && typeof c === "object" && c.label).map((c) => ({
          label: String(c.label),
          matched: Boolean(c.matched)
        })) : null
      };
    } else if (normalizedVisualCue?.comparison) {
      normalizedConditionEval = {
        expression: `${normalizedVisualCue.comparison.leftLabel} ${normalizedVisualCue.comparison.operator} ${normalizedVisualCue.comparison.rightLabel}`,
        result: normalizedVisualCue.comparison.result,
        branchTaken: normalizedVisualCue.comparison.result ? "true-branch" : "false-branch",
        kind: "if",
        casesChecked: null
      };
    }
    const normalizedLoopInfo = s.loopInfo && typeof s.loopInfo === "object" && typeof s.loopInfo.iteration === "number" ? {
      iteration: s.loopInfo.iteration,
      conditionText: s.loopInfo.conditionText ? String(s.loopInfo.conditionText) : null,
      continuing: Boolean(s.loopInfo.continuing)
    } : null;
    const resolvedBangla = String(s.banglaExplanation || s.explanation || "");
    return {
      stepIndex: idx + 1,
      activeLine,
      analogyType: stepAnalogy,
      action: uiAct,
      from: s.from ? String(s.from) : null,
      to: s.to ? String(s.to) : rawChanges[0]?.name || null,
      explanation: String(s.explanation || resolvedBangla || ""),
      why: String(s.why || ""),
      stdout: stepStdoutText,
      changes: rawChanges,
      variables,
      fault: normalizedFault,
      structure: normalizedStructure,
      step: idx + 1,
      lineNumber: activeLine,
      codeSnippet: rawLineText,
      actionType: mappedActionType,
      memoryState: variables,
      memoryDelta: rawChanges[0] ? {
        variable: rawChanges[0].name,
        oldValue: rawChanges[0].from,
        newValue: rawChanges[0].to
      } : { variable: null, oldValue: null, newValue: null },
      consoleOutput: stepStdoutText,
      whatHappenedBn: resolvedBangla,
      logicBuildingBn: String(s.why || ""),
      whatHappened: String(s.explanation || resolvedBangla || ""),
      whyAndLogic: String(s.why || ""),
      variableSnapshots: normalizedSnapshots,
      visualCue: normalizedVisualCue,
      stdinConsumed: normalizedStdinConsumed,
      conditionEval: normalizedConditionEval,
      loopInfo: normalizedLoopInfo,
      animationAction: s.animationAction ? String(s.animationAction) : normalizedStdinConsumed ? "read_stdin" : normalizedFault ? "runtime_error" : mappedActionType === "OUTPUT" ? "print_output" : normalizedConditionEval?.kind === "switch" ? "switch_jump" : normalizedConditionEval ? "evaluate_condition" : normalizedLoopInfo ? "loop_step" : mappedActionType.toLowerCase(),
      banglaExplanation: resolvedBangla || null,
      cumulativeOutput: computedCumulativeOutput,
      variablesState: variables
    };
  }) : [];
  const verdictStatus = VALID_VERDICTS.has(rawObj.verdict?.status) ? rawObj.verdict.status : rawObj.isValidLogic === false ? "logic_error" : "ok";
  const isCompileFailure = verdictStatus === "compile_error";
  const isRuntimeFailure = verdictStatus === "runtime_error" || verdictStatus === "infinite_loop";
  const hasErr = Boolean(rawObj.hasError || isCompileFailure || isRuntimeFailure);
  const keepStepsOnError = !isCompileFailure && steps.length > 0;
  const effectiveSteps = isCompileFailure ? [] : steps;
  const executedLines = new Set(effectiveSteps.map((s) => s.activeLine));
  const blockExec = analyzeBlockExecution(code, fallbackLang, executedLines);
  const reconciledNotesMap = /* @__PURE__ */ new Map();
  for (let i = 0; i < codeLines.length; i++) {
    const ln = i + 1;
    const trimmedLine = codeLines[i].trim();
    if (!trimmedLine) continue;
    const existing = dedupedNotesMap.get(ln);
    const wasLineExecuted = executedLines.has(ln);
    const braceInfo = blockExec.braceByCloseLine.get(ln);
    const pythonEndInfo = blockExec.pythonEndsByLine.get(ln);
    const isClosingBrace = trimmedLine === "}" || trimmedLine === "};";
    const isConditionalHeader = /^(?:\}?\s*)?(?:else\s+if|elif|else|catch|except|case\b|default\s*:)/.test(
      trimmedLine
    );
    if (!isCompileFailure && (isClosingBrace || !wasLineExecuted && (blockExec.skippedBlockLines.has(ln) || isConditionalHeader))) {
      const aware = buildExecutionAwareLineNote({
        lineNumber: ln,
        trimmed: trimmedLine,
        language: fallbackLang,
        explainLanguage,
        executedLines,
        braceInfo,
        pythonEndInfo
      });
      const existingText = existing?.text || "";
      const mentionsSkipped = /স্কিপ|চলেনি|প্রবেশ\s*করেনি|বাদ\s*পড়ে|হয়নি|skip|not\s+executed|bypassed|unentered|did\s+not\s+enter/i.test(
        existingText
      );
      const claimsActiveReturn = /নিয়ন্ত্রণ\s+বাইরের|ব্লক\s+শেষ\s+হয়ে\s+নিয়ন্ত্রণ|returning\s+control|returns\s+control/i.test(
        existingText
      );
      const shouldOverrideWithAware = !existingText || isClosingBrace && (!braceInfo?.wasBlockExecuted || claimsActiveReturn) || !wasLineExecuted && !mentionsSkipped;
      reconciledNotesMap.set(ln, {
        line: ln,
        role: existing?.role || inferLineRole(trimmedLine),
        text: shouldOverrideWithAware ? aware.text : existingText,
        why: shouldOverrideWithAware ? aware.why : existing?.why || aware.why
      });
      continue;
    }
    if (existing?.text) {
      let updatedText = existing.text;
      if (!isCompileFailure && fallbackLang === "python" && wasLineExecuted && pythonEndInfo?.wasBlockExecuted && !/ইন্ডেন্টেশন|ব্লক.*শেষ|block\s*end|ends\s+the\s+python/i.test(updatedText)) {
        updatedText = explainLanguage === "bn" ? `${updatedText} (\u098F\u0987 \u09B2\u09BE\u0987\u09A8\u09C7\u09B0 \u09AA\u09B0 \`${pythonEndInfo.kind}\` \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u0987\u09A8\u09CD\u09A1\u09C7\u09A8\u09CD\u099F\u09C7\u09B6\u09A8 \u09B6\u09C7\u09B7 \u09B9\u09DF\u09C7 \u09A8\u09BF\u09DF\u09A8\u09CD\u09A4\u09CD\u09B0\u09A3 \u09AC\u09BE\u0987\u09B0\u09C7\u09B0 \u09B8\u09CD\u09A4\u09B0\u09C7 \u09AB\u09BF\u09B0\u09C7 \u0986\u09B8\u09C7)` : `${updatedText} (Ends the Python \`${pythonEndInfo.kind}\` block afterward, returning control outward)`;
      }
      reconciledNotesMap.set(ln, {
        ...existing,
        text: updatedText
      });
    } else if (!isCompileFailure) {
      const aware = buildExecutionAwareLineNote({
        lineNumber: ln,
        trimmed: trimmedLine,
        language: fallbackLang,
        explainLanguage,
        executedLines,
        braceInfo,
        pythonEndInfo
      });
      reconciledNotesMap.set(ln, {
        line: ln,
        role: existing?.role || inferLineRole(trimmedLine),
        text: aware.text,
        why: existing?.why || aware.why
      });
    } else if (existing) {
      reconciledNotesMap.set(ln, existing);
    }
  }
  const finalLineNotes = Array.from(reconciledNotesMap.values()).sort((a, b) => a.line - b.line);
  let normalizedErrorDetails = null;
  if (rawObj.errorDetails && typeof rawObj.errorDetails === "object" && rawObj.errorDetails.message) {
    const ln = typeof rawObj.errorDetails.lineNumber === "number" && rawObj.errorDetails.lineNumber >= 1 ? rawObj.errorDetails.lineNumber : typeof rawObj.errorDetails.line === "number" && rawObj.errorDetails.line >= 1 ? rawObj.errorDetails.line : 1;
    normalizedErrorDetails = {
      errorType: rawObj.errorDetails.errorType === "FILE_NAME_MISMATCH" || rawObj.errorDetails.errorType === "COMPILATION_ERROR" || rawObj.errorDetails.errorType === "RUNTIME_ERROR" || rawObj.errorDetails.errorType === "INPUT_ERROR" ? rawObj.errorDetails.errorType : isRuntimeFailure ? classifyErrorCategory(String(rawObj.errorDetails.message), false) === "input_error" ? "INPUT_ERROR" : "RUNTIME_ERROR" : "SYNTAX_ERROR",
      lineNumber: ln,
      lineCode: String(rawObj.errorDetails.lineCode || codeLines[ln - 1] || "").trim(),
      messageBn: String(rawObj.errorDetails.messageBn || rawObj.errorDetails.message),
      solutionBn: String(rawObj.errorDetails.solutionBn || ""),
      line: ln,
      message: String(rawObj.errorDetails.message)
    };
  }
  const analyzedComplexity = analyzeCodeComplexity(code, fallbackLang, effectiveSteps);
  const rawTime = String(rawObj.logicSummary?.complexity?.time || "").trim();
  const rawSpace = String(rawObj.logicSummary?.complexity?.space || "").trim();
  const hasSortCall = /\b(?:Arrays|Collections)\.sort\s*\(|\bsorted\s*\(|\bstd::sort\s*\(|\.sort\s*\(/.test(
    code
  );
  const timeComp = !rawTime || !/^O\(/i.test(rawTime) || analyzedComplexity.time === "O(1)" && !hasSortCall && rawTime !== "O(1)" || analyzedComplexity.time !== "O(1)" && rawTime === "O(1)" ? analyzedComplexity.time : rawTime;
  const spaceComp = !rawSpace || !/^O\(/i.test(rawSpace) || analyzedComplexity.space !== "O(1)" && rawSpace === "O(1)" ? analyzedComplexity.space : rawSpace;
  const rawComplexityNote = String(rawObj.logicSummary?.complexity?.note || "").trim();
  const complexityNote = !rawComplexityNote || timeComp !== rawTime || spaceComp !== rawSpace ? explainLanguage === "bn" ? analyzedComplexity.noteBn : analyzedComplexity.noteEn : rawComplexityNote;
  const rawMistakes = Array.isArray(rawObj.logicSummary?.commonMistakes) ? rawObj.logicSummary.commonMistakes.map(String).map((m) => m.trim()).filter(Boolean) : [];
  const dynamicPitfalls = generateLanguagePitfalls(code, fallbackLang, explainLanguage);
  const mergedMistakes = [...rawMistakes];
  for (const pitfall of dynamicPitfalls) {
    if (mergedMistakes.length >= 3) break;
    if (!mergedMistakes.some((m) => m.toLowerCase() === pitfall.toLowerCase())) {
      mergedMistakes.push(pitfall);
    }
  }
  const commonMistakes = mergedMistakes.length > 0 ? mergedMistakes.slice(0, 4) : dynamicPitfalls;
  const finalOut = String(rawObj.finalOutput ?? runningStdout ?? "");
  const resolvedErrorCategory = isCompileFailure ? "compile_error" : isRuntimeFailure ? classifyErrorCategory(normalizedErrorDetails?.message || rawObj.verdict?.message || "", false) : null;
  return {
    ...rawObj,
    hasError: hasErr,
    errorCategory: resolvedErrorCategory,
    stdinUsed: stdin || null,
    stdinTokens: stdinQueue,
    isValidLogic: Boolean(rawObj.isValidLogic ?? verdictStatus === "ok"),
    errorDetails: normalizedErrorDetails,
    language: fallbackLang,
    analogyType: topAnalogy,
    traceSource: "ai_predicted",
    logicSummary: {
      title: String(rawObj.logicSummary?.title || "Code Analysis"),
      goal: String(rawObj.logicSummary?.goal || ""),
      idea: String(rawObj.logicSummary?.idea || ""),
      keyPoints: Array.isArray(rawObj.logicSummary?.keyPoints) ? rawObj.logicSummary.keyPoints.map(String) : [],
      analogyStory: String(rawObj.logicSummary?.analogyStory || ""),
      complexity: {
        time: timeComp,
        space: spaceComp,
        note: complexityNote
      },
      commonMistakes
    },
    lineNotes: finalLineNotes,
    steps: effectiveSteps,
    finalOutput: isCompileFailure ? "" : finalOut,
    outputExplanation: String(rawObj.outputExplanation ?? ""),
    verdict: {
      status: verdictStatus,
      message: String(rawObj.verdict?.message || "")
    },
    programSummary: isCompileFailure || !keepStepsOnError && hasErr ? null : {
      totalExecutionSteps: steps.length,
      timeComplexity: timeComp,
      spaceComplexity: spaceComp,
      finalOutput: finalOut
    }
  };
}
function formatResult(trace, cached, diagnostics = []) {
  const isCompileError = trace.verdict.status === "compile_error" || Boolean(trace.hasError) && trace.steps.length === 0 && trace.errorCategory === "compile_error";
  const isRuntimeError = trace.verdict.status === "runtime_error" || trace.verdict.status === "infinite_loop";
  const hasError = Boolean(trace.hasError || isCompileError || isRuntimeError);
  const allDiagnostics = [...diagnostics];
  if (hasError && trace.errorDetails) {
    const errLine = trace.errorDetails.lineNumber || trace.errorDetails.line || 1;
    if (!allDiagnostics.some((d) => d.severity === "error" && d.line === errLine)) {
      allDiagnostics.unshift({
        line: errLine,
        severity: "error",
        message: trace.errorDetails.message
      });
    }
  }
  const hasCompileDiagnostics = isCompileError || allDiagnostics.some(
    (d) => d.severity === "error" && (!isRuntimeError || d.source !== "runtime")
  );
  const hasErrors = hasError || allDiagnostics.some((d) => d.severity === "error");
  const hasWarnings = allDiagnostics.some((d) => d.severity === "warning");
  const status = hasErrors ? "error" : hasWarnings ? "warning" : "success";
  const hasPlayableRuntimeTrace = isRuntimeError && !hasCompileDiagnostics && Array.isArray(trace.steps) && trace.steps.length > 0;
  const canRun = !hasErrors || hasPlayableRuntimeTrace;
  const output = hasError ? trace.finalOutput ? `${trace.finalOutput}
${trace.errorDetails?.message || trace.verdict.message || "Execution failed."}` : trace.errorDetails?.message || trace.verdict.message || "Execution failed." : trace.finalOutput || "";
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
    programSummary: canRun ? trace.programSummary ?? null : null,
    steps: canRun ? trace.steps : [],
    trace,
    cached,
    apiNotice: null
  };
}
async function generateExecutionTrace(params) {
  const prep = preprocessCode(params.code, params.language);
  const codeToRun = prep.code;
  const initialDiagnostics = [...prep.diagnostics];
  const toolchainAnalysis = await analyzeCode(codeToRun, params.language, params.fileName);
  const adjustedToolchainDiagnostics = remapDiagnosticsToOriginal(
    toolchainAnalysis.diagnostics,
    prep
  );
  if (!toolchainAnalysis.canCompile) {
    const firstErr = adjustedToolchainDiagnostics.find((d) => d.severity === "error");
    const errLine = firstErr?.line || 1;
    const errTrace = buildFallbackTrace({ ...params, code: params.code });
    errTrace.hasError = true;
    errTrace.verdict.status = "compile_error";
    errTrace.verdict.message = firstErr?.message || "Compilation error.";
    errTrace.errorDetails = {
      errorType: "COMPILATION_ERROR",
      lineNumber: errLine,
      line: errLine,
      message: firstErr?.message || "Compilation failed.",
      messageBn: params.explainLanguage === "bn" ? `\u0995\u09AE\u09CD\u09AA\u09BE\u0987\u09B2 \u09A4\u09CD\u09B0\u09C1\u099F\u09BF (\u09B2\u09BE\u0987\u09A8 ${errLine}): ${firstErr?.message}` : void 0
    };
    return formatResult(errTrace, false, [
      ...initialDiagnostics,
      ...adjustedToolchainDiagnostics
    ]);
  }
  const syntaxErr = detectSyntaxError(
    codeToRun,
    params.explainLanguage,
    params.language,
    params.fileName
  );
  if (syntaxErr && syntaxErr.errorType === "FILE_NAME_MISMATCH") {
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
    if (cachedEntry && !cachedEntry.trace.hasError && cachedEntry.trace.verdict.status !== "compile_error") {
      return formatResult(cachedEntry.trace, true, initialDiagnostics);
    }
  }
  const realExec = await executeCode(
    codeToRun,
    params.language,
    params.stdin || "",
    3500,
    params.fileName
  );
  const sandboxResult = runDeterministicMultiLanguage(
    codeToRun,
    params.language,
    params.stdin || "",
    1200
  );
  const deterministicTrace = buildFallbackTrace({ ...params, code: codeToRun });
  deterministicTrace.stdinUsed = params.stdin || null;
  deterministicTrace.stdinTokens = tokenizeStdin(params.stdin || "");
  const cleanedStdout = (typeof realExec.stdout === "string" ? realExec.stdout : sandboxResult.stdout || "").replace(/\r?\n$/, "");
  deterministicTrace.finalOutput = cleanedStdout;
  const adjustedRuntimeErrorLine = realExec.runtimeErrorLine ? remapPreprocessedLine(realExec.runtimeErrorLine, prep) : void 0;
  if (realExec.runtimeError) {
    const errCat = classifyErrorCategory(realExec.runtimeError, false);
    deterministicTrace.hasError = true;
    deterministicTrace.errorCategory = errCat;
    deterministicTrace.isValidLogic = false;
    deterministicTrace.verdict.status = realExec.timedOut ? "infinite_loop" : "runtime_error";
    deterministicTrace.verdict.message = realExec.runtimeError;
    deterministicTrace.errorDetails = {
      errorType: errCat === "input_error" ? "INPUT_ERROR" : "RUNTIME_ERROR",
      lineNumber: adjustedRuntimeErrorLine || 1,
      line: adjustedRuntimeErrorLine || 1,
      message: realExec.runtimeError,
      messageBn: errCat === "input_error" ? `\u0987\u09A8\u09AA\u09C1\u099F (STDIN) \u0985\u09A8\u09C1\u09AA\u09B8\u09CD\u09A5\u09BF\u09A4 \u09AC\u09BE \u0985\u09AA\u09B0\u09CD\u09AF\u09BE\u09AA\u09CD\u09A4 \u09A5\u09BE\u0995\u09BE\u09AF\u09BC \u09B2\u09BE\u0987\u09A8 ${adjustedRuntimeErrorLine || 1}-\u098F \u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u099F\u09BF \u09A5\u09C7\u09AE\u09C7 \u0997\u09C7\u099B\u09C7: ${realExec.runtimeError}` : `\u09B2\u09BE\u0987\u09A8 ${adjustedRuntimeErrorLine || 1}-\u098F \u09B0\u09BE\u09A8\u099F\u09BE\u0987\u09AE \u09A4\u09CD\u09B0\u09C1\u099F\u09BF \u09B9\u09AF\u09BC\u09C7\u099B\u09C7: ${realExec.runtimeError}`,
      solutionBn: errCat === "input_error" ? '\u09A8\u09BF\u099A\u09C7\u09B0 "\u0987\u09A8\u09AA\u09C1\u099F (STDIN)" \u099F\u09CD\u09AF\u09BE\u09AC\u09C7 \u09AA\u09CD\u09B0\u09DF\u09CB\u099C\u09A8\u09C0\u09DF \u0987\u09A8\u09AA\u09C1\u099F \u09AE\u09BE\u09A8\u0997\u09C1\u09B2\u09CB \u09A6\u09BF\u09DF\u09C7 \u0986\u09AC\u09BE\u09B0 "\u09AC\u09CD\u09AF\u09BE\u0996\u09CD\u09AF\u09BE \u0993 \u0985\u09CD\u09AF\u09BE\u09A8\u09BF\u09AE\u09C7\u099F" \u099A\u09BE\u09AA\u09C1\u09A8\u0964' : "\u09A4\u09CD\u09B0\u09C1\u099F\u09BF\u09AF\u09C1\u0995\u09CD\u09A4 \u09B2\u09BE\u0987\u09A8\u099F\u09BF \u09AA\u09B0\u09C0\u0995\u09CD\u09B7\u09BE \u0995\u09B0\u09C1\u09A8 (\u09AF\u09C7\u09AE\u09A8: \u09B6\u09C2\u09A8\u09CD\u09AF \u09A6\u09BF\u09DF\u09C7 \u09AD\u09BE\u0997, \u0987\u09A8\u09A1\u09C7\u0995\u09CD\u09B8 \u09B8\u09C0\u09AE\u09BE \u09AC\u09BE \u09A8\u09BE\u09B2 \u09AE\u09BE\u09A8)\u0964"
    };
  } else {
    deterministicTrace.hasError = false;
    deterministicTrace.errorCategory = null;
    deterministicTrace.isValidLogic = true;
    deterministicTrace.errorDetails = null;
    deterministicTrace.verdict.status = "ok";
    deterministicTrace.verdict.message = "Program compiled and executed successfully.";
    deterministicTrace.outputExplanation = params.explainLanguage === "bn" ? `\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE\u099F\u09BF \u09B8\u09AB\u09B2\u09AD\u09BE\u09AC\u09C7 \u09B8\u09AE\u09CD\u09AA\u09A8\u09CD\u09A8 \u09B9\u09DF\u09C7\u099B\u09C7 \u098F\u09AC\u0982 \u0986\u0989\u099F\u09AA\u09C1\u099F \u09A4\u09C8\u09B0\u09BF \u0995\u09B0\u09C7\u099B\u09C7\u0964` : `Program compiled and executed successfully.`;
    deterministicTrace.traceSource = "real_execution";
  }
  if (deterministicTrace.steps.length === 0 && sandboxResult.recordedSteps.length > 0) {
    let runOut = "";
    deterministicTrace.steps = sandboxResult.recordedSteps.map((st, idx) => {
      if (st.consoleOutput) {
        runOut = runOut ? `${runOut}
${st.consoleOutput}` : st.consoleOutput;
      }
      return {
        stepIndex: idx + 1,
        step: idx + 1,
        activeLine: st.line,
        lineNumber: st.line,
        codeSnippet: st.codeSnippet,
        action: st.actionType === "DECLARE" ? "declare" : "assign",
        actionType: st.actionType,
        analogyType: "generic_memory",
        from: null,
        to: st.memoryDelta?.variable || null,
        explanation: st.consoleOutput ? `Output: ${st.consoleOutput}` : `Executing line ${st.line}: ${st.codeSnippet}`,
        why: "",
        stdout: st.consoleOutput,
        consoleOutput: st.consoleOutput,
        cumulativeOutput: runOut || null,
        changes: st.memoryDelta ? [{ name: st.memoryDelta.variable || "", from: st.memoryDelta.oldValue, to: st.memoryDelta.newValue }] : [],
        variables: st.variables || {},
        memoryState: st.variables || {},
        memoryDelta: st.memoryDelta || { variable: null, oldValue: null, newValue: null },
        fault: null,
        structure: null,
        whatHappenedBn: st.consoleOutput ? `\u0986\u0989\u099F\u09AA\u09C1\u099F: ${st.consoleOutput}` : `\u09B2\u09BE\u0987\u09A8 ${st.line} \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09B9\u09DF\u09C7\u099B\u09C7\u0964`,
        banglaExplanation: st.consoleOutput ? `\u0986\u0989\u099F\u09AA\u09C1\u099F \u09B8\u09CD\u0995\u09CD\u09B0\u09BF\u09A8\u09C7 "${st.consoleOutput}" \u09AA\u09CD\u09B0\u09BF\u09A8\u09CD\u099F \u09B9\u09DF\u09C7\u099B\u09C7\u0964` : `\u09B2\u09BE\u0987\u09A8 ${st.line} (${st.codeSnippet}) \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09B9\u09DF\u09C7\u099B\u09C7\u0964`,
        logicBuildingBn: ""
      };
    });
  } else if (deterministicTrace.steps.length === 0 && (realExec.status === "success" || Boolean(realExec.runtimeError))) {
    const codeLines = codeToRun.split("\n");
    const stopLine = realExec.runtimeError && realExec.runtimeErrorLine ? realExec.runtimeErrorLine : codeLines.length;
    const execLines = [];
    for (let i = 0; i < Math.min(codeLines.length, stopLine); i++) {
      const t = codeLines[i].trim();
      if (t && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*") && !t.startsWith("import ") && !t.startsWith("#include") && !t.startsWith("package ")) {
        execLines.push({ line: i + 1, text: t });
      }
    }
    const sampleSteps = execLines.slice(0, 30);
    deterministicTrace.steps = sampleSteps.map((el, idx) => {
      const isErrStep = Boolean(realExec.runtimeError) && el.line === stopLine;
      const isLastSuccessStep = !realExec.runtimeError && idx === sampleSteps.length - 1;
      return {
        stepIndex: idx + 1,
        step: idx + 1,
        activeLine: el.line,
        lineNumber: el.line,
        codeSnippet: el.text,
        action: "assign",
        actionType: isLastSuccessStep && cleanedStdout ? "OUTPUT" : "ASSIGN",
        animationAction: isErrStep ? "runtime_error" : "assign",
        analogyType: "generic_memory",
        from: null,
        to: null,
        explanation: isErrStep ? realExec.runtimeError || "Runtime error occurred" : isLastSuccessStep && cleanedStdout ? `Program Output: ${cleanedStdout.split("\n")[0]}` : `Line ${el.line}: ${el.text}`,
        why: isErrStep ? deterministicTrace.errorDetails?.solutionBn || "" : "",
        stdout: isLastSuccessStep ? cleanedStdout : null,
        consoleOutput: isLastSuccessStep ? cleanedStdout : null,
        cumulativeOutput: isLastSuccessStep ? cleanedStdout || null : null,
        changes: [],
        variables: {},
        memoryState: {},
        memoryDelta: { variable: null, oldValue: null, newValue: null },
        fault: isErrStep ? {
          type: "runtime_exception",
          message: realExec.runtimeError || "Runtime exception",
          fixHint: deterministicTrace.errorDetails?.solutionBn || ""
        } : null,
        structure: null,
        whatHappenedBn: isErrStep ? deterministicTrace.errorDetails?.messageBn || realExec.runtimeError || "" : isLastSuccessStep && cleanedStdout ? `\u09AA\u09CD\u09B0\u09CB\u0997\u09CD\u09B0\u09BE\u09AE \u0986\u0989\u099F\u09AA\u09C1\u099F: ${cleanedStdout.split("\n")[0]}` : `\u09B2\u09BE\u0987\u09A8 ${el.line}: ${el.text}`,
        banglaExplanation: isErrStep ? deterministicTrace.errorDetails?.messageBn || realExec.runtimeError || "" : `\u09B2\u09BE\u0987\u09A8 ${el.line} \u0995\u09BE\u09B0\u09CD\u09AF\u0995\u09B0 \u09B9\u09DF\u09C7\u099B\u09C7: \`${el.text}\``,
        logicBuildingBn: ""
      };
    });
  }
  if (prep.injectedPrefixLines > 0) {
    deterministicTrace.steps = deterministicTrace.steps.filter((st) => st.activeLine > prep.injectedPrefixLines).map((st, idx) => ({
      ...st,
      stepIndex: idx + 1,
      step: idx + 1,
      activeLine: st.activeLine - prep.injectedPrefixLines,
      lineNumber: st.lineNumber ? Math.max(1, st.lineNumber - prep.injectedPrefixLines) : void 0
    }));
    deterministicTrace.lineNotes = deterministicTrace.lineNotes.filter((ln) => ln.line > prep.injectedPrefixLines).map((ln) => ({
      ...ln,
      line: ln.line - prep.injectedPrefixLines
    }));
  }
  if (deterministicTrace.verdict?.status !== "compile_error") {
    const detComplexity = analyzeCodeComplexity(params.code, params.language, deterministicTrace.steps);
    deterministicTrace.logicSummary.complexity = {
      time: detComplexity.time,
      space: detComplexity.space,
      note: params.explainLanguage === "bn" ? detComplexity.noteBn : detComplexity.noteEn
    };
    if (deterministicTrace.programSummary) {
      deterministicTrace.programSummary.timeComplexity = detComplexity.time;
      deterministicTrace.programSummary.spaceComplexity = detComplexity.space;
    }
    const detPitfalls = generateLanguagePitfalls(params.code, params.language, params.explainLanguage);
    if (detPitfalls.length > 0) {
      deterministicTrace.logicSummary.commonMistakes = detPitfalls;
    }
    if (deterministicTrace.steps.length > 0) {
      const detExecLines = new Set(deterministicTrace.steps.map((s) => s.activeLine));
      const detBlocks = analyzeBlockExecution(params.code, params.language, detExecLines);
      const userLines = params.code.split("\n");
      const noteMap = new Map(deterministicTrace.lineNotes.map((n) => [n.line, n]));
      deterministicTrace.lineNotes = userLines.map((raw, idx) => {
        const t = raw.trim();
        if (!t) return null;
        const ln = idx + 1;
        const existing = noteMap.get(ln);
        const braceInfo = detBlocks.braceByCloseLine.get(ln);
        const pythonEndInfo = detBlocks.pythonEndsByLine.get(ln);
        const isClosingBrace = t === "}" || t === "};";
        if (existing && !isClosingBrace && detExecLines.has(ln)) {
          if (params.language === "python" && pythonEndInfo?.wasBlockExecuted && !/ইন্ডেন্টেশন|ব্লক.*শেষ|block/i.test(existing.text)) {
            return {
              ...existing,
              text: params.explainLanguage === "bn" ? `${existing.text} (\u098F\u0987 \u09B2\u09BE\u0987\u09A8\u09C7\u09B0 \u09AA\u09B0 \`${pythonEndInfo.kind}\` \u09AC\u09CD\u09B2\u0995\u09C7\u09B0 \u0987\u09A8\u09CD\u09A1\u09C7\u09A8\u09CD\u099F\u09C7\u09B6\u09A8 \u09B6\u09C7\u09B7 \u09B9\u09DF)` : `${existing.text} (Ends the Python \`${pythonEndInfo.kind}\` block)`
            };
          }
          return existing;
        }
        const aware = buildExecutionAwareLineNote({
          lineNumber: ln,
          trimmed: t,
          language: params.language,
          explainLanguage: params.explainLanguage,
          executedLines: detExecLines,
          braceInfo,
          pythonEndInfo
        });
        return {
          line: ln,
          role: existing?.role || inferLineRole(t),
          text: aware.text,
          why: aware.why
        };
      }).filter((n) => n !== null);
    }
  }
  const taggedRuntimeDiagnostics = realExec.diagnostics.map((d) => ({
    ...d,
    line: prep.injectedPrefixLines > 0 && d.line ? Math.max(1, d.line - prep.injectedPrefixLines) : d.line,
    ...realExec.runtimeError && d.severity === "error" ? { source: d.source || "runtime" } : {}
  }));
  const combinedDiagnostics = [
    ...adjustedToolchainDiagnostics,
    ...taggedRuntimeDiagnostics,
    ...initialDiagnostics
  ];
  if (deterministicTrace.verdict.status === "compile_error") {
    deterministicTrace.errorCategory = "compile_error";
    return formatResult(deterministicTrace, false, combinedDiagnostics);
  }
  if (!isGeminiKeyConfigured()) {
    if (!deterministicTrace.hasError) {
      traceCache.set(hash, { trace: deterministicTrace, createdAt: Date.now() });
    }
    return formatResult(deterministicTrace, false, combinedDiagnostics);
  }
  const rawStepsForPreview = sandboxResult.recordedSteps && sandboxResult.recordedSteps.length > 0 ? sandboxResult.recordedSteps.slice(0, 55).map((st, i) => {
    const userLine = prep.injectedPrefixLines > 0 ? Math.max(1, st.line - prep.injectedPrefixLines) : st.line;
    const condMeta = st.meta?.conditionExpr ? `, cond=${JSON.stringify(st.meta.conditionExpr)} -> ${String(Boolean(st.meta.conditionResult))}` : "";
    const stdinMeta = st.meta?.stdinRead !== void 0 ? `, stdinRead=${JSON.stringify(st.meta.stdinRead)}` : "";
    return `  Step ${i + 1}: Line ${userLine} [${st.actionType}] (${st.codeSnippet}) -> memoryState=${JSON.stringify(
      st.variables
    )}, delta=${JSON.stringify(st.memoryDelta)}${condMeta}${stdinMeta}${st.consoleOutput ? `, consoleOutput=${JSON.stringify(st.consoleOutput)}` : ""}`;
  }) : deterministicTrace.steps.slice(0, 55).map(
    (st, i) => `  Step ${i + 1}: Line ${st.activeLine} [${st.actionType || st.action}] (${st.codeSnippet || ""}) -> memoryState=${JSON.stringify(
      st.variables
    )}`
  );
  const stepPreview = rawStepsForPreview.join("\n");
  const groundTruthContext = [
    `- Real Compiler Status: Succeeded without errors`,
    `- Real Runtime Exit Code: ${realExec.exitCode}`,
    `- Real Runtime Execution Timed Out: ${realExec.timedOut}`,
    `- Real Runtime Error: ${realExec.runtimeError || "None"}`,
    adjustedRuntimeErrorLine ? `- Real Runtime Error Line: ${adjustedRuntimeErrorLine}` : "",
    `- Real Runtime Final Stdout: ${JSON.stringify(cleanedStdout)}`,
    `- Real Runtime Final Variables: ${JSON.stringify(sandboxResult.finalVariables)}`,
    stepPreview ? `- Real Runtime Recorded Step Sequence (DO NOT SKIP STEPS):
${stepPreview}` : ""
  ].filter(Boolean).join("\n");
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
  });
  const DEPRECATED_MODEL_PREFIXES = ["gemini-2.0-", "gemini-1.5-", "gemini-1.0-"];
  const configuredModel = process.env.GEMINI_MODEL?.trim();
  const isDeprecated = configuredModel && DEPRECATED_MODEL_PREFIXES.some((prefix) => configuredModel.startsWith(prefix));
  const primaryModel = !configuredModel || isDeprecated ? "gemini-3.8-flash" : configuredModel;
  const rawCandidateModels = [
    primaryModel,
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
  ].filter((v, i, a) => a.indexOf(v) === i);
  const nowMs = Date.now();
  const candidateModels = rawCandidateModels.filter((m) => (modelCooldownUntil.get(m) ?? 0) <= nowMs);
  const baseUserPrompt = buildUserTracePrompt({
    ...params,
    groundTruthContext: groundTruthContext || void 0
  });
  let lastValidationError = "";
  let abortAllModels = false;
  const overallDeadline = Date.now() + 45e3;
  for (const modelName of candidateModels) {
    if (abortAllModels || Date.now() >= overallDeadline) break;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const remainingMs = overallDeadline - Date.now();
      if (remainingMs < 1500) break;
      try {
        const promptText = attempt === 1 ? baseUserPrompt : lastValidationError && !/429|503|UNAVAILABLE|RESOURCE_EXHAUSTED|timeout/i.test(lastValidationError) ? `${baseUserPrompt}

VALIDATION ERROR ON PREVIOUS ATTEMPT:
${lastValidationError}
Fix the JSON so it strictly passes validation.` : baseUserPrompt;
        const response = await ai.models.generateContent({
          model: modelName,
          contents: promptText,
          config: {
            systemInstruction: GEMINI_TRACE_SYSTEM_PROMPT,
            responseMimeType: "application/json",
            responseSchema: TRACE_RESPONSE_SCHEMA,
            temperature: 0.2,
            abortSignal: AbortSignal.timeout(Math.min(24e3, remainingMs))
          }
        });
        const rawText = (response.text ?? "{}").trim();
        const parsedJson = JSON.parse(rawText);
        const normalized = normalizeGeminiRawOutput(
          parsedJson,
          params.language,
          params.code,
          params.stdin || "",
          params.explainLanguage
        );
        if (cleanedStdout !== "") {
          normalized.finalOutput = cleanedStdout;
        }
        if (realExec.runtimeError && !normalized.hasError) {
          const errCat = classifyErrorCategory(realExec.runtimeError, false);
          normalized.hasError = true;
          normalized.errorCategory = errCat;
          normalized.verdict = {
            status: realExec.timedOut ? "infinite_loop" : "runtime_error",
            message: realExec.runtimeError
          };
          normalized.errorDetails = deterministicTrace.errorDetails;
        }
        if (normalized.programSummary) {
          normalized.programSummary.totalExecutionSteps = Array.isArray(normalized.steps) ? normalized.steps.length : 0;
          normalized.programSummary.finalOutput = normalized.finalOutput;
        }
        if (normalized.verdict?.status !== "compile_error" && (!Array.isArray(normalized.steps) || normalized.steps.length === 0)) {
          lastValidationError = "Generated trace had 0 steps for compilable code.";
          continue;
        }
        const validated = ExecutionTraceSchema.safeParse(normalized);
        if (validated.success) {
          const finalTrace = validated.data;
          if (!finalTrace.hasError) {
            traceCache.set(hash, { trace: finalTrace, createdAt: Date.now() });
          }
          return formatResult(finalTrace, false, combinedDiagnostics);
        }
        lastValidationError = validated.error.message;
      } catch (err) {
        lastValidationError = String(err?.message || err);
        console.warn(`[geminiTraceService] Model ${modelName} attempt ${attempt} failed:`, lastValidationError);
        const isDailyQuotaExhausted = lastValidationError.includes("GenerateRequestsPerDay") || lastValidationError.includes("FreeTier");
        const isNotFound = lastValidationError.includes("404") || lastValidationError.includes("NOT_FOUND");
        const isTransient = !isDailyQuotaExhausted && (lastValidationError.includes("429") || lastValidationError.includes("503") || lastValidationError.includes("RESOURCE_EXHAUSTED") || lastValidationError.includes("UNAVAILABLE") || /timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(lastValidationError));
        if (lastValidationError.includes("403") || lastValidationError.includes("PERMISSION_DENIED") || lastValidationError.includes("API_KEY_INVALID")) {
          abortAllModels = true;
          break;
        }
        if (isDailyQuotaExhausted || isNotFound) {
          const cooldownMs = isNotFound ? 60 * 60 * 1e3 : 15 * 60 * 1e3;
          modelCooldownUntil.set(modelName, Date.now() + cooldownMs);
          break;
        }
        if (isTransient && attempt < 3) {
          const backoffMs = Math.min(
            remainingMs - 1500,
            450 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 150)
          );
          if (backoffMs > 100) {
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
        }
        if (lastValidationError.includes("429") || lastValidationError.includes("RESOURCE_EXHAUSTED")) {
          const retryMatch = lastValidationError.match(/"retryDelay"\s*:\s*"(\d+)s"/);
          const parsedDelayMs = retryMatch ? Math.min(60 * 60 * 1e3, Number(retryMatch[1]) * 1e3) : 5 * 60 * 1e3;
          modelCooldownUntil.set(modelName, Date.now() + Math.max(60 * 1e3, parsedDelayMs));
        } else if (lastValidationError.includes("503") || lastValidationError.includes("UNAVAILABLE")) {
          modelCooldownUntil.set(modelName, Date.now() + 60 * 1e3);
        }
        break;
      }
    }
  }
  if (!deterministicTrace.hasError && deterministicTrace.steps.length > 0) {
    traceCache.set(hash, { trace: deterministicTrace, createdAt: Date.now() });
  }
  const fallbackResult = formatResult(deterministicTrace, false, combinedDiagnostics);
  fallbackResult.apiNotice = null;
  return fallbackResult;
}

// server/src/middleware/rateLimitAndSecurity.ts
var ipBuckets = /* @__PURE__ */ new Map();
var userBuckets = /* @__PURE__ */ new Map();
function securityHeadersMiddleware(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
}
function traceRateLimiter(req, res, next) {
  const now = Date.now();
  const windowMs = 6e4;
  const userId = req.headers["x-user-uid"];
  if (userId) {
    const limit2 = 120;
    const bucket2 = userBuckets.get(userId);
    if (!bucket2 || now > bucket2.resetAt) {
      userBuckets.set(userId, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket2.count >= limit2) {
      return res.status(429).json({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message_bn: "\u0986\u09AA\u09A8\u09BF \u09AA\u09CD\u09B0\u09A4\u09BF \u09AE\u09BF\u09A8\u09BF\u099F\u09C7 \u0985\u09A8\u09C1\u09B0\u09CB\u09A7\u09C7\u09B0 \u09B8\u09C0\u09AE\u09BE \u0985\u09A4\u09BF\u0995\u09CD\u09B0\u09AE \u0995\u09B0\u09C7\u099B\u09C7\u09A8\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0995\u09BF\u099B\u09C1\u0995\u09CD\u09B7\u09A3 \u0985\u09AA\u09C7\u0995\u09CD\u09B7\u09BE \u0995\u09B0\u09C1\u09A8\u0964",
          message_en: "Rate limit exceeded (120 requests/min per user). Please wait a moment."
        }
      });
    }
    bucket2.count += 1;
    return next();
  }
  const ip = (req.ip || req.socket.remoteAddress || "anon").toString();
  const limit = 120;
  const bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    ipBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (bucket.count >= limit) {
    return res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message_bn: "\u09AA\u09CD\u09B0\u09A4\u09BF \u09AE\u09BF\u09A8\u09BF\u099F\u09C7 \u0985\u09A8\u09C1\u09B0\u09CB\u09A7\u09C7\u09B0 \u09B8\u09C0\u09AE\u09BE \u0985\u09A4\u09BF\u0995\u09CD\u09B0\u09AE \u0995\u09B0\u09C7\u099B\u09C7\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u098F\u0995\u099F\u09C1 \u09AA\u09B0 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964",
        message_en: "Rate limit exceeded (120 requests/min per IP). Please try again shortly."
      }
    });
  }
  bucket.count += 1;
  next();
}
function centralErrorHandler(err, _req, res, _next) {
  const status = typeof err?.status === "number" ? err.status : 500;
  res.status(status).json({
    error: {
      code: err?.code || "INTERNAL_SERVER_ERROR",
      message_bn: err?.message_bn || "\u09B8\u09BE\u09B0\u09CD\u09AD\u09BE\u09B0\u09C7 \u098F\u0995\u099F\u09BF \u0985\u09AA\u09CD\u09B0\u09A4\u09CD\u09AF\u09BE\u09B6\u09BF\u09A4 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964",
      message_en: err?.message_en || err?.message || "An unexpected server error occurred. Please try again."
    }
  });
}

// server/src/services/interactiveRunner.ts
import fs6 from "node:fs/promises";
import path6 from "node:path";
import crypto3 from "node:crypto";
import { spawn as spawn2 } from "node:child_process";
import { StringDecoder as StringDecoder2 } from "node:string_decoder";
var sessions = /* @__PURE__ */ new Map();
var MAX_ACTIVE_SESSIONS = 16;
var MAX_OUTPUT_BYTES = 128 * 1024;
var STEP_TIMEOUT_MS = 12e3;
var IDLE_TIMEOUT_MS = 12e4;
var INITIAL_PROMPT_SETTLE_MS = 450;
var PROMPT_SETTLE_MS = 120;
var UNBUF_C_CODE = `
#include <stdio.h>
__attribute__((constructor))
static void _logiclab_unbuf(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
}
`.trim();
var JAVA_RUNNER_CODE = `
import java.io.*;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

public class _LogicLabRunner {
    public static void main(String[] args) throws Exception {
        PrintStream unbufOut = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8") {
            @Override
            public void write(int b) {
                super.write(b);
                flush();
            }
            @Override
            public void write(byte[] buf, int off, int len) {
                super.write(buf, off, len);
                flush();
            }
        };
        System.setOut(unbufOut);
        System.setErr(new PrintStream(new FileOutputStream(FileDescriptor.err), true, "UTF-8"));
        if (args.length == 0) return;
        String targetClass = args[0];
        Class<?> cls = Class.forName(targetClass);
        Method m = cls.getMethod("main", String[].class);
        String[] forwarded = new String[Math.max(0, args.length - 1)];
        if (forwarded.length > 0) {
            System.arraycopy(args, 1, forwarded, 0, forwarded.length);
        }
        try {
            m.invoke(null, (Object) forwarded);
        } catch (InvocationTargetException ex) {
            Throwable cause = ex.getCause() != null ? ex.getCause() : ex;
            cause.printStackTrace(System.err);
            System.exit(1);
        }
    }
}
`.trim();
function stripCommentsForInputDetection(code, language) {
  if (language === "python") {
    return code.replace(/#.*$/gm, "");
  }
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
function isWholeStreamEofOnly(code, language) {
  const clean = stripCommentsForInputDetection(code, language);
  if (language === "javascript") {
    const usesWholeStream = /\bfs\.(?:readFileSync|readSync)\s*\(\s*(?:0|['"]\/dev\/stdin['"])/.test(clean);
    const usesLinePrompt = /\b(?:prompt|readline)\s*\(/.test(clean);
    return usesWholeStream && !usesLinePrompt;
  }
  if (language === "python") {
    const usesWholeStream = /\bsys\.stdin\.(?:read|readlines)\s*\(/.test(clean);
    const usesLinePrompt = /\binput\s*\(/.test(clean);
    return usesWholeStream && !usesLinePrompt;
  }
  return false;
}
function hasInputPattern(code, language) {
  const clean = stripCommentsForInputDetection(code, language);
  switch (language) {
    case "python":
      return /\binput\s*\(|sys\.stdin/.test(clean);
    case "cpp":
      return /\b(?:cin|scanf|fscanf|sscanf|getchar|getc|fgetc|gets|fgets|getline)\b/.test(clean);
    case "java":
      return /\b(?:Scanner|BufferedReader|Console|System\.in)\b/.test(clean);
    case "javascript":
    default:
      return /\b(?:prompt|readline|process\.stdin|readFileSync|readSync)\b/.test(clean);
  }
}
function emitSessionEvent(session, ev) {
  session.eventLog.push(ev);
  for (const listener of session.listeners) {
    try {
      listener(ev);
    } catch {
    }
  }
}
function clearSessionTimers(session) {
  if (session.promptTimer) {
    clearTimeout(session.promptTimer);
    session.promptTimer = null;
  }
  if (session.stepTimeoutTimer) {
    clearTimeout(session.stepTimeoutTimer);
    session.stepTimeoutTimer = null;
  }
  if (session.idleTimeoutTimer) {
    clearTimeout(session.idleTimeoutTimer);
    session.idleTimeoutTimer = null;
  }
}
function schedulePromptCheck(session, delayMs = PROMPT_SETTLE_MS) {
  if (!session.isInteractive || session.exited) return;
  if (session.promptTimer) {
    clearTimeout(session.promptTimer);
  }
  session.promptTimer = setTimeout(() => {
    session.promptTimer = null;
    if (session.exited || session.waitingForInput) return;
    session.waitingForInput = true;
    if (session.stepTimeoutTimer) {
      clearTimeout(session.stepTimeoutTimer);
      session.stepTimeoutTimer = null;
    }
    if (session.idleTimeoutTimer) {
      clearTimeout(session.idleTimeoutTimer);
    }
    session.idleTimeoutTimer = setTimeout(() => {
      session.timedOut = true;
      if (session.child) killProcessTree(session.child);
    }, IDLE_TIMEOUT_MS);
    emitSessionEvent(session, { type: "prompt", data: {} });
  }, delayMs);
}
function startStepTimer(session) {
  if (session.stepTimeoutTimer) {
    clearTimeout(session.stepTimeoutTimer);
  }
  session.stepTimeoutTimer = setTimeout(() => {
    session.timedOut = true;
    if (session.child) killProcessTree(session.child);
  }, STEP_TIMEOUT_MS);
}
async function runRemoteBatchExecution(session) {
  const stdinStr = session.stdinAll;
  const remote = await executeViaRemoteSandbox(
    session.language,
    session.code,
    stdinStr,
    5e3,
    session.fileName
  );
  if (!remote) {
    session.exited = true;
    const msg = "Local compiler is unavailable and remote sandbox is unreachable.";
    session.stderrAll = msg;
    emitSessionEvent(session, { type: "stderr", data: { text: msg } });
    emitSessionEvent(session, {
      type: "exit",
      data: {
        exitCode: 1,
        timedOut: false,
        executionTimeMs: Math.max(1, Date.now() - session.startedAt),
        success: false,
        errorCategory: "runtime_error",
        executionBackend: "remote",
        interactiveSupported: false,
        stdout: session.stdoutAll,
        stderr: msg,
        stdinUsed: stdinStr,
        diagnostics: session.diagnostics
      }
    });
    return;
  }
  if (remote.compileFailed) {
    session.exited = true;
    const compileText = remote.compileOutput || remote.stderr || "Compilation failed.";
    session.stderrAll = compileText;
    emitSessionEvent(session, { type: "stderr", data: { text: compileText } });
    emitSessionEvent(session, {
      type: "exit",
      data: {
        exitCode: remote.exitCode ?? 1,
        timedOut: false,
        executionTimeMs: remote.executionTimeMs,
        success: false,
        errorCategory: "compile_error",
        executionBackend: "remote",
        interactiveSupported: false,
        stdout: "",
        stderr: compileText,
        stdinUsed: stdinStr,
        diagnostics: session.diagnostics
      }
    });
    return;
  }
  if (remote.stdout) {
    session.stdoutAll = remote.stdout;
    emitSessionEvent(session, { type: "stdout", data: { text: remote.stdout } });
  }
  session.exited = true;
  if (remote.stderr) {
    session.stderrAll = remote.stderr;
    emitSessionEvent(session, { type: "stderr", data: { text: remote.stderr } });
  }
  const success = !remote.timedOut && remote.exitCode === 0;
  const errorCategory = success ? null : classifyErrorCategory(remote.stderr || remote.runtimeError || (remote.timedOut ? "timed out" : ""), false);
  emitSessionEvent(session, {
    type: "exit",
    data: {
      exitCode: remote.exitCode ?? (success ? 0 : 1),
      timedOut: remote.timedOut,
      executionTimeMs: remote.executionTimeMs,
      success,
      errorCategory,
      executionBackend: "remote",
      interactiveSupported: false,
      stdout: session.stdoutAll,
      stderr: session.stderrAll || remote.runtimeError || "",
      stdinUsed: stdinStr,
      diagnostics: session.diagnostics
    }
  });
}
function createRemoteBatchSession(rawCode, language, fileName, diagnostics, initialStdin = "") {
  const sessionId = `exec-${Date.now()}-${crypto3.randomBytes(4).toString("hex")}`;
  const session = {
    id: sessionId,
    language,
    code: rawCode,
    fileName,
    workspaceDir: "",
    child: null,
    isRemoteReplay: true,
    collectedInputs: [],
    isInteractive: false,
    startedAt: Date.now(),
    stdoutAll: "",
    stderrAll: "",
    stdinAll: initialStdin,
    exited: false,
    exitCode: null,
    timedOut: false,
    waitingForInput: false,
    diagnostics,
    eventLog: [],
    listeners: /* @__PURE__ */ new Set(),
    promptTimer: null,
    stepTimeoutTimer: null,
    idleTimeoutTimer: null
  };
  sessions.set(sessionId, session);
  void runRemoteBatchExecution(session);
  return {
    ok: true,
    sessionId,
    diagnostics,
    isInteractive: false,
    executionBackend: "remote",
    interactiveSupported: false
  };
}
async function startInteractiveSession(rawCode, language, fileName, initialStdin = "", stdinMode = "auto") {
  for (const [id, existing] of sessions.entries()) {
    if (existing.exited && Date.now() - existing.startedAt > 5e3) {
      sessions.delete(id);
    }
  }
  const activeCount = [...sessions.values()].filter((s) => !s.exited).length;
  if (activeCount >= MAX_ACTIVE_SESSIONS) {
    const busyMsg = "Too many active execution sessions. Please wait for an existing session to complete.";
    return { ok: false, diagnostics: [], stderr: busyMsg, runtimeError: busyMsg };
  }
  const prep = preprocessCode(rawCode, language);
  const code = prep.code;
  const detectedInput = hasInputPattern(code, language);
  const wholeStreamEofOnly = isWholeStreamEofOnly(code, language);
  const hasPreSuppliedStdin = initialStdin.length > 0;
  const isInteractive = stdinMode === "interactive" ? detectedInput && !wholeStreamEofOnly : stdinMode === "batch" ? false : detectedInput && !hasPreSuppliedStdin && !wholeStreamEofOnly;
  let workspaceDir = "";
  let cmd = "";
  let args = [];
  let extraEnv = {};
  let diagnostics = [...prep.diagnostics];
  try {
    if (language === "cpp") {
      workspaceDir = await createSandboxWorkspace();
      const isC = Boolean(fileName && fileName.toLowerCase().endsWith(".c"));
      const sourceFileName = sanitizeSourceFileName(
        fileName,
        isC ? "main.c" : "main.cpp",
        [".cpp", ".cc", ".cxx", ".c"]
      );
      const binaryFileName = process.platform === "win32" ? "program.exe" : "program.out";
      const binaryPath = path6.join(workspaceDir, binaryFileName);
      await fs6.writeFile(path6.join(workspaceDir, sourceFileName), code, "utf8");
      await fs6.writeFile(path6.join(workspaceDir, "_unbuf.c"), UNBUF_C_CODE, "utf8");
      const gppPath = await resolveExecutable("g++");
      if (!gppPath) {
        await cleanupSandboxWorkspace(workspaceDir);
        if (process.env.REMOTE_SANDBOX_FALLBACK !== "false") {
          return createRemoteBatchSession(rawCode, language, fileName, prep.diagnostics, initialStdin);
        }
        const cfgErr = "C++ compiler (g++) not found. Ensure g++ is installed and in PATH, or set GPP_PATH.";
        return { ok: false, diagnostics: [], stderr: cfgErr, runtimeError: cfgErr, errorCategory: "compile_error" };
      }
      const compileArgs = isC ? ["-std=c11", "-Wall", "-Wextra", "-O0", sourceFileName, "_unbuf.c", "-o", binaryFileName] : ["-std=c++17", "-Wall", "-Wextra", "-O0", sourceFileName, "_unbuf.c", "-o", binaryFileName];
      const compileRes = await runSandboxedProcess({
        cmd: gppPath,
        args: compileArgs,
        cwd: workspaceDir,
        timeoutMs: 15e3
      });
      const cppDiags = remapDiagnosticsToOriginal(
        parseGppDiagnostics(compileRes.stderr, compileRes.stdout),
        prep
      );
      diagnostics = [...cppDiags, ...prep.diagnostics];
      const hasErrors = compileRes.exitCode !== 0 || cppDiags.some((d) => d.severity === "error");
      if (hasErrors) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = cppDiags.find((d) => d.severity === "error");
        const errMsg = compileRes.stderr.trim() || firstErr?.message || "C/C++ compilation failed.";
        if (isLocalExecutionBlockedError(errMsg) && process.env.REMOTE_SANDBOX_FALLBACK !== "false") {
          return createRemoteBatchSession(rawCode, language, fileName, prep.diagnostics, initialStdin);
        }
        return {
          ok: false,
          diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
          errorCategory: "compile_error",
          executionBackend: "local",
          interactiveSupported: true
        };
      }
      cmd = binaryPath;
      args = [];
    } else if (language === "java") {
      const compileRes = await compileJava(code, fileName || "Main.java");
      workspaceDir = compileRes.workspaceDir;
      const mappedJavaDiags = remapDiagnosticsToOriginal(compileRes.diagnostics, prep);
      diagnostics = [...mappedJavaDiags, ...prep.diagnostics];
      if (!compileRes.success) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = mappedJavaDiags.find((d) => d.severity === "error");
        const errMsg = compileRes.compilerError || compileRes.stderr.trim() || firstErr?.message || "Java compilation failed.";
        if ((compileRes.compilerUnavailable || isLocalExecutionBlockedError(errMsg)) && process.env.REMOTE_SANDBOX_FALLBACK !== "false") {
          return createRemoteBatchSession(
            rawCode,
            language,
            compileRes.sourceFileName || fileName,
            prep.diagnostics,
            initialStdin
          );
        }
        return {
          ok: false,
          diagnostics: compileRes.compilerUnavailable ? [] : diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
          errorCategory: "compile_error",
          executionBackend: "local",
          interactiveSupported: true
        };
      }
      const javacPath = await resolveExecutable("javac");
      const javaPath = await resolveExecutable("java");
      if (!javaPath) {
        await cleanupSandboxWorkspace(workspaceDir);
        if (process.env.REMOTE_SANDBOX_FALLBACK !== "false") {
          return createRemoteBatchSession(
            rawCode,
            language,
            compileRes.sourceFileName || fileName,
            prep.diagnostics,
            initialStdin
          );
        }
        const cfgErr = "Java runtime (java) not found. Ensure a JDK/JRE is installed and 'java' is in PATH, or set JAVA_HOME / JAVA_PATH.";
        return { ok: false, diagnostics: [], stderr: cfgErr, runtimeError: cfgErr, errorCategory: "compile_error" };
      }
      const mainClass = compileRes.mainClass || "Main";
      await fs6.writeFile(path6.join(workspaceDir, "_LogicLabRunner.java"), JAVA_RUNNER_CODE, "utf8");
      const runnerCompile = javacPath ? await runSandboxedProcess({
        cmd: javacPath,
        args: ["-encoding", "UTF-8", "_LogicLabRunner.java"],
        cwd: workspaceDir,
        timeoutMs: 12e3
      }) : { exitCode: 1 };
      const javaUtf8Flags = [
        "-Dfile.encoding=UTF-8",
        "-Dstdout.encoding=UTF-8",
        "-Dstderr.encoding=UTF-8",
        "-Dstdin.encoding=UTF-8",
        "-Dsun.stdout.encoding=UTF-8",
        "-Dsun.stderr.encoding=UTF-8"
      ];
      cmd = javaPath;
      args = runnerCompile.exitCode === 0 ? [...javaUtf8Flags, "-cp", workspaceDir, "_LogicLabRunner", mainClass] : [...javaUtf8Flags, "-cp", workspaceDir, mainClass];
    } else if (language === "python") {
      const syntaxRes = await checkPythonSyntax(code, fileName || "script.py");
      workspaceDir = syntaxRes.workspaceDir;
      diagnostics = [...syntaxRes.diagnostics, ...prep.diagnostics];
      if (!syntaxRes.success) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = syntaxRes.diagnostics.find((d) => d.severity === "error");
        const errMsg = syntaxRes.compilerError || firstErr?.message || syntaxRes.stderr.trim() || "Python syntax error.";
        if ((syntaxRes.compilerUnavailable || isLocalExecutionBlockedError(errMsg)) && process.env.REMOTE_SANDBOX_FALLBACK !== "false") {
          return createRemoteBatchSession(rawCode, language, fileName, prep.diagnostics, initialStdin);
        }
        return {
          ok: false,
          diagnostics: syntaxRes.compilerUnavailable ? [] : diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
          errorCategory: "compile_error",
          executionBackend: "local",
          interactiveSupported: true
        };
      }
      const sourceFileName = sanitizeSourceFileName(fileName, "script.py", [".py"]);
      cmd = await resolveExecutable("python") || "python";
      args = ["-u", sourceFileName];
      extraEnv = { PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };
    } else {
      const syntaxRes = await checkJsSyntax(code, fileName || "script.js");
      workspaceDir = syntaxRes.workspaceDir;
      diagnostics = [...syntaxRes.diagnostics, ...prep.diagnostics];
      if (!syntaxRes.success) {
        await cleanupSandboxWorkspace(workspaceDir);
        const firstErr = syntaxRes.diagnostics.find((d) => d.severity === "error");
        const errMsg = firstErr?.message || syntaxRes.stderr.trim() || "JavaScript syntax error.";
        return {
          ok: false,
          diagnostics,
          stderr: errMsg,
          runtimeError: errMsg,
          errorCategory: "compile_error",
          executionBackend: "local",
          interactiveSupported: true
        };
      }
      const sourceFileName = sanitizeSourceFileName(fileName, "script.js", [".js", ".mjs", ".cjs"]);
      await fs6.writeFile(path6.join(workspaceDir, "_preload.cjs"), NODE_PRELOAD_CJS, "utf8");
      cmd = await resolveExecutable("node") || process.execPath;
      args = ["--require", "./_preload.cjs", sourceFileName];
    }
    const sessionId = `exec-${Date.now()}-${crypto3.randomBytes(4).toString("hex")}`;
    const child = spawn2(cmd, args, {
      cwd: workspaceDir,
      env: { ...getSanitizedEnv(), ...extraEnv },
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"]
    });
    const session = {
      id: sessionId,
      language,
      code: rawCode,
      fileName,
      workspaceDir,
      child,
      isInteractive,
      startedAt: Date.now(),
      stdoutAll: "",
      stderrAll: "",
      stdinAll: initialStdin,
      exited: false,
      exitCode: null,
      timedOut: false,
      waitingForInput: false,
      diagnostics,
      eventLog: [],
      listeners: /* @__PURE__ */ new Set(),
      promptTimer: null,
      stepTimeoutTimer: null,
      idleTimeoutTimer: null
    };
    child.stdin?.on("error", () => {
    });
    if (initialStdin && child.stdin) {
      const normalized = initialStdin.replace(/\r\n/g, "\n");
      try {
        child.stdin.write(normalized.endsWith("\n") ? normalized : `${normalized}
`, "utf8");
      } catch {
      }
    }
    if (!isInteractive && child.stdin) {
      child.stdin.end();
    }
    const stdoutDecoder = new StringDecoder2("utf8");
    const stderrDecoder = new StringDecoder2("utf8");
    sessions.set(sessionId, session);
    startStepTimer(session);
    if (isInteractive) {
      schedulePromptCheck(session, INITIAL_PROMPT_SETTLE_MS);
    }
    child.stdout?.on("data", (chunk) => {
      const text = stdoutDecoder.write(chunk);
      if (!text) return;
      if (session.stdoutAll.length < MAX_OUTPUT_BYTES) {
        session.stdoutAll += text;
      }
      session.waitingForInput = false;
      emitSessionEvent(session, { type: "stdout", data: { text } });
      if (session.isInteractive) {
        schedulePromptCheck(session, PROMPT_SETTLE_MS);
      }
    });
    child.stderr?.on("data", (chunk) => {
      const text = sanitizeWorkspacePaths(stderrDecoder.write(chunk), session.workspaceDir);
      if (!text) return;
      if (session.stderrAll.length < MAX_OUTPUT_BYTES) {
        session.stderrAll += text;
      }
      emitSessionEvent(session, { type: "stderr", data: { text } });
    });
    child.on("error", (err) => {
      const msg = `Failed to start process: ${err.message}`;
      if (isLocalExecutionBlockedError(msg) && process.env.REMOTE_SANDBOX_FALLBACK !== "false") {
        session.isRemoteReplay = true;
        session.isInteractive = false;
        session.child = null;
        session.collectedInputs = [];
        clearSessionTimers(session);
        void cleanupSandboxWorkspace(session.workspaceDir);
        void runRemoteBatchExecution(session);
        return;
      }
      session.stderrAll += msg;
      emitSessionEvent(session, { type: "stderr", data: { text: msg } });
    });
    child.on("close", (exitCode, signal) => {
      if (session.exited || session.isRemoteReplay) return;
      const tailOut = stdoutDecoder.end();
      if (tailOut) {
        if (session.stdoutAll.length < MAX_OUTPUT_BYTES) session.stdoutAll += tailOut;
        emitSessionEvent(session, { type: "stdout", data: { text: tailOut } });
      }
      const tailErr = sanitizeWorkspacePaths(stderrDecoder.end(), session.workspaceDir);
      if (tailErr) {
        if (session.stderrAll.length < MAX_OUTPUT_BYTES) session.stderrAll += tailErr;
        emitSessionEvent(session, { type: "stderr", data: { text: tailErr } });
      }
      session.exited = true;
      session.exitCode = exitCode;
      session.waitingForInput = false;
      clearSessionTimers(session);
      const executionTimeMs = Math.max(1, Date.now() - session.startedAt);
      const success = !session.timedOut && exitCode === 0 && !signal;
      const errorCategory = success ? null : classifyErrorCategory(
        session.stderrAll || (session.timedOut ? "timed out" : signal || ""),
        false
      );
      emitSessionEvent(session, {
        type: "exit",
        data: {
          exitCode,
          signal,
          timedOut: session.timedOut,
          executionTimeMs,
          success,
          errorCategory,
          executionBackend: "local",
          interactiveSupported: true,
          stdout: session.stdoutAll,
          stderr: session.stderrAll,
          stdinUsed: session.stdinAll,
          diagnostics: session.diagnostics
        }
      });
      void cleanupSandboxWorkspace(session.workspaceDir);
      const cleanupTimer = setTimeout(() => {
        sessions.delete(sessionId);
      }, 3e4);
      cleanupTimer.unref?.();
    });
    return {
      ok: true,
      sessionId,
      diagnostics,
      isInteractive,
      executionBackend: "local",
      interactiveSupported: true
    };
  } catch (err) {
    if (workspaceDir) {
      await cleanupSandboxWorkspace(workspaceDir);
    }
    const msg = err?.message || "Execution failed to start.";
    if (isLocalExecutionBlockedError(msg) && process.env.REMOTE_SANDBOX_FALLBACK !== "false") {
      return createRemoteBatchSession(rawCode, language, fileName, prep.diagnostics, initialStdin);
    }
    return {
      ok: false,
      diagnostics,
      stderr: msg,
      runtimeError: msg,
      errorCategory: "compile_error"
    };
  }
}
function subscribeToSession(sessionId, listener) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  for (const ev of session.eventLog) {
    listener(ev);
  }
  if (session.exited) {
    return () => {
    };
  }
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}
function sendSessionInput(sessionId, inputLine, eof = false) {
  const session = sessions.get(sessionId);
  if (!session || session.exited || session.isRemoteReplay || !session.isInteractive) {
    return false;
  }
  if (!session.child || !session.child.stdin) {
    return false;
  }
  if (session.idleTimeoutTimer) {
    clearTimeout(session.idleTimeoutTimer);
    session.idleTimeoutTimer = null;
  }
  if (session.promptTimer) {
    clearTimeout(session.promptTimer);
    session.promptTimer = null;
  }
  session.waitingForInput = false;
  startStepTimer(session);
  if (eof) {
    try {
      session.child.stdin.end();
    } catch {
      return false;
    }
    return true;
  }
  const line = `${inputLine}
`;
  session.stdinAll += line;
  try {
    session.child.stdin.write(line, "utf8");
  } catch {
    return false;
  }
  if (session.isInteractive) {
    schedulePromptCheck(session, PROMPT_SETTLE_MS);
  }
  return true;
}
function stopInteractiveSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  clearSessionTimers(session);
  if (!session.exited && session.child) {
    killProcessTree(session.child);
  }
  void cleanupSandboxWorkspace(session.workspaceDir);
  sessions.delete(sessionId);
  return true;
}

// server/src/routes/apiRoutes.ts
var apiRouter = Router();
var SUPPORTED_LANGUAGES = ["javascript", "python", "cpp", "java"];
var LANGUAGE_ALLOWED_EXTS = {
  java: [".java"],
  javascript: [".js", ".mjs", ".cjs"],
  cpp: [".cpp", ".cc", ".cxx", ".c"],
  python: [".py"]
};
var MAX_EXEC_CODE_CHARS = 2e5;
var MAX_STDIN_CHARS = 2e5;
function isInvalidExecutionRequest(result) {
  return !result.ok;
}
function validateExecutionPayload(body, opts = {}) {
  const rawLang = body?.language;
  let language = "javascript";
  if (rawLang !== void 0) {
    if (typeof rawLang !== "string" || !SUPPORTED_LANGUAGES.includes(rawLang)) {
      return {
        ok: false,
        code: "UNSUPPORTED_LANGUAGE",
        message: `Unsupported language "${String(rawLang)}". Supported languages: java, javascript, cpp, python.`
      };
    }
    language = rawLang;
  }
  if (body?.code !== void 0 && typeof body.code !== "string") {
    return { ok: false, code: "INVALID_CODE", message: "Source code must be a string." };
  }
  const code = typeof body?.code === "string" ? body.code : "";
  const maxCodeChars = opts.maxCodeChars ?? MAX_EXEC_CODE_CHARS;
  if (!opts.allowEmptyCode && !code.trim()) {
    return {
      ok: false,
      code: "EMPTY_CODE",
      message: "Please provide non-empty code to execute."
    };
  }
  if (code.length > maxCodeChars) {
    return {
      ok: false,
      code: "CODE_TOO_LONG",
      message: `Source code exceeds maximum allowed size (${maxCodeChars} characters).`
    };
  }
  if (body?.stdin !== void 0 && body?.stdin !== null && typeof body.stdin !== "string") {
    return { ok: false, code: "INVALID_STDIN", message: "STDIN input must be a string." };
  }
  const stdin = typeof body?.stdin === "string" ? body.stdin : "";
  if (stdin.length > MAX_STDIN_CHARS) {
    return {
      ok: false,
      code: "STDIN_TOO_LONG",
      message: `STDIN input exceeds maximum allowed size (${MAX_STDIN_CHARS} characters).`
    };
  }
  let validatedFileName;
  if (body?.fileName !== void 0 && body?.fileName !== null) {
    if (typeof body.fileName !== "string") {
      return { ok: false, code: "INVALID_FILENAME", message: "fileName must be a string." };
    }
    const fnCheck = validateSourceFileName(body.fileName, LANGUAGE_ALLOWED_EXTS[language]);
    if (!fnCheck.valid) {
      return {
        ok: false,
        code: "INVALID_FILENAME",
        message: fnCheck.error || "Invalid filename for selected language."
      };
    }
    validatedFileName = fnCheck.sanitized;
  }
  return {
    ok: true,
    code,
    language,
    fileName: validatedFileName,
    stdin
  };
}
var TraceRequestSchema = z2.object({
  code: z2.string().min(1, "Code cannot be empty"),
  language: z2.enum(["javascript", "python", "cpp", "java"]).default("javascript"),
  explainLanguage: z2.enum(["bn", "en"]).default("bn"),
  depth: z2.enum(["simple", "detailed"]).default("simple"),
  fileName: z2.string().optional(),
  stdin: z2.string().optional().default(""),
  bypassCache: z2.boolean().optional().default(false)
});
var snippetsByUid = /* @__PURE__ */ new Map();
var historyByUid = /* @__PURE__ */ new Map();
var executionsByUid = /* @__PURE__ */ new Map();
var progressByUid = /* @__PURE__ */ new Map();
var settingsByUid = /* @__PURE__ */ new Map();
var userAccountsByUid = /* @__PURE__ */ new Map();
var sharesById = /* @__PURE__ */ new Map();
var PERSIST_FILE_PATH = path7.join(os2.tmpdir(), "logic-lab-auth-store.json");
var IS_TEST_RUNNER = Boolean(process.env.NODE_TEST_CONTEXT || process.argv.some((a) => a.includes("test")));
function loadPersistedAuthStore() {
  if (IS_TEST_RUNNER) return;
  try {
    if (!fs7.existsSync(PERSIST_FILE_PATH)) return;
    const raw = fs7.readFileSync(PERSIST_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (parsed.users && typeof parsed.users === "object") {
        for (const [k, v] of Object.entries(parsed.users)) {
          userAccountsByUid.set(k, v);
        }
      }
      if (parsed.history && typeof parsed.history === "object") {
        for (const [k, v] of Object.entries(parsed.history)) {
          if (Array.isArray(v)) historyByUid.set(k, v);
        }
      }
      if (parsed.executions && typeof parsed.executions === "object") {
        for (const [k, v] of Object.entries(parsed.executions)) {
          if (Array.isArray(v)) executionsByUid.set(k, v);
        }
      }
      if (parsed.snippets && typeof parsed.snippets === "object") {
        for (const [k, v] of Object.entries(parsed.snippets)) {
          if (Array.isArray(v)) snippetsByUid.set(k, v);
        }
      }
    }
  } catch {
  }
}
function savePersistedAuthStore() {
  if (IS_TEST_RUNNER) return;
  try {
    const serializeAuthenticated = (m) => {
      const out = {};
      for (const [k, v] of m.entries()) {
        if (k !== "guest-local" && !k.startsWith("user-")) {
          out[k] = v;
        }
      }
      return out;
    };
    const payload = {
      users: Object.fromEntries(userAccountsByUid.entries()),
      history: serializeAuthenticated(historyByUid),
      executions: serializeAuthenticated(executionsByUid),
      snippets: serializeAuthenticated(snippetsByUid)
    };
    fs7.writeFileSync(PERSIST_FILE_PATH, JSON.stringify(payload), "utf8");
  } catch {
  }
}
loadPersistedAuthStore();
async function verifyFirebaseIdToken(idToken) {
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (apiKey && !apiKey.startsWith("YOUR_")) {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken })
        }
      );
      if (res.ok) {
        const data = await res.json();
        const user = data?.users?.[0];
        if (user?.localId) {
          return {
            uid: String(user.localId),
            email: String(user.email || ""),
            displayName: String(user.displayName || user.email?.split("@")[0] || "Logic Lab User"),
            photoURL: String(user.photoUrl || "")
          };
        }
      }
    } catch {
    }
  }
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const uid = payload.user_id || payload.sub;
    if (!uid || typeof uid !== "string") return null;
    return {
      uid,
      email: String(payload.email || ""),
      displayName: String(payload.name || payload.email?.split("@")[0] || "Logic Lab User"),
      photoURL: String(payload.picture || "")
    };
  } catch {
    return null;
  }
}
sharesById.set("demo-swap", {
  shareId: "demo-swap",
  authorUid: "demo-instructor",
  authorName: "Logic Lab Instructor",
  title_bn: SAMPLE_PROGRAMS[0].title_bn,
  title_en: SAMPLE_PROGRAMS[0].title_en,
  language: "javascript",
  code: SAMPLE_PROGRAMS[0].codes.javascript,
  stdin: "",
  trace: SAMPLE_PROGRAMS[0].traces.bn.simple,
  createdAt: (/* @__PURE__ */ new Date()).toISOString()
});
function resolveUid(req) {
  const headerUid = req.headers["x-user-uid"];
  if (typeof headerUid === "string" && headerUid.trim()) {
    return headerUid.trim().slice(0, 128);
  }
  return "guest-local";
}
apiRouter.get("/health", async (_req, res) => {
  const availability = await getToolchainAvailability();
  res.json({
    status: "ok",
    service: "logic-lab-api",
    geminiConfigured: isGeminiKeyConfigured(),
    toolchains: {
      java: Boolean(availability.javac && availability.java),
      cpp: Boolean(availability["g++"]),
      python: Boolean(availability.python),
      javascript: Boolean(availability.node)
    },
    cacheSize: getCacheSize(),
    problemsCount: PROBLEM_LIBRARY.length,
    sharesCount: sharesById.size,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
apiRouter.post("/auth/session", async (req, res) => {
  const authHeader = req.headers.authorization;
  const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  let verifiedUser = null;
  if (bearerToken) {
    verifiedUser = await verifyFirebaseIdToken(bearerToken);
  }
  const uid = verifiedUser?.uid || resolveUid(req);
  if (!uid || uid === "guest-local") {
    return res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message_bn: "\u09AC\u09C8\u09A7 \u09B2\u0997\u0987\u09A8 \u09B8\u09C7\u09B6\u09A8 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
        message_en: "No valid authenticated session found."
      }
    });
  }
  const account = {
    uid,
    email: verifiedUser?.email || String(req.body?.email || "").slice(0, 200),
    displayName: verifiedUser?.displayName || String(req.body?.displayName || "Logic Lab User").slice(0, 120),
    photoURL: verifiedUser?.photoURL || String(req.body?.photoURL || "").slice(0, 500),
    lastLoginAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  userAccountsByUid.set(uid, account);
  savePersistedAuthStore();
  return res.json({
    authenticated: true,
    user: account,
    history: historyByUid.get(uid) || [],
    executions: executionsByUid.get(uid) || [],
    snippets: snippetsByUid.get(uid) || []
  });
});
apiRouter.get("/auth/session", async (req, res) => {
  const authHeader = req.headers.authorization;
  const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  let uid = resolveUid(req);
  if (bearerToken) {
    const verified = await verifyFirebaseIdToken(bearerToken);
    if (verified?.uid) uid = verified.uid;
  }
  if (!uid || uid === "guest-local") {
    return res.json({ authenticated: false, user: null });
  }
  const account = userAccountsByUid.get(uid) || null;
  return res.json({
    authenticated: Boolean(account),
    user: account
  });
});
apiRouter.post("/auth/logout", (_req, res) => {
  return res.json({ authenticated: false, ok: true });
});
apiRouter.post("/trace", traceRateLimiter, async (req, res) => {
  const rawCode = typeof req.body?.code === "string" ? req.body.code : "";
  const lineCount = rawCode.split("\n").length;
  if (rawCode.length > 6e3 || lineCount > 200) {
    return res.status(400).json({
      error: {
        code: "CODE_TOO_LONG",
        message_bn: "\u0995\u09CB\u09A1\u099F\u09BF \u0985\u09A8\u09C7\u0995 \u09AC\u09A1\u09BC (\u09B8\u09B0\u09CD\u09AC\u09CB\u099A\u09CD\u099A \u09E8\u09E6\u09E6 \u09B2\u09BE\u0987\u09A8 \u09AC\u09BE \u09EC,\u09E6\u09E6\u09E6 \u0985\u0995\u09CD\u09B7\u09B0 \u0985\u09A8\u09C1\u09AE\u09CB\u09A6\u09BF\u09A4)\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u099B\u09CB\u099F \u0985\u0982\u09B6 \u09AD\u09BF\u099C\u09CD\u09AF\u09C1\u09AF\u09BC\u09BE\u09B2\u09BE\u0987\u099C \u0995\u09B0\u09C1\u09A8\u0964",
        message_en: "Code exceeds maximum size limit (200 lines or 6,000 characters). Please paste a shorter snippet."
      }
    });
  }
  const parsed = TraceRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message_bn: "\u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u09AC\u09C8\u09A7 \u0995\u09CB\u09A1 \u098F\u09AC\u0982 \u09AD\u09BE\u09B7\u09BE \u09A8\u09BF\u09B0\u09CD\u09AC\u09BE\u099A\u09A8 \u0995\u09B0\u09C1\u09A8\u0964",
        message_en: "Invalid request parameters. Please provide non-empty code and a supported language."
      }
    });
  }
  if (parsed.data.fileName !== void 0) {
    const fnCheck = validateSourceFileName(
      parsed.data.fileName,
      LANGUAGE_ALLOWED_EXTS[parsed.data.language]
    );
    if (!fnCheck.valid) {
      return res.status(400).json({
        error: {
          code: "INVALID_FILENAME",
          message_bn: "\u0985\u09AC\u09C8\u09A7 \u09AB\u09BE\u0987\u09B2 \u09A8\u09BE\u09AE \u09AC\u09BE \u09AB\u09BE\u0987\u09B2 \u098F\u0995\u09CD\u09B8\u099F\u09C7\u09A8\u09B6\u09A8\u0964",
          message_en: fnCheck.error || "Invalid filename for selected language."
        }
      });
    }
    parsed.data.fileName = fnCheck.sanitized;
  }
  try {
    const result = await generateExecutionTrace(parsed.data);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: {
        code: "TRACE_GENERATION_FAILED",
        message_bn: "\u0995\u09CB\u09A1 \u09AC\u09BF\u09B6\u09CD\u09B2\u09C7\u09B7\u09A3 \u0995\u09B0\u09A4\u09C7 \u09B8\u09AE\u09B8\u09CD\u09AF\u09BE \u09B9\u09AF\u09BC\u09C7\u099B\u09C7\u0964 \u0985\u09A8\u09C1\u0997\u09CD\u09B0\u09B9 \u0995\u09B0\u09C7 \u0986\u09AC\u09BE\u09B0 \u099A\u09C7\u09B7\u09CD\u099F\u09BE \u0995\u09B0\u09C1\u09A8\u0964",
        message_en: err?.message || "Failed to generate execution trace."
      }
    });
  }
});
apiRouter.post("/cache/clear", (_req, res) => {
  clearTraceCache();
  res.json({
    status: "ok",
    message: "Runtime cache cleared successfully."
  });
});
apiRouter.post("/analyze", traceRateLimiter, async (req, res) => {
  const validation = validateExecutionPayload(req.body, { allowEmptyCode: true });
  if (isInvalidExecutionRequest(validation)) {
    return res.status(400).json({
      canCompile: false,
      diagnostics: [
        {
          line: 1,
          severity: "error",
          message: validation.message,
          source: typeof req.body?.language === "string" ? req.body.language : "validation"
        }
      ],
      error: {
        code: validation.code,
        message_en: validation.message
      },
      language: req.body?.language || "javascript"
    });
  }
  const { code, language, fileName } = validation;
  if (!code.trim()) {
    return res.json({ canCompile: true, diagnostics: [], language, fileName });
  }
  try {
    const analysis = await analyzeCode(code, language, fileName);
    return res.json({ ...analysis, fileName });
  } catch (err) {
    return res.status(500).json({
      canCompile: false,
      diagnostics: [
        {
          line: 1,
          severity: "error",
          message: err?.message || "Code analysis error",
          source: language
        }
      ],
      language,
      fileName
    });
  }
});
apiRouter.post("/execute", traceRateLimiter, async (req, res) => {
  const execStartedAt = Date.now();
  const validation = validateExecutionPayload(req.body, { allowEmptyCode: false });
  if (isInvalidExecutionRequest(validation)) {
    return res.status(400).json({
      success: false,
      stdout: "",
      stderr: validation.message,
      exitCode: 1,
      executionTimeMs: 0,
      error: {
        code: validation.code,
        message_bn: validation.code === "EMPTY_CODE" ? "\u099A\u09BE\u09B2\u09BE\u09A8\u09CB\u09B0 \u099C\u09A8\u09CD\u09AF \u0995\u09CB\u09A1 \u09B2\u09BF\u0996\u09C1\u09A8\u0964" : "\u0985\u09A8\u09C1\u09B0\u09CB\u09A7\u09C7\u09B0 \u09A4\u09A5\u09CD\u09AF \u09B8\u09A0\u09BF\u0995 \u09A8\u09AF\u09BC\u0964",
        message_en: validation.message
      }
    });
  }
  const { code, language, stdin, fileName } = validation;
  const prep = preprocessCode(code, language);
  const toolchainRes = await executeCode(prep.code, language, stdin, 4e3, fileName);
  const simResult = runDeterministicMultiLanguage(prep.code, language, stdin, 1200);
  for (const st of simResult.recordedSteps) {
    st.line = remapPreprocessedLine(st.line, prep);
  }
  const remappedToolchainDiagnostics = remapDiagnosticsToOriginal(
    toolchainRes.diagnostics,
    prep
  );
  const remappedRuntimeErrorLine = toolchainRes.runtimeErrorLine ? remapPreprocessedLine(toolchainRes.runtimeErrorLine, prep) : void 0;
  const combinedDiagnostics = [
    ...remappedToolchainDiagnostics,
    ...prep.diagnostics
  ];
  const hasErrors = toolchainRes.status === "error" || combinedDiagnostics.some((d) => d.severity === "error");
  const hasWarnings = combinedDiagnostics.some((d) => d.severity === "warning");
  const status = hasErrors ? "error" : hasWarnings ? "warning" : "success";
  const canRun = !hasErrors;
  const success = canRun && !toolchainRes.timedOut && toolchainRes.exitCode === 0;
  const stdout = typeof toolchainRes.stdout === "string" ? toolchainRes.stdout : "";
  const output = toolchainRes.output || stdout;
  const stderr = toolchainRes.stderr || toolchainRes.runtimeError || (!canRun ? output : "");
  const errorCategory = hasErrors ? toolchainRes.errorCategory || classifyErrorCategory(
    stderr || toolchainRes.runtimeError || "",
    remappedToolchainDiagnostics.some((d) => d.severity === "error")
  ) : null;
  const executionBackend = toolchainRes.executionBackend || "local";
  const executionTimeMs = Math.max(
    1,
    toolchainRes.executionTimeMs > 0 ? toolchainRes.executionTimeMs : Date.now() - execStartedAt
  );
  return res.json({
    ...simResult,
    success,
    status,
    canRun,
    output,
    stdout,
    stderr,
    exitCode: toolchainRes.exitCode,
    executionTimeMs,
    timedOut: toolchainRes.timedOut,
    runtimeError: toolchainRes.runtimeError,
    errorCategory,
    executionBackend,
    interactiveSupported: executionBackend === "local",
    ...remappedRuntimeErrorLine !== void 0 ? { runtimeErrorLine: remappedRuntimeErrorLine } : {},
    diagnostics: combinedDiagnostics,
    visualizerData: canRun ? simResult : null,
    traceSource: "real_execution",
    language,
    fileName
  });
});
apiRouter.post("/execute/start", traceRateLimiter, async (req, res) => {
  const validation = validateExecutionPayload(req.body, { allowEmptyCode: false });
  if (isInvalidExecutionRequest(validation)) {
    return res.status(400).json({
      ok: false,
      diagnostics: [],
      stderr: validation.message,
      runtimeError: validation.message,
      errorCategory: "compile_error",
      error: {
        code: validation.code,
        message_en: validation.message
      }
    });
  }
  const { code, language, fileName, stdin } = validation;
  const rawMode = req.body?.stdinMode;
  const stdinMode = rawMode === "batch" || rawMode === "interactive" ? rawMode : "auto";
  const result = await startInteractiveSession(code, language, fileName, stdin, stdinMode);
  if (!result.ok) {
    return res.status(200).json(result);
  }
  return res.json(result);
});
apiRouter.get("/execute/stream/:sessionId", (req, res) => {
  const sessionId = String(req.params.sessionId || "");
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const unsubscribe = subscribeToSession(sessionId, (ev) => {
    res.write(`event: ${ev.type}
`);
    res.write(`data: ${JSON.stringify(ev.data)}

`);
    if (ev.type === "exit") {
      res.end();
    }
  });
  if (!unsubscribe) {
    res.write(`event: exit
`);
    res.write(
      `data: ${JSON.stringify({
        exitCode: 1,
        timedOut: false,
        executionTimeMs: 0,
        success: false,
        stdout: "",
        stderr: "Execution session not found or expired."
      })}

`
    );
    res.end();
    return;
  }
  req.on("close", () => {
    unsubscribe();
  });
});
apiRouter.post("/execute/input", (req, res) => {
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
  const input = typeof req.body?.input === "string" ? req.body.input : "";
  const eof = Boolean(req.body?.eof);
  if (!sessionId) {
    return res.status(400).json({ ok: false, error: "Missing sessionId" });
  }
  const ok = sendSessionInput(sessionId, input, eof);
  return res.json({ ok });
});
apiRouter.post("/execute/stop", (req, res) => {
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
  if (!sessionId) {
    return res.status(400).json({ ok: false });
  }
  const ok = stopInteractiveSession(sessionId);
  return res.json({ ok });
});
apiRouter.get("/executions", (req, res) => {
  const uid = resolveUid(req);
  const list = executionsByUid.get(uid) || [];
  res.json({ executions: list });
});
apiRouter.post("/executions", (req, res) => {
  const uid = resolveUid(req);
  const list = executionsByUid.get(uid) || [];
  const rawLang = req.body?.language;
  const language = rawLang === "python" || rawLang === "cpp" || rawLang === "java" || rawLang === "javascript" ? rawLang : "javascript";
  const execution_mode = req.body?.execution_mode === "explain" ? "explain" : "fast";
  const record = {
    id: String(req.body?.id || `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`).slice(0, 120),
    userId: uid === "guest-local" ? null : uid,
    language,
    source_code: String(req.body?.source_code || "").slice(0, 2e4),
    stdin_input: String(req.body?.stdin_input || "").slice(0, 4e3),
    stdout_output: String(req.body?.stdout_output || "").slice(0, 2e4),
    stderr_output: req.body?.stderr_output ? String(req.body.stderr_output).slice(0, 1e4) : "",
    exit_code: typeof req.body?.exit_code === "number" ? req.body.exit_code : null,
    execution_mode,
    execution_time_ms: Math.max(0, Math.round(Number(req.body?.execution_time_ms) || 0)),
    success: Boolean(req.body?.success ?? true),
    file_name: req.body?.file_name ? String(req.body.file_name).slice(0, 140) : void 0,
    created_at: req.body?.created_at ? String(req.body.created_at) : (/* @__PURE__ */ new Date()).toISOString()
  };
  const next = [record, ...list.filter((item) => item.id !== record.id)].slice(0, 30);
  executionsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ execution: record, executions: next });
});
apiRouter.delete("/executions", (req, res) => {
  const uid = resolveUid(req);
  executionsByUid.set(uid, []);
  savePersistedAuthStore();
  res.json({ executions: [] });
});
apiRouter.delete("/executions/:id", (req, res) => {
  const uid = resolveUid(req);
  const list = executionsByUid.get(uid) || [];
  const next = list.filter((item) => item.id !== req.params.id);
  executionsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ executions: next });
});
apiRouter.get("/problems", (_req, res) => {
  res.json({
    problems: PROBLEM_LIBRARY
  });
});
apiRouter.get("/problems/:id", (req, res) => {
  const found = PROBLEM_LIBRARY.find((p) => p.id === req.params.id);
  if (!found) {
    return res.status(404).json({
      error: {
        code: "PROBLEM_NOT_FOUND",
        message_bn: "\u09AA\u09CD\u09B0\u09AC\u09B2\u09C7\u09AE\u099F\u09BF \u0996\u09C1\u0981\u099C\u09C7 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
        message_en: "Problem not found."
      }
    });
  }
  return res.json({ problem: found });
});
apiRouter.get("/snippets", (req, res) => {
  const uid = resolveUid(req);
  const list = snippetsByUid.get(uid) || [];
  res.json({ snippets: list });
});
apiRouter.post("/snippets", (req, res) => {
  const uid = resolveUid(req);
  const list = snippetsByUid.get(uid) || [];
  const item = {
    id: req.body?.id || `snip-${Date.now()}`,
    uid,
    title_bn: String(req.body?.title_bn || "\u09B8\u0982\u09B0\u0995\u09CD\u09B7\u09BF\u09A4 \u0995\u09CB\u09A1").slice(0, 160),
    title_en: String(req.body?.title_en || "Saved Snippet").slice(0, 160),
    language: req.body?.language || "javascript",
    code: String(req.body?.code || "").slice(0, 2e4),
    stdin: String(req.body?.stdin || "").slice(0, 2e3),
    analogyType: req.body?.analogyType || "generic_memory",
    isFavorite: Boolean(req.body?.isFavorite),
    problemId: req.body?.problemId,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const next = [item, ...list.filter((s) => s.id !== item.id)].slice(0, 50);
  snippetsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ snippet: item, snippets: next });
});
apiRouter.put("/snippets/:id", (req, res) => {
  const uid = resolveUid(req);
  const list = snippetsByUid.get(uid) || [];
  const next = list.map(
    (s) => s.id === req.params.id ? {
      ...s,
      ...req.body,
      id: s.id,
      uid,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    } : s
  );
  snippetsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ snippets: next });
});
apiRouter.delete("/snippets/:id", (req, res) => {
  const uid = resolveUid(req);
  const list = snippetsByUid.get(uid) || [];
  const next = list.filter((s) => s.id !== req.params.id);
  snippetsByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ snippets: next });
});
apiRouter.get("/history", (req, res) => {
  const uid = resolveUid(req);
  const list = historyByUid.get(uid) || [];
  res.json({ history: list });
});
apiRouter.post("/history", (req, res) => {
  const uid = resolveUid(req);
  const list = historyByUid.get(uid) || [];
  const entry = {
    id: req.body?.id || `run-${Date.now()}`,
    uid,
    fileName: req.body?.fileName ? String(req.body.fileName).slice(0, 140) : void 0,
    title_bn: String(req.body?.title_bn || "\u0995\u09CB\u09A1 \u09B0\u09BE\u09A8").slice(0, 160),
    title_en: String(req.body?.title_en || "Code Run").slice(0, 160),
    language: req.body?.language || "javascript",
    code: String(req.body?.code || "").slice(0, 2e4),
    analogyType: req.body?.analogyType || "generic_memory",
    verdictStatus: req.body?.verdictStatus || "correct",
    favorite: Boolean(req.body?.favorite),
    timestamp: req.body?.timestamp || "Just now"
  };
  const next = [entry, ...list.filter((h) => h.id !== entry.id)].slice(0, 30);
  historyByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ entry, history: next });
});
apiRouter.delete("/history", (req, res) => {
  const uid = resolveUid(req);
  historyByUid.set(uid, []);
  savePersistedAuthStore();
  res.json({ history: [] });
});
apiRouter.delete("/history/:id", (req, res) => {
  const uid = resolveUid(req);
  const list = historyByUid.get(uid) || [];
  const next = list.filter((h) => h.id !== req.params.id);
  historyByUid.set(uid, next);
  savePersistedAuthStore();
  res.json({ history: next });
});
apiRouter.get("/progress", (req, res) => {
  const uid = resolveUid(req);
  const progress = progressByUid.get(uid) || {
    uid,
    streak: 3,
    lastActiveDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    completedProblemIds: ["swap_correct", "swap_faulty", "bubble_sort", "infinite_loop"],
    badges: ["first_visualize", "bug_hunter", "swap_master"],
    topicsCovered: ["Variables & Memory", "Sorting", "Loops & Control Flow"]
  };
  res.json({ progress });
});
apiRouter.put("/progress", (req, res) => {
  const uid = resolveUid(req);
  const updated = {
    uid,
    streak: Number(req.body?.streak ?? 3),
    lastActiveDate: String(req.body?.lastActiveDate || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)),
    completedProblemIds: Array.isArray(req.body?.completedProblemIds) ? req.body.completedProblemIds : [],
    badges: Array.isArray(req.body?.badges) ? req.body.badges : [],
    topicsCovered: Array.isArray(req.body?.topicsCovered) ? req.body.topicsCovered : []
  };
  progressByUid.set(uid, updated);
  res.json({ progress: updated });
});
apiRouter.get("/settings", (req, res) => {
  const uid = resolveUid(req);
  res.json({ settings: settingsByUid.get(uid) || {} });
});
apiRouter.put("/settings", (req, res) => {
  const uid = resolveUid(req);
  const next = { ...settingsByUid.get(uid) || {}, ...req.body };
  settingsByUid.set(uid, next);
  res.json({ settings: next });
});
apiRouter.post("/share", (req, res) => {
  const uid = resolveUid(req);
  const shareId = req.body?.shareId || `ll-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;
  const share = {
    shareId,
    authorUid: uid,
    authorName: String(req.body?.authorName || "Logic Lab Student").slice(0, 120),
    title_bn: String(req.body?.title_bn || "\u09B6\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09BE \u09AD\u09BF\u099C\u09CD\u09AF\u09C1\u09AF\u09BC\u09BE\u09B2\u09BE\u0987\u099C\u09C7\u09B6\u09A8").slice(0, 160),
    title_en: String(req.body?.title_en || "Shared Visualization").slice(0, 160),
    language: req.body?.language || "javascript",
    code: String(req.body?.code || SAMPLE_PROGRAMS[0].codes.javascript).slice(0, 2e4),
    stdin: String(req.body?.stdin || "").slice(0, 2e3),
    trace: req.body?.trace || SAMPLE_PROGRAMS[0].traces.bn.simple,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  sharesById.set(shareId, share);
  res.json({ share });
});
apiRouter.get("/share/:id", (req, res) => {
  const share = sharesById.get(req.params.id);
  if (!share) {
    return res.status(404).json({
      error: {
        code: "SHARE_NOT_FOUND",
        message_bn: "\u09B6\u09C7\u09AF\u09BC\u09BE\u09B0 \u0995\u09B0\u09BE \u09B2\u09BF\u0982\u0995\u099F\u09BF \u0996\u09C1\u0981\u099C\u09C7 \u09AA\u09BE\u0993\u09AF\u09BC\u09BE \u09AF\u09BE\u09AF\u09BC\u09A8\u09BF\u0964",
        message_en: "Shared visualization link not found."
      }
    });
  }
  return res.json({ share });
});

// server/src/app.ts
function createCoreExpressApp() {
  const app2 = express();
  app2.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-user-uid, Cache-Control");
    res.setHeader("Access-Control-Expose-Headers", "*");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });
  app2.use(securityHeadersMiddleware);
  app2.use(express.json({ limit: "512kb" }));
  app2.use("/api", apiRouter);
  app2.use("/", apiRouter);
  return app2;
}
function attachCentralErrorHandler(app2) {
  app2.use(centralErrorHandler);
}

// server/src/vercel.ts
var app = createCoreExpressApp();
attachCentralErrorHandler(app);
var vercel_default = app;
export {
  vercel_default as default
};
