import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { AddressInfo } from 'node:net';

import { createCoreExpressApp } from '../../server/src/app';
import { centralErrorHandler } from '../../server/src/middleware/rateLimitAndSecurity';
import { executeCode, analyzeCode } from '../../server/src/services/toolchains/toolchainManager';
import {
  cleanupSandboxWorkspace,
  createSandboxWorkspace,
  sanitizeSourceFileName,
  validateSourceFileName,
} from '../../server/src/services/toolchains/sandbox';
import { startInteractiveSession, subscribeToSession } from '../../server/src/services/interactiveRunner';
import { preprocessCode, remapDiagnosticsToOriginal } from '../../server/src/services/codePreprocessor';
import { useLabStore } from '../store/useLabStore';

async function withApiServer(fn: (baseUrl: string) => Promise<void>) {
  const app = createCoreExpressApp();
  app.use(centralErrorHandler);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}

async function runInteractiveAndCollect(
  code: string,
  language: 'java' | 'javascript' | 'cpp' | 'python',
  fileName: string,
  stdin = ''
): Promise<{ stdout: string; stderr: string; exitCode: number | null; success: boolean }> {
  const started = await startInteractiveSession(code, language, fileName, stdin);
  if (!started.ok || !started.sessionId) {
    return {
      stdout: '',
      stderr: started.stderr || started.runtimeError || 'failed',
      exitCode: 1,
      success: false,
    };
  }
  return await new Promise((resolve) => {
    const unsub = subscribeToSession(started.sessionId!, (ev) => {
      if (ev.type === 'exit') {
        unsub?.();
        resolve({
          stdout: String(ev.data.stdout || ''),
          stderr: String(ev.data.stderr || ''),
          exitCode: ev.data.exitCode ?? null,
          success: Boolean(ev.data.success),
        });
      }
    });
  });
}

