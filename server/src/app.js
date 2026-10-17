import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { createIntegrations } from './integrations.js';

const avatarDirectory = fileURLToPath(new URL('../../avatar/', import.meta.url));
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const challengeLifetimeMs = 5 * 60 * 1000;
const recoveryCodeCount = 10;
const recoveryCodeHash = (code) => createHash('sha256').update(code).digest('hex');

export function loadConfig(env = process.env) {
  if (!env.APP_ORIGIN) {
    throw new Error('APP_ORIGIN must be set to the exact HTTPS origin serving Caelia.');
  }

  const appUrl = new URL(env.APP_ORIGIN);
  if (
    appUrl.origin !== env.APP_ORIGIN ||
    (appUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(appUrl.hostname))
  ) {
    throw new Error('APP_ORIGIN must be an HTTPS origin (HTTP is allowed only on localhost).');
  }

  const rpID = env.RP_ID || appUrl.hostname;
  if (appUrl.hostname !== rpID && !appUrl.hostname.endsWith(`.${rpID}`)) {
    throw new Error('RP_ID must be the APP_ORIGIN hostname or one of its parent domains.');
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  if (env.INITIAL_ENROLLMENT_CODE && env.INITIAL_ENROLLMENT_CODE.length < 32) {
    throw new Error('INITIAL_ENROLLMENT_CODE must contain at least 32 characters.');
  }

  return {
    appOrigin: appUrl.origin,
    rpID,
    rpName: env.RP_NAME || 'Caelia',
    databasePath: path.resolve(env.DATABASE_PATH || './data/caelia.sqlite'),
    port,
    secureCookies: appUrl.protocol === 'https:',
    enrollmentCodeHash: env.INITIAL_ENROLLMENT_CODE
      ? createHash('sha256').update(env.INITIAL_ENROLLMENT_CODE).digest('hex')
      : null,
  };
}

function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    const relativePath = path.relative(avatarDirectory, path.resolve(databasePath));
    if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
      throw new Error('DATABASE_PATH must be outside the avatar web directory.');
    }
    const directory = path.dirname(databasePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32' && (statSync(directory).mode & 0o077) !== 0) {
      throw new Error('DATABASE_PATH parent directory must be private (mode 0700).');
    }
  }

  const db = new Database(databasePath);
  if (databasePath !== ':memory:') chmodSync(databasePath, 0o600);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      recognition_phrase TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL UNIQUE,
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL,
      transports TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS recovery_codes (
      code_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_account_id ON sessions(account_id);
    CREATE INDEX IF NOT EXISTS credentials_account_id ON credentials(account_id);
  `);
  return db;
}

function parseCookies(request) {
  const result = new Map();
  for (const part of (request.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    try {
      result.set(part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim()));
    } catch {
      continue;
    }
  }
  return result;
}

function setCookie(response, name, value, { secure, maxAge }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  response.append('Set-Cookie', parts.join('; '));
}

function clearCookie(response, name, secure) {
  setCookie(response, name, '', { secure, maxAge: 0 });
}

function normalizeUsername(value) {
  if (typeof value !== 'string') return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username) ? username : null;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function createApp({
  config = loadConfig(),
  db = openDatabase(config.databasePath),
  webauthn,
  integrations = createIntegrations(),
} = {}) {
  const webAuthn = webauthn || {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
  };
  const app = express();
  const challengeStore = new Map();
  const secureCookies = config.secureCookies;
  const sessionCookieName = secureCookies ? '__Host-caelia_session' : 'caelia_session';
  const challengeCookieName = secureCookies ? '__Host-caelia_challenge' : 'caelia_challenge';
  const enrollmentCodeHash = config.enrollmentCodeHash || null;
  const tokenHash = (token) => createHash('sha256').update(token).digest('hex');

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const recoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api', apiLimiter);
  app.use('/api', (request, response, next) => {
    const requestOrigin = request.get('origin');
    if (requestOrigin && requestOrigin !== config.appOrigin) {
      return response.status(403).json({ error: 'Origin not allowed.' });
    }

    if (request.method === 'OPTIONS') {
      if (requestOrigin !== config.appOrigin) {
        return response.status(403).end();
      }
      response.set({
        'Access-Control-Allow-Origin': config.appOrigin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      });
      return response.status(204).end();
    }

    if (!['GET', 'HEAD'].includes(request.method) && requestOrigin !== config.appOrigin) {
      return response.status(403).json({ error: 'Origin not allowed.' });
    }

    if (requestOrigin === config.appOrigin) {
      response.set({
        'Access-Control-Allow-Origin': config.appOrigin,
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin',
      });
    }
    next();
  });

  function currentAccount(request) {
    const token = parseCookies(request).get(sessionCookieName);
    if (!token) return null;
    const tokenDigest = tokenHash(token);
    const session = db.prepare(
      'SELECT account_id, expires_at FROM sessions WHERE token_hash = ?',
    ).get(tokenDigest);
    if (!session || session.expires_at <= Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenDigest);
      return null;
    }
    return {
      id: session.account_id,
      tokenHash: tokenDigest,
      account: db.prepare(
        'SELECT id, username, display_name, recognition_phrase FROM accounts WHERE id = ?',
      ).get(session.account_id),
    };
  }

  function requireAccount(request, response, next) {
    const authenticated = currentAccount(request);
    if (!authenticated?.account) {
      return response.status(401).json({ error: 'Sign in with a passkey to continue.' });
    }
    request.authenticated = authenticated;
    next();
  }

  function createSession(response, accountId) {
    const token = randomBytes(32).toString('base64url');
    const createdAt = Date.now();
    db.prepare(
      'INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    ).run(tokenHash(token), accountId, createdAt, createdAt + sessionLifetimeSeconds * 1000);
    setCookie(response, sessionCookieName, token, {
      secure: secureCookies,
      maxAge: sessionLifetimeSeconds,
    });
  }

  function newRecoveryCodes() {
    return Array.from({ length: recoveryCodeCount }, () => randomBytes(18).toString('base64url'));
  }

  function storeRecoveryCodes(accountId, codes) {
    const insert = db.prepare(
      'INSERT INTO recovery_codes (code_hash, account_id, created_at) VALUES (?, ?, ?)',
    );
    const now = Date.now();
    const save = db.transaction(() => {
      db.prepare('DELETE FROM recovery_codes WHERE account_id = ?').run(accountId);
      for (const code of codes) {
        insert.run(recoveryCodeHash(code), accountId, now);
      }
    });
    save();
  }

  function createChallenge(response, entry) {
    const now = Date.now();
    for (const [key, value] of challengeStore) {
      if (value.expiresAt <= now) challengeStore.delete(key);
    }
    if (challengeStore.size >= 5000) {
      throw new Error('Too many pending authentication challenges.');
    }

    const token = randomBytes(32).toString('base64url');
    challengeStore.set(token, { ...entry, expiresAt: now + challengeLifetimeMs });
    setCookie(response, challengeCookieName, token, {
      secure: secureCookies,
      maxAge: challengeLifetimeMs / 1000,
    });
  }

  function consumeChallenge(request, response, purpose) {
    const token = parseCookies(request).get(challengeCookieName);
    const entry = token && challengeStore.get(token);
    if (token) challengeStore.delete(token);
    clearCookie(response, challengeCookieName, secureCookies);
    if (!entry || entry.expiresAt <= Date.now() || entry.purpose !== purpose) return null;
    return entry;
  }

  function serializeAccount(account) {
    return {
      username: account.username,
      displayName: account.display_name,
      recognitionPhrase: account.recognition_phrase,
    };
  }

  function storeCredential(accountId, credential, transports) {
    db.prepare(`
      INSERT INTO credentials
        (id, account_id, credential_id, public_key, counter, transports, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      accountId,
      credential.id,
      Buffer.from(credential.publicKey),
      credential.counter,
      JSON.stringify(transports || credential.transports || []),
      Date.now(),
    );
  }

  async function registrationOptions(request, response, accountId = null) {
    const username = accountId
      ? db.prepare('SELECT username FROM accounts WHERE id = ?').get(accountId)?.username
      : normalizeUsername(request.body?.username);
    if (!username) return response.status(400).json({ error: 'Choose a valid account name (3–32 letters, numbers, dots, dashes, or underscores).' });

    let userId = accountId;
    if (!accountId) {
      if (db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) {
        return response.status(409).json({ error: 'New account registration is closed.' });
      }
      const enrollmentCode = typeof request.body?.enrollmentCode === 'string'
        ? request.body.enrollmentCode
        : '';
      const submittedHash = createHash('sha256').update(enrollmentCode).digest();
      const expectedHash = enrollmentCodeHash ? Buffer.from(enrollmentCodeHash, 'hex') : Buffer.alloc(32);
      if (!enrollmentCodeHash || !timingSafeEqual(submittedHash, expectedHash)) {
        return response.status(403).json({ error: 'The enrollment code was not accepted.' });
      }
      if (db.prepare('SELECT 1 FROM accounts WHERE username = ?').get(username)) {
        return response.status(409).json({ error: 'That account name is unavailable.' });
      }
      userId = randomUUID();
    }

    const existingCredentials = accountId
      ? db.prepare('SELECT credential_id, transports FROM credentials WHERE account_id = ?').all(accountId)
      : [];
    const options = await webAuthn.generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userID: Buffer.from(userId.replaceAll('-', ''), 'hex'),
      userName: username,
      userDisplayName: username,
      attestationType: 'none',
      excludeCredentials: existingCredentials.map((item) => ({
        id: item.credential_id,
        transports: JSON.parse(item.transports),
      })),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });
    createChallenge(response, {
      purpose: 'registration',
      challenge: options.challenge,
      accountId,
      pendingAccountId: accountId ? null : userId,
      username,
    });
    return response.json(options);
  }

  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));

  app.post('/api/auth/register/options', authLimiter, async (request, response, next) => {
    try {
      if (currentAccount(request)) {
        return response.status(409).json({ error: 'You are already signed in. Add a passkey from your account instead.' });
      }
      return await registrationOptions(request, response);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/register/verify', authLimiter, async (request, response, next) => {
    try {
      const challenge = consumeChallenge(request, response, 'registration');
      if (!challenge || !isRecord(request.body)) {
        return response.status(400).json({ error: 'Registration expired. Start again.' });
      }
      const verification = await webAuthn.verifyRegistrationResponse({
        response: request.body,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.appOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return response.status(400).json({ error: 'Passkey registration could not be verified.' });
      }

      const accountId = challenge.pendingAccountId || challenge.accountId;
      const accountCreated = !challenge.accountId;
      const registrationInfo = verification.registrationInfo;
      const codes = accountCreated ? newRecoveryCodes() : [];
      const save = db.transaction(() => {
        if (accountCreated) {
          if (db.prepare('SELECT 1 FROM accounts LIMIT 1').get()) {
            const error = new Error('New account registration is closed.');
            error.code = 'ACCOUNT_REGISTRATION_CLOSED';
            throw error;
          }
          db.prepare('INSERT INTO accounts (id, username, created_at) VALUES (?, ?, ?)')
            .run(accountId, challenge.username, Date.now());
        }
        storeCredential(
          accountId,
          registrationInfo.credential,
          request.body.response?.transports,
        );
        if (accountCreated) {
          const insert = db.prepare(
            'INSERT INTO recovery_codes (code_hash, account_id, created_at) VALUES (?, ?, ?)',
          );
          const now = Date.now();
          for (const code of codes) insert.run(recoveryCodeHash(code), accountId, now);
        }
      });
      save();

      const account = db.prepare(
        'SELECT id, username, display_name, recognition_phrase FROM accounts WHERE id = ?',
      ).get(accountId);
      createSession(response, accountId);
      return response.status(accountCreated ? 201 : 200).json({
        account: serializeAccount(account),
        recoveryCodes: accountCreated ? codes : undefined,
      });
    } catch (error) {
      if (error?.code === 'ACCOUNT_REGISTRATION_CLOSED') {
        return response.status(409).json({ error: 'New account registration is closed.' });
      }
      if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return response.status(409).json({ error: 'That account name or passkey is already registered.' });
      }
      return next(error);
    }
  });

  app.post('/api/auth/passkey/register/options', requireAccount, async (request, response, next) => {
    try {
      return await registrationOptions(request, response, request.authenticated.id);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/passkey/register/verify', requireAccount, async (request, response, next) => {
    try {
      const challenge = consumeChallenge(request, response, 'registration');
      if (!challenge || challenge.accountId !== request.authenticated.id || !isRecord(request.body)) {
        return response.status(400).json({ error: 'Registration expired. Start again.' });
      }
      const verification = await webAuthn.verifyRegistrationResponse({
        response: request.body,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.appOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return response.status(400).json({ error: 'Passkey registration could not be verified.' });
      }
      storeCredential(
        request.authenticated.id,
        verification.registrationInfo.credential,
        request.body.response?.transports,
      );
      return response.status(201).json({ message: 'Passkey added.' });
    } catch (error) {
      if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return response.status(409).json({ error: 'That passkey is already registered.' });
      }
      return next(error);
    }
  });

  app.post('/api/auth/login/options', authLimiter, async (_request, response, next) => {
    try {
      const options = await webAuthn.generateAuthenticationOptions({
        rpID: config.rpID,
        userVerification: 'required',
      });
      createChallenge(response, { purpose: 'authentication', challenge: options.challenge });
      return response.json(options);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/login/verify', authLimiter, async (request, response, next) => {
    try {
      const challenge = consumeChallenge(request, response, 'authentication');
      if (!challenge || !isRecord(request.body) || typeof request.body.id !== 'string') {
        return response.status(401).json({ error: 'Passkey sign-in failed. Try again or use a recovery code.' });
      }
      const stored = db.prepare(`
        SELECT credentials.id, credentials.credential_id, credentials.public_key,
          credentials.counter, credentials.transports, credentials.account_id
        FROM credentials
        WHERE credentials.credential_id = ?
      `).get(request.body.id);
      if (!stored) {
        return response.status(401).json({ error: 'Passkey sign-in failed. Try again or use a recovery code.' });
      }

      const verification = await webAuthn.verifyAuthenticationResponse({
        response: request.body,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.appOrigin,
        expectedRPID: config.rpID,
        requireUserVerification: true,
        credential: {
          id: stored.credential_id,
          publicKey: new Uint8Array(stored.public_key),
          counter: stored.counter,
          transports: JSON.parse(stored.transports),
        },
      });
      if (!verification.verified) {
        return response.status(401).json({ error: 'Passkey sign-in failed. Try again or use a recovery code.' });
      }
      db.prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?')
        .run(verification.authenticationInfo.newCounter, Date.now(), stored.id);
      createSession(response, stored.account_id);
      const account = db.prepare(
        'SELECT id, username, display_name, recognition_phrase FROM accounts WHERE id = ?',
      ).get(stored.account_id);
      return response.json({ account: serializeAccount(account) });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/auth/recovery', recoveryLimiter, (request, response) => {
    const username = normalizeUsername(request.body?.username);
    const code = typeof request.body?.code === 'string' ? request.body.code.trim() : '';
    const account = username
      ? db.prepare('SELECT id FROM accounts WHERE username = ?').get(username)
      : null;
    const codeDigest = recoveryCodeHash(code);
    const codes = account
      ? db.prepare('SELECT code_hash FROM recovery_codes WHERE account_id = ?').all(account.id)
      : [{ code_hash: '0'.repeat(64) }];
    let matched = null;
    for (const item of codes) {
      const known = Buffer.from(item.code_hash, 'hex');
      const candidate = Buffer.from(codeDigest, 'hex');
      if (known.length === candidate.length && timingSafeEqual(known, candidate)) matched = item.code_hash;
    }
    if (!account || !matched || code.length > 64) {
      return response.status(401).json({ error: 'Account or recovery code was not accepted.' });
    }

    const recover = db.transaction(() => {
      const result = db.prepare(
        'DELETE FROM recovery_codes WHERE account_id = ? AND code_hash = ?',
      ).run(account.id, matched);
      if (result.changes !== 1) return false;
      db.prepare('DELETE FROM sessions WHERE account_id = ?').run(account.id);
      return true;
    });
    if (!recover()) return response.status(401).json({ error: 'Account or recovery code was not accepted.' });
    createSession(response, account.id);
    return response.json({ message: 'Recovery code accepted. Add a new passkey if needed.' });
  });

  app.get('/api/me', requireAccount, (request, response) => {
    response.json({
      account: serializeAccount(request.authenticated.account),
      passkeys: db.prepare(`
        SELECT id, created_at, last_used_at FROM credentials
        WHERE account_id = ? ORDER BY created_at
      `).all(request.authenticated.id).map((item, index) => ({
        id: item.id,
        name: `Passkey ${index + 1}`,
        createdAt: item.created_at,
        lastUsedAt: item.last_used_at,
      })),
    });
  });

  app.patch('/api/me', requireAccount, (request, response) => {
    if (!isRecord(request.body)) return response.status(400).json({ error: 'Invalid preferences.' });
    const allowedFields = ['displayName', 'recognitionPhrase'];
    if (Object.keys(request.body).some((field) => !allowedFields.includes(field))) {
      return response.status(400).json({ error: 'Only display name and recognition phrase can be changed.' });
    }

    const current = request.authenticated.account;
    const displayName = request.body.displayName === undefined
      ? current.display_name
      : typeof request.body.displayName === 'string' && request.body.displayName.trim().length <= 64
        ? request.body.displayName.trim()
        : null;
    const recognitionPhrase = request.body.recognitionPhrase === undefined
      ? current.recognition_phrase
      : typeof request.body.recognitionPhrase === 'string' && request.body.recognitionPhrase.length <= 200
        ? request.body.recognitionPhrase.trim()
        : null;
    if (displayName === null || recognitionPhrase === null) {
      return response.status(400).json({ error: 'Display name must be at most 64 characters; recognition phrase must be at most 200.' });
    }
    db.prepare('UPDATE accounts SET display_name = ?, recognition_phrase = ? WHERE id = ?')
      .run(displayName, recognitionPhrase, request.authenticated.id);
    return response.json({
      account: serializeAccount(db.prepare(
        'SELECT username, display_name, recognition_phrase FROM accounts WHERE id = ?',
      ).get(request.authenticated.id)),
    });
  });

  app.post('/api/auth/recovery-codes', requireAccount, (request, response) => {
    const codes = newRecoveryCodes();
    storeRecoveryCodes(request.authenticated.id, codes);
    response.json({ recoveryCodes: codes });
  });

  app.post('/api/auth/logout', (request, response) => {
    const authenticated = currentAccount(request);
    if (authenticated) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(authenticated.tokenHash);
    }
    clearCookie(response, sessionCookieName, secureCookies);
    clearCookie(response, challengeCookieName, secureCookies);
    response.status(204).end();
  });

  app.post('/api/auth/revoke-sessions', requireAccount, (request, response) => {
    db.prepare('DELETE FROM sessions WHERE account_id = ?').run(request.authenticated.id);
    clearCookie(response, sessionCookieName, secureCookies);
    clearCookie(response, challengeCookieName, secureCookies);
    response.status(204).end();
  });

  app.post('/api/avatar/intent', requireAccount, async (request, response, next) => {
    const { action, target, duration, text } = request.body || {};
    const actions = new Set([
      'greet', 'glide', 'walk', 'turn', 'spin', 'wave', 'bow', 'pulse',
      'soul_bloom', 'quantum_step', 'think', 'listen', 'speak', 'calm',
      'attention', 'celebrate',
    ]);
    if (!actions.has(action)) {
      return response.status(400).json({ error: 'Unsupported avatar action.' });
    }
    if (target !== undefined && (
      !isRecord(target) ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y) ||
      target.x < 0 || target.x > 1 ||
      target.y < 0 || target.y > 1
    )) {
      return response.status(400).json({ error: 'Target coordinates must be between 0 and 1.' });
    }
    if (duration !== undefined && (!Number.isInteger(duration) || duration < 150 || duration > 5000)) {
      return response.status(400).json({ error: 'Duration must be between 150 and 5000 milliseconds.' });
    }
    if (text !== undefined && (typeof text !== 'string' || text.length > 220)) {
      return response.status(400).json({ error: 'Speech text must be at most 220 characters.' });
    }
    const intent = {
      action,
      target: target || null,
      duration: duration || 1200,
      text: typeof text === 'string' ? text : '',
      account: {
        username: request.authenticated.account.username,
        displayName: request.authenticated.account.display_name,
      },
    };
    try {
      if (!await integrations.authorizeAvatarIntent(intent)) {
        return response.status(403).json({ error: 'The Caelia backend did not approve this action.' });
      }
      if (action === 'speak') {
        intent.text = await integrations.generateReply({
          text: intent.text,
          username: intent.account.username,
          displayName: intent.account.displayName,
        });
      }
      await integrations.dispatchUnityIntent(intent);
      return response.json(intent);
    } catch (error) {
      return next(error);
    }
  });

  app.use(express.static(avatarDirectory, { index: 'index.html', fallthrough: true }));
  app.use((_request, response) => response.status(404).json({ error: 'Not found.' }));
  app.use((error, _request, response, _next) => {
    if (response.headersSent) return;
    if (error?.type === 'entity.too.large') {
      return response.status(413).json({ error: 'Request is too large.' });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return response.status(400).json({ error: 'Invalid JSON.' });
    }
    return response.status(500).json({ error: 'The request could not be completed.' });
  });

  app.locals.close = () => db.close();
  app.locals.db = db;
  return app;
}
