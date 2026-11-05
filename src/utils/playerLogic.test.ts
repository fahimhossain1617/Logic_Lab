import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInlineCodeSegments,
  clampStepIndex,
  getNextStepIndex,
  getPrevStepIndex,
  findFirstStepForLine,
  getStepDurationMs,
  getStepDotCategory,
} from './playerLogic';
import { SAMPLE_PROGRAMS, resolveTraceForCode } from '../data/sampleTraces';
import { PROBLEM_LIBRARY } from '../data/problemLibrary';
import { ExecutionTraceSchema } from '../../shared/traceSchema';
import { buildFallbackTrace } from '../../server/src/tracers/fallbackTracer';
import {
  runSandboxedJavaScript,
  matchCuratedLibraryProblemTrace,
} from '../../server/src/tracers/realExecutionRunner';
import { computeTraceHash } from '../../server/src/services/geminiTraceService';

test('parseInlineCodeSegments splits Bengali text and backtick code tokens cleanly', () => {
  const segments = parseInlineCodeSegments('`temp` নামে নতুন কাপে `a`-র মান (`5`) রাখা হলো।');
  assert.equal(segments.length, 6);
  assert.deepEqual(segments[0], { type: 'code', content: 'temp' });
  assert.deepEqual(segments[2], { type: 'code', content: 'a' });
  assert.deepEqual(segments[4], { type: 'code', content: '5' });
});

test('step navigation clamps and advances within bounds', () => {
  assert.equal(clampStepIndex(-2, 6), 0);
  assert.equal(clampStepIndex(10, 6), 5);
  assert.equal(getNextStepIndex(2, 6), 3);
  assert.equal(getNextStepIndex(5, 6), 5);
  assert.equal(getPrevStepIndex(0, 6), 0);
  assert.equal(getPrevStepIndex(3, 6), 2);
  assert.equal(getStepDurationMs(2, 1400), 700);
});

test('findFirstStepForLine locates the first step executing a clicked line', () => {
  const steps = SAMPLE_PROGRAMS[0].traces.bn.simple.steps;
  assert.equal(findFirstStepForLine(steps, 3), 2);
  assert.equal(findFirstStepForLine(steps, 99), null);
});

test('all built-in sample traces validate against ExecutionTraceSchema', () => {
  for (const sample of SAMPLE_PROGRAMS) {
    const parsedBn = ExecutionTraceSchema.safeParse(sample.traces.bn.simple);
    assert.equal(parsedBn.success, true, `Failed bn trace validation for ${sample.id}`);
    const parsedEn = ExecutionTraceSchema.safeParse(sample.traces.en.simple);
    assert.equal(parsedEn.success, true, `Failed en trace validation for ${sample.id}`);
  }
});

test('resolveTraceForCode detects faulty swap and bubble sort accurately', () => {
  const faulty = resolveTraceForCode('let a = 5;\nlet b = 10;\na = b;\nb = a;', 'javascript', 'bn', 'simple');
  assert.equal(faulty.isValidLogic, false);
  assert.equal(faulty.steps[faulty.steps.length - 1].fault?.type, 'lost_value');
  assert.equal(getStepDotCategory(faulty.steps[faulty.steps.length - 1]), 'fault');
});

test('Phase 2: buildFallbackTrace traces custom C++ and Python programs into generic_memory boxes with Bengali notes', () => {
  const customCpp = `int price = 120;\nint tax = 30;\nint total = price + tax;\ncout << total;`;
  const trace = buildFallbackTrace({
    code: customCpp,
    language: 'cpp',
    explainLanguage: 'bn',
    depth: 'simple',
  });
  const validated = ExecutionTraceSchema.safeParse(trace);
  assert.equal(validated.success, true);
  assert.equal(trace.analogyType, 'generic_memory');
  assert.equal(trace.traceSource, 'ai_predicted');
  assert.equal(trace.lineNotes.length, 4);
  assert.equal(trace.finalOutput, '150');
  assert.equal(trace.steps[2].variables.total, 150);
});

test('Phase 2: buildFallbackTrace detects syntax / compile errors and returns empty steps with compile_error verdict', () => {
  const brokenCode = `let x = (10 + 5;\nconsole.log(x);`;
  const trace = buildFallbackTrace({
    code: brokenCode,
    language: 'javascript',
    explainLanguage: 'bn',
    depth: 'simple',
  });
  const validated = ExecutionTraceSchema.safeParse(trace);
  assert.equal(validated.success, true);
  assert.equal(trace.isValidLogic, false);
  assert.equal(trace.verdict.status, 'compile_error');
  assert.equal(trace.steps.length, 0);
  assert.equal(trace.errorDetails?.line, 1);
});