// =========================================================================
// 9.1 JAVA EXECUTION & COMPILER REGRESSION TESTS (10 CASES)
// =========================================================================
test('9.1 Java Execution Suite (custom names, packages, multi-class, errors, stdin, timeout)', async () => {
  // 1. Custom class matching .java filename
  const r1 = await executeCode(
    `public class StudentRecord {\n  public static void main(String[] args) {\n    System.out.println("STUDENT_OK");\n  }\n}`,
    'java',
    '',
    5000,
    'StudentRecord.java'
  );
  assert.equal(r1.status, 'success');
  assert.ok(r1.stdout.includes('STUDENT_OK'));

  // 2. Public class mismatch against actual filename produces real javac error
  const r2 = await executeCode(
    `public class DeclaredClass {\n  public static void main(String[] args) {\n    System.out.println("X");\n  }\n}`,
    'java',
    '',
    5000,
    'ActualFileName.java'
  );
  assert.equal(r2.status, 'error');
  assert.ok(
    r2.stderr.includes('ActualFileName.java') || r2.diagnostics.some((d) => d.message.includes('ActualFileName.java')),
    `Expected ActualFileName.java in javac error, got: ${r2.stderr}`
  );

  // 3. Multiple non-public classes in one file where second class has main
  const r3 = await executeCode(
    `class HelperNode {\n  int x = 7;\n}\nclass AppEntry {\n  public static void main(String[] args) {\n    System.out.println("NODE=" + new HelperNode().x);\n  }\n}`,
    'java',
    '',
    5000,
    'MultiClassTest.java'
  );
  assert.equal(r3.status, 'success');
  assert.ok(r3.stdout.includes('NODE=7'));

  // 4. Package declaration compiles and runs via FQCN cleanly
  const r4 = await executeCode(
    `package com.logiclab.math;\npublic class PackageDemo {\n  public static void main(String[] args) {\n    System.out.println("PKG_SUM=" + (19 + 23));\n  }\n}`,
    'java',
    '',
    5000,
    'PackageDemo.java'
  );
  assert.equal(r4.status, 'success', `Expected package run success, got stderr: ${r4.stderr}`);
  assert.ok(r4.stdout.includes('PKG_SUM=42'));

  // 5. Syntax error reports exact line
  const a5 = await analyzeCode(
    `public class Broken {\n  public static void main(String[] args) {\n    int x = 5\n  }\n}`,
    'java',
    'Broken.java'
  );
  assert.equal(a5.canCompile, false);
  assert.equal(a5.diagnostics[0]?.line, 3);

  // 6. Type error diagnostic
  const a6 = await analyzeCode(
    `public class TypeErr {\n  public static void main(String[] args) {\n    int x = "not an int";\n  }\n}`,
    'java',
    'TypeErr.java'
  );
  assert.equal(a6.canCompile, false);
  assert.equal(a6.diagnostics[0]?.severity, 'error');

  // 7. Runtime exception in helper method reports helper line number
  const r7 = await executeCode(
    `public class DivZero {\n  static int divide(int a, int b) {\n    return a / b;\n  }\n  public static void main(String[] args) {\n    System.out.println(divide(10, 0));\n  }\n}`,
    'java',
    '',
    5000,
    'DivZero.java'
  );
  assert.equal(r7.status, 'error');
  assert.equal(r7.runtimeErrorLine, 3);

  // 8. Multi-line STDIN with Scanner
  const r8 = await executeCode(
    `import java.util.Scanner;\npublic class StdinCalc {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    String name = sc.nextLine();\n    int a = sc.nextInt();\n    int b = sc.nextInt();\n    System.out.println(name + ":" + (a + b));\n  }\n}`,
    'java',
    'Logic Lab User\n15 27\n',
    5000,
    'StdinCalc.java'
  );
  assert.equal(r8.status, 'success');
  assert.ok(r8.stdout.includes('Logic Lab User:42'));

  // 9. Timeout on infinite loop
  const r9 = await executeCode(
    `public class Spin {\n  public static void main(String[] args) {\n    while (true) {}\n  }\n}`,
    'java',
    '',
    600,
    'Spin.java'
  );
  assert.equal(r9.timedOut, true);
  assert.equal(r9.status, 'error');

  // 10. Interactive runner executes packaged Java cleanly
  const r10 = await runInteractiveAndCollect(
    `package org.demo;\npublic class RunnerPkg {\n  public static void main(String[] args) {\n    System.out.println("INTERACTIVE_PKG_OK");\n  }\n}`,
    'java',
    'RunnerPkg.java'
  );
  assert.equal(r10.success, true, `Expected interactive Java pkg success, got: ${r10.stderr}`);
  assert.ok(r10.stdout.includes('INTERACTIVE_PKG_OK'));
});

