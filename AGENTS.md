# Pick 42 project memory

## Identity and ownership

- Product name: **Pick 42**. The name refers to the final selection in a normal MTG Arena draft: three 14-card packs.
- Pick 42 is proprietary software owned by **Leeloo Labs LLC**.
- Canonical repository: `https://github.com/leeloo-labs/pick-42`.
- The product was initially called Arcane. Some internal compatibility identifiers, storage keys, helper filenames, and the legacy Electron user-data directory still use `arcane`; preserve those until an explicit migration is implemented so existing imports and recipe progress are not lost.

## Product direction

Pick 42 is a local-first MTG Arena drafting companion. The match companion remains a working prototype, but current product development is focused on draft recommendations and limited deck construction because Arena games move too quickly for the match overlay to provide enough value.

The companion must remain transparent and advisory:

- Read only information Arena writes to local logs or displays visibly.
- Do not access private Arena services, reveal hidden information, or automate game/draft input.
- Explain rankings through source metrics and visible contextual adjustments.
- Fail closed when the imported source data is incomplete or does not match the active set.

## Data sources and ranking

- **17Lands:** imported CSV data, including GIH win rate, games in hand, games-not-seen win rate, and IIH when present. IIH may be calculated as GIH WR minus GNS WR when necessary.
- **Untapped:** imported CSV data, including in-hand win rate, in-hand win-rate difference, and sample counts when available.
- **Scryfall:** public set data for card images, Oracle text, and presentation enrichment. Arena group IDs remain the live identity source.
- Do not scrape 17Lands or Untapped or depend on undocumented/private APIs.

The blend engine uses confidence-aware source scores plus contextual drafting philosophy. Important invariants:

- Require usable matching rows from both imported statistical sources for at least 90% of nonbasic cards before enabling live rankings.
- Blank statistics do not count as source coverage.
- Basic lands are never ranked as flexible colorless cards.
- Shrink IIH toward zero using sample confidence before it changes a card score.
- Flag reliable extreme draw impact as `HIGH IMPACT`, `POSITIVE IIH`, `DRAW LIABILITY`, or `NEGATIVE IIH`; use `LOW-SAMPLE IIH` when the sample is too weak.
- Apply stronger color discipline as the draft progresses while allowing an early off-color bomb to overcome weak lane evidence.
- Treat premium removal, curve needs, real synergy enablers, duplicate pressure, and splash burden explicitly.
- Hybrid mana can be paid by either color. Gold mana requires every listed color.
- Hard subtype requirements must be supported by the drafted pool; for example, Dwarven Mattock should be penalized without Dwarfs.

## Deck builder and UI

- Generate 40-card limited decks, normally with 17 lands; use 16 only for a genuinely low curve with card flow.
- The HOB prototype compares Golgari, Jund, and Rakdos builds.
- Present decks as an Arena-style, seven-column card board with stacked cards, visible quantities, and enlarged hover previews.
- Match Arena's card ordering and color grouping.
- Hybrid cards and matching dual lands use a two-color split treatment without a gold outline. Gold cards retain a gold outline and display both required colors.
- Use a warm neutral light theme so white and black cards both remain visually distinct.
- Recipe Mode is the reliable deck-building aid: it gives deterministic add/drop quantity instructions and preserves progress locally.
- The positional OCR overlay remains experimental and disabled in normal startup because Arena grid reordering and scrolling made it unreliable.

## Development

```bash
npm install
npm run draft
npm test
npm run check
```

- The test suite currently contains 49 passing tests.
- Preserve local-only behavior and existing saved state when changing Electron names or data paths.
- Add sanitized fixtures for newly observed Arena log shapes; never commit raw `Player.log` files.
- Keep ranking behavior inspectable and add regression tests for any recommendation the user identifies as clearly wrong.

