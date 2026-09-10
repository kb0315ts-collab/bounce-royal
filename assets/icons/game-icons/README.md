# Game-icons.net artwork for Bounce Royale

Icons made by **Lorc, Delapouite, DarkZaitzev, Skoll and Willdabeast** at
[Game-icons.net](https://game-icons.net/), licensed under
[Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/).

The accessible, per-image credit list is [the icon gallery](../../../icon-gallery.html#credits),
linked from the game's Settings screen. `manifest.json` records the original page,
author, license, modifications and SHA-256 hashes for every selected image.
`LICENSE.txt` is the original attribution notice supplied in the archive.

Source archive: https://game-icons.net/archives/ffffff/transparent/game-icons.net.svg.zip

Unmodified selected originals are in `source/`; recolored game-ready derivatives
are in `../augments/`. Derivatives retain the authors' silhouettes, with a restrained
color gradient, scaling, and (where documented) paired shapes or original effect badges.
The artwork's CC BY license does not relicense the game's source code.

## Rebuild / rollback

Run `node tools/import-augment-icons.js` to reproduce the derivatives and manifest
from checked-in originals. Selection and explanations live in
`tools/augment-icon-selection.json`. No online service is used during gameplay.

The previous code-drawn icons are retained in `js/icons.js` as `BRIcons.legacyMarkup`.
Removing the `js/augment-assets.js` script include restores the previous presentation
without changing any augment definitions. The gallery can compare both versions.

## Validation

- 93 derivatives from 89 originals; about 170 KiB of game-ready SVGs.
- `node tests/augment-assets.test.js`: exact roster coverage, file hashes, attribution,
  safe SVG geometry, URL validation, fallback and script load order.
- Existing `icons`, `ui`, `audio` and `audio-events` tests remain green.
- Browser checks: 320/360/390/720/1280 px widths, all images loaded, search/category
  filtering, comparison, dialog/keyboard dismissal and per-image source links.
- In-game codex, three-card selection/picking, description popup, settings credit
  link and an intentionally failed image request reverting to the old SVG.
- No gameplay data, simulation, sound recipes, server addresses or deployment
  configuration changed. The server MIME table now recognizes SVG images.
