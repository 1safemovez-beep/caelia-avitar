# Caelia passkey server

This is an optional Node.js backend for a private Caelia account and avatar UI. It adds passkey registration and sign-in, one-time recovery codes, server-side sessions, user preferences, and a validated avatar-intent API. It does not replace or connect to an existing brain, Unity project, or Caelia Systems backend unless an operator configures those adapters.

## Run locally

Requirements: Node.js 20 or newer.

```sh
cd server
npm ci
```

The server does not automatically load `.env`. Export its values through your shell, process manager, or hosting provider. For local development, generate and display a one-time bootstrap code, then start the server:

```sh
export APP_ORIGIN=http://localhost:3000
export RP_ID=localhost
export INITIAL_ENROLLMENT_CODE="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")"
printf 'Owner enrollment code: %s\n' "$INITIAL_ENROLLMENT_CODE"
npm start
```

Open `http://localhost:3000`. Passkeys require a secure context; browsers treat `localhost` as a secure context. For deployment, serve the UI and API over HTTPS and set `APP_ORIGIN` to the exact public UI origin, without a path or trailing slash. `RP_ID` must be that hostname or a parent domain. Keep the UI and API on the same site so `SameSite=Strict` session cookies work. `APP_ORIGIN` controls WebAuthn origin verification and the CORS allowlist.

If the UI is hosted separately from the API, set `CAELIA_API_ORIGIN` in `/config.js` to the API origin when deploying the UI. Configure `APP_ORIGIN` to the exact UI origin and use HTTPS on both. Keep the UI and API under the same registrable domain for browser cookie policy compatibility.

## Authentication and account data

- First account enrollment requires an `INITIAL_ENROLLMENT_CODE` of at least 32 characters, delivered out of band. It is hashed in configuration, never returned to the browser, and registration closes atomically after the first account is created. Leave it unset to disable enrollment. This one-time setup gate is not used for login; the passkey is.
- The first passkey creates an account name and a discoverable, user-verified WebAuthn credential. Passkey public keys and counters are stored in SQLite; private passkey material stays with the authenticator.
- The server stores only hashes of randomly generated, one-use recovery codes. The codes are shown once at enrollment or rotation. Recovery consumes a code and revokes current sessions before issuing a new session.
- Sessions use random, HttpOnly, SameSite=Strict cookies and are stored server-side as token hashes. They expire after seven days. “Sign out everywhere” revokes every session for the account.
- The optional recognition phrase is stored as an ordinary private preference, not used for authentication or sent to the brain adapter. Restrict access to the SQLite database and protect backups at the host level.
- `DATABASE_PATH` defaults to `./data/caelia.sqlite`; new data directories use mode `0700` and the database file uses mode `0600`. An existing parent directory must already be private and outside public/static directories. Do not commit the database, `.env`, or service tokens.
- Register a second passkey and store recovery codes somewhere private before relying on the account.

## Avatar UI and speech

The files in `/avatar` are served at `/`. After sign-in, the page provides a lightweight Caelia avatar with breathing, hair movement, attentive movement, greeting, glide, wave, bow, soul bloom, calm, and speaking states. Pointer clicks and action buttons send authenticated, validated avatar intents to the server; the UI animates the approved intent with CSS and Web Animations.

Speech output uses the browser's available voices and lets the user select a voice and pace. The sound depends on the browser and operating system; this does not provide a production voice provider. Optional microphone input uses browser speech recognition and may send audio to that browser provider. A text-only fallback remains available.

Without `CAELIA_BRAIN_URL`, typed or recognized text receives a clear local fallback rather than an invented AI response. The recognition phrase is not part of a prompt or proof of identity.

## Optional service adapters

Adapters are off unless their URL is configured. URLs must be HTTPS (local HTTP is allowed only outside production), and every configured service requires a matching environment value with at least 24 characters. Provide credentials through the host's protected configuration; never put them in the UI, repository, or URL. Calls have a five-second timeout. Use endpoints operated by your organization.

Generate a bootstrap code for local or first-owner enrollment with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and configure it as `INITIAL_ENROLLMENT_CODE` outside the repository. Deliver it to the intended owner over a separate trusted channel; do not reuse it as a login password.

| Environment variable | Request contract | Expected response |
| --- | --- | --- |
| `CAELIA_BACKEND_URL` / `CAELIA_BACKEND_TOKEN` | JSON `POST` with `{ "action", "target", "duration" }` for each avatar intent. | JSON `{ "approved": true }`; all other responses deny the intent. |
| `CAELIA_BRAIN_URL` / `CAELIA_BRAIN_TOKEN` | JSON `POST` with `{ "input", "user": { "username", "displayName" } }` for a speak intent. The recovery code, passkey data, session token, and recognition phrase are not sent. | JSON `{ "text": "..." }`, limited to 220 characters. |
| `UNITY_BRIDGE_URL` / `UNITY_BRIDGE_TOKEN` | JSON `POST` with `{ "action", "target", "duration" }`. User speech text is not forwarded. | A successful JSON response acknowledges dispatch. The local UI still animates the intent. |

These are explicit adapter contracts, not claims that those services already exist. Confirm the target URLs, authentication scheme, payloads, permission policy, and deployment ownership with the service operators before enabling a URL. The backend adapter is an authorization check; the Unity bridge only receives the validated avatar action. The avatar does not get authority to call brain tools or plugins.

## API overview

- `GET /api/health` — liveness only.
- `POST /api/auth/register/options`, `/api/auth/register/verify` — create an account with a passkey.
- `POST /api/auth/login/options`, `/api/auth/login/verify` — discoverable passkey sign-in.
- `POST /api/auth/recovery` — consume a recovery code and sign in.
- `POST /api/auth/passkey/register/options`, `/api/auth/passkey/register/verify` — add a passkey while signed in.
- `GET` / `PATCH /api/me` — read/update account preferences.
- `POST /api/auth/recovery-codes` — rotate one-use recovery codes.
- `POST /api/auth/passkeys/revoke` — revoke a lost or compromised passkey while signed in; the final remaining recovery method cannot be removed.
- `POST /api/auth/logout`, `/api/auth/revoke-sessions` — sign out here or revoke every session.
- `POST /api/avatar/intent` — authenticated, allowlisted presentation actions with bounded target and duration.

## Deployment limits

This SQLite-backed implementation is intended for one server process with persistent disk. Its short-lived WebAuthn challenges are kept in process memory; use a shared challenge store and coordinated rate-limit store before running multiple instances. Terminate HTTPS at a trusted reverse proxy, restrict the SQLite volume and backups, and configure trusted proxy IP handling before relying on IP-based limits behind a proxy. Configure the real public RP ID/origin before registering passkeys; changing the RP ID later requires users to register credentials again.

The repository does not include the existing Caelia brain, Unity project, production voice provider, deployment configuration, or service URLs. Those integrations remain unconfigured until their owners provide compatible HTTPS endpoints and service tokens.
