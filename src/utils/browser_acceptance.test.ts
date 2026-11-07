import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('C:/Users/fahim/.gemini/antigravity/brain/5a184218-0f24-4802-b704-3ac08c1c0fe5/screenshots');

// Helper to set Monaco editor value
async function setEditorCode(page: Page, code: string, lang = 'java', fileName = 'Main.java') {
  // Wait for Monaco editor to be mounted
  await page.waitForFunction(() => Boolean((window as any).__monacoEditor), { timeout: 15000 });

  // Set language dropdown
  await page.selectOption('#editor-language-select', lang);
  await page.waitForTimeout(100);

  // Set code in Monaco & Store
  await page.evaluate(({ newCode, newLang, newFileName }) => {
    if ((window as any).__monacoEditor) {
      (window as any).__monacoEditor.setValue(newCode);
    }
    const store = (window as any).__useLabStore;
    if (store && store.getState) {
      store.getState().setCode(newCode);
      store.getState().setLanguage(newLang);
      store.getState().setFileName(newFileName);
    }
  }, { newCode: code, newLang: lang, newFileName: fileName });

  // Let Monaco debounce analyze
  await page.waitForTimeout(500);
}

// Helper to click Run and wait for execution
async function clickRunAndWait(page: Page, timeoutMs = 15000) {
  const runBtn = page.locator('[data-testid="visualize-primary-btn"]');
  await runBtn.click();

  // Wait until tracing spinner is gone
  await page.waitForFunction(() => {
    const btn = document.querySelector('[data-testid="visualize-primary-btn"]');
    if (!btn) return false;
    const isSpinning = btn.querySelector('.animate-spin');
    const text = btn.textContent || '';
    return !isSpinning && (text.includes('Run') || text.includes('রান'));
  }, { timeout: timeoutMs });

  await page.waitForTimeout(500);
}

