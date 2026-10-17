# Caelia Security Architecture

**Build:** 2026-10-07  
**Owner:** Alicia Spears / Caelia Systems

Security baseline follows the categories in OWASP ASVS.

## Trust boundaries

1. Browser/avatar — untrusted client.
2. Motherboard — authenticated UI.
3. Backend — enforcement point.
4. Brain — controlled service.
5. Plugins — isolated capabilities.
6. Memory — protected data service.
7. Secrets vault — highest sensitivity.

## Required protections

- MFA for administrative accounts
- least privilege
- server-side authorization
- HTTPS/TLS
- secure session handling
- input validation
- output encoding
- rate limiting
- audit logging
- dependency/SBOM tracking
- backup and recovery
- secret rotation
- key separation
- incident response plan

OWASP's current ASVS provides verification categories covering authentication, authorization, cryptography, data protection, API/web services, and configuration. 

## Secrets

Never commit:
- API keys
- passwords
- OAuth client secrets
- signing keys
- TLS private keys
- encryption keys
- webhook secrets

Use a dedicated secrets manager/vault. Keep secrets out of frontend bundles and ordinary Git history.

## Continuity

The avatar's uninstall/deletion behavior must be separate from canonical project ownership and backups. A local user can remove their copy. That does not erase authorized canonical records.

## Threat model

Assume:
- plugin output may be malicious;
- browser state may be modified;
- credentials may leak;
- prompts may attempt to override policy;
- external APIs may return hostile instructions.

Caelia's permission layer must win over tool/plugin instructions.
