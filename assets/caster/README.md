# Cosmic sportscaster

## Current cactus toy

The active mascot is an original inline SVG in `index.html`, with flat cream/green/coral fills and the same chunky navy outlines as the game's ball and weapon art. It evokes a talking cactus toy without using a branded toy image. The stem, eyes, mouth and cloth gag are separate groups animated by `css/commentary.css`; the flowerpot stays still. `js/commentary.js` synchronizes mouth pulses with original Web Audio babble in `js/audio.js` (`caster.chatter`). No downloaded voice recordings are used.

## Archived robot

The PNG below is retained for rollback from `codex/cactus-caster` to `674ef96`; the current UI does not request it.

`cosmic-caster.png` is an original transparent character generated with the built-in image generation tool for Bounce Royale. The original generated bitmap is used without replacing the game's ball or weapon art. CSS supplies the cloth gag and small gestures, so no additional sprite sheets or video are required.

Generation prompt:

> Use case: stylized-concept. Asset type: transparent 2D character sprite for a Korean casual cosmic sports mobile game HUD, upper-left announcer. A single original adorable energetic robot sportscaster mascot, waist-up bust, front view slightly turned right. Cream rounded capsule head, navy outlines (#243747), dark face-screen with expressive cyan eyes and cheerful mouth; chunky coral broadcast headphones, boom microphone, golden antenna, navy/cream sports jacket, yellow bowtie, lively mitten hand gesture. Clean casual cel shading and readable toy-like silhouette. Palette #fff4d9, #f0796c, #ffd25a, #9dcdd4, #243747. Readable at 80px, centered square sprite, safe transparent margin, unobstructed mouth for CSS gag overlay. Genuine transparent alpha. No scene, pedestal, speech bubbles, lettering, logos or watermark.

Source generation: `exec-f26bdbc1-473f-4981-8da9-32e52e9696d8.png`.
Runtime path: `assets/caster/cosmic-caster.png`.