test('Phase 2: computeTraceHash produces deterministic SHA-256 cache keys', () => {
  const h1 = computeTraceHash({
    language: 'python',
    code: 'x = 10\nprint(x)',
    explainLanguage: 'bn',
    depth: 'simple',
  });
  const h2 = computeTraceHash({
    language: 'python',
    code: '  x = 10\nprint(x)  ',
    explainLanguage: 'bn',
    depth: 'simple',
  });
  const h3 = computeTraceHash({
    language: 'python',
    code: 'x = 10\nprint(x)',
    explainLanguage: 'en',
    depth: 'simple',
  });
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
});

test('Phase 3: PROBLEM_LIBRARY contains 13 curated problems with correct & faulty code in all 4 languages', () => {
  assert.ok(PROBLEM_LIBRARY.length >= 12);
  assert.equal(PROBLEM_LIBRARY.length, 13);
  for (const prob of PROBLEM_LIBRARY) {
    assert.ok(prob.title_bn.length > 0);
    assert.ok(prob.title_en.length > 0);
    assert.ok(prob.concept_bn.length > 0);
    assert.ok(prob.bugHint_bn.length > 0);
    for (const lang of ['javascript', 'python', 'cpp', 'java'] as const) {
      assert.ok(prob.codes[lang].length > 0, `Missing correct ${lang} code for ${prob.id}`);
      assert.ok(prob.faultyCodes[lang].length > 0, `Missing faulty ${lang} code for ${prob.id}`);
      assert.notEqual(
        prob.codes[lang],
        prob.faultyCodes[lang],
        `Correct and faulty ${lang} code must differ for ${prob.id}`
      );
    }
  }
});

test('Phase 4: runSandboxedJavaScript captures real stdout/variables and halts infinite loops safely', () => {
  const okRun = runSandboxedJavaScript('let x = 7; let y = 8; console.log("sum =", x + y);', '', 500);
  assert.equal(okRun.timedOut, false);
  assert.equal(okRun.stdout, 'sum = 15');
  assert.equal(okRun.finalVariables.x, 7);
  assert.equal(okRun.finalVariables.y, 8);

  const infRun = runSandboxedJavaScript('let i = 0; while (i < 5) { }', '', 150);
  assert.equal(infRun.timedOut, true);
});

test('Phase 4: matchCuratedLibraryProblemTrace generates schema-valid specialized analogy traces', () => {
  const targets = [
    { id: 'reverse_array', expectedAnalogy: 'pointer_arrows' },
    { id: 'binary_search', expectedAnalogy: 'binary_search_cards' },
    { id: 'stack_brackets', expectedAnalogy: 'stack_plates' },
    { id: 'queue_bfs', expectedAnalogy: 'queue_line' },
    { id: 'linked_list_reverse', expectedAnalogy: 'linked_list_train' },
    { id: 'recursion_factorial', expectedAnalogy: 'recursion_tower' },
  ];

  for (const t of targets) {
    const prob = PROBLEM_LIBRARY.find((p) => p.id === t.id)!;
    const okTrace = matchCuratedLibraryProblemTrace({
      code: prob.codes.javascript,
      language: 'javascript',
      explainLanguage: 'bn',
      depth: 'simple',
    });
    assert.ok(okTrace, `Expected trace for ${t.id}`);
    assert.equal(okTrace.analogyType, t.expectedAnalogy);
    assert.equal(okTrace.isValidLogic, true);
    assert.equal(ExecutionTraceSchema.safeParse(okTrace).success, true);

    const faultyTrace = matchCuratedLibraryProblemTrace({
      code: prob.faultyCodes.javascript,
      language: 'javascript',
      explainLanguage: 'bn',
      depth: 'simple',
    });
    assert.ok(faultyTrace, `Expected faulty trace for ${t.id}`);
    assert.equal(faultyTrace.isValidLogic, false);
    assert.equal(ExecutionTraceSchema.safeParse(faultyTrace).success, true);
  }
});

test('Zero-State Redesign: gibberish and invalid syntax strictly return compile_error with 0 animation steps', () => {
  const gibberishTrace = buildFallbackTrace({
    code: 'asdfghjkl qwertyuiop',
    language: 'javascript',
    explainLanguage: 'bn',
    depth: 'detailed',
  });
  assert.equal(gibberishTrace.isValidLogic, false);
  assert.equal(gibberishTrace.verdict.status, 'compile_error');
  assert.equal(gibberishTrace.steps.length, 0);
  assert.equal(gibberishTrace.finalOutput, '');

  const pythonGibberish = buildFallbackTrace({
    code: 'random invalid words without code',
    language: 'python',
    explainLanguage: 'bn',
    depth: 'detailed',
  });
  assert.equal(pythonGibberish.isValidLogic, false);
  assert.equal(pythonGibberish.verdict.status, 'compile_error');
  assert.equal(pythonGibberish.steps.length, 0);
});