// =========================================================================
// 9.2 JAVASCRIPT EXECUTION TESTS (10 CASES)
// =========================================================================
test('9.2 JavaScript Execution Suite (CJS, ESM, .mjs, custom filenames, errors, stdin, timeout)', async () => {
  // 1. Custom filename preserved
  const r1 = await executeCode(
    `console.log("JS_OK:" + (6 * 7));`,
    'javascript',
    '',
    4000,
    'calculator-v2.js'
  );
  assert.equal(r1.status, 'success');
  assert.ok(r1.stdout.includes('JS_OK:42'));

  // 2. CommonJS module execution
  const r2 = await executeCode(
    `const path = require('node:path');\nconsole.log(path.basename('/tmp/demo/file.js'));`,
    'javascript',
    '',
    4000,
    'cjs-demo.cjs'
  );
  assert.equal(r2.status, 'success');
  assert.ok(r2.stdout.includes('file.js'));

  // 3. ES Module execution (.mjs and .js)
  const r3 = await executeCode(
    `import os from 'node:os';\nconsole.log('ESM:' + Boolean(os.platform()));`,
    'javascript',
    '',
    4000,
    'esm-module.mjs'
  );
  assert.equal(r3.status, 'success', `Expected .mjs success, got: ${r3.stderr}`);
  assert.ok(r3.stdout.includes('ESM:true'));

  // 4. Syntax error line accuracy across .mjs
  const a4 = await analyzeCode(`const x = 1;\nconst y = ;`, 'javascript', 'bad syntax.mjs');
  assert.equal(a4.canCompile, false);
  assert.equal(a4.diagnostics[0]?.line, 2);

  // 5. ReferenceError runtime exception
  const r5 = await executeCode(`const a = 1;\nconsole.log(missingVar);`, 'javascript', '', 4000, 'ref.js');
  assert.equal(r5.status, 'error');
  assert.equal(r5.runtimeErrorLine, 2);

  // 6. TypeError runtime exception
  const r6 = await executeCode(`const x = null;\nx.foo();`, 'javascript', '', 4000, 'type.js');
  assert.equal(r6.status, 'error');
  assert.ok(r6.stderr.includes('TypeError'));

  // 7. Non-zero exitCode with empty stderr properly flagged as error
  const r7 = await executeCode(`process.exit(2);`, 'javascript', '', 4000, 'exitcode.js');
  assert.equal(r7.status, 'error');
  assert.equal(r7.exitCode, 2);

  // 8. STDIN reading (multi-line with spaces)
  const r8 = await executeCode(
    `const fs = require('fs');\nconst lines = fs.readFileSync(0, 'utf8').trim().split('\\n');\nconsole.log(lines.join('|'));`,
    'javascript',
    'alpha beta\ngamma delta',
    4000,
    'stdin-reader.js'
  );
  assert.equal(r8.status, 'success');
  assert.ok(r8.stdout.includes('alpha beta|gamma delta'));

  // 9. Silent valid script produces empty stdout via /api/execute (does NOT leak simulator)
  await withApiServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `const answer = 21 * 2;`,
        language: 'javascript',
        fileName: 'silent.js',
      }),
    });
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.stdout, '');
  });

  // 10. Infinite loop timeout
  const r10 = await executeCode(`while (true) {}`, 'javascript', '', 500, 'loop.js');
  assert.equal(r10.timedOut, true);
  assert.equal(r10.status, 'error');
});

