import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCoreExpressApp } from '../../server/src/app';

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test('POST /api/execute pipes stdin to Java Scanner and returns fast execution payload', async () => {
  await withServer(async (baseUrl) => {
    const code = `import java.util.Scanner;
public class Main {
  public static void main(String[] args) {
    Scanner sc = new Scanner(System.in);
    String name = sc.nextLine();
    int age = sc.nextInt();
    System.out.println("Hello " + name + ", age=" + age);
    sc.close();
  }
}`;
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        language: 'java',
        fileName: 'Main.java',
        stdin: 'Fahim\n24',
      }),
    });
    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.exitCode, 0);
    assert.ok(typeof data.executionTimeMs === 'number' && data.executionTimeMs >= 1);
    assert.equal(data.stdout.trim(), 'Hello Fahim, age=24');
  });
});

test('POST /api/execute pipes stdin to C++ cin and returns fast execution payload', async () => {
  await withServer(async (baseUrl) => {
    const code = `#include <iostream>
using namespace std;
int main() {
  int a, b;
  cin >> a >> b;
  cout << "SUM=" << (a + b) << endl;
  return 0;
}`;
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        language: 'cpp',
        fileName: 'main.cpp',
        stdin: '15 27',
      }),
    });
    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.exitCode, 0);
    assert.ok(typeof data.executionTimeMs === 'number' && data.executionTimeMs >= 1);
    assert.equal(data.stdout.trim(), 'SUM=42');
  });
});

test('POST /api/execute pipes stdin to Python input() and returns fast execution payload', async () => {
  await withServer(async (baseUrl) => {
    const code = `name = input()
num = int(input())
print(f"PY:{name}:{num * 2}")`;
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        language: 'python',
        fileName: 'main.py',
        stdin: 'LogicLab\n21',
      }),
    });
    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.exitCode, 0);
    assert.ok(typeof data.executionTimeMs === 'number' && data.executionTimeMs >= 1);
    assert.equal(data.stdout.trim(), 'PY:LogicLab:42');
  });
});

test('POST /api/execute pipes stdin to Node readline and returns fast execution payload', async () => {
  await withServer(async (baseUrl) => {
    const code = `const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const lines = [];
rl.on('line', (line) => lines.push(line));
rl.on('close', () => {
  console.log('JS:' + lines.join('|'));
});`;
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        language: 'javascript',
        fileName: 'main.js',
        stdin: 'alpha\nbeta',
      }),
    });
    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.success, true);
    assert.equal(data.exitCode, 0);
    assert.ok(typeof data.executionTimeMs === 'number' && data.executionTimeMs >= 1);
    assert.equal(data.stdout.trim(), 'JS:alpha|beta');
  });
});

test('POST /api/execute returns structured failure on compile/syntax error', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'def broken(:\n  print(1)',
        language: 'python',
        fileName: 'main.py',
      }),
    });
    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.success, false);
    assert.notEqual(data.exitCode, 0);
    assert.ok(data.stderr.length > 0);
  });
});

test('GET/POST/DELETE /api/executions logs and isolates code_executions by user UID and guest', async () => {
  await withServer(async (baseUrl) => {
    const postGuest = await fetch(`${baseUrl}/api/executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python',
        source_code: 'print(input())',
        stdin_input: '42',
        stdout_output: '42\n',
        execution_mode: 'fast',
        execution_time_ms: 85,
        success: true,
        file_name: 'main.py',
      }),
    });
    assert.equal(postGuest.status, 200);

    const postUser = await fetch(`${baseUrl}/api/executions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-uid': 'user-123',
      },
      body: JSON.stringify({
        language: 'java',
        source_code: 'public class Main { public static void main(String[] a){} }',
        stdin_input: '',
        stdout_output: '',
        execution_mode: 'explain',
        execution_time_ms: 420,
        success: true,
        file_name: 'Main.java',
      }),
    });
    assert.equal(postUser.status, 200);

    const getGuest = await fetch(`${baseUrl}/api/executions`);
    const guestData = (await getGuest.json()) as any;
    assert.equal(guestData.executions.length, 1);
    assert.equal(guestData.executions[0].language, 'python');
    assert.equal(guestData.executions[0].userId, null);

    const getUser = await fetch(`${baseUrl}/api/executions`, {
      headers: { 'x-user-uid': 'user-123' },
    });
    const userData = (await getUser.json()) as any;
    assert.equal(userData.executions.length, 1);
    assert.equal(userData.executions[0].language, 'java');
    assert.equal(userData.executions[0].userId, 'user-123');

    const delGuest = await fetch(`${baseUrl}/api/executions`, { method: 'DELETE' });
    const delData = (await delGuest.json()) as any;
    assert.equal(delData.executions.length, 0);
  });
});

test('POST /api/trace accepts stdin and aligns finalOutput with real stdin execution', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `x = input()\nprint("GOT:" + x)`,
        language: 'python',
        explainLanguage: 'en',
        depth: 'simple',
        fileName: 'main.py',
        stdin: 'Focentia',
        bypassCache: true,
      }),
    });
    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.canRun, true);
    assert.equal(data.output, 'GOT:Focentia');
  });
});

