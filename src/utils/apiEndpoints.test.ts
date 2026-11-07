import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCoreExpressApp } from '../../server/src/app';

test('API Route POST /api/analyze returns real diagnostics', async () => {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'public class Foo { public static void main(String[] args) { int x = 10 } }',
        language: 'java',
        fileName: 'Foo.java',
      }),
    });
    const data = await res.json() as any;
    assert.equal(data.canCompile, false);
    assert.ok(data.diagnostics.length > 0);
    assert.equal(data.diagnostics[0].line, 1);
    assert.ok(data.diagnostics[0].message.includes(';'));
  } finally {
    server.close();
  }
});

test('API Route POST /api/execute runs real code in sandbox', async () => {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'console.log("Hello from Express API test!");',
        language: 'javascript',
      }),
    });
    const data = await res.json() as any;
    assert.equal(data.status, 'success');
    assert.equal(data.canRun, true);
    assert.equal(data.stdout.trim(), 'Hello from Express API test!');
  } finally {
    server.close();
  }
});