// =========================================================================
// 9.3 C++ & C EXECUTION TESTS (10 CASES)
// =========================================================================
test('9.3 C++ Execution Suite (STL, spaced names, .c mode, stdin, errors, warnings, timeout)', async () => {
  // 1. Custom spaced filename
  const r1 = await executeCode(
    `#include <iostream>\nint main() { std::cout << "SPACED_CPP_OK\\n"; return 0; }`,
    'cpp',
    '',
    5000,
    'my graph dfs.cpp'
  );
  assert.equal(r1.status, 'success', `Expected spaced cpp success, got: ${r1.stderr}`);
  assert.ok(r1.stdout.includes('SPACED_CPP_OK'));

  // 2. C++ STL vector + sort + pair (compatible with host MinGW GCC 6.3+)
  const r2 = await executeCode(
    `#include <iostream>\n#include <vector>\n#include <algorithm>\n#include <utility>\nint main() {\n  std::vector<std::pair<int,int>> v = {{3,1},{1,2}};\n  std::sort(v.begin(), v.end());\n  std::cout << v[0].first << "," << v[0].second << "\\n";\n}`,
    'cpp',
    '',
    5000,
    'stl_test.cpp'
  );
  assert.equal(r2.status, 'success', `Expected STL C++ success, got: ${r2.stderr}`);
  assert.ok(r2.stdout.includes('1,2'));

  // 3. Multi-line STDIN with spaces (cin + getline)
  const r3 = await executeCode(
    `#include <iostream>\n#include <string>\nint main() {\n  int n; std::cin >> n; std::cin.ignore();\n  std::string line; std::getline(std::cin, line);\n  std::cout << n << ":" << line << "\\n";\n}`,
    'cpp',
    '5\nHello C++ World\n',
    5000,
    'stdin_cpp.cpp'
  );
  assert.equal(r3.status, 'success');
  assert.ok(r3.stdout.includes('5:Hello C++ World'));

  // 4. Syntax error reports exact line
  const a4 = await analyzeCode(
    `#include <iostream>\nint main() {\n  int x = 10\n  return 0;\n}`,
    'cpp',
    'err_file.cpp'
  );
  assert.equal(a4.canCompile, false);
  assert.ok(a4.diagnostics.some((d) => d.severity === 'error' && (d.line === 3 || d.line === 4)));

  // 5. Non-zero exit status from C++ main
  const r5 = await executeCode(
    `#include <iostream>\nint main() { std::cerr << "boom"; return 3; }`,
    'cpp',
    '',
    5000,
    'ret3.cpp'
  );
  assert.equal(r5.status, 'error');
  assert.ok(r5.exitCode !== null && r5.exitCode !== 0);
  assert.ok(r5.stderr.includes('boom'));

  // 6. Warning produces 'warning' status yet runs successfully
  const r6 = await executeCode(
    `#include <iostream>\nint main() { int unused = 5; std::cout << "WARN_RUN\\n"; return 0; }`,
    'cpp',
    '',
    5000,
    'warn.cpp'
  );
  assert.equal(r6.status, 'warning');
  assert.ok(r6.stdout.includes('WARN_RUN'));

  // 7. Silent C++ program returns empty stdout
  const r7 = await executeCode(`int main() { return 0; }`, 'cpp', '', 5000, 'silent.cpp');
  assert.equal(r7.status, 'success');
  assert.equal(r7.stdout, '');

  // 8. Pure C11 source (.c extension)
  const r8 = await executeCode(
    `#include <stdio.h>\nint main(void) { int a=0; if(scanf("%d",&a)==1) printf("C11=%d\\n", a*2); return 0; }`,
    'cpp',
    '21\n',
    5000,
    'pure_c.c'
  );
  assert.equal(r8.status, 'success', `Expected C11 success, got: ${r8.stderr}`);
  assert.ok(r8.stdout.includes('C11=42'));

  // 9. Infinite loop timeout
  const r9 = await executeCode(`int main() { while (true) {} return 0; }`, 'cpp', '', 500, 'spin.cpp');
  assert.equal(r9.timedOut, true);
  assert.equal(r9.status, 'error');

  // 10. Interactive C++ execution with custom name
  const r10 = await runInteractiveAndCollect(
    `#include <iostream>\nint main() { std::cout << "CPP_INTERACTIVE_OK\\n"; return 0; }`,
    'cpp',
    'interactive_demo.cpp'
  );
  assert.equal(r10.success, true);
  assert.ok(r10.stdout.includes('CPP_INTERACTIVE_OK'));
});

