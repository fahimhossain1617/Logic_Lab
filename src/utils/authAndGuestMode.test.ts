import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createCoreExpressApp } from '../../server/src/app';
import { useLabStore } from '../store/useLabStore';

test('Auth session endpoints manage authenticated users, history wipe, and logout cleanly', async () => {
  const app = createCoreExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const uid = `auth-test-uid-${Date.now()}`;

  try {
    // 1. Unauthenticated / guest rejected by POST /api/auth/session
    const unauthRes = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Guest GET /api/auth/session reports unauthenticated
    const guestGet = await fetch(`${baseUrl}/api/auth/session`);
    const guestJson = (await guestGet.json()) as any;
    assert.equal(guestJson.authenticated, false);
    assert.equal(guestJson.user, null);

    // 3. Authenticated session creation returns user + empty cloud fallback arrays
    const loginRes = await fetch(`${baseUrl}/api/auth/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-uid': uid,
      },
      body: JSON.stringify({
        email: 'student@example.com',
        displayName: 'Test Student',
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = (await loginRes.json()) as any;
    assert.equal(loginJson.authenticated, true);
    assert.equal(loginJson.user.uid, uid);
    assert.equal(loginJson.user.displayName, 'Test Student');

    // 4. History CRUD & DELETE /api/history clear-all for authenticated UID
    const addHist = await fetch(`${baseUrl}/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-uid': uid },
      body: JSON.stringify({
        id: 'run-clear-test',
        title_bn: 'টেস্ট রান',
        title_en: 'Test Run',
        language: 'javascript',
        code: 'console.log(1);',
      }),
    });
    assert.equal(addHist.status, 200);

    const clearRes = await fetch(`${baseUrl}/api/history`, {
      method: 'DELETE',
      headers: { 'x-user-uid': uid },
    });
    assert.equal(clearRes.status, 200);
    const clearJson = (await clearRes.json()) as any;
    assert.deepEqual(clearJson.history, []);

    // 5. Logout returns clean unauthenticated payload
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'x-user-uid': uid },
    });
    assert.equal(logoutRes.status, 200);
    const logoutJson = (await logoutRes.json()) as any;
    assert.equal(logoutJson.authenticated, false);
    assert.equal(logoutJson.ok, true);
  } finally {
    server.close();
  }
});

test('Guest mode allows code execution without saving history and keeps playback speed hardcoded to 1x', async () => {
  // Reset store cleanly in Node environment
  useLabStore.setState({
    user: null,
    historyItems: [],
    recentExecutions: [],
    speed: 1,
    activeRoute: '/',
  });

  // 1. Playback speed is hardcoded to 1x permanently
  useLabStore.getState().setSpeed(2);
  assert.equal(useLabStore.getState().speed, 1);
  useLabStore.getState().setSpeed(0.5);
  assert.equal(useLabStore.getState().speed, 1);
  useLabStore.getState().setSpeed(1);
  assert.equal(useLabStore.getState().speed, 1);

  // 2. Login route navigation & Continue as Guest work properly
  useLabStore.getState().openLoginPage();
  assert.equal(useLabStore.getState().activeRoute, '/login');
  useLabStore.getState().continueAsGuest();
  assert.equal(useLabStore.getState().activeRoute, '/');
  assert.equal(useLabStore.getState().user, null);

  // 3. Running code in guest mode does NOT record history
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
    useLabStore.setState({
      language: 'javascript',
      code: 'console.log("GuestOK");',
      stdin: '',
      historyItems: [],
      recentExecutions: [],
    });

    await useLabStore.getState().runFast('console.log("GuestOK");');
    const state = useLabStore.getState();
    assert.equal(state.executionStatus, 'success');
    assert.equal(state.fastRunResult?.success, true);
    assert.equal(state.fastRunResult?.stdout.trim(), 'GuestOK');
    assert.equal(state.historyItems.length, 0);
    assert.equal(state.recentExecutions.length, 0);
  } finally {
    globalThis.fetch = origFetch;
    server.close();
  }
});
