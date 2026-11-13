import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDeterministicMultiLanguage } from '../../server/src/tracers/realExecutionRunner';
import { buildFallbackTrace } from '../../server/src/tracers/fallbackTracer';
import { generateExecutionTrace } from '../../server/src/services/geminiTraceService';
import { useLabStore } from '../store/useLabStore';
import {
  analyzeBlockExecution,
  analyzeCodeComplexity,
  buildExecutionAwareLineNote,
  generateLanguagePitfalls,
} from '../../shared/codeAnalysis';

test('Zero-skip tracing captures declarations, prompt, STDIN, every failed/passed if-else-if, close(), and brace exit with exact 1-based lines', () => {
  const code = `import java.util.Scanner;
public class GradeCheck {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        String grade;
        double gpa;
        System.out.print("Enter marks: ");
        double marks = scanner.nextDouble();
        if (marks >= 80 && marks <= 100) {
            grade = "A+";
            gpa = 5.0;
        } else if (marks >= 70 && marks < 80) {
            grade = "A";
            gpa = 4.0;
        } else if (marks >= 0 && marks < 40) {
            grade = "F";
            gpa = 0.0;
        } else {
            grade = "Invalid";
            gpa = 0.0;
        }
        System.out.println("Grade: " + grade + ", GPA: " + gpa);
        scanner.close();
    }
}`;

  const sandbox = runDeterministicMultiLanguage(code, 'java', '10\n');
  assert.equal(sandbox.runtimeError, null);
  assert.ok(sandbox.stdout.includes('Enter marks: Grade: F, GPA: 0'));

  const linesHit = sandbox.recordedSteps.map((s) => s.line);
  // Line 5 (String grade;), Line 6 (double gpa;), Line 7 (print), Line 8 (marks input)
  assert.ok(linesHit.includes(5), 'Should trace String grade; declaration');
  assert.ok(linesHit.includes(6), 'Should trace double gpa; declaration');
  assert.ok(linesHit.includes(7), 'Should trace System.out.print prompt');
  assert.ok(linesHit.includes(8), 'Should trace scanner.nextDouble()');

  // Condition checks: Line 9 (FALSE), Line 12 (FALSE), Line 15 (TRUE)
  const condSteps = sandbox.recordedSteps.filter((s) => s.actionType === 'CONDITION_CHECK');
  assert.deepEqual(
    condSteps.map((s) => ({ line: s.line, result: s.meta?.conditionResult })),
    [
      { line: 9, result: false },
      { line: 12, result: false },
      { line: 15, result: true },
    ]
  );

  // Resource cleanup scanner.close() on Line 23 and closing braces
  const closeStep = sandbox.recordedSteps.find((s) => s.line === 23);
  assert.ok(closeStep, 'Should trace scanner.close()');
  assert.equal(closeStep.meta?.subKind, 'CLOSE_RESOURCE');

  // Verify fallback pedagogy + 1-based lineNotes + zero boilerplate
  const trace = buildFallbackTrace({
    code,
    language: 'java',
    explainLanguage: 'bn',
    depth: 'detailed',
    fileName: 'GradeCheck.java',
  });

  // Note buildFallbackTrace without explicit stdin param on direct call defaults stdin=''
  // Still verify uninitialized null explanation and non-boilerplate lineNotes on code lines
  const line5Step = trace.steps.find((s) => s.activeLine === 5);
  assert.ok(line5Step, 'Line 5 step exists');
  assert.ok(
    line5Step.explanation.includes('uninitialized') || line5Step.explanation.includes('null'),
    `Expected uninitialized explanation, got: ${line5Step.explanation}`
  );

  const rawLines = code.split('\n');
  for (const note of trace.lineNotes) {
    assert.ok(note.line >= 1 && note.line <= rawLines.length);
    assert.ok(
      !/লাইন\s+\d+\s*\([^)]*\)\s*(?:এক্সিকিউট|সম্পন্ন)\s+হয়েছে/.test(note.text),
      `Boilerplate leaked in lineNote ${note.line}: ${note.text}`
    );
  }
});

