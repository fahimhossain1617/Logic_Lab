import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';

const TEST_PORT = 3125;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

async function setFileAndCode(
  page: Page,
  language: 'java' | 'javascript' | 'cpp' | 'python',
  fileName: string,
  code: string
) {
  await page.waitForFunction(() => Boolean((window as any).__monacoEditor), { timeout: 15000 });
  await page.selectOption('#editor-language-select', language);
  const fnInput = page.locator('[data-testid="file-name-input"]');
  await fnInput.fill(fileName);

  await page.evaluate(({ newCode }) => {
    const ed = (window as any).__monacoEditor;
    if (ed) ed.setValue(newCode);
    const store = (window as any).__useLabStore;
    if (store?.getState) store.getState().setCode(newCode);
  }, { newCode: code });
  await page.waitForTimeout(450);
}

async function runFastAndWait(page: Page, timeoutMs = 20000) {
  await page.locator('[data-testid="fast-run-btn"]').click();
  await page.waitForFunction(
    () => {
      const store = (window as any).__useLabStore?.getState?.();
      if (!store) return false;
      return !store.isFastRunning && store.terminalExecState !== 'RUNNING' && store.terminalExecState !== 'COMPILING';
    },
    { timeout: timeoutMs }
  );
  await page.waitForTimeout(150);
}

async function runVisualizeAndWait(page: Page, timeoutMs = 25000) {
  await page.locator('[data-testid="visualize-primary-btn"]').click();
  await page.waitForFunction(
    () => {
      const store = (window as any).__useLabStore?.getState?.();
      return Boolean(store && !store.isTracing && store.hasExecuted);
    },
    { timeout: timeoutMs }
  );
  await page.waitForTimeout(150);
}

function killServerTree(proc: ChildProcess | null) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {
      proc.kill('SIGKILL');
    }
  }
}

