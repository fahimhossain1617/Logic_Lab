import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';

const TEST_PORT = 3129;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

const BANK_MANAGEMENT_JAVA = `import java.util.Scanner;

public class BankManagementSystem {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        String accountHolder = "Fahim";
        int balance = 5000;
        int choice;

        do {
            System.out.println("1. Deposit Money");
            System.out.println("2. Withdraw Money");
            System.out.println("3. Check Balance");
            System.out.println("4. Exit");
            System.out.print("Enter your choice: ");

            choice = input.nextInt();

            switch (choice) {
                case 1:
                    System.out.print("Enter deposit amount: ");
                    int deposit = input.nextInt();
                    if (deposit > 0) {
                        balance += deposit;
                        System.out.println("Deposit successful. Updated balance: " + balance);
                    }
                    break;
                case 2:
                    System.out.print("Enter withdraw amount: ");
                    int withdraw = input.nextInt();
                    if (withdraw > balance) {
                        System.out.println("Insufficient balance.");
                    } else if (withdraw > 0) {
                        balance -= withdraw;
                        System.out.println("Withdrawal successful. Updated balance: " + balance);
                    }
                    break;
                case 3:
                    System.out.println("Account Holder: " + accountHolder);
                    System.out.println("Balance: " + balance);
                    break;
                case 4:
                    System.out.println("Exiting...");
                    break;
                default:
                    System.out.println("Invalid choice.");
            }
        } while (choice != 4);

        input.close();
    }
}`;

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

async function setFileAndCode(
  page: Page,
  language: 'java' | 'javascript' | 'cpp' | 'python',
  fileName: string,
  code: string
) {
  await page.waitForFunction(() => Boolean((window as any).__monacoEditor), { timeout: 15000 });
  await page.selectOption('#editor-language-select', language);
  await page.locator('[data-testid="file-name-input"]').fill(fileName);
  await page.evaluate(({ newCode }) => {
    const ed = (window as any).__monacoEditor;
    if (ed) ed.setValue(newCode);
    const store = (window as any).__useLabStore;
    if (store?.getState) store.getState().setCode(newCode);
  }, { newCode: code });
  await page.waitForTimeout(300);
}

async function runFastAndWaitFinish(page: Page, timeoutMs = 20000) {
  await page.locator('[data-testid="fast-run-btn"]').click();
  await page.waitForFunction(
    () => {
      const s = (window as any).__useLabStore?.getState?.();
      if (!s) return false;
      return !s.isFastRunning && s.terminalExecState !== 'RUNNING' && s.terminalExecState !== 'COMPILING';
    },
    { timeout: timeoutMs }
  );
  await page.waitForTimeout(150);
}

