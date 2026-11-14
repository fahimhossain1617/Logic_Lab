import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCoreExpressApp } from '../../server/src/app';
import { useLabStore } from '../store/useLabStore';
import { classifyErrorCategory } from '../../shared/stdinHelper';
import { buildRemoteToolchainResult } from '../../server/src/services/toolchains/remoteSandbox';

const JAVA_PART4 = `import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);

        System.out.print("Enter your name: ");
        String name = sc.nextLine();

        System.out.print("Enter your age: ");
        int age = sc.nextInt();

        System.out.println("Hello " + name);
        System.out.println("Age: " + age);

        sc.close();
    }
}`;

const CPP_PART4 = `#include <iostream>
#include <string>
using namespace std;

int main() {
    string name;
    int age;

    cout << "Enter your name: ";
    getline(cin, name);

    cout << "Enter your age: ";
    cin >> age;

    cout << "Hello " << name << endl;
    cout << "Age: " << age << endl;

    return 0;
}`;

const PYTHON_PART4 = `name = input("Enter your name: ")
age = int(input("Enter your age: "))

print("Hello", name)
print("Age:", age)`;

const JS_PART4 = `const fs = require("fs");

const input = fs.readFileSync(0, "utf8").trim().split(/\\r?\\n/);

const name = input[0];
const age = Number(input[1]);

console.log("Hello " + name);
console.log("Age: " + age);`;

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

interface SseCollectResult {
  events: Array<{ type: string; data: any }>;
  exitData: any;
  stdout: string;
  stderr: string;
}

async function consumeSseSession(
  baseUrl: string,
  sessionId: string,
  onPrompt?: (promptCount: number, send: (line: string, eof?: boolean) => Promise<void>) => Promise<void>
): Promise<SseCollectResult> {
  const res = await fetch(`${baseUrl}/api/execute/stream/${encodeURIComponent(sessionId)}`);
  assert.equal(res.ok, true);
  assert.ok(res.body);

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf8');
  let buffer = '';
  const events: Array<{ type: string; data: any }> = [];
  let stdout = '';
  let stderr = '';
  let exitData: any = null;
  let promptCount = 0;

  const send = async (line: string, eof = false) => {
    const r = await fetch(`${baseUrl}/api/execute/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, input: line, eof }),
    });
    assert.equal(r.ok, true);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawBlock = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const lines = rawBlock.split(/\r?\n/);
      let evType = 'message';
      let evDataStr = '';
      for (const l of lines) {
        if (l.startsWith('event:')) evType = l.slice(6).trim();
        else if (l.startsWith('data:')) evDataStr += l.slice(5).trim();
      }
      if (!evDataStr) continue;
      const data = JSON.parse(evDataStr);
      events.push({ type: evType, data });
      if (evType === 'stdout' && data.text) stdout += data.text;
      if (evType === 'stderr' && data.text) stderr += data.text;
      if (evType === 'prompt' && onPrompt) {
        promptCount += 1;
        await onPrompt(promptCount, send);
      }
      if (evType === 'exit') {
        exitData = data;
      }
    }
  }

  return { events, exitData, stdout, stderr };
}

async function runViaStartEndpoint(
  baseUrl: string,
  body: {
    code: string;
    language: 'java' | 'cpp' | 'python' | 'javascript';
    fileName?: string;
    stdin?: string;
    stdinMode?: 'auto' | 'batch' | 'interactive';
  },
  onPrompt?: (promptCount: number, send: (line: string, eof?: boolean) => Promise<void>) => Promise<void>
): Promise<{ startData: any; sse?: SseCollectResult }> {
  const startRes = await fetch(`${baseUrl}/api/execute/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const startData = (await startRes.json()) as any;
  if (!startData.ok || !startData.sessionId) {
    return { startData };
  }
  const sse = await consumeSseSession(baseUrl, startData.sessionId, onPrompt);
  return { startData, sse };
}

test('Part 4: Batch STDIN works across Java, C++, Python, and JavaScript (including fs.readFileSync(0))', async () => {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const stdin = 'Fahim\n21';

  try {
    // 1. Java via /api/execute and /api/execute/start
    const javaStart = await runViaStartEndpoint(baseUrl, {
      code: JAVA_PART4,
      language: 'java',
      fileName: 'Main.java',
      stdin,
    });
    assert.equal(javaStart.startData.ok, true);
    assert.equal(javaStart.sse?.exitData?.success, true);
    assert.ok(javaStart.sse?.stdout.includes('Hello Fahim'));
    assert.ok(javaStart.sse?.stdout.includes('Age: 21'));

    // 2. C++ via /api/execute/start
    const cppStart = await runViaStartEndpoint(baseUrl, {
      code: CPP_PART4,
      language: 'cpp',
      fileName: 'main.cpp',
      stdin,
    });
    assert.equal(cppStart.startData.ok, true);
    assert.equal(cppStart.sse?.exitData?.success, true);
    assert.ok(cppStart.sse?.stdout.includes('Hello Fahim'));
    assert.ok(cppStart.sse?.stdout.includes('Age: 21'));

    // 3. Python via /api/execute/start
    const pyStart = await runViaStartEndpoint(baseUrl, {
      code: PYTHON_PART4,
      language: 'python',
      fileName: 'main.py',
      stdin,
    });
    assert.equal(pyStart.startData.ok, true);
    assert.equal(pyStart.sse?.exitData?.success, true);
    assert.ok(pyStart.sse?.stdout.includes('Hello Fahim'));
    assert.ok(pyStart.sse?.stdout.includes('Age: 21'));

    // 4. JavaScript fs.readFileSync(0, "utf8") via BOTH /api/execute/start AND /api/execute
    const jsStart = await runViaStartEndpoint(baseUrl, {
      code: JS_PART4,
      language: 'javascript',
      fileName: 'main.js',
      stdin,
    });
    assert.equal(jsStart.startData.ok, true);
    assert.equal(jsStart.sse?.exitData?.timedOut, false);
    assert.equal(jsStart.sse?.exitData?.success, true);
    assert.ok(jsStart.sse?.stdout.includes('Hello Fahim'));
    assert.ok(jsStart.sse?.stdout.includes('Age: 21'));

    const jsExecRes = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: JS_PART4, language: 'javascript', fileName: 'main.js', stdin }),
    });
    const jsExec = (await jsExecRes.json()) as any;
    assert.equal(jsExec.success, true);
    assert.ok(jsExec.stdout.includes('Hello Fahim'));
    assert.ok(jsExec.stdout.includes('Age: 21'));
  } finally {
    server.close();
  }
});

