import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateExecutionTrace } from '../../server/src/services/geminiTraceService';
import { analyzeCode, executeCode } from '../../server/src/services/toolchains/toolchainManager';

test('Mandatory Regression Test: Java NumberGuessingGame with Scanner and Random', async () => {
  const code = `import java.util.Scanner;
import java.util.Random;

public class NumberGuessingGame {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        Random random = new Random();
        int secretNumber = random.nextInt(100) + 1;
        System.out.println(secretNumber);
        input.close();
    }
}`;

  // 1. Toolchain analysis test
  const analysis = await analyzeCode(code, 'java', 'NumberGuessingGame.java');
  assert.equal(analysis.canCompile, true, 'Code must compile without errors');
  const errorDiags = analysis.diagnostics.filter((d) => d.severity === 'error');
  assert.equal(errorDiags.length, 0, 'No error diagnostics should be emitted');

  // 2. Real execution test
  const execRes = await executeCode(code, 'java', '', 4000, 'NumberGuessingGame.java');
  assert.equal(execRes.status, 'success');
  assert.equal(execRes.canRun, true);
  assert.equal(execRes.exitCode, 0);
  const printedNum = parseInt(execRes.stdout.trim(), 10);
  assert.ok(!isNaN(printedNum), 'Program must print a valid number');
  assert.ok(printedNum >= 1 && printedNum <= 100, 'Secret number must be between 1 and 100');

  // 3. Full trace pipeline test
  const traceRes = await generateExecutionTrace({
    code,
    language: 'java',
    explainLanguage: 'en',
    depth: 'simple',
    fileName: 'NumberGuessingGame.java',
    bypassCache: true,
  });

  assert.equal(traceRes.trace.hasError, false);
  assert.equal(traceRes.trace.verdict.status, 'ok');
  assert.ok(traceRes.trace.steps.length > 0, 'Animation steps must be generated');
  assert.equal(traceRes.trace.traceSource, 'real_execution');
});

test('Java Test: Missing semicolon causes compilation error with accurate line', async () => {
  const code = `public class Main {
    public static void main(String[] args) {
        int x = 10
        System.out.println(x);
    }
}`;

  const analysis = await analyzeCode(code, 'java', 'Main.java');
  assert.equal(analysis.canCompile, false);
  const err = analysis.diagnostics.find((d) => d.severity === 'error');
  assert.ok(err, 'Expected error diagnostic');
  assert.equal(err?.line, 3);
  assert.ok(err?.message.includes(';'), 'Message should indicate missing semicolon');
});

test('Java Test: Undefined variable reported by javac', async () => {
  const code = `public class Main {
    public static void main(String[] args) {
        System.out.println(undeclaredVar);
    }
}`;

  const analysis = await analyzeCode(code, 'java', 'Main.java');
  assert.equal(analysis.canCompile, false);
  const err = analysis.diagnostics.find((d) => d.severity === 'error');
  assert.ok(err);
  assert.equal(err?.line, 3);
});

test('Java Test: Multiple Java classes in one file', async () => {
  const code = `class Helper {
    static int add(int a, int b) { return a + b; }
}
public class Main {
    public static void main(String[] args) {
        System.out.println(Helper.add(3, 4));
    }
}`;

  const execRes = await executeCode(code, 'java', '', 4000, 'Main.java');
  assert.equal(execRes.status, 'success');
  assert.equal(execRes.stdout.trim(), '7');
});

test('Java Test: Execution timeout on infinite loop', async () => {
  const code = `public class LoopTest {
    public static void main(String[] args) {
        while (true) {}
    }
}`;

  const execRes = await executeCode(code, 'java', '', 1500, 'LoopTest.java');
  assert.equal(execRes.timedOut, true);
  assert.equal(execRes.status, 'error');
  assert.ok(execRes.output.includes('timed out'));
});

test('C++ Test: Real C++ compilation and execution with vector', async () => {
  const code = `#include <iostream>
#include <vector>
#include <algorithm>

int main() {
    std::vector<int> v = {3, 1, 2};
    std::sort(v.begin(), v.end());
    for (int x : v) std::cout << x << " ";
    return 0;
}`;

  const execRes = await executeCode(code, 'cpp', '', 4000, 'main.cpp');
  assert.equal(execRes.status, 'success');
  assert.equal(execRes.stdout.trim(), '1 2 3');
});

test('Python Test: Real Python syntax checking and runtime execution', async () => {
  const validCode = `def greet(name):
    return f"Hello, {name}!"
print(greet("LogicLab"))
`;
  const execRes = await executeCode(validCode, 'python');
  assert.equal(execRes.status, 'success');
  assert.equal(execRes.stdout.trim(), 'Hello, LogicLab!');

  const syntaxErrorCode = `def foo(
print("broken")`;
  const analysis = await analyzeCode(syntaxErrorCode, 'python');
  assert.equal(analysis.canCompile, false);
  assert.ok(analysis.diagnostics.some((d) => d.severity === 'error'));
});

test('JavaScript Test: Real Node.js syntax checking and runtime execution', async () => {
  const validCode = `const nums = [1, 2, 3];
const doubled = nums.map(n => n * 2);
console.log(doubled.join(", "));`;

  const execRes = await executeCode(validCode, 'javascript');
  assert.equal(execRes.status, 'success');
  assert.equal(execRes.stdout.trim(), '2, 4, 6');

  const syntaxErrorCode = `const a = 1;
const a = 2;`;
  const analysis = await analyzeCode(syntaxErrorCode, 'javascript');
  assert.equal(analysis.canCompile, false);
  assert.ok(analysis.diagnostics.some((d) => d.severity === 'error'));
});