test('Auto-injected imports shift line numbers back cleanly without colliding on Line 1', async () => {
  // Missing `import java.util.Scanner;` so codePreprocessor injects it before compilation
  const code = `public class NoImportScanner {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int x = sc.nextInt();
        if (x > 10) {
            System.out.println("Big");
        } else {
            System.out.println("Small");
        }
        sc.close();
    }
}`;

  const res = await generateExecutionTrace({
    code,
    language: 'java',
    explainLanguage: 'bn',
    depth: 'detailed',
    fileName: 'NoImportScanner.java',
    stdin: '5\n',
    bypassCache: true,
  });

  assert.ok(res.trace, 'Trace generated');
  assert.equal(res.trace.hasError, false);
  assert.equal(res.trace.finalOutput, 'Small');

  // Line 5 (`if (x > 10)`) and Line 7 (`else`) must align to user's 1-based lines, not shifted
  const condLines = res.trace.steps
    .filter((s) => s.actionType === 'CONDITION_CHECK' || s.actionType === 'CONDITION')
    .map((s) => s.activeLine);
  assert.ok(condLines.includes(5), `Expected line 5 condition check, got ${condLines}`);

  const line1Notes = res.trace.lineNotes.filter((n) => n.line === 1);
  assert.equal(line1Notes.length, 1, 'User line 1 must not collide with injected imports');
});

test('Swap detection & multi-var declarations work accurately with swap_buckets analogy', () => {
  const code = `let a = 10, b = 25;
let temp = a;
a = b;
b = temp;
console.log(a, b);`;

  const trace = buildFallbackTrace({
    code,
    language: 'javascript',
    explainLanguage: 'bn',
    depth: 'detailed',
  });

  assert.equal(trace.analogyType, 'swap_buckets');
  assert.equal(trace.finalOutput, '25 10');
  const tempStep = trace.steps.find((s) => s.to === 'temp' && s.from === 'a');
  assert.ok(tempStep, 'Expected transfer step from a -> temp');
});

test('Switch/case statements trace matching case without skipping in C++/Java', () => {
  const code = `#include <iostream>
using namespace std;
int main() {
    int op = 2;
    switch (op) {
        case 1:
            cout << "One";
            break;
        case 2:
            cout << "Two";
            break;
        default:
            cout << "Other";
    }
    return 0;
}`;

  const sandbox = runDeterministicMultiLanguage(code, 'cpp', '');
  assert.equal(sandbox.runtimeError, null);
  assert.equal(sandbox.stdout.trim(), 'Two');
  assert.ok(sandbox.recordedSteps.some((s) => s.meta?.subKind === 'SWITCH_ENTER'));
  assert.ok(sandbox.recordedSteps.some((s) => s.meta?.subKind === 'CASE_MATCH'));
});

test('Forward and Backward stepping in Zustand store is 0ms synchronous without network requests', () => {
  const store = useLabStore.getState();
  const sample = buildFallbackTrace({
    code: `let x = 1;\nlet y = x + 2;\nconsole.log(y);`,
    language: 'javascript',
    explainLanguage: 'bn',
    depth: 'detailed',
  });

  useLabStore.setState({
    hasExecuted: true,
    trace: sample,
    currentStepIndex: 0,
    prevStepIndex: 0,
    isPlaying: false,
  });

  const t0 = performance.now();
  store.nextStep();
  assert.equal(useLabStore.getState().currentStepIndex, 1);
  store.nextStep();
  assert.equal(useLabStore.getState().currentStepIndex, 2);
  store.prevStep();
  assert.equal(useLabStore.getState().currentStepIndex, 1);
  store.goToStep(0);
  assert.equal(useLabStore.getState().currentStepIndex, 0);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 50, `Expected near-0ms local stepping, took ${elapsed}ms`);
});