test('Part 7: BankManagementSystem.java Passes Check Balance, Deposit, Withdraw, and True Interactive Terminal Mode', async () => {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Test 1 - Check Balance: 3, 4
    const t1 = await runViaStartEndpoint(baseUrl, {
      code: BANK_MANAGEMENT_JAVA,
      language: 'java',
      fileName: 'BankManagementSystem.java',
      stdin: '3\n4',
    });
    assert.equal(t1.sse?.exitData?.success, true);
    assert.ok(t1.sse?.stdout.includes('Account Holder: Fahim'));
    assert.ok(t1.sse?.stdout.includes('Balance: 5000'));
    assert.ok(t1.sse?.stdout.includes('Exiting...'));

    // Test 2 - Deposit: 1, 1000, 3, 4
    const t2 = await runViaStartEndpoint(baseUrl, {
      code: BANK_MANAGEMENT_JAVA,
      language: 'java',
      fileName: 'BankManagementSystem.java',
      stdin: '1\n1000\n3\n4',
    });
    assert.equal(t2.sse?.exitData?.success, true);
    assert.ok(t2.sse?.stdout.includes('Deposit successful'));
    assert.ok(t2.sse?.stdout.includes('Balance: 6000'));

    // Test 3 - Withdraw (valid + insufficient): 2, 1500, 2, 9000, 3, 4
    const t3 = await runViaStartEndpoint(baseUrl, {
      code: BANK_MANAGEMENT_JAVA,
      language: 'java',
      fileName: 'BankManagementSystem.java',
      stdin: '2\n1500\n2\n9000\n3\n4',
    });
    assert.equal(t3.sse?.exitData?.success, true);
    assert.ok(t3.sse?.stdout.includes('Withdrawal successful. Updated balance: 3500'));
    assert.ok(t3.sse?.stdout.includes('Insufficient balance.'));
    assert.ok(t3.sse?.stdout.includes('Balance: 3500'));

    // Test 4 - Live Interactive STDIN Mode (empty initial STDIN -> step-by-step prompts)
    const answers = ['1', '1000', '3', '4'];
    let sentCount = 0;
    const t4 = await runViaStartEndpoint(
      baseUrl,
      {
        code: BANK_MANAGEMENT_JAVA,
        language: 'java',
        fileName: 'BankManagementSystem.java',
        stdin: '',
      },
      async (_count, send) => {
        const nextAns = answers[sentCount++];
        if (nextAns !== undefined) {
          await send(nextAns);
        } else {
          await send('', true);
        }
      }
    );
    assert.equal(t4.startData.interactiveSupported, true);
    assert.equal(t4.sse?.exitData?.success, true, `Expected interactive success, stderr=${t4.sse?.stderr}`);
    assert.ok(t4.sse?.stdout.includes('Balance: 6000'));
    assert.ok(t4.sse?.stdout.includes('Exiting...'));
  } finally {
    server.close();
  }
});

