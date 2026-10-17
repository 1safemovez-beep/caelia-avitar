# Caelia Extensions

Extensions are UI/presentation modules that can add:

- avatar expressions
- gestures
- environments
- voice controls
- Motherboard panels
- status cards
- tool launchers
- accessibility controls

Extensions may request UI capabilities but do not automatically receive brain authority.

## Extension events

- `caelia:attention`
- `caelia:speak`
- `caelia:gesture`
- `caelia:glide`
- `caelia:pulse`
- `caelia:soul_bloom`
- `caelia:status`
- `caelia:permission_required`

The production UI bridge should validate event names and payloads.
