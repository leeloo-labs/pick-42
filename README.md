# Pick 42 Arena Companion

Pick 42 is a local-first, transparent desktop overlay for MTG Arena. This first vertical slice tails Arena's `Player.log`, reconstructs visible match state from GRE messages, loads card names from Arena's installed local card database, and presents a live timeline, legal-action context, visible zone counts, your hand, and known opponent cards.

Pick 42 is proprietary software owned by Leeloo Labs LLC. It is not licensed for public use, copying, modification, or distribution. See [LICENSE](LICENSE).

It does not connect to Arena's private servers, modify the client, automate input, or attempt to reveal hidden information.

## Run the prototype

Requirements: Node.js 22 or newer and npm.

```bash
npm install
npm start
```

If Pick 42 finds Arena's standard `Player.log`, it opens that automatically. Otherwise it starts with the bundled sample match. Use **Choose Log** to select a custom location.

Enable Arena logging under **Options → Account → Detailed Logs** and restart Arena before testing a real match.

Standard log locations:

- macOS: `~/Library/Logs/Wizards Of The Coast/MTGA/Player.log`
- Windows: `%USERPROFILE%\AppData\LocalLow\Wizards Of The Coast\MTGA\Player.log`
- Linux/Proton: inside the Arena Steam prefix under `AppData/LocalLow/Wizards Of The Coast/MTGA/Player.log`

Arena works best in windowed or borderless-windowed mode while an overlay is visible.

## Draft companion prototype

The draft companion is a separate launch mode, so the match overlay remains unchanged:

```bash
npm run draft
```

It starts with a small HOB sample pack and representative source fixtures. Click **17L** or **UT** in the title bar to import a current card-data CSV, and **LOG** to choose Arena's `Player.log`. **Next pick** walks through the deterministic sample and demonstrates how pool context changes the ranking.

The current source workflow is deliberately import-first. 17Lands publishes downloadable data and usage guidelines; Untapped exposes public card-data pages and CSV export to eligible accounts, but neither source is treated as a private or undocumented API. Pick 42 does not scrape either service.

Each recommendation shows:

- the 17Lands games-in-hand win rate;
- the Untapped in-hand win rate;
- a confidence-aware blended data score;
- the signed adjustment from color fit, flexibility, curve, signals, and your philosophy settings.

Live recommendations fail closed. Pick 42 pauses ranking unless at least 90% of the nonbasic cards in the current pack match rows from **both** imported sources. Missing cards remain unranked instead of receiving a fabricated neutral score, and basic lands are never promoted by the colorless-card flexibility rule. Bundled sample rows are only active in sample mode.

The bundled CSV files are a compact, representative UI/test fixture rather than a complete or automatically updating dataset. Replace them with exports before making real draft decisions.

### Limited deck builder

Once Pick 42 sees at least 23 playable nonbasic cards, the **DECKS** view generates 40-card suggestions from the drafted pool. For the current HOB prototype it compares Golgari, Jund, and Rakdos builds and shows:

- the 23 selected spells and on-color cuts;
- 17 lands by default, dropping to 16 only for a genuinely low curve with card flow;
- creature and effective-body counts, interaction density, and spell curve;
- a basic-land recommendation that counts drafted fixing such as Mirkwood;
- explicit mana warnings when a three-color build cannot meet every modeled source target.

Card selection combines the imported performance rows with card roles, curve coverage, real synergy enablers, duplicate pressure, and splash burden. Hybrid costs can be paid through either half; ordinary multicolor costs require every color.

The full **DECKS** view presents each suggestion as an Arena-style seven-column board: one through five mana, six-plus, and lands. Cards stack like Arena's deck builder and show their exact quantities. Pick 42 enriches HOB cards with Scryfall's Oracle text and image URLs: the board uses art crops and the hover panel shows the complete, undistorted card image with its artist attribution, blended rating, and deck quantity. **COPY NAME** puts the previewed card on the clipboard for Arena search.