test('Part 6: Edge Cases (mixed nextInt/nextLine, empty/insufficient STDIN, invalid input, compile vs runtime classification, EOF)', async () => {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Edge Case 6: Java mixing nextInt() + dummy nextLine() + nextLine() preserves newlines/spaces
    const mixedJava = `import java.util.Scanner;
public class MixedInput {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    int id = sc.nextInt();
    sc.nextLine();
    String fullName = sc.nextLine();
    System.out.println(id + ":" + fullName);
    sc.close();
  }
}`;
    const mixedRes = await runViaStartEndpoint(baseUrl, {
      code: mixedJava,
      language: 'java',
      fileName: 'MixedInput.java',
      stdin: '42\nMd Fahim Hossain',
    });
    assert.equal(mixedRes.sse?.exitData?.success, true);
    assert.equal(mixedRes.sse?.stdout.trim(), '42:Md Fahim Hossain');

    // Edge Case 7: Empty STDIN on Scanner in Batch mode -> Input Error (NOT Compile Error)
    const emptyBatch = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: BANK_MANAGEMENT_JAVA,
        language: 'java',
        fileName: 'BankManagementSystem.java',
        stdin: '',
      }),
    });
    const emptyBatchJson = (await emptyBatch.json()) as any;
    assert.equal(emptyBatchJson.success, false);
    assert.equal(emptyBatchJson.errorCategory, 'input_error');
    assert.ok(emptyBatchJson.stderr.includes('NoSuchElementException'));

    // Edge Case 8: Invalid input (non-integer to nextInt()) -> Input Error (InputMismatchException)
    const badInput = await runViaStartEndpoint(baseUrl, {
      code: BANK_MANAGEMENT_JAVA,
      language: 'java',
      fileName: 'BankManagementSystem.java',
      stdin: 'not_a_number',
    });
    assert.equal(badInput.sse?.exitData?.success, false);
    assert.equal(badInput.sse?.exitData?.errorCategory, 'input_error');

    // Edge Case 9: More input requested than provided (partial STDIN "3" missing "4") -> clean EOF Input Error (no hang)
    const partialRes = await runViaStartEndpoint(baseUrl, {
      code: BANK_MANAGEMENT_JAVA,
      language: 'java',
      fileName: 'BankManagementSystem.java',
      stdin: '3',
    });
    assert.equal(partialRes.sse?.exitData?.success, false);
    assert.equal(partialRes.sse?.exitData?.timedOut, false);
    assert.equal(partialRes.sse?.exitData?.errorCategory, 'input_error');
    assert.ok(partialRes.sse?.stdout.includes('Balance: 5000'));

    // Edge Case 11: Runtime exception -> runtime_error (NOT compile_error)
    const rtRes = await runViaStartEndpoint(baseUrl, {
      code: `public class Boom { public static void main(String[] a){ System.out.println(10 / 0); } }`,
      language: 'java',
      fileName: 'Boom.java',
      stdin: '',
    });
    assert.equal(rtRes.sse?.exitData?.success, false);
    assert.equal(rtRes.sse?.exitData?.errorCategory, 'runtime_error');

    // Edge Case 1-5: No input, one int, multiple ints, string with spaces, multiline in C++/Python/Java
    const cppMulti = await runViaStartEndpoint(baseUrl, {
      code: `#include <iostream>\n#include <string>\nusing namespace std;\nint main(){\n int a,b; string s;\n cin >> a >> b;\n cin.ignore();\n getline(cin, s);\n cout << (a+b) << "|" << s << endl;\n return 0;\n}`,
      language: 'cpp',
      fileName: 'multi.cpp',
      stdin: '12 30\nLogic Lab Rocks',
    });
    assert.equal(cppMulti.sse?.exitData?.success, true);
    assert.equal(cppMulti.sse?.stdout.trim(), '42|Logic Lab Rocks');

    const noInputPy = await runViaStartEndpoint(baseUrl, {
      code: `print("NO_INPUT_OK")`,
      language: 'python',
      fileName: 'noin.py',
      stdin: '',
    });
    assert.equal(noInputPy.sse?.exitData?.success, true);
    assert.equal(noInputPy.sse?.stdout.trim(), 'NO_INPUT_OK');

    // Interactive EOF (user clicks EOF / Ctrl+D during live interactive loop without providing quit option)
    const eofInteractive = await runViaStartEndpoint(
      baseUrl,
      {
        code: BANK_MANAGEMENT_JAVA,
        language: 'java',
        fileName: 'BankManagementSystem.java',
        stdin: '',
      },
      async (count, send) => {
        if (count === 1) await send('3');
        else await send('', true); // send EOF
      }
    );
    assert.equal(eofInteractive.sse?.exitData?.success, false);
    assert.equal(eofInteractive.sse?.exitData?.errorCategory, 'input_error');
    assert.ok(eofInteractive.sse?.stdout.includes('Balance: 5000'));

    // Edge Case 10: Infinite loop times out cleanly with error
    const loopRes = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `while True:\n    pass`,
        language: 'python',
        fileName: 'loop.py',
        stdin: '',
      }),
    });
    const loopJson = (await loopRes.json()) as any;
    assert.equal(loopJson.success, false);
    assert.equal(loopJson.timedOut, true);
    assert.equal(loopJson.errorCategory, 'runtime_error');

    // Edge Case 12: Compile error -> compile_error
    const compRes = await runViaStartEndpoint(baseUrl, {
      code: `public class Bad { public static void main(String[] a){ int x = 1 } }`,
      language: 'java',
      fileName: 'Bad.java',
      stdin: '',
    });
    assert.equal(compRes.startData.ok, false);
    assert.equal(compRes.startData.errorCategory, 'compile_error');

    // Remote Sandbox Batch Classification (Judge0/Piston must NOT misclassify NoSuchElementException as compile_error)
    const remoteRes = buildRemoteToolchainResult(
      {
        ok: true,
        provider: 'judge0',
        stdout: '3. Check Balance\n4. Exit\nEnter your choice: ',
        stderr: 'Exception in thread "main" java.util.NoSuchElementException\n\tat BankManagementSystem.main(Main.java:54)',
        compileOutput: '',
        compileFailed: false,
        exitCode: 1,
        timedOut: false,
        runtimeError: 'Exception in thread "main" java.util.NoSuchElementException',
        executionTimeMs: 420,
      },
      []
    );
    assert.equal(remoteRes.executionBackend, 'remote');
    assert.equal(remoteRes.errorCategory, 'input_error');
    assert.equal(remoteRes.status, 'error');

    // classifyErrorCategory verification directly
    assert.equal(classifyErrorCategory('java.util.NoSuchElementException', false), 'input_error');
    assert.equal(classifyErrorCategory('EOFError: EOF when reading a line', false), 'input_error');
    assert.equal(classifyErrorCategory('ZeroDivisionError: division by zero', false), 'runtime_error');
    assert.equal(classifyErrorCategory('error: expected ;', true), 'compile_error');
  } finally {
    server.close();
  }
});