test('Browser E2E Regression Suite across Java, JavaScript, C++, Python, STDIN, Errors & Multi-Tab Isolation', async () => {
  const serverProc = spawn('cmd.exe', ['/c', 'npx tsx server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), GEMINI_API_KEY: '' },
    stdio: 'pipe',
  });

  let ready = false;
  for (let i = 0; i < 35; i++) {
    try {
      const r = await fetch(`${BASE_URL}/api/health`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, `Test server failed to start on ${BASE_URL}`);

  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page: Page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#editor-language-select', { timeout: 15000 });

    // 1. Language selector automatically updates extension
    await page.selectOption('#editor-language-select', 'python');
    assert.ok((await page.locator('[data-testid="file-name-input"]').inputValue()).endsWith('.py'));
    await page.selectOption('#editor-language-select', 'cpp');
    assert.ok((await page.locator('[data-testid="file-name-input"]').inputValue()).endsWith('.cpp'));
    await page.selectOption('#editor-language-select', 'java');
    assert.ok((await page.locator('[data-testid="file-name-input"]').inputValue()).endsWith('.java'));

    // 2. Java custom filename + package declaration via Fast Run + Visualize
    await setFileAndCode(
      page,
      'java',
      'StudentReport.java',
      `package edu.logiclab;\npublic class StudentReport {\n  public static void main(String[] args) {\n    System.out.println("E2E_JAVA_PKG_OK:" + (6 * 7));\n  }\n}`
    );
    assert.equal(await page.locator('[data-testid="file-name-input"]').inputValue(), 'StudentReport.java');
    await runFastAndWait(page);
    const javaOut = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(javaOut.includes('E2E_JAVA_PKG_OK:42'), `Expected Java output, got: ${javaOut}`);

    // 3. JavaScript ESM (.mjs) + Visualize
    await page.locator('[data-testid="new-user-file-btn"]').click();
    await setFileAndCode(
      page,
      'javascript',
      'esm-calc.mjs',
      `import path from 'node:path';\nconsole.log("E2E_JS_ESM:" + path.basename('/a/b/demo.mjs'));`
    );
    await runVisualizeAndWait(page);
    const jsOut = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(jsOut.includes('E2E_JS_ESM:demo.mjs'), `Expected JS output, got: ${jsOut}`);

    // 4. C++ with spaced custom filename
    await page.locator('[data-testid="new-user-file-btn"]').click();
    await setFileAndCode(
      page,
      'cpp',
      'vector ops.cpp',
      `#include <iostream>\n#include <vector>\nint main() {\n  std::vector<int> v = {10, 20, 12};\n  std::cout << "E2E_CPP_SUM:" << (v[0] + v[1] + v[2]) << std::endl;\n  return 0;\n}`
    );
    await runFastAndWait(page, 25000);
    const cppOut = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(cppOut.includes('E2E_CPP_SUM:42'), `Expected C++ output, got: ${cppOut}`);

    // 5. Python with STDIN tab & Unicode output
    await page.locator('[data-testid="new-user-file-btn"]').click();
    await setFileAndCode(
      page,
      'python',
      'grader.py',
      `name = input()\nprint(f"E2E_PY:{name}")`
    );
    await page.locator('[data-testid="tab-stdin"]').click();
    await page.locator('[data-testid="console-stdin-input"]').fill('বাংলা_User');
    await page.locator('[data-testid="tab-program-output"]').click();
    await runFastAndWait(page);
    const pyOut = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(pyOut.includes('E2E_PY:বাংলা_User'), `Expected Python STDIN Unicode output, got: ${pyOut}`);

    // 6. Tab isolation check: switch back to StudentReport.java and confirm its code & output were NOT replaced by Python
    await page.locator('button:has-text("StudentReport.java")').first().click();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-testid="file-name-input"]').inputValue(), 'StudentReport.java');
    assert.equal(await page.locator('#editor-language-select').inputValue(), 'java');
    const restoredJavaOut = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(restoredJavaOut.includes('E2E_JAVA_PKG_OK:42'), 'Switching back to tab 1 must restore tab 1 output');

    // 7. Compile error display & Problems tab
    await page.locator('[data-testid="new-user-file-btn"]').click();
    await setFileAndCode(
      page,
      'java',
      'BrokenApp.java',
      `public class BrokenApp {\n  public static void main(String[] args) {\n    int broken = 10\n  }\n}`
    );
    await page.locator('[data-testid="tab-problems"]').click();
    await page.waitForFunction(
      () => {
        const text = document.querySelector('[data-testid="real-output-section"]')?.textContent || '';
        return text.includes('BrokenApp.java') && (text.includes(';') || text.toLowerCase().includes('expected'));
      },
      { timeout: 8000 }
    );
    const probText = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(probText.includes('BrokenApp.java'), `Expected BrokenApp.java in diagnostics, got: ${probText}`);
    await page.locator('[data-testid="tab-program-output"]').click();
    await runVisualizeAndWait(page);
    const errVisible = await page.locator('[data-testid="output-error-state"]').isVisible();
    assert.equal(errVisible, true, 'Compilation error banner must be displayed on invalid Java code');

    // 8. Responsive auto-expanding file tab input & extensionless PalindromeChecker Java execution
    await page.locator('[data-testid="new-user-file-btn"]').click();
    await page.selectOption('#editor-language-select', 'java');
    const fnInput = page.locator('[data-testid="file-name-input"]');
    await fnInput.fill('Main');
    const shortWidth = await fnInput.evaluate((el) => el.getBoundingClientRect().width);

    await fnInput.fill('BinarySearchTreeExample.java');
    const longMetrics = await fnInput.evaluate((el) => {
      const inp = el as HTMLInputElement;
      return {
        width: inp.getBoundingClientRect().width,
        clientWidth: inp.clientWidth,
        scrollWidth: inp.scrollWidth,
      };
    });
    assert.ok(
      longMetrics.width > shortWidth + 60,
      `Expected long filename input width (${longMetrics.width}px) to expand significantly beyond short filename width (${shortWidth}px)`
    );
    assert.ok(
      longMetrics.scrollWidth <= longMetrics.clientWidth + 2,
      `Expected zero horizontal clipping on long filename (scrollWidth=${longMetrics.scrollWidth}, clientWidth=${longMetrics.clientWidth})`
    );

    // Extensionless "PalindromeChecker" tab name + public class PalindromeChecker execution
    await setFileAndCode(
      page,
      'java',
      'PalindromeChecker',
      `public class PalindromeChecker {\n  public static boolean isPalindrome(String str) {\n    String clean = str.replaceAll("[^a-zA-Z0-9]", "").toLowerCase();\n    String reversed = new StringBuilder(clean).reverse().toString();\n    return clean.equals(reversed);\n  }\n  public static void main(String[] args) {\n    String word = "Level";\n    System.out.println(word + " কি প্যালিনড্রোম? " + isPalindrome(word));\n  }\n}`
    );
    await runFastAndWait(page);
    assert.equal(await fnInput.inputValue(), 'PalindromeChecker.java');
    const palOut = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(
      palOut.includes('Level কি প্যালিনড্রোম? true'),
      `Expected PalindromeChecker output, got: ${palOut}`
    );
  } finally {
    await browser.close();
    killServerTree(serverProc);
  }
});