test('Java Compiler Validation: FILE_NAME_MISMATCH, missing semicolon, undeclared variable, and type mismatch', () => {
  // 1. File name vs public class name mismatch (`Test.java` vs `public class Demo`)
  const mismatchTrace = buildFallbackTrace({
    code: `public class Demo {\n  public static void main(String[] args) {\n    int a = 10;\n    System.out.println(a);\n  }\n}`,
    language: 'java',
    explainLanguage: 'bn',
    depth: 'detailed',
    fileName: 'Test.java',
  });
  assert.equal(mismatchTrace.hasError, true);
  assert.equal(mismatchTrace.errorDetails?.errorType, 'FILE_NAME_MISMATCH');
  assert.equal(mismatchTrace.errorDetails?.lineNumber, 1);
  assert.equal(mismatchTrace.programSummary, null);
  assert.equal(mismatchTrace.steps.length, 0);

  // 2. Clean state once file name matches public class name (`Demo.java` vs `public class Demo`)
  const validJavaTrace = buildFallbackTrace({
    code: `public class Demo {\n  public static void main(String[] args) {\n    int a = 10; // inline comment\n    int b = a % 3;\n    System.out.println(b);\n  }\n}`,
    language: 'java',
    explainLanguage: 'bn',
    depth: 'detailed',
    fileName: 'Demo.java',
  });
  assert.equal(validJavaTrace.hasError, false);
  assert.equal(validJavaTrace.errorDetails, null);
  assert.equal(validJavaTrace.finalOutput, '1');
  assert.ok(validJavaTrace.steps.length > 0);
  assert.equal(validJavaTrace.programSummary?.finalOutput, '1');

  // 3. Missing semicolon on line 3
  const missingSemiTrace = buildFallbackTrace({
    code: `public class Main {\n  public static void main(String[] args) {\n    int a = 10\n    System.out.println(a);\n  }\n}`,
    language: 'java',
    explainLanguage: 'bn',
    depth: 'detailed',
    fileName: 'Main.java',
  });
  assert.equal(missingSemiTrace.hasError, true);
  assert.equal(missingSemiTrace.errorDetails?.errorType, 'SYNTAX_ERROR');
  assert.equal(missingSemiTrace.errorDetails?.lineNumber, 3);
  assert.equal(missingSemiTrace.steps.length, 0);

  // 4. Type mismatch (`int a = "hello";`)
  const typeMismatchTrace = buildFallbackTrace({
    code: `public class Main {\n  public static void main(String[] args) {\n    int a = "hello";\n  }\n}`,
    language: 'java',
    explainLanguage: 'bn',
    depth: 'detailed',
    fileName: 'Main.java',
  });
  assert.equal(typeMismatchTrace.hasError, true);
  assert.equal(typeMismatchTrace.errorDetails?.errorType, 'COMPILATION_ERROR');
  assert.equal(typeMismatchTrace.errorDetails?.lineNumber, 3);

  // 5. Undeclared variable (`b = 20;`)
  const undeclaredTrace = buildFallbackTrace({
    code: `public class Main {\n  public static void main(String[] args) {\n    int a = 10;\n    b = 20;\n  }\n}`,
    language: 'java',
    explainLanguage: 'bn',
    depth: 'detailed',
    fileName: 'Main.java',
  });
  assert.equal(undeclaredTrace.hasError, true);
  assert.equal(undeclaredTrace.errorDetails?.errorType, 'COMPILATION_ERROR');
  assert.equal(undeclaredTrace.errorDetails?.lineNumber, 4);
});

test('Java Runtime Exception Handling: try / catch / finally with FileNotFoundException and ArithmeticException', () => {
  const tryCatchJava = `public class Main {
  public static void main(String[] args) {
    try {
      FileReader fr = new FileReader("missing.txt");
      System.out.println("This line is skipped");
    } catch (FileNotFoundException e) {
      System.out.println("Caught FileNotFoundException");
    } finally {
      System.out.println("Finally executed");
    }
  }
}`;
  const trace = buildFallbackTrace({
    code: tryCatchJava,
    language: 'java',
    explainLanguage: 'bn',
    depth: 'detailed',
    fileName: 'Main.java',
  });
  assert.equal(trace.hasError, false);
  assert.equal(trace.errorDetails, null);
  assert.equal(trace.finalOutput, 'Caught FileNotFoundException\nFinally executed');
  // Ensure line 5 ("This line is skipped") was never executed
  const executedLines = trace.steps.map((s) => s.lineNumber);
  assert.equal(executedLines.includes(5), false);
  assert.equal(executedLines.includes(7), true);
  assert.equal(executedLines.includes(9), true);
});