// =========================================================================
// 9.4 PYTHON EXECUTION TESTS (10 CASES)
// =========================================================================
test('9.4 Python Execution Suite (Unicode filenames/IO, IndentationError, tracebacks, stdin, sys.exit)', async () => {
  // 1. Custom filename & Unicode filename + Unicode output
  const r1 = await executeCode(
    `print("বাংলা-PY-OK 🚀")`,
    'python',
    '',
    4000,
    'হ্যালো.py'
  );
  assert.equal(r1.status, 'success', `Expected Unicode filename Python run to succeed, got: ${r1.stderr}`);
  assert.ok(r1.stdout.includes('বাংলা-PY-OK 🚀'));

  // 2. Standard library modules
  const r2 = await executeCode(
    `import json, math\nprint(json.dumps({"sqrt": int(math.sqrt(144))}))`,
    'python',
    '',
    4000,
    'stdlib_test.py'
  );
  assert.equal(r2.status, 'success');
  assert.ok(r2.stdout.includes('"sqrt": 12'));

  // 3. IndentationError detection
  const a3 = await analyzeCode(`def f():\nprint(1)`, 'python', 'indent.py');
  assert.equal(a3.canCompile, false);
  assert.ok(a3.diagnostics[0]?.message.includes('IndentationError'));
  assert.equal(a3.diagnostics[0]?.line, 2);

  // 4. SyntaxError detection
  const a4 = await analyzeCode(`if True\n  print(1)`, 'python', 'syntax.py');
  assert.equal(a4.canCompile, false);
  assert.ok(a4.diagnostics[0]?.message.includes('SyntaxError'));

  // 5. Runtime traceback line number
  const r5 = await executeCode(
    `def calc():\n    x = 1\n    return x / 0\ncalc()`,
    'python',
    '',
    4000,
    'trace_test.py'
  );
  assert.equal(r5.status, 'error');
  assert.equal(r5.runtimeErrorLine, 3);

  // 6. Single-line and multi-line STDIN
  const r6 = await executeCode(
    `name = input()\nnums = list(map(int, input().split()))\nprint(f"{name}:{sum(nums)}")`,
    'python',
    'Ada Lovelace\n10 20 12\n',
    4000,
    'stdin_py.py'
  );
  assert.equal(r6.status, 'success');
  assert.ok(r6.stdout.includes('Ada Lovelace:42'));

  // 7. Full EOF multi-line stdin read()
  const r7 = await executeCode(
    `import sys\nlines = sys.stdin.read().splitlines()\nprint(len(lines))`,
    'python',
    'line1\nline2\nline3',
    4000,
    'eof_read.py'
  );
  assert.equal(r7.status, 'success');
  assert.ok(r7.stdout.trim() === '3');

  // 8. Non-zero sys.exit(4) with empty stderr reports error
  const r8 = await executeCode(`import sys\nsys.exit(4)`, 'python', '', 4000, 'exit4.py');
  assert.equal(r8.status, 'error');
  assert.equal(r8.exitCode, 4);

  // 9. Silent valid script returns empty stdout
  const r9 = await executeCode(`val = sum([1, 2, 3])`, 'python', '', 4000, 'silent.py');
  assert.equal(r9.status, 'success');
  assert.equal(r9.stdout, '');

  // 10. Infinite loop timeout
  const r10 = await executeCode(`while True:\n    pass`, 'python', '', 500, 'spin.py');
  assert.equal(r10.timedOut, true);
  assert.equal(r10.status, 'error');
});

