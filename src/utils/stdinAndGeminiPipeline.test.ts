import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import 'dotenv/config';
import { createCoreExpressApp } from '../../server/src/app';
import {
  detectInputCalls,
  generateSampleStdin,
  tokenizeStdin,
} from '../../shared/stdinHelper';
import { useLabStore } from '../store/useLabStore';

const SIMPLE_CALCULATOR_JAVA = `import java.util.Scanner;

public class SimpleCalculator {
  public static void main(String[] args) {
    Scanner scanner = new Scanner(System.in);
    System.out.print("Enter first number: ");
    double num1 = scanner.nextDouble();
    System.out.print("Enter operator (+, -, *, /): ");
    char operator = scanner.next().charAt(0);
    System.out.print("Enter second number: ");
    double num2 = scanner.nextDouble();
    double result;
    switch (operator) {
      case '+':
        result = num1 + num2;
        System.out.println("Result: " + result);
        break;
      case '-':
        result = num1 - num2;
        System.out.println("Result: " + result);
        break;
      case '*':
        result = num1 * num2;
        System.out.println("Result: " + result);
        break;
      case '/':
        if (num2 != 0) {
          result = num1 / num2;
          System.out.println("Result: " + result);
        } else {
          System.out.println("Cannot divide by zero!");
        }
        break;
      default:
        System.out.println("Invalid operator!");
    }
    scanner.close();
  }
}`;

test('STDIN Helper detects input calls accurately and generates safe sample inputs', () => {
  // 1. Java SimpleCalculator with System.in
  const javaCalls = detectInputCalls(SIMPLE_CALCULATOR_JAVA, 'java');
  assert.equal(javaCalls.length, 3);
  assert.equal(javaCalls[0].targetVar, 'num1');
  assert.equal(javaCalls[0].hintType, 'float');
  assert.equal(javaCalls[1].targetVar, 'operator');
  assert.equal(javaCalls[1].hintType, 'operator');
  assert.equal(javaCalls[2].targetVar, 'num2');
  assert.equal(javaCalls[2].hintType, 'float');

  const javaSample = generateSampleStdin(SIMPLE_CALCULATOR_JAVA, 'java');
  assert.equal(javaSample, '25\n*\n5');
  assert.deepEqual(tokenizeStdin(javaSample), ['25', '*', '5']);

  // 2. Hardcoded Scanner("10") must NOT prompt for STDIN
  const hardcodedJava = `import java.util.Scanner;
public class Main {
  public static void main(String[] args) {
    Scanner s = new Scanner("10");
    int x = s.nextInt();
    System.out.println(x);
  }
}`;
  assert.equal(detectInputCalls(hardcodedJava, 'java').length, 0);

  // 3. Python input()
  const pyCode = `a = int(input("Num: "))\nname = input("Name: ")\nprint(a, name)`;
  const pyCalls = detectInputCalls(pyCode, 'python');
  assert.equal(pyCalls.length, 2);
  assert.equal(pyCalls[0].hintType, 'int');
  assert.equal(pyCalls[1].hintType, 'string');
  assert.deepEqual(tokenizeStdin(generateSampleStdin(pyCode, 'python')), ['25', 'Rahim']);

  // 4. C++ chained cin
  const cppCode = `#include <iostream>\nusing namespace std;\nint main(){ int a, b; cin >> a >> b; return 0; }`;
  const cppCalls = detectInputCalls(cppCode, 'cpp');
  assert.equal(cppCalls.length, 2);
  assert.deepEqual(tokenizeStdin(generateSampleStdin(cppCode, 'cpp')), ['25', '5']);
});