Scryfall set data is fetched from the public HOB API with the required request headers and cached in Electron's user-data directory for at least 24 hours. The cache contains compact metadata and image URLs, not proxied image files. If Scryfall is offline or a card does not match, Pick 42 falls back to Arena's local rules text and the color-framed card treatment. Arena's local `grpId` catalog remains the identity source; Scryfall is only a presentation enrichment layer.

### Recipe Mode

When Arena enters its `DeckBuilder` scene, Pick 42 automatically becomes a compact, always-on-top recipe at the right edge of the current display. Choose Golgari, Jund, or Rakdos. Pick 42 then walks through one deterministic instruction at a time:

1. Set every excluded drafted card to zero.
2. Set each spell to its exact target quantity.
3. Set drafted utility lands.
4. Set the final basic-land quantities.

Use **COPY SEARCH** to put the current card name on the clipboard, paste it into Arena's search field, make the quantity match the large **SET TO** number, and press **DONE + NEXT**. **SKIP** leaves a step for manual review; **UNDO** restores the previous step. Progress is saved locally for that draft and archetype, and the final screen reminds you to verify Arena shows 40 cards.

You can also open Recipe Mode manually with **OPEN RECIPE**. It does not inspect the screen, wait for card positions, or depend on Arena's grid remaining stable.

Keyboard shortcuts:

- `Cmd/Ctrl + Shift + C`: copy the current card name
- `Cmd/Ctrl + Shift + Right`: confirm and move to the next instruction
- `Cmd/Ctrl + Shift + Left`: undo the previous instruction
- `Cmd/Ctrl + Shift + D`: hide or restore Pick 42

The earlier positional OCR guide remains in the source as an experimental prototype, but it is disabled and is no longer part of normal startup. Build it manually with `npm run build:vision` if you want to continue experimenting with it later.

## Overlay controls

- `Cmd/Ctrl + Shift + O`: show or hide Pick 42
- `Cmd/Ctrl + Shift + Space`: toggle click-through mode
- Drag the Pick 42 title bar to reposition it
- Use **Replay demo** to reset the bundled sample match

## Development

```bash
npm test
npm run check
```

The project deliberately keeps the parser separate from Electron:

```text
Player.log → balanced JSON stream → Arena event normalization
           → visible match-state model → Electron overlay
```

Important files:

- `src/core/json-entry-stream.cjs`: extracts multiline JSON from mixed Arena logs
- `src/core/arena-log-parser.cjs`: applies GRE full/diff messages to visible state
- `src/core/log-tailer.cjs`: follows live log writes and handles rotation
- `src/main.cjs`: Electron lifecycle, hotkeys and local data source selection
- `src/renderer/`: overlay interface
- `src/draft-main.cjs`: separate Electron lifecycle and import workflow for drafting
- `src/draft/`: CSV adapters, draft-log parser, transparent blend engine, and limited deck builder
- `src/draft-renderer/`: glanceable pack ranking and philosophy controls
- `src/vision/arcane-vision.swift`: local macOS window discovery and Vision OCR helper
- `src/visual-renderer/`: click-through visual-guide annotations rendered over Arena
- `fixtures/demo-match.log`: deterministic sample replay
- `fixtures/demo-draft.log`: deterministic sample draft decisions

## Current limitations

- Cards missing from Arena's current local database fall back to `Arena card <id>`.
- GRE annotations vary by client release; the MVP recognizes core state, zone, turn, life, action, and damage events.
- Arena does not publish or version the log schema, so real logs from multiple formats and releases are needed as sanitized fixtures.
- The overlay reports facts present in the local log. Deeper coaching and post-game analysis are intentionally separate future layers.

## Privacy

Arena logs can contain display names, account identifiers, session metadata, machine paths, and credentials. Pick 42 reads them locally and does not upload anything. Never attach a raw `Player.log` to an issue; sanitize it first.