// =========================================================================
// 9.5 CROSS-LANGUAGE, SECURITY, VALIDATION, CLEANUP & CONCURRENCY TESTS
// =========================================================================
test('9.5 Filename validation, traversal rejection, API validation, path scrubbing, cleanup & concurrency', async () => {
  // 1. Filename sanitization preserves spaces and Unicode
  assert.equal(sanitizeSourceFileName('my script.py', 'script.py', ['.py']), 'my script.py');
  assert.equal(sanitizeSourceFileName('হ্যালো.py', 'script.py', ['.py']), 'হ্যালো.py');
  assert.equal(sanitizeSourceFileName('UserAuth.java', 'Main.java', ['.java']), 'UserAuth.java');

  // 2. Path traversal strictly rejected by validateSourceFileName
  assert.equal(validateSourceFileName('../secret.py', ['.py']).valid, false);
  assert.equal(validateSourceFileName('..\\evil.js', ['.js']).valid, false);
  assert.equal(validateSourceFileName('folder/file.cpp', ['.cpp']).valid, false);
  assert.equal(validateSourceFileName('wrong.py', ['.java']).valid, false);
  assert.equal(validateSourceFileName('.py', ['.py']).valid, false);

  // 3. Java preprocessor line remapping preserves exact line numbers even after package declaration
  const pkgPrep = preprocessCode(
    `package demo.pkg;\npublic class P {\n  public static void main(String[] args) {\n    ArrayList<Integer> a = new ArrayList<>();\n    System.out.println(a.size());\n  }\n}`,
    'java'
  );
  assert.ok(pkgPrep.injectedImports.includes('import java.util.*;'));
  const remapped = remapDiagnosticsToOriginal([{ line: 6, severity: 'error', message: 'err' }], pkgPrep);
  assert.equal(remapped[0].line, 5);

  // 4. API strict validation across /api/execute, /api/analyze, /api/execute/start
  await withApiServer(async (baseUrl) => {
    for (const endpoint of ['/api/execute', '/api/analyze', '/api/execute/start']) {
      // Unsupported language -> 400
      const badLang = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'puts 1', language: 'ruby', fileName: 'test.rb' }),
      });
      assert.equal(badLang.status, 400, `Expected 400 for ruby on ${endpoint}`);

      // Path traversal -> 400
      const traversal = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'print(1)', language: 'python', fileName: '../hack.py' }),
      });
      assert.equal(traversal.status, 400, `Expected 400 for path traversal on ${endpoint}`);

      // Extension mismatch -> 400
      const extMismatch = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'print(1)', language: 'java', fileName: 'script.py' }),
      });
      assert.equal(extMismatch.status, 400, `Expected 400 for ext mismatch on ${endpoint}`);
    }

    // Valid silent Python via /api/execute returns exact fileName and empty stdout
    const silentRes = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'x = 123', language: 'python', fileName: 'silent check.py' }),
    });
    const silentJson = await silentRes.json();
    assert.equal(silentRes.status, 200);
    assert.equal(silentJson.fileName, 'silent check.py');
    assert.equal(silentJson.stdout, '');

    // Host secret env vars (e.g. GEMINI_API_KEY) stripped from sandboxed child env
    process.env.LOGIC_LAB_SECRET_CANARY = 'TOP_SECRET_VALUE';
    const envRes = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `import os\nprint("HAS_CANARY=" + str("LOGIC_LAB_SECRET_CANARY" in os.environ))`,
        language: 'python',
        fileName: 'env_check.py',
      }),
    });
    const envJson = await envRes.json();
    delete process.env.LOGIC_LAB_SECRET_CANARY;
    assert.ok(envJson.stdout.includes('HAS_CANARY=False'));
  });

  // 5. Concurrent isolated runs across all 4 languages without collision or leaked temp directories
  const sandboxRoot = path.join(os.tmpdir(), 'logic-lab-sandbox');
  const beforeEntries = new Set(await fs.readdir(sandboxRoot).catch(() => []));

  const concurrent = await Promise.all([
    executeCode(
      `public class C1 { public static void main(String[] a){ System.out.println("C_JAVA"); } }`,
      'java',
      '',
      5000,
      'C1.java'
    ),
    executeCode(`console.log("C_JS");`, 'javascript', '', 4000, 'concurrent.js'),
    executeCode(
      `#include <iostream>\nint main(){ std::cout << "C_CPP\\n"; return 0; }`,
      'cpp',
      '',
      5000,
      'concurrent.cpp'
    ),
    executeCode(`print("C_PY")`, 'python', '', 4000, 'concurrent.py'),
  ]);
  assert.ok(concurrent[0].stdout.includes('C_JAVA'));
  assert.ok(concurrent[1].stdout.includes('C_JS'));
  assert.ok(concurrent[2].stdout.includes('C_CPP'));
  assert.ok(concurrent[3].stdout.includes('C_PY'));

  const afterEntries = await fs.readdir(sandboxRoot).catch(() => []);
  const leaked = afterEntries.filter((e) => !beforeEntries.has(e));
  assert.equal(leaked.length, 0, `Temp sandbox dirs should be cleaned up, leaked: ${leaked.join(', ')}`);

  // Cleanup containment safety check: refuse to delete outside sandbox root
  const outsideTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-keep-'));
  await cleanupSandboxWorkspace(outsideTemp);
  const stillExists = await fs
    .stat(outsideTemp)
    .then(() => true)
    .catch(() => false);
  assert.equal(stillExists, true, 'cleanupSandboxWorkspace must never delete directories outside SANDBOX_BASE_DIR');
  await fs.rm(outsideTemp, { recursive: true, force: true });

  // Sanity check createSandboxWorkspace creates inside sandboxRoot and cleans up cleanly
  const ws = await createSandboxWorkspace();
  assert.ok(ws.startsWith(sandboxRoot));
  await cleanupSandboxWorkspace(ws);
});