test('Browser E2E: Batch STDIN across 4 languages, BankManagementSystem (batch + interactive + EOF ordering), Error Distinction', async () => {
  const serverProc = spawn('cmd.exe', ['/c', 'npx tsx server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(TEST_PORT), GEMINI_API_KEY: '' },
    stdio: 'pipe',
  });

  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE_URL}/api/health`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.ok(ready, `Server failed to start on ${BASE_URL}`);

  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page: Page = await context.newPage();

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#editor-language-select', { timeout: 15000 });

    // Switch to English UI labels cleanly via store so status badge assertions match unambiguously
    await page.evaluate(() => {
      const s = (window as any).__useLabStore?.getState?.();
      if (s?.setExplainLanguage) s.setExplainLanguage('en');
    });

    // 1. BankManagementSystem Batch Test: 1 -> 1000 -> 3 -> 4
    await setFileAndCode(page, 'java', 'BankManagementSystem.java', BANK_MANAGEMENT_JAVA);
    await page.locator('[data-testid="tab-stdin"]').click();
    await page.locator('[data-testid="console-stdin-input"]').fill('1\n1000\n3\n4');
    await page.locator('[data-testid="tab-program-output"]').click();
    await runFastAndWaitFinish(page);

    const depositOut = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(depositOut.includes('Balance: 6000'), `Expected Balance: 6000, got:\n${depositOut}`);
    assert.equal(await page.locator('[data-testid="console-status-badge"]').innerText(), 'Success');

    // 2. Partial Batch STDIN ("3") -> Input Error (NOT Compile Error) and "Enter your choice:" BEFORE NoSuchElementException
    await page.locator('[data-testid="tab-stdin"]').click();
    await page.locator('[data-testid="console-stdin-input"]').fill('3');
    await page.locator('[data-testid="tab-program-output"]').click();
    await runFastAndWaitFinish(page);

    const partialOut = await page.locator('[data-testid="real-output-section"]').innerText();
    const badge = await page.locator('[data-testid="console-status-badge"]').innerText();
    assert.equal(badge, 'Input Error', `Expected "Input Error" badge, got: ${badge}`);
    assert.equal(await page.locator('[data-testid="input-error-diagnostic"]').isVisible(), true);
    const choiceIdx = partialOut.lastIndexOf('Enter your choice:');
    const exIdx = partialOut.indexOf('NoSuchElementException');
    assert.ok(choiceIdx >= 0 && exIdx > choiceIdx, `Prompt must appear BEFORE exception! Output:\n${partialOut}`);

    // 3. Interactive Mode (empty STDIN -> inline terminal prompts: 3, 4)
    await page.locator('[data-testid="tab-stdin"]').click();
    await page.locator('[data-testid="console-stdin-input"]').fill('');
    await page.locator('[data-testid="tab-program-output"]').click();
    await page.locator('[data-testid="fast-run-btn"]').click();

    await page.waitForSelector('[data-testid="terminal-inline-input"]', { timeout: 10000 });
    await page.locator('[data-testid="terminal-inline-input"]').fill('3');
    await page.locator('[data-testid="terminal-inline-input"]').press('Enter');

    await page.waitForSelector('[data-testid="terminal-inline-input"]', { timeout: 10000 });
    await page.locator('[data-testid="terminal-inline-input"]').fill('4');
    await page.locator('[data-testid="terminal-inline-input"]').press('Enter');

    await page.waitForFunction(
      () => (window as any).__useLabStore?.getState?.().terminalExecState === 'COMPLETED',
      { timeout: 10000 }
    );
    const interOut = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(interOut.includes('Balance: 5000'));
    assert.ok(interOut.includes('Exiting...'));
    // Must not leak previous interactive inputs into STDIN textarea
    await page.locator('[data-testid="tab-stdin"]').click();
    assert.equal(await page.locator('[data-testid="console-stdin-input"]').inputValue(), '');

    // 4. JavaScript fs.readFileSync(0, "utf8") Batch STDIN
    await page.locator('[data-testid="console-stdin-input"]').fill('Fahim\n21');
    await setFileAndCode(
      page,
      'javascript',
      'main.js',
      `const fs = require("fs");\nconst input = fs.readFileSync(0, "utf8").trim().split(/\\r?\\n/);\nconsole.log("Hello " + input[0]);\nconsole.log("Age: " + Number(input[1]));`
    );
    // Manual STDIN must still be preserved after switching language & setting code!
    assert.equal(await page.locator('[data-testid="console-stdin-input"]').inputValue(), 'Fahim\n21');
    await page.locator('[data-testid="tab-program-output"]').click();
    await runFastAndWaitFinish(page);
    const jsOut = await page.locator('[data-testid="real-output-section"]').innerText();
    assert.ok(jsOut.includes('Hello Fahim') && jsOut.includes('Age: 21'), `Expected JS output, got:\n${jsOut}`);
    assert.equal(await page.locator('[data-testid="console-status-badge"]').innerText(), 'Success');

    // 5. Runtime error vs Compile error badge distinction
    await setFileAndCode(
      page,
      'python',
      'divzero.py',
      `print(10 / 0)`
    );
    await runFastAndWaitFinish(page);
    assert.equal(await page.locator('[data-testid="console-status-badge"]').innerText(), 'Runtime Error');

    await setFileAndCode(
      page,
      'java',
      'BadSyntax.java',
      `public class BadSyntax { public static void main(String[] args) { int x = 5 } }`
    );
    await runFastAndWaitFinish(page);
    assert.equal(await page.locator('[data-testid="console-status-badge"]').innerText(), 'Compile Error');
  } finally {
    await browser.close();
    killServerTree(serverProc);
  }
});