test('Execution-aware lineNotes mark skipped branches and skipped closing braces structurally across JS, C++, Java, Python', () => {
  // 1. JavaScript if / else if / else with multi-line closing braces
  const jsCode = `let x = 25;
if (x >= 80) {
  console.log("High");
} else if (x >= 20) {
  console.log("Medium");
} else {
  console.log("Low");
}`;
  const jsTrace = buildFallbackTrace({
    code: jsCode,
    language: 'javascript',
    explainLanguage: 'bn',
    depth: 'detailed',
  });
  const jsNotes = new Map(jsTrace.lineNotes.map((n) => [n.line, n]));
  // Line 3 (skipped console.log("High")) must explicitly state it did not run
  assert.ok(/স্কিপ|চলেনি|প্রবেশ/.test(jsNotes.get(3)!.text), jsNotes.get(3)!.text);
  // Line 6 (} else {) was bypassed because line 4 matched
  assert.ok(/স্কিপ|চলেনি/.test(jsNotes.get(6)!.text), jsNotes.get(6)!.text);
  // Line 8 closes skipped `else` block -> must NOT claim control returns to outer scope
  assert.ok(!/নিয়ন্ত্রণ.*বাইরের/.test(jsNotes.get(8)!.text), jsNotes.get(8)!.text);
  assert.ok(/স্কিপ|সমাপ্তি/.test(jsNotes.get(8)!.text), jsNotes.get(8)!.text);

  // 2. Python indentation block end & skipped elif/else branch
  const pyCode = `marks = 85
if marks >= 80:
    grade = "A+"
else:
    grade = "F"
print(grade)`;
  const pyTrace = buildFallbackTrace({
    code: pyCode,
    language: 'python',
    explainLanguage: 'bn',
    depth: 'detailed',
  });
  const pyNotes = new Map(pyTrace.lineNotes.map((n) => [n.line, n]));
  // Executed if body line 3 ends Python `if` indentation block
  assert.ok(/ইন্ডেন্টেশন|ব্লক/.test(pyNotes.get(3)!.text), pyNotes.get(3)!.text);
  // Skipped else branch line 4 & line 5 must state skipped
  assert.ok(/স্কিপ|চলেনি/.test(pyNotes.get(4)!.text), pyNotes.get(4)!.text);
  assert.ok(/স্কিপ|চলেনি/.test(pyNotes.get(5)!.text), pyNotes.get(5)!.text);

  // 3. C++ block execution helper checks skipped closing brace vs executed closing brace
  const cppCode = `int main() {
    int n = 5;
    if (n > 10) {
        n = 0;
    }
    if (n == 5) {
        n = 6;
    }
    return 0;
}`;
  const cppExecLines = new Set([1, 2, 3, 6, 7, 9]);
  const cppBlocks = analyzeBlockExecution(cppCode, 'cpp', cppExecLines);
  const skippedClose = buildExecutionAwareLineNote({
    lineNumber: 5,
    trimmed: '}',
    language: 'cpp',
    explainLanguage: 'bn',
    executedLines: cppExecLines,
    braceInfo: cppBlocks.braceByCloseLine.get(5),
  });
  const activeClose = buildExecutionAwareLineNote({
    lineNumber: 8,
    trimmed: '}',
    language: 'cpp',
    explainLanguage: 'bn',
    executedLines: cppExecLines,
    braceInfo: cppBlocks.braceByCloseLine.get(8),
  });
  assert.equal(skippedClose.wasExecuted, false);
  assert.ok(/স্কিপ|সমাপ্তি/.test(skippedClose.text));
  assert.ok(!/নিয়ন্ত্রণ.*বাইরের/.test(skippedClose.text));
  assert.equal(activeClose.wasExecuted, true);
  assert.ok(/নিয়ন্ত্রণ.*বাইরের/.test(activeClose.text));
});

