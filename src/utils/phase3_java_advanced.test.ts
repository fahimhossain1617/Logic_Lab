import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCode, executeCode } from '../../server/src/services/toolchains/toolchainManager';
import { generateExecutionTrace } from '../../server/src/services/geminiTraceService';

test('Phase 3 Java: java.util.HashSet, Stream, and Optional with lambdas', async () => {
  const code = `import java.util.HashSet;
import java.util.stream.Stream;
import java.util.Optional;

public class StreamTest {
    public static void main(String[] args) {
        HashSet<String> set = new HashSet<>();
        set.add("apple");
        set.add("banana");
        Optional<String> first = set.stream().filter(s -> s.startsWith("a")).findFirst();
        System.out.println("Found: " + first.orElse("none"));
    }
}`;

  const analysis = await analyzeCode(code, 'java', 'StreamTest.java');
  assert.equal(analysis.canCompile, true);
  assert.equal(analysis.diagnostics.filter(d => d.severity === 'error').length, 0);

  const exec = await executeCode(code, 'java', '', 4000, 'StreamTest.java');
  assert.equal(exec.status, 'success');
  assert.equal(exec.exitCode, 0);
  assert.ok(exec.stdout.includes('Found: apple'));

  const trace = await generateExecutionTrace({
    code,
    language: 'java',
    explainLanguage: 'en',
    depth: 'detailed',
    fileName: 'StreamTest.java',
    bypassCache: true
  });
  assert.equal(trace.trace?.verdict.status, 'ok');
  assert.equal(trace.trace?.hasError, false);
});

test('Phase 3 Java: java.time.LocalDateTime and java.math.BigDecimal', async () => {
  const code = `import java.time.LocalDateTime;
import java.math.BigDecimal;

public class TimeAndMathTest {
    public static void main(String[] args) {
        LocalDateTime now = LocalDateTime.of(2026, 11, 5, 23, 0);
        BigDecimal price = new BigDecimal("19.99");
        BigDecimal total = price.multiply(new BigDecimal("3"));
        System.out.println("Year: " + now.getYear() + ", Total: " + total);
    }
}`;

  const analysis = await analyzeCode(code, 'java', 'TimeAndMathTest.java');
  assert.equal(analysis.canCompile, true);

  const exec = await executeCode(code, 'java', '', 4000, 'TimeAndMathTest.java');
  assert.equal(exec.status, 'success');
  assert.equal(exec.exitCode, 0);
  assert.ok(exec.stdout.includes('Year: 2026, Total: 59.97'));
});

test('Phase 3 Java: java.io.File and java.nio.file.Paths', async () => {
  const code = `import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;

public class PathTest {
    public static void main(String[] args) {
        File f = new File("example.txt");
        Path p = Paths.get("data", "subfolder");
        System.out.println("File: " + f.getName() + ", Path: " + p.getFileName());
    }
}`;

  const analysis = await analyzeCode(code, 'java', 'PathTest.java');
  assert.equal(analysis.canCompile, true);

  const exec = await executeCode(code, 'java', '', 4000, 'PathTest.java');
  assert.equal(exec.status, 'success');
  assert.equal(exec.exitCode, 0);
  assert.ok(exec.stdout.includes('File: example.txt'));
});

test('Phase 3 Java: Interfaces, Generics, Polymorphism, and Lambdas', async () => {
  const code = `interface Operation<T> {
    T apply(T a, T b);
}

class Multiplier implements Operation<Integer> {
    public Integer apply(Integer a, Integer b) {
        return a * b;
    }
}

public class OopTest {
    public static void main(String[] args) {
        Operation<Integer> op1 = new Multiplier();
        Operation<Integer> op2 = (x, y) -> x + y;
        System.out.println("Mult: " + op1.apply(4, 5) + ", Add: " + op2.apply(4, 5));
    }
}`;

  const analysis = await analyzeCode(code, 'java', 'OopTest.java');
  assert.equal(analysis.canCompile, true);

  const exec = await executeCode(code, 'java', '', 4000, 'OopTest.java');
  assert.equal(exec.status, 'success');
  assert.equal(exec.exitCode, 0);
  assert.ok(exec.stdout.includes('Mult: 20, Add: 9'));
});

test('Phase 3 Java: Filename mismatch for public class reports error', async () => {
  const code = `public class CorrectName {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}`;

  // Providing WrongFile.java for public class CorrectName
  const analysis = await analyzeCode(code, 'java', 'WrongFile.java');
  assert.equal(analysis.canCompile, false);
  assert.ok(analysis.diagnostics.length > 0);
  assert.ok(analysis.diagnostics[0].message.toLowerCase().includes('correctname') || analysis.diagnostics[0].message.toLowerCase().includes('file'));
});

