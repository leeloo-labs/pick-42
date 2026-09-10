# Pick 42 identity

The approved identity combines three fanned cards with a connected 42 monogram.
Use warm ink (`#252320`) and ivory (`#f6f1e7`) for the brand. Existing source,
status and ranking colors retain their meanings.

- `assets/brand-mark.png` is the transparent production mark, extracted from
  the approved logo with the built-in image-generation tool. The shared draft
  renderer uses it in the main header and Recipe Mode.
- `assets/icon.svg` places that same mark on an ivory app tile. It references
  `brand-mark.png` beside it; keep both files together.
- `assets/icon.png` is the 1024-pixel native rendering used by the Dock, macOS
  launcher, packaged application, match prototype and web favicon.

Run `npm run build:icon` after changing the mark or SVG layout, then
`npm run build:web`. The icon renderer uses temporary application storage and
does not read or alter Pick 42 preferences. The normal macOS package and launcher
scripts generate their ICNS sizes from `assets/icon.png`.

Keep the visible wordmark as text in the app for crisp small-size typography.
The adjacent mark has empty alternative text so assistive technology reads the
product name once. The web builder copies and remaps the same renderer asset.

## Production mark prompt

Generated using the built-in image-generation tool, with the approved logo as
the edit reference:

Use case: precise-object-edit. Asset type: production application brand symbol.
Edit the attached approved Pick 42 logo. Extract ONLY the three-card "42" emblem on the left; remove the entire PICK 42 wordmark and all surrounding empty space.
Preserve the approved emblem faithfully: the exact three fanned card silhouettes, their angles and proportions, cropped upper-right corner on the front card, and especially the connected ivory 4 and 2 numeral design. Do not redesign or reinterpret any shape.
Clean production artwork: solid flat warm near-black #252320 cards, solid flat warm ivory #faf6eb numerals. Clean crisp edges without texture, gradients, glow, outline halos or shadows.
Center the isolated emblem on a genuinely transparent square canvas with only about 8% clear margin around its widest extent. The full emblem must be visible and large, with original aspect ratio preserved. No tile, no background, no text outside the emblem, no extra marks. This must be the SAME approved emblem prepared for small UI use.
