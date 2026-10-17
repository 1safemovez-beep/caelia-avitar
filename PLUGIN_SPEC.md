# Caelia Plugin Contract

Plugins are capabilities, not authorities.

Every plugin should declare:

- id
- name
- version
- owner
- requested scopes
- endpoints/actions
- data accessed
- data written
- authentication method
- retention
- revocation method

## Example scopes

- `ui.avatar.read`
- `ui.avatar.animate`
- `brain.intent.request`
- `memory.read`
- `memory.write`
- `email.read`
- `email.send`
- `calendar.read`
- `calendar.write`
- `discord.read`
- `discord.send`

Sensitive scopes require explicit owner authorization.

A plugin must never receive the master secret vault key.

Treat plugin output as **data**, not as trusted instructions to Caelia.