test('POST /api/trace distinguishes runtime/input error from compile error when STDIN is missing', async () => {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: SIMPLE_CALCULATOR_JAVA,
        language: 'java',
        explainLanguage: 'bn',
        depth: 'detailed',
        fileName: 'SimpleCalculator.java',
        stdin: '',
        bypassCache: true,
      }),
    });

    const json = (await res.json()) as any;
    assert.ok(json.trace, 'Trace payload must exist');
    assert.notEqual(
      json.trace.verdict.status,
      'compile_error',
      'Missing STDIN on compilable Java Scanner code must NOT be mislabeled as compile_error'
    );
    assert.equal(json.trace.verdict.status, 'runtime_error');
    assert.equal(json.trace.errorCategory, 'input_error');
    assert.ok(
      json.trace.steps.length > 0,
      'Playable steps leading up to runtime/input error must be returned'
    );
  } finally {
    server.close();
  }
});

test('POST /api/trace passes exact STDIN values to execution + Gemini trace for SimpleCalculator', async () => {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: SIMPLE_CALCULATOR_JAVA,
        language: 'java',
        explainLanguage: 'bn',
        depth: 'detailed',
        fileName: 'SimpleCalculator.java',
        stdin: '25\n*\n5',
        bypassCache: true,
      }),
    });

    const json = (await res.json()) as any;
    assert.equal(json.canRun, true);
    assert.equal(json.hasError, false);
    assert.ok(
      String(json.output).includes('Result: 125.0'),
      `Expected exact output Result: 125.0, got: ${json.output}`
    );
    assert.ok(json.trace, 'Trace object must be returned');
    assert.deepEqual(json.trace.stdinTokens, ['25', '*', '5']);
    assert.ok(
      json.trace.steps.length >= 5,
      `Expected detailed execution steps, got ${json.trace.steps.length}`
    );

    if (json.trace.traceSource === 'ai_predicted') {
      // Verify at least one step tracks stdinConsumed and Bangla explanation has no Gurmukhi script
      const hasStdinStep = json.trace.steps.some((st: any) => Boolean(st.stdinConsumed?.token));
      assert.ok(hasStdinStep, 'AI trace should populate stdinConsumed on Scanner read steps');
      const allText = json.trace.steps
        .map((st: any) => `${st.banglaExplanation || ''} ${st.explanation || ''}`)
        .join(' ');
      assert.ok(
        !/[\u0A00-\u0A7F]/.test(allText),
        'Bangla AI explanations must not contain stray Gurmukhi characters'
      );
    }
  } finally {
    server.close();
  }
});

test('Store requestVisualize prompts on missing STDIN and runs visualization with auto-sample', async () => {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const origFetch = globalThis.fetch;

  globalThis.fetch = ((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('/api/')) {
      return origFetch(`http://127.0.0.1:${port}${url}`, init);
    }
    return origFetch(input, init);
  }) as typeof fetch;

  try {
    useLabStore.setState({
      code: SIMPLE_CALCULATOR_JAVA,
      language: 'java',
      fileName: 'SimpleCalculator.java',
      stdin: '',
      stdinPromptOpen: false,
      stdinDraft: '',
      pendingVisualizeCode: null,
      autoInjectedStdinNotice: null,
      speed: 1,
    });

    // 1. Clicking Explain & Animate with empty STDIN opens STDIN prompt pre-filled with sample
    await useLabStore.getState().requestVisualize(SIMPLE_CALCULATOR_JAVA);
    let state = useLabStore.getState();
    assert.equal(state.stdinPromptOpen, true);
    assert.equal(state.stdinDraft, '25\n*\n5');

    // 2. Auto-Sample & Animate injects STDIN, sets notice, and executes full visualization
    await useLabStore.getState().autoFillSampleAndVisualize();
    state = useLabStore.getState();
    assert.equal(state.stdinPromptOpen, false);
    assert.equal(state.stdin, '25\n*\n5');
    assert.ok(state.autoInjectedStdinNotice?.isAutoSample);
    assert.equal(state.hasExecuted, true);
    assert.equal(state.canRun, true);
    assert.ok(state.trace.finalOutput.includes('125.0'));
  } finally {
    globalThis.fetch = origFetch;
    server.close();
  }
});