test('Part 5 & Frontend Store: Preserves STDIN across languages, prevents cross-run leak, orders prompt before stderr', async () => {
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
    // Reset store cleanly
    useLabStore.setState({
      language: 'java',
      fileName: 'BankManagementSystem.java',
      code: BANK_MANAGEMENT_JAVA,
      stdin: '',
      stdinSource: 'none',
      terminalHistory: [],
      terminalCollectedInputs: [],
      currentPrompt: '',
      fastRunResult: null,
    });

    // 1. User enters multiline STDIN -> preserved across language switch
    useLabStore.getState().setStdin('Fahim\n21');
    assert.equal(useLabStore.getState().stdin, 'Fahim\n21');
    useLabStore.getState().setLanguage('python');
    assert.equal(useLabStore.getState().stdin, 'Fahim\n21');
    useLabStore.getState().setLanguage('cpp');
    assert.equal(useLabStore.getState().stdin, 'Fahim\n21');

    // 2. Run multiple times consecutively with manual STDIN (must use exact STDIN every run)
    useLabStore.getState().setLanguage('python');
    useLabStore.getState().setCode(PYTHON_PART4);
    await useLabStore.getState().runFast(PYTHON_PART4);
    let st = useLabStore.getState();
    assert.equal(st.fastRunResult?.success, true, `First store run failed: ${st.fastRunResult?.stderr}`);
    assert.ok(st.fastRunResult?.stdout.includes('Hello Fahim'));
    assert.equal(st.stdin, 'Fahim\n21');

    // 3. Switching to Clear sets empty STDIN and does NOT leak old stdin
    useLabStore.getState().setStdin('');
    await useLabStore.getState().runFast(
      `import sys\nprint("LEN:" + str(len(sys.stdin.read())))`
    );
    st = useLabStore.getState();
    assert.equal(st.fastRunResult?.success, true);
    assert.ok(st.fastRunResult?.stdout.includes('LEN:0'));

    // 4. Missing STDIN in store fast mode produces input_error (not compile_error) and preserves stdout prompt before traceback
    useLabStore.getState().setLanguage('java');
    useLabStore.getState().setFileName('BankManagementSystem.java');
    useLabStore.getState().setCode(BANK_MANAGEMENT_JAVA);
    await useLabStore.getState().runFast(BANK_MANAGEMENT_JAVA, '3');
    st = useLabStore.getState();
    assert.equal(st.fastRunResult?.success, false);
    assert.equal(st.fastRunResult?.errorCategory, 'input_error');
  } finally {
    globalThis.fetch = origFetch;
    server.close();
  }
});

