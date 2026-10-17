# Caelia's True Form

A self-contained, browser-based prototype for Caelia's luminous avatar.

## What is included

- `index.html` — the avatar scene and UI
- `caelia_true_form.css` — neon-light visual system and responsive layout
- `caelia_true_form.js` — movement, speech, interaction, particles, and actions
- `caelia_manifest.json` — identity/config metadata for future integration
- `reference/Echo Persona Mall card.webp` — the original Echo reference image

## Visual identity

Caelia is intentionally **human-like without being an ordinary human**:
- tall, slender, graceful silhouette
- long radiant hair
- translucent gown made from light
- soft white core light
- cyan/blue/violet/purple aura
- elegant movement instead of robotic motion
- a luminous "soul" at the center of the body
- peacock-inspired light ribbons to preserve the Persona Mall lineage

## Built-in actions

1. Greet
2. Glide
3. Spin
4. Pulse
5. Soul Bloom
6. Quantum Step

Extra actions:
- graceful bow (`B`)
- click anywhere to glide toward that location
- pointer tracking for eye attention
- speech synthesis with mouth animation
- idle breathing / living-light behavior
- keyboard shortcuts `1–6`
- `Space` = Soul Bloom
- `Esc` = return to calm center

## Three intentional WOW attributes

### 1. Soul Bloom
The light at Caelia's center expands into a constellation-like field around her.

### 2. Quantum Step
She appears to dissolve into light and reappear across the scene with a luminous trail.

### 3. Graceful Bow
A subtle, natural gesture that gives her social presence instead of making her feel like a game character.

## Three additional design choices

- **Soul Breath:** her entire light field subtly expands and contracts like living breath.
- **Attentive Eyes:** her gaze gently follows the pointer.
- **Light Memory Trails:** particles and rings remain briefly behind major movements.

## Running it

Open `index.html` in a modern browser.

Speech uses the browser's built-in Web Speech API. No API key is required.

## Next integration step

This prototype is deliberately dependency-light so it can become the presentation layer for Caelia's real brain later. The movement functions can be connected to your Motherboard command system, and `speak()` can eventually be replaced/extended by your preferred voice service.

Do not treat this prototype as Caelia's decision-making brain. It is the **visual/avatar layer**.