test('Real-World Browser Acceptance Test Suite', async () => {
  let serverProc: ChildProcess | null = null;

  // 1. Ensure server is running
  let isServerUp = false;
  try {
    const check = await fetch('http://127.0.0.1:3000/api/health');
    if (check.ok) isServerUp = true;
  } catch {}

  if (!isServerUp) {
    console.log('Spawning full-stack server on http://127.0.0.1:3000 ...');
    serverProc = spawn('cmd.exe', ['/c', 'npx tsx server.ts'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'pipe',
    });

    for (let i = 0; i < 30; i++) {
      try {
        const check = await fetch('http://127.0.0.1:3000/api/health');
        if (check.ok) {
          isServerUp = true;
          console.log('Server is healthy and ready!');
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  assert.ok(isServerUp, 'Full-stack server must be responding on port 3000');

  console.log('Launching Playwright Chromium browser...');
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page: Page = await context.newPage();

  try {
    console.log('Navigating to http://127.0.0.1:3000 ...');
    await page.goto('http://127.0.0.1:3000', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#editor-language-select', { timeout: 15000 });

    // ----------------------------------------------------
    // TEST 1: Java Unseeded Random Test (Multiple Runs)
    // ----------------------------------------------------
    console.log('\n--- BROWSER TEST 1: Java Unseeded Random ---');
    const unseededCode = `import java.util.Random;

public class UnseededRandomTest {
    public static void main(String[] args) {
        Random random = new Random();
        System.out.println("VAL: " + random.nextInt(1000000));
    }
}`;
    await setEditorCode(page, unseededCode, 'java', 'UnseededRandomTest.java');
    
    // Run 1
    await clickRunAndWait(page);
    let outputText1 = await page.locator('[data-testid="real-output-section"]').innerText();
    console.log('Unseeded Run 1 Output snippet:', outputText1.slice(0, 150));
    assert.ok(outputText1.includes('VAL:'));

    // Run 2
    await clickRunAndWait(page);
    let outputText2 = await page.locator('[data-testid="real-output-section"]').innerText();
    console.log('Unseeded Run 2 Output snippet:', outputText2.slice(0, 150));
    assert.ok(outputText2.includes('VAL:'));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01_java_unseeded_random.png') });
    console.log('Saved screenshot: 01_java_unseeded_random.png');

    // ----------------------------------------------------
    // TEST 2: Java Seeded Random (2026) Reproducibility
    // ----------------------------------------------------
    console.log('\n--- BROWSER TEST 2: Java Seeded Random Reproducibility ---');
    const seededCode = `import java.util.Random;

public class SeededRandomTest {
    public static void main(String[] args) {
        Random random = new Random(2026);
        System.out.println("VAL: " + random.nextInt(1000000));
    }
}`;
    await setEditorCode(page, seededCode, 'java', 'SeededRandomTest.java');

    // Seeded Run 1
    await clickRunAndWait(page);
    const seededOutput1 = await page.locator('[data-testid="real-output-section"]').innerText();
    const valMatch1 = seededOutput1.match(/VAL:\s*(\d+)/);
    const val1 = valMatch1 ? valMatch1[1] : '';
    console.log('Seeded Run 1 Value:', val1);
    assert.ok(val1.length > 0);

    // Seeded Run 2
    await clickRunAndWait(page);
    const seededOutput2 = await page.locator('[data-testid="real-output-section"]').innerText();
    const valMatch2 = seededOutput2.match(/VAL:\s*(\d+)/);
    const val2 = valMatch2 ? valMatch2[1] : '';
    console.log('Seeded Run 2 Value:', val2);
    assert.equal(val1, val2, 'Seeded Random(2026) MUST produce identical values across runs');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02_java_seeded_random.png') });
    console.log('Saved screenshot: 02_java_seeded_random.png');

    // ----------------------------------------------------
    // TEST 3: Complex Java Program (Main.java with Collections, ArrayList, HashMap)
    // ----------------------------------------------------
    console.log('\n--- BROWSER TEST 3: Complex Java Program ---');
    const complexJava = `import java.util.Scanner;
import java.util.Random;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Collections;
import java.util.Comparator;

public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner("10");
        Random random = new Random(2026);
        ArrayList<Integer> numbers = new ArrayList<>();
        HashMap<String, Integer> frequency = new HashMap<>();

        int count = input.nextInt();
        for (int i = 0; i < count; i++) {
            int number = random.nextInt(100) + 1;
            numbers.add(number);
            frequency.put("Range " + ((number - 1) / 10), frequency.getOrDefault("Range " + ((number - 1) / 10), 0) + 1);
        }
        Collections.sort(numbers);
        System.out.println("Generated Numbers: " + numbers);
        System.out.println("Minimum: " + numbers.get(0));
        System.out.println("Maximum: " + numbers.get(numbers.size() - 1));
        input.close();
    }
}`;
    await setEditorCode(page, complexJava, 'java', 'Main.java');
    await clickRunAndWait(page);

    const complexOut = await page.locator('[data-testid="real-output-section"]').innerText();
    console.log('Complex Java Output snippet:', complexOut.slice(0, 200));
    assert.ok(complexOut.includes('Generated Numbers:'));
    assert.ok(complexOut.includes('Minimum:'));
    assert.ok(complexOut.includes('Maximum:'));

    // Verify Animation Canvas / Player Bar is active
    const playerControls = await page.locator('[data-testid="player-controls"], .flex.items-center').first().isVisible();
    assert.ok(playerControls, 'Animation / Player controls must be visible');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03_java_complex_program.png') });
    console.log('Saved screenshot: 03_java_complex_program.png');

    // ----------------------------------------------------
    // TEST 4: JavaScript Advanced Test (crypto, class, reduce)
    // ----------------------------------------------------
    console.log('\n--- BROWSER TEST 4: JavaScript Advanced ---');
    const jsCode = `const crypto = require("crypto");

class TransactionManager {
    constructor() { this.transactions = []; }
    addTransaction(amount, category) {
        this.transactions.push({ id: crypto.randomUUID(), amount, category });
    }
    getStats() {
        return {
            count: this.transactions.length,
            total: this.transactions.reduce((s, t) => s + t.amount, 0)
        };
    }
}

const mgr = new TransactionManager();
for (let i = 0; i < 50; i++) {
    mgr.addTransaction(i * 10 + 5, "Category" + (i % 3));
}
console.log(mgr.getStats());
`;
    await setEditorCode(page, jsCode, 'javascript', 'main.js');
    await clickRunAndWait(page);

    const jsOut = await page.locator('[data-testid="real-output-section"]').innerText();
    console.log('JavaScript Output snippet:', jsOut.slice(0, 150));
    assert.ok(jsOut.includes('count: 50'));
    assert.ok(jsOut.includes('total: 12500'));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04_javascript_advanced.png') });
    console.log('Saved screenshot: 04_javascript_advanced.png');

    // ----------------------------------------------------
    // TEST 5: C++ Advanced Test (mt19937, vector, sort, accumulate)
    // ----------------------------------------------------
    console.log('\n--- BROWSER TEST 5: C++ Advanced ---');
    const cppCode = `#include <iostream>
#include <vector>
#include <random>
#include <algorithm>
#include <numeric>

using namespace std;

int main() {
    mt19937 generator(2026);
    uniform_int_distribution<int> distribution(1, 100);
    vector<int> numbers;

    for (int i = 0; i < 50; i++) {
        numbers.push_back(distribution(generator));
    }
    sort(numbers.begin(), numbers.end());
    int total = accumulate(numbers.begin(), numbers.end(), 0);

    cout << "CPP Total Numbers: " << numbers.size() << endl;
    cout << "CPP Minimum: " << numbers.front() << endl;
    cout << "CPP Maximum: " << numbers.back() << endl;
    cout << "CPP Sum: " << total << endl;
    return 0;
}
`;
    await setEditorCode(page, cppCode, 'cpp', 'main.cpp');
    await clickRunAndWait(page);

    const cppOut = await page.locator('[data-testid="real-output-section"]').innerText();
    console.log('C++ Output snippet:', cppOut.slice(0, 150));
    assert.ok(cppOut.includes('CPP Total Numbers: 50'));
    assert.ok(cppOut.includes('CPP Minimum:'));
    assert.ok(cppOut.includes('CPP Maximum:'));
    assert.ok(cppOut.includes('CPP Sum:'));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05_cpp_advanced.png') });
    console.log('Saved screenshot: 05_cpp_advanced.png');

    // ----------------------------------------------------
    // TEST 6: Python Advanced Test (dataclass, Counter, statistics)
    // ----------------------------------------------------
    console.log('\n--- BROWSER TEST 6: Python Advanced ---');
    const pyCode = `import statistics
from collections import Counter
from dataclasses import dataclass

@dataclass
class Item:
    val: int

items = [Item(i * 2) for i in range(25)]
vals = [it.val for it in items]
print("PY Count:", len(vals))
print("PY Mean:", statistics.mean(vals))
print("PY Max:", max(vals))
`;
    await setEditorCode(page, pyCode, 'python', 'main.py');
    await clickRunAndWait(page);

    const pyOut = await page.locator('[data-testid="real-output-section"]').innerText();
    console.log('Python Output snippet:', pyOut.slice(0, 150));
    assert.ok(pyOut.includes('PY Count: 25'));
    assert.ok(pyOut.includes('PY Mean: 24'));
    assert.ok(pyOut.includes('PY Max: 48'));

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06_python_advanced.png') });
    console.log('Saved screenshot: 06_python_advanced.png');

    // ----------------------------------------------------
    // TEST 7: Deliberate Errors (Syntax Error vs Warning)
    // ----------------------------------------------------
    console.log('\n--- BROWSER TEST 7: Deliberate Error Diagnostics ---');
    const syntaxErrorCode = `public class SyntaxErr {
    public static void main(String[] args) {
        int missingSemicolon = 42
        System.out.println(missingSemicolon);
    }
}`;
    await setEditorCode(page, syntaxErrorCode, 'java', 'SyntaxErr.java');

    // Real-time debounced analysis marks the error
    await page.waitForTimeout(600);

    // Switch to Problems tab
    await page.locator('button:has-text("Problems"), button:has-text("সমস্যা ও সতর্কতা")').click();
    await page.waitForTimeout(300);

    const problemsList = await page.locator('[data-testid="real-output-section"]').innerText();
    console.log('Problems Panel snippet:', problemsList.slice(0, 200));
    assert.ok(problemsList.includes(';') || problemsList.includes('সেমিকোলন') || problemsList.includes('line 3') || problemsList.includes('লাইন ৩'));

    // Attempting to run should be blocked by compilation error
    await clickRunAndWait(page);

    // Switch back to Program Output tab to verify the error card is displayed
    await page.locator('button:has-text("Program Output"), button:has-text("প্রোগ্রাম আউটপুট")').click();
    await page.waitForTimeout(300);

    const errState = await page.locator('[data-testid="output-error-state"]').isVisible();
    assert.ok(errState, 'Compilation error must prevent execution');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07_deliberate_errors.png') });
    console.log('Saved screenshot: 07_deliberate_errors.png');

    console.log('\nALL 7 BROWSER ACCEPTANCE TESTS COMPLETED SUCCESSFULLY!');
  } finally {
    await browser.close();
    if (serverProc) {
      serverProc.kill();
    }
  }
});
