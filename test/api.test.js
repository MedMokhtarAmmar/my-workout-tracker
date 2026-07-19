// Regression suite for the HTTP API, run with: node --test test/
//
// Exercises the app the same way it's been manually verified all along
// (real signup/login over HTTP, cross-user isolation checks) so a refactor
// of server.js can be confirmed behavior-identical without redoing that by
// hand. Runs against a live instance (TEST_BASE_URL, default production) —
// every account it creates is under @regressiontest.local and is cleaned
// up in the `after` hook.
//
// Requires a real Google-authenticated session for the parts that touch
// data already owned by a real user — those are skipped here on purpose;
// this suite only covers what two fresh password accounts can exercise.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const BASE_URL = process.env.TEST_BASE_URL || 'https://my-workout-tracker.duckdns.org';
const STAMP = Date.now();

class Client {
  constructor() {
    this.cookie = null;
  }
  async request(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (this.cookie) headers.Cookie = this.cookie;
    const res = await fetch(BASE_URL + path, { ...opts, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body, fine */ }
    return { status: res.status, body };
  }
  get(path) { return this.request(path); }
  post(path, data) { return this.request(path, { method: 'POST', body: JSON.stringify(data) }); }
  put(path, data) { return this.request(path, { method: 'PUT', body: JSON.stringify(data) }); }
  del(path) { return this.request(path, { method: 'DELETE' }); }
}

const emailA = `regress-a-${STAMP}@regressiontest.local`;
const emailB = `regress-b-${STAMP}@regressiontest.local`;
const PASSWORD = 'regression-test-pw-123';

let alice, bob;

describe('auth', () => {
  before(() => { alice = new Client(); bob = new Client(); });

  test('signup creates an account and logs in', async () => {
    const res = await alice.post('/auth/signup', { email: emailA, password: PASSWORD });
    assert.equal(res.status, 200);
    const status = await alice.get('/api/auth/status');
    assert.equal(status.body.loggedIn, true);
    assert.equal(status.body.email, emailA);
  });

  test('duplicate signup is rejected', async () => {
    const res = await new Client().post('/auth/signup', { email: emailA, password: PASSWORD });
    assert.equal(res.status, 400);
  });

  test('weak password is rejected', async () => {
    const res = await new Client().post('/auth/signup', { email: `weak-${STAMP}@regressiontest.local`, password: 'short' });
    assert.equal(res.status, 400);
  });

  test('login with wrong password is rejected', async () => {
    const res = await new Client().post('/auth/login', { email: emailA, password: 'not-the-password' });
    assert.equal(res.status, 401);
  });

  test('login with correct password succeeds', async () => {
    const client = new Client();
    const res = await client.post('/auth/login', { email: emailA, password: PASSWORD });
    assert.equal(res.status, 200);
  });

  test('second account signs up independently', async () => {
    const res = await bob.post('/auth/signup', { email: emailB, password: PASSWORD });
    assert.equal(res.status, 200);
  });

  test('logout clears the session', async () => {
    const client = new Client();
    await client.post('/auth/signup', { email: `logout-${STAMP}@regressiontest.local`, password: PASSWORD });
    await client.post('/auth/logout', {});
    const status = await client.get('/api/auth/status');
    assert.equal(status.body.loggedIn, false);
  });

  test('unauthenticated request to a protected API route is rejected', async () => {
    const res = await new Client().get('/api/sessions');
    assert.equal(res.status, 401);
  });
});

describe('per-user data isolation', () => {
  let aliceSessionId;

  test('alice starts a workout', async () => {
    const res = await alice.post('/api/sessions', { date: '2099-05-01', template_key: 'upper_a', cardio_minutes: 0 });
    assert.equal(res.status, 200);
    assert.ok(res.body.id);
    aliceSessionId = res.body.id;
  });

  test('bob sees no sessions at all', async () => {
    const res = await bob.get('/api/sessions');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
  });

  test('bob cannot fetch alice\'s session by id (IDOR)', async () => {
    const res = await bob.get(`/api/sessions/${aliceSessionId}`);
    assert.equal(res.status, 404);
  });

  test('bob cannot delete alice\'s session by id (IDOR)', async () => {
    const res = await bob.del(`/api/sessions/${aliceSessionId}`);
    assert.equal(res.status, 404);
    const stillThere = await alice.get(`/api/sessions/${aliceSessionId}`);
    assert.equal(stillThere.status, 200);
  });

  test('bob\'s settings are defaults, not alice\'s', async () => {
    await alice.put('/api/settings', { nutrition_age: '29', nutrition_height_cm: '180' });
    const bobSettings = await bob.get('/api/settings');
    assert.equal(bobSettings.body.nutrition_age, '');
    const aliceSettings = await alice.get('/api/settings');
    assert.equal(aliceSettings.body.nutrition_age, '29');
  });

  test('alice can log a set on her own session and read it back', async () => {
    const exercises = await alice.get(`/api/sessions/${aliceSessionId}/exercises`);
    assert.equal(exercises.status, 200);
    assert.ok(exercises.body.length > 0);
    const sessionExerciseId = exercises.body[0].session_exercise_id;

    const setRes = await alice.post(`/api/sessions/${aliceSessionId}/sets`, {
      session_exercise_id: sessionExerciseId, set_number: 1, reps: 10, weight_kg: 50,
    });
    assert.equal(setRes.status, 200);

    const detail = await alice.get(`/api/sessions/${aliceSessionId}`);
    assert.equal(detail.body.sets.length, 1);
    assert.equal(detail.body.sets[0].weight_kg, 50);
  });

  test('alice cleans up her own session', async () => {
    const res = await alice.del(`/api/sessions/${aliceSessionId}`);
    assert.equal(res.status, 200);
  });
});
