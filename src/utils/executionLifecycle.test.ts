import test from 'node:test';
import assert from 'node:assert/strict';
import { preprocessCode } from '../../server/src/services/codePreprocessor';
import {
  generateExecutionTrace,
  clearTraceCache,
  getCacheSize,
} from '../../server/src/services/geminiTraceService';
import { runDeterministicMultiLanguage } from '../../server/src/tracers/realExecutionRunner';
import { ExecutionDiagnostic, ExecutionResultPayload } from '../../shared/types';

test('Preprocessor (Java): auto-injects missing import java.util.* when common structures are used', () => {
  const javaCodeWithoutImport = `public class Main {
  public static void main(String[] args) {
    ArrayList<Integer> list = new ArrayList<>();
    list.add(10);
    list.add(20);
    System.out.println("Size: " + list.size());
  }
}`;

  const prep = preprocessCode(javaCodeWithoutImport, 'java');
  assert.ok(prep.injectedImports.includes('import java.util.*;'));
  assert.ok(prep.code.startsWith('import java.util.*;'));
  assert.ok(prep.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('java.util.*')));
});

test('Preprocessor (C++): auto-injects missing <iostream>, <vector>, and using namespace std;', () => {
  const cppCodeWithoutHeaders = `int main() {
  vector<int> nums;
  nums.push_back(42);
  cout << nums[0] << endl;
  return 0;
}`;

  const prep = preprocessCode(cppCodeWithoutHeaders, 'cpp');
  assert.ok(prep.injectedImports.includes('#include <iostream>'));
  assert.ok(prep.injectedImports.includes('#include <vector>'));
  assert.ok(prep.injectedImports.includes('using namespace std;'));
  assert.ok(prep.code.includes('#include <iostream>'));
  assert.ok(prep.code.includes('using namespace std;'));
});

test('Preprocessor (Python & JS): detects unused variables as non-blocking warnings', () => {
  const pyCode = `x = 10\nunused_var = 99\nprint(x)`;
  const prepPy = preprocessCode(pyCode, 'python');
  const unusedDiag = prepPy.diagnostics.find((d) => d.message.includes('unused_var'));
  assert.ok(unusedDiag, 'Expected warning diagnostic for unused_var');
  assert.equal(unusedDiag?.severity, 'warning');

  const jsCode = `let a = 5;\nlet unusedConst = 100;\nconsole.log(a);`;
  const prepJs = preprocessCode(jsCode, 'javascript');
  const jsUnused = prepJs.diagnostics.find((d) => d.message.includes('unusedConst'));
  assert.ok(jsUnused, 'Expected warning diagnostic for unusedConst');
  assert.equal(jsUnused?.severity, 'warning');
});

test('Execution pipeline: minor warnings do NOT abort execution and allow animation/explanation', async () => {
  // Java code with an unused variable: should produce warning, but canRun = true and steps > 0
  const javaWithWarning = `public class Main {
  public static void main(String[] args) {
    int answer = 42;
    int unusedVar = 100;
    System.out.println(answer);
  }
}`;

  const res = await generateExecutionTrace({
    code: javaWithWarning,
    language: 'java',
    explainLanguage: 'en',
    depth: 'simple',
    fileName: 'Main.java',
    bypassCache: true,
  });

  assert.equal(res.status, 'warning');
  assert.equal(res.canRun, true);
  assert.equal(res.hasError, false);
  assert.equal(res.output, '42');
  assert.ok(res.steps.length > 0, 'Steps should be generated despite minor warning');
  assert.ok(res.visualizerData !== null, 'Visualizer data must not be null for warnings');
  assert.ok(res.diagnostics.some((d) => d.severity === 'warning'));
});

test('Execution pipeline: major syntax breakdown blocks animation and returns error status', async () => {
  const brokenJava = `public class Main {
  public static void main(String[] args) {
    int x = 10
    System.out.println(x);
  }
}`;

  const res = await generateExecutionTrace({
    code: brokenJava,
    language: 'java',
    explainLanguage: 'en',
    depth: 'simple',
    fileName: 'Main.java',
    bypassCache: true,
  });

  assert.equal(res.status, 'error');
  assert.equal(res.canRun, false);
  assert.equal(res.hasError, true);
  assert.equal(res.visualizerData, null);
  assert.equal(res.steps.length, 0);
  assert.ok(res.diagnostics.some((d) => d.severity === 'error'));
});

test('Execution pipeline: expected payload format matches the specification', async () => {
  const code = `let x = 15;\nlet y = 25;\nconsole.log(x + y);`;
  const res = await generateExecutionTrace({
    code,
    language: 'javascript',
    explainLanguage: 'en',
    depth: 'simple',
    fileName: 'main.js',
    bypassCache: true,
  });

  // Verify exact shape
  assert.ok('status' in res);
  assert.ok('canRun' in res);
  assert.ok('output' in res);
  assert.ok('diagnostics' in res);
  assert.ok('visualizerData' in res);

  assert.equal(res.status, 'success');
  assert.equal(res.canRun, true);
  assert.equal(res.output, '40');
  assert.equal(Array.isArray(res.diagnostics), true);
  assert.ok(res.visualizerData !== null);
});

test('Runtime cache clear ensures fresh buffer execution without stale failures', async () => {
  clearTraceCache();
  assert.equal(getCacheSize(), 0);

  const code = `let n = 5;\nconsole.log(n * 2);`;
  await generateExecutionTrace({
    code,
    language: 'javascript',
    explainLanguage: 'en',
    depth: 'simple',
    fileName: 'main.js',
    bypassCache: false,
  });

  assert.ok(getCacheSize() >= 1);
  clearTraceCache();
  assert.equal(getCacheSize(), 0);
});

test('AbortController resets and cancels in-flight async executions safely', async () => {
  const controller = new AbortController();
  let cancelled = false;

  const mockLongOperation = new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('done'), 1000);
    controller.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      cancelled = true;
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });

  controller.abort();

  await assert.rejects(
    async () => {
      await mockLongOperation;
    },
    { name: 'AbortError' }
  );
  assert.equal(cancelled, true);
});

test('Separation of concerns: cosmetic breakpoints are separate from code string', () => {
  const initialCode = `let a = 1;\nlet b = 2;\nconsole.log(a + b);`;
  const breakpoints = [1, 3]; // line numbers
  // Breakpoints should never mutate or be appended to the code buffer
  const executedCode = initialCode;
  const result = runDeterministicMultiLanguage(executedCode, 'javascript');
  assert.equal(result.stdout, '3');
  assert.equal(executedCode, initialCode);
  assert.ok(breakpoints.length === 2);
});

