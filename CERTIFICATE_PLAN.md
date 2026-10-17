# Caelia Systems Certificate Plan

## Production

Use trusted TLS certificates for:

- `caeliasystems.com`
- `motherboard.caeliasystems.com`
- `backend.caeliasystems.com`

A certificate authority such as Let's Encrypt can issue free automated TLS certificates after domain control is demonstrated.

## Important

This package does **not** contain a production private key or certificate.

Do not generate or commit a production certificate private key into Git.

## Code signing

If Caelia is packaged as a desktop/mobile application, obtain a platform-appropriate code-signing certificate/account and keep its private signing material in a secure vault or hardware-backed signing service.

## Certificate inventory

Record:
- domain
- issuer
- serial number
- expiration
- renewal method
- responsible account
- emergency contact

Never publish private keys.
