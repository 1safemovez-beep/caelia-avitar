import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/app.js';

const origin = 'http://localhost:3000';
const enrollmentCode = 'a'.repeat(40);

function createHarness(t, { enrollmentCodeHash: configuredEnrollmentHash } = {}) {
  const calls = [];
  let authenticationVerificationHook = null;
  const webauthn = {
    async generateRegistrationOptions() {
      return { challenge: 'registration-challenge', user: { id: 'user-id' } };
    },
    async verifyRegistrationResponse(options) {
      assert.equal(options.expectedChallenge, 'registration-challenge');
      assert.equal(options.expectedOrigin, origin);
      return {
        verified: true,
        registrationInfo: {
          credential: {
            id: 'test-credential-id',
            publicKey: Uint8Array.from([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
        },
      };
    },
    async generateAuthenticationOptions() {
      return { challenge: 'authentication-challenge' };
    },
    async verifyAuthenticationResponse(options) {
      assert.equal(options.expectedChallenge, 'authentication-challenge');
      if (authenticationVerificationHook) await authenticationVerificationHook();
      return {
        verified: true,
        authenticationInfo: { newCounter: 1 },
      };
    },
  };
  const integrations = {
    async authorizeAvatarIntent(intent) {
      calls.push(['authorize', intent.action]);
      return true;
    },
    async dispatchUnityIntent(intent) {
      calls.push(['unity', intent.action]);
    },
    async generateReply(input) {
      calls.push(['brain', input]);
      return 'A calm, thoughtful reply.';
    },
  };
  const app = createApp({
    config: {
      appOrigin: origin,
      rpID: 'localhost',
      rpName: 'Caelia',
      databasePath: ':memory:',
      port: 3000,
      secureCookies: false,
      enrollmentCodeHash: configuredEnrollmentHash === undefined
        ? createHash('sha256').update(enrollmentCode).digest('hex')
        : configuredEnrollmentHash,
    },
    webauthn,
    integrations,
  });
  const server = createServer(app);
  const cookies = new Map();

  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      async function request(route, { method = 'GET', body, requestOrigin = origin } = {}) {
        const headers = { Origin: requestOrigin };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
        const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        for (const setCookie of response.headers.getSetCookie()) {
          const [pair, ...attributes] = setCookie.split(';');
          const separator = pair.indexOf('=');
          const name = pair.slice(0, separator);
          const value = pair.slice(separator + 1);
          if (attributes.some((attribute) => attribute.trim().toLowerCase() === 'max-age=0')) {
            cookies.delete(name);
          } else {
            cookies.set(name, value);
          }
        }
        const text = response.status === 204 ? '' : await response.text();
        let json = null;
        if (response.headers.get('content-type')?.includes('application/json') && text) {
          json = JSON.parse(text);
        }
        return { response, json, text };
      }
      resolve({
        request,
        app,
        calls,
        setAuthenticationVerificationHook(hook) {
          authenticationVerificationHook = hook;
        },
      });
    });
  });
}

test('health is public and browser writes reject unapproved origins', async (t) => {
  const { request } = await createHarness(t);
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.json, { status: 'ok' });

  const page = await request('/');
  assert.equal(page.response.status, 200);
  assert.match(page.text, /Create owner account with passkey/);
  const avatarScript = await request('/caelia_true_form.js');
  assert.equal(avatarScript.response.status, 200);
  assert.match(avatarScript.text, /function presentIntent/);

  const rejected = await request('/api/auth/register/options', {
    method: 'POST',
    body: { username: 'alicia' },
    requestOrigin: 'https://attacker.example',
  });
  assert.equal(rejected.response.status, 403);
});

test('new owner enrollment is closed without an out-of-band bootstrap code', async (t) => {
  const { request } = await createHarness(t, { enrollmentCodeHash: null });
  const enrollment = await request('/api/auth/register/options', {
    method: 'POST',
    body: { username: 'alicia', enrollmentCode },
  });
  assert.equal(enrollment.response.status, 403);
  assert.equal(enrollment.json.error, 'The enrollment code was not accepted.');
});

test('a passkey revoked during verification cannot create a session', async (t) => {
  const { request, app, setAuthenticationVerificationHook } = await createHarness(t);
  await request('/api/auth/register/options', {
    method: 'POST',
    body: { username: 'alicia', enrollmentCode },
  });
  const registered = await request('/api/auth/register/verify', {
    method: 'POST',
    body: { id: 'test-credential-id', response: { transports: ['internal'] } },
  });
  assert.equal(registered.response.status, 201);
  await request('/api/auth/logout', { method: 'POST', body: {} });

  await request('/api/auth/login/options', { method: 'POST', body: {} });
  setAuthenticationVerificationHook(() => {
    app.locals.db.prepare('DELETE FROM credentials WHERE credential_id = ?')
      .run('test-credential-id');
  });
  const login = await request('/api/auth/login/verify', {
    method: 'POST',
    body: { id: 'test-credential-id', response: {} },
  });
  assert.equal(login.response.status, 401);
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
});