test('Dynamic Time & Space Complexity analysis distinguishes O(1), O(n), O(n^2), O(log n), and recursion', () => {
  const seqTrace = buildFallbackTrace({
    code: `let a = 5;\nlet b = 10;\nif (a < b) { console.log(b); }`,
    language: 'javascript',
    explainLanguage: 'bn',
    depth: 'detailed',
  });
  assert.equal(seqTrace.logicSummary.complexity.time, 'O(1)');
  assert.equal(seqTrace.logicSummary.complexity.space, 'O(1)');
  assert.equal(seqTrace.programSummary?.timeComplexity, 'O(1)');

  const singleLoop = analyzeCodeComplexity(
    `for (let i = 0; i < n; i++) {\n  arr.push(i);\n}`,
    'javascript',
    []
  );
  assert.equal(singleLoop.time, 'O(n)');
  assert.equal(singleLoop.space, 'O(n)');

  const nestedLoops = analyzeCodeComplexity(
    `for (int i = 0; i < n; i++) {\n  for (int j = 0; j < n; j++) {\n    sum += i * j;\n  }\n}`,
    'java',
    []
  );
  assert.equal(nestedLoops.time, 'O(n^2)');
  assert.equal(nestedLoops.space, 'O(1)');

  const binSearch = analyzeCodeComplexity(
    `def search(arr, low, high, target):\n    while low <= high:\n        mid = (low + high) // 2\n        if arr[mid] == target:\n            return mid\n    return -1`,
    'python',
    []
  );
  assert.equal(binSearch.time, 'O(log n)');

  const fib = analyzeCodeComplexity(
    `int fib(int n) {\n  if (n <= 1) return n;\n  return fib(n - 1) + fib(n - 2);\n}`,
    'cpp',
    []
  );
  assert.equal(fib.time, 'O(2^n)');
  assert.equal(fib.space, 'O(n)');
});

test('Language-specific pitfalls tailor warnings to Java, C++, Python, and JavaScript constructs', () => {
  const javaMistakes = generateLanguagePitfalls(
    `Scanner sc = new Scanner(System.in);\nint age = sc.nextInt();\nString name = sc.nextLine();\nif (name == "admin") {}`,
    'java',
    'bn'
  );
  assert.ok(javaMistakes.some((m) => /Scanner|nextLine/.test(m)), javaMistakes.join(' | '));
  assert.ok(javaMistakes.some((m) => /\.equals/.test(m)), javaMistakes.join(' | '));

  const cppMistakes = generateLanguagePitfalls(
    `int sum;\nvector<int> arr = {1, 2, 3};\nfor (int i = 0; i <= 3; i++) { sum += arr[i]; }`,
    'cpp',
    'bn'
  );
  assert.ok(cppMistakes.some((m) => /গার্বেজ|প্রাথমিক মান|garbage/i.test(m)), cppMistakes.join(' | '));
  assert.ok(cppMistakes.some((m) => /বাউন্ডস|Undefined Behavior|\.at\(i\)|out-of-bounds/i.test(m)), cppMistakes.join(' | '));

  const pyMistakes = generateLanguagePitfalls(
    `x = input("Enter: ")\nres = 5 / 2\nprint(res)`,
    'python',
    'bn'
  );
  assert.ok(pyMistakes.some((m) => /input\(\)|str/.test(m)), pyMistakes.join(' | '));
  assert.ok(pyMistakes.some((m) => /\/\//.test(m)), pyMistakes.join(' | '));

  const jsMistakes = generateLanguagePitfalls(
    `let a = "5";\nif (a == 5) { console.log(a + 2); }`,
    'javascript',
    'bn'
  );
  assert.ok(jsMistakes.some((m) => /===/.test(m)), jsMistakes.join(' | '));
  assert.ok(jsMistakes.some((m) => /কনক্যাটেনেশন|string/i.test(m)), jsMistakes.join(' | '));
});