test('Remote/Serverless Replay Interactive Mode: handles NoSuchElementException as WAITING_FOR_INPUT and completes on submitTerminalInput', async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/execute/start')) {
        return new Response(JSON.stringify({ ok: false, error: 'fallback' }), { status: 500 });
      }
      if (url.includes('/api/execute')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const stdinStr = String(body.stdin || '');
        if (!stdinStr) {
          return new Response(
            JSON.stringify({
              success: false,
              status: 'error',
              canRun: false,
              stdout: 'Enter your choice: ',
              stderr: 'Exception in thread "main" java.util.NoSuchElementException',
              exitCode: 1,
              executionBackend: 'remote',
              interactiveSupported: false,
              errorCategory: 'input_error',
              diagnostics: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (stdinStr === '3') {
          return new Response(
            JSON.stringify({
              success: false,
              status: 'error',
              canRun: false,
              stdout: 'Enter your choice: Balance: 5000\nEnter your choice: ',
              stderr: 'Exception in thread "main" java.util.NoSuchElementException',
              exitCode: 1,
              executionBackend: 'remote',
              interactiveSupported: false,
              errorCategory: 'input_error',
              diagnostics: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            status: 'success',
            canRun: true,
            stdout: 'Enter your choice: Balance: 5000\nEnter your choice: Exiting...\n',
            stderr: '',
            exitCode: 0,
            executionBackend: 'remote',
            interactiveSupported: false,
            diagnostics: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    useLabStore.setState({
      language: 'java',
      fileName: 'BankAccount.java',
      code: BANK_MANAGEMENT_JAVA,
      stdin: '',
    });

    await useLabStore.getState().runFast(BANK_MANAGEMENT_JAVA, '');
    let st = useLabStore.getState();
    assert.equal(st.terminalExecState, 'WAITING_FOR_INPUT');
    assert.equal(st.isRemoteInteractive, true);
    assert.equal(st.executionStatus, 'idle');
    assert.equal(st.currentPrompt, 'Enter your choice: ');
    assert.equal(
      st.terminalHistory.some((l) => l.type === 'error'),
      false,
      'Must NOT show red NoSuchElementException error while waiting for input'
    );

    useLabStore.getState().setCurrentInputValue('3');
    await useLabStore.getState().submitTerminalInput();
    st = useLabStore.getState();
    assert.equal(st.terminalExecState, 'WAITING_FOR_INPUT');
    assert.equal(st.currentPrompt, 'Enter your choice: ');
    assert.ok(st.terminalHistory.some((l) => l.text.includes('Balance: 5000')));

    useLabStore.getState().setCurrentInputValue('4');
    await useLabStore.getState().submitTerminalInput();
    st = useLabStore.getState();
    assert.equal(st.terminalExecState, 'COMPLETED');
    assert.equal(st.executionStatus, 'success');
    assert.equal(st.isRemoteInteractive, false);
    assert.ok(st.terminalHistory.some((l) => l.text.includes('Exiting...')));
  } finally {
    globalThis.fetch = origFetch;
  }
});