test('passkey enrollment, private preferences, avatar intents, recovery, and session revocation work', async (t) => {
  const { request, app, calls } = await createHarness(t);

  const unauthenticatedIntent = await request('/api/avatar/intent', {
    method: 'POST',
    body: { action: 'greet' },
  });
  assert.equal(unauthenticatedIntent.response.status, 401);

  const options = await request('/api/auth/register/options', {
    method: 'POST',
    body: { username: 'Alicia', enrollmentCode },
  });
  assert.equal(options.response.status, 200);
  const registered = await request('/api/auth/register/verify', {
    method: 'POST',
    body: { id: 'test-credential-id', response: { transports: ['internal'] } },
  });
  assert.equal(registered.response.status, 201);
  assert.equal(registered.response.headers.get('set-cookie').includes('HttpOnly'), true);
  assert.equal(registered.json.recoveryCodes.length, 10);
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM recovery_codes').get().count,
    10,
  );
  assert.equal(
    app.locals.db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count,
    1,
  );

  const saved = await request('/api/me', {
    method: 'PATCH',
    body: {
      displayName: 'Alicia',
      recognitionPhrase: 'This is a preference, not a login secret.',
    },
  });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.json.account.recognitionPhrase, 'This is a preference, not a login secret.');

  const secondAccount = await request('/api/auth/register/options', {
    method: 'POST',
    body: { username: 'another', enrollmentCode },
  });
  assert.equal(secondAccount.response.status, 409);

  const intent = await request('/api/avatar/intent', {
    method: 'POST',
    body: { action: 'speak', text: 'Hello Caelia', target: { x: 0.62, y: 0.48 }, duration: 1200 },
  });
  assert.equal(intent.response.status, 200);
  assert.equal(intent.json.text, 'A calm, thoughtful reply.');
  assert.equal(calls.some(([type]) => type === 'brain'), true);
  assert.equal(calls.some(([type]) => type === 'unity'), true);
  assert.equal(calls.some(([type]) => type === 'authorize'), true);
  assert.equal(JSON.stringify(calls).includes('recognitionPhrase'), false);

  const invalidIntent = await request('/api/avatar/intent', {
    method: 'POST',
    body: { action: 'speak', text: 'hello', target: { x: 2, y: 0.5 } },
  });
  assert.equal(invalidIntent.response.status, 400);

  const firstRecoveryCode = registered.json.recoveryCodes[0];
  await request('/api/auth/logout', { method: 'POST', body: {} });
  const recovered = await request('/api/auth/recovery', {
    method: 'POST',
    body: { username: 'alicia', code: firstRecoveryCode },
  });
  assert.equal(recovered.response.status, 200);

  await request('/api/auth/logout', { method: 'POST', body: {} });
  const reusedCode = await request('/api/auth/recovery', {
    method: 'POST',
    body: { username: 'alicia', code: firstRecoveryCode },
  });
  assert.equal(reusedCode.response.status, 401);

  const signedIn = await request('/api/auth/login/options', { method: 'POST', body: {} });
  assert.equal(signedIn.response.status, 200);
  const loggedIn = await request('/api/auth/login/verify', {
    method: 'POST',
    body: { id: 'test-credential-id', response: {} },
  });
  assert.equal(loggedIn.response.status, 200);

  const accountState = await request('/api/me');
  assert.equal(accountState.json.passkeys.length, 1);
  app.locals.db.prepare('DELETE FROM recovery_codes').run();
  const blockedRevocation = await request('/api/auth/passkeys/revoke', {
    method: 'POST',
    body: { id: accountState.json.passkeys[0].id },
  });
  assert.equal(blockedRevocation.response.status, 409);
  const rotatedCodes = await request('/api/auth/recovery-codes', {
    method: 'POST',
    body: {},
  });
  assert.equal(rotatedCodes.json.recoveryCodes.length, 10);

  const revokedPasskey = await request('/api/auth/passkeys/revoke', {
    method: 'POST',
    body: { id: accountState.json.passkeys[0].id },
  });
  assert.equal(revokedPasskey.response.status, 200);
  assert.equal((await request('/api/me')).response.status, 401);
  await request('/api/auth/recovery', {
    method: 'POST',
    body: { username: 'alicia', code: rotatedCodes.json.recoveryCodes[0] },
  });
  assert.equal((await request('/api/me')).json.passkeys.length, 0);

  const replacementOptions = await request('/api/auth/passkey/register/options', {
    method: 'POST',
    body: {},
  });
  assert.equal(replacementOptions.response.status, 200);
  const replacementPasskey = await request('/api/auth/passkey/register/verify', {
    method: 'POST',
    body: { id: 'test-credential-id', response: { transports: ['internal'] } },
  });
  assert.equal(replacementPasskey.response.status, 201);
  assert.equal((await request('/api/me')).json.passkeys.length, 1);

  const revoked = await request('/api/auth/revoke-sessions', { method: 'POST', body: {} });
  assert.equal(revoked.response.status, 204);
  const noLongerSignedIn = await request('/api/me');
  assert.equal(noLongerSignedIn.response.status, 401);
});
