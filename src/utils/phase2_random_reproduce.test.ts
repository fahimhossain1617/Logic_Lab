import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCode, executeCode } from '../../server/src/services/toolchains/toolchainManager';
import { generateExecutionTrace } from '../../server/src/services/geminiTraceService';

test('Phase 2 Mandatory Reproduction: Java Main with Scanner, Random(2026), Collections, ArrayList, HashMap', async () => {
  const code = `import java.util.Scanner;
import java.util.Random;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Collections;
import java.util.Comparator;

public class Main {

    public static void main(String[] args) {

        Scanner input = new Scanner(System.in);
        Random random = new Random(2026);

        ArrayList<Integer> numbers = new ArrayList<>();
        HashMap<String, Integer> frequency = new HashMap<>();

        System.out.print("Enter number of values: ");
        int count = input.nextInt();

        for (int i = 0; i < count; i++) {

            int number = random.nextInt(100) + 1;

            numbers.add(number);

            frequency.put(
                "Range " + ((number - 1) / 10),
                frequency.getOrDefault(
                    "Range " + ((number - 1) / 10), 0
                ) + 1
            );
        }

        Collections.sort(numbers);

        System.out.println("\\nGenerated Numbers:");
        System.out.println(numbers);

        System.out.println("\\nFrequency Distribution:");

        for (String key : frequency.keySet()) {
            System.out.println(key + " : " + frequency.get(key));
        }

        System.out.println("\\nStatistics:");

        int sum = 0;

        for (int number : numbers) {
            sum += number;
        }

        double average = (double) sum / numbers.size();

        System.out.println("Minimum: " + numbers.get(0));
        System.out.println("Maximum: " + numbers.get(numbers.size() - 1));
        System.out.println("Sum: " + sum);
        System.out.println("Average: " + average);

        System.out.println("\\nRandom Selection:");

        int selectedIndex = random.nextInt(numbers.size());

        System.out.println(
            "Selected Number: " + numbers.get(selectedIndex)
        );

        input.close();
    }
}
`;

  // 1. Analyze Code (real-time diagnostics check)
  const analysis = await analyzeCode(code, 'java', 'Main.java');
  assert.equal(analysis.canCompile, true);
  assert.equal(analysis.diagnostics.filter(d => d.severity === 'error').length, 0);

  // 2. Real Execution with stdin "10"
  const exec = await executeCode(code, 'java', '10\n', 6000, 'Main.java');
  assert.equal(exec.status, 'success');
  assert.equal(exec.exitCode, 0);
  assert.ok(exec.stdout.includes('Generated Numbers:'));
  assert.ok(exec.stdout.includes('Frequency Distribution:'));
  assert.ok(exec.stdout.includes('Statistics:'));
  assert.ok(exec.stdout.includes('Selected Number:'));

  // 3. Trace and Animation Generation
  const traceResult = await generateExecutionTrace({
    code,
    language: 'java',
    explainLanguage: 'en',
    depth: 'detailed',
    fileName: 'Main.java',
    stdin: '10\n',
    bypassCache: true,
  });

  assert.equal(traceResult.trace?.hasError, false);
  assert.equal(traceResult.trace?.verdict.status, 'ok');
  assert.ok((traceResult.trace?.steps?.length || 0) > 0);
});