// =========================================================================
// 9.6 FRONTEND STORE FILE / TAB / EXTENSION / STATE ISOLATION TESTS
// =========================================================================
test('9.6 Frontend useLabStore file & tab state management', () => {
  const store = useLabStore.getState();

  // Extension & language switching preserves base name
  store.setFileName('Invoice.js');
  assert.equal(useLabStore.getState().language, 'javascript');
  store.setLanguage('java');
  assert.equal(useLabStore.getState().fileName, 'Invoice.java');
  assert.equal(useLabStore.getState().language, 'java');

  store.setFileName('analytics.mjs');
  assert.equal(useLabStore.getState().language, 'javascript');
  store.setLanguage('python');
  assert.equal(useLabStore.getState().fileName, 'analytics.py');

  // Multi-tab isolation: switch between two files and verify code & execution status do not bleed
  const firstFileId = useLabStore.getState().activeFileId;
  useLabStore.getState().setCode('print("tab1")');
  useLabStore.setState({ executionStatus: 'success' });

  useLabStore.getState().createNewUserFile();
  const secondFileId = useLabStore.getState().activeFileId;
  assert.notEqual(secondFileId, firstFileId);
  assert.equal(useLabStore.getState().code, '');
  assert.equal(useLabStore.getState().executionStatus, 'idle');

  useLabStore.getState().setCode('print("tab2")');
  useLabStore.getState().selectUserFile(firstFileId);
  assert.equal(useLabStore.getState().code, 'print("tab1")');
  assert.equal(useLabStore.getState().executionStatus, 'success');

  useLabStore.getState().selectUserFile(secondFileId);
  assert.equal(useLabStore.getState().code, 'print("tab2")');
  assert.equal(useLabStore.getState().executionStatus, 'idle');

  // Dynamic Java public class sync when on default Main.java or extensionless tab name
  useLabStore.getState().setLanguage('java');
  useLabStore.getState().setFileName('Main.java');
  useLabStore.getState().setCode(
    `public class PalindromeChecker {\n  public static void main(String[] args) {\n    System.out.println("ok");\n  }\n}`
  );
  assert.equal(useLabStore.getState().fileName, 'PalindromeChecker.java');
});

test('9.7 Dynamic Java Filename Compilation (PalindromeChecker with/without extension and default Main.java)', async () => {
  const palindromeCode = `public class PalindromeChecker {
    public static boolean isPalindrome(String str) {
        String clean = str.replaceAll("[^a-zA-Z0-9]", "").toLowerCase();
        String reversed = new StringBuilder(clean).reverse().toString();
        return clean.equals(reversed);
    }
    public static void main(String[] args) {
        String word = "Level";
        System.out.println(word + " কি প্যালিনড্রোম? " + isPalindrome(word));
    }
}`;

  // 1. Extensionless tab name ("PalindromeChecker") compiles as PalindromeChecker.java and runs java PalindromeChecker
  const rExtless = await executeCode(palindromeCode, 'java', '', 5000, 'PalindromeChecker');
  assert.equal(rExtless.status, 'success', `Expected success for extensionless PalindromeChecker, got: ${rExtless.stderr}`);
  assert.ok(rExtless.stdout.includes('Level কি প্যালিনড্রোম? true'));

  // 2. Default placeholder ("Main.java") with public class PalindromeChecker auto-syncs and compiles cleanly
  const rDefault = await executeCode(palindromeCode, 'java', '', 5000, 'Main.java');
  assert.equal(rDefault.status, 'success', `Expected success for default Main.java with public class, got: ${rDefault.stderr}`);
  assert.ok(rDefault.stdout.includes('Level কি প্যালিনড্রোম? true'));

  // 3. validateSourceFileName accepts extensionless filename and appends language extension
  const vJava = validateSourceFileName('PalindromeChecker', ['.java']);
  assert.equal(vJava.valid, true);
  assert.equal(vJava.sanitized, 'PalindromeChecker.java');
});
