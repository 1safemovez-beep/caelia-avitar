import assert from 'node:assert/strict';
import test from 'node:test';
import { createIntegrations } from '../src/integrations.js';
import { loadConfig } from '../src/app.js';

test('production config requires a secure, exact app origin and valid passkey host', () => {
  assert.throws(() => loadConfig({}), /APP_ORIGIN must be set/);
  assert.throws(
    () => loadConfig({ APP_ORIGIN: 'http://caeliasystems.com' }),
    /HTTPS origin/,
  );
  assert.throws(
    () => loadConfig({ APP_ORIGIN: 'https://caeliasystems.com', RP_ID: 'other.example' }),
    /RP_ID must be/,
  );
  assert.throws(
    () => loadConfig({ APP_ORIGIN: 'https://caeliasystems.com', PORT: '99999' }),
    /PORT must be/,
  );

  const config = loadConfig({
    APP_ORIGIN: 'https://caeliasystems.com',
    RP_ID: 'caeliasystems.com',
    INITIAL_ENROLLMENT_CODE: 'a'.repeat(32),
  });
  assert.equal(config.secureCookies, true);
  assert.equal(config.enrollmentCodeHash.length, 64);
  assert.notEqual(config.enrollmentCodeHash, 'a'.repeat(32));
});

test('service adapters stay off until trusted HTTPS URLs and long credentials are configured', async () => {
  const integrations = createIntegrations({});
  assert.deepEqual(integrations.enabled, { brain: false, backend: false, unity: false });
  assert.equal(
    await integrations.generateReply({ text: 'Hi', username: 'alice', displayName: 'Alicia' }),
    'I heard you. My conversation engine is not connected yet.',
  );

  assert.throws(
    () => createIntegrations({ CAELIA_BRAIN_URL: 'http://brain.example/reply' }),
    /must use HTTPS/,
  );
  assert.throws(
    () => createIntegrations({
      CAELIA_BACKEND_URL: 'https://backend.example/intent',
      CAELIA_BACKEND_TOKEN: 'short',
    }),
    /at least 24 characters/,
  );
  assert.throws(
    () => createIntegrations({
      NODE_ENV: 'production',
      UNITY_BRIDGE_URL: 'http://localhost:8080/intent',
      UNITY_BRIDGE_TOKEN: 'a'.repeat(32),
    }),
    /must use HTTPS/,
  );
});
